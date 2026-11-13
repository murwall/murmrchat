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

/** Sanitize an incoming `formatted_body`. Drops <mx-reply> fallbacks and images. */
export function sanitizeHtml(html: string): string {
  const withoutReply = html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, "");
  return DOMPurify.sanitize(withoutReply, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "data-mx-color", "data-mx-bg-color", "color", "class", "start"],
    ALLOWED_URI_REGEXP: /^(https?|mailto|matrix):/i,
  });
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
