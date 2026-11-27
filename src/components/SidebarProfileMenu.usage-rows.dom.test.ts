// @vitest-environment happy-dom
// The account menu's Usage › (owner 2026-11-25, M-20261125-084, #5372; owner
// 2026-11-26, M-20261126-095, #5406): the chat bar's own usage detail
// (UsageAccountsDetail), one row per account, its provider and address, its
// two windows side by side on that row and its star once; never a row per
// window. Read again when Usage › opens, then every minute while it stays
// open (D-20261125-014). Cost this month and View usage stay.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanRow, PlanWindow } from "@/lib/plan-usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ api: vi.fn(async (..._args: unknown[]) => ({}) as unknown), providers: null as unknown[] | null }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: (...args: unknown[]) => fixture.api(...args),
}));

const { setLocale } = await import("@/lib/i18n");
const { SidebarPopoverMenu } = await import("./SidebarPopoverMenu");
const { profileMenuItems } = await import("./SidebarProfileMenu");

const closed: PlanWindow = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number): PlanWindow => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: "2026-10-21T19:40:00Z" });
const row = (patch: Partial<PlanRow>): PlanRow => ({
  id: "claude", name: "ada@acme.test", driver: "claude", plan: "Max", state: "windows", access: "subscription", instanceId: null, instanceIds: [],
  message: null, fiveHour: closed, weekly: closed, extra: [], models: [], ...patch,
});
const noop = () => {};
const handlers = new Proxy({}, { get: () => noop }) as Parameters<typeof profileMenuItems>[0]["handlers"];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  fixture.providers = null;
  fixture.api.mockReset();
  // the plan report: unreachable until a test gives it providers
  fixture.api.mockImplementation(async (path: unknown) => {
    if (path === "/api/plan-usage" && fixture.providers) return { providers: fixture.providers };
    if (path === "/api/plan-usage") throw new Error("unreachable");
    return { checkedAt: 0, engines: [] };
  });
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const openUsage = (usageRows: PlanRow[], onToggle = vi.fn()) => {
  const items = profileMenuItems({
    usagePercent: 89, usageRows, usageFavorite: { id: "claude", onToggle }, monthCost: "$3.10", mobile: false, achievementsLabel: null,
    automationsActive: false, remoteSessionsActive: false, updateItem: null, switchTargets: [], canAddOrganization: false, signOut: false, handlers,
  });
  flushSync(() => root.render(createElement(SidebarPopoverMenu, { items, ariaLabel: "Account", renderTrigger: () => createElement("span", null, "Owner") })));
  flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  flushSync(() => host.querySelector<HTMLElement>('[data-menu-key="usage"]')!.click());
  return document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
};

const planReads = () => fixture.api.mock.calls.filter((call) => call[0] === "/api/plan-usage").length;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("the account menu's Usage ›", () => {
  it("draws one row per account: its provider and address, both windows on that row, its star once", () => {
    const toggle = vi.fn();
    const card = openUsage([
      row({ fiveHour: open(31), weekly: open(89) }),
      row({ id: "grok", name: "ada@acme.test", driver: "grok", plan: "Ultra", weekly: open(40) }),
    ], toggle);
    expect(card.querySelectorAll("[data-usage-detail]")).toHaveLength(1);
    const rows = [...card.querySelectorAll<HTMLElement>("[data-usage-account]")];
    // the account with the most room first
    expect(rows.map((node) => node.dataset.usageAccount)).toEqual(["grok", "claude"]);
    expect(rows.map((node) => node.querySelector("[data-usage-account-name]")?.textContent)).toEqual(["Grok · ada@acme.test · Ultra", "Claude · ada@acme.test · Max"]);
    expect([...rows[1]!.querySelectorAll("td[data-usage-col]")].map((cell) => cell.textContent)).toEqual(["31%", "89%", ""]);
    // an account with one window shows one, and says the other has no limit
    expect([...rows[0]!.querySelectorAll("td[data-usage-col]")].map((cell) => cell.textContent)).toEqual(["no 5h limit", "40%", ""]);
    // no bot here: no account is marked as serving
    expect(card.querySelector("[data-serving]")).toBeNull();
    // one star per account, the favorite's on
    const stars = [...card.querySelectorAll<HTMLButtonElement>("[data-usage-favorite]")];
    expect(stars.map((star) => star.dataset.usageFavorite)).toEqual(["off", "on"]);
    flushSync(() => stars[0]!.click());
    expect(toggle).toHaveBeenCalledWith("grok");
    expect(document.querySelector('[data-submenu="usage"]')).not.toBeNull();
    // never a line per window
    expect(card.querySelector("[data-submenu-info] [data-info-text]")?.textContent).toBe("Cost this month");
  });

  it("D-20261125-014: reads the figures again when Usage › opens, then every minute while it stays open", async () => {
    const provider = (used: number) => ({ id: "claude", name: "ada@acme.test", driver: "claude", plan: "max", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude", instanceIds: ["claude"], fiveHour: closed, weekly: open(used) });
    fixture.providers = [provider(92)];
    const card = openUsage([row({ weekly: open(89) })]);
    expect(card.querySelector('td[data-usage-col="week"]')?.textContent).toBe("89%");
    expect(planReads()).toBe(1);
    await settle();
    expect(card.querySelector('td[data-usage-col="week"]')?.textContent).toBe("92%");
    fixture.providers = [provider(95)];
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await settle();
    expect(planReads()).toBe(2);
    expect(card.querySelector('td[data-usage-col="week"]')?.textContent).toBe("95%");
  });

  it("keeps Cost this month and View usage", () => {
    const card = openUsage([row({ weekly: open(89) })]);
    expect(card.querySelector("[data-submenu-foot]")?.textContent).toContain("Cost this month");
    expect(card.querySelector("[data-submenu-foot]")?.textContent).toContain("View usage");
  });
});
