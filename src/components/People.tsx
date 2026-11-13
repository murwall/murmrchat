import { useEffect, useRef, useState } from "react";
import type { Room, RoomMember } from "matrix-js-sdk";
import { searchPeople, type PersonResult } from "../matrix/dm";
import { useClient, useClientTick, useNav } from "../matrix/hooks";
import { Avatar } from "./Avatar";
import { CloseIcon } from "./icons";
import { AvatarWithStatus, StatusEmoji } from "./StatusUI";
import { useUserStatus } from "../matrix/status";

const AVAILABILITY_LABEL = { online: "Online", away: "Away", dnd: "Do Not Disturb", offline: "Offline" } as const;

function ProfileStatus({ userId }: { userId: string }) {
  const client = useClient();
  const { availability, custom } = useUserStatus(client, userId);
  if (!availability && !custom) return null;
  return (
    <div className="profile-status">
      {custom && (
        <div className="profile-custom">
          <span className="status-emoji">{custom.emoji}</span> {custom.text}
          {custom.expires_at && (
            <span className="muted small"> · until {new Date(custom.expires_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
          )}
        </div>
      )}
      {availability && <div className={`profile-availability ${availability}`}>{AVAILABILITY_LABEL[availability]}</div>}
    </div>
  );
}

/** Popover with a person's name, ID and a "Message" button, like Mattermost's profile popover. */
export function ProfileCard({ userId, pos, onClose }: { userId: string; pos: { x: number; y: number }; onClose: () => void }) {
  const client = useClient();
  const nav = useNav();
  const ref = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<{ name: string; avatar?: string } | null>(() => {
    const u = client.getUser(userId);
    return u ? { name: u.displayName ?? userId, avatar: u.avatarUrl } : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMe = userId === client.getUserId();

  useEffect(() => {
    client
      .getProfileInfo(userId)
      .then((p) => setProfile({ name: p.displayname ?? userId, avatar: p.avatar_url }))
      .catch(() => setProfile((cur) => cur ?? { name: userId }));
  }, [client, userId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", onDown));
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the card on screen.
  const left = Math.min(pos.x, window.innerWidth - 300);
  const top = Math.min(pos.y, window.innerHeight - 260);

  const message = async () => {
    setBusy(true);
    setError(null);
    try {
      await nav.openDm(userId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="profile-card" ref={ref} style={{ left, top }}>
      <AvatarWithStatus userId={userId} mxc={profile?.avatar} name={profile?.name ?? userId} size={72} />
      <div className="profile-name">{profile?.name ?? userId}</div>
      <div className="profile-id muted">{userId}</div>
      <ProfileStatus userId={userId} />
      {!isMe && (
        <button className="btn-primary" disabled={busy} onClick={message}>
          {busy ? "Opening…" : "Message"}
        </button>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** "Find people" dialog: search the directory and start a DM. */
export function PeopleDialog({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const nav = useNav();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      searchPeople(client, term).then((r) => {
        if (!alive) return;
        setResults(r);
        setActive(0);
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [client, term]);

  const choose = async (p: PersonResult) => {
    setBusy(p.userId);
    setError(null);
    try {
      await nav.openDm(p.userId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal people-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Direct Messages</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <input
          className="modal-search"
          autoFocus
          placeholder="Search for people by name or @user:server"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) choose(results[active]);
            else if (e.key === "Escape") onClose();
          }}
        />
        {error && <div className="error">{error}</div>}
        <div className="people-results">
          {results.length === 0 && <div className="muted empty">{term.length < 2 ? "Type to search" : "No people found"}</div>}
          {results.map((p, i) => (
            <button
              key={p.userId}
              className={`person-row ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              disabled={!!busy}
            >
              <Avatar mxc={p.avatarUrl} name={p.displayName} id={p.userId} size={32} />
              <div className="person-text">
                <div className="person-name">{p.displayName}</div>
                <div className="muted small">{p.userId}</div>
              </div>
              {busy === p.userId && <span className="muted small">Opening…</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const ROLE = (pl: number) => (pl >= 100 ? "Admin" : pl >= 50 ? "Moderator" : null);

/** Right-hand "Members" panel for the current channel. */
export function MembersPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const client = useClient();
  const nav = useNav();
  useClientTick();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    // Rooms are lazy-loaded; make sure we have the full member list.
    room.loadMembersIfNeeded().catch(() => {});
  }, [room]);

  const f = filter.trim().toLowerCase();
  const matches = (m: RoomMember) => !f || m.name.toLowerCase().includes(f) || m.userId.toLowerCase().includes(f);
  const sort = (a: RoomMember, b: RoomMember) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name);
  const joined = room.getJoinedMembers().filter(matches).sort(sort);
  const invited = room.getMembersWithMembership("invite").filter(matches).sort(sort);

  const row = (m: RoomMember) => {
    const role = ROLE(m.powerLevel);
    return (
      <button key={m.userId} className="person-row" onClick={(e) => nav.showProfile(m.userId, { x: e.clientX - 300, y: e.clientY })}>
        <AvatarWithStatus userId={m.userId} mxc={m.getMxcAvatarUrl()} name={m.name} size={32} />
        <div className="person-text">
          <div className="person-name">
            {m.name} <StatusEmoji userId={m.userId} />
            {m.userId === client.getUserId() && <span className="muted"> (you)</span>}
          </div>
          <div className="muted small">{m.userId}</div>
        </div>
        {role && <span className="role-tag">{role}</span>}
      </button>
    );
  };

  return (
    <aside className="right-panel">
      <header className="panel-header">
        <div>
          <div className="panel-title">Members</div>
          <div className="panel-subtitle muted">
            {room.name} · {room.getJoinedMemberCount()} members
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="panel-search">
        <input placeholder="Search members" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="members-list">
        {joined.map(row)}
        {invited.length > 0 && (
          <>
            <div className="members-section muted">Invited</div>
            {invited.map(row)}
          </>
        )}
      </div>
    </aside>
  );
}
