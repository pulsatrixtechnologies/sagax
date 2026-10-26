import { describe, expect, it } from "vitest";

import { expandAllPaths, isJsonName, jsonChildren, parseJsonText, ROOT_PATH } from "./json-tree";
import type { PlanRow } from "./plan-usage";
import { showsGroupCostNotice, weeklyLimitNotice } from "./usage-notices";

const window = (used: number | null) => ({ available: used !== null, remainingPercent: used === null ? null : 100 - used, usedPercent: used, resetsAt: "2026-10-25T00:00:00Z" });
const row = (id: string, used: number | null, access: PlanRow["access"] = "subscription"): PlanRow => ({
  id, name: id, driver: id, plan: null, state: "windows", access, instanceId: null, message: null,
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
