import { useEffect, useState } from "react";
import type { Room } from "matrix-js-sdk";
import {
  createCategory,
  deleteCategory,
  getCategories,
  moveCategory,
  moveRoomToCategory,
  renameCategory,
  setCategoryCollapsed,
  type Category,
} from "../matrix/categories";
import { useClient, useClientTick } from "../matrix/hooks";
import { getRoomNotifLevel, setRoomNotifLevel } from "../matrix/notifSettings";
import { dmPartner, dmRoomIds, HOME_TEAM, invitedRooms, markRoomRead, sidebarRooms, unreadInfo } from "../matrix/rooms";
import { Avatar } from "./Avatar";
import { followedThreads, threadUnread } from "./GlobalThreads";
import { BellOffIcon, HashIcon, LockIcon, ThreadIcon } from "./icons";
import { requestUnlock } from "./SecurityBanner";
import { AvatarWithStatus, MyStatusMenu, StatusEmoji } from "./StatusUI";
import { confirmDialog } from "../util/dialogs";

interface Props {
  teamId: string;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onLogout: () => void;
  onFindPeople: () => void;
  threadsActive: boolean;
  onShowThreads: () => void;
  onCreateChannel: () => void;
  onBrowseChannels: () => void;
}

/** Section key for drag-and-drop targets: a category id, or one of the built-in sections. */
type SectionKey = string;
const FAVORITES = "__favorites";
const CHANNELS = "__channels";
const DMS = "__dms";
const DRAG_TYPE = "application/x-murmrchat-room";

export function Sidebar({
  teamId,
  selectedRoomId,
  onSelectRoom,
  onLogout,
  onFindPeople,
  threadsActive,
  onShowThreads,
  onCreateChannel,
  onBrowseChannels,
}: Props) {
  const client = useClient();
  useClientTick();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  const [filter, setFilter] = useState("");
  const [addMenu, setAddMenu] = useState(false);
  const [dropTarget, setDropTarget] = useState<SectionKey | null>(null);
  const [newCategoryFor, setNewCategoryFor] = useState<{ roomId?: string } | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);

  const team = teamId === HOME_TEAM ? null : client.getRoom(teamId);
  const { channels, dms, favorites, categories } = sidebarRooms(client, teamId);
  const invites = invitedRooms(client);
  const allDmIds = dmRoomIds(client);
  const threadInfo = followedThreads(client).reduce(
    (acc, { room, thread }) => {
      const u = threadUnread(room, thread);
      return { unread: acc.unread || u.unread, mentions: acc.mentions + u.mentions };
    },
    { unread: false, mentions: 0 },
  );

  const visible = (r: Room) => {
    if (filter && !r.name.toLowerCase().includes(filter.toLowerCase())) return false;
    if (unreadsOnly && !unreadInfo(r).unread && r.roomId !== selectedRoomId) return false;
    return true;
  };

  /** Move a room into a section (drag-and-drop or "Move to" menu). */
  const moveRoom = async (roomId: string, target: SectionKey) => {
    const room = client.getRoom(roomId);
    if (!room) return;
    const isFav = !!room.tags["m.favourite"];
    if (target === FAVORITES) {
      if (!isFav) await client.setRoomTag(roomId, "m.favourite", {});
      await moveRoomToCategory(client, teamId, roomId, null);
      return;
    }
    if (isFav) await client.deleteRoomTag(roomId, "m.favourite");
    await moveRoomToCategory(client, teamId, roomId, target === CHANNELS || target === DMS ? null : target);
  };

  const dropProps = (key: SectionKey) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: React.DragEvent) => {
      const roomId = e.dataTransfer.getData(DRAG_TYPE);
      setDropTarget(null);
      if (roomId) {
        e.preventDefault();
        void moveRoom(roomId, key);
      }
    },
  });

  const renderSection = (opts: {
    key: SectionKey;
    title: string;
    rooms: Room[];
    isDmSection?: boolean;
    onAdd?: () => void;
    category?: Category;
    alwaysShow?: boolean;
  }) => {
    const { key, title, rooms, isDmSection, onAdd, category, alwaysShow } = opts;
    const shown = rooms.filter(visible);
    if (!shown.length && !alwaysShow && !category && (filter || unreadsOnly)) return null;
    if (!shown.length && !alwaysShow && !category && !onAdd) return null;
    const isCollapsed = category ? !!category.collapsed : !!collapsed[key];
    const toggle = () =>
      category ? void setCategoryCollapsed(client, teamId, category.id, !category.collapsed) : setCollapsed((c) => ({ ...c, [key]: !c[key] }));
    return (
      <div key={key} className={`sidebar-section ${dropTarget === key ? "drop-target" : ""}`} {...dropProps(key)}>
        <div className="section-title-row">
          <button className="section-title" onClick={toggle}>
            <span className={`chevron ${isCollapsed ? "collapsed" : ""}`}>▾</span>
            {title}
          </button>
          {category && <CategoryMenu category={category} teamId={teamId} onRename={() => setRenaming(category)} isFirst={categories[0]?.category.id === category.id} isLast={categories.at(-1)?.category.id === category.id} />}
          {onAdd && (
            <button className="section-add" onClick={onAdd} title={`Add ${title.toLowerCase()}`}>
              +
            </button>
          )}
        </div>
        {key === CHANNELS && addMenu && (
          <div className="add-menu" onMouseLeave={() => setAddMenu(false)}>
            <button
              onClick={() => {
                setAddMenu(false);
                onBrowseChannels();
              }}
            >
              Browse channels
            </button>
            <button
              onClick={() => {
                setAddMenu(false);
                onCreateChannel();
              }}
            >
              Create new channel
            </button>
            <button
              onClick={() => {
                setAddMenu(false);
                setNewCategoryFor({});
              }}
            >
              Create new category
            </button>
          </div>
        )}
        {shown
          .filter((r) => !isCollapsed || unreadInfo(r).unread || r.roomId === selectedRoomId)
          .map((r) => (
            <RoomItem
              key={r.roomId}
              room={r}
              isDm={isDmSection || allDmIds.has(r.roomId)}
              active={r.roomId === selectedRoomId}
              onClick={() => onSelectRoom(r.roomId)}
              teamId={teamId}
              categories={getCategories(client, teamId)}
              onMove={(target) => void moveRoom(r.roomId, target)}
              onNewCategory={() => setNewCategoryFor({ roomId: r.roomId })}
            />
          ))}
        {!shown.length && !isCollapsed && (
          <div className="sidebar-empty">{category ? "Drag channels here" : isDmSection ? "No conversations" : "No channels"}</div>
        )}
      </div>
    );
  };


  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="team-name">{team?.name ?? "Home"}</div>
        <MyStatusMenu onSecurityKey={requestUnlock} onLogout={onLogout} />
      </header>

      <div className="sidebar-tools">
        <input className="sidebar-filter" placeholder="Filter channels" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          className={`unreads-toggle ${unreadsOnly ? "on" : ""}`}
          onClick={() => setUnreadsOnly((v) => !v)}
          title="Show only unread channels"
        >
          Unreads
        </button>
      </div>

      <div className="sidebar-scroll">
        <button className={`room-item nav-item ${threadsActive ? "active" : ""} ${threadInfo.unread ? "unread" : ""}`} onClick={onShowThreads}>
          <span className="room-icon">
            <ThreadIcon />
          </span>
          <span className="room-name">Threads</span>
          {threadInfo.mentions > 0 && <span className="badge">{threadInfo.mentions}</span>}
        </button>
        {invites.length > 0 && (
          <div className="sidebar-section">
            <div className="section-title static">Invitations</div>
            {invites.map((r) => (
              <div key={r.roomId} className="invite">
                <span className="invite-name">{r.name}</span>
                <button className="btn-mini" onClick={() => client.joinRoom(r.roomId).then(() => onSelectRoom(r.roomId))}>
                  Join
                </button>
                <button className="btn-mini secondary" onClick={() => client.leave(r.roomId)}>
                  Decline
                </button>
              </div>
            ))}
          </div>
        )}
        {renderSection({ key: FAVORITES, title: "Favorites", rooms: favorites, alwaysShow: dropTarget !== null })}
        {categories.map(({ category, rooms }) => renderSection({ key: category.id, title: category.name, rooms, category }))}
        {renderSection({ key: CHANNELS, title: "Channels", rooms: channels, onAdd: () => setAddMenu((m) => !m), alwaysShow: true })}
        {renderSection({ key: DMS, title: "Direct Messages", rooms: dms, isDmSection: true, onAdd: onFindPeople })}
      </div>

      {newCategoryFor && (
        <NameDialog
          title="Create a new category"
          confirm="Create"
          onClose={() => setNewCategoryFor(null)}
          onSubmit={async (name) => {
            const room = newCategoryFor.roomId ? client.getRoom(newCategoryFor.roomId) : null;
            if (room?.tags["m.favourite"]) await client.deleteRoomTag(room.roomId, "m.favourite");
            await createCategory(client, teamId, name, newCategoryFor.roomId);
          }}
        />
      )}
      {renaming && (
        <NameDialog
          title="Rename category"
          confirm="Rename"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => renameCategory(client, teamId, renaming.id, name)}
        />
      )}
    </aside>
  );
}

function RoomItem({
  room,
  isDm,
  active,
  onClick,
  categories,
  onMove,
  onNewCategory,
}: {
  room: Room;
  isDm: boolean;
  active: boolean;
  onClick: () => void;
  teamId: string;
  categories: Category[];
  onMove: (target: SectionKey) => void;
  onNewCategory: () => void;
}) {
  const client = useClient();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isFavorite = !!room.tags["m.favourite"];
  const level = getRoomNotifLevel(client, room.roomId);
  const muted = level === "mute";
  const { unread, mentions } = unreadInfo(room);
  const partner = isDm ? dmPartner(client, room) : null;
  const isPrivate = room.getJoinRule() !== "public";

  return (
    <>
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, room.roomId);
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`room-item ${active ? "active" : ""} ${unread ? "unread" : ""} ${muted ? "muted-room" : ""}`}
        onClick={onClick}
      >
        {isDm && partner ? (
          <AvatarWithStatus userId={partner.userId} mxc={partner.getMxcAvatarUrl()} name={room.name} size={20} />
        ) : isDm ? (
          <Avatar mxc={room.getMxcAvatarUrl()} name={room.name} id={room.roomId} size={20} />
        ) : (
          <span className="room-icon">{isPrivate ? <LockIcon /> : <HashIcon />}</span>
        )}
        <span className="room-name">{room.name}</span>
        {isDm && partner && <StatusEmoji userId={partner.userId} />}
        {muted && (
          <span className="muted-icon" title="Muted">
            <BellOffIcon />
          </span>
        )}
        {mentions > 0 && <span className="badge">{mentions}</span>}
      </button>
      {menu && (
        <ContextMenu pos={menu} onClose={() => setMenu(null)}>
          <button onClick={() => markRoomRead(client, room)}>Mark as read</button>
          <button onClick={() => setRoomNotifLevel(client, room.roomId, muted ? "default" : "mute")}>
            {muted ? (isDm ? "Unmute conversation" : "Unmute channel") : isDm ? "Mute conversation" : "Mute channel"}
          </button>
          <div className="menu-sep" />
          <div className="menu-label">Move to…</div>
          <button disabled={isFavorite} onClick={() => onMove(FAVORITES)}>
            ⭐ Favorites
          </button>
          {categories.map((c) => (
            <button key={c.id} disabled={c.roomIds.includes(room.roomId) && !isFavorite} onClick={() => onMove(c.id)}>
              📁 {c.name}
            </button>
          ))}
          <button onClick={() => onMove(isDm ? DMS : CHANNELS)}>{isDm ? "Direct Messages" : "Channels"}</button>
          <button onClick={onNewCategory}>＋ New category…</button>
          <div className="menu-sep" />
          <button
            className="danger"
            onClick={() => {
              void confirmDialog({
                title: isDm ? `Close conversation with ${room.name}?` : `Leave ${room.name}?`,
                message: isDm
                  ? "You'll leave this direct message room."
                  : room.getJoinRule() === "public"
                    ? "You can rejoin later from Browse channels."
                    : "This is a private channel. You'll need a new invite to rejoin.",
                confirmLabel: isDm ? "Close" : "Leave",
                danger: true,
              }).then((ok) => {
                if (ok) void client.leave(room.roomId);
              });
            }}
          >
            {isDm ? "Close conversation" : "Leave channel"}
          </button>
        </ContextMenu>
      )}
    </>
  );
}

function CategoryMenu({
  category,
  teamId,
  onRename,
  isFirst,
  isLast,
}: {
  category: Category;
  teamId: string;
  onRename: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const client = useClient();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button className="section-add" title="Category options" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
        ⋯
      </button>
      {menu && (
        <ContextMenu pos={menu} onClose={() => setMenu(null)}>
          <button onClick={onRename}>Rename category</button>
          <button disabled={isFirst} onClick={() => moveCategory(client, teamId, category.id, -1)}>
            Move up
          </button>
          <button disabled={isLast} onClick={() => moveCategory(client, teamId, category.id, 1)}>
            Move down
          </button>
          <div className="menu-sep" />
          <button
            className="danger"
            onClick={() => {
              void confirmDialog({
                title: `Delete the category “${category.name}”?`,
                message: "Its channels move back to Channels.",
                confirmLabel: "Delete category",
                danger: true,
              }).then((ok) => {
                if (ok) void deleteCategory(client, teamId, category.id);
              });
            }}
          >
            Delete category
          </button>
        </ContextMenu>
      )}
    </>
  );
}

function NameDialog({
  title,
  confirm: confirmLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  confirm: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              await onSubmit(name.trim());
              onClose();
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <label>
            Name
            <input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Projects" />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="row end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || !name.trim()}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Small right-click menu; closes on any click or Escape. */
export function ContextMenu({ pos, onClose, children }: { pos: { x: number; y: number }; onClose: () => void; children: React.ReactNode }) {
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
  return (
    <div className="context-menu" style={{ left: Math.min(pos.x, window.innerWidth - 220), top: Math.min(pos.y, window.innerHeight - 380) }}>
      {children}
    </div>
  );
}
