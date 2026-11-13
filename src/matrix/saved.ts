import { EventType } from "matrix-js-sdk";
import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Saved messages (personal bookmarks, Mattermost's "Saved") — stored in account data so
 * they sync across your Matterix installs.
 * Pinned messages (shared with the channel) — the standard m.room.pinned_events state event,
 * so they also show up in Element's pinned list.
 */

export const SAVED_TYPE = "io.matterix.saved";

export interface SavedItem {
  roomId: string;
  eventId: string;
  savedAt: number;
}

export function getSaved(client: MatrixClient): SavedItem[] {
  const c = client.getAccountData(SAVED_TYPE as never)?.getContent() as { items?: SavedItem[] } | undefined;
  return Array.isArray(c?.items) ? c!.items : [];
}

export function isSaved(client: MatrixClient, eventId: string): boolean {
  return getSaved(client).some((i) => i.eventId === eventId);
}

export async function toggleSaved(client: MatrixClient, roomId: string, eventId: string) {
  const items = getSaved(client);
  const next = items.some((i) => i.eventId === eventId)
    ? items.filter((i) => i.eventId !== eventId)
    : [{ roomId, eventId, savedAt: Date.now() }, ...items];
  await client.setAccountData(SAVED_TYPE as never, { items: next } as never);
}

export function getPinnedIds(room: Room): string[] {
  const pinned = room.currentState.getStateEvents(EventType.RoomPinnedEvents, "")?.getContent().pinned;
  return Array.isArray(pinned) ? pinned.filter((x): x is string => typeof x === "string") : [];
}

export function canPin(room: Room): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, room.client.getSafeUserId());
}

export async function togglePinned(room: Room, eventId: string) {
  const ids = getPinnedIds(room);
  const pinned = ids.includes(eventId) ? ids.filter((id) => id !== eventId) : [...ids, eventId];
  await room.client.sendStateEvent(room.roomId, EventType.RoomPinnedEvents, { pinned }, "");
}
