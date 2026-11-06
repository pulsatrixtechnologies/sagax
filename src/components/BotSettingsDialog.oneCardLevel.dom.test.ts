// @vitest-environment happy-dom
// #2175: the bot panel and the bot profile page keep one card level too.
// Every panel tab and every section of the profile page, solo and in an
// organization, renders on the bot editor gallery's stand-in /api (the data
// they are shot with); every fold is opened; no card surface may sit inside
// another card surface (docs/design/ux-reference-grokbot-cursor.md 2.5). The
// Settings pages have their own guard in SettingsModal.oneCardLevel.dom.test.ts.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action, BotSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { editBotFixture } from "@/gallery/edit-bot-api";
import { PANEL_TABS } from "./bot-settings/panel-tabs";
import { nestedSurfaces, openFolds } from "./settings/nested-surfaces";

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

const SECTIONS: BotSettingsSection[] = ["overview", "appearance", "summary", "details", "soul", "rules", "skills", "memory", "files", "routines", "access", "model", "permissions", "voice", "sharing", "visibility", "history", "usage"];

let fixture = editBotFixture(false);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const { StoreProvider, useStore } = await import("@/state/store");
const { BotSettingsDialog } = await import("./BotSettingsDialog");
const { PersonaEditorModal } = await import("./persona/PersonaEditorModal");

let dispatch: (action: Action) => void;
function Shell({ view }: { view: "panel" | "editor" }) {
  const { state, dispatch: dispatchNow } = useStore();
  dispatch = dispatchNow;
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs: [] } as never);
    dispatch({ type: "instances", instances: [{ instanceId: "claude", driverKind: "grokAgent", displayName: "Grok", snapshot: { status: "ready" }, capabilities: { browserMcp: true, computerMcp: true }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }] } }] } as never);
    dispatch({ type: "select", id: bot.id } as never);
  }, []);
  if (view === "editor") return createElement(PersonaEditorModal);
  const current = state.bots.find((candidate) => candidate.id === bot.id);
  if (!current) return null;
  return createElement("div", { "data-edit-bot-panel": "" }, createElement(BotSettingsDialog, { bot: current }));
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeAll(async () => {
  setLocale("en");
  setAdvancedMode(true);
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    return Promise.resolve(fixture.answer(url.pathname) ?? json({ error: "not in this gallery" }, 404));
  });
  // happy-dom has no layout: every node counts as visible
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(view: "panel" | "editor", org: boolean) {
  fixture = editBotFixture(org);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell, { view }))); });
  await settle();
}

async function unfold(node: HTMLElement) {
  for (let round = 0; round < 4; round += 1) {
    let opened = 0;
    await act(async () => { opened = openFolds(node); });
    await settle();
    if (!opened) break;
  }
}

describe("Bot panel and profile page keep one card level (#2175)", () => {
  for (const org of [false, true]) {
    const where = org ? "in an organization" : "solo";

    it(`${where}: no card inside a card on any panel tab`, async () => {
      await mount("panel", org);
      const hits: string[] = [];
      const empty: string[] = [];
      for (const tab of PANEL_TABS) {
        await act(async () => { dispatch({ type: "pickBotPanelTab", botId: fixture.bot.id, tab } as never); });
        await settle();
        const node = host.querySelector<HTMLElement>("[data-edit-bot-panel]");
        if (!node) throw new Error(`no bot panel for tab ${tab}`);
        await unfold(node);
        if (!node.querySelector("[data-bot-settings-section], [data-pane-section], [data-library], [data-settings-surface], [data-settings-group], [data-settings-card]")) empty.push(tab);
        for (const hit of nestedSurfaces(node)) hits.push(`${tab}\n  outer ${hit.outer}\n  inner ${hit.inner}`);
      }
      expect(empty, "a tab rendered without any section: the guard would check nothing").toEqual([]);
      expect(hits).toEqual([]);
    });

    it(`${where}: no card inside a card on any profile page section`, async () => {
      await mount("editor", org);
      const hits: string[] = [];
      const empty: string[] = [];
      for (const section of SECTIONS) {
        await act(async () => { dispatch({ type: "openPersonaEditor", botId: fixture.bot.id, section }); });
        await settle();
        const node = host.querySelector<HTMLElement>("[data-persona-modal]");
        if (!node) throw new Error(`no profile page for section ${section}`);
        await unfold(node);
        if (!node.querySelector("[data-settings-surface], [data-settings-group], [data-settings-card], section, h2, h3")) empty.push(section);
        for (const hit of nestedSurfaces(node)) hits.push(`${section}\n  outer ${hit.outer}\n  inner ${hit.inner}`);
      }
      expect(empty, "a section rendered without any content: the guard would check nothing").toEqual([]);
      expect(hits).toEqual([]);
    });
  }
});
