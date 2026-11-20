// @vitest-environment happy-dom
// M-20261119-082 (the owner, 2026-11-19): the bot panel's gear (Activity,
// Library) opens the bot's page on General with nothing over it. It used to
// ask for the Appearance section, which since the Appearance tab became a
// modal opened the mascot editor over the page at once.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
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

let editor: { botId: string; section: string } | null = null;
function Shell() {
  const { state, dispatch } = useStore();
  editor = state.personaEditor as typeof editor;
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    const send = dispatch as (action: Action) => void;
    send({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    send({ type: "routinesHydrated", routines, runs: [] } as never);
    send({ type: "select", id: bot.id } as never);
  }, []);
  const current = state.bots.find((candidate) => candidate.id === bot.id);
  return current ? createElement(BotSettingsDialog, { bot: current }) : null;
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

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

describe("bot panel gear", () => {
  it("opens the bot's page on its overview, never on Appearance", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell))); });
    await settle();
    const gear = host.querySelector<HTMLElement>("[data-bot-panel-gear]");
    expect(gear).not.toBeNull();
    await act(async () => { gear!.click(); });
    await settle();
    expect(editor?.botId).toBe(fixture.bot.id);
    expect(editor?.section).toBe("overview");
    expect(editor?.section).not.toBe("appearance");
  });
});
