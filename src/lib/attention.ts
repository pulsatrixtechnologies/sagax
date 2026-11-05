// What a new message or a nudge does on THIS computer: a notification, its
// sound, whether it stays, the Dock bounce or taskbar flash, the window
// shake. Pure rules here; the shell does the work (electron/desktop-attention.mjs)
// and a browser falls back to the web Notification API (src/lib/notify.ts).
import type { NotifyKind } from "../../shared/notification";
import type { AttentionSettings } from "./notification-preferences";

/** A nudge older than this is a replay after the stream came back (the
 * window was asleep or offline): it leaves its line in the chat, but it no
 * longer shakes or rings. Wide enough for clocks a little apart. */
export const NUDGE_FRESH_MS = 2 * 60_000;

export type Bounce = "critical" | "informational" | null;

export interface MessageAttention {
  show: boolean;
  sound: boolean;
  persistent: boolean;
  bounce: Bounce;
  flash: boolean;
}

/** A `notify` frame (a person's direct message, a bot's question, a turn
 * that finished...). Shown unless the person is looking at that very
 * conversation in a focused window; a spend notice always shows. A direct
 * message from a person bounces the Dock until they look and flashes the
 * taskbar; a bot waiting on an answer bounces once. */
export function messageAttention(input: {
  kind: NotifyKind;
  threadId: string;
  windowFocused: boolean;
  activeThreadId: string | null;
  settings: AttentionSettings;
}): MessageAttention {
  const looking = input.windowFocused && Boolean(input.activeThreadId) && input.activeThreadId === input.threadId;
  const show = input.kind === "spend" || !looking;
  if (!show) return { show: false, sound: false, persistent: false, bounce: null, flash: false };
  const fromPerson = input.kind === "message";
  const waitsOnYou = input.kind === "question" || input.kind === "approval" || input.kind === "needs-you";
  return {
    show: true,
    sound: input.settings.sound,
    persistent: input.settings.persistent,
    bounce: fromPerson ? "critical" : waitsOnYou ? "informational" : null,
    flash: fromPerson || waitsOnYou,
  };
}

export interface NudgeAttention {
  /** False for a stale replay: nothing rings, nothing moves. */
  fresh: boolean;
  sound: boolean;
  shake: boolean;
  /** A notification too, when the window is not the one in front. */
  notify: boolean;
}

/** A nudge addressed to this person, or one this person just sent (the
 * caller passes `windowFocused: true` then: no notification for one's own
 * nudge). Both windows shake and ring. */
export function nudgeAttention(input: {
  at: number;
  now: number;
  windowFocused: boolean;
  settings: AttentionSettings;
}): NudgeAttention {
  const fresh = Number.isFinite(input.at) && Math.abs(input.now - input.at) <= NUDGE_FRESH_MS;
  if (!fresh) return { fresh: false, sound: false, shake: false, notify: false };
  return {
    fresh: true,
    sound: input.settings.nudgeSound,
    shake: input.settings.nudgeShake,
    notify: !input.windowFocused,
  };
}

/** The number on the Dock / taskbar icon: the unread conversations, or
 * nothing when this computer turned the badge off. */
export function badgeCount(unread: number, settings: Pick<AttentionSettings, "badge">): number {
  if (!settings.badge || !Number.isFinite(unread) || unread <= 0) return 0;
  return Math.floor(unread);
}

/** Where a notification click goes, by notification id. Bounded: the oldest
 * targets are forgotten first. */
export function createNotificationTargets<T>(limit = 100) {
  const targets = new Map<string, T>();
  let next = 0;
  return {
    add(target: T): string {
      next += 1;
      const id = `sagax-notification:${next}`;
      targets.set(id, target);
      if (targets.size > limit) targets.delete(targets.keys().next().value!);
      return id;
    },
    take(id: string): T | undefined {
      const target = targets.get(id);
      targets.delete(id);
      return target;
    },
  };
}
