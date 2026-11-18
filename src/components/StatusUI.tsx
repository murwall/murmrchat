import { useEffect, useRef, useState } from "react";
import { useClient } from "../matrix/hooks";
import {
  getMyChoice,
  presenceSupported,
  setAvailability,
  setCustomStatus,
  useUserStatus,
  type Availability,
  type CustomStatus,
} from "../matrix/status";
import { Avatar } from "./Avatar";
import { getNotificationPreviews, setNotificationPreviews } from "../matrix/notifications";
import { EmojiPopover } from "./EmojiPopover";
import { CloseIcon } from "./icons";

const LABEL: Record<Availability, string> = { online: "Online", away: "Away", dnd: "Do Not Disturb", offline: "Offline" };

export function PresenceDot({ availability, size = 10 }: { availability: Availability | null; size?: number }) {
  if (!availability) return null;
  return <span className={`presence-dot ${availability}`} style={{ width: size, height: size }} title={LABEL[availability]} />;
}

/** Avatar with a Mattermost-style status dot in the corner. */
export function AvatarWithStatus({
  userId,
  mxc,
  name,
  size,
}: {
  userId: string;
  mxc?: string | null;
  name: string;
  size: number;
}) {
  const client = useClient();
  const { availability } = useUserStatus(client, userId);
  return (
    <span className="avatar-status" style={{ width: size, height: size }}>
      <Avatar mxc={mxc} name={name} id={userId} size={size} />
      <PresenceDot availability={availability} size={Math.max(8, Math.round(size * 0.36))} />
    </span>
  );
}

/** Custom status emoji (with the text as tooltip), shown after a user's name. */
export function StatusEmoji({ userId, withText }: { userId: string; withText?: boolean }) {
  const client = useClient();
  const { custom } = useUserStatus(client, userId);
  if (!custom) return null;
  return (
    <span className="status-emoji" title={custom.text ?? ""}>
      {custom.emoji ?? "💬"}
      {withText && custom.text && <span className="status-text"> {custom.text}</span>}
    </span>
  );
}

const DND_DURATIONS: { label: string; ms: number | null }[] = [
  { label: "Don't clear", ms: null },
  { label: "30 minutes", ms: 30 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "2 hours", ms: 2 * 60 * 60_000 },
  { label: "Tomorrow", ms: -1 },
];

function untilTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** The "me" row in the sidebar header: avatar + status, opens the status menu. */
export function MyStatusMenu({ onEncryption, onLogout }: { onEncryption: () => void; onLogout: () => void }) {
  const client = useClient();
  const me = client.getSafeUserId();
  const user = client.getUser(me);
  const { availability, custom } = useUserStatus(client, me);
  const [open, setOpen] = useState(false);
  const [dndOpen, setDndOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { choice, dndUntil } = getMyChoice();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (a: Availability, until?: number) => {
    setOpen(false);
    setDndOpen(false);
    void setAvailability(client, a, until);
  };

  return (
    <div className="my-status" ref={ref}>
      <button className="me-btn" onClick={() => setOpen((o) => !o)}>
        <span className="avatar-status" style={{ width: 24, height: 24 }}>
          <Avatar mxc={user?.avatarUrl} name={user?.displayName ?? me} id={me} size={24} />
          <PresenceDot availability={availability} size={9} />
        </span>
        <span className="me-name">{user?.displayName ?? me}</span>
        {custom?.emoji && <span className="status-emoji">{custom.emoji}</span>}
      </button>
      {open && (
        <div className="status-menu">
          <div className="status-menu-head">
            <b>{user?.displayName ?? me}</b>
            <div className="muted small">{me}</div>
          </div>
          <button
            className="status-custom"
            onClick={() => {
              setOpen(false);
              setDialog(true);
            }}
          >
            <span className="status-emoji">{custom?.emoji ?? "🙂"}</span>
            <span className={custom ? "" : "muted"}>{custom?.text || (custom ? "" : "Set a custom status")}</span>
            {custom && (
              <span
                className="status-clear"
                title="Clear status"
                onClick={(e) => {
                  e.stopPropagation();
                  void setCustomStatus(client, null);
                }}
              >
                <CloseIcon />
              </span>
            )}
          </button>
          <div className="menu-sep" />
          {(["online", "away"] as Availability[]).map((a) => (
            <button key={a} className={`status-option ${choice === a ? "on" : ""}`} onClick={() => pick(a)}>
              <PresenceDot availability={a} /> {LABEL[a]}
            </button>
          ))}
          <div className="status-dnd" onMouseEnter={() => setDndOpen(true)} onMouseLeave={() => setDndOpen(false)}>
            <button className={`status-option ${choice === "dnd" ? "on" : ""}`} onClick={() => setDndOpen((o) => !o)}>
              <PresenceDot availability="dnd" /> {LABEL.dnd}
              {choice === "dnd" && dndUntil && (
                <span className="muted small"> · until {new Date(dndUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              )}
              <span className="submenu-arrow">›</span>
            </button>
            {dndOpen && (
              <div className="submenu">
                <div className="muted small submenu-title">Disable notifications until:</div>
                {DND_DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    onClick={() => pick("dnd", d.ms === null ? undefined : d.ms === -1 ? untilTomorrow() : Date.now() + d.ms)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={`status-option ${choice === "offline" ? "on" : ""}`} onClick={() => pick("offline")}>
            <PresenceDot availability="offline" /> {LABEL.offline}
          </button>
          {!presenceSupported() && (
            <div className="muted small status-note">Your server doesn't share online status, so others may not see this. DND still silences notifications here.</div>
          )}
          <div className="menu-sep" />
          <PreviewToggle />
          <button
            className="status-option"
            onClick={() => {
              setOpen(false);
              onEncryption();
            }}
          >
            Encryption…
          </button>
          <button
            className="status-option danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
      {dialog && <CustomStatusDialog current={custom} onClose={() => setDialog(false)} />}
    </div>
  );
}

function PreviewToggle() {
  const [on, setOn] = useState(getNotificationPreviews());
  return (
    <button
      className="status-option"
      title="Message text in notifications is visible in macOS Notification Center and on the lock screen"
      onClick={() => {
        setNotificationPreviews(!on);
        setOn(!on);
      }}
    >
      {on ? "☑" : "☐"} Show message text in notifications
    </button>
  );
}

const SUGGESTIONS: CustomStatus[] = [
  { emoji: "📅", text: "In a meeting" },
  { emoji: "🍔", text: "Out for lunch" },
  { emoji: "🤒", text: "Out sick" },
  { emoji: "🏠", text: "Working from home" },
  { emoji: "🌴", text: "On vacation" },
];

const CLEAR_AFTER: { label: string; at: () => number | undefined }[] = [
  { label: "Don't clear", at: () => undefined },
  { label: "30 minutes", at: () => Date.now() + 30 * 60_000 },
  { label: "1 hour", at: () => Date.now() + 60 * 60_000 },
  { label: "4 hours", at: () => Date.now() + 4 * 60 * 60_000 },
  {
    label: "Today",
    at: () => {
      const d = new Date();
      d.setHours(23, 59, 59, 0);
      return d.getTime();
    },
  },
  {
    label: "This week",
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
      d.setHours(23, 59, 59, 0);
      return d.getTime();
    },
  },
];

export function CustomStatusDialog({ current, onClose }: { current: CustomStatus | null; onClose: () => void }) {
  const client = useClient();
  const [emoji, setEmoji] = useState(current?.emoji ?? "");
  const [text, setText] = useState(current?.text ?? "");
  const [clearAfter, setClearAfter] = useState(0);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await setCustomStatus(client, text.trim() || emoji ? { emoji: emoji || "💬", text: text.trim(), expires_at: CLEAR_AFTER[clearAfter].at() } : null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Set a status</h2>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="status-input">
          <div className="emoji-anchor">
            <button className="status-emoji-btn" onClick={() => setPicker((p) => !p)} title="Choose emoji">
              {emoji || "🙂"}
            </button>
            {picker && (
              <EmojiPopover
                className="below-left"
                onPick={(e) => {
                  setEmoji(e);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            )}
          </div>
          <input
            autoFocus
            maxLength={100}
            placeholder="What's your status?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          {(text || emoji) && (
            <button
              className="icon-btn"
              title="Clear"
              onClick={() => {
                setText("");
                setEmoji("");
              }}
            >
              <CloseIcon />
            </button>
          )}
        </div>
        {!text && !emoji && (
          <div className="status-suggestions">
            <div className="muted small">Suggestions</div>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                onClick={() => {
                  setEmoji(s.emoji!);
                  setText(s.text!);
                }}
              >
                <span className="status-emoji">{s.emoji}</span> {s.text}
              </button>
            ))}
          </div>
        )}
        <label className="clear-after">
          Clear after
          <select value={clearAfter} onChange={(e) => setClearAfter(Number(e.target.value))}>
            {CLEAR_AFTER.map((c, i) => (
              <option key={c.label} value={i}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">Visible to other MurmrChat users. Element and other apps don't show custom statuses.</p>
        <div className="row end">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Set status"}
          </button>
        </div>
      </div>
    </div>
  );
}
