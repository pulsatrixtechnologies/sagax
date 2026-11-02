import { describe, expect, it } from "vitest";
import {
  evaluateRoutinePrecheck,
  loadRoutinePrecheck,
  parseRoutinePrecheck,
  runRoutinePrecheck,
  RoutinePrecheckError,
} from "./routine-precheck.ts";

const now = Date.parse("2026-10-20T12:00:00Z");

describe("routine pre-check validation", () => {
  it("accepts the condition kinds", () => {
    expect(parseRoutinePrecheck({ kind: "condition", test: "elapsed_since_report", minMinutes: 60 }))
      .toEqual({ kind: "condition", test: "elapsed_since_report", minMinutes: 60 });
    expect(parseRoutinePrecheck({ kind: "condition", test: "every_nth", every: 3 })).toMatchObject({ test: "every_nth" });
  });

  it.each([
    null,
    "always",
    { kind: "script", command: "echo hi" },
    { kind: "condition", test: "unknown" },
    { kind: "condition", test: "elapsed_since_report" },
    { kind: "condition", test: "elapsed_since_report", minMinutes: 0 },
    { kind: "condition", test: "elapsed_since_report", minMinutes: 1.5 },
    { kind: "condition", test: "elapsed_since_report", minMinutes: 60, extra: true },
    { kind: "condition", test: "every_nth", every: 1 },
    { kind: "other", test: "every_nth", every: 2 },
  ])("rejects %j", (value) => {
    expect(() => parseRoutinePrecheck(value)).toThrow(RoutinePrecheckError);
    expect(loadRoutinePrecheck(value)).toBeUndefined();
  });
});

describe("routine pre-check evaluation", () => {
  it("elapsed_since_report wakes with no report, sleeps within the window, wakes after it", () => {
    const check = parseRoutinePrecheck({ kind: "condition", test: "elapsed_since_report", minMinutes: 30 });
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 0 })).toEqual({ wake: true });
    const quiet = evaluateRoutinePrecheck(check, { now, lastReportAt: now - 10 * 60_000, quietRunsSinceReport: 0 });
    expect(quiet.wake).toBe(false);
    expect(evaluateRoutinePrecheck(check, { now, lastReportAt: now - 30 * 60_000, quietRunsSinceReport: 0 })).toEqual({ wake: true });
  });

  it("every_nth wakes on the nth occurrence", () => {
    const check = parseRoutinePrecheck({ kind: "condition", test: "every_nth", every: 3 });
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 0 }).wake).toBe(false);
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 1 }).wake).toBe(false);
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 2 }).wake).toBe(true);
  });

  it("throws on a pre-check it cannot read", () => {
    expect(() => evaluateRoutinePrecheck({ kind: "condition", test: "nope" } as never, { now, quietRunsSinceReport: 0 }))
      .toThrow(RoutinePrecheckError);
  });

  it("rejects on an error, a timeout or a malformed answer", async () => {
    await expect(runRoutinePrecheck(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(runRoutinePrecheck(() => new Promise(() => {}), 20)).rejects.toThrow(/did not answer/);
    await expect(runRoutinePrecheck(() => ({}) as never)).rejects.toThrow(/no answer/);
    await expect(runRoutinePrecheck(() => ({ wake: false, reason: "x".repeat(500) })))
      .resolves.toMatchObject({ wake: false, reason: "x".repeat(200) });
  });
});

describe("routine watch pre-check validation (2026-10-26)", () => {
  it("accepts a file, a command and a read tool watch", () => {
    expect(parseRoutinePrecheck({ kind: "watch", source: { type: "files", path: "reports", recursive: true } }))
      .toMatchObject({ kind: "watch", source: { type: "files", path: "reports" } });
    expect(parseRoutinePrecheck({
      kind: "watch", source: { type: "command", command: "git status --short" },
      condition: { test: "exit_code", op: "ne", value: 0 }, wakeOn: "match",
    })).toMatchObject({ wakeOn: "match" });
    expect(parseRoutinePrecheck({
      kind: "watch", source: { type: "tool", tool: "tracker__search_issues", args: { state: "open" } },
      track: { items: "$.issues", key: "id", fields: ["status", "priority"] },
      condition: { test: "json_path", path: "$.issues.length", op: "gt", value: 0 },
      firstRun: "wake", whenAsleep: "wake",
    })).toMatchObject({ track: { key: "id" } });
    expect(parseRoutinePrecheck({ kind: "watch", source: { type: "tool", tool: "memory_recall" } }).kind).toBe("watch");
  });

  it.each([
    [{ kind: "watch", source: { type: "tool", tool: "mail__send_message" } }, /read tools only/],
    [{ kind: "watch", source: { type: "tool", tool: "tracker__update_issue" } }, /read tools only/],
    [{ kind: "watch", source: { type: "tool", tool: "tracker__write" } }, /read tools only/],
    [{ kind: "watch", source: { type: "tool", tool: "mail__create_draft" } }, /read tools only/],
    [{ kind: "watch", source: { type: "tool", tool: "payments__list_and_refund" } }, /read tools only/],
    [{ kind: "watch", source: { type: "command", command: "ls" }, wakeOn: "match" }, /needs a condition/],
    [{ kind: "watch", source: { type: "files", path: "a" }, condition: { test: "exit_code", op: "eq", value: 0 } }, /only for a command/],
    [{ kind: "watch", source: { type: "files", path: "a" }, track: { key: "id" } }, /file by file/],
    [{ kind: "watch", source: { type: "command", command: "" } }, /valid pre-check/],
    [{ kind: "watch", source: { type: "command", command: "x".repeat(3_000) } }, /valid pre-check/],
    [{ kind: "watch", source: { type: "command", command: "ls" }, extra: 1 }, /valid pre-check/],
    [{ kind: "watch", source: { type: "command", command: "ls" }, condition: { test: "json_path", path: "$.a", op: "gt" } }, /value to compare/],
  ])("rejects %j", (value, reason) => {
    expect(() => parseRoutinePrecheck(value)).toThrow(reason);
    expect(loadRoutinePrecheck(value)).toBeUndefined();
  });

  it("evaluateRoutinePrecheck refuses a watch (it needs the wired reader)", () => {
    const watch = parseRoutinePrecheck({ kind: "watch", source: { type: "command", command: "ls" } });
    expect(() => evaluateRoutinePrecheck(watch, { now, quietRunsSinceReport: 0 })).toThrow(RoutinePrecheckError);
  });

  it("keeps a woken watch's note, bounded", async () => {
    await expect(runRoutinePrecheck(() => ({ wake: true, note: "n".repeat(10_000) })))
      .resolves.toMatchObject({ wake: true, note: "n".repeat(4_000) });
    await expect(runRoutinePrecheck(() => ({ wake: true }))).resolves.toEqual({ wake: true });
  });
});
