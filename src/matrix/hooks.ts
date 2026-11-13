import { createContext, useContext, useEffect, useState } from "react";
import {
  ClientEvent,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  ThreadEvent,
} from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";

export const ClientContext = createContext<MatrixClient | null>(null);

export function useClient(): MatrixClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("No Matrix client");
  return c;
}

const WATCHED = [
  ClientEvent.Room,
  ClientEvent.DeleteRoom,
  ClientEvent.AccountData,
  RoomEvent.Timeline,
  RoomEvent.TimelineReset,
  RoomEvent.Name,
  RoomEvent.MyMembership,
  RoomEvent.Receipt,
  RoomEvent.Tags,
  RoomEvent.UnreadNotifications,
  RoomEvent.LocalEchoUpdated,
  RoomEvent.Redaction,
  RoomStateEvent.Events,
  RoomMemberEvent.Membership,
  RoomMemberEvent.Typing,
  MatrixEventEvent.Decrypted,
  MatrixEventEvent.Replaced,
  MatrixEventEvent.RelationsCreated,
  ThreadEvent.New,
  ThreadEvent.Update,
  ThreadEvent.NewReply,
] as const;

/**
 * Re-render whenever anything relevant changes in the client.
 * Coarse but simple: updates are batched to one render per animation frame.
 */
export function useClientTick(): number {
  const client = useClient();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let scheduled = false;
    const bump = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        setTick((t) => t + 1);
      });
    };
    // The SDK's typed emitter can't express "any of these events"; use the untyped view.
    const emitter = client as unknown as { on(e: string, f: () => void): void; off(e: string, f: () => void): void };
    for (const ev of WATCHED) emitter.on(ev, bump);
    return () => {
      for (const ev of WATCHED) emitter.off(ev, bump);
    };
  }, [client]);
  return tick;
}

export interface Nav {
  /** Switch the center view to a room (DMs are visible in every team). */
  openRoom: (roomId: string) => void;
  /** Open (or create) a DM with a user and switch to it. */
  openDm: (userId: string) => Promise<void>;
  /** Open the channel at a specific message (or its thread). */
  jumpTo: (roomId: string, eventId: string, threadId?: string) => void;
  /** Show a person's profile card near the given screen position. */
  showProfile: (userId: string, pos: { x: number; y: number }) => void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error("No navigation context");
  return n;
}
