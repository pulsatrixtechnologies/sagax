import { describe, expect, it } from "vitest";

import type { RoutineWatchPrecheck } from "../../../shared/routine-watch";
import { draftFromWatch, watchFromDraft } from "./WatchFields";

describe("routine watch draft (2026-10-26)", () => {
  it("off sends no watch; each source round-trips", () => {
    expect(watchFromDraft(draftFromWatch(undefined))).toEqual({ watch: null });
    const watches: RoutineWatchPrecheck[] = [
      { kind: "watch", source: { type: "files", path: "reports", recursive: true } },
      { kind: "watch", source: { type: "files", path: "jobs.json", readBytes: 1024 }, track: { items: "jobs" } },
      { kind: "watch", source: { type: "files", path: "jobs.json", readBytes: 512 }, track: {} },
      { kind: "watch", source: { type: "files", path: "reports", recursive: true, pattern: "**/*.csv" } },
      { kind: "watch", source: { type: "command", command: "git status --short" }, wakeOn: "match", condition: { test: "exit_code", op: "ne", value: 0 }, whenAsleep: "wake" },
      { kind: "watch", source: { type: "tool", tool: "tracker__search_issues", args: { state: "open" } }, track: { items: "$.issues", key: "id", fields: ["status", "priority"] }, condition: { test: "json_path", path: "$.issues.length", op: "gt", value: 0 }, firstRun: "wake" },
    ];
    for (const watch of watches) expect(watchFromDraft(draftFromWatch(watch))).toEqual({ watch });
  });

  it("says what is missing instead of sending a broken watch", () => {
    const base = { ...draftFromWatch(undefined), on: true };
    expect(watchFromDraft({ ...base, type: "files", path: "../up" })).toEqual({ error: "routineWatch.errorPath" });
    expect(watchFromDraft({ ...base, type: "command", command: " " })).toEqual({ error: "routineWatch.errorCommand" });
    expect(watchFromDraft({ ...base, type: "tool", tool: "a__list", args: "[1]" })).toEqual({ error: "routineWatch.errorArgs" });
    expect(watchFromDraft({ ...base, type: "tool", tool: "a__list", condition: "json_path" })).toEqual({ error: "routineWatch.errorConditionPath" });
  });

  it("typed values, no wake-on-asleep for a tool, no exit code but for a command", () => {
    const base = { ...draftFromWatch(undefined), on: true, type: "tool" as const, tool: "a__list", whenAsleep: "wake" as const };
    expect(watchFromDraft({ ...base, condition: "json_path", conditionPath: "$.n", conditionOp: "gte", conditionValue: "3" }))
      .toEqual({ watch: { kind: "watch", source: { type: "tool", tool: "a__list" }, condition: { test: "json_path", path: "$.n", op: "gte", value: 3 } } });
    expect(watchFromDraft({ ...base, condition: "exit_code" })).toEqual({ watch: { kind: "watch", source: { type: "tool", tool: "a__list" } } });
  });
});
