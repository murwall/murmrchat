import { useEffect, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { useClient, useClientTick, useNav } from "../matrix/hooks";
import { getPinnedIds, getSaved, togglePinned, toggleSaved, canPin } from "../matrix/saved";
import { formatDateSeparator, formatTime, linkify, sanitizeHtml, stripReplyFallback } from "../util/format";
import { Avatar } from "./Avatar";
import { BookmarkIcon, CloseIcon, PinIcon } from "./icons";
import { ErrorBoundary } from "./ErrorBoundary";

const fetched = new Map<string, Promise<MatrixEvent | null>>();

/** Get an event by ID even if it isn't in a loaded timeline (fetch + decrypt). */
export function loadEvent(client: MatrixClient, roomId: string, eventId: string): Promise<MatrixEvent | null> {
  const room = client.getRoom(roomId);
  const local = room?.findEventById(eventId);
  if (local) return Promise.resolve(local);
  let p = fetched.get(eventId);
  if (!p) {
    p = client
      .fetchRoomEvent(roomId, eventId)
      .then(async (raw) => {
        const ev = client.getEventMapper()({ ...raw, room_id: roomId } as never);
        if (ev.isEncrypted()) await client.decryptEventIfNeeded(ev);
        return ev;
      })
      .catch(() => null);
    fetched.set(eventId, p);
  }
  return p;
}

function useEvent(roomId: string, eventId: string) {
  const client = useClient();
  const [ev, setEv] = useState<MatrixEvent | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadEvent(client, roomId, eventId).then((e) => alive && setEv(e));
    return () => {
      alive = false;
    };
  }, [client, roomId, eventId]);
  return ev;
}

function PreviewRow({
  room,
  roomId,
  eventId,
  showChannel,
  action,
}: {
  room: Room | null;
  roomId: string;
  eventId: string;
  showChannel?: boolean;
  action: React.ReactNode;
}) {
  const nav = useNav();
  const ev = useEvent(roomId, eventId);
  if (ev === undefined) return <div className="preview-row muted small">Loading…</div>;
  if (ev === null || ev.isRedacted()) {
    return (
      <div className="preview-row muted small">
        Message not available (deleted, or no access). {action}
      </div>
    );
  }
  const sender = room?.getMember(ev.getSender()!) ?? null;
  const content = ev.getContent();
  const html = ev.isDecryptionFailure()
    ? "🔒 Encrypted message"
    : content.format === "org.matrix.custom.html" && content.formatted_body
      ? sanitizeHtml(content.formatted_body)
      : linkify(stripReplyFallback(String(content.body ?? "")));
  const threadId = ev.threadRootId && ev.threadRootId !== ev.getId() ? ev.threadRootId : undefined;
  return (
    <div className="preview-row">
      <div className="preview-head">
        {showChannel && <span className="gt-room">{room?.name ?? roomId}</span>}
        <span className="preview-actions">
          <button className="btn-link small" onClick={() => nav.jumpTo(roomId, eventId, threadId)}>
            Jump
          </button>
          {action}
        </span>
      </div>
      <div className="preview-author">
        <Avatar mxc={sender?.getMxcAvatarUrl()} name={sender?.name ?? ev.getSender()!} id={ev.getSender()!} size={24} />
        <b>{sender?.name ?? ev.getSender()}</b>
        <span className="muted small">
          {formatDateSeparator(ev.getTs())} {formatTime(ev.getTs())}
        </span>
      </div>
      <div className="post-body preview-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** Personal saved messages across all channels. */
export function SavedPanel({ onClose }: { onClose: () => void }) {
  const client = useClient();
  useClientTick();
  const items = getSaved(client);
  return (
    <aside className="right-panel">
      <header className="panel-header">
        <div>
          <div className="panel-title">Saved messages</div>
          <div className="panel-subtitle muted">Only visible to you</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="thread-list">
        {items.length === 0 && (
          <div className="empty muted">
            <BookmarkIcon />
            <p>No saved messages yet. Hover a message and choose “Save” to keep it here.</p>
          </div>
        )}
        {items.map((i) => (
          <ErrorBoundary key={i.eventId} fallback={() => <div className="preview-row muted small">⚠ Couldn't display this message.</div>}>
          <PreviewRow
            key={i.eventId}
            room={client.getRoom(i.roomId)}
            roomId={i.roomId}
            eventId={i.eventId}
            showChannel
            action={
              <button className="btn-link small danger-link" onClick={() => toggleSaved(client, i.roomId, i.eventId)}>
                Remove
              </button>
            }
          />
          </ErrorBoundary>
        ))}
      </div>
    </aside>
  );
}

/** Messages pinned in this channel (shared with everyone, same list as Element). */
export function PinnedPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  useClientTick();
  const ids = [...getPinnedIds(room)].reverse();
  const mayPin = canPin(room);
  return (
    <aside className="right-panel">
      <header className="panel-header">
        <div>
          <div className="panel-title">Pinned messages</div>
          <div className="panel-subtitle muted">{room.name}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="thread-list">
        {ids.length === 0 && (
          <div className="empty muted">
            <PinIcon />
            <p>No pinned messages. Pin important messages from the message menu so everyone in the channel can find them.</p>
          </div>
        )}
        {ids.map((id) => (
          <ErrorBoundary key={id} fallback={() => <div className="preview-row muted small">⚠ Couldn't display this message.</div>}>
          <PreviewRow
            key={id}
            room={room}
            roomId={room.roomId}
            eventId={id}
            action={
              mayPin ? (
                <button className="btn-link small danger-link" onClick={() => togglePinned(room, id)}>
                  Unpin
                </button>
              ) : null
            }
          />
          </ErrorBoundary>
        ))}
      </div>
    </aside>
  );
}
