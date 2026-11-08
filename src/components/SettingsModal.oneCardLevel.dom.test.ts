// @vitest-environment happy-dom
// #2175: Settings keep one card level. Every page of the Settings nav, in
// Simple and Advanced, solo and with several providers and an organization,
// renders on the gallery's stand-in /api (the data the pages are shot with);
// every fold is opened; no card surface may sit inside another card surface
// (docs/design/ux-reference-grokbot-cursor.md 2.5). The bot panel has its own
// guard in BotSettingsDialog.oneCardLevel.dom.test.ts.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action, AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { settingsPagesApi } from "@/gallery/settings-pages-api";
import { nestedSurfaces, openFolds, rowsOffReference } from "./settings/nested-surfaces";

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
}

const SECTIONS: AppSettingsSection[] = ["account", "appearance", "notifications", "security", "credentials", "providers", "engines", "voice", "usage", "organization", "computer", "backups", "about", "experimental"];
const VARIANTS = { solo: "", providers: "providers=1", org: "providers=1&org=1" } as const;

let api: Record<string, unknown> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const { StoreProvider, useStore } = await import("@/state/store");
const { SettingsModal } = await import("./SettingsModal");
const lazy = await import("./lazy-settings-sections");

let dispatch: (action: Action) => void;
function Shell() {
  ({ dispatch } = useStore());
  useEffect(() => { dispatch({ type: "toggleAppSettings", open: true, section: "account" }); }, []);
  return createElement(SettingsModal);
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeAll(async () => {
  setLocale("en");
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    const body = api[url.pathname];
    return Promise.resolve(body === undefined ? json({ error: "not in this gallery" }, 404) : json(body));
  });
  // happy-dom has no layout: every node counts as visible
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  await Promise.all(Object.values(lazy).map((screen) => (screen as { preload?: () => Promise<unknown> }).preload?.()));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(query: string) {
  api = settingsPagesApi(new URLSearchParams(query));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell))); });
  await settle();
}

const pane = () => host.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="app-settings-title"] [data-settings-pane]');

async function page(section: AppSettingsSection): Promise<HTMLElement> {
  await act(async () => { dispatch({ type: "toggleAppSettings", open: true, section }); });
  await settle();
  const node = pane();
  if (!node) throw new Error(`no settings pane for ${section}`);
  for (let round = 0; round < 4; round += 1) {
    let opened = 0;
    await act(async () => { opened = openFolds(node); });
    await settle();
    if (!opened) break;
  }
  return node;
}

describe("Settings keep one card level (#2175)", () => {
  for (const mode of ["advanced", "simple"] as const) {
    for (const [variant, query] of Object.entries(VARIANTS)) {
      it(`${mode}, ${variant}: no card inside a card on any page`, async () => {
        setAdvancedMode(mode === "advanced");
        await mount(query);
        const hits: string[] = [];
        const empty: string[] = [];
        for (const section of SECTIONS) {
          const node = await page(section);
          if (!node.querySelector("[data-settings-group], [data-settings-card], [data-settings-surface]")) empty.push(section);
          for (const hit of nestedSurfaces(node)) hits.push(`${section}\n  outer ${hit.outer}\n  inner ${hit.inner}`);
        }
        expect(empty, "a page rendered without any section: the guard would check nothing").toEqual([]);
        expect(hits).toEqual([]);
      });
    }
  }

  // JC 2026-11-07 (Experimental > Developer): a loose fold row under a
  // heading with a round chevron, its switch row indented outside any card.
  // Every row is a shared row (SettingsPrimitives) inside a card.
  for (const [variant, query] of Object.entries(VARIANTS)) {
    it(`advanced, ${variant}: every row is a shared row in a card on every page`, async () => {
      setAdvancedMode(true);
      await mount(query);
      const hits: string[] = [];
      for (const section of SECTIONS) {
        const node = await page(section);
        for (const hit of rowsOffReference(node)) hits.push(`${section}: ${hit}`);
      }
      expect(hits).toEqual([]);
    });
  }

  it("Models > Advanced is a heading with a disclosure whose content unfolds beside it, not a card of cards", async () => {
    setAdvancedMode(true);
    await mount("");
    const node = await page("engines");
    const advanced = node.querySelector<HTMLElement>('[data-settings-card="models.advanced"]');
    expect(advanced).not.toBeNull();
    expect(advanced!.tagName).toBe("SECTION");
    expect(advanced!.hasAttribute("data-settings-surface")).toBe(false);
    expect(advanced!.getAttribute("data-open")).toBe("true");
    // its groups are sections of their own, at the page's level
    const groups = [...advanced!.querySelectorAll("[data-settings-group]")].map((group) => group.getAttribute("data-settings-group"));
    expect(groups).toContain("models-replies");
    expect(groups).not.toContain("models-auto");
    for (const group of advanced!.querySelectorAll("[data-settings-surface]")) {
      expect(group.parentElement?.closest("[data-settings-surface]")).toBeNull();
    }
  });
});
