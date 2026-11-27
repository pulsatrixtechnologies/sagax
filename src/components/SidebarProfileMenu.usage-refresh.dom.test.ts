// @vitest-environment happy-dom
// #5342 [D-20261125-014]: the account menu's Usage figures are read again
// each time the menu opens, then every minute while it stays open; the
// percent on the Usage row follows. They were read once, the first time the
// menu opened, and kept until the app restarted. The read is the plain
// GET /api/plan-usage (the server's own 45 second cache answers it), never
// the forced one.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAchievementsForTests } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: () => {}, used: 42, calls: [] as string[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn((path: string) => {
      fixture.calls.push(path);
      if (!path.startsWith("/api/plan-usage")) return new Promise(() => {});
      return Promise.resolve({
        providers: [{
          id: "claude", name: "ada@acme.example", driver: "claude", plan: "max", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude",
          fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
          weekly: { available: true, remainingPercent: 100 - fixture.used, usedPercent: fixture.used, resetsAt: null },
        }],
      });
    }),
    useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }),
  };
});
// InitialsAvatar is enough for the account row; the mascot stack needs open-bot-avatar materials this worktree's node_modules may not export yet.
vi.mock("./Avatar", () => ({ InitialsAvatar: () => createElement("span", { "data-avatar": "" }) }));

import { SidebarProfileMenu } from "./SidebarProfileMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  setLocale("en");
  fixture.used = 42;
  fixture.calls.length = 0;
  fixture.state = { config: { profile: { name: "Sample Person", email: "person@example.com" } } as AppState["config"] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetAchievementsForTests();
  vi.useRealTimers();
});

const accountButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Sample Person"]')!;
const planReads = () => fixture.calls.filter((path) => path.startsWith("/api/plan-usage"));
const isOpen = () => accountButton().getAttribute("aria-expanded") === "true";
const usageRow = () => [...container.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((item) => item.textContent?.includes("Usage"))?.textContent ?? "";
/** Lets the answered reads land and the menu settle, without reaching the next minute. */
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1_000); }); };
const toggle = async () => { act(() => accountButton().click()); await settle(); };

describe("the account menu's Usage figures stay current", () => {
  it("reads nothing before the menu opens, then the figures at the first opening", async () => {
    act(() => root.render(createElement(SidebarProfileMenu, {})));
    await settle();
    expect(planReads()).toHaveLength(0);
    await toggle();
    expect(isOpen()).toBe(true);
    expect(planReads()).toEqual(["/api/plan-usage"]);
    expect(usageRow()).toContain("42%");
  });

  it("reads them again at each opening: the Usage row's percent follows", async () => {
    act(() => root.render(createElement(SidebarProfileMenu, {})));
    await toggle();
    expect(usageRow()).toContain("42%");
    await toggle();
    expect(isOpen()).toBe(false);
    fixture.used = 77;
    await toggle();
    expect(isOpen()).toBe(true);
    expect(planReads()).toHaveLength(2);
    expect(usageRow()).toContain("77%");
  });

  it("reads them every minute while the menu stays open, and stops once it is closed", async () => {
    act(() => root.render(createElement(SidebarProfileMenu, {})));
    await toggle();
    expect(planReads()).toHaveLength(1);
    fixture.used = 58;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(isOpen()).toBe(true);
    expect(planReads()).toHaveLength(2);
    expect(usageRow()).toContain("58%");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(planReads()).toHaveLength(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(planReads()).toHaveLength(4);
    await toggle();
    expect(isOpen()).toBe(false);
    const closedAt = planReads().length;
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(planReads()).toHaveLength(closedAt);
  });

  it("never forces a provider read: the server's cache answers", async () => {
    act(() => root.render(createElement(SidebarProfileMenu, {})));
    await toggle();
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(planReads().length).toBeGreaterThan(1);
    expect(planReads().every((path) => path === "/api/plan-usage")).toBe(true);
  });

  it("a menu kept open above the name reads at once and every minute", async () => {
    act(() => root.render(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true })));
    await settle();
    expect(planReads()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(planReads()).toHaveLength(2);
  });
});
