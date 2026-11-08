// @vitest-environment happy-dom
// #2620: a sub-page of the bot page stages its changes in a draft; the
// footer's Save writes them, Cancel drops them, and leaving with unsaved
// changes asks first (the prototype's sub-pages end with Save and Cancel).
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action } from "@/state/store";
import { setLocale } from "@/lib/i18n";
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

/** Flips the first switch of a sub-page that writes a bot field (others,
 * like a bot account, save on their own) and returns that sub-page. */
async function flipBotField(): Promise<{ sub: HTMLElement; was: string | null; label: string | null }> {
  for (const page of BOT_PROFILE_SUBPAGES) {
    if (page === "routines" || page === "rules" || page === "folder" || page === "skills" || page === "versions" || page === "accounts") continue;
    const sub = await openSub(page);
    if (!sub) continue;
    const toggle = sub.querySelector<HTMLElement>("[role='switch']:not([disabled])");
    if (!toggle) continue;
    const was = toggle.getAttribute("aria-checked");
    const label = toggle.getAttribute("aria-label") ?? toggle.closest("label")?.textContent ?? null;
    await click(toggle, "switch");
    if (host.querySelector("[data-bot-profile-unsaved]")) return { sub, was, label };
    // Not a draft write here: put it back and try the next sub-page.
    await click(sub.querySelector<HTMLElement>("[role='switch']:not([disabled])"), "switch back");
  }
  throw new Error("no sub-page switch staged a draft");
}

describe("bot page sub-pages: Save / Cancel draft (#2620)", () => {
  it("a change waits for Save; Save writes it", async () => {
    await mount("en");
    const before = storeBot();
    const { sub, was } = await flipBotField();
    // The sub-page shows the change, the workspace's bot does not have it yet.
    expect(sub.querySelector("[role='switch']:not([disabled])")?.getAttribute("aria-checked")).not.toBe(was);
    expect(storeBot()).toBe(before);
    await click(host.querySelector<HTMLElement>("[data-bot-profile-save]"), "Save");
    expect(storeBot()).not.toBe(before);
    expect(host.querySelector("[data-bot-profile-unsaved]")).toBeNull();
  });

  it("Cancel drops the draft; Back with a change asks before leaving", async () => {
    await mount("en");
    const before = storeBot();
    const { sub } = await flipBotField();
    const page = sub.getAttribute("data-bot-profile-subpage");
    // No confirm provider here: the prompt fails closed, the page stays.
    await click(host.querySelector<HTMLElement>("[data-bot-profile-back]"), "Back");
    expect(host.querySelector(`[data-bot-profile-subpage="${page}"]`)).not.toBeNull();
    await click(host.querySelector<HTMLElement>("[data-bot-profile-cancel]"), "Cancel");
    expect(storeBot()).toBe(before);
    expect(host.querySelector("[data-bot-profile-unsaved]")).toBeNull();
    // A clean sub-page: Save is off.
    await openSub(page as BotProfileSubPage);
    expect(host.querySelector<HTMLButtonElement>("[data-bot-profile-save]")?.disabled).toBe(true);
  });
});
