import { useEffect, useState } from "react";
import { useClient } from "../matrix/hooks";
import type { IndexedMessage, SearchIndex } from "../matrix/search";
import { escapeHtml, formatDateSeparator, formatTime } from "../util/format";
import { Avatar } from "./Avatar";
import { SearchIcon } from "./icons";

interface Props {
  index: SearchIndex;
  query: string;
  onJump: (roomId: string, eventId: string, threadId?: string) => void;
}

function highlight(body: string, query: string): string {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("in:") && !w.startsWith("from:"));
  let html = escapeHtml(body.length > 400 ? `${body.slice(0, 400)}…` : body);
  for (const w of words) {
    const re = new RegExp(`(${escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    html = html.replace(re, "<mark>$1</mark>");
  }
  return html.replace(/\n/g, "<br>");
}

export function SearchView({ index, query, onJump }: Props) {
  const client = useClient();
  const [results, setResults] = useState<IndexedMessage[] | null>(null);
  const [status, setStatus] = useState(index.crawlStatus);

  useEffect(() => {
    let alive = true;
    setResults(null);
    index.search(query).then((r) => alive && setResults(r));
    return () => {
      alive = false;
    };
  }, [index, query]);

  useEffect(() => {
    const t = setInterval(() => setStatus({ ...index.crawlStatus }), 2000);
    return () => clearInterval(t);
  }, [index]);

  const crawling = status.roomsDone < status.roomsTotal;
  let lastDay = "";

  return (
    <section className="channel">
      <header className="channel-header">
        <div className="channel-title">
          <SearchIcon />
          <span className="channel-name">Search results for “{query}”</span>
        </div>
        <div className="channel-actions muted small">
          {crawling
            ? `Indexing history… ${status.roomsDone}/${status.roomsTotal} channels`
            : `${results?.length ?? 0} results`}
        </div>
      </header>
      <div className="search-results">
        <div className="muted small search-tip">
          Tip: use <code>in:channel</code> and <code>from:@user</code> to narrow results. Encrypted messages are searched
          on this device only.
        </div>
        {results === null && <div className="muted empty">Searching…</div>}
        {results?.length === 0 && (
          <div className="muted empty">
            No results.{crawling && " Older messages are still being indexed — try again in a bit."}
          </div>
        )}
        {results?.map((m) => {
          const room = client.getRoom(m.roomId);
          const member = room?.getMember(m.sender);
          const day = formatDateSeparator(m.ts);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.eventId}>
              {showDay && (
                <div className="date-separator">
                  <span>{day}</span>
                </div>
              )}
              <button className="search-hit" onClick={() => onJump(m.roomId, m.eventId, m.threadId)}>
                <div className="search-hit-channel muted small">
                  {room?.name ?? m.roomId}
                  {m.threadId && " · in a thread"}
                </div>
                <div className="search-hit-row">
                  <Avatar mxc={member?.getMxcAvatarUrl()} name={member?.name ?? m.sender} id={m.sender} size={32} />
                  <div className="search-hit-main">
                    <div>
                      <b>{member?.name ?? m.sender}</b> <span className="muted small">{formatTime(m.ts)}</span>
                      <span className="jump">Jump</span>
                    </div>
                    <div className="post-body" dangerouslySetInnerHTML={{ __html: highlight(m.body, query) }} />
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
