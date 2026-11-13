import { useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "matrix-js-sdk";
import { useClient } from "../matrix/hooks";
import { dmPartner, dmRoomIds, getTeams, joinedRooms, roomsInSpace, unreadInfo } from "../matrix/rooms";
import { Avatar } from "./Avatar";
import { HashIcon, LockIcon } from "./icons";

type Item =
  | { kind: "room"; room: Room; teamName: string | null; isDm: boolean; score: number }
  | { kind: "person"; userId: string; name: string; avatar?: string; score: number };

/** How well `name` matches `q`: 0 = no match, higher is better. */
function matchScore(name: string, q: string): number {
  const n = name.toLowerCase();
  if (!q) return 1;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  // Start of a word: "apollo" matches "project-apollo" / "Project Apollo".
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 60;
  if (n.includes(q)) return 40;
  // Letters in order ("prap" → "project-apollo").
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

interface Props {
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
  onOpenDm: (userId: string) => void;
}

/** Mattermost-style ⌘K switcher: jump to any channel or DM across all teams, or start a DM. */
export function QuickSwitcher({ onClose, onOpenRoom, onOpenDm }: Props) {
  const client = useClient();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Which team each room belongs to (for the label on the right).
  const teamOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of getTeams(client)) {
      for (const id of roomsInSpace(client, team)) if (!map.has(id)) map.set(id, team.name);
    }
    return map;
  }, [client]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase().replace(/^[#~@]/, "");
    const dms = dmRoomIds(client);
    const rooms: Item[] = joinedRooms(client)
      .filter((r) => !r.isSpaceRoom())
      .map((room) => {
        const isDm = dms.has(room.roomId);
        const partner = isDm ? dmPartner(client, room) : null;
        const score = Math.max(matchScore(room.name, q), partner ? matchScore(partner.userId, q) : 0);
        return { kind: "room" as const, room, isDm, teamName: isDm ? null : (teamOf.get(room.roomId) ?? null), score };
      })
      .filter((i) => i.score > 0);

    // Empty query: recent channels first. Otherwise best match, then unread, then recent.
    rooms.sort((a, b) => {
      const ra = (a as { room: Room }).room;
      const rb = (b as { room: Room }).room;
      if (q && b.score !== a.score) return b.score - a.score;
      const ua = Number(unreadInfo(ra).unread);
      const ub = Number(unreadInfo(rb).unread);
      if (q && ub !== ua) return ub - ua;
      return rb.getLastActiveTimestamp() - ra.getLastActiveTimestamp();
    });

    // People you share a room with but have no DM with yet.
    const people: Item[] = [];
    if (q.length >= 2) {
      const withDm = new Set(
        rooms.filter((i) => i.kind === "room" && i.isDm).map((i) => dmPartner(client, (i as { room: Room }).room)?.userId),
      );
      const seen = new Set<string>();
      for (const room of joinedRooms(client)) {
        for (const m of room.getJoinedMembers()) {
          if (m.userId === client.getUserId() || seen.has(m.userId) || withDm.has(m.userId)) continue;
          seen.add(m.userId);
          const score = Math.max(matchScore(m.name, q), matchScore(m.userId.slice(1), q));
          if (score > 0) people.push({ kind: "person", userId: m.userId, name: m.name, avatar: m.getMxcAvatarUrl(), score });
        }
      }
      people.sort((a, b) => b.score - a.score);
    }

    return [...rooms.slice(0, 30), ...people.slice(0, 8)];
  }, [client, query, teamOf]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".qs-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === "room") onOpenRoom(item.room.roomId);
    else onOpenDm(item.userId);
  };

  return (
    <div className="modal-backdrop qs-backdrop" onMouseDown={onClose}>
      <div className="modal quick-switcher" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qs-title">Find channels</div>
        <input
          className="modal-search"
          autoFocus
          placeholder="Type to find a channel or person"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey) || (e.key === "Tab" && !e.shiftKey)) {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey) || (e.key === "Tab" && e.shiftKey)) {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(items[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="qs-list" ref={listRef}>
          {!query && items.length > 0 && <div className="qs-section muted">Recent</div>}
          {items.length === 0 && <div className="muted empty">No matches for “{query}”</div>}
          {items.map((item, i) => {
            const isActive = i === active;
            const prev = items[i - 1];
            const header = item.kind === "person" && prev?.kind !== "person" ? <div className="qs-section muted">Start a conversation</div> : null;
            if (item.kind === "person") {
              return (
                <div key={item.userId}>
                  {header}
                  <button className={`qs-item ${isActive ? "active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(item)}>
                    <Avatar mxc={item.avatar} name={item.name} id={item.userId} size={20} />
                    <span className="qs-name">{item.name}</span>
                    <span className="muted small qs-sub">{item.userId}</span>
                  </button>
                </div>
              );
            }
            const { room, isDm, teamName } = item;
            const { unread, mentions } = unreadInfo(room);
            const partner = isDm ? dmPartner(client, room) : null;
            return (
              <button
                key={room.roomId}
                className={`qs-item ${isActive ? "active" : ""} ${unread ? "unread" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                {isDm ? (
                  <Avatar mxc={partner?.getMxcAvatarUrl() ?? room.getMxcAvatarUrl()} name={room.name} id={partner?.userId ?? room.roomId} size={20} />
                ) : (
                  <span className="qs-icon">{room.getJoinRule() === "public" ? <HashIcon /> : <LockIcon />}</span>
                )}
                <span className="qs-name">{room.name}</span>
                {isDm && partner && <span className="muted small qs-sub">{partner.userId}</span>}
                {mentions > 0 && <span className="badge qs-badge">{mentions}</span>}
                <span className="qs-team muted small">{teamName ?? (isDm ? "Direct message" : "Home")}</span>
              </button>
            );
          })}
        </div>
        <div className="qs-footer muted small">
          <b>↑↓</b> to navigate · <b>Enter</b> to select · <b>Esc</b> to close
        </div>
      </div>
    </div>
  );
}
