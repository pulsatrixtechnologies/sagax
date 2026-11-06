// Native OS notification presentation (Apple HIG + Windows Action Center).
// Pure rules: title, subtitle, body preview, chat grouping, focused
// suppression, and which Settings > Notifications type gate applies.
// The desktop shell shows the banner (electron/desktop-attention.mjs).
import type { NotifyKind } from "../../shared/notification";
import { plainPreviewText } from "./plain-preview";

export const NATIVE_BODY_MAX = 140;

/** Settings > Notifications type toggles. */
export type NotificationType = "bots" | "people" | "groups" | "approvals" | "routines";

export type NotificationTypeSettings = Record<NotificationType, boolean>;

/** Map a harness notify kind (+ optional room) to a Settings type. */
export function notificationTypeFor(
  kind: NotifyKind,
  groupId?: string | null,
): NotificationType | null {
  switch (kind) {
    case "approval":
    case "question":
    case "needs-you":
    case "takeover":
      return "approvals";
    case "routine-failed":
    case "routine-deferred":
      return "routines";
    case "message":
      // People DMs use a group record on the wire; they stay under People.
      return "people";
    case "page-comment":
      return "people";
    case "spend":
    case "report":
    case "admin-action":
      // Workspace / admin notices: always eligible (no per-type mute).
      return null;
    case "done":
    case "turn-failed":
    case "incident":
    case "delegation-settled":
    case "wait":
      return groupId ? "groups" : "bots";
    default:
      return groupId ? "groups" : "bots";
  }
}

/** True when this computer's type switch allows the kind. */
export function notificationTypeEnabled(
  kind: NotifyKind,
  groupId: string | null | undefined,
  settings: NotificationTypeSettings,
): boolean {
  const type = notificationTypeFor(kind, groupId);
  if (!type) return true;
  return settings[type] !== false;
}

/** Stable key the OS replaces under: one live banner per chat. */
export function notificationGroupKey(input: {
  kind: NotifyKind;
  threadId: string;
  groupId?: string | null;
  botId?: string;
}): string {
  if (input.kind === "spend") return "sagax:spend";
  if (input.kind === "report") return "sagax:report";
  if (input.threadId) return `sagax:chat:${input.threadId}`;
  if (input.groupId) return `sagax:group:${input.groupId}`;
  if (input.botId) return `sagax:bot:${input.botId}`;
  return `sagax:kind:${input.kind}`;
}

/** Plain-text body for the banner: markdown stripped, capped. */
export function notificationBodyPreview(text: string, max = NATIVE_BODY_MAX): string {
  const plain = plainPreviewText(text).replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trimEnd()}…`;
}

export interface NativeNotificationPayloadInput {
  kind: NotifyKind;
  /** Bot or person display name (title). */
  senderName: string;
  /** Room / group name when the event is in a group. */
  groupName?: string | null;
  body: string;
  threadId: string;
  groupId?: string | null;
  botId?: string;
  /** How many pending notices this chat already stacked (before this one). */
  pendingCount?: number;
  windowFocused: boolean;
  activeThreadId: string | null;
  /** macOS gets a real subtitle; Windows folds it into the title. */
  platform: "darwin" | "win32" | "linux" | "web" | string;
  /** Inline reply when the destination can take a message. */
  canReply?: boolean;
  typeSettings: NotificationTypeSettings;
  /** False when the bot wrote the message with `notify: false`: it stays
   * in the chat, unread as usual, and no banner shows. */
  notify?: boolean;
}

export interface NativeNotificationPayload {
  show: boolean;
  title: string;
  subtitle: string;
  body: string;
  groupKey: string;
  /** Electron Notification `id`: same value replaces the previous banner. */
  replaceId: string;
  hasReply: boolean;
  type: NotificationType | null;
  count: number;
}

/**
 * Build the OS banner for one notify frame. Null-ish fields are empty
 * strings; `show` is false when the person is already looking at that chat,
 * the type switch is off (spend always shows when looking) or the bot wrote
 * the message with `notify: false`.
 */
export function buildNativeNotificationPayload(
  input: NativeNotificationPayloadInput,
): NativeNotificationPayload {
  const type = notificationTypeFor(input.kind, input.groupId);
  const typeOk = notificationTypeEnabled(input.kind, input.groupId, input.typeSettings);
  const looking =
    input.windowFocused &&
    Boolean(input.activeThreadId) &&
    input.activeThreadId === input.threadId;
  const show = input.notify !== false && typeOk && (input.kind === "spend" || !looking);

  const sender = (input.senderName || "").replace(/\s+/g, " ").trim() || "Sagax";
  const group = (input.groupName || "").replace(/\s+/g, " ").trim();
  const groupKey = notificationGroupKey(input);
  const pending = Number.isFinite(input.pendingCount) && (input.pendingCount as number) > 0
    ? Math.floor(input.pendingCount as number)
    : 0;
  const count = pending + 1;
  let body = notificationBodyPreview(input.body);
  if (count > 1) {
    const prefix = count === 2 ? "2 messages" : `${count} messages`;
    const rest = body ? `: ${body}` : "";
    body = notificationBodyPreview(`${prefix}${rest}`);
  }

  let title = sender;
  let subtitle = "";
  if (group) {
    if (input.platform === "darwin") {
      subtitle = group;
    } else {
      title = `${sender} · ${group}`;
    }
  }

  return {
    show,
    title,
    subtitle,
    body,
    groupKey,
    replaceId: groupKey,
    hasReply: Boolean(input.canReply && show && input.threadId),
    type,
    count,
  };
}
