// Derived stage of a delegated job (DEL-01). Pure: the assignment row and its
// event log decide the stage; nothing here starts, stops or delivers work.
// Priority is fixed so the UI always names who is waited on and for what.
import type { Assignment, AssignmentEvent, Outcome, Status } from "./types.ts";

/** Ordered stages of a delegated job. First match in STAGE_PRIORITY wins. */
export type JobStage =
  | "delivery_failed"
  | "awaiting_reply"
  | "to_review"
  | "held"
  | "queued"
  | "inactive"
  | "working"
  | "finished";

/** Highest priority first. */
export const STAGE_PRIORITY: readonly JobStage[] = [
  "delivery_failed",
  "awaiting_reply",
  "to_review",
  "held",
  "queued",
  "inactive",
  "working",
  "finished",
] as const;

/** Locale keys under task.sheet.stage.* (en source + fr signed). */
export const STAGE_LABEL_KEYS: Record<JobStage, `task.sheet.stage.${JobStage}`> = {
  delivery_failed: "task.sheet.stage.delivery_failed",
  awaiting_reply: "task.sheet.stage.awaiting_reply",
  to_review: "task.sheet.stage.to_review",
  held: "task.sheet.stage.held",
  queued: "task.sheet.stage.queued",
  inactive: "task.sheet.stage.inactive",
  working: "task.sheet.stage.working",
  finished: "task.sheet.stage.finished",
};

/** English defaults for server-side chips (no i18n on the server). Each line
 * says who is waited on and for what. */
export const STAGE_LABELS: Record<JobStage, string> = {
  delivery_failed: "Delivery failed: needs a new hand-off",
  awaiting_reply: "Waiting for your reply",
  to_review: "Ready for your review",
  held: "Blocked: needs you",
  queued: "Queued: waiting for a free slot",
  inactive: "Inactive: nothing running",
  working: "Working",
  finished: "Finished",
};

export type StageAssignment = Pick<
  Assignment,
  "status" | "outcome" | "question" | "result" | "reportedAt" | "finishedAt" | "executions"
>;

export type StageEvent = Pick<AssignmentEvent, "at" | "kind" | "detail">;

const FAILED_OUTCOMES: ReadonlySet<Outcome> = new Set([
  "stalled",
  "interrupted",
  "budget",
  "provider_error",
  "denied",
  "refused",
  "incomplete",
]);

const TERMINAL_STATUS: ReadonlySet<Status> = new Set(["completed", "failed", "cancelled", "expired"]);

/** Event detail markers the stage reader recognizes (harness-written). */
export const STAGE_DETAIL = {
  deliveryFailed: "delivery_failed",
  toReview: "to_review",
  humanMessage: "human_message",
  blocked: "blocked",
} as const;

function detailOf(event: StageEvent): string {
  return (event.detail ?? "").trim();
}

function hasDetail(event: StageEvent, marker: string): boolean {
  const detail = detailOf(event);
  return detail === marker || detail.startsWith(`${marker}:`) || detail.includes(`|${marker}|`);
}

/** Latest event matching `pred`, or undefined. */
function latest(events: readonly StageEvent[], pred: (event: StageEvent) => boolean): StageEvent | undefined {
  let found: StageEvent | undefined;
  for (const event of events) {
    if (pred(event) && (!found || event.at >= found.at)) found = event;
  }
  return found;
}

/** Whether a human message landed at or after `since` (inclusive). */
export function hasHumanMessageSince(events: readonly StageEvent[], since: number): boolean {
  return events.some((event) => {
    if (event.at < since) return false;
    if (event.kind === "answered") return true;
    return hasDetail(event, STAGE_DETAIL.humanMessage);
  });
}

/** Time of the latest blocked or failed report, if any. */
export function lastBlockedOrFailedAt(assignment: StageAssignment, events: readonly StageEvent[]): number | undefined {
  const settledFail = latest(events, (event) => {
    if (event.kind !== "settled" && event.kind !== "refused" && event.kind !== "cancelled") return false;
    if (hasDetail(event, STAGE_DETAIL.blocked)) return true;
    const detail = detailOf(event).toLowerCase();
    return /\bfailed\b|\bblocked\b|\brefused\b|\berror\b/.test(detail);
  });
  if (settledFail) return settledFail.at;
  if (assignment.status === "failed" || (assignment.outcome !== undefined && FAILED_OUTCOMES.has(assignment.outcome))) {
    return assignment.finishedAt ?? latest(events, (event) => event.kind === "settled" || event.kind === "refused")?.at;
  }
  return undefined;
}

function isDeliveryFailed(events: readonly StageEvent[]): boolean {
  const failed = latest(events, (event) => hasDetail(event, STAGE_DETAIL.deliveryFailed));
  if (!failed) return false;
  // A later human message or a fresh start clears the delivery-failed stage.
  if (hasHumanMessageSince(events, failed.at)) return false;
  const startedAfter = latest(events, (event) => event.kind === "started" && event.at > failed.at);
  return !startedAfter;
}

function isAwaitingReply(assignment: StageAssignment): boolean {
  if (assignment.status === "needs_input") return true;
  if (assignment.outcome === "needs_input") return true;
  return Boolean(assignment.question && assignment.status !== "running" && !TERMINAL_STATUS.has(assignment.status));
}

function isToReview(assignment: StageAssignment, events: readonly StageEvent[]): boolean {
  if (latest(events, (event) => hasDetail(event, STAGE_DETAIL.toReview) && !hasHumanMessageSince(events, event.at))) {
    return true;
  }
  // A finished deliverable that has not been reported to the requester yet
  // sits for review when the outcome is an ordinary done.
  return assignment.status === "completed"
    && assignment.outcome === "done"
    && Boolean(assignment.result?.trim())
    && assignment.reportedAt === undefined;
}

function isHeldStage(assignment: StageAssignment, events: readonly StageEvent[]): boolean {
  const at = lastBlockedOrFailedAt(assignment, events);
  if (at === undefined) return false;
  if (assignment.outcome === "stopped") return false;
  return !hasHumanMessageSince(events, at);
}

function isQueued(assignment: StageAssignment): boolean {
  return assignment.status === "queued";
}

function isWorking(assignment: StageAssignment): boolean {
  return assignment.status === "running";
}

function isFinished(assignment: StageAssignment): boolean {
  return TERMINAL_STATUS.has(assignment.status) && assignment.outcome !== "needs_input";
}

function isInactive(assignment: StageAssignment): boolean {
  return assignment.status === "waiting" || assignment.status === "resume";
}

/**
 * Pure stage of a delegated job. First matching stage in STAGE_PRIORITY wins.
 * `events` is the assignment's stored log (oldest or newest order both work).
 */
export function stageOf(assignment: StageAssignment, events: readonly StageEvent[] = []): JobStage {
  if (isDeliveryFailed(events)) return "delivery_failed";
  if (isAwaitingReply(assignment)) return "awaiting_reply";
  if (isToReview(assignment, events)) return "to_review";
  if (isHeldStage(assignment, events)) return "held";
  if (isQueued(assignment)) return "queued";
  if (isInactive(assignment)) return "inactive";
  if (isWorking(assignment)) return "working";
  if (isFinished(assignment)) return "finished";
  // A brand-new row with no status match still reads as queued.
  return "queued";
}

export function stageLabel(stage: JobStage): string {
  return STAGE_LABELS[stage];
}

export function stageLabelKey(stage: JobStage): `task.sheet.stage.${JobStage}` {
  return STAGE_LABEL_KEYS[stage];
}
