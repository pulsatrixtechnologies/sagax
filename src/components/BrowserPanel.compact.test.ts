// @vitest-environment happy-dom
// Compact docked browser chrome (M-20261127-064): two rows, editable URL,
// status pill, Take control, empty state, no framed card. Its sizes are the
// app's own (M-20261127-179): pinned here by the shared classes they use.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveBrowserView, type LiveBrowserViewProps } from "./BrowserPanel.tsx-parts/LiveBrowserView";
import { CIRCLE_BUTTON, CIRCLE_ICON, CIRCLE_LABEL, CIRCLE_LABEL_BUTTON } from "@/lib/circle-button";
import { PLAIN_FIELD } from "./SettingsPrimitives";
import { SCREEN_PANEL_TOP_ROW } from "./ScreenPanelChrome";
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
        "browser.panel.browseWith": `Browse with ${vars?.name ?? ""}`,
        "browser.panel.browseWithHint": "Open a page in the address bar, or let the bot navigate.",
        "browser.live.opening": "Opening the live browser…",
      };
      return table[key] ?? key;
    },
  };
});

const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;
const ref = <T,>(value: T) => ({ current: value });

function base(over: Partial<LiveBrowserViewProps> = {}): LiveBrowserViewProps {
  return {
    bot,
    allowed: true,
    frame: null,
    tabs: [],
    address: "",
    setAddress: vi.fn(),
    connected: true,
    control: { held: false, controlling: false, owned: false },
    pending: false,
    error: "",
    showProfiles: false,
    setShowProfiles: vi.fn(),
    showTyping: false,
    setShowTyping: vi.fn(),
    masked: false,
    setMasked: vi.fn(),
    takeControl: vi.fn(),
    handBack: vi.fn(),
    viewport: { width: 800, height: 600 },
    takeStatus: "",
    busy: false,
    reconnecting: false,
    showNetwork: false,
    setShowNetwork: vi.fn(),
    recording: false,
    recordingStartedAt: null,
    taught: undefined,
    setTaught: vi.fn(),
    teachNote: "",
    addressInput: ref(null),
    profilesButton: ref(null),
    profilesPopover: ref(null),
    typingPopover: ref(null),
    typingField: ref(null),
    menuSummary: ref(null),
    profileName: "own",
    interactive: true,
    typingReady: false,
    commandsReady: true,
    heldElsewhere: false,
    taking: false,
    mine: false,
    pageTitle: "",
    holder: "Pepper is using the browser",
    pill: "pill",
    generation: ref(1),
    viewer: ref("v1"),
    browserControl: ref(null),
    urlEditing: ref(false),
    command: vi.fn(),
    input: vi.fn(),
    reconnect: vi.fn(),
    execute: vi.fn(async () => {}),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => {}),
    discardRecording: vi.fn(async () => {}),
    action: vi.fn(async () => ({})),
    confirm: vi.fn(async () => true),
    setError: vi.fn(),
    docked: {
      title: "Pepper’s browser",
      chrome: createElement("div", { "data-screen-panel-chrome": "" }, "chrome"),
      placeSelector: createElement("div", { "data-screen-place-select": "" }, "places"),
    },
    ...over,
  };
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

  it("puts Take control on the address row while the bot has the browser", () => {
    const html = renderToStaticMarkup(createElement(LiveBrowserView, base({
      frame: { seq: 1, data: "x", viewerId: "v1", generation: 1 },
    })));
    expect(html).toContain('data-browser-holder="bot"');
    expect(html).toContain("data-browser-take");
    expect(html).toContain("Take control");
    expect(html).not.toContain("min-h-10 items-center gap-2 border-b border-hairline/40 px-3");
  });

  it("keeps a full-width left-aligned address field", () => {
    const html = renderToStaticMarkup(createElement(LiveBrowserView, base({
      address: "https://example.com",
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
      address: "https://www.google.com/",
      ...over,
    })));
    return host;
  };
  const glyph = (element: Element) => {
    const svg = element.querySelector("svg")!;
    return { size: Number(svg.getAttribute("width")), strokeWidth: Number(svg.getAttribute("stroke-width")) };
  };

  it("draws every round control as the chat header's: CIRCLE_BUTTON with the CIRCLE_ICON glyph", () => {
    for (const over of [{}, { control: { held: true, controlling: true, owned: true } }]) {
      const host = parse(over);
      const round = [...host.querySelectorAll("[data-browser-tabs] > div > button, [data-browser-address-row] button:not([data-browser-take]):not([role=menuitem]), [data-browser-address-row] summary")];
      // + (new tab); back, forward, reload; give back while held; profiles; the menu
      expect(round.length).toBeGreaterThanOrEqual(6);
      for (const element of round) {
        expect(classes(element.getAttribute("class")), element.outerHTML.slice(0, 120)).toEqual(expect.arrayContaining(classes(CIRCLE_BUTTON)));
        expect(glyph(element)).toEqual(CIRCLE_ICON);
      }
    }
  });

  it("keeps the holder chip on screen in every state: its label folds, the chip never goes", () => {
    for (const control of [{ held: false, controlling: false, owned: false }, { held: true, controlling: true, owned: true }]) {
      const chip = parse({ control }).querySelector("[data-browser-holder-pill]")!;
      const list = classes(chip.getAttribute("class"));
      expect(list.some((name) => /(^|:)hidden$/.test(name))).toBe(false);
      expect(list).toContain("group-data-[fold=all]/screenbar:w-9");
      expect(classes(chip.querySelector("span")!.getAttribute("class"))).toContain("group-data-[fold=all]/screenbar:sr-only");
    }
  });

  it("draws the page tabs, the holder and Take control as the 36px labelled chip, in the app's 13px type", () => {
    const host = parse();
    const tabs = [...host.querySelectorAll("[data-browser-tab]")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      const list = classes(tab.getAttribute("class"));
      expect(list).toEqual(expect.arrayContaining(["h-9", "rounded-full", "text-[13px]", "leading-[18px]"]));
      expect(classes(tab.querySelector("button[aria-label]")!.getAttribute("class"))).toContain("ui-icon-button");
      // the select button is the whole chip up to the close, globe included
      const select = tab.querySelector("button[data-browser-tab-title]")!;
      expect(classes(select.getAttribute("class"))).toContain("self-stretch");
      expect(select.querySelector("svg")).not.toBeNull();
    }
    expect(classes(CIRCLE_LABEL)).toEqual(expect.arrayContaining(["h-9", "rounded-full", "border-circle-ring", "bg-circle", "text-[13px]", "leading-[18px]"]));
    expect(classes(host.querySelector("[data-browser-holder-pill]")!.getAttribute("class"))).toEqual(expect.arrayContaining(classes(CIRCLE_LABEL).filter((name) => name !== "border-circle-ring" && name !== "bg-circle" && name !== "text-ink")));
    const take = host.querySelector("[data-browser-take]")!;
    expect(classes(take.getAttribute("class"))).toEqual(expect.arrayContaining(["h-9", "rounded-full", "text-[13px]", "bg-accent", "text-accent-ink"]));
    expect(CIRCLE_LABEL_BUTTON.startsWith(CIRCLE_LABEL)).toBe(true);
  });

  it("uses the app's field for the address and the frame's header height for the tab row", () => {
    const host = parse();
    expect(classes(host.querySelector("[data-browser-address-row] input")!.getAttribute("class"))).toEqual(expect.arrayContaining(classes(PLAIN_FIELD)));
    expect(classes(host.querySelector("[data-browser-tabs]")!.getAttribute("class"))).toEqual(expect.arrayContaining(classes(SCREEN_PANEL_TOP_ROW)));
    expect(SCREEN_PANEL_TOP_ROW).toContain("min-h-(--app-topbar-height)");
    const row = host.querySelector("[data-browser-address-row]")!;
    expect(classes(row.getAttribute("class"))).toContain("group/screenbar");
    // no fold before the row is measured: every label shows
    expect(row.getAttribute("data-fold")).toBe("none");
    expect(host.querySelector("[data-browser-address-row] input")!.hasAttribute("data-screen-bar-flex")).toBe(true);
  });

  it("keeps no undersized control or type in the two rows", () => {
    for (const over of [{}, { control: { held: true, controlling: true, owned: true } }, { tabs: [] }]) {
      const host = parse(over);
      const rows = [...host.querySelectorAll("[data-browser-tabs], [data-browser-address-row]")].map((row) => {
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
