// @vitest-environment happy-dom
// The windows that hold a bot's avatar, mounted for real: the bot panel
// (BotSettingsDialog) and the New bot window (LocalNewBotDialog). One rule for
// Escape (docs/mascots.md, "Turned by hand: every gesture"): a key the mascot
// took is taken, and the window around it leaves it alone; with nothing to
// cancel the key closes what it closed before. Rows G41 to G43 and G49.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { loadAllBakedStills } from "@/components/shape-stills";
import type { Bot } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));

class FixtureEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const { StoreProvider, BotEditorStore, initialState } = await import("@/state/store");
const { BotSettingsDialog } = await import("./BotSettingsDialog");
const NewBotWindow = (await import("./NewBotDialog")).LocalNewBotDialog as (props: { onClose: () => void }) => ReturnType<typeof import("./NewBotDialog").LocalNewBotDialog>;

const look = { character: "shape", shape: "cup", motion: "reduced" };
const nimbus = {
  id: "nimbus", threadId: "t-nimbus", name: "Nimbus", title: "Research", description: "", notifications: true, color: "green", unread: false,
  mascotLook: look, messages: [], tasks: [], computer: "local", modelSelection: { instanceId: "x", model: "x" },
} as unknown as Bot;

let host: HTMLDivElement;
let root: Root;
const settle = async (turns = 12) => { for (let i = 0; i < turns; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const avatar = () => host.querySelector<HTMLButtonElement>("[data-avatar-edit]")!;
const viewOf = () => avatar().querySelector("[data-shape]")?.getAttribute("data-shape-view") ?? null;
const stateOf = () => avatar().querySelector("[data-shape]")?.getAttribute("data-agent-state") ?? null;
const reset = () => host.querySelector<HTMLButtonElement>("[data-mascot-turn-reset]")!;
const popover = () => document.querySelector<HTMLElement>("[data-mascot-picker-popover]");
const key = async (node: HTMLElement, name: string) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  await act(async () => { node.dispatchEvent(event); });
  return event;
};
const mount = async (element: ReturnType<typeof createElement>) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(element); });
  for (let tick = 0; tick < 100 && !host.querySelector("[data-avatar-edit] [data-shape]"); tick += 1) await settle(1);
  expect(avatar(), "the avatar is drawn").not.toBeNull();
};

beforeAll(async () => {
  setLocale("en");
  await loadAllBakedStills();
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    if (url.pathname === "/api/bot-defaults") {
      return Promise.resolve(json({
        defaults: { profile: { name: "Ada", color: "green", description: "", title: "", mascotLook: look }, settings: {}, memory: {}, skills: [], routines: [] },
        modelSelection: { instanceId: "x", model: "x" }, suggestedName: "Ada",
      }));
    }
    if (url.pathname === "/api/config") return Promise.resolve(json({ profile: { name: "Ada" }, features: {}, onboarding: { completedAt: 1, launchMode: "solo" }, viewer: { canCreateBots: true, botsReadOnly: false, operator: true, role: "owner" } }));
    if (url.pathname === "/api/bot-presets") return Promise.resolve(json({ presets: [] }));
    if (url.pathname.includes("/task-list")) return Promise.resolve(json({ tasks: [] }));
    if (url.pathname === "/api/instances" || url.pathname === "/api/models") return Promise.resolve(json({ instances: [], models: [] }));
    if (url.pathname === "/api/bots") return Promise.resolve(json({ bots: [] }));
    return Promise.resolve(json({ error: "not in this fixture" }, 404));
  });
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Escape on a turned mascot, in the real windows that hold it", () => {
  it("G49: the bot panel stays open while its avatar has a turn or a previewed state to cancel, and closes on the next Escape", async () => {
    const actions: Array<{ type: string; open?: boolean }> = [];
    const store = {
      state: { ...initialState, bots: [nimbus], groups: [], routines: [], routineRuns: [], routinesLoadState: "ready", selectedId: nimbus.id, settingsOpen: true, config: null },
      dispatch: (action: { type: string; open?: boolean }) => { actions.push(action); },
      flushBotPatches: () => Promise.resolve(nimbus),
    } as never;
    await mount(createElement(BotEditorStore, { value: store, children: createElement(BotSettingsDialog, { bot: nimbus }) }));
    const closes = () => actions.filter((action) => action.type === "toggleSettings" && action.open === false).length;
    avatar().focus();
    await key(avatar(), "ArrowRight");
    expect(viewOf()).toBe("0.2 0");
    expect((await key(avatar(), "Escape")).defaultPrevented).toBe(true);
    expect(viewOf(), "front again").toBeNull();
    expect(closes(), "the panel stays").toBe(0);
    // a previewed state: Escape drops it, the panel stays
    await key(avatar(), "5");
    expect(stateOf()).toBe("blocked");
    await key(avatar(), "Escape");
    expect(stateOf()).toBe("idle");
    expect(closes(), "the panel stays").toBe(0);
    // from the Reset view button too
    await key(avatar(), "ArrowRight");
    reset().focus();
    await key(reset(), "Escape");
    expect(viewOf()).toBeNull();
    expect(closes(), "the panel stays").toBe(0);
    // nothing to cancel: the key is the panel's, as before
    await key(avatar(), "Escape");
    expect(closes(), "the panel closes").toBe(1);
  });

  it("an offer put away by its own Escape takes no later key: the bot panel still closes on Escape", async () => {
    const { OpenAtLoginOffer } = await import("./OpenAtLoginOffer");
    const page = window as unknown as { ogb?: unknown };
    const before = page.ogb;
    page.ogb = { openAtLogin: { get: () => Promise.resolve({ choice: "unset", platform: "darwin" }), set: () => Promise.resolve({ choice: "off", platform: "darwin" }) } };
    // the browser takes a listener off only when asked with the phase it was put on with; this window forgives it
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const captures = (options: unknown) => options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true);
    const held = () => {
      const on = new Set<unknown>();
      for (const [type, listener, options] of add.mock.calls) if (type === "keydown" && captures(options)) on.add(listener);
      for (const [type, listener, options] of remove.mock.calls) if (type === "keydown" && captures(options)) on.delete(listener);
      return on.size;
    };
    try {
      const actions: Array<{ type: string; open?: boolean }> = [];
      const store = {
        state: { ...initialState, bots: [nimbus], groups: [], routines: [], routineRuns: [], routinesLoadState: "ready", selectedId: nimbus.id, settingsOpen: true, config: null },
        dispatch: (action: { type: string; open?: boolean }) => { actions.push(action); },
        flushBotPatches: () => Promise.resolve(nimbus),
      } as never;
      await mount(createElement("div", null, createElement(OpenAtLoginOffer), createElement(BotEditorStore, { value: store, children: createElement(BotSettingsDialog, { bot: nimbus }) })));
      await settle();
      const offer = () => host.querySelector("[data-open-at-login-offer]");
      expect(offer(), "the offer is shown").not.toBeNull();
      const closes = () => actions.filter((action) => action.type === "toggleSettings" && action.open === false).length;
      // the offer takes the first Escape and goes away
      await key(document.body, "Escape");
      await settle(2);
      expect(closes()).toBe(0);
      expect(offer(), "the offer is put away").toBeNull();
      expect(held(), "its key listener is taken off in the phase it was put on in").toBe(0);
      // from then on the key is whoever's it was: the panel closes
      avatar().focus();
      expect((await key(avatar(), "Escape")).defaultPrevented, "the panel took it").toBe(true);
      expect(closes(), "the panel closes").toBe(1);
    } finally {
      add.mockRestore();
      remove.mockRestore();
      page.ogb = before;
    }
  });

  describe("the New bot window", () => {
    const open = async () => {
      const onClose = vi.fn();
      await mount(createElement(StoreProvider, { children: createElement(NewBotWindow, { onClose }) }));
      await settle();
      expect(host.querySelector("[data-mascot-turn]"), "a shape, turned by hand").not.toBeNull();
      return onClose;
    };
    const openPicker = async () => {
      await act(async () => avatar().click());
      await import("./floating-bots/MascotPicker");
      for (let tick = 0; tick < 100 && !document.querySelector("[data-mascot-picker-popover] [data-mascot-picker]"); tick += 1) await settle(1);
      expect(popover()).not.toBeNull();
    };

    it("G41: Escape on its turned avatar brings it back and the window stays; so does a previewed state", async () => {
      const onClose = await open();
      avatar().focus();
      await key(avatar(), "ArrowRight");
      expect(viewOf()).toBe("0.2 0");
      await key(avatar(), "Escape");
      expect(viewOf()).toBeNull();
      expect(onClose, "the window stays").not.toHaveBeenCalled();
      await key(avatar(), "3");
      expect(stateOf()).toBe("working");
      await key(avatar(), "Escape");
      expect(stateOf()).toBe("idle");
      expect(onClose, "the window stays").not.toHaveBeenCalled();
      // nothing to cancel: the key is the window's, as before
      await key(avatar(), "Escape");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("G42: Escape on its avatar facing front, the picker open, closes the picker alone; the next one closes the window", async () => {
      const onClose = await open();
      await openPicker();
      avatar().focus();
      await key(avatar(), "Escape");
      expect(popover(), "the picker closed").toBeNull();
      expect(onClose, "the window stays").not.toHaveBeenCalled();
      await key(avatar(), "Escape");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("G43: Reset view with the picker open, then Escape: the picker closes alone", async () => {
      const onClose = await open();
      await openPicker();
      const picker = popover()!.querySelector("[data-mascot-picker]");
      avatar().focus();
      await key(avatar(), "ArrowRight");
      await act(async () => reset().click());
      expect(viewOf()).toBeNull();
      expect(popover()?.querySelector("[data-mascot-picker]")).toBe(picker);
      expect(document.activeElement).toBe(avatar());
      await key(avatar(), "Escape");
      expect(popover()).toBeNull();
      expect(onClose, "the window stays").not.toHaveBeenCalled();
    });
  });
});
