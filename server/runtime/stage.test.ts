import { describe, expect, it } from "vitest";

import {
  STAGE_DETAIL,
  STAGE_LABELS,
  STAGE_PRIORITY,
  stageLabel,
  stageLabelKey,
  stageOf,
  type StageAssignment,
  type StageEvent,
} from "./stage.ts";

function assignment(patch: Partial<StageAssignment> = {}): StageAssignment {
  return {
    status: "queued",
    result: "",
    executions: 0,
    ...patch,
  };
}

function event(at: number, kind: StageEvent["kind"], detail?: string): StageEvent {
  return { at, kind, ...(detail !== undefined ? { detail } : {}) };
}

describe("stageOf priority table", () => {
  const rows: Array<{
    name: string;
    assignment: StageAssignment;
    events: StageEvent[];
    stage: keyof typeof STAGE_LABELS;
  }> = [
    {
      name: "delivery failed beats an open question",
      assignment: assignment({ status: "needs_input", question: "Which database?" }),
      events: [event(10, "refused", STAGE_DETAIL.deliveryFailed)],
      stage: "delivery_failed",
    },
    {
      name: "open question beats a result ready to review",
      assignment: assignment({
        status: "needs_input",
        question: "Ship to staging?",
        result: "PR opened",
        outcome: "needs_input",
      }),
      events: [event(5, "parked", "Ship to staging?")],
      stage: "awaiting_reply",
    },
    {
      name: "result ready to review beats a held failure",
      assignment: assignment({
        status: "completed",
        outcome: "done",
        result: "Diff ready in branch feat/x",
      }),
      events: [event(5, "settled", "failed"), event(8, "progress", STAGE_DETAIL.toReview)],
      stage: "to_review",
    },
    {
      name: "held blocked without a human message since",
      assignment: assignment({ status: "failed", outcome: "provider_error", finishedAt: 20, result: "API 500" }),
      events: [event(20, "settled", "failed: provider_error")],
      stage: "held",
    },
    {
      name: "queued when accepted and not yet admitted",
      assignment: assignment({ status: "queued" }),
      events: [event(1, "enqueued")],
      stage: "queued",
    },
    {
      name: "inactive while waiting on children",
      assignment: assignment({ status: "waiting", executions: 1 }),
      events: [event(1, "enqueued"), event(2, "started"), event(3, "waiting")],
      stage: "inactive",
    },
    {
      name: "working while a turn runs",
      assignment: assignment({ status: "running", executions: 1 }),
      events: [event(1, "enqueued"), event(2, "started")],
      stage: "working",
    },
    {
      name: "finished when completed and reported",
      assignment: assignment({
        status: "completed",
        outcome: "done",
        result: "Done",
        reportedAt: 50,
        finishedAt: 40,
      }),
      events: [event(40, "settled", "done"), event(50, "reported")],
      stage: "finished",
    },
    {
      name: "finished when cancelled by the person",
      assignment: assignment({ status: "cancelled", outcome: "stopped", finishedAt: 12 }),
      events: [event(12, "cancelled", "Stopped by user")],
      stage: "finished",
    },
    {
      name: "finished when the wait on the person expired",
      assignment: assignment({ status: "expired", outcome: "expired", finishedAt: 15, result: "the person did not answer" }),
      events: [event(15, "settled", "expired: expired — the person did not answer")],
      stage: "finished",
    },
    {
      name: "human message clears delivery_failed",
      assignment: assignment({ status: "running", executions: 1 }),
      events: [
        event(10, "refused", STAGE_DETAIL.deliveryFailed),
        event(20, "progress", STAGE_DETAIL.humanMessage),
        event(21, "started"),
      ],
      stage: "working",
    },
    {
      name: "human message lifts held back to finished failure still finished",
      assignment: assignment({ status: "failed", outcome: "provider_error", finishedAt: 20, result: "API 500" }),
      events: [
        event(20, "settled", "failed: provider_error"),
        event(30, "progress", STAGE_DETAIL.humanMessage),
      ],
      stage: "finished",
    },
    {
      name: "completed done without report is to_review",
      assignment: assignment({ status: "completed", outcome: "done", result: "Please review the PR" }),
      events: [event(10, "settled", "done")],
      stage: "to_review",
    },
    {
      name: "resume without a turn is inactive",
      assignment: assignment({ status: "resume", executions: 1 }),
      events: [event(4, "resume_due")],
      stage: "inactive",
    },
  ];

  it.each(rows)("$name → $stage", ({ assignment: row, events, stage }) => {
    expect(stageOf(row, events)).toBe(stage);
  });

  it("keeps STAGE_PRIORITY aligned with the documented order", () => {
    expect(STAGE_PRIORITY).toEqual([
      "delivery_failed",
      "awaiting_reply",
      "to_review",
      "held",
      "queued",
      "inactive",
      "working",
      "finished",
    ]);
  });

  it("names who is waited on for each stage", () => {
    expect(stageLabel("awaiting_reply")).toBe("Waiting for your reply");
    expect(stageLabel("to_review")).toBe("Ready for your review");
    expect(stageLabel("held")).toBe("Blocked: needs you");
    expect(stageLabelKey("held")).toBe("task.sheet.stage.held");
  });
});
