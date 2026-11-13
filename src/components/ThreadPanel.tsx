import { useCallback, useEffect } from "react";
import { Direction } from "matrix-js-sdk";
import type { Room } from "matrix-js-sdk";
import { useClient, useClientTick } from "../matrix/hooks";
import { formatTime, stripReplyFallback } from "../util/format";
import { Avatar } from "./Avatar";
import { Composer, useFileDropZone } from "./Composer";
import { DropOverlay } from "./DropOverlay";
import { CloseIcon } from "./icons";
import { Message } from "./Message";
import { MessageList } from "./MessageList";
import { BrokenMessage, ErrorBoundary } from "./ErrorBoundary";

interface ThreadProps {
  room: Room;
  rootId: string;
  onClose: () => void;
}

/** Right-hand panel showing one thread, like Mattermost's reply thread view. */
export function ThreadPanel({ room, rootId, onClose }: ThreadProps) {
  const client = useClient();
  useClientTick();
  const drop = useFileDropZone(room.roomId, rootId);

  const rootEvent = room.findEventById(rootId) ?? room.getThread(rootId)?.rootEvent;
  let thread = room.getThread(rootId);
  if (!thread && rootEvent) {
    thread = room.createThread(rootId, rootEvent, [], true);
  }

  // Mark the thread as read while it's open.
  const last = thread?.events.at(-1);
  useEffect(() => {
    if (last && last.getId()?.startsWith("$") && document.hasFocus()) {
      client.sendReadReceipt(last).catch(() => {});
    }
  }, [client, last]);

  const loadMore = useCallback(async () => {
    if (!thread) return false;
    const tl = thread.liveTimeline;
    if (!tl.getPaginationToken(Direction.Backward) && thread.initialEventsFetched) return false;
    return client.paginateEventTimeline(tl, { backwards: true, limit: 30 });
  }, [client, thread]);

  const replies = (thread?.events ?? []).filter((e) => e.getId() !== rootId);

  return (
    <aside className="right-panel drop-zone" {...drop.props}>
      {drop.over && <DropOverlay target="this thread" />}
      <header className="panel-header">
        <div>
          <div className="panel-title">Thread</div>
          <div className="panel-subtitle muted">{room.name}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
      </header>
      <MessageList
        room={room}
        events={replies}
        inThread
        loadMore={loadMore}
        header={
          rootEvent ? (
            <div className="thread-root">
              <ErrorBoundary fallback={() => <BrokenMessage />}>
                <Message ev={rootEvent} room={room} continuation={false} inThread />
              </ErrorBoundary>
              <div className="thread-divider">
                <span>
                  {replies.length} {replies.length === 1 ? "reply" : "replies"}
                </span>
              </div>
            </div>
          ) : null
        }
      />
      <Composer room={room} threadId={rootId} placeholder="Reply…" autoFocus />
    </aside>
  );
}

interface ListProps {
  room: Room;
  onOpenThread: (rootId: string) => void;
  onClose: () => void;
}

/** All threads in the current channel, most recently active first. */
export function ThreadListPanel({ room, onOpenThread, onClose }: ListProps) {
  useClientTick();

  useEffect(() => {
    room.fetchRoomThreads().catch(() => {});
  }, [room]);

  const threads = room
    .getThreads()
    .filter((t) => t.rootEvent)
    .sort((a, b) => (b.replyToEvent?.getTs() ?? 0) - (a.replyToEvent?.getTs() ?? 0));

  return (
    <aside className="right-panel">
      <header className="panel-header">
        <div>
          <div className="panel-title">Threads</div>
          <div className="panel-subtitle muted">{room.name}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="thread-list">
        {threads.length === 0 && <div className="empty muted">No threads in this channel yet.</div>}
        {threads.map((t) => {
          const root = t.rootEvent!;
          const sender = root.sender;
          const unread = room.getThreadUnreadNotificationCount(t.id) > 0;
          return (
            <button key={t.id} className={`thread-list-item ${unread ? "unread" : ""}`} onClick={() => onOpenThread(t.id)}>
              <div className="tli-head">
                <Avatar mxc={sender?.getMxcAvatarUrl()} name={sender?.name ?? "?"} id={root.getSender()!} size={20} />
                <b>{sender?.name ?? root.getSender()}</b>
                <span className="muted small">{formatTime(root.getTs())}</span>
              </div>
              <div className="tli-body">
                {root.isDecryptionFailure() ? "🔒 Encrypted message" : stripReplyFallback(String(root.getContent().body ?? ""))}
              </div>
              <div className="tli-meta muted small">
                {t.length} {t.length === 1 ? "reply" : "replies"}
                {t.replyToEvent && ` · last reply ${formatTime(t.replyToEvent.getTs())}`}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
