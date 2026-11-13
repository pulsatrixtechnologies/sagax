// @vitest-environment happy-dom
// #4093: the account menu and its usage side card take the reference's menu
// values in the configuration the owner compares (the reference's typeface
// with 15px chat prose, whose root override sets them): 14/20 type, 32px
// rows 2px apart with 6px from the glyph to the text (#4157: the 6px is the
// glyph's gap, not the rows'), 16px menu corners, 10px row corners, and the
// menu family's surface (its hairline, fill and shadow, `.menu-surface`).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";
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
  { key: "settings", label: "Settings", icon: createElement("svg", { "data-glyph": "" }), onSelect: () => {} },
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
  it("draws the menu 14/20 with 32px rows 2px apart, 16px corners and 10px row corners", () => {
    const menu = host.querySelector('[role="menu"]');
    expect(classes(menu)).toEqual(expect.arrayContaining(["text-[14px]", "leading-5", "gap-0.5", "rounded-2xl", "menu-surface", "popover-surface"]));
    for (const old of ["text-[13px]", "leading-[18px]", "gap-1", "gap-1.5", "rounded-xl", "border-border", "bg-elevated"]) expect(classes(menu)).not.toContain(old);
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
    expect(classes(card)).toEqual(expect.arrayContaining(["text-[14px]", "leading-5", "gap-0.5", "rounded-2xl", "menu-surface"]));
    expect(classes(card)).not.toContain("border-border");
    const entry = document.querySelector('[data-menu-key="view-usage"]');
    expect(classes(entry)).toEqual(expect.arrayContaining(["h-8", "rounded-[10px]"]));
  });
});

describe("the menu family's look, measured on the reference (#4157)", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("draws a row's glyph in the glyph slot, never in the text's ink", () => {
    const glyph = host.querySelector('[data-menu-key="settings"] [data-menu-glyph]');
    expect(classes(glyph)).toContain("menu-glyph");
    expect(classes(glyph)).not.toContain("text-ink");
    expect(classes(host.querySelector('[data-menu-key="settings"]'))).toContain("gap-1.5");
  });

  it("takes the reference's hairline, glyph ink, row fills and shadow from the skin's ink", () => {
    expect(css).toMatch(/--menu-hairline: color-mix\(in srgb, var\(--color-ink\) 10%, transparent\);/);
    expect(css).toMatch(/--menu-glyph: color-mix\(in srgb, var\(--color-ink\) 64%, transparent\);/);
    expect(css).toMatch(/--menu-row-hover: color-mix\(in srgb, var\(--color-ink\) 6%, transparent\);/);
    expect(css).toMatch(/--menu-row-active: color-mix\(in srgb, var\(--color-ink\) 8%, transparent\);/);
    expect(css).toMatch(/--menu-shadow: none;/);
    expect(css).toMatch(/\.menu-surface \{[^}]*border: 0\.5px solid var\(--menu-hairline\);/);
    expect(css).toMatch(/\.menu-glyph > svg \{[^}]*width: 16px;[^}]*stroke-width: 1\.5;/);
  });
});

// #4157 review: the rows read the reference's 6% hovered and 8% open fills.
// `bg-hover` and `bg-selected` compile to the generic grey literals (their
// tokens live in `@theme inline`), so overriding those tokens on the surface
// did nothing. This compiles the classes the rows actually render with.
describe("the menu rows' fills, as compiled", () => {
  const compiled = async (candidates: string[]) => {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("tailwindcss/index.css");
    const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
      base: "src",
      // the stylesheet's own imports (typefaces, skin files) add no utility
      loadStylesheet: async (id, base) => ({ path: id, base, content: id === "tailwindcss" ? readFileSync(entry, "utf8") : "" }),
      loadModule: async () => ({ path: "", base: "", module: () => {} }),
    });
    return compiler.build(candidates);
  };
  const fillOf = (css: string, candidate: string) => {
    const selector = `.${candidate.replace(/[:[\]()]/g, (char) => `\\${char}`)}`;
    const at = css.indexOf(selector);
    if (at < 0) return null;
    return /background-color: ([^;]+);/.exec(css.slice(at))?.[1] ?? null;
  };

  it("draws a hovered row with the menu's hover fill and an open row with its active fill", async () => {
    const row = host.querySelector('[data-menu-key="settings"]')!;
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-menu-key="usage"]')!.click());
    const open = host.querySelector('[data-menu-key="usage"]')!;
    const entry = document.querySelector('[data-menu-key="view-usage"]')!;
    const candidates = [...new Set([...classes(row), ...classes(open), ...classes(entry)])].filter(Boolean);
    const css = await compiled(candidates);
    const hover = classes(row).find((name) => name.startsWith("hover:bg-"));
    const active = classes(open).find((name) => name.startsWith("bg-"));
    const entryHover = classes(entry).find((name) => name.startsWith("hover:bg-"));
    expect(hover && fillOf(css, hover)).toBe("var(--menu-row-hover)");
    expect(entryHover && fillOf(css, entryHover)).toBe("var(--menu-row-hover)");
    expect(active && fillOf(css, active)).toBe("var(--menu-row-active)");
  });
});
