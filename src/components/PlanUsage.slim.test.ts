// @vitest-environment happy-dom
// Settings > Usage > Usage limits, #4445: one slim row per account (its name
// and plan, then the short window and the week side by side, each a label, a
// percent, a thin bar and its renewal), the favourite first then the account
// closest to a limit, a window the vendor does not report simply absent with
// the week keeping its column, a failed read on one row, and the spending
// limit as one row of the same block. The "My plan" card with only a renewal
// date is gone from the page.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { PlanProvider, PlanWindow } from "@/lib/plan-usage";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, dispatch: () => {} }),
}));

import { PlanUsageView, type PlanUsageViewProps } from "./PlanUsage";
import { SpendCapRow, UsagePlan, type PersonalUsage } from "./UsageSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLOSED: PlanWindow = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, resetsAt: string | null = "2026-11-20T15:00:00Z", hours?: number): PlanWindow => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt, ...(hours ? { hours } : {}) });
const account = (id: string, fiveHour: PlanWindow, weekly: PlanWindow, patch: Partial<PlanProvider> = {}): PlanProvider => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), driver: "claude", plan: "Pro", ok: true, error: null, state: "windows",
  access: "subscription", instanceId: id, failure: null, fiveHour, weekly, extra: [], models: [], ...patch,
});

let host: HTMLDivElement;
let root: Root;
function mount(element: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(element); });
  return host;
}
function view(providers: PlanProvider[], patch: Partial<PlanUsageViewProps> = {}): HTMLElement {
  return mount(createElement(PlanUsageView, { report: { providers }, loading: false, now: Date.parse("2026-11-16T15:00:00Z"), onRefresh: () => {}, ...patch }));
}

beforeEach(() => { setLocale("en"); });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("Usage limits: one slim row per account (#4445)", () => {
  it("the favourite first, then the account closest to a limit, an account with no figure last", () => {
    const page = view([
      account("calm", open(10), open(20)),
      account("broken", CLOSED, CLOSED, { state: "error", ok: false, failure: { kind: "http", status: 429 } }),
      account("hot", open(30), open(95)),
      account("starred", open(5), open(4)),
      account("warm", open(72), CLOSED),
    ], { favorite: { id: "starred", onToggle: () => {} } });
    const order = [...page.querySelectorAll("[data-plan-row]")].map((row) => row.getAttribute("data-plan-row"));
    expect(order).toEqual(["starred", "hot", "warm", "calm", "broken"]);
  });

  it("a row holds the name and plan, then both windows on one line, each a label, a percent, a thin bar and its renewal; no large figure", () => {
    const page = view([account("personal", open(34, "2026-11-16T17:00:00Z", 5), open(46))]);
    const row = page.querySelector('[data-plan-row="personal"]')!;
    expect(row.querySelector("[data-plan-name]")?.textContent).toBe("Claude · Personal");
    const meters = row.querySelectorAll("[data-plan-meters] > [data-plan-col]");
    expect(meters).toHaveLength(2);
    const [short, week] = [...meters];
    expect(short!.textContent).toContain("5-hour session");
    expect(short!.textContent).toContain("34% used");
    expect(short!.querySelector('[role="meter"]')?.className).toContain("h-1");
    expect(short!.textContent).toContain("Renews ");
    expect(week!.textContent).toContain("Week");
    expect(week!.textContent).toContain("46% used");
    // #4441's large 22 px percent made each account about 240 px tall
    expect(row.innerHTML).not.toContain("text-[22px]");
  });

  it("a window the vendor does not report is absent, the week keeps its column, no zero", () => {
    const page = view([account("both", open(10), open(20)), account("weekonly", CLOSED, open(57))]);
    const row = page.querySelector('[data-plan-row="weekonly"]')!;
    expect(row.querySelector('[data-plan-window-kind="fiveHour"]')).toBeNull();
    expect(row.textContent).not.toContain("session");
    expect(row.textContent).not.toContain("0% used");
    const week = row.querySelector('[data-plan-window-kind="weekly"]')!.closest("[data-plan-col]")!;
    expect(week.getAttribute("data-plan-col")).toBe("2");
    expect(week.className).toContain("col-start-2");
    const other = page.querySelector('[data-plan-row="both"] [data-plan-window-kind="weekly"]')!.closest("[data-plan-col]")!;
    expect(other.className).toContain("col-start-2");
  });

  it("a failed read stays on one row: its name, the reason (whole on hover) and Try again", () => {
    const retry = vi.fn();
    const page = view([account("backup", CLOSED, CLOSED, { state: "error", ok: false, failure: { kind: "http", status: 429 } })], { onRefresh: retry });
    const row = page.querySelector('[data-plan-row="backup"]')!;
    const failed = row.querySelector('[data-plan-state="error"]')!;
    // one line: the name and the reason share the row's single line
    expect(row.hasAttribute("data-plan-line")).toBe(true);
    expect(failed.closest("[data-plan-line]")).toBe(row);
    expect(row.querySelector("[data-plan-name]")?.closest("[data-plan-line]")).toBe(row);
    expect(row.querySelectorAll("[data-plan-line]")).toHaveLength(0);
    expect(failed.textContent).toContain("limiting requests");
    expect(failed.querySelector("[data-plan-reason]")?.getAttribute("title")).toContain("retrying shortly");
    act(() => (row.querySelector("[data-plan-retry]") as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("in French: the short window in hours, Semaine, the percent used and the renewal", () => {
    setLocale("fr");
    const page = view([account("perso", open(27, "2026-11-16T17:00:00Z", 5), open(40))]);
    const row = page.querySelector('[data-plan-row="perso"]')!;
    expect(row.textContent).toContain("Session de 5 h");
    expect(row.textContent).toContain("Semaine");
    expect(row.textContent).toContain("27 % utilisé");
    expect(row.textContent).toContain("Se renouvelle le ");
  });
});

describe("the spending limit is one slim row of the same block (#4445)", () => {
  it("label, percent, bar, amount and Edit on one line, the month's renewal said there once", () => {
    const cap = { supported: true, minUsd: 1, cap: { month: "2026-11", monthlyUsd: 60, spentUsd: 31, percent: 52, warn: false, exceeded: false } };
    const page = mount(createElement(SpendCapRow, { data: cap, now: Date.parse("2026-11-16T15:00:00Z"), write: () => new Promise<never>(() => {}) }));
    const row = page.querySelector('[data-settings-row="cap-state"]')!;
    const line = row.querySelector("[data-plan-line]")!;
    expect(line.textContent).toContain("Spending limit");
    expect(line.querySelector('[data-usage-bar="cap"] [role="meter"]')?.getAttribute("aria-valuenow")).toBe("52");
    expect(line.textContent).toContain("52% used");
    expect(line.textContent).toContain("$31.00");
    expect(line.textContent).toMatch(/Renews Dec/);
    expect(line.querySelector("[data-cap-edit]")).not.toBeNull();
    expect(row.innerHTML).not.toContain("text-[22px]");
  });

  it("the My plan card with only a renewal date is gone; a page with nothing to show still says so with Try again", () => {
    const usage: PersonalUsage = { month: null, previous: null, days30: null, byBot: null, byModel: null } as unknown as PersonalUsage;
    const loaded = mount(createElement(UsagePlan, { usage, error: null }));
    expect(loaded.querySelector('[data-settings-group="usage-plan"]')).toBeNull();
    expect(loaded.textContent).toBe("");
    act(() => root.unmount());
    host.remove();
    const nothing = mount(createElement(UsagePlan, { usage: null, error: "unavailable", onRetry: () => {} }));
    expect(nothing.querySelector("[data-usage-unavailable]")).not.toBeNull();
    expect(nothing.querySelector("[data-usage-retry]")).not.toBeNull();
  });
});
