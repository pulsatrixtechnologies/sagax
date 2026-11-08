// @vitest-environment happy-dom
// The bot's browser window speaks the person's language: its tab strip,
// address bar, menu and every connection state ("Connecting…", the
// interrupted stream and its automatic reconnect) come from the locale
// packs, never English written in the component (owner 2026-10-15).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: { browserProfiles: [] } }, dispatch: vi.fn() }),
  api: vi.fn(async () => ({ ok: true })),
}));
// The profiles dialog loads its own list; it has no part in these words.
vi.mock("./BrowserProfilesManager", () => ({ BrowserProfilesManager: () => null }));
import { LiveBrowser } from "./BrowserPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One EventSource per connection attempt; the test drives its events. */
class FakeSource {
  static all: FakeSource[] = [];
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;
  constructor(readonly url: string) { FakeSource.all.push(this); }
  addEventListener(name: string, handler: (event: Event) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  emit(name: string, event: Event) { for (const handler of this.listeners.get(name) ?? []) handler(event); }
  close() { this.closed = true; }
}

const bot = { id: "olive", name: "Olive", browserProfile: undefined } as unknown as Bot;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.all = [];
  vi.stubGlobal("EventSource", FakeSource);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setLocale("en");
});
afterAll(() => vi.unstubAllGlobals());

const text = () => host.textContent ?? "";
const mount = () => act(() => root.render(createElement(LiveBrowser, { bot })));
/** A dropped stream: the transport error a proxy or a restarting server gives. */
const drop = () => act(() => FakeSource.all.at(-1)!.emit("error", new Event("error")));

describe("the browser window's words", () => {
  it("says Connecting, New tab and the reconnect states in French", () => {
    setLocale("fr");
    mount();
    expect(text()).toContain("Nouvel onglet");
    expect(text()).toContain("Ouverture du navigateur en direct…");
    const address = host.querySelector<HTMLInputElement>("input")!;
    expect(address.placeholder).toBe("Connexion…");
    expect(address.getAttribute("aria-label")).toBe("Adresse du navigateur");
    expect(host.querySelector('[aria-label="Nouvel onglet"]')).not.toBeNull();

    drop();
    expect(text()).toContain("Connexion interrompue. Reconnexion de la vue du navigateur…");
    expect(text()).toContain("Reconnexion…");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Connexion interrompue");
    // the banner's own button, under the stream's words
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent === "Reconnecter")).toBe(true);
    for (const english of ["New tab", "Connecting…", "Reconnecting…", "Connection interrupted", ">Reconnect<"]) {
      expect(host.innerHTML).not.toContain(english);
    }
  });

  it("keeps the reconnecting state in any language, and gives up after the retry budget", () => {
    setLocale("fr");
    mount();
    // five automatic tries (1, 2, 4, 8, 15 s), each one dropped again
    for (const delay of [1_000, 2_000, 4_000, 8_000, 15_000]) {
      drop();
      expect(text()).toContain("Reconnexion…");
      act(() => { vi.advanceTimersByTime(delay); });
    }
    drop();
    expect(text()).toContain("La connexion au navigateur est terminée. Reconnecte-toi pour continuer à regarder.");
    expect(text()).toContain("Navigateur déconnecté");
    expect(text()).not.toContain("Reconnexion…");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(FakeSource.all).toHaveLength(6);
  });

  it("stays English in English", () => {
    mount();
    drop();
    expect(text()).toContain("Connection interrupted. Reconnecting the browser view…");
    expect(text()).toContain("Reconnecting…");
  });
});
