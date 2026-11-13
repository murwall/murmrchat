import { useEffect, useRef, useState } from "react";
import { EventType, MsgType, RelationType } from "matrix-js-sdk";
import type { MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import { useClient } from "../matrix/hooks";
import { sendFile } from "../matrix/upload";
import { escapeHtml, markdownToHtml } from "../util/format";
import { Avatar } from "./Avatar";
import { EmojiPopover, SHORTCODES } from "./EmojiPopover";
import { CloseIcon, PaperclipIcon, SendIcon, SmileIcon } from "./icons";

interface Props {
  room: Room;
  threadId?: string;
  placeholder: string;
  autoFocus?: boolean;
}

/** Fired by a message's "Edit" action; the matching composer switches to edit mode. */
export const EDIT_EVENT = "matterix:edit";
export function requestEdit(roomId: string, eventId: string) {
  window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail: { roomId, eventId } }));
}

/** Files dropped anywhere on a channel or thread are handed to that view's composer. */
const DROP_EVENT = "matterix:drop-files";

/** Props to spread on a container (channel or thread panel) to make it a file drop zone. */
export function useFileDropZone(roomId: string, threadId?: string) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  return {
    over,
    props: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) window.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: { roomId, threadId, files } }));
      },
    },
  };
}

type Suggestion =
  | { kind: "member"; member: RoomMember }
  | { kind: "emoji"; code: string; emoji: string };

const drafts = new Map<string, string>();

function typingText(room: Room, me: string | null): string | null {
  const names = room.getMembers().filter((m) => m.typing && m.userId !== me).map((m) => m.name);
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

/** Is this a plain/formatted text message I can edit? */
function isEditable(ev: MatrixEvent, me: string | null) {
  return (
    ev.getSender() === me &&
    ev.getType() === EventType.RoomMessage &&
    !ev.isRedacted() &&
    !ev.isRelation(RelationType.Replace) &&
    [MsgType.Text, MsgType.Emote, MsgType.Notice].includes(ev.getContent().msgtype as MsgType)
  );
}

export function Composer({ room, threadId, placeholder, autoFocus }: Props) {
  const client = useClient();
  const draftKey = `${room.roomId}|${threadId ?? ""}`;
  const [text, setText] = useState(() => drafts.get(draftKey) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MatrixEvent | null>(null);
  const [mentions, setMentions] = useState<Map<string, string>>(new Map()); // display name -> user id
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);

  useEffect(() => {
    setText(drafts.get(draftKey) ?? "");
    setError(null);
    setEditing(null);
    setMentions(new Map());
    if (autoFocus) ref.current?.focus();
  }, [draftKey, autoFocus]);

  // Auto-grow up to a max height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [text]);

  // "Edit" from a message's hover menu.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const { roomId, eventId } = (e as CustomEvent).detail;
      if (roomId !== room.roomId) return;
      const ev = room.findEventById(eventId);
      if (!ev) return;
      const evThread = ev.threadRootId && ev.threadRootId !== ev.getId() ? ev.threadRootId : undefined;
      if (evThread !== threadId) return;
      startEditing(ev);
    };
    window.addEventListener(EDIT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_EVENT, onEdit);
  });

  // Files dropped on our channel/thread view.
  useEffect(() => {
    const onDrop = (e: Event) => {
      const d = (e as CustomEvent).detail as { roomId: string; threadId?: string; files: File[] };
      if (d.roomId === room.roomId && d.threadId === threadId) upload(d.files);
    };
    window.addEventListener(DROP_EVENT, onDrop);
    return () => window.removeEventListener(DROP_EVENT, onDrop);
  });

  // Stop "typing…" when leaving.
  useEffect(() => {
    return () => {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        client.sendTyping(room.roomId, false, 0).catch(() => {});
      }
    };
  }, [client, room.roomId]);

  const startEditing = (ev: MatrixEvent) => {
    setEditing(ev);
    setText(String(ev.getContent().body ?? ""));
    setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  const cancelEditing = () => {
    setEditing(null);
    setText(drafts.get(draftKey) ?? "");
  };

  const update = (v: string) => {
    setText(v);
    if (!editing) drafts.set(draftKey, v);
    updateSuggestions(v);
    signalTyping(v);
  };

  const signalTyping = (v: string) => {
    if (editing) return;
    if (!v) {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = null;
      client.sendTyping(room.roomId, false, 0).catch(() => {});
      return;
    }
    if (!typingTimer.current) client.sendTyping(room.roomId, true, 5000).catch(() => {});
    else clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      typingTimer.current = null;
    }, 4000);
  };

  const updateSuggestions = (v: string) => {
    const caret = ref.current?.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const at = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (at) {
      const q = at[1].toLowerCase();
      const members = room
        .getJoinedMembers()
        .filter((m) => m.userId !== client.getUserId())
        .filter((m) => m.name.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
        .slice(0, 8);
      setSuggestions(members.map((member) => ({ kind: "member", member })));
      setActiveSuggestion(0);
      return;
    }
    const colon = before.match(/(?:^|\s):([a-z0-9_+-]{2,})$/i);
    if (colon) {
      const q = colon[1].toLowerCase();
      const hits = SHORTCODES.filter(([code]) => code.startsWith(q)).slice(0, 8);
      setSuggestions(hits.map(([code, emoji]) => ({ kind: "emoji", code, emoji })));
      setActiveSuggestion(0);
      return;
    }
    setSuggestions([]);
  };

  const applySuggestion = (s: Suggestion) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    let replaced: string;
    if (s.kind === "member") {
      replaced = before.replace(/@([^\s@]*)$/, `${s.member.name} `);
      setMentions((m) => new Map(m).set(s.member.name, s.member.userId));
    } else {
      replaced = before.replace(/:([a-z0-9_+-]*)$/i, `${s.emoji} `);
    }
    const next = replaced + after;
    setText(next);
    if (!editing) drafts.set(draftKey, next);
    setSuggestions([]);
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(replaced.length, replaced.length);
    });
  };

  const insertAtCaret = (s: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    update(next);
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
    });
  };

  /** Build message content, turning picked @mentions into proper Matrix mention links. */
  const buildContent = (body: string) => {
    let html = markdownToHtml(body);
    const used = [...mentions.entries()].filter(([name]) => body.includes(name));
    if (used.length) {
      html ??= escapeHtml(body).replace(/\n/g, "<br>");
      for (const [name, userId] of used) {
        html = html.split(escapeHtml(name)).join(`<a href="https://matrix.to/#/${userId}">${escapeHtml(name)}</a>`);
      }
    }
    const content: Record<string, unknown> = { msgtype: MsgType.Text, body };
    if (html) Object.assign(content, { format: "org.matrix.custom.html", formatted_body: html });
    content["m.mentions"] = used.length ? { user_ids: used.map(([, id]) => id) } : {};
    return content;
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setError(null);
    setSuggestions([]);
    const content = buildContent(body);

    if (editing) {
      const target = editing;
      setEditing(null);
      setText(drafts.get(draftKey) ?? "");
      if (body === String(target.getContent().body ?? "")) return;
      const edit = {
        ...content,
        body: `* ${body}`,
        ...(content.formatted_body ? { formatted_body: `* ${content.formatted_body}` } : {}),
        "m.new_content": content,
        "m.relates_to": { rel_type: RelationType.Replace, event_id: target.getId()! },
      };
      try {
        await client.sendMessage(room.roomId, threadId ?? null, edit as never);
      } catch (e) {
        setError(`Failed to edit: ${(e as Error).message}`);
      }
      return;
    }

    update("");
    setMentions(new Map());
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    try {
      await client.sendMessage(room.roomId, threadId ?? null, content as never);
    } catch (e) {
      setError(`Failed to send: ${(e as Error).message}`);
      update(body);
    }
  };

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const entry = { name: file.name, pct: 0 };
      setUploads((u) => [...u, entry]);
      try {
        await sendFile(client, room, file, threadId ?? null, (loaded, total) => {
          entry.pct = total ? Math.round((loaded / total) * 100) : 0;
          setUploads((u) => [...u]);
        });
      } catch (e) {
        setError(`Upload of ${file.name} failed: ${(e as Error).message}`);
      } finally {
        setUploads((u) => u.filter((x) => x !== entry));
      }
    }
  };

  const lastOwnMessage = (): MatrixEvent | undefined => {
    const events = threadId ? (room.getThread(threadId)?.events ?? []) : room.getLiveTimeline().getEvents();
    const me = client.getUserId();
    return [...events].reverse().find((e) => isEditable(e, me));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestion((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestions[activeSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSuggestions([]);
        return;
      }
    }
    if (e.key === "Escape" && editing) {
      e.preventDefault();
      e.stopPropagation();
      cancelEditing();
      return;
    }
    if (e.key === "ArrowUp" && !text && !editing) {
      const last = lastOwnMessage();
      if (last) {
        e.preventDefault();
        startEditing(last);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((s, i) => (
            <button
              key={s.kind === "member" ? s.member.userId : s.code}
              className={`suggestion ${i === activeSuggestion ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s);
              }}
            >
              {s.kind === "member" ? (
                <>
                  <Avatar mxc={s.member.getMxcAvatarUrl()} name={s.member.name} id={s.member.userId} size={20} />
                  <b>{s.member.name}</b>
                  <span className="muted small">{s.member.userId}</span>
                </>
              ) : (
                <>
                  <span className="suggestion-emoji">{s.emoji}</span>
                  <span>:{s.code}:</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {editing && (
        <div className="editing-bar">
          Editing message · <b>Enter</b> to save · <b>Esc</b> to cancel
          <button className="icon-btn" onClick={cancelEditing}>
            <CloseIcon />
          </button>
        </div>
      )}
      {uploads.map((u) => (
        <div key={u.name} className="upload-row muted small">
          Uploading {u.name}… {u.pct}%
          <div className="upload-bar">
            <div style={{ width: `${u.pct}%` }} />
          </div>
        </div>
      ))}
      <div className={`composer-box ${editing ? "editing" : ""}`}>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              upload(e.clipboardData.files);
            }
          }}
          onBlur={() => setTimeout(() => setSuggestions([]), 150)}
        />
        <div className="composer-tools">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              e.target.value = "";
            }}
          />
          {!editing && (
            <button className="tool-btn" title="Attach files" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon />
            </button>
          )}
          <div className="emoji-anchor">
            <button className="tool-btn" title="Emoji" onClick={() => setEmojiOpen((o) => !o)}>
              <SmileIcon />
            </button>
            {emojiOpen && (
              <EmojiPopover
                className="above"
                onPick={(emoji) => {
                  insertAtCaret(emoji);
                  setEmojiOpen(false);
                }}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </div>
          <button className="send-btn" disabled={!text.trim()} onClick={send} title={editing ? "Save (Enter)" : "Send (Enter)"}>
            <SendIcon />
          </button>
        </div>
      </div>
      <div className="composer-hint muted">
        {error ? (
          <span className="error-text">{error}</span>
        ) : typingText(room, client.getUserId()) ? (
          <span className="typing">{typingText(room, client.getUserId())}</span>
        ) : (
          <>**bold** _italic_ `code` · @ to mention · ↑ to edit last message · Shift+Enter for a new line</>
        )}
      </div>
    </div>
  );
}
