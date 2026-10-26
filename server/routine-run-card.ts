// The lifecycle card of one routine run, as written into the conversation
// the run reports to (server/index.ts syncRoutineRunToSource).
import type { RoutineRunCardData } from "../shared/routine-run.ts";
import { redactSecretsInText } from "./redact.ts";
import type { RoutineRun } from "./routines.ts";

export function routineRunCard(run: RoutineRun, cardThreadId?: string): RoutineRunCardData {
  // A run that joined the conversation it reports to (routines in
  // conversation) already wrote its whole report there, just under the
  // card: the card keeps only its state, or the report shows twice
  // (2026-10-19, GOX). A wait or a failure keeps its line.
  const joined = Boolean(cardThreadId && run.threadId === cardThreadId);
  const visibleSummary = run.status === "waiting" ? run.attention : joined || run.quiet ? undefined : run.output;
  const summary = visibleSummary ? redactSecretsInText(visibleSummary).slice(0, 2_000) : undefined;
  const error = run.error ? redactSecretsInText(run.error).slice(0, 500) : undefined;
  const card: RoutineRunCardData = {
    runId: run.id,
    routineId: run.routineId,
    routineName: redactSecretsInText(run.routineName),
    scheduledFor: run.scheduledFor,
    // A run quiet at the end (nothing for the person, JC 2026-10-22) whose
    // message was already posted while it waited on them reads as such.
    status: run.status === "completed" && run.quiet ? "nothing_to_report" : run.status,
  };
  if (run.goalStatus) card.goalStatus = run.goalStatus;
  if (run.deferredAt != null && run.status === "queued") card.deferredAt = run.deferredAt;
  if (run.threadId) card.executionThreadId = run.threadId;
  if (summary) card.summary = summary;
  if (error) card.error = error;
  return card;
}
