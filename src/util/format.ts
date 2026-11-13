import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

/** Markdown → Matrix `formatted_body`. Returns null when the text has no formatting. */
export function markdownToHtml(text: string): string | null {
  let html = (marked.parse(text) as string).trim();
  // Unwrap a single paragraph so simple messages don't get <p> margins in other clients.
  const single = html.match(/^<p>([\s\S]*)<\/p>$/);
  if (single && !single[1].includes("<p>")) html = single[1];
  // If markdown changed nothing except escaping, send plain text only.
  const plain = escapeHtml(text).replace(/\n/g, "<br>");
  return html === plain || html === text ? null : html;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ALLOWED_TAGS = [
  "font", "del", "s", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol", "sup", "sub",
  "li", "b", "i", "u", "strong", "em", "strike", "code", "hr", "br", "div", "table", "thead", "tbody", "tr",
  "th", "td", "caption", "pre", "span", "details", "summary",
];

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noreferrer noopener");
  }
});

const MATRIX_USER_ID = /^@[^\s:"'<>]+:[A-Za-z0-9.\-:[\]]+$/;

/** If `href` is a matrix.to link to a user, return the (validated) user ID. */
function mentionTarget(href: string | null): string | null {
  const m = href?.match(/^https:\/\/matrix\.to\/#\/(@[^/?#]+)$/);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null; // malformed escape sequence
  }
  return MATRIX_USER_ID.test(id) ? id : null;
}

/**
 * Sanitize an incoming `formatted_body` and turn user links into mention pills.
 * Drops <mx-reply> fallbacks and images.
 *
 * Security: all post-processing happens on the sanitized DOM via setAttribute (which escapes),
 * never by string-splicing into HTML.
 */
export function sanitizeHtml(html: string, opts: { me?: string | null } = {}): string {
  const withoutReply = html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, "");
  const fragment = DOMPurify.sanitize(withoutReply, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "data-mx-color", "data-mx-bg-color", "color", "class", "start"],
    ALLOWED_URI_REGEXP: /^(https?|mailto|matrix):/i,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const a of Array.from(fragment.querySelectorAll("a[href]"))) {
    const userId = mentionTarget(a.getAttribute("href"));
    if (!userId) continue;
    a.setAttribute("data-mention", userId);
    a.setAttribute("class", userId === opts.me ? "mention me" : "mention");
    a.removeAttribute("target");
    a.removeAttribute("rel");
  }
  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

/** Plain text with URLs turned into links. */
export function linkify(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/\n/g, "<br>");
}

/** Strip reply fallback ("> <@user> quoted\n\n") from plain bodies. */
export function stripReplyFallback(body: string): string {
  const lines = body.split("\n");
  while (lines.length && lines[0].startsWith("> ")) lines.shift();
  if (lines.length && lines[0] === "") lines.shift();
  return lines.join("\n");
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDateSeparator(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** Stable color for a user, like Mattermost's username colors. */
export function userColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}
