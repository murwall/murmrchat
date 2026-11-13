import { useEffect, useRef, useState } from "react";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { formatDateSeparator } from "../util/format";
import { isRenderable, isSystemEvent, Message } from "./Message";
import { BrokenMessage, ErrorBoundary } from "./ErrorBoundary";

interface Props {
  room: Room;
  events: MatrixEvent[];
  inThread?: boolean;
  onOpenThread?: (rootId: string) => void;
  /** Load older messages; resolves to false when there is nothing more. */
  loadMore: () => Promise<boolean>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Highlight and scroll to this message. */
  highlightId?: string;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Chronological message list, anchored to the bottom.
 * The scroll container uses `flex-direction: column-reverse` around a single inner block,
 * so the browser keeps the view stuck to the newest message, and stable when older
 * messages are prepended at the top.
 */
export function MessageList({ room, events, inThread, onOpenThread, loadMore, header, footer, highlightId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [atStart, setAtStart] = useState(false);

  useEffect(() => {
    setAtStart(false);
  }, [room.roomId]);

  // Scroll the highlighted message into view once it's rendered.
  const hasHighlight = !!highlightId && events.some((e) => e.getId() === highlightId);
  useEffect(() => {
    if (!hasHighlight) return;
    const el = scrollRef.current?.querySelector(`[data-event-id="${CSS.escape(highlightId!)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [hasHighlight, highlightId]);

  // Load older messages when the top sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || atStart) return;
    const obs = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || loading) return;
        setLoading(true);
        try {
          const more = await loadMore();
          if (!more) setAtStart(true);
        } finally {
          setLoading(false);
        }
      },
      { root: scrollRef.current, rootMargin: "400px 0px 0px 0px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [loadMore, loading, atStart]);

  const visible = events.filter(isRenderable);
  const rows: React.ReactNode[] = [];
  let prev: MatrixEvent | null = null;
  for (const ev of visible) {
    const ts = ev.getTs();
    if (!prev || new Date(prev.getTs()).toDateString() !== new Date(ts).toDateString()) {
      rows.push(
        <div className="date-separator" key={`d-${ts}-${ev.getId()}`}>
          <span>{formatDateSeparator(ts)}</span>
        </div>,
      );
      prev = null;
    }
    const continuation =
      !!prev &&
      !isSystemEvent(prev) &&
      !isSystemEvent(ev) &&
      prev.getSender() === ev.getSender() &&
      ts - prev.getTs() < GROUP_WINDOW_MS &&
      !(prev.isThreadRoot && !inThread);
    rows.push(
      <ErrorBoundary key={ev.getId() ?? ev.getTxnId()} fallback={() => <BrokenMessage />}>
        <Message
          ev={ev}
          room={room}
          continuation={continuation}
          inThread={inThread}
          onOpenThread={onOpenThread}
          highlight={ev.getId() === highlightId}
        />
      </ErrorBoundary>,
    );
    prev = ev;
  }

  return (
    <div className="message-list" ref={scrollRef}>
      <div className="message-list-inner">
        {atStart ? (
          <div className="timeline-start muted">Beginning of conversation</div>
        ) : (
          <div ref={sentinelRef} className="timeline-loading muted">
            {loading ? "Loading older messages…" : ""}
          </div>
        )}
        {header}
        {rows}
        {footer}
      </div>
    </div>
  );
}
