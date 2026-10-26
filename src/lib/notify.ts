// Desktop notifications, driven by the harness's {kind:"notify"} frames.
// The server decides *whether* something is worth an interruption (it owns
// the per-bot toggle); this only decides how to show it here.
import type { Notification } from "../../shared/notification";
import { createNotificationTargets, messageAttention, type MessageAttention } from "./attention";
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

/** The identity a notification groups under: one bot, wherever it was
 * working. Keyed by bot rather than thread so a single bot running across
 * tasks and rooms coalesces into one stack instead of stacking banners. */
export interface NotificationBotIdentity {
  id: string;
  avatarUrl?: string | null;
}

/** Presentation options for one bot's notifications: the stable per-bot
 * coalescing key platforms replace on (`tag`) and its avatar, when the
 * profile has one. Pure so the grouping rule stays testable on its own. */
export function buildNotificationOptions(bot: NotificationBotIdentity): NotificationOptions {
  return { tag: `openmausbot:${bot.id}`, icon: bot.avatarUrl ?? undefined };
}

interface PendingClick {
  open: () => void;
}

const pendingClicks = createNotificationTargets<PendingClick>();
let clicksWired = false;
/** Opens a target the shell sent back when the page no longer holds the
 * notification id (the page reloaded while the banner waited). */
let openByTarget: ((target: NotificationTarget) => void) | null = null;

function targetFromShell(raw: unknown): NotificationTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
  const target: NotificationTarget = { botId: text("botId"), threadId: text("threadId") };
  if (text("groupId")) target.groupId = text("groupId");
  if (text("routineRunId")) target.routineRunId = text("routineRunId");
  return target.threadId || target.routineRunId || target.botId ? target : null;
}

/** The shell tells the page which of its notifications was clicked; the
 * page knows where that one goes. Wired once, on the first notification. */
function wireDesktopClicks(): void {
  if (clicksWired || typeof window === "undefined") return;
  const listen = window.ogb?.onNotificationClick;
  if (!listen) return;
  clicksWired = true;
  listen((id, target) => {
    const pending = pendingClicks.take(id);
    if (pending) return pending.open();
    const fallback = targetFromShell(target);
    if (fallback) openByTarget?.(fallback);
  });
}

function windowFocused(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
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
}): boolean {
  // Settings > Notifications > Notification sound: a chosen tone is played
  // here and the notification itself is sent silent.
  const plan = notificationSoundPlan(input.attention.sound);
  if (typeof window !== "undefined" && window.ogb?.notify) {
    wireDesktopClicks();
    window.ogb.notify({
      id: pendingClicks.add({ open: input.open }),
      title: input.title,
      body: input.body,
      sound: plan.platformSound,
      persistent: input.attention.persistent,
      bounce: input.attention.bounce,
      flash: input.attention.flash,
      ...(input.target ? { target: input.target } : {}),
      ...(input.withdrawKey ? { withdrawKey: input.withdrawKey } : {}),
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

/** Show one unless the exact destination conversation is already visible
 * in a focused window. A focused app may still be showing another task
 * (routine runs are detached), so window focus alone is not proof that the
 * actionable card can be seen. */
export function showNotification(
  frame: NotifyFrame,
  onOpen: (target: NotificationTarget) => void,
  avatarUrl?: string | null,
  visibleThreadId?: string | null,
) {
  const attention = messageAttention({
    kind: frame.kind,
    threadId: frame.threadId,
    windowFocused: windowFocused(),
    activeThreadId: visibleThreadId ?? null,
    settings: attentionSettings(),
  });
  if (!attention.show) return;
  const spend = frame.kind === "spend";
  openByTarget = onOpen;
  const target: NotificationTarget = {
    botId: frame.botId,
    threadId: frame.threadId,
    ...(frame.groupId ? { groupId: frame.groupId } : {}),
    ...(frame.routineRunId ? { routineRunId: frame.routineRunId } : {}),
  };
  presentNotification({
    target,
    ...(frame.requestId && frame.threadId ? { withdrawKey: approvalWithdrawKey(frame.threadId, frame.requestId) } : {}),
    title: frame.title,
    body: frame.body,
    attention,
    open: () => onOpen(target),
    web: {
      ...buildNotificationOptions({ id: frame.botId, avatarUrl }),
      // its own stack, so a bot's next "finished" never replaces it
      ...(spend ? { tag: "openmausbot:spend", icon: undefined } : {}),
    },
  });
}
