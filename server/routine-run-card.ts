// The lifecycle card of one routine run, as written into the conversation
// the run reports to (server/index.ts syncRoutineRunToSource).
import type { RoutineRunCardData } from "../shared/routine-run.ts";
import { redactSecretsInText } from "./redact.ts";
import type { RoutineRun } from "./routines.ts";

/** The longest report a run's message carries in the conversation
 * (2026-10-29): the whole report, not the 2 000 characters the run's record
 * keeps, so nobody has to open the run's own task to read it. */
export const ROUTINE_REPORT_POST_MAX = 20_000;

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
  const summary = visibleSummary ? redactSecretsInText(visibleSummary).slice(0, run.status === "waiting" ? 2_000 : ROUTINE_REPORT_POST_MAX) : undefined;
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
  if (run.autoPaused) card.autoPausedAfter = run.autoPaused.failures;
  if (run.status === "completed" && run.problems) card.problems = redactSecretsInText(run.problems).slice(0, 1_000);
  if (run.status === "queued" && run.attention) card.attention = redactSecretsInText(run.attention).slice(0, 500);
  return card;
}
