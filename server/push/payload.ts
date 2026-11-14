// What one push says: the APNs JSON body and its headers. The phone reads
// `kind`, `threadId`, `botId`, `groupId`, `personId` and `id` at the top
// level of the payload (ios/Sources/CompanionCore/Push.swift), the
// same keys its local notifications carry, so a tap opens the same screen.
// A bot or person sender also carries `senderName`, `senderId` and
// `avatarUrl` plus `aps.mutable-content`, so the Notification Service
// Extension can show a communication notification (docs/ios-push.md). A
// bot sender also carries its look (`senderLook`, `senderLookVersion`): the
// extension draws the bot's mascot as the banner's face.
import { createHash } from "node:crypto";
import type { SignalLevel } from "../../shared/signal-levels.ts";
import { CHOICE_BUTTONS_MAX, CHOICE_LABEL_MAX } from "../../shared/notification-context.ts";

import { botAvatarCropSchema, botAvatarUrlSchema, type BotAvatarCrop } from "../../shared/bot-avatar.ts";
import { plainPreviewLine } from "../../shared/plain-text.ts";
import { serverAttachmentLabels } from "../approvals/approval-words.ts";
import { botMascotLook, type MascotLook } from "../../shared/mascot-look.ts";
import { botMascotSkin, type MascotSkinId } from "../../shared/mascot-skins.ts";

export type PushKind = "message" | "nudge" | "approval" | "achievement" | "routine";

/** Lock-screen actions. A question uses the plain update category: it has
 * no Allow or Deny. A key-protected approval opens the app. */
export const APPROVAL_CATEGORY = "SAGAX_APPROVAL";
export const APPROVAL_KEY_CATEGORY = "SAGAX_APPROVAL_KEY";
export const UPDATE_CATEGORY = "SAGAX_UPDATE";
/** A question that names its request: the phone offers Reply with a text field. */
export const QUESTION_CATEGORY = "SAGAX_QUESTION";
/** #2697: a bot needs the person (a run's report, a proactive find) with no
 * request behind it: Approve and Deny answer the bot in its conversation. */
export const NEEDS_YOU_CATEGORY = "SAGAX_NEEDS_YOU";
/** #2697: a proactive proposal card: Do it and Not now answer the proposal
 * (POST /api/bots/:id/proactive/:proposalId). */
export const PROPOSAL_CATEGORY = "SAGAX_PROPOSAL";
/** #2909: a question or a needs-you whose answers cannot be shown whole on
 * a button: one action, Open, which goes to the card in the bot's chat. */
export const OPEN_CATEGORY = "SAGAX_OPEN";

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
  /** An approval's question in plain words, in the person's language: the
   * first line under the bot's name. */
  ask?: string;
  /** A question's choices: the phone offers them as the banner's buttons. */
  choices?: string[];
  /** #2909: one short label per choice, what the buttons show whole.
   * Absent while `choices` is set: the banner offers Open only. */
  choiceLabels?: string[];
  /** #2909: the whole context, multi-line (what happened, why it waits,
   * what each answer does): the banner body, whole in the expanded view. */
  context?: string;
  /** #2909: the chat message holding the card: the tap opens it. */
  cardId?: string;
  /** #2697: a bot needs the person with no request: Approve / Deny reply in its conversation. */
  needsYou?: boolean;
  /** #2697: the proactive proposal card this is about: Do it / Not now answer it. */
  proposalId?: string;
  /** #4250 (S2): the level the frame's writer set (shared/attention-policy.ts);
   * absent: the push kind's. Read by the signal gate, never sent to a phone. */
  level?: SignalLevel;
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
  /** A bot sender's look (colour, character, skin, crop): the phone's
   * extension draws its mascot as the banner's face. Never a person. */
  senderLook?: PushSenderLook;
}

/** What the phone needs to draw a bot's mascot: the same fields the app
 * reads on a bot (ios Bot.color, mascotLook, mascotSkin, avatarCrop).
 * Nothing of the bot's settings, instructions or conversations. */
export interface PushSenderLook {
  color: string;
  mascotLook?: MascotLook;
  mascotSkin?: MascotSkinId;
  avatarCrop?: BotAvatarCrop;
}

/** A bot colour name or `#RRGGBB`, as the phone's `MausColors.hex(for:)` reads it. */
const LOOK_COLOR = /^(?:[a-z][a-z0-9-]{0,31}|#[0-9A-Fa-f]{6})$/;

/** The look of a bot record, cleaned: an unknown character or skin falls back
 * the way the app does, a colour the phone cannot read is dropped. */
export function pushSenderLook(raw: unknown): PushSenderLook | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const color = typeof value.color === "string" ? value.color.trim() : "";
  if (!LOOK_COLOR.test(color)) return undefined;
  const look: PushSenderLook = { color };
  if (value.mascotLook !== undefined && value.mascotLook !== null) look.mascotLook = botMascotLook(value.mascotLook);
  if (value.mascotSkin !== undefined && value.mascotSkin !== null) {
    const skin = botMascotSkin(value.mascotSkin);
    if (skin !== "none") look.mascotSkin = skin;
  }
  const crop = botAvatarCropSchema.safeParse(value.avatarCrop);
  if (crop.success) look.avatarCrop = crop.data;
  return look;
}

/** Changes whenever what the banner draws changes (look, crop or picture),
 * so the phone keeps one rendered face per bot and per look. */
export function senderLookVersion(look: PushSenderLook, avatarUrl?: string): string {
  const canonical = JSON.stringify([look.color, look.avatarCrop ?? "", look.mascotSkin ?? "", look.mascotLook ?? null, avatarUrl ?? ""]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** APNs refuses an alert payload over 4 KB. */
export const APNS_PAYLOAD_MAX = 4096;

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

/** The tones of Settings > Notifications > Notification sound
 * (src/lib/notification-sound.ts), bundled on the phone as
 * ios/App/notify-<id>.caf. "system" (and anything else) is the platform's. */
export const NOTIFICATION_TONE_SOUNDS: Readonly<Record<string, string>> = Object.freeze({
  tick: "notify-tick.caf",
  "double-tick": "notify-double-tick.caf",
  "chime-a": "notify-chime-a.caf",
  "chime-b": "notify-chime-b.caf",
  blip: "notify-blip.caf",
});

/** The person's chosen tone as an APNs sound, else the platform's. */
export function notificationToneSound(choice: string | undefined): string {
  return (choice && Object.hasOwn(NOTIFICATION_TONE_SOUNDS, choice) ? NOTIFICATION_TONE_SOUNDS[choice] : undefined) ?? "default";
}

/** Which category the phone registered. A question that names its request
 * gets Reply; an approval that names its request gets Allow and Deny;
 * ordinary news (and a takeover, which rides `kind: "approval"` with no
 * request) has no actions. Matches ios NotificationApproval.category. */
export function pushCategory(message: Pick<PushMessage, "kind" | "prompt" | "needsKey" | "requestId" | "needsYou" | "proposalId" | "choices" | "choiceLabels">): string {
  if (message.proposalId?.trim()) return PROPOSAL_CATEGORY;
  // #2909: answers a button cannot show whole: Open, never a cut-off choice
  if (message.kind === "approval" && (message.prompt === "question" || message.needsYou)
    && message.choices?.length && !pushChoiceLabels(message).length) return OPEN_CATEGORY;
  if (message.kind === "approval" && message.needsYou && !message.requestId?.trim()) return NEEDS_YOU_CATEGORY;
  if (message.kind === "approval" && message.prompt === "question") {
    return message.requestId?.trim() ? QUESTION_CATEGORY : UPDATE_CATEGORY;
  }
  if (message.kind !== "approval" || !message.requestId?.trim()) return UPDATE_CATEGORY;
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
 * An approval or a question is its own notification, one per request: the
 * next line of the conversation never replaces it (it would take its
 * buttons away), and it is updated or withdrawn in place by its id.
 * Mirrors `PushCollapse.identifier` on the phone. */
export function collapseId(message: Pick<PushMessage, "kind" | "threadId"> & { requestId?: string; proposalId?: string }): string {
  const thread = message.threadId?.trim() ?? "";
  const request = message.kind === "approval" ? message.requestId?.trim() ?? "" : "";
  // each proposal card keeps its own banner: three suggestions are three asks
  const proposal = message.proposalId?.trim() ?? "";
  const key = request ? `sagax.r.${thread}.${request}` : proposal ? `sagax.p.${proposal}` : thread ? `sagax.t.${thread}` : `sagax.${message.kind}`;
  if (Buffer.byteLength(key) <= COLLAPSE_MAX) return key;
  return `sagax.h.${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

/** Priority 10 (at once, wakes the screen) for a nudge and for what waits
 * on the person (an approval, a question); 5 (when the phone finds it
 * convenient) for the rest. */
export function pushPriority(kind: PushKind): 5 | 10 {
  return kind === "nudge" || kind === "approval" ? 10 : 5;
}

/** The longest question line on the banner. */
const ASK_MAX = 120;
/** #2909: the longest context an ask's banner carries (the expanded view
 * shows it whole; the payload stays under APNs's 4 KB). */
const CONTEXT_MAX = 1200;

/** Clipped, line breaks kept (spaces inside each line collapsed). */
function clipLines(text: string, max: number): string {
  const clean = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** What the banner says under the bot's name: the question first, in plain
 * words, then the detail. Never the question twice. A lock screen draws no
 * Markdown, so a body that still carries some (a reach-me notice, an older
 * caller) reads as plain words here too. */
export function bannerBody(message: Pick<PushMessage, "kind" | "ask" | "body"> & { context?: string }, contextMax = CONTEXT_MAX): string {
  // #2909: an ask says it all, readable and multi-line: the question, the
  // detail (tables as text), what each answer does
  if (message.kind === "approval" && message.context?.trim() && contextMax > 0) return clipLines(message.context, contextMax);
  const detail = plainPreviewLine(message.body ?? "", BODY_MAX, { dropCode: true, attachmentLabels: serverAttachmentLabels() });
  const ask = message.kind === "approval" && message.ask ? plainPreviewLine(message.ask, ASK_MAX) : "";
  if (!ask || ask === detail) return detail;
  if (!detail) return ask;
  return `${ask}\n${detail}`;
}

/** The choices a question carries to the phone, as the banner's buttons. */
const PUSH_CHOICES_MAX = 10;
const PUSH_CHOICE_MAX = 120;
export function pushChoices(message: Pick<PushMessage, "kind" | "prompt" | "choices" | "needsYou">): string[] {
  if (message.kind !== "approval" || (message.prompt !== "question" && !message.needsYou) || !message.choices?.length) return [];
  const out: string[] = [];
  for (const raw of message.choices) {
    const choice = clip(raw, PUSH_CHOICE_MAX);
    if (!choice || out.includes(choice)) continue;
    out.push(choice);
    if (out.length >= PUSH_CHOICES_MAX) break;
  }
  return out;
}

/** #2909: the buttons' labels, one per choice, each shown whole (shared
 * CHOICE_LABEL_MAX), at most CHOICE_BUTTONS_MAX; empty means Open only. */
export function pushChoiceLabels(message: Pick<PushMessage, "kind" | "prompt" | "choices" | "choiceLabels" | "needsYou">): string[] {
  const choices = pushChoices(message);
  const labels = (message.choiceLabels ?? []).map((label) => label.replace(/\s+/g, " ").trim());
  if (!choices.length || choices.length > CHOICE_BUTTONS_MAX || choices.length !== message.choices?.length || labels.length !== choices.length) return [];
  if (labels.some((label) => !label || label.length > CHOICE_LABEL_MAX)) return [];
  return labels.slice(0, choices.length);
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

/** An approval or a question was answered (on any device) or expired.
 * Sent as an alert (a silent push is throttled, and dropped once the app was
 * swiped away) under the ask's own `apns-collapse-id`: the phone's
 * Notification Service Extension takes that ask's banner down on the phone
 * and the watch and shows nothing (ios NotificationService.swift). A phone
 * without the extension shows, in the ask's place, one quiet line
 * ("Answered.", no sound, passive), never the buttons of an ask that is gone. */
export function buildSettledRequest(input: { threadId: string; requestId: string; bundleId: string; nowMs: number }): ApnsRequest {
  const payload = {
    aps: {
      alert: { title: "Sagax", body: "Answered.", "loc-key": "Answered." },
      "mutable-content": 1,
      "content-available": 1,
      "interruption-level": "passive",
      "thread-id": input.threadId,
      category: UPDATE_CATEGORY,
    },
    kind: "settled",
    threadId: input.threadId,
    requestId: input.requestId,
    at: input.nowMs,
  };
  return {
    headers: {
      "apns-push-type": "alert",
      "apns-topic": input.bundleId,
      "apns-priority": "10",
      "apns-collapse-id": collapseId({ kind: "approval", threadId: input.threadId, requestId: input.requestId }),
      "apns-expiration": String(Math.floor(input.nowMs / 1000) + 24 * 60 * 60),
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
  /** The person's synced "Notification sound" (`sagax.notificationSound.v1`). */
  personSoundChoice?: string;
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
        : notificationToneSound(input.personSoundChoice);
  const senderName = communicationSenderName(message);
  const avatarUrl = pushAvatarUrl(message.avatarUrl);
  const senderId = (message.senderId ?? message.botId ?? message.fromId)?.trim() || undefined;
  const alert: Record<string, unknown> = {
    title: senderName || clip(message.title, TITLE_MAX) || "Sagax",
    body: bannerBody(message),
  };
  const contextBody = message.kind === "approval" && Boolean(message.context?.trim());
  if (message.titleLocKey) {
    alert["title-loc-key"] = message.titleLocKey;
    if (message.titleLocArgs?.length) alert["title-loc-args"] = message.titleLocArgs.map((arg) => clip(arg, TITLE_MAX));
  }
  if (message.bodyLocKey) alert["loc-key"] = message.bodyLocKey;
  if (message.bodyLocArgs?.length) alert["loc-args"] = message.bodyLocArgs.map((arg) => clip(arg, TITLE_MAX));
  // The banner's title is the bot (name and face); an approval says the
  // question first in its body (bannerBody), never in a subtitle: a
  // communication notification and the watch drop or bury the subtitle.
  if (message.kind !== "approval" && message.routineName) {
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
  if (message.needsYou) payload.needsYou = true;
  if (message.proposalId) payload.proposalId = message.proposalId;
  if (message.routineRunId) payload.routineRunId = message.routineRunId;
  if (message.routineName) payload.routineName = clip(message.routineName, 80);
  const choices = pushChoices(message);
  const labels = pushChoiceLabels(message);
  // #2909: the answers ride only with labels a button shows whole; else the
  // category is Open (pushCategory) and the card in the chat has them
  if (choices.length && labels.length) {
    payload.choices = choices;
    payload.choiceLabels = labels;
  }
  if (message.cardId) payload.cardId = message.cardId.slice(0, 128);
  if (senderName) payload.senderName = senderName;
  if (senderId) payload.senderId = senderId;
  if (avatarUrl) payload.avatarUrl = avatarUrl;
  // The bot's look, for the extension to draw its mascot. A person has none.
  const look = senderName && message.senderLook ? pushSenderLook(message.senderLook) : undefined;
  if (look) {
    payload.senderLook = look;
    payload.senderLookVersion = senderLookVersion(look, avatarUrl);
  }
  let body = JSON.stringify(payload);
  // Never lose the push for its face: over the limit, the look goes.
  if (look && Buffer.byteLength(body) > APNS_PAYLOAD_MAX) {
    delete payload.senderLook;
    delete payload.senderLookVersion;
    body = JSON.stringify(payload);
  }
  // ...then the context shrinks to the plain banner line: never the push lost
  for (const max of [600, 300, 0]) {
    if (!contextBody || Buffer.byteLength(body) <= APNS_PAYLOAD_MAX) break;
    alert.body = bannerBody(message, max);
    body = JSON.stringify(payload);
  }
  // ...then the choices: the question still asks, with Open instead
  if (payload.choices && Buffer.byteLength(body) > APNS_PAYLOAD_MAX) {
    delete payload.choices;
    delete payload.choiceLabels;
    if (aps.category !== PROPOSAL_CATEGORY && (message.prompt === "question" || message.needsYou)) aps.category = OPEN_CATEGORY;
    body = JSON.stringify(payload);
  }
  const headers: Record<string, string> = {
    "apns-push-type": "alert",
    "apns-topic": input.bundleId,
    "apns-priority": String(pushPriority(message.kind)),
    "apns-collapse-id": collapseId(message),
    // a nudge is stale after a few minutes; the rest may wait a day
    "apns-expiration": String(Math.floor(input.nowMs / 1000) + (message.kind === "nudge" ? 5 * 60 : 24 * 60 * 60)),
  };
  return { headers, body };
}
