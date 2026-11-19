import { describe, expect, it } from "vitest";

import { accountSwitchSettingOf, type AccountSwitchSetting } from "../../shared/account-switch.ts";
import { createAccountMeter } from "./account-meter.ts";
import { createAccountSwitch, type AccountSwitchDeps } from "./account-switch-host.ts";
import type { UsageForecast } from "./usage-forecast.ts";

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

  it("leaves a single account alone", () => {
    const w = world();
    expect(w.host.choose({ payer: "ada", threadId: "t1", driverKind: "claudeAgent", current: "claude", pool: ["claude", "claude-nimbus"], fresh: true })).toBeNull();
  });
});
