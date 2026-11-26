// The usage pill's rules (owner 2026-11-26, M-20261126-096, M-20261126-099,
// #5406): a sum of every account that can serve the bot, a named percentage,
// "back" only when everything is blocked, and the detail's rows.
import { beforeEach, describe, expect, it } from "vitest";

import type { EngineLimit } from "../../shared/limit-reset";
import { setLocale } from "./i18n";
import type { PlanRow, PlanWindow } from "./plan-usage";
import { allAccounts, backText, planWeight, servingAccounts, usageCumul, usageDetailLayout, usagePill, type UsageAccount } from "./usage-pill";

const NOW = Date.parse("2026-11-26T19:35:00Z");
const SAT = "2026-11-29T02:00:00Z"; // Saturday 21:00 in Toronto
const window = (used: number | null, resetsAt: string | null = SAT): PlanWindow => ({ available: used !== null, usedPercent: used, remainingPercent: used === null ? null : 100 - used, resetsAt: used === null ? null : resetsAt });
const row = (id: string, fiveHour: number | null, weekly: number | null, over: Partial<PlanRow> = {}): PlanRow => ({
  id, name: `${id}@acme.test`, driver: "claude", plan: null, state: "windows", access: "subscription", instanceId: id, instanceIds: [id],
  message: null, fiveHour: window(fiveHour, "2026-11-26T22:00:00Z"), weekly: window(weekly), extra: [], models: [], ...over,
});
const limit = (engine: string, over: Partial<EngineLimit> = {}): EngineLimit => ({ engine, name: engine, driver: "claude", window: "weekly", usedPercent: 40, resetsAt: null, blocked: false, ...over });
const pill = (accounts: readonly UsageAccount[], context: number | null = null) => usagePill({ accounts, context, now: NOW, locale: "en-CA", timeZone: "America/Toronto" });
const ids = (accounts: readonly UsageAccount[]) => accounts.map((account) => account.id);

beforeEach(() => setLocale("en"));

describe("the sum of every account that can serve the bot (M-20261126-096)", () => {
  it("one account: its own figures, the fuller limit named", () => {
    const values = pill(servingAccounts({ rows: [row("a", 20, 44)], engine: "a", now: NOW }));
    expect(values).toMatchObject({ week: 44, fiveHour: 20, named: { window: "weekly", percent: 44 }, blocked: false, free: 1, total: 1, tone: "quiet" });
    expect(values.text).toBe("wk 44%");
  });

  it("names the short session when it is the fuller one", () => {
    expect(pill(servingAccounts({ rows: [row("a", 81, 12)], engine: "a", now: NOW })).text).toBe("5h 81%");
  });

  it("never says 100% while the serving account is full and another can take over", () => {
    const accounts = servingAccounts({ rows: [row("a", 12, 100), row("b", 0, 18)], serves: ["a", "b"], engine: "a", now: NOW });
    const values = pill(accounts);
    expect(values).toMatchObject({ week: 59, fiveHour: 6, blocked: false, free: 1, total: 2 });
    expect(values.text).toBe("wk 59%");
    expect(values.back).toBe("");
  });

  it("three accounts, all full for the week: 100%, blocked, and the first return", () => {
    const rows = [row("a", 12, 100), row("b", 23, 100, { weekly: window(100, "2026-11-29T06:00:00Z") }), row("c", 1, 100, { weekly: window(100, "2026-12-01T19:29:00Z") })];
    const values = pill(servingAccounts({ rows, serves: ["a", "b", "c"], engine: "a", now: NOW }));
    expect(values).toMatchObject({ week: 100, fiveHour: 12, blocked: true, free: 0, total: 3, tone: "danger", backAt: Date.parse(SAT) });
    expect(values.text).toBe("wk 100% · back Sat 9 p.m.");
  });

  it("ten accounts, three of them full: the mean stays under the half, nothing blocked, no return said", () => {
    const rows = [
      ...["a", "b", "c"].map((id) => row(id, 60, 100)),
      ...["d", "e", "f", "g", "h", "i", "j"].map((id) => row(id, 0, 20)),
    ];
    const accounts = servingAccounts({ rows, serves: rows.map((entry) => entry.id), engine: "d", now: NOW });
    const values = pill(accounts, 60);
    expect(values).toMatchObject({ week: 44, fiveHour: 18, context: 60, blocked: false, free: 7, total: 10, tone: "quiet", backAt: null });
    expect(values.text).toBe("wk 44%");
  });

  it("an account with no 5-hour limit counts as 0% of that window, and a pool with none has no session figure", () => {
    const mixed = servingAccounts({ rows: [row("a", 80, 10), row("codex", null, 55, { driver: "codex" })], serves: ["a", "codex"], engine: "a", now: NOW });
    expect(usageCumul(mixed)).toMatchObject({ fiveHour: 40, weekly: 32.5 });
    expect(pill(mixed).text).toBe("5h 40%");
    const none = servingAccounts({ rows: [row("codex", null, 55, { driver: "codex" })], engine: "codex", now: NOW });
    expect(pill(none)).toMatchObject({ fiveHour: null, week: 55, named: { window: "weekly", percent: 55 } });
  });

  it("an account full on its 5-hour window is blocked, and all blocked on different windows is still blocked", () => {
    const accounts = servingAccounts({ rows: [row("a", 100, 10), row("b", 5, 100)], serves: ["a", "b"], engine: "a", now: NOW });
    const values = pill(accounts);
    expect(values).toMatchObject({ blocked: true, week: 55, fiveHour: 53, backAt: Date.parse("2026-11-26T22:00:00Z") });
    expect(values.text).toBe("wk 55% · back Thu 5 p.m.");
  });

  it("weights by plan when every account's plan size is known on one scale, else takes the mean", () => {
    const known = [row("big", 0, 100, { plan: "Max 20x" }), row("small", 0, 0, { plan: "Pro" })];
    expect(usageCumul(allAccounts(known, [], NOW))).toMatchObject({ weekly: (20 * 100) / 21, weighted: true });
    const unknown = [row("big", 0, 100, { plan: "Max 20x" }), row("small", 0, 0, { plan: "Team" })];
    expect(usageCumul(allAccounts(unknown, [], NOW))).toMatchObject({ weekly: 50, weighted: false });
    const twoProviders = [row("big", 0, 100, { plan: "Max 20x" }), row("other", 0, 0, { plan: "Pro", driver: "codex" })];
    expect(usageCumul(allAccounts(twoProviders, [], NOW))).toMatchObject({ weekly: 50, weighted: false });
    expect(planWeight("claude", "Max 5x")).toBe(5);
    expect(planWeight("codex", "Pro")).toBeNull();
    expect(planWeight("claude", null)).toBeNull();
  });

  it("a rounding never says 100% before every account is full", () => {
    const rows = [row("a", 0, 100, { plan: "Max 20x" }), row("b", 0, 100, { plan: "Max 20x" }), row("c", 0, 80, { plan: "Pro" })];
    expect(pill(allAccounts(rows, [], NOW))).toMatchObject({ week: 99, blocked: false });
  });

  it("turns warning from 75% and has no figure with no account", () => {
    expect(pill(allAccounts([row("a", 10, 75)], [], NOW)).tone).toBe("warning");
    expect(pill(allAccounts([row("a", 10, 74)], [], NOW)).tone).toBe("quiet");
    expect(pill([])).toMatchObject({ week: null, fiveHour: null, named: null, blocked: false, text: "", total: 0 });
  });

  it("says the figure and the return in the reader's language", () => {
    setLocale("fr");
    const blocked = usagePill({ accounts: allAccounts([row("a", 12, 100)], [], NOW), now: NOW, locale: "fr-CA", timeZone: "America/Toronto" });
    expect(blocked.text).toBe("sem. 100 % · retour sam. 21 h");
    expect(usagePill({ accounts: allAccounts([row("a", 20, 4)], [], NOW), now: NOW }).text).toBe("5 h 20 %");
    expect(backText(Date.parse("2026-12-01T19:29:00Z"), "fr-CA", "America/Toronto")).toBe("mar. 14 h 29");
  });
});

describe("which accounts can serve (no second verdict)", () => {
  const rows = [row("a", 10, 20), row("b", 30, 40), row("codex", null, 55, { driver: "codex" }), row("grok", 5, 5, { driver: "grok" })];

  it("takes the engines the server's takeover names, the serving one marked", () => {
    const accounts = servingAccounts({ rows, serves: ["a", "codex"], engine: "a", now: NOW });
    expect(ids(accounts)).toEqual(["a", "codex"]);
    expect(accounts.map((account) => account.serving)).toEqual([true, false]);
    expect(accounts[0]!.name).toBe("Claude · a@acme.test");
  });

  it("always holds the serving engine, and an engine with no plan window as an account without a figure", () => {
    const accounts = servingAccounts({ rows, serves: ["b", "local"], engine: "a", engineName: (engine) => `Engine ${engine}`, now: NOW });
    expect(ids(accounts)).toEqual(["a", "b", "engine:local"]);
    expect(accounts[2]).toMatchObject({ name: "Engine local", fiveHour: null, weekly: null, blocked: false });
    // it can serve: nothing is blocked while it is free, and it is in no sum
    const full = servingAccounts({ rows: [row("a", 0, 100)], serves: ["a", "local"], engine: "a", now: NOW });
    expect(pill(full)).toMatchObject({ week: 99, blocked: false, free: 1, total: 2 });
  });

  it("an older server names no pool: the accounts of the serving engine's provider", () => {
    expect(ids(servingAccounts({ rows, engine: "a", now: NOW }))).toEqual(["a", "b"]);
    expect(ids(servingAccounts({ rows, engine: "codex", serves: [], now: NOW }))).toEqual(["codex"]);
  });

  it("a row folded on a shared login answers for each of its instances", () => {
    const folded = [row("a", 10, 20, { instanceIds: ["a", "a-2"] })];
    const accounts = servingAccounts({ rows: folded, serves: ["a", "a-2"], engine: "a-2", now: NOW });
    expect(ids(accounts)).toEqual(["a"]);
    expect(accounts[0]!.serving).toBe(true);
  });

  it("an engine the limit report holds is blocked until its reset, whatever its windows say", () => {
    const held = [limit("b", { blocked: true, resetsAt: Date.parse(SAT) })];
    const accounts = servingAccounts({ rows, serves: ["a", "b"], engine: "a", limits: held, now: NOW });
    expect(accounts[1]).toMatchObject({ id: "b", blocked: true, backAt: Date.parse(SAT) });
    expect(pill(accounts)).toMatchObject({ blocked: false, free: 1 });
  });

  it("with no plan window for the serving engine, its own limit answers once it is near, never under the threshold", () => {
    const near = servingAccounts({ rows: [], engine: "key", limits: [limit("key", { usedPercent: 93 })], now: NOW });
    expect(near).toMatchObject([{ id: "engine:key", weekly: 93, serving: true, blocked: false }]);
    expect(servingAccounts({ rows: [], engine: "key", limits: [limit("key", { usedPercent: 40 })], now: NOW })).toEqual([]);
    const refusing = servingAccounts({ rows: [], engine: "key", limits: [limit("key", { usedPercent: null, window: null, blocked: true, held: true })], now: NOW });
    expect(refusing).toMatchObject([{ weekly: null, fiveHour: null, blocked: true }]);
    expect(pill(refusing)).toMatchObject({ named: null, blocked: true, text: "" });
  });

  it("an API key row and a signed-out row are no account", () => {
    const noWindows = [row("key", null, null, { state: "no-windows", access: "api-key" }), row("out", null, null, { state: "signed-out" })];
    expect(allAccounts(noWindows, [], NOW)).toEqual([]);
  });
});

describe("the detail's rows (M-20261126-095)", () => {
  const account = (id: string, weekly: number, over: Partial<UsageAccount> = {}): UsageAccount => ({
    id, name: id, plan: null, fiveHour: 0, weekly, hours: 5, serving: false, blocked: weekly >= 100, backAt: null, weight: null, driver: "claude", ...over,
  });

  it("puts the serving account first, then the accounts with the most room, three in sight", () => {
    const layout = usageDetailLayout([account("a", 60), account("b", 10), account("c", 41, { serving: true }), account("d", 30), account("e", 5)]);
    expect(ids(layout.free)).toEqual(["c", "e", "b"]);
    expect(ids(layout.moreFree)).toEqual(["d", "a"]);
    expect(layout.limited).toEqual([]);
  });

  it("folds the accounts at their limit below, the first back first", () => {
    const layout = usageDetailLayout([account("x", 100, { backAt: 30 }), account("a", 20), account("y", 100, { backAt: 10 }), account("z", 100)]);
    expect(ids(layout.free)).toEqual(["a"]);
    expect(ids(layout.limited)).toEqual(["y", "x", "z"]);
  });
});
