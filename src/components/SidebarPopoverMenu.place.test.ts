// @vitest-environment happy-dom
// #4157: the account menu's side cards (Usage, Help, Tools, Switch account)
// stay inside the window. The usage card with five engines, one with a long
// plan name, in a short window ran past the window's bottom edge, and a row's
// title was cut on the part that tells which limit it is. The placement is
// the reference's: 4px over its row's trailing edge, its top on the row's
// top, 12px from the window's sides and bottom and under the top bar,
// shifted up near the bottom, flipped when the right is full. Past the
// window's height only the engines' rows scroll: the month's cost and View
// usage are the card's foot and stay in view.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { measureRowsFold, SidebarPopoverMenu, submenuPlace, submenuRowsFold, type SidebarMenuItem, type SidebarSubmenuEntry } from "./SidebarPopoverMenu";
import { usageLines } from "@/lib/account-menu";
import type { PlanRow, PlanWindow } from "@/lib/plan-usage";

describe("submenuPlace", () => {
  const row = { left: 6, right: 234, top: 400 };

  it("overlaps its row by 4px and starts level with it", () => {
    expect(submenuPlace(row, { width: 228, height: 120 }, { width: 1280, height: 900 })).toEqual({ left: 230, top: 400, maxHeight: 900 - 56 - 12 });
  });

  it("shifts up so its bottom keeps 12px from the window's bottom", () => {
    const place = submenuPlace({ ...row, top: 560 }, { width: 260, height: 300 }, { width: 900, height: 600 });
    expect(place.top + 300).toBe(600 - 12);
  });

  it("caps its height in a short window and stays under the top bar", () => {
    const place = submenuPlace({ ...row, top: 300 }, { width: 260, height: 700 }, { width: 900, height: 420 });
    // the top bar's controls (search, +, the header's buttons) stay uncovered
    expect(place).toEqual({ left: 230, top: 56, maxHeight: 420 - 56 - 12 });
  });

  it("flips to the row's other side when the right has no room", () => {
    const place = submenuPlace({ left: 700, right: 880, top: 100 }, { width: 228, height: 100 }, { width: 900, height: 600 });
    expect(place.left).toBe(700 + 4 - 228);
  });
});

// #4157 review: in a short window the fold landed on a row boundary, so the
// capped card looked complete (it seemed to end at the fourth engine) while
// the fifth engine's rows were hidden under it, and the 24px fade only dimmed
// a subtitle. The fold now always cuts through a row: its top part shows.
describe("submenuRowsFold", () => {
  // ten 50px rows, 2px apart
  const tenRows = Array.from({ length: 10 }, (_, index) => ({ top: index * 52, height: 50 }));

  it("is null when every row fits", () => {
    expect(submenuRowsFold(tenRows, 518)).toBeNull();
    expect(submenuRowsFold([], 100)).toBeNull();
  });

  it("never ends on a row boundary: the last row it reaches shows 60% of itself", () => {
    // 4 rows + gaps end at 206: the room ends exactly on a boundary
    expect(submenuRowsFold(tenRows, 206)).toBe(156 + 30);
    expect(submenuRowsFold(tenRows, 250)).toBe(208 + 30);
    for (let room = 60; room < 518; room += 7) {
      const fold = submenuRowsFold(tenRows, room)!;
      expect(fold).toBeLessThanOrEqual(room);
      const cut = tenRows.find((row) => fold > row.top && fold < row.top + row.height);
      expect(cut, `room ${room}: fold ${fold} cuts through a row`).toBeDefined();
    }
  });

  it("measures the room the card leaves its rows under its height limit", () => {
    const children = tenRows.map((row) => ({ offsetTop: 6 + row.top, offsetHeight: row.height }));
    const rowsPart = { offsetTop: 6, offsetHeight: 250, children } as unknown as HTMLElement;
    const level = { offsetHeight: 352 } as unknown as HTMLElement;
    // 102px of padding and foot around the rows: 250px left for them
    expect(measureRowsFold(level, rowsPart, 352)).toBe(238);
  });
});

// five engines, one with a long plan name
const open = (used: number, hours: number): PlanWindow => ({ available: true, usedPercent: used, remainingPercent: 100 - used, resetsAt: new Date(Date.now() + hours * 3_600_000).toISOString() });
const engine = (id: string, name: string, plan: string, weekly: number, fiveHour: number): PlanRow => ({
  id, name, driver: id, plan, state: "windows", access: "subscription", instanceId: null, instanceIds: [],
  message: null, weekly: open(weekly, 50), fiveHour: open(fiveHour, 3), extra: [], models: [],
});
const rows = [
  engine("claude", "Claude", "Max", 64, 18),
  engine("grok", "Grok", "SuperGrok Heavy", 87, 12),
  engine("codex", "Codex", "Business Enterprise Annual", 100, 41),
  engine("gemini", "Gemini", "Ultra", 23, 5),
  engine("cursor", "Cursor", "Pro Plus", 56, 30),
];
const lines = usageLines(rows, { weekly: "Weekly", fiveHour: "5-hour", used: (n) => `${n}% used`, resetsIn: (when) => `resets in ${when}` });

let host: HTMLDivElement;
let root: Root;
const restore = { innerHeight: window.innerHeight, innerWidth: window.innerWidth };

beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  Object.assign(window, restore);
});

describe("the usage side card with five engines in a short window", () => {
  it("reads every row whole, stays inside the window and scrolls inside", () => {
    Object.assign(window, { innerHeight: 420, innerWidth: 900 });
    const usage: SidebarSubmenuEntry[] = lines.map((line, index) => ({
      key: line.key, label: line.label, subtitle: line.subtitle, value: line.value, info: true,
      ...(index % 2 === 0 ? { favorite: { on: index === 0, label: "Star", onToggle: () => {} } } : {}),
    }));
    let viewed = 0;
    const items: SidebarMenuItem[] = [{ key: "usage", label: "Usage", submenu: [
      ...usage,
      { key: "month-cost", label: "Cost this month", value: "$48.27", info: true, foot: true },
      { key: "view-usage", label: "View usage", separatorBefore: true, foot: true, onSelect: () => { viewed += 1; } },
    ], submenuWidth: 228, onSelect: () => {} }];
    flushSync(() => root.render(createElement(SidebarPopoverMenu, { items, ariaLabel: "Account", renderTrigger: () => createElement("span", null, "Owner") })));
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-menu-key="usage"]')!.click());
    const card = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    // a height limit inside the window, under the top bar
    expect(card.style.maxHeight).toBe(`${420 - 56 - 12}px`);
    expect(Number.parseFloat(card.style.top)).toBeGreaterThanOrEqual(56);
    expect(card.style.bottom).toBe("");
    // only the engines' rows scroll; the card itself never scrolls its foot away
    expect(card.className).toContain("overflow-hidden");
    expect(card.className).not.toContain("overflow-y-auto");
    const scroller = card.querySelector<HTMLElement>("[data-submenu-rows]")!;
    expect(scroller.className).toMatch(/\boverflow-y-auto\b/);
    expect(scroller.className).toMatch(/\bmin-h-0\b/);
    expect(scroller.querySelectorAll("[data-submenu-info]")).toHaveLength(10);
    // 'Cost this month' and 'View usage': the card's foot, outside the
    // scrolling part, never shrunk, so they stay in view and clickable
    const foot = card.querySelector<HTMLElement>("[data-submenu-foot]")!;
    expect(foot, "the card's pinned foot").not.toBeNull();
    expect(foot.parentElement).toBe(card);
    expect(foot.className).toMatch(/\bshrink-0\b/);
    expect(foot.textContent).toContain("Cost this month");
    const viewUsage = foot.querySelector<HTMLButtonElement>('[data-menu-key="view-usage"]')!;
    expect(scroller.contains(viewUsage)).toBe(false);
    expect(viewUsage.disabled).toBe(false);
    // the rows fade at the fold while more of them wait below (the
    // scrollbar is invisible at rest)
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 240 });
    flushSync(() => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(scroller.dataset.more).toBe("below");
    scroller.scrollTop = 360;
    flushSync(() => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(scroller.dataset.more).toBeUndefined();
    // the fold cuts through a row and a hairline parts the rows from the foot
    expect(card.querySelector("[data-submenu-foot] > .menu-divider"), "no hairline while every row fits").toBeNull();
    const define = (node: Element, values: Record<string, number>) => {
      for (const [name, value] of Object.entries(values)) Object.defineProperty(node, name, { configurable: true, value });
    };
    define(card, { offsetHeight: 352, offsetWidth: 300 });
    define(scroller, { offsetTop: 6, offsetHeight: 250 });
    [...scroller.children].forEach((child, index) => define(child, { offsetTop: 6 + index * 52, offsetHeight: 50 }));
    flushSync(() => window.dispatchEvent(new Event("resize")));
    expect(scroller.style.maxHeight).toBe("238px");
    expect(card.querySelector("[data-submenu-foot] > .menu-divider"), "the hairline over the pinned foot").not.toBeNull();
    expect(scroller.contains(foot)).toBe(false);
    flushSync(() => viewUsage.click());
    expect(viewed).toBe(1);
    // the engine and its plan on the first line, the window and its reset
    // on the second, never cut
    const info = [...scroller.querySelectorAll<HTMLElement>("[data-submenu-info]")];
    expect(info).toHaveLength(10);
    const codex = info.find((node) => node.textContent?.includes("Business Enterprise Annual"))!;
    const [title, span] = [...codex.querySelectorAll<HTMLElement>("span > span")];
    expect(title!.textContent).toBe("Codex Business Enterprise Annual");
    expect(span!.textContent).toMatch(/^Weekly · resets in /);
    expect(span!.className).not.toContain("truncate");
    // every row keeps the star's seat, so the percents share one right edge
    for (const row of info) expect(row.querySelectorAll("[data-usage-favorite], [data-favorite-slot]")).toHaveLength(1);
  });
});

// #4157 review: in French the reset line ("Hebdomadaire · réinitialisation
// dans 2d 4h") is longer than the old 320px card could hold beside the
// percent; held on one line inside a shrinkable column it ran under "64 %
// utilisé". The card now grows to a cap that holds the French row, and past
// it each line wraps inside its own column: nothing is cut, nothing overlaps.
describe("the usage side card in French", () => {
  it("never holds a line on one line beside the percent, and its cap fits the French row", () => {
    Object.assign(window, { innerHeight: 420, innerWidth: 1280 });
    const fr = usageLines(rows, { weekly: "Hebdomadaire", fiveHour: "5 heures", used: (n) => `${n} % utilisé`, resetsIn: (when) => `réinitialisation dans ${when}` });
    const usage: SidebarSubmenuEntry[] = fr.map((line) => ({ key: line.key, label: line.label, subtitle: line.subtitle, value: line.value, info: true, favorite: { on: false, label: "Étoile", onToggle: () => {} } }));
    const items: SidebarMenuItem[] = [{ key: "usage", label: "Utilisation", submenu: usage, submenuWidth: 228, onSelect: () => {} }];
    flushSync(() => root.render(createElement(SidebarPopoverMenu, { items, ariaLabel: "Compte", renderTrigger: () => createElement("span", null, "Owner") })));
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-menu-key="usage"]')!.click());
    const card = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    // the cap: the longest French row at the menu's type (12px reset line
    // about 250px, the 14px percent about 85px, the star, gaps and padding)
    const cap = /max-w-\[min\((\d+)px/.exec(card.className);
    expect(cap, "the card's width cap").not.toBeNull();
    expect(Number(cap![1])).toBeGreaterThanOrEqual(400);
    for (const row of card.querySelectorAll<HTMLElement>("[data-submenu-info]")) {
      const column = row.querySelector<HTMLElement>("[data-info-text]")!;
      // the percent sits outside the text column and keeps its width
      const percent = [...row.children].find((node) => /utilisé/.test(node.textContent ?? "") && node !== column)!;
      expect(percent.className).toContain("shrink-0");
      for (const line of column.children) {
        // a shrinkable column with a line that cannot wrap runs under the
        // percent; an ellipsis hides which limit the row is
        expect(line.className).not.toMatch(/whitespace-nowrap|truncate|text-ellipsis/);
        expect(line.className).toContain("break-words");
      }
    }
  });
});
