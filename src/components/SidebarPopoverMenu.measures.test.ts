// @vitest-environment happy-dom
// #4093: the account menu and its usage side card take the reference's menu
// values in the configuration the owner compares (the reference's typeface
// with 15px chat prose, whose root override sets them): 14/20 type, 32px
// rows 6px apart, 16px menu corners, 10px row corners.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

let host: HTMLDivElement;
let root: Root;
const items: SidebarMenuItem[] = [
  {
    key: "usage",
    label: "Usage",
    value: "42% used",
    submenu: [
      { key: "weekly", label: "Engine · Weekly", value: "42% used", info: true },
      { key: "view-usage", label: "View usage", separatorBefore: true, onSelect: () => {} },
    ],
    onSelect: () => {},
  },
  { key: "settings", label: "Settings", onSelect: () => {} },
];

beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(SidebarPopoverMenu, {
    items,
    ariaLabel: "Account",
    banner: () => createElement("div", { "data-test-banner": "" }, "Update available"),
    renderTrigger: () => createElement("span", null, "Owner"),
  })));
  flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const classes = (node: Element | null) => (node?.getAttribute("class") ?? "").split(/\s+/);

describe("the account menu at the owner's configuration of the reference", () => {
  it("draws the menu 14/20 with 32px rows 6px apart, 16px corners and 10px row corners", () => {
    const menu = host.querySelector('[role="menu"]');
    expect(classes(menu)).toEqual(expect.arrayContaining(["text-[14px]", "leading-5", "gap-1.5", "rounded-2xl"]));
    for (const old of ["text-[13px]", "leading-[18px]", "gap-1", "rounded-xl"]) expect(classes(menu)).not.toContain(old);
    const row = host.querySelector('[data-menu-key="settings"]');
    expect(classes(row)).toEqual(expect.arrayContaining(["h-8", "rounded-[10px]", "text-[14px]", "leading-5"]));
    expect(classes(row)).not.toContain("h-[30px]");
    // the waiting update sits above the rows, inside the same menu
    expect(menu?.firstElementChild?.hasAttribute("data-test-banner")).toBe(true);
    // the usage percent follows the menu's type
    expect(classes(host.querySelector("[data-menu-value]"))).not.toContain("text-[13px]");
  });

  it("draws the usage side card with the same values", () => {
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-menu-key="usage"]')!.click());
    const card = document.querySelector("[data-submenu='usage']");
    expect(classes(card)).toEqual(expect.arrayContaining(["text-[14px]", "leading-5", "gap-1.5", "rounded-2xl"]));
    const entry = document.querySelector('[data-menu-key="view-usage"]');
    expect(classes(entry)).toEqual(expect.arrayContaining(["h-8", "rounded-[10px]"]));
  });
});
