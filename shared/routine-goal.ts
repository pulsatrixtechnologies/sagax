/**
 * #2696: a goal routine. The person writes an objective in plain words; the
 * bot decides at each run whether there is something to report and when to
 * check next, and the routine stops once the goal is reached (or its
 * deadline passes). The routine's schedule is only the fallback cadence.
 *
 * The bot ends each run with two machine lines (stripped from the report):
 *   GOAL_STATUS: achieved | in_progress | blocked [: short note]
 *   NEXT_CHECK: 2026-11-10T09:00:00-05:00 | in 3h | in 2d | in 45m
 */

export type RoutineGoalStatus = "active" | "achieved" | "expired";

export interface RoutineGoal {
  /** The objective in the person's words. */
  text: string;
  status: RoutineGoalStatus;
  /** Optional deadline (ms epoch): past it, the goal stops as expired. */
  deadline?: number;
  /** When the bot declared it reached. */
  achievedAt?: number;
  /** When the deadline stopped it. */
  expiredAt?: number;
  /** The bot's latest progress note (GOAL_STATUS note). */
  progress?: string;
  /** Runs that checked the goal. */
  checks?: number;
  /** Runs in a row whose progress note did not change. */
  stalled?: number;
  /** The next check the bot chose, if any. */
  nextCheckAt?: number;
  /** When the last run checked it. */
  lastCheckedAt?: number;
}

export const ROUTINE_GOAL_MAX_CHARS = 2_000;
export const ROUTINE_GOAL_PROGRESS_CHARS = 300;
/** The bot cannot check sooner than this, nor later than the max. */
export const ROUTINE_GOAL_MIN_CHECK_MS = 5 * 60_000;
export const ROUTINE_GOAL_MAX_CHECK_MS = 14 * 24 * 60 * 60_000;
/** Same progress this many runs in a row: the person hears about it. */
export const ROUTINE_GOAL_STALL_RUNS = 3;
/** A one-time goal routine whose bot named no next check looks again after
 * this long (never past its deadline), instead of stopping silently. */
export const ROUTINE_GOAL_DEFAULT_CHECK_MS = 24 * 60 * 60_000;
/** A run may start this late after the deadline (the last check lands on it). */
export const ROUTINE_GOAL_DEADLINE_GRACE_MS = 5 * 60_000;

export const ROUTINE_GOAL_INVALID = "A goal is a sentence (at most 2000 characters), with an optional deadline, or null to remove it.";

export interface RoutineGoalInput {
  text: string;
  deadline?: number | string | null;
}

function parseDeadline(value: unknown): { ok: true; deadline?: number } | { ok: false } {
  if (value == null || value === "") return { ok: true };
  const at = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at) || at <= 0) return { ok: false };
  return { ok: true, deadline: Math.round(at) };
}

/**
 * Input from the editor, HTTP or a bot tool: a string (the goal), an object
 * `{ text, deadline? }`, or null/"" to remove it. Keeps the runtime state of
 * `previous` when the text and deadline are unchanged.
 */
export function parseRoutineGoal(value: unknown, previous?: RoutineGoal): { ok: true; goal?: RoutineGoal } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true };
  const raw = typeof value === "string" ? { text: value } : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: ROUTINE_GOAL_INVALID };
  const { text, deadline } = raw as { text?: unknown; deadline?: unknown };
  if (typeof text !== "string") return { ok: false, error: ROUTINE_GOAL_INVALID };
  // One line: the goal is written as `/goal <text>` in the instructions.
  const clean = routineGoalText(text);
  if (!clean) return { ok: true };
  if (clean.length > ROUTINE_GOAL_MAX_CHARS) return { ok: false, error: ROUTINE_GOAL_INVALID };
  const parsed = parseDeadline(deadline);
  if (!parsed.ok) return { ok: false, error: ROUTINE_GOAL_INVALID };
  if (previous && previous.text === clean && previous.deadline === parsed.deadline) return { ok: true, goal: { ...previous } };
  // A new or reworded goal starts fresh.
  return { ok: true, goal: { text: clean, status: "active", ...(parsed.deadline ? { deadline: parsed.deadline } : {}) } };
}

/** A goal's words on one line, as its `/goal` line holds them. */
export function routineGoalText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * #4098: the goal is written in the instructions, as a line `/goal <text>`
 * with an optional `/deadline <date>` line under it. Every goal line (and
 * the deadline line right under it) leaves the instructions the run reads;
 * the first one is the goal, read by `parseRoutineGoal` like any other input.
 */
export interface RoutineGoalLines {
  goal?: RoutineGoalInput;
  /** The instructions without the goal lines. */
  instructions: string;
}

const GOAL_LINE = /^[ \t]*\/goal[ \t]+(\S.*?)[ \t]*$/i;
const DEADLINE_LINE = /^[ \t]*\/deadline[ \t]+(\S.*?)[ \t]*$/i;

export function readRoutineGoalLines(prompt: string): RoutineGoalLines {
  const lines = prompt.split(/\r?\n/);
  const kept: string[] = [];
  let goal: RoutineGoalInput | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const text = GOAL_LINE.exec(lines[index]!)?.[1];
    if (text === undefined) { kept.push(lines[index]!); continue; }
    // The deadline is the next written line, when it is one.
    let next = index + 1;
    while (next < lines.length && !lines[next]!.trim()) next += 1;
    const deadline = next < lines.length ? DEADLINE_LINE.exec(lines[next]!)?.[1] : undefined;
    if (deadline !== undefined) index = next;
    goal ??= { text, ...(deadline !== undefined ? { deadline } : {}) };
  }
  if (!goal) return { instructions: prompt };
  return { goal, instructions: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** What a run reads as its instructions: the goal block carries the goal. */
export function routineRunInstructions(prompt: string): string {
  return readRoutineGoalLines(prompt).instructions;
}

/** The goal the instructions' lines say, read by the one parser. */
export function routineGoalOfLines(prompt: string, previous?: RoutineGoal): ReturnType<typeof parseRoutineGoal> {
  return parseRoutineGoal(readRoutineGoalLines(prompt).goal, previous);
}

/** Whether the instructions already say this goal (or no goal for none). */
export function routineGoalLinesSay(prompt: string, goal: Pick<RoutineGoal, "text" | "deadline"> | undefined): boolean {
  const read = routineGoalOfLines(prompt);
  if (!read.ok) return false;
  if (!read.goal || !goal) return !read.goal && !goal;
  return read.goal.text === routineGoalText(goal.text) && read.goal.deadline === goal.deadline;
}

/** The instructions carrying this goal as their first lines (none removes
 * them); unchanged when they already say it. */
export function writeRoutineGoalLines(prompt: string, goal: Pick<RoutineGoal, "text" | "deadline"> | undefined): string {
  if (routineGoalLinesSay(prompt, goal)) return prompt;
  const body = routineRunInstructions(prompt);
  if (!goal) return body;
  const lines = [`/goal ${routineGoalText(goal.text)}`, ...(goal.deadline ? [`/deadline ${new Date(goal.deadline).toISOString()}`] : [])].join("\n");
  return body ? `${lines}\n\n${body}` : lines;
}

function finiteTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** A stored goal, or undefined when it is not one. */
export function loadRoutineGoal(value: unknown): RoutineGoal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const goal = value as Partial<RoutineGoal>;
  if (typeof goal.text !== "string" || !goal.text.trim() || goal.text.length > ROUTINE_GOAL_MAX_CHARS) return undefined;
  const status: RoutineGoalStatus = goal.status === "achieved" || goal.status === "expired" ? goal.status : "active";
  const out: RoutineGoal = { text: routineGoalText(goal.text), status };
  const fields = {
    deadline: finiteTime(goal.deadline),
    achievedAt: finiteTime(goal.achievedAt),
    expiredAt: finiteTime(goal.expiredAt),
    nextCheckAt: finiteTime(goal.nextCheckAt),
    lastCheckedAt: finiteTime(goal.lastCheckedAt),
    checks: count(goal.checks),
    stalled: count(goal.stalled),
  };
  for (const [key, field] of Object.entries(fields)) if (field !== undefined) (out as unknown as Record<string, number>)[key] = field;
  if (typeof goal.progress === "string" && goal.progress.trim()) out.progress = goal.progress.trim().slice(0, ROUTINE_GOAL_PROGRESS_CHARS);
  return out;
}

export type GoalReportStatus = "achieved" | "in_progress" | "blocked";

export interface GoalReport {
  status?: GoalReportStatus;
  note?: string;
  nextCheckAt?: number;
  /** The run's report without the machine lines. */
  report: string;
}

const STATUS_LINE = /^[ \t>*_`-]*GOAL[_ ]STATUS[ \t*_`]*:[ \t]*([A-Za-z_ -]+?)[ \t]*(?:[:(]\s*(.*?)\)?)?[ \t*_`]*$/im;
const NEXT_LINE = /^[ \t>*_`-]*NEXT[_ ]CHECK[ \t*_`]*:[ \t]*(.+?)[ \t*_`]*$/im;
const ALL_GOAL_LINES = /^[ \t>*_`-]*(?:GOAL[_ ]STATUS|NEXT[_ ]CHECK)[ \t*_`]*:.*$\n?/gim;

function readStatus(word: string): GoalReportStatus | undefined {
  const key = word.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["achieved", "reached", "done", "met", "complete", "completed", "atteint"].includes(key)) return "achieved";
  if (["blocked", "stuck", "bloque", "bloqué"].includes(key)) return "blocked";
  if (["in_progress", "progress", "ongoing", "active", "en_cours"].includes(key)) return "in_progress";
  return undefined;
}

/** "in 3h", "in 2d", "in 45m", "dans 2 h", or an RFC 3339 time. */
export function parseNextCheck(text: string, now: number): number | undefined {
  const value = text.trim();
  const relative = /^(?:in|dans)\s+(\d{1,4})\s*(m|min|minutes?|h|hours?|heures?|d|days?|j|jours?)$/i.exec(value);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const ms = unit.startsWith("m") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
    return now + amount * ms;
  }
  // An absolute time must carry its offset: a bare local time is ambiguous.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

/** Read the bot's goal lines from its final words. */
export function readGoalReport(output: string | undefined, now: number): GoalReport {
  const text = output ?? "";
  const status = STATUS_LINE.exec(text);
  const next = NEXT_LINE.exec(text);
  const report = text.replace(ALL_GOAL_LINES, "").trim();
  const out: GoalReport = { report };
  if (status) {
    const read = readStatus(status[1] ?? "");
    if (read) out.status = read;
    const note = status[2]?.trim();
    if (note) out.note = note.slice(0, ROUTINE_GOAL_PROGRESS_CHARS);
  }
  if (next) {
    const at = parseNextCheck(next[1] ?? "", now);
    if (at !== undefined) out.nextCheckAt = clampNextCheck(at, now);
  }
  return out;
}

export function clampNextCheck(at: number, now: number): number {
  return Math.min(now + ROUTINE_GOAL_MAX_CHECK_MS, Math.max(now + ROUTINE_GOAL_MIN_CHECK_MS, at));
}

export interface GoalStep {
  goal: RoutineGoal;
  /** The routine stops (goal reached or deadline passed). */
  stop: boolean;
  /** Something the person should hear about (blocked, stalled, expired). */
  problem?: string;
}

/** The note's metric: a percentage first, else its first number ("78,95 %"
 * and "78.95%" read the same). Undefined when the note has none. */
export function progressMetric(note: string | undefined): number | undefined {
  if (!note) return undefined;
  const read = (raw: string) => {
    const value = Number(raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
    return Number.isFinite(value) ? value : undefined;
  };
  const percent = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(note);
  if (percent) return read(percent[1]!);
  const number = /-?\d+(?:[.,]\d+)?/.exec(note);
  return number ? read(number[0]) : undefined;
}

function normalizedNote(note: string): string {
  return note.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Whether a progress note says the goal did not move since the previous one:
 * the same metric within a small tolerance, or (no metric) the same words
 * whatever the case, accents and punctuation. */
export function progressUnchanged(previous: string | undefined, note: string | undefined): boolean {
  if (!previous || !note) return false;
  const before = progressMetric(previous);
  const after = progressMetric(note);
  if (before !== undefined && after !== undefined) {
    return Math.abs(after - before) <= Math.max(1e-6, Math.abs(before) * 0.001);
  }
  if (before !== undefined || after !== undefined) return false;
  return normalizedNote(previous) === normalizedNote(note);
}

/** When a goal with no chosen next check looks again: a day later, never
 * past its deadline. */
export function defaultNextCheck(goal: RoutineGoal, now: number): number {
  const at = now + ROUTINE_GOAL_DEFAULT_CHECK_MS;
  return goal.deadline ? Math.min(at, Math.max(goal.deadline, now + ROUTINE_GOAL_MIN_CHECK_MS)) : at;
}

/** Whether a goal's deadline has passed for a run starting `at` (a run may
 * still start right at the deadline, within a short grace). */
export function goalPastDeadline(goal: RoutineGoal | undefined, at: number): boolean {
  return Boolean(goal && goal.status === "active" && goal.deadline && at > goal.deadline + ROUTINE_GOAL_DEADLINE_GRACE_MS);
}

/** An active goal closed by its deadline without a run: the goal and the
 * final report the person receives. */
export function expireGoal(goal: RoutineGoal, now: number): { goal: RoutineGoal; report: string; problem: string } {
  const next: RoutineGoal = { ...goal, status: "expired", expiredAt: now };
  delete next.nextCheckAt;
  const checks = goal.checks ?? 0;
  const lines = [
    `Goal closed at its deadline (${iso(goal.deadline ?? now)}): ${goal.text}`,
    `Checks run: ${checks}.`,
    goal.progress ? `Last progress: ${goal.progress}` : "No progress was reported.",
  ];
  return {
    goal: next,
    report: lines.join("\n"),
    problem: `The goal's deadline passed before it was reached${goal.progress ? `. Last progress: ${goal.progress}` : ""}`,
  };
}

/** The goal after a completed run. */
export function stepGoal(goal: RoutineGoal, report: GoalReport, now: number): GoalStep {
  const next: RoutineGoal = { ...goal, checks: (goal.checks ?? 0) + 1, lastCheckedAt: now };
  delete next.nextCheckAt;
  const note = report.note;
  // No note says nothing moved: it never resets the count (the 78,95 % case,
  // where the bot sometimes skipped its note and the alert never rang).
  if (goal.progress && (!note || progressUnchanged(goal.progress, note))) next.stalled = (goal.stalled ?? 0) + 1;
  else delete next.stalled;
  if (note) next.progress = note;
  if (report.status === "achieved") {
    next.status = "achieved";
    next.achievedAt = now;
    delete next.stalled;
    return { goal: next, stop: true };
  }
  if (goal.deadline && now >= goal.deadline) {
    next.status = "expired";
    next.expiredAt = now;
    return { goal: next, stop: true, problem: `The goal's deadline passed before it was reached${next.progress ? `. Last progress: ${next.progress}` : ""}` };
  }
  if (report.nextCheckAt !== undefined) {
    // Never past the deadline: the last check lands on it.
    next.nextCheckAt = goal.deadline ? Math.min(report.nextCheckAt, Math.max(goal.deadline, now + ROUTINE_GOAL_MIN_CHECK_MS)) : report.nextCheckAt;
  }
  if (report.status === "blocked") {
    return { goal: next, stop: false, problem: `The goal is blocked${note ? `: ${note}` : ""}` };
  }
  // Rings once every ROUTINE_GOAL_STALL_RUNS unchanged checks, not on every run.
  if (next.stalled && (next.stalled + 1) % ROUTINE_GOAL_STALL_RUNS === 0) {
    return { goal: next, stop: false, problem: `The goal has not moved in ${(next.stalled ?? 0) + 1} checks${next.progress ? `: ${next.progress}` : ""}` };
  }
  return { goal: next, stop: false };
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

/** What the run is told, after its instructions. */
export function routineGoalBlock(goal: RoutineGoal, now: number): string {
  const lines = [
    "This routine pursues a goal over several runs. You decide when to check and when to report.",
    `<goal>${goal.text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</goal>`,
    `Now: ${iso(now)}.${goal.deadline ? ` Deadline: ${iso(goal.deadline)}.` : ""}${goal.checks ? ` Checks so far: ${goal.checks}.` : ""}`,
  ];
  if (goal.progress) lines.push(`Your last progress note: ${goal.progress.replaceAll("<", "&lt;")}`);
  lines.push(
    "Check where the goal stands and act toward it within your usual permissions.",
    "Report to the person only when something meaningful changed, the goal is reached or you need them; otherwise end with NOTHING_TO_REPORT.",
    "Always end with these two lines (they are removed from your report):",
    "GOAL_STATUS: achieved | in_progress | blocked: <short progress note, a number when there is one>",
    "NEXT_CHECK: in <N>m|h|d, or an RFC 3339 time with its offset (when to look again; omit when achieved)",
    "Say achieved only when the goal is verifiably met; the routine then stops by itself.",
  );
  return lines.join("\n");
}
