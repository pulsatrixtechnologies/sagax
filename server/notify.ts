// Notifications — what is worth interrupting someone for.
//
// `BotRecord.notifications` has been a switch in the settings panel that
// nothing read. This is the thing that reads it. The rule it encodes is
// small and deliberate: a bot that is *blocked on you* is worth a buzz, and
// a bot that *finished* is worth one if you asked for it; everything else a
// bot does while it works is not.
//
// A turn that dies before it starts is the first case, not the last: the
// bot is not working, and the fix is usually a setting only a person can
// change, so a retry cannot clear it. A routine failure already buzzed;
// this makes an interactive turn behave the same way.
// A routine parked behind a busy target earns one notice after half an
// hour: from outside the schedule looks broken, and only a person can
// decide whether the busy work or the routine matters more.
//
// Delivery is a separate concern. The harness emits a frame; whoever is
// listening decides what to do with it — desktop and paired-phone local
// notifications today, and closed-app APNs delivery once a relay exists.

import type { Notification, NotifyKind } from "../shared/notification.ts";

// The notification wire shape lives in shared/notification.ts now (part of
// the wire model); re-exported here so existing importers keep working.
export type { Notification, NotifyKind } from "../shared/notification.ts";

/** One line, short enough for a lock screen, with the newlines and code
 * fences of a model's answer flattened out of it. */
export function summarize(text: string, max = 140): string {
  const line = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export interface NotifyBot {
  id: string;
  name: string;
  threadId: string;
  notifications?: boolean;
}

/** The room a bot is holding while it works, as this module needs it. */
export interface NotifyRoom {
  id: string;
  name: string;
  threadId: string;
  busyBotId?: string | null;
}

/** Where a "blocked on you" notification has to open. A bot speaking in a
 * room is not reachable in its own 1:1 thread — the turn, its screen and the
 * card all live in the room — so the room wins while it owns that bot. A
 * room it merely belongs to, or one another member is speaking in, is not
 * where this bot is: those fall back to its own thread. */
export function blockedTarget(
  bot: NotifyBot,
  room?: NotifyRoom | null,
): { threadId: string; group?: { id: string; name: string } } {
  if (!room || room.busyBotId !== bot.id) return { threadId: bot.threadId };
  return { threadId: room.threadId, group: { id: room.id, name: room.name } };
}

/** A workspace spend notice (server/spend.ts decides when). It opens the
 * thread whose turn crossed the line, so clicking it lands somewhere real,
 * but it is the workspace's news, not that bot's: the bot's notification
 * toggle does not silence it. */
export function buildSpendNotification(
  bot: Pick<NotifyBot, "id" | "name">,
  threadId: string,
  text: { title: string; body: string },
): Notification {
  return { kind: "spend", botId: bot.id, botName: bot.name, threadId, title: text.title, body: summarize(text.body, 200) };
}

/** Build the frame for one event, or null when it should stay quiet.
 *
 * Kept pure and separate from the event fold so the policy — which is the
 * part people will argue about — can be read and tested on its own. */
export function buildNotification(
  kind: NotifyKind,
  bot: NotifyBot,
  threadId: string,
  detail: string,
  extra?: {
    avatarUrl?: string;
    group?: { id: string; name: string };
    title?: string;
    requestId?: string;
    needsKey?: boolean;
    routineRunId?: string;
    routineName?: string;
    choices?: readonly string[];
  },
): Notification | null {
  // The toggle means what it says: off is off, including for approvals.
  // A bot whose notifications you turned off can still block waiting for
  // you — that is the choice you made, and the chat still shows the card.
  if (bot.notifications === false) return null;

  const body = summarize(detail);
  // A bot working in a room is not "Scout" to whoever reads the banner — it
  // is Scout, in that room. Name the room or the notification reads as if it
  // came from the 1:1 thread it will not open.
  const who = extra?.group ? `${bot.name} in ${extra.group.name}` : bot.name;
  // An approval names what it allows ("Allow Nova to run a command?"):
  // the caller passes the card's own plain title, never a tool id.
  const title = extra?.title ? summarize(extra.title, 120) :
    kind === "approval"
      ? `${who} needs approval`
      : kind === "question"
        ? `${who} has a question`
        : kind === "takeover"
          ? `${who} needs your hands`
          : kind === "routine-failed"
            ? `${who}'s routine failed`
            : kind === "routine-deferred"
              ? `${who}'s routine is waiting`
            : kind === "turn-failed"
              ? `${who} couldn't start`
              : kind === "incident"
                ? `${who} hit a problem`
                : kind === "delegation-settled"
                  ? `${who} resumed with results`
                  : kind === "wait"
                    ? `${who}'s wait is done`
                  : `${who} finished`;

  // A "finished" with nothing to say is not worth a notification — the
  // badge in the sidebar already carries that much.
  if (kind === "done" && !body) return null;

  const notification: Notification = { kind, botId: bot.id, botName: bot.name, threadId, title, body };
  if (extra?.avatarUrl) notification.avatarUrl = extra.avatarUrl;
  if (extra?.group) notification.groupId = extra.group.id;
  if (extra?.requestId) notification.requestId = extra.requestId;
  if (extra?.needsKey) notification.needsKey = true;
  if (extra?.routineRunId) notification.routineRunId = extra.routineRunId.slice(0, 128);
  if (extra?.routineName) notification.routineName = summarize(extra.routineName, 80);
  // the card's own question, in the person's words: first on the phone
  if ((kind === "approval" || kind === "question") && extra?.title) notification.ask = title;
  if (kind === "question" && extra?.choices?.length) {
    const choices = notificationChoices(extra.choices);
    if (choices.length) notification.choices = choices;
  }
  return notification;
}

/** At most this many choices ride a notification; the phone shows fewer. */
export const NOTIFICATION_CHOICES_MAX = 10;
/** A choice longer than this is clipped: a button, not a paragraph. */
export const NOTIFICATION_CHOICE_MAX = 60;

/** A question's choices as a banner can carry them: one line each, clipped,
 * no blanks, no repeats, at most NOTIFICATION_CHOICES_MAX. */
export function notificationChoices(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const choice = summarize(value, NOTIFICATION_CHOICE_MAX);
    if (!choice || out.includes(choice)) continue;
    out.push(choice);
    if (out.length >= NOTIFICATION_CHOICES_MAX) break;
  }
  return out;
}

/** The same frame as buildNotification, without the bot-wide switch. Delivery
 * decides per person (viewerWantsBotNotification): a viewer who turned
 * notifications on still hears a bot whose owner turned them off. */
export function deliverableNotification(
  kind: NotifyKind,
  bot: NotifyBot,
  threadId: string,
  detail: string,
  extra?: {
    avatarUrl?: string;
    group?: { id: string; name: string };
    title?: string;
    requestId?: string;
    needsKey?: boolean;
    routineRunId?: string;
    routineName?: string;
    choices?: readonly string[];
  },
): Notification | null {
  return buildNotification(kind, { ...bot, notifications: undefined }, threadId, detail, extra);
}

/** A conversation on a live voice call does not buzz: the person hears the
 * bot answer, ask and finish on the call itself (the phone and the desktop
 * stand their own alerts down for the thread on a call; this keeps the
 * server's frame, and any push a relay would make of it, quiet too). The
 * server knows a call from the page (POST /voice/call, start to end) and by
 * its turns (Message.voiceCall): one counts as live while the page says so,
 * or while the thread's latest message from the person is a call turn sent
 * within CALL_QUIET_MS. A written message after the call, or a call long
 * over, makes the thread notify again. Workspace spend notices always go. */
export const CALL_QUIET_MS = 30 * 60_000;

export function quietForCall(
  notification: Pick<Notification, "kind"> | null,
  lastPersonMessage: { at?: number; voiceCall?: unknown } | undefined,
  now: number,
  /** the thread is on a call the page started (server/voice-call-session.ts) */
  callLive = false,
): boolean {
  if (!notification || notification.kind === "spend") return false;
  if (callLive) return true;
  if (!lastPersonMessage?.voiceCall) return false;
  return now - (lastPersonMessage.at ?? 0) < CALL_QUIET_MS;
}
