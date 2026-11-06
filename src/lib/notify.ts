// Desktop notifications, driven by the harness's {kind:"notify"} frames.
// The server decides *whether* something is worth an interruption (it owns
// the per-bot toggle); this only decides how to show it here (HIG payload,
// chat grouping, type switches, shell vs browser).
import type { Notification } from "../../shared/notification";
import { createNotificationTargets, messageAttention, type MessageAttention } from "./attention";
import {
  buildNativeNotificationPayload,
  notificationGroupKey,
  type NotificationTypeSettings,
} from "./native-notification-payload";
import { attentionSettings } from "./notification-preferences";
import { notificationSoundPlan, playNotificationSound, toneReady } from "./notification-sound";

export type NotifyFrame = Notification;

export type NotificationTarget = Pick<NotifyFrame, "botId" | "threadId" | "routineRunId"> & { groupId?: string };

/** Ask while handling the settings click. Browsers may reject permission
 * requests that are triggered later by an incoming SSE frame. */
export function requestNotificationPermission(): Promise<NotificationPermission> | null {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return null;
  return Notification.requestPermission();
}

/** Identity used for web Notification `tag` / icon. Grouped by chat. */
export interface NotificationChatIdentity {
  threadId: string;
  botId?: string;
  avatarUrl?: string | null;
  kind?: NotifyFrame["kind"];
}

/** Presentation options: one replaced banner per chat (`tag`), plus avatar. */
export function buildNotificationOptions(chat: NotificationChatIdentity): NotificationOptions {
  const tag = notificationGroupKey({
    kind: chat.kind ?? "done",
    threadId: chat.threadId,
    botId: chat.botId,
  });
  return { tag, icon: chat.avatarUrl ?? undefined };
}

/** @deprecated Prefer buildNotificationOptions with a thread id. Kept for
 * older call sites that still key by bot. */
export interface NotificationBotIdentity {
  id: string;
  avatarUrl?: string | null;
}

interface PendingClick {
  open: () => void;
  reply?: (text: string) => void;
}

const pendingClicks = createNotificationTargets<PendingClick>();
/** Pending banner counts per chat group key (replaced, not stacked). */
const pendingCounts = new Map<string, number>();
let clicksWired = false;
/** Opens a target the shell sent back when the page no longer holds the
 * notification id (the page reloaded while the banner waited). */
let openByTarget: ((target: NotificationTarget) => void) | null = null;
/** Sends an inline reply into the open chat (wired by the shell effects). */
let replyByTarget: ((target: NotificationTarget, text: string) => void) | null = null;

function targetFromShell(raw: unknown): NotificationTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
  const target: NotificationTarget = { botId: text("botId"), threadId: text("threadId") };
  if (text("groupId")) target.groupId = text("groupId");
  if (text("routineRunId")) target.routineRunId = text("routineRunId");
  return target.threadId || target.routineRunId || target.botId ? target : null;
}

function shellIconPath(avatarUrl?: string | null): string | undefined {
  if (!avatarUrl) return undefined;
  // Electron Notification.icon needs a local path or data URL, not /api/...
  if (avatarUrl.startsWith("data:") || avatarUrl.startsWith("file:") || /^[a-zA-Z]:\\/.test(avatarUrl) || avatarUrl.startsWith("/")) {
    if (avatarUrl.startsWith("/api/") || avatarUrl.startsWith("/attachments")) return undefined;
    // Absolute filesystem paths only (macOS /..., Windows C:\...)
    if (avatarUrl.startsWith("/") && !avatarUrl.startsWith("//") && avatarUrl.includes(".")) return avatarUrl;
    if (avatarUrl.startsWith("data:") || avatarUrl.startsWith("file:") || /^[a-zA-Z]:\\/.test(avatarUrl)) return avatarUrl;
  }
  return undefined;
}

/** The shell tells the page which of its notifications was clicked or
 * replied to; the page knows where that one goes. Wired once. */
function wireDesktopClicks(): void {
  if (clicksWired || typeof window === "undefined") return;
  const listen = window.ogb?.onNotificationClick;
  if (!listen) return;
  clicksWired = true;
  listen((id, target) => {
    const pending = pendingClicks.take(id);
    if (pending) {
      clearPendingForTarget(targetFromShell(target) ?? undefined);
      return pending.open();
    }
    const fallback = targetFromShell(target);
    if (fallback) {
      clearPendingForTarget(fallback);
      openByTarget?.(fallback);
    }
  });
  window.ogb?.onNotificationReply?.((id, reply, target) => {
    const pending = pendingClicks.take(id);
    const resolved = targetFromShell(target);
    if (pending?.reply) {
      clearPendingForTarget(resolved ?? undefined);
      pending.reply(reply);
      return;
    }
    if (resolved) {
      clearPendingForTarget(resolved);
      openByTarget?.(resolved);
      replyByTarget?.(resolved, reply);
    }
  });
}

function windowFocused(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
}

function shellPlatform(): string {
  try {
    return window.ogb?.platform ?? "web";
  } catch {
    return "web";
  }
}

function typeSettingsFromAttention(): NotificationTypeSettings {
  const settings = attentionSettings();
  return {
    bots: settings.bots,
    people: settings.people,
    groups: settings.groups,
    approvals: settings.approvals,
    routines: settings.routines,
  };
}

function clearPendingMatching(match: string): void {
  const drop: string[] = [];
  for (const key of pendingCounts.keys()) {
    if (key.includes(match)) drop.push(key);
  }
  for (const key of drop) pendingCounts.delete(key);
}

function clearPendingForTarget(target?: NotificationTarget | null): void {
  if (!target?.threadId) return;
  clearPendingMatching(target.threadId);
}

/** Forget stacked counts when the person opens that chat (test seam). */
export function clearNotificationPendingCount(threadId: string): void {
  clearPendingMatching(threadId);
}

/** Test seam: drop every stacked chat count. */
export function resetNotificationPendingCounts(): void {
  pendingCounts.clear();
}

/** Hand one notification to the desktop shell (it can stay until dismissed,
 * bounce the Dock, flash the taskbar), or to the browser's Notification API.
 * False when neither can show it. */
export function presentNotification(input: {
  title: string;
  body: string;
  attention: Omit<MessageAttention, "show">;
  open: () => void;
  /** Where the click goes, handed to the shell and sent back with the click. */
  target?: NotificationTarget;
  web?: NotificationOptions;
  /** withdrawNotification(key) takes it down again */
  withdrawKey?: string;
  subtitle?: string;
  replaceId?: string;
  groupKey?: string;
  hasReply?: boolean;
  replyPlaceholder?: string;
  icon?: string;
  onReply?: (text: string) => void;
}): boolean {
  // Settings > Notifications > Notification sound: a chosen tone is played
  // here and the notification itself is sent silent.
  const plan = notificationSoundPlan(input.attention.sound);
  if (typeof window !== "undefined" && window.ogb?.notify) {
    wireDesktopClicks();
    const id = pendingClicks.add({
      open: input.open,
      ...(input.onReply ? { reply: input.onReply } : {}),
    });
    window.ogb.notify({
      id,
      title: input.title,
      body: input.body,
      sound: plan.platformSound,
      persistent: input.attention.persistent,
      bounce: input.attention.bounce,
      flash: input.attention.flash,
      ...(input.target ? { target: input.target } : {}),
      ...(input.withdrawKey ? { withdrawKey: input.withdrawKey } : {}),
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
      ...(input.replaceId ? { replaceId: input.replaceId } : {}),
      ...(input.groupKey ? { groupKey: input.groupKey } : {}),
      ...(input.hasReply ? { hasReply: true, replyPlaceholder: input.replyPlaceholder ?? "Reply" } : {}),
      ...(input.icon ? { icon: input.icon } : {}),
    });
    if (plan.tone) playNotificationSound(plan.tone);
    return true;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const options: NotificationOptions = {
    ...input.web,
    body: input.body,
    // Chromium keeps it on screen until the person acts on it.
    requireInteraction: input.attention.persistent,
    // The banner still lands; only the platform's alert sound is held back,
    // which is what a person on a call with the bot asked for.
    ...(plan.platformSound || (plan.tone && !toneReady()) ? {} : { silent: true }),
  };
  const note = new Notification(input.title, options);
  if (plan.tone) playNotificationSound(plan.tone);
  note.onclick = () => {
    window.focus();
    input.open();
  };
  if (input.withdrawKey) {
    shownForWithdraw.set(input.withdrawKey, [...(shownForWithdraw.get(input.withdrawKey) ?? []), note].slice(-5));
    note.onclose = () => shownForWithdraw.delete(input.withdrawKey!);
    if (shownForWithdraw.size > 50) shownForWithdraw.delete(shownForWithdraw.keys().next().value!);
  }
  return true;
}

/** Browser notifications still on screen, by withdraw key. */
const shownForWithdraw = new Map<string, InstanceType<typeof globalThis.Notification>[]>();

/** The key an approval's notification is shown and withdrawn under. */
export function approvalWithdrawKey(threadId: string, requestId: string): string {
  return `approval:${threadId}:${requestId}`;
}

/** An approval was answered on another device, or expired: take its
 * notification down here too (desktop shell or browser). */
export function withdrawNotification(withdrawKey: string): void {
  if (typeof window !== "undefined" && window.ogb?.withdrawNotification) window.ogb.withdrawNotification(withdrawKey);
  for (const note of shownForWithdraw.get(withdrawKey) ?? []) {
    try { note.close(); } catch { /* already gone */ }
  }
  shownForWithdraw.delete(withdrawKey);
}

export interface ShowNotificationContext {
  /** Room name for the macOS subtitle / Windows "Name · Group" title. */
  groupName?: string | null;
  /** When set, an inline reply is posted through this callback. */
  onReply?: (target: NotificationTarget, text: string) => void;
}

/** Show one unless the exact destination conversation is already visible
 * in a focused window, or the matching Settings type switch is off. */
export function showNotification(
  frame: NotifyFrame,
  onOpen: (target: NotificationTarget) => void,
  avatarUrl?: string | null,
  visibleThreadId?: string | null,
  context?: ShowNotificationContext,
) {
  const settings = attentionSettings();
  const focused = windowFocused();
  const activeThreadId = visibleThreadId ?? null;
  const groupKey = notificationGroupKey({
    kind: frame.kind,
    threadId: frame.threadId,
    groupId: frame.groupId,
    botId: frame.botId,
  });
  const pendingCount = pendingCounts.get(groupKey) ?? 0;
  const canReply = Boolean(
    frame.threadId &&
    frame.kind !== "spend" &&
    frame.kind !== "report" &&
    frame.kind !== "admin-action",
  );
  // HIG: title is the bot or person name. Server titles like "Scout finished"
  // stay out of the OS title; the body carries the preview.
  const senderName = (
    frame.botName?.trim()
    || (frame.kind === "message" || frame.kind === "page-comment" ? frame.title : "")
    || frame.botName
    || "Sagax"
  ).trim() || "Sagax";
  const payload = buildNativeNotificationPayload({
    kind: frame.kind,
    senderName,
    groupName: context?.groupName,
    body: frame.body || frame.ask || "",
    threadId: frame.threadId,
    groupId: frame.groupId,
    botId: frame.botId,
    pendingCount,
    windowFocused: focused,
    activeThreadId,
    platform: shellPlatform(),
    canReply,
    typeSettings: typeSettingsFromAttention(),
    ...(frame.notify === false ? { notify: false } : {}),
  });
  if (!payload.show) return;

  const attention = messageAttention({
    kind: frame.kind,
    threadId: frame.threadId,
    windowFocused: focused,
    activeThreadId,
    settings,
  });
  if (!attention.show) return;

  openByTarget = onOpen;
  if (context?.onReply) replyByTarget = context.onReply;
  const target: NotificationTarget = {
    botId: frame.botId,
    threadId: frame.threadId,
    ...(frame.groupId ? { groupId: frame.groupId } : {}),
    ...(frame.routineRunId ? { routineRunId: frame.routineRunId } : {}),
  };
  pendingCounts.set(groupKey, payload.count);
  const spend = frame.kind === "spend";
  const icon = shellIconPath(avatarUrl ?? frame.avatarUrl);
  presentNotification({
    target,
    ...(frame.requestId && frame.threadId ? { withdrawKey: approvalWithdrawKey(frame.threadId, frame.requestId) } : {}),
    title: payload.title,
    subtitle: payload.subtitle,
    body: payload.body,
    replaceId: payload.replaceId,
    groupKey: payload.groupKey,
    hasReply: payload.hasReply,
    replyPlaceholder: "Reply",
    ...(icon ? { icon } : {}),
    attention,
    open: () => {
      clearPendingForTarget(target);
      onOpen(target);
    },
    onReply: (text) => {
      clearPendingForTarget(target);
      onOpen(target);
      (context?.onReply ?? replyByTarget)?.(target, text);
    },
    web: {
      ...buildNotificationOptions({
        threadId: frame.threadId,
        botId: frame.botId,
        avatarUrl,
        kind: frame.kind,
      }),
      ...(spend ? { tag: "sagax:spend", icon: undefined } : {}),
      ...(payload.subtitle ? { /* browsers have no subtitle */ } : {}),
    },
  });
}
