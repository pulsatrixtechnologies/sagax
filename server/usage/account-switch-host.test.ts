import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { accountSwitchSettingOf, type AccountSwitchSetting } from "../../shared/account-switch.ts";
import { createAccountMeter } from "./account-meter.ts";
import { createAccountSwitch, type AccountSwitchDeps } from "./account-switch-host.ts";
import { createLearnedRouter, type RoutingOutcome } from "./learned-routing.ts";
import type { UsageForecast } from "./usage-forecast.ts";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.UTC(2026, 10, 19, 15, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const window = (usedPercent: number, resetsAt: number) => ({ available: true, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: new Date(resetsAt).toISOString() });

/** Ada's accounts claude and claude-work, the organization's claude-org, and Nimbus's own claude-nimbus. */
function world(options: { history?: number; owners?: Record<string, string>; demand?: number } = {}) {
  const meter = createAccountMeter({ now: () => NOW });
  const forecast: UsageForecast = {
    record: () => undefined,
    demand: (_payer, hours) => Array.from({ length: hours }, () => options.demand ?? 10),
    history: () => options.history ?? 0,
    scales: new Map(),
    flush: () => undefined,
  };
  const owners = options.owners ?? { claude: "ada", "claude-work": "ada", "claude-nimbus": "nimbus" };
  const held = new Set<string>();
  // each person's own setting per provider (their person settings)
  const settings = new Map<string, AccountSwitchSetting>();
  const deps: AccountSwitchDeps = {
    now: () => NOW,
    meter,
    forecast,
    setting: (person, provider) => accountSwitchSettingOf(settings.get(`${person}/${provider}`)),
    provider: () => "anthropic",
    person: (payer) => payer,
    open: (person, instanceId) => owners[instanceId] === undefined || owners[instanceId] === person,
    label: (_person, instanceId) => instanceId,
    held: (_payer, instanceId) => held.has(instanceId),
  };
  return { meter, settings, held, deps, host: createAccountSwitch(deps) };
}
const POOL = ["claude", "claude-work", "claude-org", "claude-nimbus"];

describe("the account strategy host (#5014)", () => {
  it("never puts a person's turn on another person's account (isolation)", () => {
    const w = world();
    // Nimbus's account is the emptiest by far, and its window resets first
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(85, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(70, NOW + 3 * HOUR) });
    w.meter.notePlan("ada", ["claude-org"], { fiveHour: window(60, NOW + 2 * HOUR) });
    w.meter.notePlan("ada", ["claude-nimbus"], { fiveHour: window(0, NOW + HOUR) });
    const choice = w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: POOL, fresh: false });
    expect(choice?.instanceId).toBe("claude-org");
    expect(w.host.rank("ada", "claudeAgent", POOL)).toEqual(["claude-org", "claude-work", "claude"]);
    // Nimbus's own turn may use it
    expect(w.host.rank("nimbus", "claudeAgent", POOL)).toContain("claude-nimbus");
  });

  it("answers with the simple rule while the forecast has under 7 days of history", () => {
    const w = world({ history: 2 * DAY });
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(20, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(10, NOW + 3 * HOUR) });
    const choice = w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-work"], fresh: false });
    expect(choice).toMatchObject({ instanceId: "claude", by: "rule", fallback: "history", pick: { account: "claude", strategy: "high-water", why: { kind: "keeps", used: 20 } } });
  });

  it("plans with the forecast once it has a week of history", () => {
    // 30 units an hour at one point each: more than claude has before its reset in 4 h
    const w = world({ history: 8 * DAY, demand: 30 });
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(20, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(40, NOW + 50 * 60_000) });
    const host = createAccountSwitch({ ...w.deps, meter: { ...w.meter, scale: () => 1, weekScale: () => null } });
    const choice = host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-work"], fresh: true });
    // the first hour goes where 60 % would be lost in 50 min
    expect(choice).toMatchObject({ instanceId: "claude-work", by: "planner", pick: { why: { kind: "planned", unused: 60 } } });
  });

  it("re-plans a cached keep once the account crosses its threshold, within the 5 minutes", () => {
    // a week of history, one point per unit: the plan keeps the conversation on claude at 70 %
    const w = world({ history: 8 * DAY, demand: 30 });
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(70, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(10, NOW + 4.5 * HOUR) });
    const host = createAccountSwitch({ ...w.deps, meter: { ...w.meter, scale: () => 1, weekScale: () => null } });
    const input = { payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-work"], fresh: false };
    expect(host.choose(input)).toMatchObject({ instanceId: "claude", by: "planner", pick: { why: { kind: "keeps", used: 70 } } });
    // the next turn, a minute later: claude read at 85 %, past High-water's 80 %
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(85, NOW + 4 * HOUR) });
    expect(host.choose(input)).toMatchObject({ instanceId: "claude-work", pick: { why: { kind: "threshold", from: "claude", used: 85, threshold: 80 } } });
  });

  it("follows the person's own strategy for the provider", () => {
    const w = world();
    w.settings.set("ada/anthropic", { strategy: "fill-up", threshold: 80 });
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(95, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(0, NOW + 3 * HOUR) });
    const choice = w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude-work", pool: ["claude", "claude-work"], fresh: true });
    expect(choice).toMatchObject({ instanceId: "claude", pick: { strategy: "fill-up", why: { kind: "fillUp" } } });
    // another person's setting is theirs alone
    expect(w.deps.setting("nimbus", "anthropic").strategy).toBe("high-water");
  });

  it("skips an account a limit holds", () => {
    const w = world();
    w.held.add("claude-work");
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(85, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(0, NOW + HOUR) });
    const choice = w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-work", "claude-org"], fresh: false });
    expect(choice?.instanceId).toBe("claude-org");
  });

  it("leaves a new conversation where it is while no account of the pool has a reading", () => {
    // nothing measured on any account (no report, no limit header): nothing to switch on
    const w = world();
    expect(w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude-work", pool: ["claude", "claude-work"], fresh: true })).toBeNull();
    // one reading is enough for the strategy to rank them
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(10, NOW + HOUR) });
    expect(w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude-work", pool: ["claude", "claude-work"], fresh: true })?.instanceId).toBe("claude");
  });

  it("leaves a single account alone", () => {
    const w = world();
    expect(w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-nimbus"], fresh: true })).toBeNull();
  });
});

describe("learned routing on the account switch", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.SAGAX_LEARNED_ROUTING;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const input = { payer: "ada", threadId: "t-learn", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-work"], fresh: false, model: "fast" };

  function measured(w: ReturnType<typeof world>) {
    w.meter.notePlan("ada", ["claude"], { fiveHour: window(20, NOW + 4 * HOUR) });
    w.meter.notePlan("ada", ["claude-work"], { fiveHour: window(20, NOW + 3 * HOUR) });
  }

  function teach(router: ReturnType<typeof createLearnedRouter>, instanceId: string, model: string, bad: boolean) {
    for (let i = 0; i < 20; i++) {
      const row: RoutingOutcome = {
        instanceId,
        model,
        context: { provider: "anthropic", requestedModel: model, hourUtc: 15, promptTokens: 0, fresh: false },
        ttftMs: bad ? 2_000 : 180,
        tokensPerSec: bad ? 8 : 90,
        error: bad && i % 2 === 0,
        rateLimited: bad && i % 3 === 0,
        quotaBurn: bad ? 8 : 1,
        costTier: 1,
        at: NOW + i,
      };
      router.record(row);
    }
  }

  it("stays on the planner when this person has not turned learning on, even if the server variable is set", () => {
    const w = world();
    measured(w);
    const router = createLearnedRouter({ rng: mulberry32(4) });
    teach(router, "claude", "fast", true);
    teach(router, "claude-work", "fast", false);
    process.env.SAGAX_LEARNED_ROUTING = "1";
    const host = createAccountSwitch({ ...w.deps, learned: router });
    expect(host.choose(input)).toMatchObject({ instanceId: "claude", by: "rule" });
  });

  it("moves this person's account once they turned learning on, and never their model", () => {
    const w = world();
    measured(w);
    const router = createLearnedRouter({ rng: mulberry32(4) });
    teach(router, "claude", "fast", true);
    teach(router, "claude-work", "fast", false);
    // A better model on the current account must not win: learning picks an account only.
    teach(router, "claude", "slow", false);
    const enabled = new Set<string>();
    const host = createAccountSwitch({ ...w.deps, learned: router, learnedRouting: (person) => enabled.has(person ?? "") });
    expect(host.choose(input)).toMatchObject({ instanceId: "claude", by: "rule" });
    enabled.add("ada");
    let moved = 0;
    for (let i = 0; i < 30; i++) {
      const choice = host.choose({ ...input, models: ["slow", "fast"] } as typeof input & { models: string[] });
      expect(choice).not.toHaveProperty("model");
      if (choice?.by === "learned" && choice.instanceId === "claude-work") moved += 1;
    }
    expect(moved).toBeGreaterThan(20);
    enabled.delete("ada");
    expect(host.choose(input)).toMatchObject({ instanceId: "claude", by: "rule" });
  });

  it("does not move onto an unconfirmed paid key", () => {
    const w = world();
    measured(w);
    const router = createLearnedRouter({ rng: mulberry32(4) });
    teach(router, "claude", "fast", true);
    teach(router, "claude-work", "fast", false);
    const host = createAccountSwitch({ ...w.deps, learned: router, learnedRouting: () => true });
    for (let i = 0; i < 20; i++) {
      const choice = host.choose({ ...input, paid: (id) => id === "claude-work" });
      expect(choice?.instanceId).not.toBe("claude-work");
      expect(choice).not.toHaveProperty("model");
    }
  });

  it("stores the counts in the directory the process passed", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-learned-host-"));
    dirs.push(dir);
    const w = world();
    const host = createAccountSwitch({ ...w.deps, learnedDataDir: dir });
    host.record({
      instanceId: "claude",
      model: "fast",
      context: { provider: "anthropic", requestedModel: "fast", hourUtc: 15, promptTokens: 12, fresh: false },
      ttftMs: 100,
      tokensPerSec: 20,
      error: false,
      rateLimited: false,
      quotaBurn: 0,
      costTier: 1,
      at: NOW,
    });
    host.flush();
    const text = readFileSync(join(dir, "usage", "learned-routing.json"), "utf8");
    expect(JSON.parse(text).total).toBe(1);
    expect(text).not.toMatch(/sk-|bearer/);
  });
});
