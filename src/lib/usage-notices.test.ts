import { describe, expect, it } from "vitest";

import { expandAllPaths, isJsonName, jsonChildren, parseJsonText, ROOT_PATH } from "./json-tree";
import type { PlanRow } from "./plan-usage";
import { rowsForEngine, showsGroupCostNotice, weeklyLimitNotice } from "./usage-notices";

const window = (used: number | null) => ({ available: used !== null, remainingPercent: used === null ? null : 100 - used, usedPercent: used, resetsAt: "2026-10-25T00:00:00Z" });
const row = (id: string, used: number | null, access: PlanRow["access"] = "subscription"): PlanRow => ({
  id, name: id, driver: id, plan: null, state: "windows", access, instanceId: null, instanceIds: [], message: null,
  fiveHour: window(null), weekly: window(used), extra: [], models: [],
});

describe("weeklyLimitNotice", () => {
  it("stays quiet under 80 %", () => expect(weeklyLimitNotice([row("Claude", 79)])).toBeNull());
  it("picks the most used subscription window and bands it", () => {
    expect(weeklyLimitNotice([row("Claude", 82), row("Codex", 93.4)])).toMatchObject({ name: "Codex", percent: 93, band: 90 });
    expect(weeklyLimitNotice([row("Claude", 100)])).toMatchObject({ percent: 100, band: 100 });
  });
  it("ignores API keys and closed windows", () => {
    expect(weeklyLimitNotice([row("Claude", 99, "api-key"), row("Codex", null)])).toBeNull();
  });
  it("a new band is a new key, so a dismissal does not hide it", () => {
    expect(weeklyLimitNotice([row("Claude", 85)])!.key).not.toBe(weeklyLimitNotice([row("Claude", 95)])!.key);
  });
});

describe("rowsForEngine (#2902, #0867)", () => {
  const plan = (id: string, driver: string, used: number, instanceIds: string[]): PlanRow => ({ ...row(id, used), driver, instanceId: instanceIds[0] ?? null, instanceIds });
  const rows = [plan("Claude", "claude", 95, ["claude", "claude-opus"]), plan("Codex", "codex", 100, ["codex", "chatgpt"])];
  it("an instance folded on a shared login still gets the shared weekly window", () => {
    expect(weeklyLimitNotice(rowsForEngine(rows, "claude-opus"))).toMatchObject({ name: "Claude", percent: 95 });
    expect(weeklyLimitNotice(rowsForEngine(rows, "chatgpt"))).toMatchObject({ name: "Codex", percent: 100 });
  });
  it("never another provider's row", () => {
    expect(rowsForEngine(rows, "claude").map((r) => r.id)).toEqual(["Claude"]);
    expect(rowsForEngine(rows, "grok")).toEqual([]);
    expect(rowsForEngine(rows, undefined, "claude")).toEqual([]);
  });
  it("a server without instance ids falls back to the driver", () => {
    const old = [plan("Claude", "claude", 90, []), plan("Codex", "codex", 99, [])];
    expect(rowsForEngine(old, "claude-opus", "claude").map((r) => r.id)).toEqual(["Claude"]);
    expect(rowsForEngine(old, "claude-opus")).toEqual([]);
  });
  it("an older server row with only instanceId still matches it", () => {
    expect(rowsForEngine([{ ...plan("Claude", "claude", 90, []), instanceId: "claude" }], "claude").map((r) => r.id)).toEqual(["Claude"]);
  });
});

describe("showsGroupCostNotice", () => {
  it("only for a group with several bots", () => {
    expect(showsGroupCostNotice({ memberIds: ["a", "b"] })).toBe(true);
    expect(showsGroupCostNotice({ memberIds: ["a"] })).toBe(false);
    expect(showsGroupCostNotice({ memberIds: ["a", "b"], dm: true })).toBe(false);
    expect(showsGroupCostNotice({ memberIds: ["a", "b"], peopleDm: true })).toBe(false);
  });
});

describe("json tree helpers", () => {
  it("names", () => { expect(isJsonName("a.JSON")).toBe(true); expect(isJsonName("a.txt")).toBe(false); });
  it("parses with a BOM and rejects bad text", () => {
    expect(parseJsonText("﻿{\"a\":1}")).toEqual({ value: { a: 1 } });
    expect(parseJsonText("{a:")).toBeNull();
    expect(parseJsonText("null")).toEqual({ value: null });
  });
  it("lists children in file order", () => {
    expect(jsonChildren({ b: 1, a: [2] })).toEqual([["b", 1], ["a", [2]]]);
    expect(jsonChildren([5])).toEqual([["0", 5]]);
    expect(jsonChildren("x")).toEqual([]);
  });
  it("expands every container up to the limit", () => {
    const open = expandAllPaths({ a: { b: [1, { c: 2 }] }, d: 3 });
    expect([...open]).toEqual([ROOT_PATH, "$/a", "$/a/b", "$/a/b/1"]);
    expect(expandAllPaths(Array.from({ length: 50 }, () => ({ k: {} })), 5).size).toBe(5);
  });
});
