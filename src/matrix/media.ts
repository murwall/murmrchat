import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";

/** Encrypted file info as found in `content.file` of messages in encrypted rooms. */
export interface EncryptedFile {
  url: string;
  key: JsonWebKey;
  iv: string;
  hashes: { sha256: string };
  v: string;
}

const cache = new Map<string, Promise<string>>();

/**
 * Media types we let the webview interpret. Everything else (HTML, SVG, XML, PDF, scripts, …)
 * becomes an opaque binary blob: a sender controls `info.mimetype`, and a blob: URL has the
 * app's own origin, so rendering e.g. text/html from it would run their code inside the app.
 */
const SAFE_MEDIA_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-wav", "audio/flac",
]);

export const DOWNLOAD_TYPE = "application/octet-stream";

export function safeMimeType(mimetype: string | undefined): string {
  const t = (mimetype ?? "").toLowerCase().split(";")[0].trim();
  return SAFE_MEDIA_TYPES.has(t) ? t : DOWNLOAD_TYPE;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const normal = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchAuthed(client: MatrixClient, httpUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(httpUrl, {
    headers: { Authorization: `Bearer ${client.getAccessToken()}` },
  });
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  return res.arrayBuffer();
}

async function decryptAttachment(data: ArrayBuffer, file: EncryptedFile): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const expected = b64ToBytes(file.hashes.sha256);
  const actual = new Uint8Array(digest);
  if (expected.length !== actual.length || expected.some((b, i) => b !== actual[i])) {
    throw new Error("Attachment hash mismatch");
  }
  const key = await crypto.subtle.importKey("jwk", file.key, { name: "AES-CTR" }, false, ["decrypt"]);
  // The IV is 128 bits; Matrix uses the low 64 bits as the counter.
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: b64ToBytes(file.iv), length: 64 }, key, data);
}

/**
 * Returns an object URL for an mxc:// URL (optionally thumbnailed) or an encrypted file.
 * Uses authenticated media endpoints, which matrix.org requires.
 */
export function getMediaUrl(
  client: MatrixClient,
  src: { mxc?: string; file?: EncryptedFile },
  thumb?: { w: number; h: number; method?: "crop" | "scale" },
  mimetype?: string,
): Promise<string> {
  const mxc = src.file?.url ?? src.mxc;
  if (!mxc) return Promise.reject(new Error("no media"));
  const type = safeMimeType(mimetype);
  const cacheKey = `${mxc}|${thumb ? `${thumb.w}x${thumb.h}${thumb.method}` : "full"}|${type}`;
  let p = cache.get(cacheKey);
  if (!p) {
    p = (async () => {
      // Encrypted files can't be thumbnailed by the server; always download the full file.
      const httpUrl =
        thumb && !src.file
          ? client.mxcUrlToHttp(mxc, thumb.w, thumb.h, thumb.method ?? "crop", false, true, true)
          : client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
      if (!httpUrl) throw new Error("bad mxc url");
      let data = await fetchAuthed(client, httpUrl);
      if (src.file) data = await decryptAttachment(data, src.file);
      return URL.createObjectURL(new Blob([data], { type }));
    })();
    p.catch(() => cache.delete(cacheKey));
    cache.set(cacheKey, p);
  }
  return p;
}

export function useMediaUrl(
  client: MatrixClient,
  src: { mxc?: string; file?: EncryptedFile } | null,
  thumb?: { w: number; h: number; method?: "crop" | "scale" },
  mimetype?: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = src ? (src.file?.url ?? src.mxc ?? "") : "";
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!src || !key) return;
    getMediaUrl(client, src, thumb, mimetype)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, thumb?.w, thumb?.h, mimetype]);
  return url;
}
