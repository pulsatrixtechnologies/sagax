// Settings > Usage (2026-10-14): the signed-in person's own usage. Since
// #4095: the reference's layout (My plan, Usage limits, the bots' usage with
// its segmented control, bar, legend and chart, then Detail), nothing about
// other people. Every figure is asked of GET /api/me/usage (2026-10-15: open to every member).
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
import { loadCycleDetail, loadPersonalUsage, PersonalUsageUnavailable, planUsageShown, renewalDay, SpendCapRow, UsageBreakdown, UsageDetail, UsagePlan, type PersonalUsage } from "./UsageSection";
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
  // (a production server), which does not know it: the Cost card said "try again later".
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

describe("the page's order (#4095: the reference's groups)", () => {
  it("draws My plan, Usage limits, the bots' usage, then Detail, each a grey title over one card", () => {
    const usage: PersonalUsage = { month: summary(3, 1), previous: summary(1, 1), days30: summary(3, 1), byBot: summary(3, 1), byModel: summary(3, 1) };
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(UsagePlan, { usage, error: null, now: NOW.getTime() }),
      createElement(PlanUsageView, { report: { providers: [] }, loading: false, now: NOW.getTime(), onRefresh: () => {}, myEngines: null, onOpenEngines: () => {}, issuer: "" }),
      createElement(UsageBreakdown, { usage }),
      createElement(UsageDetail, { planHistory: createElement("div", { "data-history": "" }), onOpenTraces: () => {} }),
    ));
    const order = ["usage-plan", "usage-limits", "usage-breakdown", "detail"].map((id) => html.indexOf(`data-settings-group="${id}"`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const title of ["My plan", "Usage limits", "Your bots&#x27; usage", "Detail"]) expect(html).toContain(`>${title}</h3>`);
    // nothing folds the breakdown or the plan any more: they are groups of their own
    expect(html).not.toContain("usage.planDetail");
    expect(html).not.toMatch(/data-settings-card="usage.breakdown" data-open/);
    expect(html.indexOf('data-settings-card="usage.traces"')).toBeGreaterThan(html.indexOf("usage.planHistory"));
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

describe("My plan", () => {
  const usage = (month: number, previous: number): PersonalUsage => ({
    month: summary(month, 4),
    previous: summary(previous, 3),
    days30: summary(month, 4, [{ key: "day:2026-10-13", label: "2026-10-13", turns: 4, costUsd: month }]),
    byBot: summary(month, 4),
    byModel: summary(month, 4),
  });

  it("says when the month renews, as a row of the plan's card, and leaves the cost to the bots' usage", () => {
    const html = renderToStaticMarkup(createElement(UsagePlan, { usage: usage(12, 10), error: null, now: NOW.getTime() }));
    expect(html).toContain('data-settings-row="renewal"');
    expect(html).not.toContain("$12.00");
    expect(html).toContain("Renews Nov");
    expect(html).not.toContain("data-usage-bar");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it("writes the renewal day the Quebec way", () => {
    setLocale("fr");
    expect(renewalDay(NOW)).toMatch(/^1er\u00a0nov/);
    const html = renderToStaticMarkup(createElement(UsagePlan, { usage: usage(12, 10), error: null, now: NOW.getTime() }));
    expect(html).toContain("Mon forfait");
    expect(html).toContain("Se renouvelle le 1er");
  });

  it("with no cost and no plan, says so once with Try again instead of a card per missing figure", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(UsagePlan, { usage: null, error: "unavailable", onRetry: () => {} }));
    expect(html).toContain("data-usage-unavailable");
    expect(html).toContain("Ce serveur ne rapporte pas encore le coût ni le forfait.");
    expect(html).toContain("data-usage-retry");
    expect(html).not.toContain("data-usage-cost");
    // a plan still loading waits instead of saying nothing is there
    expect(renderToStaticMarkup(createElement(UsagePlan, { usage: null, error: "failed", planLoading: true }))).not.toContain("data-usage-unavailable");
    // with an engine's windows, the limits group speaks for the page
    expect(renderToStaticMarkup(createElement(UsagePlan, { usage: null, error: "unavailable", hasPlan: true }))).not.toContain("data-usage-unavailable");
  });

  it("shows the spending limit as its row with the large percent and its bar, the renewal left to My plan", () => {
    const cap = { supported: true, minUsd: 1, cap: { month: "2026-10", monthlyUsd: 50, spentUsd: 12, percent: 24, warn: false, exceeded: false } };
    const html = renderToStaticMarkup(createElement(SpendCapRow, { data: cap, write: () => new Promise<never>(() => {}) }));
    expect(html).toContain('data-usage-bar="cap"');
    expect(html).toContain('data-settings-row="cap-state"');
    expect(html).toContain('aria-valuenow="24"');
    expect(html).toMatch(/data-limit-figure=""[^]*>24%<[^]*>used</);
    expect(html).not.toContain("Renews");
    expect(html).toContain("$12.00 of $50.00 (24%)");
  });
});

describe("Plan card", () => {
  const provider = (patch: Partial<PlanProvider>): PlanProvider => ({
    id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, access: "subscription", instanceId: "claude", failure: null,
    state: "windows", fiveHour: { available: true, remainingPercent: 90, usedPercent: 10, resetsAt: null },
    weekly: { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: "2026-10-16T13:00:00Z" }, extra: [], models: [], ...patch,
  });

  // 2026-10-16 (owner): the 5-hour session and the week both show, each with
  // its gauge, its figures and its grey window line.
  it("shows the 5-hour session and the week, each with a gauge, its figures and its window line", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({})] }, loading: false, now: NOW.getTime(),
      onRefresh: () => {}, myEngines: null, onOpenEngines: () => {}, issuer: "",
    }));
    expect(html.indexOf('data-plan-window-kind="fiveHour"')).toBeLessThan(html.indexOf('data-plan-window-kind="weekly"'));
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain(">10\u00a0%</span>");
    expect(html).toContain(">utilisé</span>");
    expect(html).toContain("90\u00a0% restant");
    expect(html).toContain(">40\u00a0%</span>");
    expect(html).toContain("60\u00a0% restant");
    expect(html).toMatch(/data-limit-footer=""[^>]*tabular-nums|tabular-nums[^>]*data-limit-footer=""/);
    expect(html).toContain("Session de 5 heures");
    expect(html).toContain(">Semaine<");
    expect(html).toContain("Se renouvelle le ");
    expect(html).not.toContain(">Détails<");
    expect(html).toContain(">Limites d&#x27;utilisation</h3>");
  });

  it("adds any other window the provider gives, and the 5-hour session alone when there is no week, in English", () => {
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({
        weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
        extra: [{ label: "Opus week", remainingPercent: 75, usedPercent: 25, resetsAt: null }],
      })] },
      loading: false, now: NOW.getTime(), onRefresh: () => {}, myEngines: null, onOpenEngines: () => {}, issuer: "",
    }));
    expect(html).toContain('data-plan-window-kind="fiveHour"');
    expect(html).not.toContain('data-plan-window-kind="weekly"');
    expect(html).toContain(">10%</span>");
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

describe("Detail", () => {
  it("opens the per-job traces on their own sub-page", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(UsageDetail, { onOpenTraces: () => {} }));
    expect(html).toContain(">Détail<");
    expect(html).toContain('data-settings-card="usage.traces"');
    expect(html).toContain("Traces par job");
    expect(html).toContain("Voir");
  });

  it("has no shortcut to the organization's console", () => {
    setLocale("fr");
    // no shortcut to Perspicax in the Settings (2026-11-05)
    const usage: PersonalUsage = { month: summary(12, 4), previous: summary(10, 3), days30: summary(12, 4), byBot: summary(12, 4), byModel: summary(12, 4) };
    const html = renderToStaticMarkup(createElement("div", null, createElement(UsagePlan, { usage, error: null, now: NOW.getTime() }), createElement(UsageBreakdown, { usage })));
    expect(html).not.toContain('data-settings-row="manage"');
    expect(html).not.toContain("data-usage-org-link");
    expect(html).not.toContain("Ouvrir Sagax Business");
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
    const html = renderToStaticMarkup(createElement(UsageBreakdown, { usage, cycle: "previous", onCycle: () => {}, detail }));
    expect(html).toContain("$12.50");
    expect(html).not.toContain("$9.00");
    expect(html).not.toContain("data-usage-trend");
    expect(html).not.toContain("This month");
    expect(html).toContain('data-usage-list="source"');
    expect(html).toContain("By source");
    // the chart's right arrow comes back to this cycle; the left one is spent
    const button = (name: string) => html.match(new RegExp(`<button[^>]*data-usage-chart-${name}=""[^>]*>`))?.[0] ?? "";
    expect(button("next")).not.toContain('disabled=""');
    expect(button("prev")).toContain('disabled=""');
  });

  it("the current cycle still shows the trend and the daily chart", () => {
    const usage: PersonalUsage = { month: summary(9, 4), previous: summary(3, 2), days30: summary(9, 4), byBot: summary(9, 4), byModel: summary(9, 4) };
    const html = renderToStaticMarkup(createElement(UsageBreakdown, { usage, onCycle: () => {} }));
    expect(html).toContain("$9.00");
    expect(html).toContain("data-usage-trend");
    expect(html).toContain("This month");
    expect(html).toContain("data-usage-chart-card");
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

  const never = () => new Promise<never>(() => {});

  it("draws nothing where the server has no personal limit (organization or older server)", () => {
    expect(renderToStaticMarkup(createElement(SpendCapRow, { data: { supported: false, minUsd: 1, cap: null }, write: never }))).toBe("");
  });

  it("with no limit set, says None and one Edit; editing offers to set one", () => {
    const html = renderToStaticMarkup(createElement(SpendCapRow, { data: { supported: true, minUsd: 1, cap: null }, write: never }));
    expect(html).toContain("Spending limit");
    expect(html).toContain("None");
    expect(html).toContain("data-cap-edit");
    expect(html).not.toContain("data-cap-input");
    const editing = renderToStaticMarkup(createElement(SpendCapRow, { data: { supported: true, minUsd: 1, cap: null }, write: never, defaultEditing: true }));
    expect(editing).toContain("data-cap-input");
    expect(editing).toContain("Set limit");
    expect(editing).not.toContain("Remove limit");
    expect(editing).not.toContain("data-cap-edit");
  });

  it("shows the monthly limit, and a reached limit says new turns are refused until raised", () => {
    const within = renderToStaticMarkup(createElement(SpendCapRow, { data: cap(), write: never }));
    expect(within).toContain("$50.00 per month");
    expect(within).toContain('data-cap-status="within"');
    const editing = renderToStaticMarkup(createElement(SpendCapRow, { data: cap(), write: never, defaultEditing: true }));
    expect(editing).toContain("Change limit");
    expect(editing).toContain("Remove limit");
    const reached = renderToStaticMarkup(createElement(SpendCapRow, { data: cap({ spentUsd: 55, percent: 110, warn: true, exceeded: true }), write: never }));
    expect(reached).toContain('data-cap-status="reached"');
    expect(reached).toContain("next turns are refused until you raise it");
    const near = renderToStaticMarkup(createElement(SpendCapRow, { data: cap({ percent: 85, warn: true }), write: never }));
    expect(near).toContain('data-cap-status="near"');
  });

  it("speaks Quebec French, with tu", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(SpendCapRow, { data: cap({ exceeded: true, warn: true, percent: 120, spentUsd: 60 }), write: never, defaultEditing: true }));
    expect(html).toContain("Limite de dépenses");
    expect(html).toContain("Limite atteinte");
    expect(html).toContain("tu ne la relèves pas");
    expect(html).toContain("Modifier la limite");
    expect(html).not.toMatch(/vous|Vous/);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});

// #4095 (owner, side by side with the reference): the page takes the
// reference's structure. These fail on the page before it: no groups of
// their own, the breakdown and plan folded, an engine's error in red.
describe("the reference's Usage page (#4095)", () => {
  const usage: PersonalUsage = {
    month: summary(30, 9), previous: summary(20, 6), days30: summary(30, 9, [{ key: "day:2026-10-13", label: "2026-10-13", turns: 9, costUsd: 30 }]),
    byBot: summary(30, 9, [{ key: "b1", label: "Scout", turns: 6, costUsd: 20 }, { key: "b2", label: "Atlas", turns: 3, costUsd: 10 }]),
    byModel: summary(30, 9, [{ key: "m1", label: "Model one", turns: 9, costUsd: 30 }]),
  };
  const detail = { total: usage.month, byBot: usage.byBot, byModel: usage.byModel, byEngine: summary(30, 9, [{ key: "e1", label: "Engine one", turns: 9, costUsd: 30 }]) };

  it("heads the bots' usage with the large cost and a segmented control: by source, by bot, by model", () => {
    const html = renderToStaticMarkup(createElement(UsageBreakdown, { usage, detail }));
    expect(html).toMatch(/text-\[22px\][^>]*data-usage-cycle-cost="">\$30\.00</);
    expect(html).toContain('role="group" class=');
    expect(html.match(/aria-pressed=/g)).toHaveLength(3);
    expect(html.indexOf(">By source<")).toBeLessThan(html.indexOf(">By bot<"));
    expect(html.indexOf(">By bot<")).toBeLessThan(html.indexOf(">By model<"));
    // the coloured share bar, then a legend row per group with its share, then the chart
    expect(html).toContain("data-usage-share-bar");
    expect(html).toContain('data-usage-list="source"');
    expect(html).toContain("Engine one");
    expect(html.indexOf("data-usage-share-bar")).toBeLessThan(html.indexOf("data-usage-chart-card"));
  });

  it("each segment lists its own groups with cost, share and turns", () => {
    const bots = renderToStaticMarkup(createElement(UsageBreakdown, { usage, detail, initialSegment: "bot" }));
    expect(bots).toContain('data-usage-list="bot"');
    expect(bots).toContain("Scout");
    expect(bots).toContain("$20.00 · 67%");
    expect(bots).toContain("6 turns");
    const models = renderToStaticMarkup(createElement(UsageBreakdown, { usage, detail, initialSegment: "model" }));
    expect(models).toContain('data-usage-list="model"');
    expect(models).toContain("Model one");
    // an older server without the by-source list offers the two others
    const older = renderToStaticMarkup(createElement(UsageBreakdown, { usage, detail: { ...detail, byEngine: null } }));
    expect(older).not.toContain(">By source<");
    expect(older).toContain('data-usage-list="bot"');
  });

  it("draws each engine window as a large percent with its bar and reset line, the refresh in the group's title row, an engine in error as a quiet line with Try again", () => {
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [
        { id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, state: "windows", fiveHour: { available: true, remainingPercent: 66, usedPercent: 34, resetsAt: "2026-10-14T18:00:00Z" }, weekly: { available: true, remainingPercent: 54, usedPercent: 46, resetsAt: "2026-10-18T18:00:00Z" } },
        { id: "grok", name: "Grok", driver: "grok", plan: null, ok: false, error: null, state: "error", failure: { kind: "timeout", seconds: 8 } },
      ] },
      loading: false, now: NOW.getTime(), onRefresh: () => {}, myEngines: null, onOpenEngines: () => {}, issuer: "",
    }));
    const title = html.indexOf(">Usage limits</h3>");
    const card = html.indexOf("data-settings-surface");
    expect(title).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("data-plan-refresh")).toBeGreaterThan(title);
    expect(html.indexOf("data-plan-refresh")).toBeLessThan(card);
    expect(html.match(/data-limit-figure=""/g)).toHaveLength(2);
    expect(html).toContain(">34%</span>");
    expect(html).toContain(">46%</span>");
    expect(html.match(/data-limit-footer=""/g)).toHaveLength(2);
    const error = html.slice(html.indexOf('data-plan-state="error"'));
    expect(error).toContain("Could not reach Grok");
    expect(error).not.toMatch(/^[^<]*<p[^>]*text-danger/);
    expect(html).toMatch(/data-plan-retry=""[^>]*>Try again</);
  });
});
