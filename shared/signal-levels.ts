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

/** Cards a person gets in their local day before cards wait for the brief. */
export const SIGNAL_BUDGET_KEY = "sagax.notifyBudget.v1";
/** Quiet hours, JSON { start: "HH:MM", end: "HH:MM", timeZone }; absent is none. */
export const QUIET_HOURS_KEY = "sagax.quietHours.v1";
export const SIGNAL_BUDGET_DEFAULT = 20;
export const SIGNAL_BUDGET_CHOICES = [5, 10, 20, 50] as const;

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

/** One push that waited for the brief: its words, so the brief carries the
 * content itself, not only a count. */
export interface HeldSignal {
  at: number;
  title: string;
  body: string;
  botId?: string;
  threadId?: string;
}

/** A person's count for their local day, and what waits for the brief. */
export interface PersonSignalState {
  day: string;
  sent: number;
  held: HeldSignal[];
}

/** Where the gate keeps its state across restarts (the server passes a JSON
 * file under DATA_DIR; tests and the client pass nothing). */
export interface SignalGateStorage {
  load(): Record<string, PersonSignalState> | null;
  save(state: Record<string, PersonSignalState>): void;
}

export interface SignalPrefs {
  budget: number;
  quiet: QuietHours | null;
  /** The person's time zone: the budget day starts at their local midnight. */
  timeZone?: string;
}

/** What a brief can carry, newest kept. */
export const SIGNAL_HELD_MAX = 30;
const HELD_TEXT_MAX = 280;

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The calendar day ("2026-11-08") of `atMs` in `timeZone`. */
export function localDayKey(atMs: number, timeZone: string): string {
  const zone = validTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(atMs));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function clip(text: unknown): string {
  const value = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return value.length > HELD_TEXT_MAX ? `${value.slice(0, HELD_TEXT_MAX - 3)}...` : value;
}

/** The per-person gate: the cards pushed on the person's local day (their
 * budget), and what waited for the next brief, word for word. Kept through
 * `storage`, so a restart neither resets the day nor loses what waited. */
export class PersonSignalGate {
  private readonly state = new Map<string, PersonSignalState>();
  private readonly prefs: (person: string) => SignalPrefs;
  private readonly now: () => number;
  private readonly storage: SignalGateStorage | undefined;

  constructor(prefs: (person: string) => SignalPrefs, now: () => number = Date.now, storage?: SignalGateStorage) {
    this.prefs = prefs;
    this.now = now;
    this.storage = storage;
    let loaded: Record<string, PersonSignalState> | null = null;
    try { loaded = storage?.load() ?? null; } catch { loaded = null; }
    for (const [person, row] of Object.entries(loaded ?? {})) {
      if (!row || typeof row.day !== "string" || typeof row.sent !== "number") continue;
      const held = Array.isArray(row.held) ? row.held.filter((item) => item && typeof item.title === "string" && typeof item.body === "string").slice(-SIGNAL_HELD_MAX) : [];
      this.state.set(person, { day: row.day, sent: Math.max(0, Math.floor(row.sent)), held });
    }
  }

  /** A push: urgent always goes; FYI waits; a card goes inside the budget
   * of the person's local day and outside quiet hours, else waits. */
  decide(message: { personId: string; kind: string; title?: string; body?: string; botId?: string; threadId?: string; fromId?: string; groupId?: string }, options: { fyi?: boolean } = {}): SignalDecision {
    const level = options.fyi && signalLevelOfPush(message) !== "urgent" ? "fyi" : signalLevelOfPush(message);
    if (level === "urgent") return "push";
    if (level === "fyi") return this.hold(message);
    return this.admit(message.personId) ? "push" : this.hold(message);
  }

  /** Whether one more card may reach the person now (quiet hours, the
   * day's budget); counts it when it may. Nothing is kept when it may not:
   * for a notice whose content is already in the chat (the brief's own). */
  admit(person: string): boolean {
    const at = this.now();
    const prefs = this.prefs(person);
    if (withinQuietHours(prefs.quiet, at)) return false;
    const row = this.today(person, at, prefs);
    if (row.sent >= prefs.budget) return false;
    row.sent += 1;
    this.persist();
    return true;
  }

  /** What waited since the last brief, oldest first, and clears it. */
  takeHeld(person: string): HeldSignal[] {
    const row = this.state.get(person);
    if (!row || row.held.length === 0) return [];
    const held = row.held;
    row.held = [];
    this.persist();
    return held;
  }

  /** #3551: drop what waits for the brief and should never have been sent
   * (a notice taken back). How many were dropped. */
  withdraw(person: string, match: (held: HeldSignal) => boolean): number {
    const row = this.state.get(person);
    if (!row || row.held.length === 0) return 0;
    const kept = row.held.filter((item) => !match(item));
    const dropped = row.held.length - kept.length;
    if (!dropped) return 0;
    row.held = kept;
    this.persist();
    return dropped;
  }

  /** The cards pushed today, for a test or a status line. */
  sentToday(person: string): number {
    const at = this.now();
    return this.today(person, at, this.prefs(person)).sent;
  }

  private today(person: string, at: number, prefs: SignalPrefs): PersonSignalState {
    const day = localDayKey(at, prefs.timeZone ?? prefs.quiet?.timeZone ?? systemTimeZone());
    let row = this.state.get(person);
    if (!row) {
      if (this.state.size > 5_000) this.state.delete(this.state.keys().next().value!);
      row = { day, sent: 0, held: [] };
      this.state.set(person, row);
    } else if (row.day !== day) {
      row.day = day;
      row.sent = 0;
    }
    return row;
  }

  private hold(message: { personId: string; title?: string; body?: string; botId?: string; threadId?: string }): SignalDecision {
    const at = this.now();
    const row = this.today(message.personId, at, this.prefs(message.personId));
    row.held.push({
      at,
      title: clip(message.title),
      body: clip(message.body),
      ...(message.botId ? { botId: message.botId } : {}),
      ...(message.threadId ? { threadId: message.threadId } : {})
    });
    if (row.held.length > SIGNAL_HELD_MAX) row.held.splice(0, row.held.length - SIGNAL_HELD_MAX);
    this.persist();
    return "hold";
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.save(Object.fromEntries(this.state));
    } catch { /* the next change tries again */ }
  }
}

/** How many held signals the brief spells out; the rest is one count. */
export const HELD_IN_BRIEF = 8;

/** The brief's section for what waited, in the person's language: a header,
 * then each one in its own words. Null when nothing waited. */
export function heldSignalsSection(held: readonly HeldSignal[], language: "fr" | "en"): string | null {
  if (held.length === 0) return null;
  const count = held.length;
  const header = language === "fr"
    ? (count === 1 ? "1 notification a attendu ce résumé (budget du jour, heures calmes ou FYI) :" : `${count} notifications ont attendu ce résumé (budget du jour, heures calmes ou FYI) :`)
    : (count === 1 ? "1 notification waited for this brief (daily budget, quiet hours or FYI):" : `${count} notifications waited for this brief (daily budget, quiet hours or FYI):`);
  const lines = held.slice(-HELD_IN_BRIEF).map((item) => {
    const text = item.title && item.body && item.body !== item.title ? `${item.title}${language === "fr" ? " : " : ": "}${item.body}` : item.title || item.body;
    return `- ${text || (language === "fr" ? "(sans texte)" : "(no text)")}`;
  });
  const rest = count - lines.length;
  if (rest > 0) lines.unshift(language === "fr" ? `- et ${rest} plus anciennes` : `- and ${rest} older`);
  return [header, ...lines].join("\n");
}

/** Reason codes (server/org/org-problem-log.ts) that are the engine's or the
 * provider's trouble, not a business decision: they go to Ops incidents. */
export const OPS_INCIDENT_REASONS: ReadonlySet<string> = new Set([
  "rate_limited", "quota", "auth", "provider_unavailable", "engine_missing", "timeout",
  "network", "context_too_long", "interrupted", "stalled", "could_not_start"
]);

export const OPS_INCIDENTS_THREAD_TITLE = "Ops incidents";
