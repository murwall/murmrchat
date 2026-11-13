import { EventType, KnownMembership, NotificationCountType, RelationType } from "matrix-js-sdk";
import { getCategories, type Category } from "./categories";
import { isMuted } from "./notifSettings";
import type { MatrixClient, Room } from "matrix-js-sdk";

/** "Home" = rooms that don't belong to any joined space. */
export const HOME_TEAM = "home";

export function joinedRooms(client: MatrixClient): Room[] {
  return client.getRooms().filter((r) => r.getMyMembership() === KnownMembership.Join);
}

export function invitedRooms(client: MatrixClient): Room[] {
  return client.getRooms().filter((r) => r.getMyMembership() === KnownMembership.Invite);
}

/** Joined spaces, shown as "teams" in the left-most bar. Only top-level spaces get their own icon. */
export function getTeams(client: MatrixClient): Room[] {
  const spaces = joinedRooms(client).filter((r) => r.isSpaceRoom());
  const childSpaceIds = new Set<string>();
  for (const s of spaces) {
    for (const id of spaceChildIds(s)) childSpaceIds.add(id);
  }
  return spaces
    .filter((s) => !childSpaceIds.has(s.roomId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function spaceChildIds(space: Room): string[] {
  return space.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((ev) => Array.isArray(ev.getContent().via) && ev.getContent().via.length > 0)
    .map((ev) => ev.getStateKey()!)
    .filter(Boolean);
}

/** All rooms in a space, including rooms in nested sub-spaces. */
export function roomsInSpace(client: MatrixClient, space: Room): Set<string> {
  const result = new Set<string>();
  const seen = new Set<string>();
  const walk = (s: Room) => {
    if (seen.has(s.roomId)) return;
    seen.add(s.roomId);
    for (const id of spaceChildIds(s)) {
      const child = client.getRoom(id);
      if (child?.isSpaceRoom()) walk(child);
      else result.add(id);
    }
  };
  walk(space);
  return result;
}

export function dmRoomIds(client: MatrixClient): Set<string> {
  const direct = client.getAccountData(EventType.Direct)?.getContent() as Record<string, string[]> | undefined;
  const ids = new Set<string>();
  for (const rooms of Object.values(direct ?? {})) for (const id of rooms) ids.add(id);
  return ids;
}

export function isDm(client: MatrixClient, room: Room, dmIds = dmRoomIds(client)): boolean {
  return dmIds.has(room.roomId);
}

/** The other person in a DM (for avatar / presence). */
export function dmPartner(client: MatrixClient, room: Room) {
  const me = client.getUserId();
  const other = room.getJoinedMembers().find((m) => m.userId !== me) ?? room.getMembers().find((m) => m.userId !== me);
  return other ?? null;
}

export interface SidebarData {
  channels: Room[];
  dms: Room[];
  favorites: Room[];
  /** User-defined categories for this team, in order, with their (joined) rooms. */
  categories: { category: Category; rooms: Room[] }[];
}

/** Rooms to list in the channel sidebar for the selected team. */
export function sidebarRooms(client: MatrixClient, teamId: string): SidebarData {
  const dmIds = dmRoomIds(client);
  const rooms = joinedRooms(client).filter((r) => !r.isSpaceRoom());

  let inTeam: (r: Room) => boolean;
  if (teamId === HOME_TEAM) {
    const inAnySpace = new Set<string>();
    for (const t of getTeams(client)) for (const id of roomsInSpace(client, t)) inAnySpace.add(id);
    inTeam = (r) => !inAnySpace.has(r.roomId);
  } else {
    const space = client.getRoom(teamId);
    const ids = space ? roomsInSpace(client, space) : new Set<string>();
    inTeam = (r) => ids.has(r.roomId);
  }

  // Favorited DMs show in every team, like DMs themselves.
  const favorites = rooms.filter((r) => r.tags["m.favourite"] && (teamId === HOME_TEAM || inTeam(r) || dmIds.has(r.roomId)));
  const favIds = new Set(favorites.map((r) => r.roomId));

  // Custom categories: a room lives in at most one, and favorites take precedence.
  const byId = new Map(rooms.map((r) => [r.roomId, r]));
  const placed = new Set<string>(favIds);
  const categories = getCategories(client, teamId).map((category) => {
    const catRooms = category.roomIds
      .map((id) => byId.get(id))
      .filter((r): r is Room => !!r && !placed.has(r.roomId) && (dmIds.has(r.roomId) || inTeam(r)))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const r of catRooms) placed.add(r.roomId);
    return { category, rooms: catRooms };
  });

  const channels = rooms
    .filter((r) => !dmIds.has(r.roomId) && inTeam(r) && !placed.has(r.roomId))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Like Mattermost, DMs are global and shown in every team, most recent first.
  const dms = rooms
    .filter((r) => dmIds.has(r.roomId) && !placed.has(r.roomId))
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());

  return { channels, dms, favorites: favorites.sort((a, b) => a.name.localeCompare(b.name)), categories };
}

/**
 * Unread state of the channel's main conversation only.
 * Like Mattermost's collapsed reply threads, replies inside threads don't mark the channel
 * unread; they show up in the "Threads" view instead.
 */
export function unreadInfo(room: Room): { unread: boolean; mentions: number } {
  // Muted channels never look unread (Mattermost behaviour).
  if (isMuted(room)) return { unread: false, mentions: 0 };
  const mentions = room.getRoomUnreadNotificationCount(NotificationCountType.Highlight);
  const total = room.getRoomUnreadNotificationCount(NotificationCountType.Total);
  // Notification counts are 0 in "mentions only" channels, so also check for unseen messages.
  return { unread: total > 0 || mentions > 0 || hasUnseenMessages(room), mentions };
}

/** Is the newest message in the main conversation from someone else and not yet read by me? */
function hasUnseenMessages(room: Room): boolean {
  const me = room.client.getUserId();
  if (!me) return false;
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const t = ev.getType();
    if (t !== EventType.RoomMessage && t !== EventType.RoomMessageEncrypted && t !== EventType.Sticker) continue;
    if (ev.isRelation(RelationType.Replace)) continue;
    const id = ev.getId();
    if (ev.getSender() === me || !id?.startsWith("$")) return false;
    return !room.hasUserReadEvent(me, id);
  }
  return false;
}

/** Mark the channel and all of its threads as read. */
export async function markRoomRead(client: MatrixClient, room: Room): Promise<void> {
  const receipts: Promise<unknown>[] = [];
  const last = [...room.getLiveTimeline().getEvents()].reverse().find((e) => e.getId()?.startsWith("$"));
  if (last) receipts.push(client.sendReadReceipt(last));
  for (const thread of room.getThreads()) {
    if (room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Total) === 0) continue;
    const lastInThread = [...thread.events].reverse().find((e) => e.getId()?.startsWith("$"));
    if (lastInThread) receipts.push(client.sendReadReceipt(lastInThread));
  }
  await Promise.allSettled(receipts);
}

export function teamUnread(client: MatrixClient, teamId: string): { unread: boolean; mentions: number } {
  const { channels, favorites, categories } = sidebarRooms(client, teamId);
  let unread = false;
  let mentions = 0;
  const dms = dmRoomIds(client);
  for (const r of [...channels, ...favorites, ...categories.flatMap((c) => c.rooms)]) {
    if (dms.has(r.roomId)) continue;
    const u = unreadInfo(r);
    unread ||= u.unread;
    mentions += u.mentions;
  }
  return { unread, mentions };
}
