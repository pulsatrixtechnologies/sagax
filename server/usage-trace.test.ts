import { describe, expect, it } from "vitest";
import { buildUsageTraces } from "./usage-trace.ts";
import type { UsageRow } from "./usage-ledger.ts";

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    at: "2026-10-22T12:00:00.000Z",
    botId: "b1",
    botName: "Scout",
    threadId: "t1",
    instanceId: "claude",
    driverKind: "claudeAgent",
    model: "claude-sonnet-5",
    input: 1200,
    output: 300,
    cachedInput: 900,
    costUsd: 0.012,
    costSource: "reported",
    durationMs: 4200,
    trigger: { kind: "user", email: "ada@example.test" },
    ...overrides,
  };
}

describe("buildUsageTraces", () => {
  it("records a job's time and cost from the ledger's turns", () => {
    const { jobs } = buildUsageTraces([
      row({ at: "2026-10-22T12:00:00.000Z", durationMs: 4200, costUsd: 0.012, input: 1200, output: 300 }),
      row({ at: "2026-10-22T12:01:00.000Z", durationMs: 5800, costUsd: 0.008, input: 800, output: 200 }),
    ]);
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.turns).toBe(2);
    expect(job.timedTurns).toBe(2);
    expect(job.durationMs).toBe(10_000);
    expect(job.costUsd).toBeCloseTo(0.02, 6);
    expect(job.input).toBe(2000);
    expect(job.output).toBe(500);
    // The per-turn breakdown, oldest first, is the trace itself.
    expect(job.steps.map((s) => s.durationMs)).toEqual([4200, 5800]);
  });

  it("names the job by human label and keeps raw ids for a tooltip/copy, never a shown UUID", () => {
    const { jobs } = buildUsageTraces([row({ botId: "bot_8f3a", botName: "Scout", threadId: "thr_9c2d" })]);
    const job = jobs[0]!;
    expect(job.botName).toBe("Scout");
    expect(job.triggerLabel).toBe("ada@example.test");
    // ids are carried for a copy affordance, separate from the shown label
    expect(job.botId).toBe("bot_8f3a");
    expect(job.threadId).toBe("thr_9c2d");
    // the label fields hold no raw id
    expect(job.botName).not.toContain("bot_8f3a");
    expect(job.triggerLabel).not.toContain("thr_9c2d");
  });

  it("separates a routine run from a person's turns on the same thread", () => {
    const { jobs } = buildUsageTraces([
      row({ threadId: "t9", trigger: { kind: "user", email: "ada@example.test" }, costUsd: 0.01 }),
      row({ threadId: "t9", trigger: { kind: "routine", routineId: "r1", label: "Morning digest" }, costUsd: 0.03 }),
    ]);
    expect(jobs).toHaveLength(2);
    const routine = jobs.find((j) => j.triggerKind === "routine")!;
    expect(routine.routineId).toBe("r1");
    expect(routine.triggerLabel).toContain("Morning digest");
    expect(routine.costUsd).toBeCloseTo(0.03, 6);
  });

  it("falls back to time and token counts when the model is unpriced (no invented price)", () => {
    const { jobs } = buildUsageTraces([
      row({ costUsd: null, costSource: undefined, input: 500, output: 100, durationMs: 3000 }),
    ]);
    const job = jobs[0]!;
    expect(job.costUsd).toBeNull();
    expect(job.unpriced).toBe(1);
    expect(job.input).toBe(500);
    expect(job.output).toBe(100);
    expect(job.durationMs).toBe(3000);
  });

  it("marks the estimated share apart from reported cost", () => {
    const { jobs } = buildUsageTraces([
      row({ costUsd: 0.01, costSource: "reported" }),
      row({ costUsd: 0.02, costSource: "estimated" }),
    ]);
    const job = jobs[0]!;
    expect(job.costUsd).toBeCloseTo(0.03, 6);
    expect(job.estimatedUsd).toBeCloseTo(0.02, 6);
  });

  it("counts time only from turns that carried a duration", () => {
    const { jobs } = buildUsageTraces([
      row({ durationMs: 4000 }),
      row({ durationMs: undefined }),
    ]);
    const job = jobs[0]!;
    expect(job.turns).toBe(2);
    expect(job.timedTurns).toBe(1);
    expect(job.durationMs).toBe(4000);
    expect(job.steps[1]!.durationMs).toBeNull();
  });

  it("orders jobs newest first and caps the list, flagging truncation", () => {
    const rows: UsageRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(row({ threadId: `t${i}`, at: `2026-10-22T12:0${i}:00.000Z` }));
    }
    const { jobs, truncated, total } = buildUsageTraces(rows, { max: 3 });
    expect(jobs).toHaveLength(3);
    expect(truncated).toBe(true);
    // newest first
    expect(jobs[0]!.lastAt > jobs[1]!.lastAt).toBe(true);
    expect(total.jobs).toBe(3);
    expect(total.turns).toBe(3);
  });

  it("carries no message content, only counters, time and cost", () => {
    const { jobs } = buildUsageTraces([row()]);
    const serialized = JSON.stringify(jobs[0]);
    // The ledger never stores text; the trace must not add any either.
    const keys = Object.keys(jobs[0]!.steps[0]!);
    expect(keys.sort()).toEqual(
      ["at", "cachedInput", "costSource", "costUsd", "durationMs", "engine", "input", "model", "output"].sort(),
    );
    expect(serialized).not.toMatch(/prompt|message|content|text/i);
  });
});
