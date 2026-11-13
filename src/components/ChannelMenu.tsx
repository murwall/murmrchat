import { useEffect, useState } from "react";
import { EventType } from "matrix-js-sdk";
import type { Room } from "matrix-js-sdk";
import { searchPeople, type PersonResult } from "../matrix/dm";
import { useClient } from "../matrix/hooks";
import { getRoomNotifLevel, setRoomNotifLevel } from "../matrix/notifSettings";
import { alertDialog, confirmDialog } from "../util/dialogs";
import { Avatar } from "./Avatar";
import { CloseIcon } from "./icons";

type Dialog = "rename" | "header" | "add-members" | null;

/** Dropdown under the channel name, like Mattermost's channel menu. */
export function ChannelMenu({ room, isDm, onClose }: { room: Room; isDm: boolean; onClose: () => void }) {
  const client = useClient();
  const me = client.getSafeUserId();
  const [dialog, setDialog] = useState<Dialog>(null);
  const state = room.currentState;
  const canRename = state.maySendStateEvent(EventType.RoomName, me);
  const canEditTopic = state.maySendStateEvent(EventType.RoomTopic, me);
  const canInvite = room.canInvite(me);
  const muted = getRoomNotifLevel(client, room.roomId) === "mute";

  useEffect(() => {
    if (dialog) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("click", close));
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [dialog, onClose]);

  const leave = async () => {
    onClose();
    const ok = await confirmDialog({
      title: isDm ? `Close conversation with ${room.name}?` : `Leave ${room.name}?`,
      message: room.getJoinRule() === "public" ? "You can rejoin later from Browse channels." : "You'll need a new invite to rejoin.",
      confirmLabel: isDm ? "Close" : "Leave",
      danger: true,
    });
    if (ok) await client.leave(room.roomId).catch((e) => alertDialog("Couldn't leave", (e as Error).message));
  };

  if (dialog === "rename") {
    return (
      <TextDialog
        title={isDm ? "Rename conversation" : "Rename channel"}
        label="Display name"
        initial={room.name}
        maxLength={64}
        onClose={onClose}
        onSave={(v) => client.setRoomName(room.roomId, v)}
      />
    );
  }
  if (dialog === "header") {
    const topic = (state.getStateEvents(EventType.RoomTopic, "")?.getContent().topic as string | undefined) ?? "";
    return (
      <TextDialog
        title="Edit channel header"
        label="Header"
        hint="Shown next to the channel name, e.g. a short description or useful links."
        initial={topic}
        multiline
        maxLength={1024}
        allowEmpty
        onClose={onClose}
        onSave={(v) => client.setRoomTopic(room.roomId, v)}
      />
    );
  }
  if (dialog === "add-members") return <AddMembersDialog room={room} onClose={onClose} />;

  return (
    <div className="channel-menu" onClick={(e) => e.stopPropagation()}>
      {canInvite && !isDm && <button onClick={() => setDialog("add-members")}>Add members</button>}
      {canEditTopic && <button onClick={() => setDialog("header")}>Edit channel header</button>}
      {canRename && <button onClick={() => setDialog("rename")}>{isDm ? "Rename conversation" : "Rename channel"}</button>}
      {!canRename && !canEditTopic && !isDm && (
        <div className="muted small menu-note">Only channel admins can rename this channel or edit its header.</div>
      )}
      <div className="menu-sep" />
      <button
        onClick={() => {
          onClose();
          void setRoomNotifLevel(client, room.roomId, muted ? "default" : "mute");
        }}
      >
        {muted ? "Unmute" : "Mute"} {isDm ? "conversation" : "channel"}
      </button>
      <button
        onClick={() => {
          onClose();
          void navigator.clipboard.writeText(room.getCanonicalAlias() ?? room.roomId);
        }}
      >
        Copy channel address
      </button>
      <div className="menu-sep" />
      <button className="danger" onClick={leave}>
        {isDm ? "Close conversation" : "Leave channel"}
      </button>
    </div>
  );
}

function TextDialog({
  title,
  label,
  hint,
  initial,
  multiline,
  maxLength,
  allowEmpty,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  hint?: string;
  initial: string;
  multiline?: boolean;
  maxLength: number;
  allowEmpty?: boolean;
  onClose: () => void;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!allowEmpty && !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(value.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            {label}
            {multiline ? (
              <textarea
                autoFocus
                rows={4}
                maxLength={maxLength}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
                }}
              />
            ) : (
              <input autoFocus maxLength={maxLength} value={value} onChange={(e) => setValue(e.target.value)} />
            )}
          </label>
          {hint && <p className="muted small">{hint}</p>}
          {error && <div className="error">{error}</div>}
          <div className="row end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || (!allowEmpty && !value.trim()) || value.trim() === initial.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddMembersDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const client = useClient();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [selected, setSelected] = useState<PersonResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      searchPeople(client, term).then((r) => {
        if (!alive) return;
        const inRoom = (id: string) => ["join", "invite"].includes(room.getMember(id)?.membership ?? "");
        setResults(r.filter((p) => !inRoom(p.userId)));
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [client, room, term]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const p of selected) {
      try {
        await client.invite(room.roomId, p.userId);
      } catch (e) {
        failed.push(`${p.displayName}: ${(e as Error).message}`);
      }
    }
    if (failed.length) {
      setError(failed.join("\n"));
      setBusy(false);
    } else onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal people-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add people to {room.name}</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {selected.length > 0 && (
          <div className="chips">
            {selected.map((p) => (
              <span key={p.userId} className="chip">
                {p.displayName}
                <button onClick={() => setSelected((s) => s.filter((x) => x.userId !== p.userId))}>×</button>
              </span>
            ))}
          </div>
        )}
        <input
          className="modal-search"
          autoFocus
          placeholder="Search for people by name or @user:server"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="people-results">
          {results
            .filter((p) => !selected.some((s) => s.userId === p.userId))
            .map((p) => (
              <button key={p.userId} className="person-row" onClick={() => setSelected((s) => [...s, p])}>
                <Avatar mxc={p.avatarUrl} name={p.displayName} id={p.userId} size={32} />
                <div className="person-text">
                  <div className="person-name">{p.displayName}</div>
                  <div className="muted small">{p.userId}</div>
                </div>
              </button>
            ))}
          {results.length === 0 && <div className="muted empty">{term.length < 2 ? "Type to search" : "No people found"}</div>}
        </div>
        {error && <div className="error" style={{ whiteSpace: "pre-line" }}>{error}</div>}
        <div className="row end">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !selected.length} onClick={add}>
            {busy ? "Adding…" : `Add${selected.length ? ` ${selected.length}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
