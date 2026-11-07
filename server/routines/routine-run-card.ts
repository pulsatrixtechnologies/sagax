// The lifecycle card of one routine run, as written into the conversation
// the run reports to (server/index.ts syncRoutineRunToSource).
import type { RoutineRunCardData } from "../../shared/routine-run.ts";
import { readableRoutineProblems } from "../../shared/routine-problems.ts";
import { clipMarkdownPreservingFences, unclosedFenceOffset } from "../../src/lib/rich-blocks.ts";
import { redactSecretsInText } from "../redact.ts";
import type { RoutineRun } from "./routines.ts";

/** The longest report a run's message carries in the conversation
 * (2026-10-29): the whole report, not the 2 000 characters the run's record
 * keeps, so nobody has to open the run's own task to read it. */
export const ROUTINE_REPORT_POST_MAX = 20_000;

/** Soft overflow past ROUTINE_REPORT_POST_MAX so a fence that starts near
 * the cap can finish (a ```widget must never ship half-closed). */
export const ROUTINE_REPORT_POST_HARD_MAX = 100_000;

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
    ? clipMarkdownPreservingFences(
      redactSecretsInText(visibleSummary),
      run.status === "waiting" ? 2_000 : ROUTINE_REPORT_POST_MAX,
      run.status === "waiting" ? 2_000 : ROUTINE_REPORT_POST_HARD_MAX,
    )
    : undefined;
  const error = run.error ? redactSecretsInText(run.error).slice(0, 500) : undefined;
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
  if (run.deferredAt != null && run.status === "queued") card.deferredAt = run.deferredAt;
  if (run.threadId) card.executionThreadId = run.threadId;
  if (summary) card.summary = summary;
  if (error) card.error = error;
  if (run.readiness) card.readiness = structuredClone(run.readiness);
  if (run.autoPaused) card.autoPausedAfter = run.autoPaused.failures;
  if (run.status === "completed" && run.problems) card.problems = readableRoutineProblems(redactSecretsInText(run.problems)).slice(0, 1_000);
  if (run.status === "queued" && run.attention) card.attention = redactSecretsInText(run.attention).slice(0, 500);
  if (run.startedAt) card.startedAt = run.startedAt;
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

/** The text of a run's message: what a client without the card draws, and
 * what the notification, the search and the thread preview read. */
export function routineRunFallbackText(card: RoutineRunCardData): string {
  const goalState = card.goalStatus === "needs-input"
    ? "needs your input"
    : card.goalStatus === "blocked"
      ? "was blocked"
      : card.goalStatus === "limit-reached"
        ? "reached its limit"
        : card.goalStatus === "stopped"
          ? "was stopped"
          : card.goalStatus === "failed"
            ? "failed"
            : undefined;
  const state = goalState ?? (
    card.status === "waiting"
      ? "needs your attention"
      : card.status === "completed"
        ? "completed"
        : card.status === "failed"
          ? "failed"
          : card.status === "cancelled"
            ? "was cancelled"
            : card.status === "missed"
              ? "was missed"
              : card.status === "nothing_to_report"
                ? "had nothing to report"
              : card.status === "queued" && card.deferredAt != null
                ? "deferred: target busy"
              : card.status
  );
  // Clients without the card (older phones) draw only this line, so it
  // carries what the run said, not just that it finished.
  const detail = card.summary ?? card.error;
  // A report reads as the bot's own message, the routine named under it.
  // 2026-11-01: a run that completed with problems says so, under its report.
  // 2026-11-03 (the maintainer): the problem lines themselves stay in the run detail
  // (View run), never in the conversation, this text included (an older
  // client, the notification, the search and the thread preview read it).
  const problems = card.status === "completed" && card.problems ? "\n\nCompleted with problems." : "";
  if (card.status === "completed" && (!card.goalStatus || card.goalStatus === "completed") && card.summary) return `${card.summary}${problems}\n\nRoutine “${card.routineName}”`;
  if (problems) return `Routine “${card.routineName}” completed with problems`;
  // 2026-10-26: older clients without the notice still read the pause.
  const paused = card.autoPausedAfter ? ` and was paused after ${card.autoPausedAfter} failures in a row` : "";
  return `Routine “${card.routineName}” ${state}${paused}${detail ? `\n\n${detail}` : ""}`;
}
