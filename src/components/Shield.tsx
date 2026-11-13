import { useEffect, useState } from "react";
import { EventType } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { CryptoEvent, EventShieldColour, EventShieldReason } from "matrix-js-sdk/lib/crypto-api";
import { useClient } from "../matrix/hooks";

/**
 * Per-message authenticity warning, like Element's message shields.
 * Uses the crypto library's normal (non-strict) mode: messages from people you simply haven't
 * verified are fine; we only flag real problems (unknown/unsigned devices, keys of unconfirmed
 * origin, identity changes, sender mismatches, or plaintext in an encrypted room).
 */

const REASONS: Partial<Record<EventShieldReason, string>> = {
  [EventShieldReason.UNVERIFIED_IDENTITY]: "Encrypted by an unverified user.",
  [EventShieldReason.UNSIGNED_DEVICE]: "Encrypted by a device not verified by its owner.",
  [EventShieldReason.UNKNOWN_DEVICE]: "Encrypted by an unknown or deleted device.",
  [EventShieldReason.AUTHENTICITY_NOT_GUARANTEED]:
    "The authenticity of this message can't be guaranteed on this device (its key came from backup or was forwarded).",
  [EventShieldReason.VERIFICATION_VIOLATION]: "The sender's identity changed since you verified them.",
  [EventShieldReason.MISMATCHED_SENDER]: "The sender doesn't match the device that encrypted this message.",
};

type Shield = { level: "warn" | "info"; text: string } | null;

// Re-evaluate all shields when device/identity trust changes.
let trustGeneration = 0;
const subscribers = new Set<() => void>();
let watching: MatrixClient | null = null;
function watchTrust(client: MatrixClient) {
  if (watching === client) return;
  watching = client;
  const bump = () => {
    trustGeneration++;
    for (const s of subscribers) s();
  };
  client.on(CryptoEvent.UserTrustStatusChanged, bump);
  client.on(CryptoEvent.DevicesUpdated, bump);
  client.on(CryptoEvent.KeysChanged, bump);
}

function useShield(ev: MatrixEvent, room: Room): Shield {
  const client = useClient();
  const [shield, setShield] = useState<Shield>(null);
  const [gen, setGen] = useState(trustGeneration);

  useEffect(() => {
    watchTrust(client);
    const s = () => setGen(trustGeneration);
    subscribers.add(s);
    return () => {
      subscribers.delete(s);
    };
  }, [client]);

  const decrypted = !ev.isBeingDecrypted() && !ev.isDecryptionFailure();
  useEffect(() => {
    let alive = true;
    const pending = ev.status !== null || !ev.getId()?.startsWith("$");
    if (pending || ev.isRedacted() || ev.getSender() === client.getUserId()) {
      setShield(null);
      return;
    }
    if (!ev.isEncrypted()) {
      // A homeserver can inject plaintext events into an encrypted room.
      const isMessage = ev.getType() === EventType.RoomMessage || ev.getType() === EventType.Sticker;
      setShield(isMessage && room.hasEncryptionStateEvent() ? { level: "warn", text: "Not encrypted — this message was sent without end-to-end encryption." } : null);
      return;
    }
    if (!decrypted) {
      setShield(null);
      return;
    }
    client
      .getCrypto()
      ?.getEncryptionInfoForEvent(ev)
      .then((info) => {
        if (!alive || !info || info.shieldColour === EventShieldColour.NONE) return alive && setShield(null);
        const text = (info.shieldReason !== null && REASONS[info.shieldReason]) || "This message's authenticity couldn't be confirmed.";
        setShield({ level: info.shieldColour === EventShieldColour.RED ? "warn" : "info", text });
      })
      .catch(() => alive && setShield(null));
    return () => {
      alive = false;
    };
  }, [client, ev, room, decrypted, gen]);

  return shield;
}

export function MessageShield({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const shield = useShield(ev, room);
  if (!shield) return null;
  return (
    <span className={`msg-shield ${shield.level}`} title={shield.text} aria-label={shield.text}>
      {shield.level === "warn" ? "⚠" : "ⓘ"}
    </span>
  );
}
