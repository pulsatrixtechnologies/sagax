// @vitest-environment happy-dom
// Compact docked browser chrome (M-20261127-064): two rows, editable URL,
// status pill, Take control, empty state, no framed card.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveBrowserView, type LiveBrowserViewProps } from "./BrowserPanel.tsx-parts/LiveBrowserView";
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
