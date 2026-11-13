import { useEffect, useState } from "react";
import { EventType, MsgType, RelationType } from "matrix-js-sdk";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { useClient, useNav } from "../matrix/hooks";
import { useMediaUrl, type EncryptedFile } from "../matrix/media";
import { formatTime, linkify, sanitizeHtml, stripReplyFallback, userColor } from "../util/format";
import { Avatar } from "./Avatar";
import { EmojiPopover } from "./EmojiPopover";
import { requestEdit } from "./Composer";
import { BookmarkIcon, EditIcon, FileIcon, MoreIcon, PinIcon, ReplyIcon, SmileIcon, ThreadIcon, TrashIcon } from "./icons";
import { canPin, getPinnedIds, isSaved, togglePinned, toggleSaved } from "../matrix/saved";
import { AvatarWithStatus, StatusEmoji } from "./StatusUI";
import { requestUnlock } from "./SecurityBanner";
import { alertDialog, confirmDialog } from "../util/dialogs";

const QUICK_REACTIONS = ["👍", "✅", "😄"];

/** Event types we render as chat messages. */
export function isRenderable(ev: MatrixEvent): boolean {
  const t = ev.getType();
  if (t === EventType.RoomMessage || t === EventType.RoomMessageEncrypted || t === EventType.Sticker) {
    // Hide edits themselves; the original message shows the new content.
    return ev.getRelation()?.rel_type !== RelationType.Replace;
  }
  return t === EventType.RoomMember || t === EventType.RoomTopic || t === EventType.RoomName;
}

export function isSystemEvent(ev: MatrixEvent) {
  return ev.getType() === EventType.RoomMember || ev.getType() === EventType.RoomTopic || ev.getType() === EventType.RoomName;
}

interface Props {
  ev: MatrixEvent;
  room: Room;
  continuation: boolean;
  inThread?: boolean;
  onOpenThread?: (rootId: string) => void;
  highlight?: boolean;
}

export function Message({ ev, room, continuation, inThread, onOpenThread, highlight }: Props) {
  const client = useClient();
  const nav = useNav();
  const [picker, setPicker] = useState(false);
  const [more, setMore] = useState(false);

  if (isSystemEvent(ev)) return <SystemMessage ev={ev} room={room} />;

  const sender = ev.sender;
  const name = sender?.name ?? ev.getSender() ?? "Unknown";
  const senderId = ev.getSender() ?? "";
  const thread = !inThread && ev.isThreadRoot ? room.getThread(ev.getId()!) : null;
  const pending = ev.status !== null;
  const mine = senderId === client.getUserId();
  const mentionsMe = !mine && !!client.getPushActionsForEvent(ev)?.tweaks?.highlight;
  const editable =
    mine &&
    !ev.isRedacted() &&
    ev.getType() === EventType.RoomMessage &&
    [MsgType.Text, MsgType.Emote, MsgType.Notice].includes(ev.getContent().msgtype as MsgType);

  const eventId = ev.getId() ?? "";
  const saved = isSaved(client, eventId);
  const pinned = getPinnedIds(room).includes(eventId);
  const mayPin = canPin(room);

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Delete message?",
      message: "This deletes the message for everyone. It can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await client.redactEvent(room.roomId, ev.getId()!);
    } catch (e) {
      void alertDialog("Couldn't delete the message", (e as Error).message);
    }
  };

  const react = async (key: string) => {
    setPicker(false);
    const existing = findMyReaction(room, ev, key, client.getUserId());
    if (existing) {
      await client.redactEvent(room.roomId, existing.getId()!);
    } else {
      await client.sendEvent(room.roomId, EventType.Reaction, {
        "m.relates_to": { rel_type: RelationType.Annotation, event_id: ev.getId()!, key },
      });
    }
  };

  return (
    <div data-event-id={ev.getId()} className={`post ${continuation ? "continuation" : ""} ${pending ? "pending" : ""} ${highlight || mentionsMe ? "highlight" : ""} ${mine ? "mine" : ""}`}>
      <div className="post-gutter">
        {continuation ? (
          <span className="post-hover-time">{formatTime(ev.getTs())}</span>
        ) : (
          <button className="avatar-btn" onClick={(e) => nav.showProfile(senderId, { x: e.clientX, y: e.clientY })}>
            <AvatarWithStatus userId={senderId} mxc={sender?.getMxcAvatarUrl()} name={name} size={36} />
          </button>
        )}
      </div>
      <div className="post-main">
        {(pinned || saved) && (
          <div className="post-flags">
            {pinned && (
              <span className="post-flag pinned">
                <PinIcon /> Pinned
              </span>
            )}
            {saved && (
              <span className="post-flag saved">
                <BookmarkIcon filled /> Saved
              </span>
            )}
          </div>
        )}
        {(!continuation || pinned || saved) && (
          <div className="post-header">
            <button
              className="post-author"
              style={{ color: userColor(senderId) }}
              title={senderId}
              onClick={(e) => nav.showProfile(senderId, { x: e.clientX, y: e.clientY })}
            >
              {name}
            </button>
            <StatusEmoji userId={senderId} />
            <span className="post-time" title={new Date(ev.getTs()).toLocaleString()}>
              {formatTime(ev.getTs())}
            </span>
          </div>
        )}
        <ReplyQuote ev={ev} room={room} />
        <MessageBody ev={ev} />
        <Reactions ev={ev} room={room} onToggle={react} />
        {thread && thread.length > 0 && (
          <button className="thread-summary" onClick={() => onOpenThread?.(ev.getId()!)}>
            <ThreadIcon />
            <span className="thread-count">
              {thread.length} {thread.length === 1 ? "reply" : "replies"}
            </span>
            <ThreadParticipants room={room} rootId={ev.getId()!} />
            {thread.replyToEvent && (
              <span className="thread-last">Last reply {formatTime(thread.replyToEvent.getTs())}</span>
            )}
          </button>
        )}
      </div>

      {!pending && ev.getId()?.startsWith("$") && (
        <div className="post-actions">
          {QUICK_REACTIONS.map((k) => (
            <button key={k} className="action" title={`React ${k}`} onClick={() => react(k)}>
              {k}
            </button>
          ))}
          <button className="action" title="Add reaction" onClick={() => setPicker((p) => !p)}>
            <SmileIcon />
          </button>
          {!inThread && onOpenThread && (
            <button className="action" title="Reply in thread" onClick={() => onOpenThread(ev.getId()!)}>
              <ReplyIcon />
            </button>
          )}
          <button className={`action ${saved ? "active" : ""}`} title={saved ? "Remove from saved" : "Save"} onClick={() => toggleSaved(client, room.roomId, eventId)}>
            <BookmarkIcon filled={saved} />
          </button>
          <button className="action" title="More" onClick={() => setMore((m) => !m)}>
            <MoreIcon />
          </button>
          {more && (
            <MoreMenu onClose={() => setMore(false)}>
              <button onClick={() => toggleSaved(client, room.roomId, eventId)}>
                <BookmarkIcon filled={saved} /> {saved ? "Remove from saved" : "Save message"}
              </button>
              {mayPin && (
                <button onClick={() => togglePinned(room, eventId).catch((e) => alertDialog("Couldn't pin the message", e.message))}>
                  <PinIcon /> {pinned ? "Unpin from channel" : "Pin to channel"}
                </button>
              )}
              {!ev.isRedacted() && (
                <button onClick={() => navigator.clipboard.writeText(String(ev.getContent().body ?? ""))}>
                  <span className="menu-icon">⧉</span> Copy text
                </button>
              )}
              {editable && (
                <button onClick={() => requestEdit(room.roomId, eventId)}>
                  <EditIcon /> Edit
                </button>
              )}
              {mine && !ev.isRedacted() && (
                <button className="danger" onClick={remove}>
                  <TrashIcon /> Delete
                </button>
              )}
            </MoreMenu>
          )}
          {picker && <EmojiPopover className="below" onPick={react} onClose={() => setPicker(false)} />}
        </div>
      )}
    </div>
  );
}

function MessageBody({ ev }: { ev: MatrixEvent }) {
  const client = useClient();
  const nav = useNav();
  if (ev.isRedacted()) return <div className="post-body deleted">(message deleted)</div>;
  if (ev.isDecryptionFailure()) {
    return (
      <div className="post-body undecryptable" title={ev.decryptionFailureReason ?? undefined}>
        🔒 Unable to decrypt this message.{" "}
        <button className="btn-link inline-unlock" onClick={requestUnlock}>
          Unlock with Security Key
        </button>
      </div>
    );
  }
  if (ev.isBeingDecrypted() || ev.getType() === EventType.RoomMessageEncrypted) {
    return <div className="post-body muted">Decrypting…</div>;
  }

  const content = ev.getContent();
  const edited = !!ev.replacingEvent();
  const msgtype = content.msgtype as string | undefined;

  if (ev.getType() === EventType.Sticker || msgtype === MsgType.Image) {
    return <ImageBody content={content} />;
  }
  if (msgtype === MsgType.File || msgtype === MsgType.Video || msgtype === MsgType.Audio) {
    return <FileBody content={content} />;
  }

  const html =
    content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string"
      ? sanitizeHtml(content.formatted_body, { me: client.getUserId() })
      : linkify(stripReplyFallback(String(content.body ?? "")));

  return (
    <div className={`post-body ${msgtype === MsgType.Emote ? "emote" : ""} ${msgtype === MsgType.Notice ? "notice" : ""}`}>
      {msgtype === MsgType.Emote && <span className="emote-name">* {ev.sender?.name} </span>}
      <span
        className="post-text"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          // Mention pills open the profile card instead of the browser.
          const a = (e.target as HTMLElement).closest("a[data-mention]") as HTMLAnchorElement | null;
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          nav.showProfile(a.dataset.mention!, { x: e.clientX, y: e.clientY });
        }}
      />
      {edited && <span className="edited"> (edited)</span>}
    </div>
  );
}

/** Dropdown under the "⋯" button; closes on outside click, item click or Escape. */
function MoreMenu({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("click", close));
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return <div className="more-menu">{children}</div>;
}

function ImageBody({ content }: { content: Record<string, any> }) {
  const client = useClient();
  const info = content.info ?? {};
  const file = content.file as EncryptedFile | undefined;
  const src = file ? { file } : { mxc: content.url as string };
  const url = useMediaUrl(client, src, file ? undefined : { w: 800, h: 600, method: "scale" }, info.mimetype);
  const w = info.w ?? 400;
  const h = info.h ?? 300;
  const scale = Math.min(1, 400 / w, 300 / h);
  const [viewer, setViewer] = useState(false);
  return (
    <>
      <button className="post-image" style={{ width: Math.round(w * scale), height: Math.round(h * scale) }} onClick={() => url && setViewer(true)}>
        {url ? <img src={url} alt={content.body} /> : <div className="image-loading" />}
      </button>
      {viewer && url && <ImageViewer content={content} file={file} onClose={() => setViewer(false)} />}
    </>
  );
}

/** Full-size image viewer (click anywhere or Esc to close). */
function ImageViewer({ content, file, onClose }: { content: Record<string, any>; file?: EncryptedFile; onClose: () => void }) {
  const client = useClient();
  const full = useMediaUrl(client, file ? { file } : { mxc: content.url }, undefined, content.info?.mimetype);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="image-viewer" onClick={onClose}>
      {full ? <img src={full} alt={content.body} /> : <div className="muted">Loading…</div>}
      <div className="image-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span>{content.body}</span>
        {full && (
          <a href={full} download={content.body} className="btn-secondary">
            Download
          </a>
        )}
      </div>
    </div>
  );
}

function FileBody({ content }: { content: Record<string, any> }) {
  const client = useClient();
  const file = content.file as EncryptedFile | undefined;
  const info = content.info ?? {};
  const url = useMediaUrl(client, file ? { file } : { mxc: content.url }, undefined, info.mimetype);
  const size = info.size ? `${(info.size / 1024 / 1024).toFixed(info.size > 1024 * 1024 ? 1 : 2)} MB` : "";
  return (
    <a className="file-card" href={url ?? undefined} download={content.body}>
      <FileIcon />
      <div>
        <div className="file-name">{content.body}</div>
        <div className="file-meta muted">{[info.mimetype, size].filter(Boolean).join(" · ")}</div>
      </div>
    </a>
  );
}

function ReplyQuote({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const replyId = ev.replyEventId;
  // In threads, every reply points at the previous message as a fallback; don't show that.
  if (!replyId || ev.getContent()["m.relates_to"]?.is_falling_back) return null;
  const target = room.findEventById(replyId);
  const who = target?.sender?.name ?? target?.getSender() ?? "";
  const text = target ? stripReplyFallback(String(target.getContent().body ?? "")) : "Original message not loaded";
  return (
    <div className="reply-quote">
      {who && <b>{who}: </b>}
      {text.length > 160 ? `${text.slice(0, 160)}…` : text}
    </div>
  );
}

function getAnnotations(room: Room, ev: MatrixEvent) {
  const timelineSet = ev.getThread()?.timelineSet ?? room.getUnfilteredTimelineSet();
  return timelineSet.relations
    .getChildEventsForEvent(ev.getId()!, RelationType.Annotation, EventType.Reaction)
    ?.getSortedAnnotationsByKey();
}

function findMyReaction(room: Room, ev: MatrixEvent, key: string, me: string | null) {
  const groups = getAnnotations(room, ev);
  const set = groups?.find(([k]) => k === key)?.[1];
  return set ? [...set].find((r) => r.getSender() === me && !r.isRedacted()) : undefined;
}

function Reactions({ ev, room, onToggle }: { ev: MatrixEvent; room: Room; onToggle: (k: string) => void }) {
  const client = useClient();
  const groups = getAnnotations(room, ev);
  if (!groups?.length) return null;
  const me = client.getUserId();
  return (
    <div className="reactions">
      {groups.map(([key, events]) => {
        const live = [...events].filter((e) => !e.isRedacted());
        if (!live.length) return null;
        const mine = live.some((e) => e.getSender() === me);
        const names = live.map((e) => e.sender?.name ?? e.getSender()).join(", ");
        return (
          <button key={key} className={`reaction ${mine ? "mine" : ""}`} title={names} onClick={() => onToggle(key)}>
            <span>{key}</span> <span className="reaction-count">{live.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThreadParticipants({ room, rootId }: { room: Room; rootId: string }) {
  const thread = room.getThread(rootId);
  if (!thread) return null;
  const ids = [...new Set(thread.events.map((e) => e.getSender()!).filter(Boolean))].slice(0, 4);
  return (
    <span className="thread-avatars">
      {ids.map((id) => {
        const m = room.getMember(id);
        return <Avatar key={id} mxc={m?.getMxcAvatarUrl()} name={m?.name ?? id} id={id} size={18} />;
      })}
    </span>
  );
}

function SystemMessage({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const who = ev.sender?.name ?? ev.getSender();
  const c = ev.getContent();
  const prev = ev.getPrevContent();
  let text: string | null = null;
  switch (ev.getType()) {
    case EventType.RoomMember: {
      const target = c.displayname ?? ev.getStateKey();
      if (c.membership === "join" && prev.membership === "join") {
        if (c.displayname !== prev.displayname) text = `${prev.displayname ?? ev.getStateKey()} is now ${c.displayname}`;
        else text = null; // avatar change etc.
      } else if (c.membership === "join") text = `${target} joined the channel`;
      else if (c.membership === "leave") text = ev.getSender() === ev.getStateKey() ? `${prev.displayname ?? target} left the channel` : `${who} removed ${prev.displayname ?? target}`;
      else if (c.membership === "invite") text = `${who} invited ${target}`;
      else if (c.membership === "ban") text = `${who} banned ${prev.displayname ?? target}`;
      break;
    }
    case EventType.RoomTopic:
      text = `${who} updated the channel header to: ${c.topic ?? ""}`;
      break;
    case EventType.RoomName:
      text = `${who} renamed the channel to ${c.name ?? room.name}`;
      break;
  }
  if (!text) return null;
  return (
    <div className="post system">
      <div className="post-gutter" />
      <div className="post-main muted">{text}</div>
    </div>
  );
}
