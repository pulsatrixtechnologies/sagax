/** #2695: how loud a bot's signal is, per person.
 *
 * Three levels:
 * - fyi: never buzzes; it waits for the next brief as one line.
 * - card: a push, inside the person's daily budget and outside quiet hours.
 * - urgent: always a push (an approval or question a run waits on, a
 *   message from a person).
 * The budget and the quiet hours belong to the person (all their bots
 * together), not to one bot. Both are person preferences
 * (shared/user-preferences.ts), set in Settings > Notifications. */
import { localClock, validTimeZone } from "./reach-me.ts";

export type SignalLevel = "fyi" | "card" | "urgent";

/** Pushes a person gets in any 24 hours before cards wait for the brief. */
export const SIGNAL_BUDGET_KEY = "sagax.notifyBudget.v1";
/** Quiet hours, JSON { start: "HH:MM", end: "HH:MM", timeZone }; absent is none. */
export const QUIET_HOURS_KEY = "sagax.quietHours.v1";
export const SIGNAL_BUDGET_DEFAULT = 20;
export const SIGNAL_BUDGET_CHOICES = [5, 10, 20, 50] as const;
export const SIGNAL_WINDOW_MS = 24 * 60 * 60_000;

export interface QuietHours {
  start: string;
  end: string;
  timeZone: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function readSignalBudget(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return (SIGNAL_BUDGET_CHOICES as readonly number[]).includes(parsed) ? parsed : SIGNAL_BUDGET_DEFAULT;
}

export function readQuietHours(value: string | null | undefined): QuietHours | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<QuietHours>;
    if (typeof parsed.start !== "string" || typeof parsed.end !== "string" || typeof parsed.timeZone !== "string") return null;
    if (!HHMM.test(parsed.start) || !HHMM.test(parsed.end) || parsed.start === parsed.end || !validTimeZone(parsed.timeZone)) return null;
    return { start: parsed.start, end: parsed.end, timeZone: parsed.timeZone };
  } catch {
    return null;
  }
}

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Whether `atMs` falls in the quiet hours (a range may cross midnight). */
export function withinQuietHours(quiet: QuietHours | null, atMs: number): boolean {
  if (!quiet) return false;
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

/** The level of one push. */
export function signalLevelOfPush(message: { kind: string; fromId?: string; groupId?: string }): SignalLevel {
  if (message.kind === "approval") return "urgent";
  if (message.fromId || message.groupId) return "urgent";
  if (message.kind === "achievement") return "fyi";
  return "card";
}

export type SignalDecision = "push" | "hold";

/** The per-person gate: a rolling 24 hour count of cards pushed, and what
 * was held for the next brief. In memory: a restart starts a fresh day. */
export class PersonSignalGate {
  private readonly sent = new Map<string, number[]>();
  private readonly held = new Map<string, number>();

  private readonly prefs: (person: string) => { budget: number; quiet: QuietHours | null };
  private readonly now: () => number;

  constructor(prefs: (person: string) => { budget: number; quiet: QuietHours | null }, now: () => number = Date.now) {
    this.prefs = prefs;
    this.now = now;
  }

  decide(message: { personId: string; kind: string; fromId?: string; groupId?: string }): SignalDecision {
    const level = signalLevelOfPush(message);
    if (level === "urgent") return "push";
    const person = message.personId;
    if (level === "fyi") return this.hold(person);
    const at = this.now();
    const { budget, quiet } = this.prefs(person);
    if (withinQuietHours(quiet, at)) return this.hold(person);
    const recent = (this.sent.get(person) ?? []).filter((stamp) => stamp > at - SIGNAL_WINDOW_MS);
    if (recent.length >= budget) {
      this.sent.set(person, recent);
      return this.hold(person);
    }
    recent.push(at);
    this.sent.set(person, recent);
    return "push";
  }

  /** How many signals waited since the last brief, and resets the count. */
  takeHeld(person: string): number {
    const count = this.held.get(person) ?? 0;
    this.held.delete(person);
    return count;
  }

  private hold(person: string): SignalDecision {
    if (this.held.size > 5_000 && !this.held.has(person)) this.held.delete(this.held.keys().next().value!);
    this.held.set(person, (this.held.get(person) ?? 0) + 1);
    return "hold";
  }
}

/** The brief's FYI line for what waited, in the person's language. */
export function heldSignalsLine(count: number, language: "fr" | "en"): string | null {
  if (count <= 0) return null;
  if (language === "fr") return count === 1 ? "1 notification a attendu ce résumé (budget du jour ou heures calmes)." : `${count} notifications ont attendu ce résumé (budget du jour ou heures calmes).`;
  return count === 1 ? "1 notification waited for this brief (daily budget or quiet hours)." : `${count} notifications waited for this brief (daily budget or quiet hours).`;
}

/** Reason codes (server/org/org-problem-log.ts) that are the engine's or the
 * provider's trouble, not a business decision: they go to Ops incidents. */
export const OPS_INCIDENT_REASONS: ReadonlySet<string> = new Set([
  "rate_limited", "quota", "auth", "provider_unavailable", "engine_missing", "timeout",
  "network", "context_too_long", "interrupted", "stalled", "could_not_start"
]);

export const OPS_INCIDENTS_THREAD_TITLE = "Ops incidents";
