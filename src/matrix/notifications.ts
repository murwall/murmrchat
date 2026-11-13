import { useEffect, useRef } from "react";
import { ClientEvent, EventType, NotificationCountType } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dmRoomIds, joinedRooms, unreadInfo } from "./rooms";
import { isMuted } from "./notifSettings";
import { stripReplyFallback } from "../util/format";
import { isDndActive } from "./status";

const inTauri = () => "__TAURI_INTERNALS__" in window;

const PREVIEW_KEY = "matterix.notificationPreviews";

/** Whether desktop notifications include message text (they show in macOS Notification Center). */
export function getNotificationPreviews(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setNotificationPreviews(on: boolean) {
  try {
    localStorage.setItem(PREVIEW_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

async function ensurePermission(): Promise<boolean> {
  if (!inTauri()) return false;
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

/**
 * Desktop notifications for messages that the user's push rules say should notify
 * (mentions, DMs, keywords — the same rules Element uses), plus the Dock badge count.
 */
export function useNotifications(client: MatrixClient, currentRoomId: string | null, tick: number) {
  const current = useRef(currentRoomId);
  current.current = currentRoomId;

  useEffect(() => {
    let allowed = false;
    ensurePermission().then((ok) => (allowed = ok));
    const startedAt = Date.now();
    const seen = new Set<string>();

    const onEvent = async (ev: MatrixEvent) => {
      const id = ev.getId();
      if (!id || seen.has(id) || ev.getTs() < startedAt - 10_000) return;
      if (ev.getSender() === client.getUserId()) return;
      const type = ev.getType();
      if (type !== EventType.RoomMessage && type !== EventType.RoomMessageEncrypted) return;
      seen.add(id);

      await client.decryptEventIfNeeded(ev);
      if (ev.getType() !== EventType.RoomMessage || ev.isRelation("m.replace")) return;
      const room = client.getRoom(ev.getRoomId());
      if (!room) return;
      if (room.roomId === current.current && document.hasFocus()) return;

      const actions = client.getPushActionsForEvent(ev, true);
      if (!actions?.notify) return;
      if (isDndActive()) return; // Do Not Disturb: no pop-ups (badge still updates)

      const sender = ev.sender?.name ?? ev.getSender() ?? "Someone";
      const isDm = dmRoomIds(client).has(room.roomId);
      const content = ev.getContent();
      const body = ev.isDecryptionFailure()
        ? "🔒 Encrypted message"
        : content.msgtype === "m.image"
          ? "sent an image"
          : content.msgtype === "m.file"
            ? "sent a file"
            : stripReplyFallback(String(content.body ?? ""));

      if (allowed) {
        const preview = getNotificationPreviews();
        sendNotification({
          title: isDm ? sender : `${sender} in ${room.name}`,
          body: preview ? (body.length > 200 ? `${body.slice(0, 200)}…` : body) : "New message",
        });
      }
      if (inTauri() && actions.tweaks?.highlight) {
        getCurrentWindow().requestUserAttention(2 /* Informational */).catch(() => {});
      }
    };

    client.on(ClientEvent.Event, onEvent);
    return () => {
      client.off(ClientEvent.Event, onEvent);
    };
  }, [client]);

  // Dock badge, like Mattermost:
  //   red number = unread DM messages + mentions (incl. in threads), muted rooms excluded
  //   red dot    = no mentions, but some (unmuted) channel has unread messages
  //   nothing    = all caught up
  const lastBadge = useRef<string | null>(null);
  useEffect(() => {
    if (!inTauri()) return;
    const dms = dmRoomIds(client);
    let count = 0;
    let unreadChannels = false;
    for (const r of joinedRooms(client)) {
      if (r.isSpaceRoom() || isMuted(r)) continue;
      if (dms.has(r.roomId)) {
        count += r.getUnreadNotificationCount(NotificationCountType.Total);
      } else {
        count += r.getUnreadNotificationCount(NotificationCountType.Highlight);
        if (unreadInfo(r).unread) unreadChannels = true;
      }
    }
    const badge = count > 0 ? String(count) : unreadChannels ? "•" : "";
    if (badge === lastBadge.current) return;
    lastBadge.current = badge;
    const win = getCurrentWindow();
    // setBadgeLabel shows arbitrary text (the dot); undefined clears it.
    (count > 0 ? win.setBadgeCount(count) : win.setBadgeLabel(badge || undefined)).catch(() => {});
  }, [client, tick]);
}
