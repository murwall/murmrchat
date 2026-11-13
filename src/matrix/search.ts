import { ClientEvent, Direction, EventType, MatrixEventEvent, RelationType } from "matrix-js-sdk";
import type { IRoomEvent, MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { joinedRooms } from "./rooms";
import { stripReplyFallback } from "../util/format";

/**
 * Local full-text search over decrypted messages.
 *
 * Matrix servers can't search encrypted rooms, so (like Element Desktop's "Seshat") we keep our own
 * index on this device, in IndexedDB:
 *   - every message we see or decrypt is indexed as it arrives;
 *   - a slow background crawler walks back through each room's history to index older messages.
 * The index never leaves this device.
 */

export interface IndexedMessage {
  eventId: string;
  roomId: string;
  threadId?: string;
  sender: string;
  ts: number;
  body: string;
  lower: string;
}

const DB_VERSION = 1;
const MAX_CRAWL_PER_ROOM = 5000;
const CRAWL_DELAY_MS = 1500;

function openDb(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`matterix-search-${userId}`, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const msgs = db.createObjectStore("messages", { keyPath: "eventId" });
      msgs.createIndex("ts", "ts");
      db.createObjectStore("crawler", { keyPath: "roomId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function toIndexed(ev: MatrixEvent): IndexedMessage | null {
  if (ev.getType() !== EventType.RoomMessage || ev.isRedacted() || ev.isDecryptionFailure()) return null;
  const id = ev.getId();
  if (!id?.startsWith("$")) return null;
  let content = ev.getContent();
  let eventId = id;
  // Index edits under the original message, with the new text.
  if (ev.isRelation(RelationType.Replace)) {
    const original = ev.getRelation()?.event_id;
    if (!original || !content["m.new_content"]) return null;
    eventId = original;
    content = content["m.new_content"];
  }
  const raw = content.msgtype === "m.text" || content.msgtype === "m.notice" || content.msgtype === "m.emote" || content.msgtype === "m.file" || content.msgtype === "m.image"
    ? String(content.body ?? "")
    : "";
  const body = stripReplyFallback(raw).trim();
  if (!body) return null;
  return {
    eventId,
    roomId: ev.getRoomId()!,
    threadId: ev.threadRootId && ev.threadRootId !== id ? ev.threadRootId : undefined,
    sender: ev.getSender()!,
    ts: ev.getTs(),
    body,
    lower: body.toLowerCase(),
  };
}

export class SearchIndex {
  private db: Promise<IDBDatabase>;
  private queue: IndexedMessage[] = [];
  private flushTimer: number | null = null;
  private stopped = false;
  private listeners: (() => void)[] = [];
  /** Progress of the history crawler, for display. */
  crawlStatus = { roomsDone: 0, roomsTotal: 0, indexed: 0 };

  constructor(private client: MatrixClient) {
    this.db = openDb(client.getSafeUserId());
  }

  start() {
    const onEvent = (ev: MatrixEvent) => this.add(ev);
    this.client.on(ClientEvent.Event, onEvent);
    this.client.on(MatrixEventEvent.Decrypted, onEvent);
    this.listeners.push(() => {
      this.client.off(ClientEvent.Event, onEvent);
      this.client.off(MatrixEventEvent.Decrypted, onEvent);
    });
    // Index whatever is already loaded.
    for (const room of joinedRooms(this.client)) {
      for (const ev of room.getLiveTimeline().getEvents()) this.add(ev);
    }
    this.crawl();
  }

  stop() {
    this.stopped = true;
    for (const off of this.listeners) off();
  }

  add(ev: MatrixEvent) {
    const item = toIndexed(ev);
    if (!item) return;
    this.queue.push(item);
    if (!this.flushTimer) this.flushTimer = window.setTimeout(() => this.flush(), 500);
  }

  private async flush() {
    this.flushTimer = null;
    const batch = this.queue.splice(0);
    if (!batch.length) return;
    const db = await this.db;
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    for (const item of batch) store.put(item);
    await txDone(tx).catch(() => {});
  }

  async search(query: string, limit = 100): Promise<IndexedMessage[]> {
    await this.flush();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    // Support "in:channel-name" and "from:@user" filters like Mattermost.
    const inFilter = terms.find((t) => t.startsWith("in:"))?.slice(3);
    const fromFilter = terms.find((t) => t.startsWith("from:"))?.slice(5);
    const words = terms.filter((t) => !t.startsWith("in:") && !t.startsWith("from:"));
    const roomIds = inFilter
      ? new Set(joinedRooms(this.client).filter((r) => r.name.toLowerCase().includes(inFilter)).map((r) => r.roomId))
      : null;

    const db = await this.db;
    const results: IndexedMessage[] = [];
    await new Promise<void>((resolve) => {
      const req = db.transaction("messages").objectStore("messages").index("ts").openCursor(null, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || results.length >= limit) return resolve();
        const m = cursor.value as IndexedMessage;
        const okRoom = !roomIds || roomIds.has(m.roomId);
        const okFrom = !fromFilter || m.sender.toLowerCase().includes(fromFilter.replace(/^@/, ""));
        if (okRoom && okFrom && words.every((w) => m.lower.includes(w))) results.push(m);
        cursor.continue();
      };
      req.onerror = () => resolve();
    });

    // Unencrypted rooms: also ask the server, which may have history we haven't crawled yet.
    if (words.length && !fromFilter) {
      try {
        const res = await this.client.searchRoomEvents({ term: words.join(" ") });
        const have = new Set(results.map((r) => r.eventId));
        for (const r of res.results) {
          const ev = r.context.getEvent();
          const item = toIndexed(ev);
          if (item && !have.has(item.eventId) && (!roomIds || roomIds.has(item.roomId))) results.push(item);
        }
      } catch {
        /* server search unavailable */
      }
    }
    return results.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /** Walk back through each room's history, slowly, indexing older messages. */
  private async crawl() {
    const db = await this.db;
    const mapper = this.client.getEventMapper();
    const rooms = joinedRooms(this.client).filter((r) => !r.isSpaceRoom());
    this.crawlStatus.roomsTotal = rooms.length;

    for (const room of rooms) {
      if (this.stopped) return;
      const state = await new Promise<{ roomId: string; token: string | null; count: number; done: boolean } | undefined>(
        (resolve) => {
          const req = db.transaction("crawler").objectStore("crawler").get(room.roomId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        },
      );
      let token = state?.token ?? room.getLiveTimeline().getPaginationToken(Direction.Backward);
      let count = state?.count ?? 0;
      if (state?.done || !token) {
        this.crawlStatus.roomsDone++;
        continue;
      }

      while (!this.stopped && token && count < MAX_CRAWL_PER_ROOM) {
        let res;
        try {
          res = await this.client.createMessagesRequest(room.roomId, token, 100, Direction.Backward);
        } catch {
          break; // try again next app start
        }
        const events = (res.chunk as IRoomEvent[]).map((raw) => mapper({ ...raw, room_id: room.roomId }));
        for (const ev of events) {
          if (ev.isEncrypted()) await this.client.decryptEventIfNeeded(ev).catch(() => {});
          this.add(ev);
        }
        count += events.length;
        this.crawlStatus.indexed += events.length;
        token = res.end ?? null;
        const tx = db.transaction("crawler", "readwrite");
        tx.objectStore("crawler").put({ roomId: room.roomId, token, count, done: !token || count >= MAX_CRAWL_PER_ROOM });
        await txDone(tx).catch(() => {});
        await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
      }
      this.crawlStatus.roomsDone++;
    }
  }
}
