// The lifecycle card of one routine run, as written into the conversation
// the run reports to (server/index.ts syncRoutineRunToSource).
import type { RoutineRunCardData } from "../../shared/routine-run.ts";
import { readableRoutineProblems } from "../../shared/routine-problems.ts";
import { clipMarkdownPreservingFences, unclosedFenceOffset } from "../../src/lib/rich-blocks.ts";
import { clipReadable, reportBrief } from "../../shared/routine-result.ts";
import { redactSecretsInText } from "../redact.ts";
import type { RoutineRun } from "./routines.ts";
import { personWord, readerLanguage } from "../people/person-words.ts";

/** The longest report a run's message carries in the conversation
 * (2026-10-29): the whole report, not the 2 000 characters the run's record
 * keeps, so nobody has to open the run's own task to read it. */
export const ROUTINE_REPORT_POST_MAX = 20_000;

/** Soft overflow past ROUTINE_REPORT_POST_MAX so a fence that starts near
 * the cap can finish (a ```widget must never ship half-closed). */
export const ROUTINE_REPORT_POST_HARD_MAX = 100_000;

/** #3515: a run's text within `max`, never cut inside a fenced block
 * (#2186) nor in the middle of a word: a cut outside any fence ends at a
 * line, a sentence or a word (clipReadable). */
function clipReport(text: string, max: number, hardMax: number): string {
  if (text.length <= max || unclosedFenceOffset(text.slice(0, max)) >= 0) return clipMarkdownPreservingFences(text, max, hardMax);
  return clipReadable(text, max);
}

/** The task's cleaned report when it is the run record's whole message
 * (#2186): the record keeps 2 000 characters and may end inside a fence, so
 * a strict prefix check alone would drop the rest. */
export function pickRoutineFullReport(recorded: string, taskReport: string): string | undefined {
  const report = taskReport.trim();
  const kept = recorded.trim();
  if (!report || !kept || report.length <= kept.length) return undefined;
  const head = kept.slice(0, 200);
  if (report.startsWith(head)) return report;
  const open = unclosedFenceOffset(kept);
  if (open <= 0) return undefined;
  const before = kept.slice(0, open).replace(/\s+$/u, "");
  if (!before) return undefined;
  return report.startsWith(before.slice(0, Math.min(200, before.length))) ? report : undefined;
}

/** #2694: the kind of proactive wake a run is, for feedback from the chat:
 * "heartbeat" (HEARTBEAT.md), or the wake's first source (mail, calendar,
 * screen, ...). Undefined for a routine or a webhook of the person's own.
 * #3423: a watch wake's "never" is not a mute of every watch of the bot:
 * the card carries its watches, and the "never" stops those. */
export function wakeTopicOf(run: Pick<RoutineRun, "webhookId" | "proactive">): string | undefined {
  if (run.webhookId?.startsWith("heartbeat:")) return "heartbeat";
  const source = run.proactive?.sources[0];
  return source && /^[a-z]{1,30}$/.test(source) ? source : undefined;
}

/** #4050: the wake's identity for its streak (RoutineManager.sameStreak): a
 * heartbeat, or every source it gathered (a mail and a watch together are
 * neither the mail streak nor the watch streak). Its card's topic
 * (wakeTopicOf) is the first of them. A streak's cards are found by its
 * first run (`problemRepeat.firstRunId`, `recovered.firstRunId`), which
 * this identity chose. */
export function wakeStreakOf(run: Pick<RoutineRun, "webhookId" | "proactive">): string {
  if (wakeTopicOf(run) === "heartbeat") return "heartbeat";
  return [...new Set(run.proactive?.sources ?? [])].sort().join(",");
}

/** `fullReport`: the bot's whole final message, read from the run's task
 * (syncRoutineRunToSource), when the run's record holds only its start. */
export function routineRunCard(run: RoutineRun, cardThreadId?: string, fullReport?: string): RoutineRunCardData {
  // A run that joined the conversation it reports to (routines in
  // conversation) already wrote its whole report there, just under the
  // card: the card keeps only its state, or the report shows twice
  // (2026-10-19, production). A wait or a failure keeps its line.
  const joined = Boolean(cardThreadId && run.threadId === cardThreadId);
  const report = fullReport?.trim() || run.output;
  const visibleSummary = run.status === "waiting" ? run.attention : joined || run.quiet ? undefined : report;
  // 2026-11-06 (#2186): never cut inside a fenced block. A mid-widget slice
  // drew as raw code ("Widget-imperfect · N lines") in the chat card.
  const summary = visibleSummary
    ? clipReport(
      redactSecretsInText(visibleSummary),
      run.status === "waiting" ? 2_000 : ROUTINE_REPORT_POST_MAX,
      run.status === "waiting" ? 2_000 : ROUTINE_REPORT_POST_HARD_MAX,
    )
    : undefined;
  const error = run.error ? clipReadable(redactSecretsInText(run.error), 500) : undefined;
  const card: RoutineRunCardData = {
    runId: run.id,
    routineId: run.routineId,
    routineName: redactSecretsInText(run.routineName),
    scheduledFor: run.scheduledFor,
    // A run quiet at the end (nothing for the person 2026-10-22) whose
    // message was already posted while it waited on them reads as such.
    status: run.status === "completed" && run.quiet ? "nothing_to_report" : run.status,
  };
  if (run.goalStatus) card.goalStatus = run.goalStatus;
  // #3990: a run the person started stays theirs in the chat (shared/routine-repeat.ts routineRunRowOutOfChat)
  if (run.startedBy === "person") card.startedBy = "person";
  if (run.deferredAt != null && run.status === "queued") card.deferredAt = run.deferredAt;
  if (run.threadId) card.executionThreadId = run.threadId;
  if (summary) card.summary = summary;
  // #3581: the card's one or two lines, the report's own closing line; the
  // whole report stays in `summary` (released apps draw it, Details opens it).
  const brief = visibleSummary && run.status !== "waiting" ? reportBrief(redactSecretsInText(visibleSummary), "end") : "";
  if (brief) card.brief = brief;
  if (error) card.error = error;
  if (run.readiness) card.readiness = structuredClone(run.readiness);
  if (run.autoPaused) card.autoPausedAfter = run.autoPaused.failures;
  if (run.status === "completed" && run.problems) card.problems = readableRoutineProblems(redactSecretsInText(run.problems)).slice(0, 1_000);
  // #3479: a lasting problem's count, and the first success after it.
  // #4201: the count is the streak's one card's to tell; a run the person
  // started is their own result, never "N runs with problems since".
  if (run.status === "completed" && run.problems && run.problemRepeat && run.startedBy !== "person") {
    card.repeat = { ...run.problemRepeat, lastAt: run.finishedAt ?? run.problemRepeat.since };
  }
  if (run.status === "completed" && !run.problems && run.recovered) card.recovered = { afterRuns: run.recovered.afterRuns, since: run.recovered.since };
  if (run.status === "queued" && run.attention) card.attention = clipReadable(redactSecretsInText(run.attention), 500);
  if (run.startedAt) card.startedAt = run.startedAt;
  const wakeTopic = wakeTopicOf(run);
  if (wakeTopic) card.wakeTopic = wakeTopic;
  // #3990: a wake's real report, told apart from the rows stored before
  if (run.proactive && wakeTopic && run.status === "completed" && !run.quiet && !run.problems) card.forPerson = true;
  if (run.proactive?.watches?.length) card.watches = run.proactive.watches.map((entry) => ({ id: entry.id, domain: entry.domain }));
  if (run.handedTo?.length) card.handedTo = run.handedTo.map((entry) => ({
    botId: entry.botId, threadId: entry.threadId, status: entry.status,
    ...(entry.name ? { name: redactSecretsInText(entry.name) } : {}),
    ...(entry.task ? { task: redactSecretsInText(entry.task).slice(0, 80) } : {}),
    ...(entry.startedAt ? { startedAt: entry.startedAt } : {}),
    ...(entry.finishedAt ? { finishedAt: entry.finishedAt } : {}),
    ...(entry.note ? { note: redactSecretsInText(entry.note).slice(0, 160) } : {}),
  }));
  return card;
}

/** A moment in the person's zone, as the card shows it; UTC, said so, when
 * no valid zone is known. */
function shortAt(at: number, timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(at).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    } catch { /* an unknown zone reads in UTC */ }
  }
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** #3479: how long a lasting problem has been there, for the row's text. */
export function routineRepeatLine(repeat: { count: number; since: number; streak?: true; anyProblem?: true }, language?: string, timeZone?: string): string {
  // #3695: a repeating routine's streak counts runs with problems, whatever
  // they said; #3910: on each of its cards, the summary and a run the person started
  const key = repeat.streak || repeat.anyProblem ? "routineRun.problemStreak" : "routineRun.sameProblem";
  return `${personWord(readerLanguage(language), key, { since: shortAt(repeat.since, timeZone), count: repeat.count })}.`;
}

/** #3479: the line of the first success after runs with problems. */
export function routineRecoveredLine(recovered: { afterRuns: number; since: number }, language?: string, timeZone?: string): string {
  const runs = recovered.afterRuns;
  return personWord(readerLanguage(language), runs === 1 ? "routineRun.text.recoveredOne" : "routineRun.text.recoveredMany", { count: runs, since: shortAt(recovered.since, timeZone) });
}

/** The catalog key of each state a run's line names. */
const STATE_KEYS: Record<string, string> = {
  "needs-input": "routineRun.text.state.needsInput",
  blocked: "routineRun.text.state.blocked",
  "limit-reached": "routineRun.text.state.limitReached",
  stopped: "routineRun.text.state.stopped",
  failed: "routineRun.text.state.failed",
  waiting: "routineRun.text.state.waiting",
  completed: "routineRun.text.state.completed",
  cancelled: "routineRun.text.state.cancelled",
  missed: "routineRun.text.state.missed",
  nothing_to_report: "routineRun.text.state.nothingToReport",
  deferred: "routineRun.text.state.deferred",
};

/** The text of a run's message: what a client without the card draws, and
 * what the notification, the search, the thread preview and an AI client
 * (the agent API, the organization's connector) read. #3515: in the
 * language of the conversation, from the locale catalogs. */
export function routineRunFallbackText(card: RoutineRunCardData, language?: string, timeZone?: string): string {
  const lang = readerLanguage(language);
  const say = (key: string, vars?: Record<string, string | number>) => personWord(lang, key, vars);
  const routine = say("routineRun.text.name", { name: card.routineName });
  const goalState = card.goalStatus && card.goalStatus !== "completed" && card.goalStatus in STATE_KEYS ? card.goalStatus : undefined;
  const stateOf = goalState ?? (card.status === "queued" && card.deferredAt != null ? "deferred" : card.status);
  const state = STATE_KEYS[stateOf] ? say(STATE_KEYS[stateOf]!) : card.status;
  // Clients without the card (older phones) draw only this line, so it
  // carries what the run said, not just that it finished.
  const detail = card.summary ?? card.error;
  // A report reads as the bot's own message, the routine named under it.
  // 2026-11-01: a run that completed with problems says so, under its report.
  // 2026-11-03 (the maintainer): the problem lines themselves stay in the run detail
  // (View run), never in the conversation, this text included (an older
  // client, the notification, the search and the thread preview read it).
  const problems = card.status === "completed" && card.problems
    ? `\n\n${say("routines.status.completedWithProblems")}.${card.repeat && card.repeat.count > 1 ? ` ${routineRepeatLine(card.repeat, language, timeZone)}` : ""}`
    : "";
  // #3479: the first success after runs with problems is said once.
  const recovered = card.recovered && (card.status === "completed" || card.status === "nothing_to_report") ? routineRecoveredLine(card.recovered, language, timeZone) : "";
  if (recovered && card.summary && card.status === "completed") return `${card.summary}\n\n${recovered}\n\n${routine}`;
  if (recovered) return `${routine} · ${recovered}`;
  if (card.status === "completed" && (!card.goalStatus || card.goalStatus === "completed") && card.summary) return `${card.summary}${problems}\n\n${routine}`;
  if (problems) return say("routineRun.text.lineProblems", { routine });
  // 2026-10-26: older clients without the notice still read the pause.
  const line = card.autoPausedAfter
    ? say("routineRun.text.linePaused", { routine, state, count: card.autoPausedAfter })
    : say("routineRun.text.line", { routine, state });
  // #3695: a repeating routine's one summary card of a failure says how long it lasts
  const streak = card.repeat?.streak && card.repeat.count > 1 && !card.autoPausedAfter ? ` ${routineRepeatLine(card.repeat, language, timeZone)}` : "";
  return `${line}${streak ? `.${streak}` : ""}${detail ? `\n\n${detail}` : ""}`;
}
