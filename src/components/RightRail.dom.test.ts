// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { MemorySidebar } from "./memory-manager/MemorySidebar";
import { CalendarSidebar } from "./routines/CalendarSidebar";
import { RIGHT_RAIL_OPEN_FROM, RightRailStrip, rightRailStartsOpen } from "./RightRail";

// JC 2026-11-03: the Memory explorer is Automations' calendar rail, the same
// component, so their side, width, border, fold and breakpoint cannot drift.
const rail = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector("aside")!;
};

describe("the right rail shared by Automations and Memory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the one component both pages draw, with the same geometry", () => {
    setLocale("en");
    const calendar = rail(renderToStaticMarkup(createElement(CalendarSidebar, { anchor: Date.now(), onSelectDate: vi.fn(), routines: [], runs: [], bots: [], onOpenRoutine: vi.fn(), onCollapse: vi.fn() })));
    const memory = rail(renderToStaticMarkup(createElement(MemorySidebar, { shortcut: "⌘O", onOpenSwitcher: vi.fn(), lists: [], tiers: [], tidy: [], renaming: null, onRenameDone: vi.fn(), loading: null, footer: null, onCollapse: vi.fn() })));
    for (const aside of [calendar, memory]) {
      expect(aside.hasAttribute("data-right-rail")).toBe(true);
      expect(aside.className).toContain("w-[280px]");
      expect(aside.className).toContain("border-l");
      // The "›" in its own row, first, at the top-left.
      expect(aside.children[0]!.querySelector("[data-right-rail-hide]")).not.toBeNull();
    }
    expect(memory.className).toBe(calendar.className);
    expect(memory.children[0]!.outerHTML.replace(/aria-label="[^"]*"|title="[^"]*"/g, "")).toBe(calendar.children[0]!.outerHTML.replace(/aria-label="[^"]*"|title="[^"]*"/g, ""));
  });

  it("both pages take the open state and the strip from it", () => {
    const calendarPage = readFileSync(join(__dirname, "RoutineCalendarPage.tsx"), "utf8");
    const memoryPage = readFileSync(join(__dirname, "memory-manager/MemoryManagerPanel.tsx"), "utf8");
    for (const source of [calendarPage, memoryPage]) {
      expect(source).toContain("useRightRailOpen()");
      expect(source).toContain("<RightRailStrip");
      expect(source).not.toMatch(/matchMedia\("\(min-width: 1280px\)"\)/);
    }
  });

  it("opens from 1280px and starts folded below", () => {
    expect(RIGHT_RAIL_OPEN_FROM).toBe(1280);
    const width = (px: number) => vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: px >= Number(/(\d+)px/.exec(query)![1]), media: query }) as MediaQueryList);
    width(1280);
    expect(rightRailStartsOpen()).toBe(true);
    vi.restoreAllMocks();
    width(1279);
    expect(rightRailStartsOpen()).toBe(false);
  });

  it("folds into the same 40px strip, border on its left", () => {
    const strip = rail(`<aside>${renderToStaticMarkup(createElement(RightRailStrip, { onOpen: vi.fn(), showLabel: "Show", icon: null, text: "Upcoming" }))}</aside>`).firstElementChild!;
    expect(strip.className).toContain("w-10");
    expect(strip.className).toContain("border-l");
    expect(strip.getAttribute("aria-label")).toBe("Show");
  });
});
