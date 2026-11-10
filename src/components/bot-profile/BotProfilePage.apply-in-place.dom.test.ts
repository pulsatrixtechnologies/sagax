// @vitest-environment happy-dom
// #3397: every change on a sub-page of the bot page applies in place, at
// once, as on the Settings pages (the reference app has no Cancel and no
// Save on the bot profile). No sub-page ends with a save bar, and leaving a
// sub-page after a change asks nothing. Versions is the way back.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action } from "@/state/store";
import { setLocale, t } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { editBotFixture } from "@/gallery/edit-bot-api";
import { BOT_PROFILE_SUBPAGES, botProfileTabOfPage, type BotProfileSubPage } from "@/lib/persona-sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("../DesktopCapabilities")>(),
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


let fixture = editBotFixture(true);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const { StoreProvider, useStore } = await import("@/state/store");
const { PersonaEditorModal } = await import("../persona/PersonaEditorModal");

let dispatch: (action: Action) => void;
let storeBot: () => unknown;
function Shell() {
  const { state, dispatch: dispatchNow } = useStore();
  dispatch = dispatchNow;
  storeBot = () => JSON.stringify(state.bots.find((b) => b.id === fixture.bot.id));
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    // a server with spoken replies: the Voice sub-page has its voice rows (#3398: "Notify me" moved to General)
    dispatch({ type: "configStatus", config: { tts: { configured: false } } } as never);
    dispatch({ type: "routinesHydrated", routines, runs: [] } as never);
    dispatch({ type: "instances", instances: [{ instanceId: "claude", driverKind: "grokAgent", displayName: "Grok", snapshot: { status: "ready" }, capabilities: { browserMcp: true, computerMcp: true }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }] } }] } as never);
    dispatch({ type: "select", id: bot.id } as never);
  }, []);
  return createElement(PersonaEditorModal);
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeAll(async () => {
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

async function mount(locale: "en" | "fr") {
  setLocale(locale);
  fixture = editBotFixture(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell))); });
  await settle();
}

const click = async (node: HTMLElement | null, what: string) => {
  if (!node) throw new Error(`nothing to click: ${what}`);
  await act(async () => { node.click(); });
  await settle();
};

/** Opens a sub-page from its row and returns it. */
async function openSub(page: BotProfileSubPage): Promise<HTMLElement> {
  if (!host.querySelector("[data-persona-modal]")) {
    await act(async () => { dispatch({ type: "openPersonaEditor", botId: fixture.bot.id, section: "overview" } as never); });
    await settle();
  }
  const back = host.querySelector<HTMLElement>("[data-bot-profile-back]");
  if (back) await click(back, "Back");
  await click(host.querySelector<HTMLElement>(`[data-bot-profile-tab="${botProfileTabOfPage(page)}"]`), "tab");
  await click(host.querySelector<HTMLElement>(`[data-bot-profile-subpage-open="${page}"]`), `row ${page}`);
  return host.querySelector<HTMLElement>(`[data-bot-profile-subpage="${page}"]`)!;
}

// "Voice notes" stays on the Voice sub-page ("Notify me" moved in place to
// General > Settings, #3398).
const notesSwitch = (sub: HTMLElement) =>
  sub.querySelector<HTMLElement>(`[role='switch'][aria-label="${t("botPanel.voice.notesAria")}"]`);
const voiceNotes = () => (JSON.parse(storeBot() as string) as { voiceNotes?: boolean }).voiceNotes !== false;

describe("bot page sub-pages apply each change in place (#3397)", () => {
  it("Voice > Voice notes writes the bot at once, with no Save step", async () => {
    await mount("en");
    const sub = await openSub("voice");
    const toggle = notesSwitch(sub);
    expect(toggle, "the Voice notes switch").not.toBeNull();
    const was = voiceNotes();
    await click(toggle, "Voice notes");
    // The workspace's bot has the change right away: nothing waits.
    expect(voiceNotes()).toBe(!was);
    expect(notesSwitch(host.querySelector<HTMLElement>("[data-bot-profile-subpage=\"voice\"]")!)?.getAttribute("aria-checked")).toBe(String(!was));
  });

  it("no sub-page ends with a Cancel and Save bar", async () => {
    await mount("fr");
    for (const page of BOT_PROFILE_SUBPAGES) {
      const sub = await openSub(page);
      if (!sub) continue;
      expect(sub.querySelector("[data-bot-profile-savebar]"), `save bar on ${page}`).toBeNull();
    }
  });

  it("Escape after a change returns to the row, with no question", async () => {
    await mount("en");
    const sub = await openSub("voice");
    await click(notesSwitch(sub), "Voice notes");
    const page = host.querySelector<HTMLElement>("[data-bot-profile-page]")!;
    // No confirm provider here: a discard question would fail closed and
    // keep the sub-page open.
    await act(async () => {
      page.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(host.querySelector("[data-bot-profile-subpage]")).toBeNull();
    expect(host.querySelector('[data-bot-profile-row="page-voice"]')).not.toBeNull();
  });
});
