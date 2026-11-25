// @vitest-environment happy-dom
// The account menu's Usage › (owner 2026-11-25, M-20261125-084, #5372): one
// row per account, its provider and address, its two windows side by side on
// that row and its star once; never a row per window. The row is the one of
// Settings > Usage limits (PlanUsage.tsx). Cost this month and View usage stay.
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { PlanRow, PlanWindow } from "@/lib/plan-usage";
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";
import { profileMenuItems } from "./SidebarProfileMenu";

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
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
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

describe("the account menu's Usage ›", () => {
  it("draws one row per account: its provider and address, both windows on that row, its star once", () => {
    const toggle = vi.fn();
    const card = openUsage([
      row({ fiveHour: open(31), weekly: open(89) }),
      row({ id: "grok", name: "ada@acme.test", driver: "grok", plan: "Ultra", weekly: open(40) }),
    ], toggle);
    const rows = [...card.querySelectorAll<HTMLElement>("[data-plan-line]")];
    expect(rows.map((node) => node.dataset.planRow)).toEqual(["claude", "grok"]);
    expect(rows.map((node) => node.querySelector("[data-plan-name]")?.textContent)).toEqual(["Claude · ada@acme.test", "Grok · ada@acme.test"]);
    expect([...rows[0]!.querySelectorAll<HTMLElement>("[data-plan-window-kind]")].map((node) => node.dataset.planWindowKind)).toEqual(["fiveHour", "weekly"]);
    expect([...rows[0]!.querySelectorAll("[data-limit-figure]")].map((node) => node.textContent)).toEqual(["5-hour session31% used", "Week89% used"]);
    // an account with one window shows one
    expect([...rows[1]!.querySelectorAll<HTMLElement>("[data-plan-window-kind]")].map((node) => node.dataset.planWindowKind)).toEqual(["weekly"]);
    // one star per account, the favorite's on
    const stars = [...card.querySelectorAll<HTMLButtonElement>("[data-usage-favorite]")];
    expect(stars.map((star) => star.dataset.usageFavorite)).toEqual(["on", "off"]);
    flushSync(() => stars[1]!.click());
    expect(toggle).toHaveBeenCalledWith("grok");
    expect(document.querySelector('[data-submenu="usage"]')).not.toBeNull();
    // never a line per window
    expect(card.querySelector("[data-submenu-info] [data-info-text]")?.textContent).toBe("Cost this month");
  });

  it("keeps Cost this month and View usage", () => {
    const card = openUsage([row({ weekly: open(89) })]);
    expect(card.querySelector("[data-submenu-foot]")?.textContent).toContain("Cost this month");
    expect(card.querySelector("[data-submenu-foot]")?.textContent).toContain("View usage");
  });
});
