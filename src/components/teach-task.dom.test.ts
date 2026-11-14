// @vitest-environment happy-dom
// #4208, end to end in the renderer: the message bar's Teach a task >
// "Show it in the browser" opens the bot's panel on Activity, whose Computer
// section opens its one screen window on the bot's browser with teaching on,
// and the recording starts there (record-start). Before #4208 it opened the
// old computer side panel and handed the recording over through it: a bot
// shown on its screen there never started recording.
// Every other link to the bot's computer (the panel's restore, a sign-in
// card's Open) lands on that same window, never a side panel.
import { act, createElement, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action, Bot, ConfigStatus } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode, useAdvancedMode } from "@/lib/interface-mode";
import { editBotFixture } from "@/gallery/edit-bot-api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
// My Chrome's recorder is not offered here (its status answers no).
vi.mock("@/lib/my-chrome", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/my-chrome")>(),
  myChromeCall: () => Promise.resolve({ offered: false }),
}));

/** The browser stream: each live view's listeners, so a test can say "ready". */
const streams: FixtureEventSource[] = [];
class FixtureEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  constructor(readonly url: string) { streams.push(this); }
  close() {}
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  removeEventListener() {}
  emit(name: string, data: unknown) {
    for (const listener of this.listeners.get(name) ?? []) listener({ data: JSON.stringify(data) });
  }
}

const fixture = editBotFixture(false);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Every browser action the window posted, in order. */
let browserActions: Array<Record<string, unknown>> = [];

const { StoreProvider, useStore } = await import("@/state/store");
const { BotSettingsDialog } = await import("./BotSettingsDialog");
const { TeachChooserDialog } = await import("./TeachStepsDialog");
const { useComposerCommands } = await import("./Composer.tsx-parts/useComposerCommands");
const { api } = await import("@/state/store");
const { useSimplePanels } = await import("@/App.tsx-parts/useSimplePanels");

/** A server where this person can open the bot's built-in browser. */
const teachConfig = { features: { browser: true, skillAuthoring: true }, browserEngine: { kind: "engine" } } as unknown as ConfigStatus;

let dispatch: (action: Action) => void;
let computerOpen = () => false;

/** The message bar's Teach a task choice, wired as the composer wires it. */
function ComposerTeach({ bot }: { bot: Bot }) {
  const { dispatch: dispatchNow } = useStore();
  const anchor = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commands = useComposerCommands({
    text: "", caret: 0, setCaret: () => {}, editText: () => {}, setChannelMode: () => {},
    bot, storeBots: [bot], config: teachConfig, instances: [], routines: [], ownerOrAdmin: true, remoteClient: false,
    threadId: bot.threadId, api, dispatch: dispatchNow, dismissedAt: null, setDismissedAt: () => {},
    dismissedSlashAt: null, setDismissedSlashAt: () => {}, inputRef, mentionListRef: listRef, commandListRef: listRef,
  });
  return createElement("div", null,
    createElement("button", { ref: anchor, type: "button", "data-composer-plus": "" }, "+"),
    createElement(TeachChooserDialog, {
      botName: bot.name,
      anchorRef: anchor,
      onShow: commands.browserTeach ? commands.showInBrowser : undefined,
      onClose: () => {},
    }),
  );
}

function Shell({ teach }: { teach: boolean }) {
  const { state, dispatch: dispatchNow } = useStore();
  dispatch = dispatchNow;
  computerOpen = () => state.computerOpen;
  // the shell's Simple rule, as the app runs it (useShellEffects)
  useSimplePanels(useAdvancedMode(), state.inspectorOpen, dispatchNow);
  const { bot, neighbours } = fixture;
  useEffect(() => {
    dispatchNow({ type: "hydrate", bots: [{ ...bot, browser: true }, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    dispatchNow({ type: "select", id: bot.id } as never);
  }, []);
  const current = state.bots.find((candidate) => candidate.id === bot.id);
  if (!current) return null;
  return createElement("div", null,
    teach ? createElement(ComposerTeach, { bot: current }) : null,
    // the shell's bot panel: open for settings or for the bot's computer
    state.settingsOpen || state.computerOpen ? createElement(BotSettingsDialog, { bot: current }) : null,
  );
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeAll(() => {
  setLocale("en");
  setAdvancedMode(true);
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    if (/\/api\/bots\/[^/]+\/browser\/action$/.test(url.pathname)) {
      browserActions.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return Promise.resolve(json({ ok: true }));
    }
    return Promise.resolve(fixture.answer(url.pathname) ?? json({ error: "not in this gallery" }, 404));
  });
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  browserActions = [];
  streams.length = 0;
  act(() => root.unmount());
  host.remove();
});

async function mount(teach = true) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell, { teach }))); });
  await settle();
}

const browserStream = () => streams.find((stream) => stream.url.endsWith("/browser/live"));

describe("Teach a task, shown in the browser (#4208)", () => {
  it("opens the Computer section's screen window on the bot's browser and starts recording", async () => {
    await mount();
    const show = document.querySelector<HTMLButtonElement>("button[data-teach-show]");
    expect(show, "the chooser offers Show it in the browser").not.toBeNull();
    expect(document.querySelector("[data-bot-panel-computer]")).toBeNull();

    await act(async () => { show!.click(); });
    await settle();

    // the bot panel is open on Activity with its Computer section, no side panel
    expect(computerOpen()).toBe(true);
    expect(document.querySelector("[data-bot-panel-computer]")).toBeNull();
    expect(document.querySelector('[data-panel-tab="activity"][aria-selected="true"]')).not.toBeNull();
    expect(document.querySelector('[data-bot-settings-section="computer"]')).not.toBeNull();
    // the one screen window, on the bot's browser
    const stream = browserStream();
    expect(stream, "the window connects to the bot's browser").toBeDefined();
    expect(document.querySelectorAll("[data-browser-holder]")).toHaveLength(1);

    // the browser is ready: the recording starts at once, with no other click
    await act(async () => { stream!.emit("ready", { viewerId: "viewer-1" }); });
    await settle();
    expect(browserActions.map((body) => body.type)).toContain("record-start");
    expect(browserActions.find((body) => body.type === "record-start")?.viewerId).toBe("viewer-1");
    // the reference's recording bar: Stop with the elapsed time, and Discard
    expect(document.querySelector("[data-teach-recording] [data-teach-stop]")?.textContent).toMatch(/^0:0\d$/);
    expect(document.querySelector("[data-teach-recording] [data-teach-discard]")).not.toBeNull();
    expect(document.querySelector("[data-recording-frame]")).not.toBeNull();
  });

  it("works the same in Simple: the window stays open and the recording starts", async () => {
    // Before, the shell closed the bot's computer as soon as Simple was on,
    // so the window closed in the next render: no window, no recording.
    setAdvancedMode(false);
    try {
      await mount();
      await act(async () => { document.querySelector<HTMLButtonElement>("button[data-teach-show]")!.click(); });
      await settle();
      expect(computerOpen()).toBe(true);
      const stream = browserStream();
      expect(stream, "the window connects to the bot's browser").toBeDefined();
      await act(async () => { stream!.emit("ready", { viewerId: "viewer-1" }); });
      await settle();
      expect(computerOpen()).toBe(true);
      expect(browserActions.map((body) => body.type)).toContain("record-start");
      expect(document.querySelector("[data-teach-recording] [data-teach-stop]")).not.toBeNull();
    } finally {
      setAdvancedMode(true);
    }
  });

  it("opens only one screen window for the bot, whoever asks (no second browser view)", async () => {
    await mount();
    await act(async () => { document.querySelector<HTMLButtonElement>("button[data-teach-show]")!.click(); });
    await settle();
    // the Computer row asked again while the window is open: still one window
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-computer-card]")?.click(); });
    await settle();
    expect(streams.filter((stream) => stream.url.endsWith("/browser/live"))).toHaveLength(1);
    expect(document.querySelectorAll("[data-browser-holder]")).toHaveLength(1);
  });

  it("closing the window leaves the bot panel open on Activity, not a side panel", async () => {
    await mount();
    await act(async () => { document.querySelector<HTMLButtonElement>("button[data-teach-show]")!.click(); });
    await settle();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    expect(computerOpen()).toBe(false);
    expect(document.querySelector('[data-bot-settings-section="computer"]')).not.toBeNull();
    expect(document.querySelector("[data-teach-recording]")).toBeNull();
  });

  it("a bot panel reopened on its computer lands on the Computer section's window", async () => {
    await mount(false);
    await act(async () => { dispatch({ type: "toggleComputer", open: true }); });
    await settle();
    expect(document.querySelector("[data-bot-panel-computer]")).toBeNull();
    expect(document.querySelector('[data-bot-settings-section="computer"]')).not.toBeNull();
    await act(async () => { dispatch({ type: "rememberBotPanel" }); dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); });
    await settle();
    await act(async () => { dispatch({ type: "restoreBotPanel" }); });
    await settle();
    expect(computerOpen()).toBe(true);
    expect(document.querySelector("[data-bot-panel-computer]")).toBeNull();
    expect(document.querySelector('[data-panel-tab="activity"][aria-selected="true"]')).not.toBeNull();
  });
});
