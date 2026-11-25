// @vitest-environment happy-dom
// #5353: on Personal, Switch organization › listed only "Add an
// organization". The desktop opens Personal's page hidden, ready for a
// switch, and the account menu docked above the name reads the saved
// servers as soon as it mounts: main refuses that read to a page that is
// not on screen, and the menu never asked again. The read is now asked
// again when the page comes on screen.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAchievementsForTests } from "@/lib/achievements";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState>, dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(() => new Promise(() => {})),
    useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }),
  };
});

import { SidebarProfileMenu } from "./SidebarProfileMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What main answers Personal's page once it is on screen, in server mode. */
const saved = {
  activeId: "local",
  environments: [{ id: "srv-1", kind: "remote" as const, name: "sagax.acme.example", origin: "https://sagax.acme.example", orgName: "Acme", org: true }],
};

let root: Root;
let container: HTMLDivElement;
let onScreen = false;
const state = vi.fn(async () => {
  // electron/main.mjs workspaceOnly: a page that is not the one on screen is refused
  if (!onScreen) throw new Error("These controls are only available in the main desktop window");
  return saved;
});
const switchTo = vi.fn(async () => ({}));

beforeEach(() => {
  onScreen = false;
  state.mockClear();
  switchTo.mockClear();
  fixture.dispatch.mockReset();
  fixture.state = { config: { profile: { name: "Sample Person", email: "person@example.com" } } as AppState["config"] };
  document.documentElement.dataset.reducedMotion = "true";
  (window as unknown as { ogb?: unknown }).ogb = { environments: { state, switch: switchTo } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { ogb?: unknown }).ogb;
  vi.useRealTimers();
  resetAchievementsForTests();
});

const settle = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
const row = (key: string) => document.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`);
/** The rows of Switch organization ›, as read. */
const organizations = async (): Promise<string[]> => {
  act(() => row("switch-organization")!.click());
  await settle();
  const level = document.querySelector('[data-submenu="switch-organization"]');
  return Array.from(level?.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]') ?? []).map((item) => item.getAttribute("data-menu-key") ?? "");
};

describe("Switch organization on Personal (#5353)", () => {
  it("lists the organization the app knows once the page prepared hidden comes on screen", async () => {
    // the docked menu (on by default) reads with the row, while the page is hidden
    act(() => root.render(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true })));
    await settle();
    expect(state).toHaveBeenCalledTimes(1);
    // the person switches to Personal: its page is shown as it was, and focused
    onScreen = true;
    act(() => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(await organizations()).toEqual(["switch:local", "switch:srv-1", "add-organization"]);
    const organization = row("switch:srv-1")!;
    expect(organization.textContent).toContain("Acme");
    act(() => organization.click());
    expect(switchTo).toHaveBeenCalledWith("srv-1");
  });

  it("asks again at the person's first move on the page when no focus was told", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    act(() => root.render(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true })));
    await settle();
    onScreen = true;
    // a refused read is asked again a second later at the earliest
    vi.setSystemTime(Date.now() + 1_500);
    act(() => { window.dispatchEvent(new Event("pointermove")); });
    await settle();
    expect(await organizations()).toEqual(["switch:local", "switch:srv-1", "add-organization"]);
  });

  it("reads once when the page is on screen from the start", async () => {
    onScreen = true;
    act(() => root.render(createElement(SidebarProfileMenu, { avatarOnly: true, withName: true })));
    await settle();
    act(() => { window.dispatchEvent(new Event("pointermove")); });
    await settle();
    expect(state).toHaveBeenCalledTimes(1);
    expect(await organizations()).toEqual(["switch:local", "switch:srv-1", "add-organization"]);
  });
});
