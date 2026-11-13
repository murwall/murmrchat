import { useCallback, useEffect, useState } from "react";
import { Direction } from "matrix-js-sdk";
import type { EventTimeline, Room } from "matrix-js-sdk";
import { useClient, useClientTick } from "../matrix/hooks";
import { dmPartner, isDm } from "../matrix/rooms";
import { Avatar } from "./Avatar";
import { Composer, useFileDropZone } from "./Composer";
import { DropOverlay } from "./DropOverlay";
import { BellIcon, BellOffIcon, HashIcon, LockIcon, PinIcon, ShieldIcon, ThreadIcon, UsersIcon } from "./icons";
import { getPinnedIds } from "../matrix/saved";
import { getRoomNotifLevel, setRoomNotifLevel, type RoomNotifLevel } from "../matrix/notifSettings";
import { MessageList } from "./MessageList";
import { ChannelMenu } from "./ChannelMenu";
import { alertDialog } from "../util/dialogs";

interface Props {
  room: Room;
  onOpenThread: (rootId: string) => void;
  onShowThreads: () => void;
  threadsOpen: boolean;
  membersOpen: boolean;
  onShowMembers: () => void;
  /** Show the conversation around this (possibly old) message, e.g. from search. */
  focusEventId?: string | null;
  onClearFocus?: () => void;
  pinnedOpen: boolean;
  onShowPinned: () => void;
}

export function ChannelView({
  room,
  onOpenThread,
  onShowThreads,
  threadsOpen,
  membersOpen,
  onShowMembers,
  focusEventId,
  onClearFocus,
  pinnedOpen,
  onShowPinned,
}: Props) {
  const client = useClient();
  useClientTick();
  const drop = useFileDropZone(room.roomId);

  // When jumping to an old message, show a timeline around it instead of the live one.
  const [focusTl, setFocusTl] = useState<EventTimeline | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [, force] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setFocusTl(null);
    setFocusError(null);
    if (!focusEventId) return;
    if (room.getLiveTimeline().getEvents().some((e) => e.getId() === focusEventId)) return;
    client
      .getEventTimeline(room.getUnfilteredTimelineSet(), focusEventId)
      .then((tl) => setFocusTl(tl ?? null))
      .catch((e) => setFocusError((e as Error).message));
  }, [client, room, focusEventId]);

  const viewingHistory = !!focusTl && focusTl !== room.getLiveTimeline();
  const timeline = viewingHistory ? focusTl! : room.getLiveTimeline();
  const events = timeline.getEvents();
  const hasNewer = viewingHistory && !!focusTl!.getPaginationToken(Direction.Forward);
  const dm = isDm(client, room);
  const partner = dm ? dmPartner(client, room) : null;
  const encrypted = room.hasEncryptionStateEvent();
  const topic = room.currentState.getStateEvents("m.room.topic", "")?.getContent().topic as string | undefined;

  // Mark as read when viewing the latest message.
  const last = events.at(-1);
  useEffect(() => {
    if (!last?.getId()?.startsWith("$")) return;
    const markRead = () => {
      if (document.hasFocus()) client.sendReadReceipt(last).catch(() => {});
    };
    markRead();
    window.addEventListener("focus", markRead);
    return () => window.removeEventListener("focus", markRead);
  }, [client, last]);

  const loadMore = useCallback(async () => {
    if (viewingHistory) {
      return client.paginateEventTimeline(timeline, { backwards: true, limit: 30 });
    }
    await client.scrollback(room, 30);
    return room.getLiveTimeline().getPaginationToken(Direction.Backward) !== null;
  }, [client, room, timeline, viewingHistory]);

  const loadNewer = async () => {
    await client.paginateEventTimeline(timeline, { backwards: false, limit: 50 });
    force((n) => n + 1);
  };

  return (
    <section className="channel drop-zone" {...drop.props}>
      {drop.over && <DropOverlay target={room.name} />}
      <header className="channel-header">
        <div className="channel-title">
          {dm ? (
            <Avatar mxc={partner?.getMxcAvatarUrl()} name={room.name} id={partner?.userId ?? room.roomId} size={24} />
          ) : room.getJoinRule() === "public" ? (
            <HashIcon />
          ) : (
            <LockIcon />
          )}
          <div className="channel-name-anchor">
            <button className="channel-name channel-name-btn" onClick={() => setMenuOpen((o) => !o)} title="Channel options">
              {room.name} <span className="caret">▾</span>
            </button>
            {menuOpen && <ChannelMenu room={room} isDm={dm} onClose={() => setMenuOpen(false)} />}
          </div>
          <FavoriteStar room={room} />
          {encrypted && (
            <span className="e2ee" title="End-to-end encrypted">
              <ShieldIcon />
            </span>
          )}
        </div>
        {topic ? (
          <div className="channel-topic" title={topic}>
            {topic}
          </div>
        ) : (
          <div className="channel-topic" />
        )}
        <div className="channel-actions">
          <NotifLevelButton room={room} isDm={dm} />
          <button className={`icon-btn ${pinnedOpen ? "active" : ""}`} onClick={onShowPinned} title="Pinned messages">
            <PinIcon /> {getPinnedIds(room).length || ""}
          </button>
          <button className={`icon-btn ${membersOpen ? "active" : ""}`} onClick={onShowMembers} title="Members">
            <UsersIcon /> {room.getJoinedMemberCount()}
          </button>
          <button className={`icon-btn ${threadsOpen ? "active" : ""}`} onClick={onShowThreads} title="Threads in this channel">
            <ThreadIcon /> Threads
          </button>
        </div>
      </header>

      {(viewingHistory || focusError) && (
        <div className="history-bar">
          {focusError ? `Couldn't load that message: ${focusError}` : "You're viewing older messages."}
          <button className="btn-link" onClick={onClearFocus}>
            Jump to recent messages
          </button>
        </div>
      )}
      <MessageList
        key={viewingHistory ? "history" : "live"}
        room={room}
        events={events}
        onOpenThread={onOpenThread}
        loadMore={loadMore}
        highlightId={focusEventId ?? undefined}
        footer={
          hasNewer ? (
            <button className="load-newer" onClick={loadNewer}>
              Load newer messages
            </button>
          ) : null
        }
        header={
          <div className="channel-intro">
            <h2>{dm ? room.name : `Beginning of ${room.name}`}</h2>
            {topic && <p className="muted">{topic}</p>}
          </div>
        }
      />
      <Composer room={room} placeholder={dm ? `Write to ${room.name}` : `Write to ~${room.name}`} autoFocus />
    </section>
  );
}

const LEVELS: { level: RoomNotifLevel; label: string; hint: string }[] = [
  { level: "default", label: "Default", hint: "Use your account's notification settings" },
  { level: "all", label: "All new messages", hint: "Notify for every message" },
  { level: "mentions", label: "Mentions only", hint: "Only @mentions and keywords" },
  { level: "mute", label: "Mute", hint: "No notifications, never shown as unread" },
];

/** Bell in the channel header: per-channel notification preference (synced with Element via push rules). */
function NotifLevelButton({ room, isDm }: { room: Room; isDm: boolean }) {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const level = getRoomNotifLevel(client, room.roomId);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    setTimeout(() => window.addEventListener("click", close));
    return () => window.removeEventListener("click", close);
  }, [open]);

  const choose = async (l: RoomNotifLevel) => {
    setBusy(true);
    try {
      await setRoomNotifLevel(client, room.roomId, l);
    } catch (e) {
      void alertDialog("Couldn't change notifications", (e as Error).message);
    } finally {
      setBusy(false);
      force((n) => n + 1);
    }
  };

  return (
    <div className="notif-anchor">
      <button
        className={`icon-btn ${level === "mute" ? "is-muted" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={`Notifications: ${LEVELS.find((l) => l.level === level)?.label}`}
        disabled={busy}
      >
        {level === "mute" ? <BellOffIcon /> : <BellIcon />}
        {level !== "default" && <span className="notif-level-label">{level === "mute" ? "Muted" : level === "all" ? "All" : "Mentions"}</span>}
      </button>
      {open && (
        <div className="notif-menu" onClick={(e) => e.stopPropagation()}>
          <div className="menu-label">{isDm ? "Notify me about this conversation" : "Notify me about this channel"}</div>
          {LEVELS.map((l) => (
            <button
              key={l.level}
              className={level === l.level ? "on" : ""}
              onClick={() => {
                setOpen(false);
                void choose(l.level);
              }}
            >
              <span className="radio">{level === l.level ? "●" : "○"}</span>
              <span>
                <b>{l.label}</b>
                <span className="muted small"> {l.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** ☆ next to the channel name: toggles Favorites (the standard m.favourite tag, shared with Element). */
function FavoriteStar({ room }: { room: Room }) {
  const client = useClient();
  const [pending, setPending] = useState<boolean | null>(null);
  const isFav = pending ?? !!room.tags["m.favourite"];
  useEffect(() => setPending(null), [room.tags]);
  return (
    <button
      className={`fav-star ${isFav ? "on" : ""}`}
      title={isFav ? "Remove from Favorites" : "Add to Favorites"}
      onClick={async () => {
        setPending(!isFav);
        try {
          if (isFav) await client.deleteRoomTag(room.roomId, "m.favourite");
          else await client.setRoomTag(room.roomId, "m.favourite", {});
        } catch (e) {
          setPending(null);
          void alertDialog("Couldn't update Favorites", (e as Error).message);
        }
      }}
    >
      {isFav ? "★" : "☆"}
    </button>
  );
}
