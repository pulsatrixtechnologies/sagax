import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engineLimitFromUsage, LimitResetClock, nearLimitNote } from "./limit-resets.ts";
import { parseClaudeUsage, parseCodexUsage, type PlanProviderRow, type PlanUsageReport, type PlanWindows } from "./plan-usage.ts";

const NOW = Date.parse("2026-10-19T10:00:00Z");
const HOUR = 3_600_000;
const iso = (at: number) => new Date(at).toISOString();

function row(id: string, driver: "claude" | "codex", windows: PlanWindows): PlanProviderRow {
  return {
    id,
    name: driver === "claude" ? "Claude" : "Codex",
    driver,
    ok: true,
    error: null,
    state: "windows",
    access: "subscription",
    instanceId: id,
    failure: null,
    ...windows,
  };
}
/** As the Claude usage endpoint answers (utilization, resets_at). */
const claude = (fiveHour: [number, number | null], weekly: [number, number | null]) => row("claude", "claude", parseClaudeUsage({
  five_hour: { utilization: fiveHour[0], resets_at: fiveHour[1] === null ? null : iso(fiveHour[1]) },
  seven_day: { utilization: weekly[0], resets_at: weekly[1] === null ? null : iso(weekly[1]) },
}));
/** As the ChatGPT usage endpoint answers for Codex (used_percent, reset_at in epoch seconds, window length). */
const codex = (primary: [number, number], secondary: [number, number]) => row("codex", "codex", parseCodexUsage({
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: primary[0], limit_window_seconds: 5 * 3600, reset_at: Math.floor(primary[1] / 1000) },
    secondary_window: { used_percent: secondary[0], limit_window_seconds: 7 * 86400, reset_at: Math.floor(secondary[1] / 1000) },
  },
}));
const report = (...providers: PlanProviderRow[]): PlanUsageReport => ({ fetchedAt: iso(NOW), providers });

describe("engineLimitFromUsage", () => {
  it("takes Claude's fullest window and its reset when nothing is at the limit", () => {
    expect(engineLimitFromUsage(claude([92, NOW + 2 * HOUR], [40, NOW + 50 * HOUR]))).toEqual({
      engine: "claude", name: "Claude", driver: "claude", window: "5-hour", usedPercent: 92, resetsAt: NOW + 2 * HOUR, blocked: false,
    });
    expect(engineLimitFromUsage(claude([10, NOW + 2 * HOUR], [95, NOW + 50 * HOUR]))).toMatchObject({ window: "weekly", usedPercent: 95, resetsAt: NOW + 50 * HOUR });
  });

  it("waits for the latest reset of every window at its limit, and knows no time when one has none", () => {
    expect(engineLimitFromUsage(claude([100, NOW + 2 * HOUR], [60, NOW + 50 * HOUR]))).toMatchObject({ blocked: true, window: "5-hour", resetsAt: NOW + 2 * HOUR });
    expect(engineLimitFromUsage(claude([100, NOW + 2 * HOUR], [100, NOW + 50 * HOUR]))).toMatchObject({ blocked: true, window: "weekly", resetsAt: NOW + 50 * HOUR });
    expect(engineLimitFromUsage(claude([100, null], [20, NOW + 50 * HOUR]))).toMatchObject({ blocked: true, resetsAt: null });
  });

  it("does not hold Claude at a full window while its paid extra usage has room", () => {
    const withCredit = (fiveHour: number, extra: Record<string, unknown>) => row("claude", "claude", parseClaudeUsage({
      five_hour: { utilization: fiveHour, resets_at: iso(NOW + 2 * HOUR) },
      seven_day: { utilization: 60, resets_at: iso(NOW + 50 * HOUR) },
      extra_usage: extra,
    }));
    const room = { is_enabled: true, used_credits: 1_200, monthly_limit: 5_000, utilization: 24, currency: "USD" };
    expect(engineLimitFromUsage(withCredit(100, room))).toMatchObject({ blocked: false, window: "5-hour", usedPercent: 100, resetsAt: NOW + 2 * HOUR });
    expect(engineLimitFromUsage(withCredit(100, { is_enabled: true, utilization: 40 }))).toMatchObject({ blocked: false });
    // Extra usage that is off or used up still holds, as before.
    expect(engineLimitFromUsage(withCredit(100, { is_enabled: false, utilization: null }))).toMatchObject({ blocked: true, resetsAt: NOW + 2 * HOUR });
    expect(engineLimitFromUsage(withCredit(100, { ...room, used_credits: 5_000, utilization: 100 }))).toMatchObject({ blocked: true });
    expect(engineLimitFromUsage(withCredit(92, room))).toMatchObject({ blocked: false, usedPercent: 92 });
  });

  it("reads Codex's primary and secondary windows by their length", () => {
    expect(engineLimitFromUsage(codex([100, NOW + HOUR], [50, NOW + 90 * HOUR]))).toMatchObject({
      engine: "codex", driver: "codex", blocked: true, window: "5-hour", resetsAt: Math.floor((NOW + HOUR) / 1000) * 1000,
    });
    expect(engineLimitFromUsage(codex([10, NOW + HOUR], [97, NOW + 90 * HOUR]))).toMatchObject({ blocked: false, window: "weekly", usedPercent: 97 });
  });

  it("has nothing to say for a row that could not be read, and no time for a row without windows", () => {
    expect(engineLimitFromUsage({ ...claude([1, NOW], [1, NOW]), ok: false, error: "Sign in again in Claude" })).toBeNull();
    expect(engineLimitFromUsage(row("claude", "claude", parseClaudeUsage({})))).toMatchObject({ usedPercent: null, resetsAt: null, blocked: false });
  });
});

describe("LimitResetClock", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SAGAX_TEST_PLAN_USAGE_FILE;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const accounts = [{ id: "claude", name: "Claude", driver: "claude" as const, environment: {} }];
  const clock = (options: Partial<ConstructorParameters<typeof LimitResetClock>[0]> = {}) => {
    let now = NOW;
    const instance = new LimitResetClock({ accounts: () => accounts, now: () => now, ...options });
    return { instance, at: (next: number) => { now = next; } };
  };

  it("derives the reset from usage, and recomputes when usage moves it", () => {
    const changed = vi.fn();
    const { instance } = clock({ onChange: changed });
    expect(instance.resetAt("claude")).toBeNull();
    instance.noteUsage(report(claude([95, NOW + 2 * HOUR], [10, NOW + 90 * HOUR])));
    expect(instance.resetAt("claude")).toBe(NOW + 2 * HOUR);
    instance.noteUsage(report(claude([96, NOW + 3 * HOUR], [10, NOW + 90 * HOUR])));
    expect(instance.resetAt("claude")).toBe(NOW + 3 * HOUR);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("#0867: an instance folded on the same login gets that login's limit, reset and hold", () => {
    const { instance } = clock();
    const shared = { ...claude([95, NOW + 2 * HOUR], [40, NOW + 90 * HOUR]), instanceIds: ["claude", "claude-opus"] };
    const chatgpt = { ...codex([10, NOW + 3 * HOUR], [100, NOW + 50 * HOUR]), instanceIds: ["codex", "chatgpt"] };
    instance.noteUsage(report(shared, chatgpt));
    expect(instance.limit("claude-opus")).toMatchObject({ engine: "claude-opus", name: "Claude", usedPercent: 95, resetsAt: NOW + 2 * HOUR, blocked: false });
    expect(instance.resetAt("claude-opus")).toBe(NOW + 2 * HOUR);
    expect(instance.limit("chatgpt")).toMatchObject({ engine: "chatgpt", driver: "codex", blocked: true, resetsAt: NOW + 50 * HOUR });
    expect(instance.blockedUntil("chatgpt")).toBe(NOW + 50 * HOUR);
    expect(instance.report().engines.map((limit) => limit.engine).toSorted()).toEqual(["chatgpt", "claude", "claude-opus", "codex"]);
  });

  it("#0867: a turn that works on one folded instance unblocks every instance of that login", () => {
    const changed = vi.fn();
    const { instance } = clock({ onChange: changed });
    const shared = { ...claude([100, NOW + 2 * HOUR], [40, NOW + 90 * HOUR]), instanceIds: ["claude", "claude-opus"] };
    const chatgpt = { ...codex([10, NOW + 3 * HOUR], [100, NOW + 50 * HOUR]), instanceIds: ["codex", "chatgpt"] };
    instance.noteUsage(report(shared, chatgpt));
    expect(instance.blockedUntil("claude-opus")).toBe(NOW + 2 * HOUR);
    instance.noteSuccess("claude");
    expect(instance.blockedUntil("claude")).toBeNull();
    expect(instance.blockedUntil("claude-opus")).toBeNull();
    expect(instance.limit("claude-opus")).toMatchObject({ blocked: false });
    // Another login keeps its hold.
    expect(instance.blockedUntil("chatgpt")).toBe(NOW + 50 * HOUR);
    instance.noteSuccess("chatgpt");
    expect(instance.blockedUntil("codex")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("#0867: a refusal on one folded instance holds every instance of that login, and a success clears them all", () => {
    const { instance } = clock();
    const shared = { ...claude([60, NOW + 2 * HOUR], [40, NOW + 90 * HOUR]), instanceIds: ["claude", "claude-opus"] };
    instance.noteUsage(report(shared, codex([10, NOW + 3 * HOUR], [10, NOW + 50 * HOUR])));
    instance.noteRefusal("claude-opus", NOW + HOUR);
    expect(instance.blockedUntil("claude")).toBe(NOW + HOUR);
    expect(instance.blockedUntil("claude-opus")).toBe(NOW + HOUR);
    expect(instance.blockedUntil("codex")).toBeNull();
    instance.noteSuccess("claude");
    expect(instance.blockedUntil("claude-opus")).toBeNull();
    expect(instance.resetAt("claude-opus")).toBe(NOW + 2 * HOUR);
  });

  it("trusts a refusal's own reset over the fullest window, unless usage shows a later window at its limit", () => {
    const { instance, at } = clock();
    instance.noteUsage(report(claude([80, NOW + 4 * HOUR], [60, NOW + 90 * HOUR])));
    instance.noteRefusal("claude", NOW + HOUR);
    expect(instance.resetAt("claude")).toBe(NOW + HOUR);
    expect(instance.blockedUntil("claude")).toBe(NOW + HOUR);
    instance.noteUsage(report(claude([100, NOW + HOUR], [100, NOW + 90 * HOUR])));
    expect(instance.resetAt("claude")).toBe(NOW + 90 * HOUR);
    at(NOW + 91 * HOUR);
    expect(instance.blockedUntil("claude")).toBeNull();
  });

  it("keeps a passed refusal briefly, then forgets it", () => {
    const { instance, at } = clock();
    instance.noteRefusal("claude", NOW + HOUR);
    at(NOW + HOUR + 60_000);
    expect(instance.blockedUntil("claude")).toBeNull();
    expect(instance.resetAt("claude")).toBe(NOW + HOUR);
    at(NOW + 2 * HOUR);
    expect(instance.resetAt("claude")).toBeNull();
  });

  it("ignores a refusal that names no engine, no time or a time already past", () => {
    const { instance } = clock();
    instance.noteRefusal(undefined, NOW + HOUR);
    instance.noteRefusal("claude", undefined);
    instance.noteRefusal("claude", NOW - 1);
    expect(instance.report().engines).toEqual([]);
  });

  it("reports a refused engine as blocked even before its usage was read", () => {
    const { instance } = clock();
    instance.noteRefusal("claude", NOW + HOUR);
    expect(instance.report().engines).toEqual([expect.objectContaining({ engine: "claude", name: "Claude", blocked: true, usedPercent: 100, resetsAt: NOW + HOUR })]);
  });

  it("clears a refusal when a turn on that engine then succeeds (#1918)", () => {
    const changed = vi.fn();
    const { instance } = clock({ onChange: changed });
    instance.noteRefusal("claude", NOW + 50 * HOUR);
    expect(instance.limit("claude")).toMatchObject({ blocked: true });
    instance.noteSuccess("claude");
    expect(instance.blockedUntil("claude")).toBeNull();
    expect(instance.resetAt("claude")).toBeNull();
    expect(instance.report().engines).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("stops showing a usage reading at its limit once a turn succeeds, until the next reading (#1918)", () => {
    const { instance } = clock();
    instance.noteUsage(report(claude([100, NOW + 2 * HOUR], [40, NOW + 90 * HOUR])));
    expect(instance.blockedUntil("claude")).toBe(NOW + 2 * HOUR);
    instance.noteSuccess("claude");
    expect(instance.blockedUntil("claude")).toBeNull();
    expect(instance.limit("claude")).toMatchObject({ blocked: false });
    instance.noteUsage(report(claude([100, NOW + 2 * HOUR], [40, NOW + 90 * HOUR])));
    expect(instance.limit("claude")).toMatchObject({ blocked: true });
  });

  it("a success on an engine that was not blocked changes nothing", () => {
    const changed = vi.fn();
    const { instance } = clock({ onChange: changed });
    instance.noteUsage(report(claude([40, NOW + 2 * HOUR], [10, NOW + 90 * HOUR])));
    instance.noteSuccess("claude");
    instance.noteSuccess(undefined);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(instance.limit("claude")).toMatchObject({ usedPercent: 40, blocked: false });
  });

  it("names a refused engine no account lists from describe (an organization's key)", () => {
    const instance = new LimitResetClock({ accounts: () => [], now: () => NOW, describe: (engine) => engine === "grok" ? { name: "Grok", driver: "grok" } : undefined });
    instance.noteRefusal("grok", NOW + HOUR);
    expect(instance.limit("grok")).toMatchObject({ name: "Grok", driver: "grok", blocked: true });
  });

  it("reads usage at most once while it is fresh, and through the test fixture file when one is set", async () => {
    const load = vi.fn(async () => report(claude([50, NOW + HOUR], [5, NOW + 90 * HOUR])));
    const { instance, at } = clock({ loadUsage: load });
    await Promise.all([instance.ensureFresh(), instance.ensureFresh()]);
    await instance.ensureFresh();
    expect(load).toHaveBeenCalledTimes(1);
    at(NOW + 10 * 60_000);
    await instance.ensureFresh();
    expect(load).toHaveBeenCalledTimes(2);

    const dir = mkdtempSync(join(tmpdir(), "sagax-limit-fixture-"));
    dirs.push(dir);
    process.env.SAGAX_TEST_PLAN_USAGE_FILE = join(dir, "usage.json");
    writeFileSync(process.env.SAGAX_TEST_PLAN_USAGE_FILE, JSON.stringify(report(claude([91, NOW + 5 * HOUR], [1, NOW + 90 * HOUR]))));
    const fixture = clock().instance;
    await fixture.refresh(true);
    expect(fixture.limit("claude")).toMatchObject({ usedPercent: 91, resetsAt: NOW + 5 * HOUR });
  });
});

// Codex "try again at …" parsing lives in server/usage/limit-reset-time.ts
// (limitResetFromText); covered by server/usage/limit-reset-time.test.ts.

describe("nearLimitNote", () => {
  it("tells the turn when its engine is at 90% or more, with the reset", () => {
    const limit = engineLimitFromUsage(claude([92, Date.UTC(2026, 9, 19, 15, 40)], [10, NOW + 90 * HOUR]))!;
    expect(nearLimitNote(limit, "Claude", "UTC")).toBe(" Claude's usage limit is 92% used; it resets Mon 3:40 PM (UTC).");
    expect(nearLimitNote({ ...limit, usedPercent: 89 }, "Claude", "UTC")).toBe("");
    expect(nearLimitNote(undefined, "Claude", "UTC")).toBe("");
  });
});
