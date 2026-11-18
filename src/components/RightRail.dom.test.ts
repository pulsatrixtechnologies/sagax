// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { MemorySidebar } from "./memory-manager/MemorySidebar";
import { CalendarSidebar } from "./routines/CalendarSidebar";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RIGHT_RAIL_OPEN_FROM, RightRailStrip, rightRailStartsOpen, useRightRailOpen } from "./RightRail";

// the owner 2026-11-03: the Memory explorer is Automations' calendar rail, the same
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

  it("below 1280px the rail is a sheet over the list with its own close, never beside it (a phone squeezed the list)", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(MemorySidebar, { shortcut: "⌘O", onOpenSwitcher: vi.fn(), lists: [], tiers: [], tidy: [], renaming: null, onRenameDone: vi.fn(), loading: null, footer: null, onCollapse: vi.fn() }));
    const aside = rail(html);
    expect(aside.className).toContain("max-[1279px]:absolute");
    expect(aside.className).toContain("max-[1279px]:right-0");
    expect(aside.className).toContain("max-[1279px]:max-w-[calc(100%-48px)]");
    expect(aside.querySelector("[data-right-rail-hide]")).not.toBeNull();
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("[data-right-rail-scrim]")!.className).toContain("min-[1280px]:hidden");
  });

  it("the choice made in a wide window does not carry to a narrow one, and the sheet starts closed", () => {
    const state = { wide: true };
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: state.wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
    let latest: ReturnType<typeof useRightRailOpen> = [false, () => {}];
    const Probe = () => { latest = useRightRailOpen(); return null; };
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(latest[0]).toBe(true);
    state.wide = false;
    act(() => root.render(createElement(Probe, { key: "narrow" })));
    expect(latest[0], "narrow window: closed").toBe(false);
    act(() => latest[1](true));
    expect(latest[0]).toBe(true);
    act(() => root.unmount());
  });

  it("both pages take the open state and the strip from it", () => {
    const calendarPage = [
      readFileSync(join(__dirname, "RoutineCalendarPage.tsx-parts/useRoutinesPage.ts"), "utf8"),
      readFileSync(join(__dirname, "RoutineCalendarPage.tsx-parts/RoutinesPageView.tsx"), "utf8"),
    ].join("\n");
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
