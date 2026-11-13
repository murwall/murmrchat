import { MsgType } from "matrix-js-sdk";
import type { MatrixClient, Room } from "matrix-js-sdk";
import type { EncryptedFile } from "./media";

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // Matrix uses unpadded base64.
  return btoa(bin).replace(/=+$/, "");
}

/**
 * Encrypt a file for an encrypted room (AES-CTR-256 + SHA-256, Matrix attachment format v2).
 */
async function encryptAttachment(data: ArrayBuffer): Promise<{ ciphertext: ArrayBuffer; info: Omit<EncryptedFile, "url"> }> {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8)); // low 64 bits are the counter and start at zero
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, data);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
  return {
    ciphertext,
    info: {
      v: "v2",
      key: { kty: "oct", alg: "A256CTR", ext: true, k: jwk.k, key_ops: ["encrypt", "decrypt"] },
      iv: bytesToB64(iv),
      hashes: { sha256: bytesToB64(sha) },
    },
  };
}

async function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size;
  } catch {
    return null;
  }
}

/** Upload a file and post it to the room (or thread). */
export async function sendFile(
  client: MatrixClient,
  room: Room,
  file: File,
  threadId: string | null,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const encrypted = room.hasEncryptionStateEvent();
  const mimetype = file.type || "application/octet-stream";
  const isImage = mimetype.startsWith("image/");
  const isVideo = mimetype.startsWith("video/");
  const isAudio = mimetype.startsWith("audio/");

  const data = await file.arrayBuffer();
  let url: string;
  let fileInfo: EncryptedFile | undefined;

  if (encrypted) {
    const { ciphertext, info } = await encryptAttachment(data);
    const res = await client.uploadContent(new Blob([ciphertext]), {
      type: "application/octet-stream",
      includeFilename: false,
      progressHandler: (p) => onProgress?.(p.loaded, p.total),
    });
    url = res.content_uri;
    fileInfo = { ...info, url };
  } else {
    const res = await client.uploadContent(file, {
      type: mimetype,
      name: file.name,
      progressHandler: (p) => onProgress?.(p.loaded, p.total),
    });
    url = res.content_uri;
  }

  const info: Record<string, unknown> = { mimetype, size: file.size };
  if (isImage) {
    const size = await imageSize(file);
    if (size) Object.assign(info, size);
  }

  const content: Record<string, unknown> = {
    msgtype: isImage ? MsgType.Image : isVideo ? MsgType.Video : isAudio ? MsgType.Audio : MsgType.File,
    body: file.name,
    filename: file.name,
    info,
  };
  if (fileInfo) content.file = fileInfo;
  else content.url = url;

  await client.sendMessage(room.roomId, threadId, content as never);
}
