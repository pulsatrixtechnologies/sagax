// @vitest-environment happy-dom
// The side panel's live browser bar, as the owner used it (M-20261127-180):
// typing google.ca while the bot had the browser showed "Enter a web address
// or something to search for." and opened nothing; the field then kept the
// typed text while the page and its tab still showed the DuckDuckGo search;
// the ⋯ menu stayed open. Real LiveBrowser, real control, a stand-in stream.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api, useStore: () => ({ state: { config: { browserProfiles: [] }, computerControl: {} } }) }));
vi.mock("./BrowserProfilesManager", () => ({ BrowserProfilesManager: () => null }));
import { LiveBrowser } from "./BrowserPanel";

class FakeSource {
  static all: FakeSource[] = [];
  listeners = new Map<string, Array<(event: Event) => void>>();
  constructor(public url: string) { FakeSource.all.push(this); }
  addEventListener(name: string, listener: (event: Event) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  emit(name: string, data: unknown = {}) { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data: JSON.stringify(data) })); }
  close() {}
}

const bot = { id: "marc", name: "Marc", browserProfile: "own" } as unknown as Bot;
const SEARCH = "https://duckduckgo.com/?q=test";
const INVALID = "Enter a web address or something to search for.";
let host: HTMLDivElement;
let root: Root;
let take: { resolve: () => void } | null;
let holdTakes = false;

const settle = async () => { await act(async () => { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); }); };
const navigations = () => api.mock.calls.map(([, init]) => JSON.parse(String(init?.body))).filter((body) => body.type === "navigate").map((body) => body.url);
const field = () => host.querySelector("input[aria-label='Browser address']") as HTMLInputElement;
const alertText = () => [...host.querySelectorAll("[role=alert]")].map((node) => node.textContent).join(" ");
// Each page tab is a box with its select button first, then its close button.
const tabLabels = () => [...host.querySelectorAll("[data-browser-tabs] > div > div > button:first-of-type")].map((node) => node.textContent);
const emit = async (name: string, data?: unknown) => { await act(async () => FakeSource.all[0]!.emit(name, data)); };
const type = (text: string) => act(() => {
  const input = field();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const enter = async () => {
  await act(async () => { field().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
};

beforeEach(async () => {
  FakeSource.all = [];
  take = null; holdTakes = false;
  api.mockReset().mockImplementation(async (_path: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.type === "take" && holdTakes) await new Promise<void>((resolve) => { take = { resolve }; });
    return {};
  });
  vi.stubGlobal("EventSource", FakeSource);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(LiveBrowser, { bot, docked: { title: "Marc’s browser", chrome: null } })));
  await emit("ready", { viewerId: "v1" });
  await emit("tabs", { tabs: [{ tabId: "t1", title: "test at DuckDuckGo", url: SEARCH, active: true }] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("the address field (M-20261127-180)", () => {
  it("opens google.ca once when Enter comes again while the take from the bot still waits, with no invalid-address error", async () => {
    holdTakes = true;
    act(() => field().focus());
    type("google.ca");
    await enter();
    expect(take).not.toBeNull();
    // Nothing visible happens while the bot finishes: the person presses Enter again.
    act(() => field().focus());
    type("google.ca");
    await enter();
    expect(alertText()).not.toContain(INVALID);
    expect(field().readOnly).toBe(false);
    take!.resolve();
    await settle();
    expect(navigations()).toEqual(["https://google.ca/"]);
    expect(alertText()).not.toContain(INVALID);
  });

  it("opens the latest address asked for while a take still waits", async () => {
    holdTakes = true;
    act(() => field().focus());
    type("google.ca");
    await enter();
    act(() => field().focus());
    type("meilleur café montréal");
    await enter();
    take!.resolve();
    await settle();
    expect(navigations()).toEqual(["https://google.ca/", "https://duckduckgo.com/?q=meilleur%20caf%C3%A9%20montr%C3%A9al"]);
  });

  it("names only an empty or unusable entry, and the message goes as soon as one types", async () => {
    act(() => field().focus());
    type("mailto:someone@example.com");
    await enter();
    expect(alertText()).toContain(INVALID);
    type("g");
    expect(alertText()).not.toContain(INVALID);
    type("   ");
    await enter();
    expect(alertText()).toContain(INVALID);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(navigations()).toEqual([]);
  });
});

describe("the address and the tab follow the page on screen (M-20261127-180)", () => {
  it("after Enter, shows the page the stream reports, not the typed text", async () => {
    act(() => field().focus());
    type("google.ca");
    await enter();
    expect(navigations()).toEqual(["https://google.ca/"]);
    await emit("url", { url: "https://www.google.ca/" });
    expect(field().value).toBe("https://www.google.ca/");
  });

  it("goes back to the page's address when the field is left without Enter, or on Escape", async () => {
    act(() => field().focus());
    type("google.ca");
    act(() => field().blur());
    expect(field().value).toBe(SEARCH);
    act(() => field().focus());
    type("something else");
    act(() => { field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(field().value).toBe(SEARCH);
  });

  it("drops the tab title of the page it left until the engine names the new one", async () => {
    expect(tabLabels()).toEqual(["test at DuckDuckGo"]);
    await emit("url", { url: "https://www.google.ca/" });
    expect(tabLabels()).toEqual(["www.google.ca"]);
    await emit("tabs", { tabs: [{ tabId: "t1", title: "Google", url: "https://www.google.ca/", active: true }] });
    expect(tabLabels()).toEqual(["Google"]);
  });
});

describe("the ⋯ menu (M-20261127-180)", () => {
  const open = () => act(() => {
    const menu = host.querySelector("details")!;
    menu.open = true;
    menu.dispatchEvent(new Event("toggle"));
  });

  it("closes on Escape and on a press outside instead of staying open", () => {
    const menu = host.querySelector("details")!;
    open();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(menu.open).toBe(false);
    open();
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(menu.open).toBe(false);
  });
});
