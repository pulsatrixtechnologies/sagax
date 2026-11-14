/** #4250 (S2): the one attention policy. Whether something a bot did reaches
 * the person now, and by which channels, decided by ONE function in this
 * order (docs/proactive.md, "One attention policy"):
 *
 * 1. the writer: a frame the bot wrote with `notify: false` never rings
 *    (one it marked FYI waits for the brief);
 * 2. the kind rule (NOTIFY_KIND_INTERRUPTS, #3719): an ask rings, an answer
 *    only for the person's own line, a quiet kind never;
 * 3. the level (`fyi`, `card`, `urgent`), set by the writer, else derived
 *    from the kind: FYI waits for the brief, urgent always passes;
 * 4. the person's ONE quiet-hours setting, obeyed by every device and channel;
 * 5. the person's day budget;
 * 6. presence: the person is looking at it (a focused window on that
 *    conversation) or a client of theirs saw it (the push hub's grace);
 * 7. the channels the person chose for that level, among the bot's own.
 *
 * Pure, shared by the server (server/notify.ts, the signal gate, "Me
 * joindre"), the desktop (src/lib/attention.ts) and, next, the phone. The
 * same cases run on each side: shared/attention-policy.vectors.json. */
import type { Notification, NotifyKind } from "./notification.ts";
import { REACH_CHANNELS, REACH_WIRED, localClock, validTimeZone, type ReachChannelId } from "./reach-me.ts";
import type { QuietHours, SignalLevel } from "./signal-levels.ts";

/** #3719: what each kind is, for the kind rule. Typed over every kind, so a
 * new kind cannot be added without saying whether it is an ask.
 * - "ask": the person has something to do, or asked to be told (an
 *   approval, a question, a sign-in, a takeover, needs-you, a proposal
 *   within its budget, a wait they set, an admin action on their bot, a
 *   report to an admin, a person's words to them).
 * - "answer": interrupts only as the answer to a line the person wrote in
 *   that conversation (`personTurn`).
 * - "quiet": never interrupts. It keeps its place in the conversation,
 *   Today, the run log and the unread badge, told once. */
export const NOTIFY_KIND_INTERRUPTS: Readonly<Record<NotifyKind, "ask" | "answer" | "quiet">> = {
  approval: "ask",
  question: "ask",
  "sign-in": "ask",
  takeover: "ask",
  "needs-you": "ask",
  proposal: "ask",
  wait: "ask",
  "admin-action": "ask",
  report: "ask",
  "page-comment": "ask",
  // a person's direct message is an ask; a bot's is answered below
  message: "answer",
  done: "answer",
  "turn-failed": "answer",
  "routine-failed": "quiet",
  "routine-deferred": "quiet",
  incident: "quiet",
  "delegation-settled": "quiet",
  notice: "quiet",
  spend: "quiet",
};

/** The kinds where a bot is blocked on the person's own hands: urgent, and
 * they push as `approval` (server/push/frames.ts). */
export const BLOCKED_ON_PERSON: ReadonlySet<string> = new Set<NotifyKind>(["approval", "question", "takeover", "needs-you", "sign-in"]);

export const SIGNAL_LEVELS: readonly SignalLevel[] = ["fyi", "card", "urgent"];

export function isSignalLevel(value: unknown): value is SignalLevel {
  return typeof value === "string" && (SIGNAL_LEVELS as readonly string[]).includes(value);
}

/** The level of a notification: the writer's, else its kind's (a bot blocked
 * on the person or a person's own message is urgent; the rest is a card). */
export function levelOfNotification(note: Pick<Notification, "kind" | "botId"> & { level?: unknown }): SignalLevel {
  if (isSignalLevel(note.level)) return note.level;
  if (BLOCKED_ON_PERSON.has(note.kind)) return "urgent";
  if (note.kind === "message" && !note.botId) return "urgent";
  return "card";
}

/** The channels each level may use outside the app, chosen once by the
 * person in Settings > Notifications. FYI never leaves the app. A bot keeps
 * only its own channels ("Me joindre"): what goes is the bot's channels
 * that the level allows. */
export type LevelChannels = Readonly<Record<"card" | "urgent", readonly ReachChannelId[]>>;

/** Person preference, JSON { card: [...], urgent: [...] }; absent is every channel for both. */
export const NOTIFY_CHANNELS_KEY = "sagax.notifyChannels.v1";

export const DEFAULT_LEVEL_CHANNELS: LevelChannels = Object.freeze({ card: [...REACH_CHANNELS], urgent: [...REACH_CHANNELS] });

function channelList(value: unknown): ReachChannelId[] | null {
  if (!Array.isArray(value)) return null;
  const out: ReachChannelId[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && (REACH_CHANNELS as readonly string[]).includes(entry) && !out.includes(entry as ReachChannelId)) out.push(entry as ReachChannelId);
  }
  return out;
}

/** The stored choice, or the default for a level it does not name. */
export function readLevelChannels(value: string | null | undefined): LevelChannels {
  if (!value) return DEFAULT_LEVEL_CHANNELS;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_LEVEL_CHANNELS;
    return {
      card: channelList(parsed.card) ?? DEFAULT_LEVEL_CHANNELS.card,
      urgent: channelList(parsed.urgent) ?? DEFAULT_LEVEL_CHANNELS.urgent,
    };
  } catch {
    return DEFAULT_LEVEL_CHANNELS;
  }
}

/** The JSON the preference keeps. */
export function levelChannelsValue(channels: LevelChannels): string {
  return JSON.stringify({ card: [...channels.card], urgent: [...channels.urgent] });
}

/** The channels a level reaches the person by: the bot's (none saved: a
 * push) that the person allows for that level, wired ones only. */
export function channelsForLevel(level: SignalLevel, levelChannels: LevelChannels | null | undefined, botChannels?: readonly ReachChannelId[] | null): ReachChannelId[] {
  if (level === "fyi") return [];
  const allowed = (levelChannels ?? DEFAULT_LEVEL_CHANNELS)[level];
  const bot = botChannels ?? ["push"];
  return bot.filter((channel, index) => bot.indexOf(channel) === index && allowed.includes(channel) && (REACH_WIRED as readonly string[]).includes(channel));
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `atMs` falls in the quiet hours (a range may cross midnight). */
export function withinQuietHours(quiet: QuietHours | null | undefined, atMs: number): boolean {
  if (!quiet || !validTimeZone(quiet.timeZone)) return false;
  let minute: number;
  try {
    minute = localClock(atMs, quiet.timeZone).minute;
  } catch {
    return false;
  }
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** - ring: it interrupts now (sound, banner, push), by `channels`.
 * - quiet: it keeps its place in the chat and the badge, never rings.
 * - hold: it waits; its words go to "While you were quiet" and the brief.
 * - seen: the person already sees it; nothing rings. */
export type AttentionVerdict = "ring" | "quiet" | "hold" | "seen";

export type AttentionReason = "writer" | "fyi" | "kind" | "urgent" | "quiet_hours" | "budget" | "seen" | "allowed";

export interface AttentionInput {
  /** The notification's kind; absent when the kind rule already ran (a
   * push the frame's rule let through). */
  kind?: NotifyKind;
  /** The notification's bot; empty for a person's own message. */
  botId?: string;
  /** The writer's level; absent: the kind's (levelOfNotification). */
  level?: SignalLevel;
  /** The writer's `notify: false`. */
  notify?: boolean;
  /** The turn began with the person's own line in this conversation. */
  personTurn?: boolean;
  /** The server is stopping: an answer announces nothing. */
  shuttingDown?: boolean;
  /** When it happens, milliseconds since 1970. */
  at: number;
  quiet?: QuietHours | null;
  budget?: number;
  /** Cards already told today (the budget's count). */
  sentToday?: number;
  presence?: { looking?: boolean; seen?: boolean };
  levelChannels?: LevelChannels | null;
  botChannels?: readonly ReachChannelId[] | null;
}

export interface AttentionDecision {
  verdict: AttentionVerdict;
  level: SignalLevel;
  reason: AttentionReason;
  /** It takes one of the day's budget. */
  counts: boolean;
  /** Where it goes outside the app when it rings. */
  channels: ReachChannelId[];
}

/** The one decision (see the top of this file). */
export function decideAttention(input: AttentionInput): AttentionDecision {
  const level: SignalLevel = input.level ?? (input.kind ? levelOfNotification({ kind: input.kind, botId: input.botId ?? "" }) : "card");
  const decision = (verdict: AttentionVerdict, reason: AttentionReason, counts = false): AttentionDecision => ({
    verdict, level, reason, counts,
    channels: verdict === "ring" ? channelsForLevel(level, input.levelChannels, input.botChannels) : [],
  });
  if (input.notify === false) return level === "fyi" ? decision("hold", "fyi") : decision("quiet", "writer");
  if (input.kind) {
    const rule = input.kind === "message" && !input.botId ? "ask" : NOTIFY_KIND_INTERRUPTS[input.kind] ?? "ask";
    if (rule === "quiet") return decision("quiet", "kind");
    if (rule === "answer" && (input.personTurn !== true || input.shuttingDown === true)) return decision("quiet", "kind");
  }
  if (level === "fyi") return decision("hold", "fyi");
  let counts = false;
  if (level !== "urgent") {
    if (withinQuietHours(input.quiet, input.at)) return decision("hold", "quiet_hours");
    if (input.budget !== undefined && (input.sentToday ?? 0) >= input.budget) return decision("hold", "budget");
    counts = input.budget !== undefined;
  }
  if (input.presence?.looking || input.presence?.seen) return decision("seen", "seen");
  return decision("ring", level === "urgent" ? "urgent" : "allowed", counts);
}

/** One line per decision, never the words. */
export function attentionLogLine(decision: AttentionDecision, where: Record<string, string | number | undefined>): string {
  const fields = Object.entries(where).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${key}=${value}`);
  return `[attention] ${fields.join(" ")}${fields.length ? " " : ""}level=${decision.level} verdict=${decision.verdict} reason=${decision.reason}${decision.channels.length ? ` channels=${decision.channels.join(",")}` : ""}`;
}
