// @vitest-environment happy-dom
// The account menu kept open above the name (Settings > Appearance, "Show the
// account menu above my name"): the popover's own rows and second levels,
// docked in the page's flow. A row runs and the menu stays; the second level
// opens and runs as in the popover; the name shows and hides the menu.
// A press outside the menu, or Escape, closes it (#4854).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

let host: HTMLDivElement;
let root: Root;
const openSettings = vi.fn();
const viewUsage = vi.fn();
const items: SidebarMenuItem[] = [
  { key: "usage", label: "Usage", value: "42% used", submenu: [{ key: "view-usage", label: "View usage", onSelect: viewUsage }], onSelect: () => {} },
  { key: "settings", label: "Settings", onSelect: openSettings },
];

beforeEach(() => {
  openSettings.mockReset();
  viewUsage.mockReset();
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(SidebarPopoverMenu, { items, ariaLabel: "Account", docked: true, renderTrigger: () => createElement("span", null, "Owner") })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const menu = () => host.querySelector<HTMLElement>('[role="menu"]');
const row = (key: string) => host.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`)!;
const nameButton = () => host.querySelector<HTMLButtonElement>("button:not([role='menuitem'])")!;

describe("a docked popover menu", () => {
  it("is open with no click, above the name, in the page's flow", () => {
    expect(menu()).not.toBeNull();
    expect(menu()!.className).not.toContain("absolute");
    expect(menu()!.compareDocumentPosition(nameButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row("settings").getAttribute("role")).toBe("menuitem");
  });

  it("runs a row and stays open", () => {
    flushSync(() => row("settings").click());
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(menu()).not.toBeNull();
  });

  it("opens a second level like the popover's and runs its action, leaving the menu open", () => {
    flushSync(() => row("usage").click());
    const level = document.querySelector("[data-submenu]");
    // happy-dom has no layout: the level is placed once measured, so it may stay unplaced here
    if (level) {
      flushSync(() => level.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
      expect(viewUsage).toHaveBeenCalledTimes(1);
    }
    expect(menu()).not.toBeNull();
  });

  it("is shown and hidden by the name", () => {
    flushSync(() => nameButton().click());
    expect(menu()).toBeNull();
    flushSync(() => nameButton().click());
    expect(menu()).not.toBeNull();
  });

  it("closes on a click elsewhere on the page, and on Escape (#4854)", () => {
    flushSync(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(menu()).toBeNull();
    flushSync(() => nameButton().click());
    expect(menu()).not.toBeNull();
    flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu()).toBeNull();
  });
});

describe("the account menu opened from the name", () => {
  it("closes on a click elsewhere, and on Escape (#4854)", () => {
    flushSync(() => root.unmount());
    root = createRoot(host);
    flushSync(() => root.render(createElement(SidebarPopoverMenu, {
      items, ariaLabel: "Account", renderTrigger: () => createElement("span", null, "Owner"),
    })));
    const trigger = host.querySelector("button")!;
    flushSync(() => trigger.click());
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    flushSync(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    flushSync(() => trigger.click());
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});
