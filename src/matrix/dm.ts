import { ClientEvent, EventType, KnownMembership, Preset, Visibility } from "matrix-js-sdk";
import type { MatrixClient, Room } from "matrix-js-sdk";

/** Find an existing 1:1 DM with this user that we're still in. */
export function findDm(client: MatrixClient, userId: string): Room | null {
  const direct = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as Record<string, string[]>;
  const candidates = (direct[userId] ?? [])
    .map((id) => client.getRoom(id))
    .filter((r): r is Room => !!r && r.getMyMembership() === KnownMembership.Join)
    .filter((r) => {
      const m = r.getMember(userId)?.membership;
      return m === KnownMembership.Join || m === KnownMembership.Invite;
    });
  // Prefer the most recently active one.
  candidates.sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  return candidates[0] ?? null;
}

/** Open the DM with a user, creating an encrypted one if none exists. Returns the room ID. */
export async function openDm(client: MatrixClient, userId: string): Promise<string> {
  const existing = findDm(client, userId);
  if (existing) return existing.roomId;

  const { room_id } = await client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
    visibility: Visibility.Private,
    initial_state: [{ type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
  });

  // Record it in m.direct so every client treats it as a DM.
  const direct = { ...((client.getAccountData(EventType.Direct)?.getContent() ?? {}) as Record<string, string[]>) };
  direct[userId] = [...(direct[userId] ?? []), room_id];
  await client.setAccountData(EventType.Direct, direct);

  // Wait until the room shows up in sync so the UI can render it.
  if (!client.getRoom(room_id)) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (client.getRoom(room_id)) {
          client.off(ClientEvent.Room, check);
          resolve();
        }
      };
      client.on(ClientEvent.Room, check);
      setTimeout(() => {
        client.off(ClientEvent.Room, check);
        resolve();
      }, 10000);
    });
  }
  return room_id;
}

export interface PersonResult {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

/**
 * Search people: the server's user directory plus anyone we share a room with.
 * (matrix.org's directory only returns users who share a room with you or are in public rooms.)
 */
export async function searchPeople(client: MatrixClient, term: string): Promise<PersonResult[]> {
  const q = term.trim().toLowerCase();
  const results = new Map<string, PersonResult>();

  // Local first: people in our rooms.
  for (const room of client.getRooms()) {
    for (const m of room.getJoinedMembers()) {
      if (m.userId === client.getUserId() || results.has(m.userId)) continue;
      if (!q || m.name.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q)) {
        results.set(m.userId, { userId: m.userId, displayName: m.name, avatarUrl: m.getMxcAvatarUrl() });
      }
    }
  }

  if (q.length >= 2) {
    try {
      const res = await client.searchUserDirectory({ term: q, limit: 30 });
      for (const u of res.results) {
        if (u.user_id === client.getUserId()) continue;
        if (!results.has(u.user_id)) {
          results.set(u.user_id, { userId: u.user_id, displayName: u.display_name ?? u.user_id, avatarUrl: u.avatar_url });
        }
      }
    } catch {
      /* directory search not available */
    }
    // A full Matrix ID that isn't found anywhere: still allow messaging it.
    if (/^@[^:]+:.+/.test(term.trim()) && !results.has(term.trim())) {
      try {
        const p = await client.getProfileInfo(term.trim());
        results.set(term.trim(), { userId: term.trim(), displayName: p.displayname ?? term.trim(), avatarUrl: p.avatar_url });
      } catch {
        /* unknown user */
      }
    }
  }

  return [...results.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, 50);
}
