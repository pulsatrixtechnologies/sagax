// #2700: outbound event subscriptions of a bot. Instead of polling a bot's
// results (an hourly routine checking another routine's findings), a person
// subscribes a URL or one of their routines to the bot's events and the
// server pushes them as they happen.
//
// Events (one per settled routine run of the source bot):
// - run.reported: a completed run that spoke (not quiet);
// - run.quiet: a completed run that had nothing to report;
// - run.failed: a run that failed, was blocked or was missed;
// - ping: the test send from the bot's Developer settings.
//
// URL delivery: POST of the JSON payload below, signed with the
// subscription's secret: X-Sagax-Signature: v1=<hex HMAC-SHA256 of
// "<X-Sagax-Timestamp>.<body>">. Routine delivery: the target routine runs
// with the event appended to its prompt as data.

export const BOT_EVENT_TYPES = ["run.reported", "run.quiet", "run.failed"] as const;
export type BotEventType = (typeof BOT_EVENT_TYPES)[number];
export type BotEventSendType = BotEventType | "ping";

export const BOT_EVENT_OUTPUT_MAX = 4000;
export const BOT_EVENT_SUBSCRIPTIONS_PER_BOT = 20;

export type BotEventTarget =
  | { kind: "url"; url: string }
  | { kind: "routine"; botId: string; routineId: string };

export interface BotEventDelivery {
  at: number;
  ok: boolean;
  status?: number;
  error?: string;
}

/** A subscription as the API lists it: never its secret. */
export interface BotEventSubscription {
  id: string;
  botId: string;
  ownerId: string;
  events: BotEventType[];
  target: BotEventTarget;
  createdAt: number;
  deliveries: number;
  lastDelivery?: BotEventDelivery;
  /** Routine target: its name when it still exists. */
  targetName?: string;
}

export interface BotEventPayload {
  id: string;
  type: BotEventSendType;
  at: number;
  bot: { id: string; name: string };
  routine?: { id: string; name: string };
  run?: { id: string; status: string; trigger?: string };
  output?: string;
}

const SETTLED_REPORTED = new Set(["completed", "nothing_to_report"]);
const FAILED = new Set(["failed", "blocked", "missed"]);

/** The event a settled run publishes, or null (still running, cancelled). */
export function botEventTypeOfRun(run: { status: string; quiet?: true }): BotEventType | null {
  if (FAILED.has(run.status)) return "run.failed";
  if (run.status === "nothing_to_report") return "run.quiet";
  if (SETTLED_REPORTED.has(run.status)) return run.quiet ? "run.quiet" : "run.reported";
  return null;
}

export function isBotEventType(value: unknown): value is BotEventType {
  return typeof value === "string" && (BOT_EVENT_TYPES as readonly string[]).includes(value);
}

/** A target URL the form accepts: http(s) with a host, no credentials. */
export function validBotEventUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
