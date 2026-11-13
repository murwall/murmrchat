import { useEffect, useState } from "react";
import { ClientEvent, SetPresence, UserEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, User } from "matrix-js-sdk";

/**
 * Mattermost-style availability + custom status on Matrix.
 *
 *  - Availability (online / away / dnd / offline) uses Matrix presence where the server supports it.
 *    Presence has no "do not disturb", so DND is published as "unavailable" plus our profile field.
 *  - Custom status (emoji + text + expiry) is stored in a custom profile field (MSC4133, Matrix 1.16),
 *    so other Matterix users can see it. Other clients ignore it.
 */

export type Availability = "online" | "away" | "dnd" | "offline";

export interface CustomStatus {
  emoji?: string;
  text?: string;
  /** ms timestamp; absent = don't clear */
  expires_at?: number;
  /** Manually chosen availability (published so others see DND even without presence). */
  availability?: Availability;
  dnd_until?: number;
}

export const STATUS_FIELD = "io.matterix.status";
const MY_PREFS = "io.matterix.availability"; // account data: what I chose, so it survives restarts

const AWAY_AFTER_MS = 5 * 60 * 1000;

// ---------- presence support detection ----------

let presenceSeen = false;

/** True once the server has sent any real presence for someone else (matrix.org has presence disabled). */
export function presenceSupported(): boolean {
  return presenceSeen;
}

function presenceToAvailability(user: User | null | undefined): Availability | null {
  if (!user || !presenceSeen) return null;
  if (user.presence === "online") return "online";
  if (user.presence === "unavailable") return "away";
  return "offline";
}

// ---------- custom status cache (other users) ----------

const statusCache = new Map<string, { value: CustomStatus | null; fetched: number }>();
const inflight = new Map<string, Promise<CustomStatus | null>>();
const listeners = new Set<() => void>();
const STATUS_TTL = 5 * 60 * 1000;

function notify() {
  for (const l of listeners) l();
}

function isExpired(s: CustomStatus | null | undefined): boolean {
  return !!s?.expires_at && s.expires_at < Date.now();
}

export function activeCustomStatus(s: CustomStatus | null | undefined): CustomStatus | null {
  if (!s || isExpired(s)) return null;
  if (!s.emoji && !s.text) return null;
  return s;
}

async function fetchStatus(client: MatrixClient, userId: string): Promise<CustomStatus | null> {
  const existing = inflight.get(userId);
  if (existing) return existing;
  const p = client
    .getExtendedProfileProperty(userId, STATUS_FIELD)
    .then((v) => (v && typeof v === "object" ? (v as CustomStatus) : null))
    .catch(() => null)
    .then((value) => {
      statusCache.set(userId, { value, fetched: Date.now() });
      inflight.delete(userId);
      notify();
      return value;
    });
  inflight.set(userId, p);
  return p;
}

export function getCachedStatus(client: MatrixClient, userId: string): CustomStatus | null {
  const hit = statusCache.get(userId);
  if (!hit || Date.now() - hit.fetched > STATUS_TTL) void fetchStatus(client, userId);
  return hit?.value ?? null;
}

/** Availability + custom status for a user; re-renders when either changes. */
export function useUserStatus(client: MatrixClient, userId: string | null | undefined) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!userId) return { availability: null as Availability | null, custom: null as CustomStatus | null };
  const raw = userId === client.getUserId() ? myStatus : getCachedStatus(client, userId);
  const custom = activeCustomStatus(raw);
  // A user's own published DND/away choice wins over raw presence.
  const manual = raw?.availability && raw.availability !== "online" && !isExpired(raw) ? raw.availability : null;
  const dndActive = manual === "dnd" && (!raw?.dnd_until || raw.dnd_until > Date.now());
  const availability: Availability | null =
    userId === client.getUserId()
      ? myAvailability
      : dndActive
        ? "dnd"
        : (presenceToAvailability(client.getUser(userId)) ?? (manual === "away" ? "away" : null));
  return { availability, custom };
}

// ---------- my own status ----------

let myStatus: CustomStatus | null = null;
let myChoice: Availability = "online"; // what the user picked
let myAvailability: Availability = "online"; // effective (includes auto-away)
let dndUntil: number | undefined;

export function isDndActive(): boolean {
  return myChoice === "dnd" && (!dndUntil || dndUntil > Date.now());
}

export function getMyChoice(): { choice: Availability; dndUntil?: number; custom: CustomStatus | null } {
  return { choice: myChoice, dndUntil, custom: activeCustomStatus(myStatus) };
}

async function publish(client: MatrixClient, presenceOnly = false) {
  const presence: SetPresence =
    myAvailability === "online" ? SetPresence.Online : myAvailability === "offline" ? SetPresence.Offline : SetPresence.Unavailable;
  await client.setSyncPresence(presence).catch(() => {});
  await client
    .setPresence({ presence, status_msg: activeCustomStatus(myStatus)?.text ?? "" })
    .catch(() => {}); // presence disabled on server: fine
  if (presenceOnly) return notify();
  const value: CustomStatus = {
    ...(activeCustomStatus(myStatus) ?? {}),
    availability: myChoice,
    ...(myChoice === "dnd" && dndUntil ? { dnd_until: dndUntil } : {}),
  };
  await client.setExtendedProfileProperty(STATUS_FIELD, value).catch((e) => console.warn("Could not publish status", e));
  notify();
}

export async function setAvailability(client: MatrixClient, choice: Availability, until?: number) {
  myChoice = choice;
  dndUntil = choice === "dnd" ? until : undefined;
  myAvailability = choice;
  await client.setAccountData(MY_PREFS as never, { choice, dndUntil } as never).catch(() => {});
  await publish(client);
}

export async function setCustomStatus(client: MatrixClient, status: CustomStatus | null) {
  myStatus = status && (status.emoji || status.text) ? status : null;
  await publish(client);
}

/** Restore my choice, watch presence and idleness. Returns a cleanup function. */
export function startStatus(client: MatrixClient): () => void {
  const saved = client.getAccountData(MY_PREFS as never)?.getContent() as { choice?: Availability; dndUntil?: number } | undefined;
  if (saved?.choice) {
    myChoice = saved.choice;
    dndUntil = saved.dndUntil;
    if (myChoice === "dnd" && dndUntil && dndUntil < Date.now()) myChoice = "online";
  }
  myAvailability = myChoice;

  // Load my own custom status from the profile.
  client
    .getExtendedProfileProperty(client.getSafeUserId(), STATUS_FIELD)
    .then((v) => {
      myStatus = v && typeof v === "object" ? (v as CustomStatus) : null;
      if (isExpired(myStatus)) myStatus = null;
      notify();
    })
    .catch(() => {});

  void publish(client);

  const onPresence = (_ev: MatrixEvent | undefined, user: User) => {
    if (user.userId !== client.getUserId() && (user.presence !== "offline" || user.lastPresenceTs > 0)) {
      if (!presenceSeen) {
        presenceSeen = true;
      }
      notify();
    }
  };
  client.on(UserEvent.Presence, onPresence);

  // Auto-away after 5 minutes without input, like Mattermost (only when "online" was chosen).
  let lastInput = Date.now();
  const onInput = () => {
    lastInput = Date.now();
    if (myChoice === "online" && myAvailability === "away") {
      myAvailability = "online";
      void publish(client, true);
    }
  };
  const events = ["mousemove", "keydown", "mousedown", "wheel"];
  for (const e of events) window.addEventListener(e, onInput, { passive: true });
  const timer = window.setInterval(() => {
    if (myChoice === "online" && myAvailability === "online" && Date.now() - lastInput > AWAY_AFTER_MS) {
      myAvailability = "away";
      void publish(client, true);
    }
    // Expire timed DND / custom status.
    if (myChoice === "dnd" && dndUntil && dndUntil < Date.now()) void setAvailability(client, "online");
    if (myStatus && isExpired(myStatus)) void setCustomStatus(client, null);
  }, 30_000);

  // Re-fetch others' statuses occasionally.
  const refresh = window.setInterval(() => {
    for (const id of statusCache.keys()) void fetchStatus(client, id);
  }, STATUS_TTL);

  // Account data from another device (e.g. DND set elsewhere).
  const onAccountData = (ev: MatrixEvent) => {
    if (ev.getType() !== MY_PREFS) return;
    const c = ev.getContent() as { choice?: Availability; dndUntil?: number };
    if (c.choice && c.choice !== myChoice) {
      myChoice = c.choice;
      dndUntil = c.dndUntil;
      myAvailability = myChoice;
      notify();
    }
  };
  client.on(ClientEvent.AccountData, onAccountData);

  return () => {
    client.off(UserEvent.Presence, onPresence);
    client.off(ClientEvent.AccountData, onAccountData);
    for (const e of events) window.removeEventListener(e, onInput);
    clearInterval(timer);
    clearInterval(refresh);
  };
}
