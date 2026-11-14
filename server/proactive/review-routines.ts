// #4250 (S8, reviews as routines): the end of day and the weekly review are
// routines of a bot, created only on the person's yes (Settings,
// Notifications, « Ce que je reçois »), like the daily brief (#3456,
// server/proactive/brief-routine.ts).
//
// - Each is an ordinary routine: listed in the bot's routines, paused,
//   edited or deleted there like any other. Its code pre-check
//   (`{kind: "code", check: "end_of_day_review" | "weekly_review"}`,
//   routine-precheck.ts) reads the run log and what waits on the person,
//   posts the review itself and never starts a turn: no model call.
// - The review says what the person's bots did (their routine runs), what
//   waits on the person and what failed. What waits is the one list of
//   items waiting on the person (shared/waiting-items.ts, read from their
//   Today rows): an open card, question or offer they must answer, never a
//   ledger entry of an event or a notice. With nothing in any of the three,
//   nothing is posted.
// - A review is a summary in the bot's conversation: what waits already
//   rang on its own, so the review itself never rings.
// - Only the person's own bots, runs and waiting items are read.
// - A version that does not know these checks reads the routine and drops
//   its pre-check (loadRoutinePrecheck), so the file stays readable.
import type { Routine, RoutineInput } from "../routines/routines.ts";
import type { RoutineRun } from "../routines/routine-run-types.ts";
import { personWord, type PersonLanguage } from "../people/person-words.ts";
import type { WaitingItem } from "../../shared/waiting-items.ts";

export const REVIEW_KINDS = ["end_of_day", "weekly"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** The code check of each review (routine-precheck.ts ROUTINE_CODE_CHECKS). */
export const REVIEW_CHECKS = { end_of_day: "end_of_day_review", weekly: "weekly_review" } as const satisfies Record<ReviewKind, string>;
export type ReviewCheck = (typeof REVIEW_CHECKS)[ReviewKind];

/** What a review looks back on. */
export const REVIEW_WINDOW_MS: Readonly<Record<ReviewKind, number>> = { end_of_day: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000 };
/** Lines per section; the rest is counted. */
const SECTION_LINES = 8;

/** When each review runs, before the person moves it in the routines list:
 * every day at 17:30, every Friday at 16:00. */
const REVIEW_CRON: Readonly<Record<ReviewKind, string>> = { end_of_day: "30 17 * * *", weekly: "0 16 * * 5" };

const NAME_KEYS: Readonly<Record<ReviewKind, string>> = { end_of_day: "review.endOfDay.title", weekly: "review.weekly.title" };
const PROMPT_KEYS: Readonly<Record<ReviewKind, string>> = { end_of_day: "review.endOfDay.prompt", weekly: "review.weekly.prompt" };

export function reviewCheckKind(check: string): ReviewKind | undefined {
  return REVIEW_KINDS.find((kind) => REVIEW_CHECKS[kind] === check);
}

export function reviewKindOf(routine: Pick<Routine, "precheck">): ReviewKind | undefined {
  const precheck = routine.precheck as { kind?: string; check?: string } | undefined;
  return precheck?.kind === "code" && precheck.check ? reviewCheckKind(precheck.check) : undefined;
}

/** The bot's review routine of this kind, when it has one. */
export function reviewRoutineOf(routines: readonly Routine[], botId: string, kind: ReviewKind): Routine | undefined {
  return routines.find((routine) => routine.botId === botId && reviewKindOf(routine) === kind);
}

export function reviewSchedule(kind: ReviewKind, timeZone: string): { type: "cron"; expression: string; timeZone: string } {
  return { type: "cron", expression: REVIEW_CRON[kind], timeZone };
}

export function reviewRoutineName(kind: ReviewKind, language: PersonLanguage): string {
  return personWord(language, NAME_KEYS[kind]);
}

/** The routine's instructions. The scheduled run never reads them as a turn
 * (the code check does the review); a person's Run now does. */
export function reviewRoutinePrompt(kind: ReviewKind, language: PersonLanguage): string {
  return personWord(language, PROMPT_KEYS[kind]);
}

/** What the review routines need of the routine manager. */
export interface ReviewRoutineManager {
  list(): readonly Routine[];
  create(input: RoutineInput, runAs?: string): Routine;
  update(id: string, patch: Partial<RoutineInput>): Routine | null;
}

export interface ReviewRoutineDeps {
  routines(): ReviewRoutineManager | null;
  language(botId: string): PersonLanguage;
  /** The person the routine runs as (an organization server), if any. */
  runAs(botId: string): string | undefined;
}

export class ReviewRoutines {
  private readonly deps: ReviewRoutineDeps;

  constructor(deps: ReviewRoutineDeps) {
    this.deps = deps;
  }

  of(botId: string, kind: ReviewKind): Routine | undefined {
    const manager = this.deps.routines();
    return manager ? reviewRoutineOf(manager.list(), botId, kind) : undefined;
  }

  /** Whether the review runs for this bot: its routine exists and is on. */
  on(botId: string, kind: ReviewKind): boolean {
    return this.of(botId, kind)?.enabled === true;
  }

  /** The person's switch. On is their yes: the routine is created, or the
   * existing one resumed as the person left it (time, days, zone,
   * instructions). Off pauses it; it is never deleted from here. Returns the
   * routine, or null when there is none (or no routine manager). */
  set(botId: string, kind: ReviewKind, on: boolean, timeZone = "UTC"): Routine | null {
    const manager = this.deps.routines();
    if (!manager) return null;
    const existing = reviewRoutineOf(manager.list(), botId, kind);
    if (existing) return manager.update(existing.id, { enabled: on });
    if (!on) return null;
    const language = this.deps.language(botId);
    return manager.create({
      name: reviewRoutineName(kind, language),
      prompt: reviewRoutinePrompt(kind, language),
      botId,
      enabled: true,
      schedule: reviewSchedule(kind, timeZone),
      precheck: { kind: "code", check: REVIEW_CHECKS[kind] },
      overlap: "skip",
      // the review posts itself; a run never adds a second message
      postResults: false,
    }, this.deps.runAs(botId));
  }
}

export type ReviewRun = Pick<RoutineRun, "routineId" | "routineName" | "botId" | "status" | "finishedAt"> & Partial<Pick<RoutineRun, "runAs" | "problems" | "error">>;
/** An item waiting on the person (shared/waiting-items.ts). */
export type ReviewWaiting = Pick<WaitingItem, "id" | "botId" | "title" | "at"> & Partial<Pick<WaitingItem, "confidential">>;

function samePerson(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** One person's part of the run log and of what waits: runs of their own
 * bots (a run made as someone else excluded) and the items waiting on them
 * in their own bots' conversations (`waiting` is already the person's own
 * list, read as their Today reads it). `singlePerson`: a server with one
 * person (the desktop), where every run is theirs. */
export function personReviewData(input: {
  person: string;
  bots: ReadonlySet<string>;
  runs: readonly ReviewRun[];
  waiting: readonly ReviewWaiting[];
  singlePerson: boolean;
}): { runs: ReviewRun[]; waiting: ReviewWaiting[] } {
  const { person, bots, singlePerson } = input;
  return {
    runs: input.runs.filter((run) => bots.has(run.botId) && (singlePerson || !run.runAs || samePerson(run.runAs, person))),
    waiting: input.waiting.filter((item) => bots.has(item.botId)),
  };
}

function failedOf(run: ReviewRun): boolean {
  return run.status === "failed" || run.status === "blocked" || run.status === "missed" || (run.status === "completed" && Boolean(run.problems?.trim()));
}

function firstLine(text: string, limit = 160): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** Rows grouped by routine, the most recent first. */
function byRoutine(runs: readonly ReviewRun[]): Array<{ last: ReviewRun; count: number }> {
  const groups = new Map<string, { last: ReviewRun; count: number }>();
  for (const run of [...runs].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))) {
    const known = groups.get(run.routineId);
    if (known) known.count += 1;
    else groups.set(run.routineId, { last: run, count: 1 });
  }
  return [...groups.values()];
}

function section(language: PersonLanguage, titleKey: string, lines: readonly string[]): string[] {
  if (!lines.length) return [];
  const shown = lines.slice(0, SECTION_LINES).map((line) => `- ${line}`);
  const rest = lines.length - shown.length;
  return ["", `**${personWord(language, titleKey)}**`, ...shown, ...(rest > 0 ? [personWord(language, "review.more", { count: rest })] : [])];
}

export interface ComposedReview {
  text: string;
  did: number;
  waits: number;
  failed: number;
}

/** The review's message, or null when there is nothing to say. */
export function composeReview(input: {
  kind: ReviewKind;
  language: PersonLanguage;
  now: number;
  runs: readonly ReviewRun[];
  waiting: readonly ReviewWaiting[];
  botName: (botId: string) => string;
}): ComposedReview | null {
  const { kind, language, now, botName } = input;
  const since = now - REVIEW_WINDOW_MS[kind];
  const recent = input.runs.filter((run) => run.finishedAt !== undefined && run.finishedAt > since && run.finishedAt <= now);
  const done = byRoutine(recent.filter((run) => run.status === "completed" && !failedOf(run)));
  const failed = byRoutine(recent.filter(failedOf));
  const didLines = done.map(({ last, count }) => personWord(language, count === 1 ? "review.did.one" : "review.did.many", { bot: botName(last.botId), routine: last.routineName, count }));
  const failedLines = failed.map(({ last, count }) => personWord(language, count === 1 ? "review.failed.one" : "review.failed.many", {
    bot: botName(last.botId), routine: last.routineName, count,
    reason: firstLine(last.problems?.trim() || last.error?.trim() || "") || personWord(language, "review.failed.noReason"),
  }));
  // the oldest first, as the person's Today lists them; a confidential
  // conversation's item is named without its words
  const waitLines = [...input.waiting].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map((item) => {
    const label = (!item.confidential && firstLine(item.title)) || personWord(language, "review.wait.unlabeled");
    return personWord(language, "review.wait.line", { label, bot: botName(item.botId) });
  });
  if (!didLines.length && !waitLines.length && !failedLines.length) return null;
  const lines = [
    `**${reviewRoutineName(kind, language)}**`,
    ...section(language, "review.section.did", didLines),
    ...section(language, "review.section.waits", waitLines),
    ...section(language, "review.section.failed", failedLines),
  ];
  return { text: lines.join("\n"), did: done.reduce((sum, row) => sum + row.count, 0), waits: waitLines.length, failed: failed.reduce((sum, row) => sum + row.count, 0) };
}

/** The review routine's code check, given the person's data: composes the
 * review and posts it (`deliver` false: no conversation to post in).
 * Returns the run's reason, as the routines list shows it. */
export function runReview(input: {
  kind: ReviewKind;
  language: PersonLanguage;
  now: number;
  runs: readonly ReviewRun[];
  waiting: readonly ReviewWaiting[];
  botName: (botId: string) => string;
  deliver: (text: string) => boolean;
}): string {
  const review = composeReview(input);
  if (!review) return personWord(input.language, "review.reason.nothing");
  if (!input.deliver(review.text)) return personWord(input.language, "review.reason.noThread");
  return personWord(input.language, "review.reason.sent", { did: review.did, waits: review.waits, failed: review.failed });
}

/** The reason of a review run whose bot has no person to send it to. */
export function reviewNoPersonReason(language: PersonLanguage): string {
  return personWord(language, "review.reason.noPerson");
}
