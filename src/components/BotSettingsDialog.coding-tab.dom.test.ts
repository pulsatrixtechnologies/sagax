// @vitest-environment happy-dom
// JC 2026-11-06 (hotfix 0.8.57): the bot panel's Coding tab. It shows only
// while this bot's coding chat is the open conversation, comes forward when
// that chat opens, holds the coding window's session and dev pods (portalled
// by CodingChat into its host), and goes away as soon as the chat is left,
// the panel falling back to Activity. Connectors stay in Activity.
import { act, createElement, useEffect } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { useCodingPanelHost } from "@/lib/coding-panel-host";
import { editBotFixture } from "@/gallery/edit-bot-api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));

class FixtureEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const fixture = editBotFixture(false);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const { StoreProvider, useStore } = await import("@/state/store");
const { BotSettingsDialog } = await import("./BotSettingsDialog");

/** Stands in for CodingChat's portals: the session card and a pod into the
 * Coding tab, the Connectors pod into Activity. */
function CodingWindowStandIn({ botId }: { botId: string }) {
  const coding = useCodingPanelHost(botId);
  const activity = useCodingPanelHost(botId, "activity");
  return createElement("div", null,
    coding ? createPortal(createElement("section", { "data-test-session": "" }, "This session"), coding) : null,
    coding ? createPortal(createElement("section", { "data-test-pod": "environment" }, "Environment"), coding) : null,
    activity ? createPortal(createElement("section", { "data-test-pod": "connectors" }, "Connectors"), activity) : null,
  );
}

let dispatch: (action: Action) => void;
function Shell() {
  const { state, dispatch: dispatchNow } = useStore();
  dispatch = dispatchNow;
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs: [] } as never);
    dispatch({ type: "select", id: bot.id } as never);
  }, []);
  const current = state.bots.find((candidate) => candidate.id === bot.id);
  if (!current) return null;
  return createElement("div", { "data-edit-bot-panel": "" },
    createElement(BotSettingsDialog, { bot: current }),
    state.codingChat ? createElement(CodingWindowStandIn, { botId: state.codingChat.botId }) : null,
  );
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const tabs = () => [...host.querySelectorAll<HTMLElement>("[data-bot-panel-tabs] [data-panel-tab]")].map((tab) => tab.dataset.panelTab);
const selected = () => host.querySelector<HTMLElement>('[data-bot-panel-tabs] [data-panel-tab][aria-selected="true"]')?.dataset.panelTab;
const openCoding = async () => {
  await act(async () => { dispatch({ type: "openCodingChat", target: { botId: fixture.bot.id, itemId: "thread:t1", threadId: "t1" } } as never); });
  await settle();
};

beforeAll(() => {
  setLocale("en");
  setAdvancedMode(true);
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    return Promise.resolve(fixture.answer(url.pathname) ?? json({ error: "not in this gallery" }, 404));
  });
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell))); });
  await settle();
}

describe("bot panel Coding tab (JC 2026-11-06)", () => {
  it("is absent outside a coding chat", async () => {
    await mount();
    expect(tabs()).toEqual(["activity", "library"]);
    expect(host.querySelector("[data-bot-panel-coding]")).toBeNull();
    expect(host.querySelector("[data-coding-panel-host]")).toBeNull();
  });

  it("shows in a coding chat, comes forward, and holds the session and the coding pods", async () => {
    await mount();
    await openCoding();
    expect(tabs()).toEqual(["activity", "library", "coding"]);
    expect(selected()).toBe("coding");
    const codingTab = host.querySelector<HTMLElement>('[data-panel-tab="coding"]')!;
    expect(codingTab.textContent).toBe("Coding");
    const body = host.querySelector<HTMLElement>("[data-bot-panel-coding]")!;
    expect(body).not.toBeNull();
    expect(body.querySelector("[data-coding-panel-host] [data-test-session]")?.textContent).toBe("This session");
    expect(body.querySelector('[data-test-pod="environment"]')).not.toBeNull();
    expect(body.querySelector('[data-test-pod="connectors"]')).toBeNull();
    // Activity no longer carries the session: only Connectors stay there.
    await act(async () => { host.querySelector<HTMLElement>('[data-panel-tab="activity"]')!.click(); });
    await settle();
    expect(host.querySelector("[data-bot-panel-coding]")).toBeNull();
    expect(host.querySelector("[data-test-session]")).toBeNull();
    expect(host.querySelector('[data-test-pod="environment"]')).toBeNull();
    expect(host.querySelector('[data-coding-activity-host] [data-test-pod="connectors"]')).not.toBeNull();
  });

  it("goes away when the coding chat is left, falling back to Activity", async () => {
    await mount();
    await openCoding();
    expect(selected()).toBe("coding");
    await act(async () => { dispatch({ type: "closeCodingChat" } as never); });
    await settle();
    expect(tabs()).toEqual(["activity", "library"]);
    expect(selected()).toBe("activity");
    expect(host.querySelector("[data-bot-panel-coding]")).toBeNull();
  });

  it("goes away on a conversation change", async () => {
    await mount();
    await openCoding();
    expect(tabs()).toContain("coding");
    await act(async () => { dispatch({ type: "select", id: fixture.neighbours[0]!.id } as never); });
    await settle();
    expect(tabs()).toEqual(["activity", "library"]);
    expect(selected()).toBe("activity");
  });
});
