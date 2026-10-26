// Settings > Usage (2026-10-14): the signed-in person's own usage. Cost then
// Plan on top (2026-10-15), one folded breakdown by bot and model, nothing about other
// people. Every figure is asked of GET /api/me/usage (2026-10-15: open to every member).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { costTrend, dailyCosts, formatCost, parseCapInput, personalUsagePeriods, previousCyclePeriod, rankedGroups, usageQuery, type PersonalUsageSummary } from "@/lib/usage-personal";
import type { PlanProvider } from "@/lib/plan-usage";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, dispatch: () => {} }),
}));

import { ApiError } from "@/state/store";
import { CostCard, loadCycleDetail, loadPersonalUsage, PersonalUsageUnavailable, SpendCapCard, planUsageShown, UsageLayout, type PersonalUsage } from "./UsageSection";
import { PlanUsageView, renewalDate } from "./PlanUsage";

const NOW = new Date("2026-10-14T15:00:00Z");
const summary = (cost: number, turns: number, groups: PersonalUsageSummary["groups"] = []): PersonalUsageSummary => ({
  groups,
  total: { key: "total", label: "Total", turns, costUsd: cost },
});

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("what Settings > Usage asks the server", () => {
  it("asks only for the person's own usage: this month, the same days last month, 30 days, by bot, by model", async () => {
    const get = vi.fn(async (_path: string) => summary(0, 0));
    await loadPersonalUsage(NOW, get as never);
    const paths = get.mock.calls.map(([path]) => path);
    expect(paths).toHaveLength(5);
    for (const path of paths) expect(path).toContain("/api/me/usage?");
    expect(paths).toContain("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=day");
    expect(paths).toContain("/api/me/usage?from=2026-09-01&to=2026-09-14&groupBy=day");
    expect(paths).toContain("/api/me/usage?from=2026-09-15&to=2026-10-14&groupBy=day");
    expect(paths).toContain("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=bot");
    expect(paths).toContain("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=model");
    expect(paths.some((path) => path.includes("groupBy=user"))).toBe(false);
  });

  // 2026-10-15: the desktop 0.5.4 read GET /api/me/usage from a 0.5.3 server
  // (GOX), which does not know it: the Cost card said "try again later".
  it("falls back once to GET /api/usage?mine=1 when the server does not know /api/me/usage (404)", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith("/api/me/usage")) throw new ApiError("not found", 404, { error: "not found" });
      return summary(2, 1);
    });
    const usage = await loadPersonalUsage(NOW, get as never);
    const paths = get.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path.startsWith("/api/me/usage"))).toHaveLength(1);
    const legacy = paths.filter((path) => path.startsWith("/api/usage?mine=1&"));
    expect(legacy).toHaveLength(5);
    expect(legacy).toContain("/api/usage?mine=1&from=2026-10-01&to=2026-10-14&groupBy=day");
    expect(usage.month.total.costUsd).toBe(2);
  });

  it("falls back too when a member's session meets the admin scope an older server asks of an unknown route", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith("/api/me/usage")) throw new ApiError("forbidden", 403, { error: "forbidden: this session lacks the admin scope" });
      return summary(0, 0);
    });
    await loadPersonalUsage(NOW, get as never);
    expect(get.mock.calls.filter(([path]) => path.startsWith("/api/usage?mine=1&"))).toHaveLength(5);
  });

  it("says the server is too old when the fallback is refused too, and keeps other failures as failures", async () => {
    const refused = vi.fn(async (path: string) => {
      throw path.startsWith("/api/me/usage") ? new ApiError("not found", 404, { error: "not found" }) : new ApiError("forbidden", 403, { error: "usage.view" });
    });
    await expect(loadPersonalUsage(NOW, refused as never)).rejects.toBeInstanceOf(PersonalUsageUnavailable);
    expect(refused.mock.calls).toHaveLength(2);
    const broken = vi.fn(async () => { throw new ApiError("boom", 500, { error: "boom" }); });
    await expect(loadPersonalUsage(NOW, broken as never)).rejects.toMatchObject({ status: 500 });
    expect(broken.mock.calls).toHaveLength(1);
  });

  it("compares with the same days of a shorter last month", () => {
    expect(personalUsagePeriods(new Date("2026-03-31T12:00:00Z")).previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(usageQuery({ from: "2026-10-01", to: "2026-10-14" }, "bot")).toBe("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=bot");
  });
});

describe("the page's order", () => {
  it("puts the Cost card on top, above the Plan card", () => {
    const html = renderToStaticMarkup(createElement(UsageLayout, {
      cost: createElement(CostCard, { usage: null, error: null }),
      plan: createElement(PlanUsageView, {
        report: { providers: [{ id: "claude", name: "Claude", driver: "claude", plan: null, ok: true, error: null, state: "no-windows" }] },
        loading: false, now: NOW.getTime(), onRefresh: () => {}, issuer: "",
      }),
      rest: createElement("div", { "data-rest": "" }),
    }));
    const cost = html.indexOf('data-settings-card="usage.cost"');
    const plan = html.indexOf('data-settings-card="usage.plan"');
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(plan).toBeGreaterThan(cost);
    expect(html.indexOf("data-rest")).toBeGreaterThan(plan);
  });
});

describe("the plan card", () => {
  it("shows a member's own plan on an organization server, and the solo server's to its admins", () => {
    expect(planUsageShown({ organization: true, viewUsage: false })).toBe(true);
    expect(planUsageShown({ organization: false, viewUsage: true })).toBe(true);
    // a solo server's plan windows are an admin read
    expect(planUsageShown({ organization: false, viewUsage: false })).toBe(false);
  });
});

describe("cost helpers", () => {
  it("fills every day of the sparkline, oldest first", () => {
    const days = dailyCosts(summary(3, 2, [
      { key: "day:2026-10-12", label: "2026-10-12", turns: 1, costUsd: 1 },
      { key: "day:2026-10-14", label: "2026-10-14", turns: 1, costUsd: 2 },
    ]), { from: "2026-10-12", to: "2026-10-14" });
    expect(days).toEqual([1, 0, 2]);
  });

  it("says the trend against last month, or nothing when last month was empty", () => {
    expect(costTrend(12, 10)).toBe(20);
    expect(costTrend(5, 10)).toBe(-50);
    expect(costTrend(5, 0)).toBeNull();
  });

  it("ranks by cost, then turns", () => {
    const ranked = rankedGroups(summary(0, 0, [
      { key: "a", label: "A", turns: 9, costUsd: 1 },
      { key: "b", label: "B", turns: 1, costUsd: 5 },
      { key: "c", label: "C", turns: 3, costUsd: null },
    ]));
    expect(ranked.map((group) => group.key)).toEqual(["b", "a", "c"]);
  });

  it("writes money the Quebec way in French", () => {
    setLocale("fr");
    expect(formatCost(12.5).replace(/\s/g, " ")).toMatch(/^12,50 \$( US)?$/);
  });
});

describe("Cost card", () => {
  const usage = (month: number, previous: number): PersonalUsage => ({
    month: summary(month, 4),
    previous: summary(previous, 3),
    days30: summary(month, 4, [{ key: "day:2026-10-13", label: "2026-10-13", turns: 4, costUsd: month }]),
    byBot: summary(month, 4),
    byModel: summary(month, 4),
  });

  it("shows this month's cost, the trend and a 30-day sparkline", () => {
    const html = renderToStaticMarkup(createElement(CostCard, { usage: usage(12, 10), error: null }));
    expect(html).toContain("data-usage-cost");
    expect(html).toContain("$12.00");
    expect(html).toContain("20% more than last month");
    expect(html).toContain("data-usage-sparkline");
    expect(html).not.toMatch(/[–—]/);
  });

  it("says honestly that an older server has no per-person cost, instead of try again later", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage: null, error: "unavailable" }));
    expect(html).toContain("data-usage-unavailable");
    expect(html).toContain("Ce serveur ne fournit pas encore le coût par personne.");
    expect(html).not.toContain("Réessayez plus tard");
    expect(renderToStaticMarkup(createElement(CostCard, { usage: null, error: "failed" }))).toContain("Réessayez plus tard");
  });

  it("says so plainly when nothing was spent, in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage: { ...usage(0, 0), month: summary(0, 0), days30: summary(0, 0) }, error: null }));
    expect(html).toContain("data-usage-empty");
    expect(html).toContain("Rien de dépensé pour l&#x27;instant.");
  });
});

describe("Plan card", () => {
  const provider = (patch: Partial<PlanProvider>): PlanProvider => ({
    id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, access: "subscription", instanceId: "claude", failure: null,
    state: "windows", fiveHour: { available: true, remainingPercent: 90, usedPercent: 10, resetsAt: null },
    weekly: { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: "2026-10-16T13:00:00Z" }, extra: [], models: [], ...patch,
  });

  // 2026-10-16 (JC): the 5-hour session and the week both show, each with
  // its gauge, its figures and its grey window line.
  it("shows the 5-hour session and the week, each with a gauge, its figures and its window line", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({})] }, loading: false, now: NOW.getTime(),
      onRefresh: () => {}, issuer: "",
    }));
    expect(html.indexOf('data-plan-window-kind="fiveHour"')).toBeLessThan(html.indexOf('data-plan-window-kind="weekly"'));
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("10\u00a0% utilisé");
    expect(html).toContain("90\u00a0% restant");
    expect(html).toContain("40\u00a0% utilisé");
    expect(html).toContain("60\u00a0% restant");
    expect(html).toMatch(/data-plan-figures[^>]*tabular-nums|tabular-nums[^>]*data-plan-figures/);
    expect(html).toContain("Session de 5 heures");
    expect(html).toContain("Semaine · se renouvelle ");
    expect(html).not.toContain(">Détails<");
    expect(html).toContain(">Forfait<");
  });

  it("adds any other window the provider gives, and the 5-hour session alone when there is no week, in English", () => {
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({
        weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
        extra: [{ label: "Opus week", remainingPercent: 75, usedPercent: 25, resetsAt: null }],
      })] },
      loading: false, now: NOW.getTime(), onRefresh: () => {}, issuer: "",
    }));
    expect(html).toContain('data-plan-window-kind="fiveHour"');
    expect(html).not.toContain('data-plan-window-kind="weekly"');
    expect(html).toContain("10% used");
    expect(html).toContain("90% left");
    expect(html).toContain("5-hour session");
    expect(html).toContain('data-plan-window-kind="extra"');
    expect(html).toContain("Opus week");
  });

  it("never breaks a renewal between the day and its month, or inside 19 h 59", () => {
    const fr = renewalDate("2026-10-21T23:59:00Z", "fr-CA", "America/New_York");
    expect(fr).toBe("mer.\u00a021\u00a0oct., 19\u00a0h\u00a059");
    const en = renewalDate("2026-10-21T23:59:00Z", "en", "America/New_York");
    expect(en).toMatch(/^Wed, Oct\u00a021, 7:59[\u00a0\u202f]PM$/);
    expect(renewalDate(null)).toBeNull();
  });
});

// 0.5.6: Grok Bot's Usage & Billing layout, grey headings outside rounded
// cards, compact rows, the breakdown folded under a count pill.
describe("Usage laid out as Grok Bot's", () => {
  const usage: PersonalUsage = {
    month: summary(12, 4), previous: summary(10, 3), days30: summary(12, 4),
    byBot: summary(12, 4, [{ key: "b1", label: "Hibou", turns: 3, costUsd: 9 }, { key: "b2", label: "Dispatch", turns: 1, costUsd: 3 }]),
    byModel: summary(12, 4),
  };

  it("draws Cost as a group of rows: this month, the last 30 days, the breakdown folded with its count", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage, error: null }));
    expect(html).toContain('data-settings-group="cost"');
    expect(html).toContain(">Coût<");
    expect(html.indexOf('data-settings-row="month"')).toBeLessThan(html.indexOf('data-settings-row="days30"'));
    expect(html).toMatch(/data-settings-card="usage.breakdown" data-open="false"/);
    expect(html).toMatch(/data-count-pill=""[^>]*>2</);
    // still in the page while folded
    expect(html).toContain("Hibou");
    expect(html).not.toContain("data-usage-org-link");
  });

  it("gives an organization admin a row to the organization's usage", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage, error: null, consoleUrl: "https://px.example.test/console" }));
    expect(html).toContain('data-settings-row="organization"');
    expect(html).toContain("Ouvrir Sagax Business");
    expect(html).toContain('href="https://px.example.test/console"');
  });

  it("draws Plan under a grey heading with the refresh by it and the keys link as a row", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [{ id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, state: "no-windows" }] },
      loading: false, now: NOW.getTime(), onRefresh: () => {}, issuer: "https://px.example.test",
    }));
    expect(html).toContain('data-settings-group="plan"');
    expect(html.indexOf("data-plan-refresh")).toBeLessThan(html.indexOf('data-plan-row="claude"'));
    expect(html).toContain('data-settings-row="keys"');
    expect(html).toContain("Gérer mes clés dans Perspicax");
  });
});


describe("Cycle précédent and the by-source view", () => {
  it("names last month in full, first to last day", () => {
    expect(previousCyclePeriod(NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousCyclePeriod(new Date("2026-01-05T00:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(previousCyclePeriod(new Date("2026-03-31T00:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("asks for last month by day, bot, model and source, only the person's own", async () => {
    const get = vi.fn(async (_path: string) => summary(4, 2));
    const usage: PersonalUsage = { month: summary(1, 1), previous: summary(1, 1), days30: summary(1, 1), byBot: summary(1, 1), byModel: summary(1, 1) };
    const detail = await loadCycleDetail("previous", usage, NOW, get as never);
    const paths = get.mock.calls.map(([path]) => path);
    expect(paths.sort()).toEqual(["day", "bot", "model", "engine"].map((by) => `/api/me/usage?from=2026-09-01&to=2026-09-30&groupBy=${by}`).sort());
    expect(detail.total.total.costUsd).toBe(4);
    expect(detail.byEngine).not.toBeNull();
  });

  it("keeps the current cycle's own lists and asks only for the by-source one; an older server just loses that list", async () => {
    const usage: PersonalUsage = { month: summary(1, 1), previous: summary(1, 1), days30: summary(1, 1), byBot: summary(7, 1), byModel: summary(1, 1) };
    const get = vi.fn(async (_path: string) => { throw new ApiError("bad", 400, { error: "groupBy must be one of bot" }); });
    const detail = await loadCycleDetail("current", usage, NOW, get as never);
    expect(get.mock.calls.map(([path]) => path)).toEqual(["/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=engine"]);
    expect(detail.byBot.total.costUsd).toBe(7);
    expect(detail.byEngine).toBeNull();
  });

  it("shows last month's cost, its month name, no trend, and a by-source list", () => {
    const usage: PersonalUsage = { month: summary(9, 4), previous: summary(3, 2), days30: summary(9, 4), byBot: summary(9, 4), byModel: summary(9, 4) };
    const detail = {
      total: summary(12.5, 6),
      byBot: summary(12.5, 6, [{ key: "bot:a", label: "Ada", turns: 6, costUsd: 12.5 }]),
      byModel: summary(12.5, 6),
      byEngine: summary(12.5, 6, [{ key: "engine:claudeAgent", label: "claudeAgent", turns: 6, costUsd: 12.5 }]),
    };
    const html = renderToStaticMarkup(createElement(CostCard, { usage, error: null, cycle: "previous", onCycle: () => {}, detail }));
    expect(html).toContain("$12.50");
    expect(html).not.toContain("$9.00");
    expect(html).not.toContain("data-usage-trend");
    expect(html).not.toContain("data-usage-sparkline");
    expect(html).toContain("Previous cycle");
    expect(html).toContain('data-usage-list="source"');
    expect(html).toContain("By source");
  });

  it("the current cycle still shows the trend and the sparkline", () => {
    const usage: PersonalUsage = { month: summary(9, 4), previous: summary(3, 2), days30: summary(9, 4), byBot: summary(9, 4), byModel: summary(9, 4) };
    const html = renderToStaticMarkup(createElement(CostCard, { usage, error: null, onCycle: () => {} }));
    expect(html).toContain("$9.00");
    expect(html).toContain("data-usage-trend");
    expect(html).toContain("This cycle");
  });
});

describe("Limite de dépenses", () => {
  const cap = (over: Partial<NonNullable<import("@/lib/usage-personal").PersonalSpendCap["cap"]>> = {}) => ({
    supported: true, minUsd: 1,
    cap: { month: "2026-10", monthlyUsd: 50, spentUsd: 12, percent: 24, warn: false, exceeded: false, ...over },
  });

  it("reads a typed amount: dollars, comma or point, at least the minimum", () => {
    expect(parseCapInput("25")).toBe(25);
    expect(parseCapInput(" $25,50 ")).toBe(25.5);
    expect(parseCapInput("25.5")).toBe(25.5);
    for (const bad of ["", "0", "0.5", "abc", "-4", "1.234", "1e3"]) expect(parseCapInput(bad), bad).toBeNull();
  });

  it("draws nothing where the server has no personal limit (organization or older server)", () => {
    expect(renderToStaticMarkup(createElement(SpendCapCard, { initial: { supported: false, minUsd: 1, cap: null }, read: () => new Promise<never>(() => {}) }))).toBe("");
    expect(renderToStaticMarkup(createElement(SpendCapCard, { read: () => new Promise<never>(() => {}) }))).toBe("");
  });

  it("with no limit set, offers to set one", () => {
    const html = renderToStaticMarkup(createElement(SpendCapCard, { initial: { supported: true, minUsd: 1, cap: null }, read: () => new Promise<never>(() => {}) }));
    expect(html).toContain("Spending limit");
    expect(html).toContain("No limit is set");
    expect(html).toContain("Set limit");
    expect(html).not.toContain("Remove limit");
  });

  it("shows where the month stands, and a reached limit says new turns are refused until raised", () => {
    const within = renderToStaticMarkup(createElement(SpendCapCard, { initial: cap(), read: () => new Promise<never>(() => {}) }));
    expect(within).toContain("$12.00 of $50.00 (24%)");
    expect(within).toContain('data-cap-status="within"');
    expect(within).toContain("Change limit");
    expect(within).toContain("Remove limit");
    const reached = renderToStaticMarkup(createElement(SpendCapCard, { initial: cap({ spentUsd: 55, percent: 110, warn: true, exceeded: true }), read: () => new Promise<never>(() => {}) }));
    expect(reached).toContain('data-cap-status="reached"');
    expect(reached).toContain("next turns are refused until you raise it");
    const near = renderToStaticMarkup(createElement(SpendCapCard, { initial: cap({ percent: 85, warn: true }), read: () => new Promise<never>(() => {}) }));
    expect(near).toContain('data-cap-status="near"');
  });

  it("speaks Quebec French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(SpendCapCard, { initial: cap({ exceeded: true, warn: true, percent: 120, spentUsd: 60 }), read: () => new Promise<never>(() => {}) }));
    expect(html).toContain("Limite de dépenses");
    expect(html).toContain("Limite atteinte");
    expect(html).toContain("Modifier la limite");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
