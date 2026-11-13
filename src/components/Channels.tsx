import { useEffect, useState } from "react";
import { EventType, JoinRule, Preset, Visibility } from "matrix-js-sdk";
import type { ICreateRoomOpts, Room } from "matrix-js-sdk";
import { useClient } from "../matrix/hooks";
import { Avatar } from "./Avatar";
import { CloseIcon } from "./icons";

function serverOf(id: string) {
  return id.slice(id.indexOf(":") + 1);
}

/**
 * Create a channel. Mattermost semantics mapped to Matrix:
 *  - Public channel  → anyone in the team (space) can find and join it ("restricted" join rule),
 *                      or a public room when not in a space.
 *  - Private channel → invite only.
 */
export function CreateChannelDialog({
  space,
  onClose,
  onCreated,
}: {
  space: Room | null;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const client = useClient();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const encryption = { type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } };
      const opts: ICreateRoomOpts = { name: name.trim(), topic: topic.trim() || undefined, initial_state: [] };
      if (isPrivate) {
        Object.assign(opts, { preset: Preset.PrivateChat, visibility: Visibility.Private });
        opts.initial_state!.push(encryption);
      } else if (space) {
        Object.assign(opts, { preset: Preset.PrivateChat, visibility: Visibility.Private });
        opts.initial_state!.push(encryption, {
          type: EventType.RoomJoinRules,
          state_key: "",
          content: { join_rule: JoinRule.Restricted, allow: [{ type: "m.room_membership", room_id: space.roomId }] },
        });
      } else {
        Object.assign(opts, { preset: Preset.PublicChat, visibility: Visibility.Private });
      }
      if (space) {
        opts.initial_state!.push({
          type: EventType.SpaceParent,
          state_key: space.roomId,
          content: { via: [serverOf(client.getSafeUserId())], canonical: true },
        });
      }
      const { room_id } = await client.createRoom(opts);
      if (space) {
        try {
          await client.sendStateEvent(space.roomId, EventType.SpaceChild, { via: [serverOf(client.getSafeUserId())] }, room_id);
        } catch {
          setWarning(`Channel created, but you don't have permission to add it to “${space.name}”. A team admin can add it.`);
          onCreated(room_id);
          setBusy(false);
          return;
        }
      }
      onCreated(room_id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Create a new channel{space ? ` in ${space.name}` : ""}</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {warning ? (
          <>
            <p className="muted">{warning}</p>
            <div className="row end">
              <button className="btn-primary" onClick={onClose}>
                OK
              </button>
            </div>
          </>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create();
            }}
          >
            <label>
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. project-apollo" />
            </label>
            <div className="radio-cards">
              <button type="button" className={!isPrivate ? "on" : ""} onClick={() => setIsPrivate(false)}>
                <b># Public channel</b>
                <span className="muted small">{space ? `Anyone in ${space.name} can join` : "Anyone can find and join"}</span>
              </button>
              <button type="button" className={isPrivate ? "on" : ""} onClick={() => setIsPrivate(true)}>
                <b>🔒 Private channel</b>
                <span className="muted small">Only invited people can join</span>
              </button>
            </div>
            <label>
              Purpose <span className="muted">(optional)</span>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What's this channel about?" />
            </label>
            {error && <div className="error">{error}</div>}
            <div className="row end">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create channel"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface DirectoryRoom {
  roomId: string;
  name: string;
  topic?: string;
  members: number;
  avatar?: string;
  via?: string[];
}

/** Browse channels in this team (space hierarchy), or the server's public directory for Home. */
export function BrowseChannelsDialog({
  space,
  onClose,
  onJoined,
}: {
  space: Room | null;
  onClose: () => void;
  onJoined: (roomId: string) => void;
}) {
  const client = useClient();
  const [filter, setFilter] = useState("");
  const [rooms, setRooms] = useState<DirectoryRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setError(null);
      try {
        if (space) {
          const res = await client.getRoomHierarchy(space.roomId, 200, 3);
          const viaByRoom = new Map<string, string[]>();
          for (const r of res.rooms) {
            for (const child of r.children_state) viaByRoom.set(child.state_key, child.content.via ?? []);
          }
          const list = res.rooms
            .filter((r) => r.room_id !== space.roomId && r.room_type !== "m.space")
            .map((r) => ({
              roomId: r.room_id,
              name: r.name ?? r.canonical_alias ?? r.room_id,
              topic: r.topic,
              members: r.num_joined_members,
              avatar: r.avatar_url,
              via: viaByRoom.get(r.room_id),
            }));
          if (alive) setRooms(list);
        } else {
          const res = await client.publicRooms({ limit: 50, filter: filter.trim() ? { generic_search_term: filter.trim() } : undefined });
          if (alive)
            setRooms(
              res.chunk.map((r) => ({
                roomId: r.room_id,
                name: r.name ?? r.canonical_alias ?? r.room_id,
                topic: r.topic,
                members: r.num_joined_members,
                avatar: r.avatar_url,
              })),
            );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    const t = setTimeout(load, space ? 0 : 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [client, space, space ? "" : filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = filter.trim().toLowerCase();
  const shown = (rooms ?? []).filter((r) => !space || !f || r.name.toLowerCase().includes(f) || r.topic?.toLowerCase().includes(f));

  const join = async (r: DirectoryRoom) => {
    setJoining(r.roomId);
    setError(null);
    try {
      await client.joinRoom(r.roomId, { viaServers: r.via });
      onJoined(r.roomId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setJoining(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal people-modal browse-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Browse channels{space ? ` in ${space.name}` : ""}</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <input
          className="modal-search"
          autoFocus
          placeholder={space ? "Filter channels" : "Search public rooms on your server"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <div className="people-results">
          {rooms === null && !error && <div className="muted empty">Loading…</div>}
          {rooms !== null && shown.length === 0 && <div className="muted empty">No channels found.</div>}
          {shown.map((r) => {
            const joined = client.getRoom(r.roomId)?.getMyMembership() === "join";
            return (
              <div key={r.roomId} className="person-row browse-row">
                <Avatar mxc={r.avatar} name={r.name} id={r.roomId} size={32} square />
                <div className="person-text">
                  <div className="person-name">{r.name}</div>
                  <div className="muted small">
                    {r.members} members{r.topic ? ` · ${r.topic}` : ""}
                  </div>
                </div>
                {joined ? (
                  <button
                    className="btn-secondary small"
                    onClick={() => {
                      onJoined(r.roomId);
                      onClose();
                    }}
                  >
                    View
                  </button>
                ) : (
                  <button className="btn-primary small" disabled={!!joining} onClick={() => join(r)}>
                    {joining === r.roomId ? "Joining…" : "Join"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
