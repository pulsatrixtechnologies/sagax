// What one push says: the APNs JSON body and its headers. The phone reads
// `kind`, `threadId`, `botId`, `groupId`, `personId` and `id` at the top
// level of the payload (ios/Sources/CompanionCore/Push.swift), the
// same keys its local notifications carry, so a tap opens the same screen.
// A bot or person sender also carries `senderName`, `senderId` and
// `avatarUrl` plus `aps.mutable-content`, so the Notification Service
// Extension can show a communication notification (docs/ios-push.md).
import { createHash } from "node:crypto";

import { botAvatarUrlSchema } from "../../shared/bot-avatar.ts";

export type PushKind = "message" | "nudge" | "approval" | "achievement" | "routine";

/** Lock-screen actions. A question uses the plain update category: it has
 * no Allow or Deny. A key-protected approval opens the app. */
export const APPROVAL_CATEGORY = "SAGAX_APPROVAL";
export const APPROVAL_KEY_CATEGORY = "SAGAX_APPROVAL_KEY";
export const UPDATE_CATEGORY = "SAGAX_UPDATE";

export interface PushMessage {
  kind: PushKind;
  /** The person it is for (principal id). */
  personId: string;
  title: string;
  body: string;
  threadId?: string;
  /** The bot, or for a conversation between people the group: what the
   * phone needs to open it. */
  botId?: string;
  groupId?: string;
  /** Who it comes from (a nudge, a message from a person). */
  fromId?: string;
  /** The event's own id (a nudge's id), for the phone's dedup. */
  id?: string;
  /** The approval a push is about: the tap opens its card, and Allow or
   * Deny from the banner answers this request. */
  requestId?: string;
  /** `approval` or `question` when `kind` is `approval`. A question is not answerable from the banner. */
  prompt?: "approval" | "question";
  /** Allow must open Sagax: the person's security key signs it. */
  needsKey?: boolean;
  /** A finished routine, so the banner can name it. */
  routineRunId?: string;
  routineName?: string;
  /** When it happened, milliseconds since 1970. */
  at: number;
  /** A string of the app's own catalog (ios/App/Localizable.xcstrings) the
   * phone shows in its language instead of `title` / `body`; `%@` takes the
   * args in order. */
  titleLocKey?: string;
  titleLocArgs?: string[];
  bodyLocKey?: string;
  bodyLocArgs?: string[];
  /** Display name of the bot or person. The iOS Notification Service
   * Extension uses this as the communication-notification sender. */
  senderName?: string;
  /** Stable handle for that sender (bot id or person id). */
  senderId?: string;
  /** Relative avatar path on this server (`/api/attachments/...` or
   * `/api/people/<id>/avatar?v=...`). Absolute URLs are dropped. */
  avatarUrl?: string;
}

/** What this device's Settings > Notifications allow (sent by the phone
 * when it registers). All on unless the phone said otherwise. */
export interface DevicePushSettings {
  sound: boolean;
  badge: boolean;
  nudgeSound: boolean;
  /** Distinct sound on an approval banner. On unless the phone said otherwise. */
  approvalChime: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DevicePushSettings = Object.freeze({
  sound: true, badge: true, nudgeSound: true, approvalChime: true,
});

/** The bundled wizz, converted for notifications (ios/App/nudge.caf). */
export const NUDGE_SOUND = "nudge.caf";
/** A short chime, distinct from the system sound and from the nudge (ios/App/approval.caf). */
export const APPROVAL_SOUND = "approval.caf";

/** Which category the phone registered. Questions and ordinary news have no actions. */
export function pushCategory(message: Pick<PushMessage, "kind" | "prompt" | "needsKey">): string {
  if (message.kind !== "approval" || message.prompt === "question") return UPDATE_CATEGORY;
  return message.needsKey ? APPROVAL_KEY_CATEGORY : APPROVAL_CATEGORY;
}

const TITLE_MAX = 120;
const BODY_MAX = 240;
/** APNs refuses a collapse id over 64 bytes. */
const COLLAPSE_MAX = 64;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** A person's avatar on this server, matching src/lib/profile-management.ts
 * `personAvatarSrc`. Anything else would be a tracking pixel. */
const PERSON_AVATAR = /^\/api\/people\/[\w-]{1,80}\/avatar(?:\?v=[0-9A-Za-z_-]{1,64})?$/;

/** Stored image path the phone's extension may fetch with its bearer.
 * Rejects absolute URLs and anything that is not this server's own avatar
 * route. */
export function pushAvatarUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > 512) return undefined;
  if (botAvatarUrlSchema.safeParse(value).success) return value;
  if (PERSON_AVATAR.test(value)) return value;
  return undefined;
}

/** Clipped sender display name, or undefined when this push has no person
 * or bot to show as the communication-notification sender. */
export function communicationSenderName(message: Pick<PushMessage, "senderName">): string | undefined {
  const name = message.senderName?.replace(/\s+/g, " ").trim();
  if (!name) return undefined;
  return clip(name, TITLE_MAX);
}

/** One conversation shows one notification: the newest replaces the last.
 * Mirrors `PushCollapse.identifier` on the phone. */
export function collapseId(message: Pick<PushMessage, "kind" | "threadId">): string {
  const key = message.threadId?.trim() ? `sagax.t.${message.threadId.trim()}` : `sagax.${message.kind}`;
  if (Buffer.byteLength(key) <= COLLAPSE_MAX) return key;
  return `sagax.h.${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

/** Priority 10 (at once, wakes the screen) for a nudge; 5 (when the phone
 * finds it convenient) for the rest. */
export function pushPriority(kind: PushKind): 5 | 10 {
  return kind === "nudge" ? 10 : 5;
}

export interface ApnsRequest {
  headers: Record<string, string>;
  body: string;
}

/** A silent push (no banner, no sound) telling the person's phones that a
 * conversation was read on another device: the app wakes in the background,
 * counts its unread again for the icon badge and withdraws that
 * conversation's notifications (ios PushKind.read). */
export function buildReadSyncRequest(input: { threadId: string; bundleId: string; nowMs: number }): ApnsRequest {
  const payload = { aps: { "content-available": 1 }, kind: "read", threadId: input.threadId, at: input.nowMs };
  return {
    headers: {
      "apns-push-type": "background",
      "apns-topic": input.bundleId,
      // APNs requires priority 5 for a background push
      "apns-priority": "5",
      "apns-expiration": String(Math.floor(input.nowMs / 1000) + 60 * 60),
    },
    body: JSON.stringify(payload),
  };
}

export function buildApnsRequest(input: {
  message: PushMessage;
  bundleId: string;
  settings?: Partial<DevicePushSettings>;
  /** Whether the person's synced "Notification sounds" is on. */
  personSound?: boolean;
  nowMs: number;
}): ApnsRequest {
  const { message } = input;
  const settings = { ...DEFAULT_DEVICE_SETTINGS, ...input.settings };
  const soundOn = settings.sound && input.personSound !== false;
  const approvalChime = message.kind === "approval" && message.prompt !== "question" && settings.approvalChime !== false;
  const sound = message.kind === "nudge"
    ? (settings.nudgeSound ? NUDGE_SOUND : soundOn ? "default" : undefined)
    : !soundOn ? undefined
      : approvalChime ? APPROVAL_SOUND
        : "default";
  const senderName = communicationSenderName(message);
  const avatarUrl = pushAvatarUrl(message.avatarUrl);
  const senderId = (message.senderId ?? message.botId ?? message.fromId)?.trim() || undefined;
  const alert: Record<string, unknown> = {
    title: senderName || clip(message.title, TITLE_MAX) || "Sagax",
    body: clip(message.body, BODY_MAX),
  };
  if (message.titleLocKey) {
    alert["title-loc-key"] = message.titleLocKey;
    if (message.titleLocArgs?.length) alert["title-loc-args"] = message.titleLocArgs.map((arg) => clip(arg, TITLE_MAX));
  }
  if (message.bodyLocKey) alert["loc-key"] = message.bodyLocKey;
  if (message.bodyLocArgs?.length) alert["loc-args"] = message.bodyLocArgs.map((arg) => clip(arg, TITLE_MAX));
  // The banner's title is the bot (name and face); an approval says under it
  // what it would allow, in the card's own words.
  if (message.kind === "approval" && senderName && message.title.trim() && message.title.trim() !== senderName) {
    alert.subtitle = clip(message.title, TITLE_MAX);
  } else if (message.routineName) {
    const name = clip(message.routineName, 80);
    alert.subtitle = clip(`Open routine ${name}`, TITLE_MAX);
    alert["subtitle-loc-key"] = "Open routine %@";
    alert["subtitle-loc-args"] = [name];
  }
  const aps: Record<string, unknown> = {
    alert,
    // the phone wakes in the background to count its unread (the badge)
    "content-available": 1,
    category: pushCategory(message),
  };
  if (sound) aps.sound = sound;
  if (message.threadId) aps["thread-id"] = message.threadId;
  if (message.kind === "nudge" || message.kind === "approval") aps["interruption-level"] = "time-sensitive";
  // The Notification Service Extension turns this into a communication
  // notification (bot name + avatar). Without the extension the alert
  // title is already the sender's name.
  if (senderName) aps["mutable-content"] = 1;
  const payload: Record<string, unknown> = { aps, kind: message.kind, at: message.at };
  if (message.threadId) payload.threadId = message.threadId;
  // NotificationTarget needs a bot id: a conversation between people is
  // found by its group, as a nudge's notification already does.
  const botId = message.botId?.trim() || message.groupId?.trim();
  if (botId) payload.botId = botId;
  if (message.groupId) payload.groupId = message.groupId;
  if (message.fromId) payload.fromId = message.fromId;
  if (message.id) payload.id = message.id;
  if (message.requestId) payload.requestId = message.requestId;
  if (message.prompt) payload.prompt = message.prompt;
  if (message.needsKey) payload.needsKey = true;
  if (message.routineRunId) payload.routineRunId = message.routineRunId;
  if (message.routineName) payload.routineName = clip(message.routineName, 80);
  if (senderName) payload.senderName = senderName;
  if (senderId) payload.senderId = senderId;
  if (avatarUrl) payload.avatarUrl = avatarUrl;
  const headers: Record<string, string> = {
    "apns-push-type": "alert",
    "apns-topic": input.bundleId,
    "apns-priority": String(pushPriority(message.kind)),
    "apns-collapse-id": collapseId(message),
    // a nudge is stale after a few minutes; the rest may wait a day
    "apns-expiration": String(Math.floor(input.nowMs / 1000) + (message.kind === "nudge" ? 5 * 60 : 24 * 60 * 60)),
  };
  return { headers, body: JSON.stringify(payload) };
}
