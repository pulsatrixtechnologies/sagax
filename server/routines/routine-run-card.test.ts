import { describe, expect, it } from "vitest";

import { routineRunCard } from "./routine-run-card.ts";
import type { RoutineRun } from "./routines.ts";

const REPORT = "Le suivi de 14 h 50 n'a rien écrit dans ConnectWise. J'ai libéré le verrou dispatch.";

function run(overrides: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id: "run-1", routineId: "r-1", routineName: "[Dispatch] New tickets", botId: "bot-1", scheduledFor: 1,
    createdAt: 1, status: "completed", target: "bot", runOn: "maus", threadId: "exec-1", output: REPORT,
    ...overrides,
  } as RoutineRun;
}

describe("routineRunCard", () => {
  // 2026-10-29: the conversation gets the whole report (read from the run's
  // task), not the 2 000 characters the run's record keeps, so nobody opens
  // the run's own task to read the rest.
  it("carries the whole report when the run's task holds it", () => {
    const whole = `${"Draft. ".repeat(600)}End.`;
    const card = routineRunCard(run({ output: whole.slice(0, 2_000) }), "main", whole);
    expect(card.summary).toBe(whole);
    expect(routineRunCard(run(), "main", "x".repeat(30_000)).summary).toHaveLength(20_000);
    // a wait keeps its short line
    expect(routineRunCard(run({ status: "waiting", attention: "Approve" }), "main", whole).summary).toBe("Approve");
  });

  it("carries the report when the run worked in its own task", () => {
    expect(routineRunCard(run(), "main").summary).toBe(REPORT);
  });

  // 2026-10-19 (production): routines in conversation wrote the full report under
  // the card, and the card repeated it.
  it("keeps only the state when the run joined the conversation it reports to", () => {
    const card = routineRunCard(run({ threadId: "main" }), "main");
    expect(card.summary).toBeUndefined();
    expect(card.status).toBe("completed");
    expect(card.executionThreadId).toBe("main");
  });

  it("still says what a joined run waits for, and why it failed", () => {
    expect(routineRunCard(run({ threadId: "main", status: "waiting", attention: "Approve the write" }), "main").summary).toBe("Approve the write");
    expect(routineRunCard(run({ threadId: "main", status: "failed", error: "cluster down" }), "main").error).toBe("cluster down");
  });

  // 2026-10-22: a run that waited on the person, then ended with nothing to
  // report, leaves its one message saying so, without a report.
  it("a quiet run reads as nothing to report", () => {
    const card = routineRunCard(run({ quiet: true }), "main");
    expect(card.status).toBe("nothing_to_report");
    expect(card.summary).toBeUndefined();
  });

  it("says when the failure paused its routine (2026-10-26)", () => {
    expect(routineRunCard(run({ status: "failed", error: "down", autoPaused: { failures: 5 } }), "main").autoPausedAfter).toBe(5);
    expect(routineRunCard(run({ status: "failed", error: "down" }), "main")).not.toHaveProperty("autoPausedAfter");
  });
});
