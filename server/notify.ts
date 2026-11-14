// Notifications — what is worth interrupting someone for.
//
// `BotRecord.notifications` has been a switch in the settings panel that
// nothing read. This is the thing that reads it. The rule it encodes is
// small and deliberate: a bot that is *blocked on you* is worth a buzz, and
// a bot that *finished* is worth one if you asked for it; everything else a
// bot does while it works is not.
//
// #3719 (2026-11-11): one rule decides what interrupts, for every frame on
// its way out (ruleNotifyFrame): an ask, or the answer to the person's own
// line. A turn the person did not start that ends, fails or is cut, a
// routine that failed or waits, an incident, a settled delegation, a notice
// and a spend line keep their place in the chat, Today and the badge, and
// go as `notify: false`: no sound, no banner, no bounce, no push.
//
// #4233 (2026-11-13): the person's quiet hours and day budget
// (shared/signal-levels.ts) rule the same frame: an interrupting frame the
// gate holds goes `notify: false` too, so the desktop, its shell and the
// phone follow one verdict. What is urgent still rings.
//
// Delivery is a separate concern. The harness emits a frame; whoever is
// listening decides what to do with it — desktop and paired-phone local
// notifications today, and closed-app APNs delivery once a relay exists.

import { decideAttention, isSignalLevel, type AttentionDecision } from "../shared/attention-policy.ts";
import type { Notification, NotifyKind } from "../shared/notification.ts";
import { buildNotificationContext, notificationChoiceLabels } from "../shared/notification-context.ts";
import { plainPreviewLine } from "../shared/plain-text.ts";
import { serverAttachmentLabels } from "./approvals/approval-words.ts";
import { isShuttingDown } from "./process/http-shutdown.ts";

// The notification wire shape lives in shared/notification.ts now (part of
// the wire model); re-exported here so existing importers keep working.
export type { Notification, NotifyKind } from "../shared/notification.ts";
export { botNotifyArg, notificationAlerts, withBotNotify } from "../shared/notification.ts";

/** One line, short enough for a lock screen: the Markdown of a model's
 * answer read as plain words first (a table as `key : value`, code fences
 * gone), then the newlines flattened and the line cut at a word. Flattening
 * first left `| Champ | Valeur | | --- |` on a phone (2026-11-08). */
export function summarize(text: string, max = 140): string {
  return plainPreviewLine(text ?? "", max, { dropCode: true, attachmentLabels: serverAttachmentLabels() });
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

/** A workspace spend notice (server/usage/spend.ts decides when). It opens the
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

/** Something Sagax did on its own about `bot` that the person hears once, in one plain line. */
export function buildNoticeNotification(bot: Pick<NotifyBot, "id" | "name">, threadId: string, text: string): Notification {
  return { kind: "notice", botId: bot.id, botName: bot.name, threadId, title: bot.name, body: summarize(text, 240) };
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
    site?: string;
    needsKey?: boolean;
    routineRunId?: string;
    routineName?: string;
    choices?: readonly string[];
    /** #2909: the bot's short label per choice (ask_choice `{label}`). */
    choiceLabels?: readonly (string | undefined)[];
    /** #2909: what each choice does (ask_choice `{detail}`). */
    choiceDetails?: readonly (string | undefined)[];
    /** #2909: the full detail behind the one-line body (markdown welcome). */
    context?: string;
    /** #2909: the question the person answers, when the title is the kind's
     * own (a needs-you card): it leads the context. */
    question?: string;
    /** #2909: the chat message holding the card. */
    cardId?: string;
    proposalId?: string;
    /** #3719: the turn began with the person's own line in this conversation. */
    personTurn?: boolean;
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
        : kind === "sign-in"
          ? `${who} needs you to sign in to ${extra?.site ?? "a website"}`
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
                  : kind === "needs-you"
                    ? `${who} needs you`
                  : kind === "proposal"
                    ? `${who} has a suggestion`
                  : kind === "takeover"
                    ? `${who} needs your hands`
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
  if (kind === "proposal" && extra?.proposalId) notification.proposalId = extra.proposalId.slice(0, 128);
  // the card's own question, in the person's words: first on the phone
  if ((kind === "approval" || kind === "question") && extra?.title) notification.ask = title;
  const asks = kind === "approval" || kind === "question" || kind === "needs-you";
  if ((kind === "question" || kind === "needs-you") && extra?.choices?.length) {
    const choices = notificationChoices(extra.choices);
    // one answer is not a choice: the card in the chat holds it
    if (choices.length >= 2) {
      notification.choices = choices;
      // #2909: short labels the buttons show whole, else Open only
      const labels = notificationChoiceLabels(choices, extra.choiceLabels ?? []);
      if (labels.legible && labels.labels) notification.choiceLabels = labels.labels;
    }
  }
  // #2909: never a choice without its context
  if (asks) {
    const context = buildNotificationContext({
      question: extra?.question ?? extra?.title ?? "",
      detail: extra?.context?.trim() ? extra.context : detail,
      choices: (notification.choices ?? []).map((answer, index) => ({
        answer,
        label: notification.choiceLabels?.[index],
        detail: extra?.choiceDetails?.[index],
      })),
    });
    if (context) notification.context = context;
  }
  if (extra?.cardId) notification.cardId = extra.cardId.slice(0, 128);
  if (extra?.personTurn) notification.personTurn = true;
  return notification;
}

/** The title of a run's failure or wait notification when the run is not a
 * routine's: a proactive wake or a webhook run says which run it is
 * (2026-11-02). Undefined for a routine's run: the kind's own title. */
export function routineRunTitle(who: string, run: { proactive?: unknown; webhookId?: string }, state: "failed" | "waiting" | "blocked"): string | undefined {
  if (run.proactive) return state === "failed" ? `${who}'s proactive wake failed` : `${who}'s proactive wake is ${state}`;
  if (run.webhookId) return state === "failed" ? `${who}'s webhook run failed` : `${who}'s webhook run is ${state}`;
  return undefined;
}

/** The title a failed run's incident carries in the console's problem log and
 * inbox. It names the run, never the thread the run reported into: a routine
 * without a thread of its own reports into the bot's main thread, whose title
 * is whatever someone last asked the bot there, unrelated to the routine. */
export function routineIncidentTitle(who: string, run: { proactive?: unknown; webhookId?: string; routineName: string }): string {
  return routineRunTitle(who, run, "failed") ?? (run.routineName.trim() || "Routine failed");
}

/** At most this many choices ride a notification; the phone shows fewer. */
export const NOTIFICATION_CHOICES_MAX = 10;
/** A choice longer than this is clipped. It is the answer sent, so it keeps
 * a card option whole (OPTIONS_CARD_LIMITS.option); the button shows its
 * short label (#2909). */
export const NOTIFICATION_CHOICE_MAX = 120;

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
    site?: string;
    needsKey?: boolean;
    routineRunId?: string;
    routineName?: string;
    choices?: readonly string[];
    /** #2909: the bot's short label per choice (ask_choice `{label}`). */
    choiceLabels?: readonly (string | undefined)[];
    /** #2909: what each choice does (ask_choice `{detail}`). */
    choiceDetails?: readonly (string | undefined)[];
    /** #2909: the full detail behind the one-line body (markdown welcome). */
    context?: string;
    /** #2909: the question the person answers, when the title is the kind's
     * own (a needs-you card): it leads the context. */
    question?: string;
    /** #2909: the chat message holding the card. */
    cardId?: string;
    proposalId?: string;
    /** #3719: the turn began with the person's own line in this conversation. */
    personTurn?: boolean;
  },
): Notification | null {
  return buildNotification(kind, { ...bot, notifications: undefined }, threadId, detail, extra);
}

/** #3719: what each kind is, for the one rule below; #4250 (S2): it lives
 * with the one attention policy (shared/attention-policy.ts). */
export { NOTIFY_KIND_INTERRUPTS } from "../shared/attention-policy.ts";

/** #3719, the one rule: whether a notification sounds, shows a banner,
 * bounces the Dock or reaches a phone. An ask always does; an answer only
 * for the person's own line, and never while the server stops (a turn a
 * restart cuts announces nothing; a resumed turn has no person's line in
 * memory, so it is silent too). A message from a person (no bot) is an ask. */
export function notificationInterrupts(note: Pick<Notification, "kind" | "botId" | "notify" | "personTurn">): boolean {
  return frameAttention(note).verdict === "ring";
}

/** #4250 (S2): the frame's part of the one attention policy: the writer,
 * the kind rule and the level (the person's quiet hours, budget and
 * channels are their signal gate's, asked per person below). */
export function frameAttention(note: Pick<Notification, "kind" | "botId" | "notify" | "personTurn" | "level">): AttentionDecision {
  return decideAttention({
    kind: note.kind,
    botId: note.botId,
    ...(isSignalLevel(note.level) ? { level: note.level } : {}),
    ...(note.notify === false ? { notify: false } : {}),
    ...(note.personTurn ? { personTurn: true } : {}),
    shuttingDown: isShuttingDown(),
    at: Date.now(),
  });
}

/** One line per notification frame, never its words: enough to read back
 * an hour's noise (#3719). */
export function notifyLogLine(note: Pick<Notification, "kind" | "botId" | "threadId" | "audience">, options: { adminOnly?: boolean }, interrupts: boolean, decision?: Pick<AttentionDecision, "level" | "reason">): string {
  const audience = options.adminOnly ? "admins" : Array.isArray(note.audience) ? String(note.audience.length) : "all";
  const policy = decision ? ` level=${decision.level} reason=${decision.reason}` : "";
  return `[notify] kind=${note.kind} bot=${note.botId || "-"} thread=${note.threadId || "-"} audience=${audience} interrupts=${interrupts ? "yes" : "no"}${policy}`;
}

/** #4233: one person's verdict from their signal gate (shared/signal-levels.ts:
 * their quiet hours and day budget, urgent always passes). */
export interface SignalVerdict {
  person: string;
  decision: "push" | "hold";
  /** #4250 (S2): why the gate held it (quiet_hours, budget, fyi). */
  reason?: string;
}

/** #4233: the people a frame was held for, each one by their own gate. A
 * person is held when every push of the frame for them was held. No person
 * asked (nobody to push to) holds nobody: the frame keeps the kind's own rule. */
export function heldBySignal(verdicts: readonly SignalVerdict[]): Set<string> {
  const pushed = new Set<string>();
  const held = new Set<string>();
  for (const { person, decision } of verdicts) {
    const key = person.trim().toLowerCase();
    if (!key) continue;
    (decision === "hold" ? held : pushed).add(key);
  }
  for (const key of pushed) held.delete(key);
  return held;
}

/** #4233: the frames some (not all) of their people's gates held, with those
 * people. The frame object is the one every stream and every replay reads
 * (fanoutSsePayload, the replay buffer), so each viewer's projection
 * (sseFrameFor) asks here whether it goes quiet for them. */
const heldPeopleOfFrame = new WeakMap<object, ReadonlySet<string>>();

/** #4233: true when this frame goes `notify: false` to this person's streams
 * because their own quiet hours or day budget held it. */
export function notifyHeldFor(payload: object, person: string | undefined | null): boolean {
  const held = heldPeopleOfFrame.get(payload);
  return Boolean(held && person && held.has(person.trim().toLowerCase()));
}

export interface RuleNotifyOptions {
  adminOnly?: boolean;
  /** #4233: the person's signal gate, asked once per person for a frame
   * that would interrupt (it counts the day's budget and keeps a held
   * frame's words for the brief). The desktop, its shell and the phone all
   * follow each person's one verdict. */
  signal?: (note: Notification) => readonly SignalVerdict[];
}

/** Every notify frame passes here on its way out (fanoutSsePayload): the
 * rule decides, a silent one goes as `notify: false` (the clients, the
 * desktop shell and the push relay all skip those), and the line is logged.
 * An interrupting frame a person's quiet hours or day budget hold goes
 * `notify: false` to that person (#4233): it keeps its place in the chat
 * and the badge. Held for everyone it is for, the frame itself goes
 * `notify: false`; held for some, their streams get it quiet
 * (notifyHeldFor, read by sseFrameFor) and the others still ring.
 * Any other frame is returned as it is. */
export function ruleNotifyFrame<T extends Record<string, unknown>>(payload: T, options: RuleNotifyOptions = {}): T {
  if (payload.kind !== "notify" || !payload.notification || typeof payload.notification !== "object") return payload;
  const note = payload.notification as Notification;
  // #4250 (S2): the one attention policy, in its order: the writer, the
  // kind rule and the level here; each person's quiet hours, budget and
  // channels in their own gate (options.signal); one log line for it all
  const decision = frameAttention(note);
  const asks = decision.verdict === "ring";
  const verdicts = asks && options.signal ? options.signal(note) : [];
  const heldPeople = heldBySignal(verdicts);
  const asked = new Set(verdicts.map((verdict) => verdict.person.trim().toLowerCase()).filter(Boolean));
  const everyone = heldPeople.size > 0 && heldPeople.size === asked.size;
  const interrupts = asks && !everyone;
  const heldReasons = [...new Set(verdicts.filter((verdict) => verdict.decision === "hold" && verdict.reason).map((verdict) => verdict.reason))];
  const heldLog = everyone ? " held=signal" : heldPeople.size > 0 ? ` held=signal:${heldPeople.size}` : "";
  const reasons = heldLog && heldReasons.length ? ` held_by=${heldReasons.join(",")}` : "";
  console.log(`${notifyLogLine(note, options, interrupts, decision)}${heldLog}${reasons}`);
  const { personTurn: _personTurn, ...wire } = note;
  const out = { ...payload, notification: interrupts ? wire : { ...wire, notify: false } };
  if (interrupts && heldPeople.size > 0) heldPeopleOfFrame.set(out, heldPeople);
  return out;
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
  /** the thread is on a call the page started (server/voice/voice-call-session.ts) */
  callLive = false,
): boolean {
  if (!notification || notification.kind === "spend") return false;
  if (callLive) return true;
  if (!lastPersonMessage?.voiceCall) return false;
  return now - (lastPersonMessage.at ?? 0) < CALL_QUIET_MS;
}
