import { useEffect, useState } from "react";
import { NotificationCountType } from "matrix-js-sdk";
import type { MatrixClient, Room, Thread } from "matrix-js-sdk";
import { useClient, useClientTick } from "../matrix/hooks";
import { joinedRooms } from "../matrix/rooms";
import { formatDateSeparator, formatTime, stripReplyFallback } from "../util/format";
import { Avatar } from "./Avatar";
import { ThreadIcon } from "./icons";

/** Threads I started or replied to, across every channel. */
export function followedThreads(client: MatrixClient): { room: Room; thread: Thread }[] {
  const me = client.getUserId();
  const out: { room: Room; thread: Thread }[] = [];
  for (const room of joinedRooms(client)) {
    if (room.isSpaceRoom()) continue;
    for (const thread of room.getThreads()) {
      if (thread.hasCurrentUserParticipated || thread.rootEvent?.getSender() === me) out.push({ room, thread });
    }
  }
  const last = (t: Thread) => t.replyToEvent?.getTs() ?? t.rootEvent?.getTs() ?? 0;
  return out.sort((a, b) => last(b.thread) - last(a.thread));
}

export function threadUnread(room: Room, thread: Thread) {
  return {
    unread: room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Total) > 0,
    mentions: room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight),
  };
}

let fetchedOnce = false;

export function GlobalThreads({ onOpen }: { onOpen: (roomId: string, rootId: string) => void }) {
  const client = useClient();
  useClientTick();
  const [loading, setLoading] = useState(!fetchedOnce);
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Thread lists aren't part of sync; fetch them from each room (a few at a time).
  useEffect(() => {
    let alive = true;
    const rooms = joinedRooms(client).filter((r) => !r.isSpaceRoom());
    let i = 0;
    const worker = async () => {
      while (alive && i < rooms.length) {
        const r = rooms[i++];
        await r.fetchRoomThreads().catch(() => {});
      }
    };
    Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      fetchedOnce = true;
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [client]);

  const items = followedThreads(client).filter(({ room, thread }) => !unreadOnly || threadUnread(room, thread).unread);

  return (
    <section className="channel">
      <header className="channel-header">
        <div className="channel-title">
          <ThreadIcon />
          <span className="channel-name">Followed threads</span>
        </div>
        <div className="channel-actions">
          <div className="segmented">
            <button className={!unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(false)}>
              All
            </button>
            <button className={unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(true)}>
              Unreads
            </button>
          </div>
        </div>
      </header>
      <div className="global-threads">
        {loading && <div className="muted small loading-row">Loading threads from your channels…</div>}
        {!loading && items.length === 0 && (
          <div className="empty muted">{unreadOnly ? "No unread threads." : "Threads you start or reply to will show up here."}</div>
        )}
        {items.map(({ room, thread }) => {
          const root = thread.rootEvent!;
          const sender = root.sender;
          const { unread, mentions } = threadUnread(room, thread);
          const lastTs = thread.replyToEvent?.getTs() ?? root.getTs();
          const participants = [...new Set(thread.events.map((e) => e.getSender()!).filter(Boolean))].slice(0, 5);
          return (
            <button key={thread.id} className={`gt-item ${unread ? "unread" : ""}`} onClick={() => onOpen(room.roomId, thread.id)}>
              <div className="gt-head">
                <span className="gt-room">{room.name}</span>
                <span className="muted small">
                  {formatDateSeparator(lastTs)} {formatTime(lastTs)}
                </span>
                {mentions > 0 && <span className="badge gt-badge">{mentions}</span>}
                {unread && !mentions && <span className="gt-dot" />}
              </div>
              <div className="gt-author">
                <Avatar mxc={sender?.getMxcAvatarUrl()} name={sender?.name ?? "?"} id={root.getSender()!} size={20} />
                <b>{sender?.name ?? root.getSender()}</b>
              </div>
              <div className="gt-body">
                {root.isDecryptionFailure() ? "🔒 Encrypted message" : stripReplyFallback(String(root.getContent().body ?? ""))}
              </div>
              <div className="gt-meta muted small">
                <span className="thread-avatars">
                  {participants.map((id) => {
                    const m = room.getMember(id);
                    return <Avatar key={id} mxc={m?.getMxcAvatarUrl()} name={m?.name ?? id} id={id} size={18} />;
                  })}
                </span>
                {thread.length} {thread.length === 1 ? "reply" : "replies"}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
