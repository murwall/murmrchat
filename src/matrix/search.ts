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
 * The index never leaves this device. Message text and senders are encrypted at rest (AES-GCM) with a
 * key derived from this session's local store passphrase (kept in the OS keychain); only the event ID,
 * room ID and timestamp are stored in the clear, for ordering and filtering.
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

/** What we store per message: metadata in the clear, the rest encrypted. */
interface StoredRecord {
  eventId: string;
  roomId: string;
  ts: number;
  iv: Uint8Array;
  data: ArrayBuffer; // AES-GCM( JSON {threadId, sender, body} )
}

const DB_VERSION = 2; // v1 stored plaintext; upgrading deletes it.
const MAX_CRAWL_PER_ROOM = 5000;
const CRAWL_DELAY_MS = 1500;

const dbName = (userId: string) => `matterix-search-${userId}`;

function openDb(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(userId), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Drop anything from older versions (v1 kept plaintext) and start over.
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      const msgs = db.createObjectStore("messages", { keyPath: "eventId" });
      msgs.createIndex("ts", "ts");
      db.createObjectStore("crawler", { keyPath: "roomId" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let deleteSearchIndex() (on sign-out) proceed instead of being blocked by this connection.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Delete the local search index (on sign-out, or when it can't be decrypted). */
export function deleteSearchIndex(userId: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(userId));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/**
 * AES-GCM key for the index, derived (HKDF-SHA256) from the session's local-store passphrase.
 * Without one (sessions from the first app version) we use a random per-run key and wipe the
 * index at startup, so nothing readable persists.
 */
async function deriveIndexKey(passphrase: string | null): Promise<{ key: CryptoKey; persistent: boolean }> {
  if (!passphrase) {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { key, persistent: false };
  }
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("matterix-search-index"), info: new TextEncoder().encode("v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, persistent: true };
}

async function seal(key: CryptoKey, m: IndexedMessage): Promise<StoredRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ threadId: m.threadId, sender: m.sender, body: m.body }));
  // Bind the ciphertext to its event so records can't be swapped around.
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(m.eventId) }, key, plain);
  return { eventId: m.eventId, roomId: m.roomId, ts: m.ts, iv, data };
}

async function open(key: CryptoKey, r: StoredRecord): Promise<IndexedMessage | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: r.iv as Uint8Array<ArrayBuffer>, additionalData: new TextEncoder().encode(r.eventId) },
      key,
      r.data,
    );
    const { threadId, sender, body } = JSON.parse(new TextDecoder().decode(plain));
    return { eventId: r.eventId, roomId: r.roomId, ts: r.ts, threadId, sender, body, lower: String(body).toLowerCase() };
  } catch {
    return null;
  }
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

  private key: Promise<CryptoKey>;

  constructor(
    private client: MatrixClient,
    passphrase: string | null,
  ) {
    const userId = client.getSafeUserId();
    const derived = deriveIndexKey(passphrase);
    this.key = derived.then((d) => d.key);
    // Non-persistent key: wipe whatever is on disk first, it could never be read again anyway.
    this.db = derived.then(async (d) => {
      if (!d.persistent) await deleteSearchIndex(userId);
      return openDb(userId);
    });
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
    void this.db.then((db) => db.close()).catch(() => {});
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
    const key = await this.key;
    const sealed = await Promise.all(batch.map((m) => seal(key, m)));
    const db = await this.db;
    if (this.stopped) return;
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    for (const rec of sealed) store.put(rec);
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
    const key = await this.key;
    // Load candidate records (newest first). Text is encrypted, so matching happens after decryption.
    const records = await new Promise<StoredRecord[]>((resolve) => {
      const req = db.transaction("messages").objectStore("messages").index("ts").getAll();
      req.onsuccess = () => resolve((req.result as StoredRecord[]).reverse());
      req.onerror = () => resolve([]);
    });
    const candidates = roomIds ? records.filter((r) => roomIds.has(r.roomId)) : records;
    const results: IndexedMessage[] = [];
    const CHUNK = 400;
    for (let i = 0; i < candidates.length && results.length < limit; i += CHUNK) {
      const opened = await Promise.all(candidates.slice(i, i + CHUNK).map((r) => open(key, r)));
      for (const m of opened) {
        if (!m) continue;
        const okFrom = !fromFilter || m.sender.toLowerCase().includes(fromFilter.replace(/^@/, ""));
        if (okFrom && words.every((w) => m.lower.includes(w))) results.push(m);
      }
    }

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
