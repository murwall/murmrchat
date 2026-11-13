import { ConditionKind, PushRuleKind } from "matrix-js-sdk";
import type { IPushRule, MatrixClient, Room } from "matrix-js-sdk";

/**
 * Per-channel notification level, using the same push rules as Element so the
 * setting is shared with your other Matrix apps (and with phone push):
 *
 *  - default:  no room-specific rule; your account defaults apply
 *  - all:      room rule that notifies (with sound) for every message
 *  - mentions: room rule with no actions → only mentions/keywords notify
 *  - mute:     override rule with no actions → nothing notifies
 */
export type RoomNotifLevel = "default" | "all" | "mentions" | "mute";

function findRule(rules: IPushRule[] | undefined, roomId: string) {
  return rules?.find((r) => r.rule_id === roomId);
}

function isMuteRule(rule: IPushRule | undefined, roomId: string): boolean {
  if (!rule || !rule.enabled || rule.actions.length) return false;
  const c = rule.conditions ?? [];
  return c.length === 1 && c[0].kind === ConditionKind.EventMatch && (c[0] as { key?: string }).key === "room_id" && (c[0] as { pattern?: string }).pattern === roomId;
}

export function getRoomNotifLevel(client: MatrixClient, roomId: string): RoomNotifLevel {
  const g = client.pushRules?.global;
  if (isMuteRule(findRule(g?.override, roomId), roomId)) return "mute";
  const roomRule = findRule(g?.room, roomId);
  if (roomRule?.enabled) {
    const notifies = roomRule.actions.some((a) => a === "notify" || (typeof a === "object" && "set_tweak" in a && a.set_tweak === "sound"));
    return notifies ? "all" : "mentions";
  }
  return "default";
}

export function isMuted(room: Room): boolean {
  return getRoomNotifLevel(room.client, room.roomId) === "mute";
}

export async function setRoomNotifLevel(client: MatrixClient, roomId: string, level: RoomNotifLevel) {
  const g = client.pushRules?.global;
  // Clear whatever is there.
  if (findRule(g?.override, roomId)) await client.deletePushRule("global", PushRuleKind.Override, roomId).catch(() => {});
  if (findRule(g?.room, roomId)) await client.deletePushRule("global", PushRuleKind.RoomSpecific, roomId).catch(() => {});

  if (level === "mute") {
    await client.addPushRule("global", PushRuleKind.Override, roomId, {
      actions: [],
      conditions: [{ kind: ConditionKind.EventMatch, key: "room_id", pattern: roomId }],
    });
  } else if (level === "all") {
    await client.addPushRule("global", PushRuleKind.RoomSpecific, roomId, {
      actions: ["notify" as never, { set_tweak: "sound", value: "default" } as never],
    });
  } else if (level === "mentions") {
    await client.addPushRule("global", PushRuleKind.RoomSpecific, roomId, { actions: [] });
  }
  // Refresh the client's copy now; the next sync confirms it.
  client.pushRules = await client.getPushRules();
}
