// @vitest-environment happy-dom
// Compact docked browser chrome (M-20261127-064): two rows, editable URL,
// Take control in the screen panel's shared top row (M-20261127-181), empty
// state, no framed card. Its sizes are the app's own (M-20261127-179): pinned
// here by the shared classes they use.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveBrowserView, type LiveBrowserViewProps } from "./BrowserPanel.tsx-parts/LiveBrowserView";
import { CIRCLE_BUTTON, CIRCLE_ICON, CIRCLE_LABEL, CIRCLE_LABEL_BUTTON } from "@/lib/circle-button";
import { PLAIN_FIELD } from "./SettingsPrimitives";
import { FOLD_CHIP, FOLD_CHIP_LABEL, SCREEN_PANEL_TOP_ROW, ScreenPanelBar } from "./ScreenPanelChrome";
import { liveBrowserViewProps } from "@/testing/live-browser-view-props";
import type { Bot } from "@/state/store";

vi.mock("@/lib/i18n", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/i18n")>();
  return {
    ...real,
    t: (key: string, vars?: Record<string, string>) => {
      const table: Record<string, string> = {
        "browser.tab.new": "New tab",
        "browser.tab.closeUntitled": "Close tab",
        "browser.address.label": "Browser address",
        "browser.live.connecting": "Connecting…",
        "browser.nav.back": "Back",
        "browser.nav.forward": "Forward",
        "browser.nav.reload": "Reload page",
        "browser.menu.label": "Browser menu",
        "browser.menu.type": "Type or paste text…",
        "browser.typeSecret": "Type a password or code…",
        "browser.menu.network": "Network requests",
        "teach.start": "Teach",
        "browser.menu.reconnect": "Reconnect view",
        "browser.menu.restart": "Restart browser…",
        "browser.profiles.open": "Browser profiles",
        "browser.profile.current": `Browser profile: ${vars?.name ?? ""}`,
        "browser.control.giveBack": "Give back control",
        "sandboxDesktop.takeControl": "Take control",
        "sandboxDesktop.controlling": "You have control",
        "browser.panel.browseWith": `Browse with ${vars?.name ?? ""}`,
        "browser.panel.browseWithHint": "Open a page in the address bar, or let the bot navigate.",
        "browser.live.opening": "Opening the live browser…",
      };
      return table[key] ?? key;
    },
  };
});

const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;

function base(over: Partial<LiveBrowserViewProps> = {}): LiveBrowserViewProps {
  return liveBrowserViewProps(bot, {
    holder: "Pepper is using the browser",
    docked: {
      title: "Pepper’s browser",
      bar: (slots) => createElement(ScreenPanelBar, {
        ...slots,
        places: createElement("div", { "data-screen-place-select": "" }, "places"),
        tools: createElement("div", { "data-screen-panel-chrome": "" }, "chrome"),
      }),
    },
    ...over,
  });
}

describe("compact LiveBrowserView", () => {
  it("renders two compact rows, editable URL, chrome and place selector", () => {
    const html = renderToStaticMarkup(createElement(LiveBrowserView, base()));
    expect(html).toContain('data-browser-compact=""');
    expect(html).toContain("data-browser-tabs");
    expect(html).toContain("data-browser-address-row");
    expect(html).toContain('aria-label="Browser address"');
    expect(html).toContain("data-screen-panel-chrome");
    expect(html).toContain("data-screen-place-select");
    expect(html).not.toContain("rounded-2xl border border-hairline/40 bg-card");
    expect(html).not.toContain("Pepper is using the browser ·");
  });

  it("shows the empty Browse with state when connected with no frame", () => {
    const html = renderToStaticMarkup(createElement(LiveBrowserView, base()));
    expect(html).toContain("data-browser-empty");
    expect(html).toContain("Browse with Pepper");
  });

  it("puts Take control in the shared top row, not on the address row, while the bot has the browser", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(LiveBrowserView, base({
      frame: { seq: 1, data: "x", viewerId: "v1", generation: 1 },
    })));
    const take = host.querySelector('[data-browser-holder="bot"][data-browser-take]')!;
    expect(take.textContent).toBe("Take control");
    expect(take.getAttribute("title")).toBe("Pepper is using the browser");
    expect(take.closest("[data-screen-panel-bar]")).not.toBeNull();
    expect(host.querySelector("[data-browser-address-row] [data-screen-control]")).toBeNull();
    expect(host.querySelector("[data-browser-address-row] [data-screen-place-select]")).toBeNull();
    expect(host.innerHTML).not.toContain("min-h-10 items-center gap-2 border-b border-hairline/40 px-3");
  });

  it("says You have control on the same switch while the person drives, and hands back from it", () => {
    const handBack = vi.fn();
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(LiveBrowserView, base({
      frame: { seq: 1, data: "x", viewerId: "v1", generation: 1 },
      control: { held: true, controlling: true, owned: true },
      mine: true,
      handBack,
    })));
    const mine = host.querySelector('[data-browser-holder="you"][data-browser-give-back]')!;
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(mine.textContent).toBe("You have control");
    expect(mine.getAttribute("title")).toBe("Give back control");
    expect(host.querySelectorAll("[data-screen-control]")).toHaveLength(1);
  });

  it("keeps a full-width left-aligned address field", () => {
    const html = renderToStaticMarkup(createElement(LiveBrowserView, base({
      addressBar: { ...base().addressBar, value: "https://example.com" },
      frame: { seq: 1, data: "x", viewerId: "v1", generation: 1 },
    })));
    expect(html).toMatch(/value="https:\/\/example.com"/);
    expect(html).toContain("text-left");
    expect(html).not.toContain("text-center text-[12px]");
  });
});

describe("compact LiveBrowserView sizes, the app's own (M-20261127-179)", () => {
  const classes = (value: string | null | undefined) => (value ?? "").split(/\s+/).filter(Boolean);
  const parse = (over: Partial<LiveBrowserViewProps> = {}) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(LiveBrowserView, base({
      frame: { seq: 1, data: "x", viewerId: "v1", generation: 1 },
      tabs: [{ tabId: "t1", title: "Google", url: "https://www.google.com/", active: true }, { tabId: "t2", title: "Docs", url: "https://example.com/", active: false }],
      addressBar: { ...base().addressBar, value: "https://www.google.com/" },
      ...over,
    })));
    return host;
  };
  const glyph = (element: Element) => {
    const svg = element.querySelector("svg")!;
    return { size: Number(svg.getAttribute("width")), strokeWidth: Number(svg.getAttribute("stroke-width")) };
  };

  it("draws every round control as the chat header's: CIRCLE_BUTTON with the CIRCLE_ICON glyph", () => {
    const host = parse();
    const round = [...host.querySelectorAll("[data-browser-tabs] > button, [data-browser-address-row] button:not([role=menuitem]), [data-browser-address-row] summary")];
    // + (new tab); back, forward, reload; profiles; the menu
    expect(round.length).toBeGreaterThanOrEqual(5);
    for (const element of round) {
      expect(classes(element.getAttribute("class")), element.outerHTML.slice(0, 120)).toEqual(expect.arrayContaining(classes(CIRCLE_BUTTON)));
      expect(glyph(element)).toEqual(CIRCLE_ICON);
    }
  });

  it("draws Take control as the 36px labelled chip that folds on a narrow bar", () => {
    for (const over of [{}, { control: { held: true, controlling: true, owned: true }, mine: true }]) {
      const chip = parse(over).querySelector("[data-screen-control]")!;
      const list = classes(chip.getAttribute("class"));
      expect(list).toEqual(expect.arrayContaining(classes(CIRCLE_LABEL_BUTTON).filter((name) => !/^(bg|text|border|hover:bg)-/.test(name))));
      expect(list).toEqual(expect.arrayContaining(classes(FOLD_CHIP)));
      expect(classes(chip.querySelector("span")!.getAttribute("class"))).toEqual(expect.arrayContaining(classes(FOLD_CHIP_LABEL)));
      expect(glyph(chip)).toEqual(CIRCLE_ICON);
    }
  });

  it("draws the page tabs as the 36px labelled chip, in the app's 13px type", () => {
    const host = parse();
    const tabs = [...host.querySelectorAll("[data-browser-tab]")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      const list = classes(tab.getAttribute("class"));
      expect(list).toEqual(expect.arrayContaining(["h-9", "rounded-full", "text-[13px]", "leading-[18px]"]));
      expect(classes(tab.querySelector("button[aria-label]")!.getAttribute("class"))).toContain("ui-icon-button");
      const select = tab.querySelector("button[data-browser-tab-title]")!;
      expect(classes(select.getAttribute("class"))).toContain("self-stretch");
      expect(select.querySelector("svg")).not.toBeNull();
    }
    expect(classes(CIRCLE_LABEL)).toEqual(expect.arrayContaining(["h-9", "rounded-full", "border-circle-ring", "bg-circle", "text-[13px]", "leading-[18px]"]));
    const take = host.querySelector("[data-browser-take]")!;
    expect(classes(take.getAttribute("class"))).toEqual(expect.arrayContaining(["h-9", "rounded-full", "text-[13px]", "bg-accent", "text-accent-ink"]));
    expect(CIRCLE_LABEL_BUTTON.startsWith(CIRCLE_LABEL)).toBe(true);
  });

  it("uses the app's field for the address and the frame's header height for the shared top row", () => {
    const host = parse();
    expect(classes(host.querySelector("[data-browser-address-row] input")!.getAttribute("class"))).toEqual(expect.arrayContaining(classes(PLAIN_FIELD)));
    expect(classes(host.querySelector("[data-screen-panel-bar]")!.getAttribute("class"))).toEqual(expect.arrayContaining(classes(SCREEN_PANEL_TOP_ROW)));
    expect(SCREEN_PANEL_TOP_ROW).toContain("content-topbar");
    expect(SCREEN_PANEL_TOP_ROW).toContain("min-h-(--app-topbar-height)");
    expect(host.querySelector(".content-card-body")).not.toBeNull();
    const row = host.querySelector("[data-browser-address-row]")!;
    expect(classes(row.getAttribute("class"))).toContain("group/screenbar");
    // no fold before the row is measured: every label shows
    expect(row.getAttribute("data-fold")).toBe("none");
    expect(host.querySelector("[data-browser-address-row] input")!.hasAttribute("data-screen-bar-flex")).toBe(true);
  });

  it("keeps no undersized control or type in the two rows", () => {
    for (const over of [{}, { control: { held: true, controlling: true, owned: true }, mine: true }, { tabs: [] }]) {
      const host = parse(over);
      const rows = [...host.querySelectorAll("[data-screen-panel-bar], [data-browser-address-row]")].map((row) => {
        const copy = row.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("[role=menu]").forEach((menu) => menu.remove());
        // a tab's own close is the app's 28px icon button (ui-icon-button), its glyph 14px
        copy.querySelectorAll("[data-browser-tab] button.ui-icon-button svg").forEach((svg) => svg.remove());
        return copy.outerHTML;
      }).join("");
      expect(rows).not.toMatch(/\bsize-7\b|text-\[1[01](\.5)?px\]|text-\[12px\]|\bh-7\b/);
      expect(rows).not.toMatch(/width="1[1-5]"/);
    }
  });
});
