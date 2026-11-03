// @vitest-environment happy-dom
// The account menu's second levels (the reference design's Usage ›, Help ›, Switch
// organization ›): a chevron and a grey value on the row, the level opens on
// click or the right arrow, closes with the left arrow, and its actions run.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

let host: HTMLDivElement;
let root: Root;
const viewUsage = vi.fn();
const items: SidebarMenuItem[] = [
  {
    key: "usage",
    label: "Usage",
    value: "42% used",
    submenu: [
      { key: "weekly", label: "Claude Max · Weekly", value: "42% used", info: true },
      { key: "view-usage", label: "View usage", separatorBefore: true, onSelect: viewUsage },
    ],
    onSelect: () => {},
  },
  { key: "settings", label: "Settings", onSelect: () => {} },
  {
    key: "tools",
    label: "Tools",
    submenu: [
      { key: "routines", label: "Automations", tourId: "nav-automations", active: true, onSelect: () => {} },
    ],
    onSelect: () => {},
  },
];

beforeEach(() => {
  viewUsage.mockReset();
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(SidebarPopoverMenu, { items, ariaLabel: "Account", renderTrigger: () => createElement("span", null, "Owner") })));
  flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const row = (key: string) => host.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`)!;

describe("a second level in the sidebar's popover menu", () => {
  it("shows the value in grey and a chevron, folded until asked", () => {
    expect(row("usage").querySelector("[data-menu-value]")!.textContent).toBe("42% used");
    expect(row("usage").getAttribute("aria-haspopup")).toBe("menu");
    expect(row("usage").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-submenu]")).toBeNull();
  });

  it("opens on click with its figures and actions, and runs an action", () => {
    flushSync(() => row("usage").click());
    const sub = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    expect(sub.getAttribute("role")).toBe("menu");
    expect(sub.querySelector("[data-submenu-info]")!.textContent).toContain("42% used");
    const action = [...sub.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "View usage")!;
    // the level floats on the page, outside the menu's box: a press in it
    // must not count as a press outside the menu
    flushSync(() => action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector('[data-submenu="usage"]')).not.toBeNull();
    flushSync(() => action.click());
    expect(viewUsage).toHaveBeenCalledOnce();
  });

  it("keeps a moved row's tour anchor and the open page lit", () => {
    flushSync(() => row("tools").click());
    const sub = document.querySelector<HTMLElement>('[data-submenu="tools"]')!;
    const automations = sub.querySelector<HTMLButtonElement>('[data-menu-key="routines"]')!;
    expect(automations.getAttribute("data-tour")).toBe("nav-automations");
    expect(automations.className).toContain("bg-selected");
  });

  it("opens with the right arrow and closes with the left arrow", () => {
    flushSync(() => row("usage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const sub = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    expect(sub).not.toBeNull();
    flushSync(() => sub.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.querySelector("[data-submenu]")).toBeNull();
  });
});

describe("Usage ›'s star (2026-11-03)", () => {
  it("toggles from its info line and leaves the level open", () => {
    const toggle = vi.fn();
    const starred: SidebarMenuItem[] = [{
      key: "usage",
      label: "Usage",
      value: "Grok 87%",
      submenu: [
        { key: "grok:weekly", label: "Grok SuperGrok Heavy · Weekly", value: "87% used", info: true, favorite: { on: true, label: "Stop showing Grok", onToggle: toggle } },
        { key: "codex:five-hour", label: "Codex Business · 5-hour", value: "100% used", info: true, favorite: { on: false, label: "Show Codex", onToggle: toggle } },
      ],
      onSelect: () => {},
    }];
    flushSync(() => root.render(createElement(SidebarPopoverMenu, { items: starred, ariaLabel: "Account", renderTrigger: () => createElement("span", null, "Owner") })));
    flushSync(() => host.querySelector<HTMLElement>('[data-menu-key="usage"]')!.click());
    const sub = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    const stars = [...sub.querySelectorAll<HTMLButtonElement>("[data-usage-favorite]")];
    expect(stars.map((star) => [star.dataset.usageFavorite, star.getAttribute("aria-pressed")])).toEqual([["on", "true"], ["off", "false"]]);
    // always visible while on; the other only on hover or focus
    expect(stars[0]!.className).not.toContain("opacity-0");
    expect(stars[1]!.className).toContain("opacity-0");
    flushSync(() => stars[1]!.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-submenu="usage"]')).not.toBeNull();
  });
});
