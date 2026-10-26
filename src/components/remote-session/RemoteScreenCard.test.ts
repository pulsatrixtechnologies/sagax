// @vitest-environment happy-dom
// The Tailcat screen in the chat (JC 2026-10-22, session 8F2NZU: "c'est 0 le
// comportement voulu"): the bot computer's own screen card and window, with
// a remote session as their source. Take control never opens the Computer
// tab; the window drives #950's live control WebSocket.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteSessionView } from "../../../shared/remote-session";
import { setLocale, t } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { RemoteSessionCard } from "./RemoteSessionCard";
import {
  RemoteScreenCard,
  remoteControllable,
  remoteHasScreen,
  remoteScreenCaption,
  remoteScreenProblem,
  remoteScreenState,
} from "./RemoteScreenCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const view: RemoteSessionView = {
  id: "8f2a0c1d2e3f",
  code: "8F2NZU",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-10-22T17:00:00.000Z",
  hostname: "POSTE-02",
  osName: "Windows 11 Professionnel",
  user: "exemple\\usager",
  inventory: "ready",
  suggestions: [],
};

/** A WebSocket the test drives: records what the page sends. */
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "blob";
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
}

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ url: string; method: string }>;
let screenOk: boolean;

beforeEach(() => {
  setLocale("fr");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  requests = [];
  screenOk = true;
  FakeSocket.last = null;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:screen-1", revokeObjectURL: () => undefined }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/screen")) {
      return screenOk
        ? new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), { status: 200 })
        : new Response(JSON.stringify({ error: "The screen is not available." }), { status: 404 });
    }
    if (url.endsWith("/close")) return new Response(JSON.stringify({ session: { ...view, state: "ended" } }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLocale("en");
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
const click = async (selector: string) => {
  const element = $(selector);
  if (!element) throw new Error(`missing ${selector}`);
  await act(async () => { element.click(); });
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.getAttribute("aria-label") === label || entry.textContent?.trim() === label);

describe("the screen's state and words", () => {
  it("names the computer, and says why there is no picture instead of n/a", () => {
    expect(remoteScreenCaption(view)).toBe("Écran de POSTE-02");
    expect(remoteScreenCaption({ ...view, hostname: `${ADDRESS}` })).toBe("Écran de 8F2NZU");
    expect(remoteScreenState(view, { shot: "blob:1", missed: false, paused: false })).toBe("running");
    expect(remoteScreenState(view, { shot: "blob:1", missed: false, paused: true })).toBe("paused");
    expect(remoteScreenState(view, { shot: null, missed: false, paused: false })).toBe("starting");
    expect(remoteScreenState({ ...view, state: "ended" }, { shot: null, missed: false, paused: false })).toBe("off");
    const outside = { ...view, inventory: "no-tunnel" as const };
    expect(remoteScreenState(outside, { shot: null, missed: true, paused: false })).toBe("error");
    expect(remoteScreenProblem(outside, true)).toBe(t("remoteSession.inventory.no-tunnel"));
    expect(remoteScreenProblem({ ...view, inventory: "no-answer" }, true)).toBe("Le poste ne répond pas. Sagax réessaie.");
    expect(remoteScreenProblem({ ...view, os: "macos", screenDenied: true }, true)).toContain("enregistrement de l'écran");
    expect(remoteScreenProblem(view, true)).toBe(t("remoteSession.screenFailed"));
    expect(remoteScreenProblem({ ...view, inventory: "pending" }, true)).toBeUndefined();
  });

  it("offers Take control on Windows once the OS is known, and no screen on a server without a desktop", () => {
    expect(remoteControllable(view)).toBe(true);
    expect(remoteControllable({ ...view, os: "macos" })).toBe(false);
    expect(remoteControllable({ ...view, osKnown: false })).toBe(false);
    expect(remoteHasScreen(view)).toBe(true);
    expect(remoteHasScreen({ ...view, headless: true })).toBe(false);
    expect(remoteHasScreen({ ...view, state: "ended" })).toBe(false);
  });
});

describe("the chat screen card", () => {
  it("is the bot computer's screen card with the remote session as its source", async () => {
    act(() => root.render(createElement(RemoteScreenCard, { botId: "melonie", view })));
    await flush();
    const figure = $("[data-computer-screen]")!;
    expect(figure.dataset.computerSource).toBe("remote");
    expect(figure.dataset.computerScreen).toBe("running");
    expect($("figcaption")!.textContent).toBe("Écran de POSTE-02");
    expect($("[data-remote-session-shot]")!.getAttribute("src")).toBe("blob:screen-1");
    // the bot computer's centered pill and bottom bar
    expect($("[data-take-control]")!.textContent).toContain(t("sandboxDesktop.takeControl"));
    expect($("[data-screen-controls]")).not.toBeNull();
    expect(requests.filter((request) => request.url.endsWith("/screen"))).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(ADDRESS);
  });

  it("has no Take control on a Mac (view only), and says why when the screen is not there", async () => {
    screenOk = false;
    act(() => root.render(createElement(RemoteScreenCard, { botId: "melonie", view: { ...view, os: "macos", inventory: "no-tunnel" } })));
    await flush();
    expect($("[data-computer-screen]")!.dataset.computerScreen).toBe("error");
    expect($("[data-take-control]")).toBeNull();
    expect(document.body.textContent).toContain(t("remoteSession.inventory.no-tunnel"));
    expect(document.body.textContent).not.toContain("n/a");
  });

  it("pauses and resumes the live picture", async () => {
    act(() => root.render(createElement(RemoteScreenCard, { botId: "melonie", view })));
    await flush();
    await act(async () => { button(t("computerScreen.pause"))!.click(); });
    expect($("[data-computer-screen]")!.dataset.computerScreen).toBe("paused");
    const polled = requests.length;
    await flush();
    expect(requests.length).toBe(polled);
    await act(async () => { button(t("computerScreen.resume"))!.click(); });
    await flush();
    expect($("[data-computer-screen]")!.dataset.computerScreen).toBe("running");
    expect(requests.length).toBeGreaterThan(polled);
  });

  it("ends the session on a second Stop only", async () => {
    act(() => root.render(createElement(RemoteScreenCard, { botId: "melonie", view })));
    await flush();
    await act(async () => { button(t("computerScreen.stop"))!.click(); });
    expect($("[data-remote-stop-confirm]")!.textContent).toBe(t("remoteSession.confirmStop"));
    expect(requests.some((request) => request.url.endsWith("/close"))).toBe(false);
    await act(async () => { button(t("computerScreen.stop"))!.click(); });
    await flush();
    expect(requests.filter((request) => request.url.endsWith(`/remote-sessions/${view.id}/close`) && request.method === "POST")).toHaveLength(1);
  });
});

describe("Take control: the bot computer's window over the live control socket", () => {
  it("opens the window (never the Computer tab), grants control, releases it and closes the socket", async () => {
    act(() => root.render(createElement(RemoteScreenCard, { botId: "melonie", view })));
    await flush();
    await click("[data-take-control]");
    const dialog = $("[data-sandbox-takeover]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("[role=dialog]")!.getAttribute("aria-label")).toBe("Écran de POSTE-02");
    const chip = dialog.querySelector("[data-power]")!.textContent!;
    expect(chip).toContain(t("computerScreen.state.running"));
    expect(chip).toContain(t("sandboxDesktop.controlling"));
    expect($("[data-takeover-control]")!.dataset.takeoverControl).toBe("release");
    // the chat card shows no second picture while the window has it
    expect($("[data-remote-takeover-open]")).not.toBeNull();

    const socket = FakeSocket.last!;
    expect(socket.url).toBe(`ws://${window.location.host}/api/bots/melonie/remote-sessions/${view.id}/control`);
    await act(async () => { socket.open(); });
    expect(socket.sent).toEqual([JSON.stringify({ t: "grant", on: true })]);
    expect($("[data-remote-live-screen]")!.dataset.remoteInput).toBe("control");

    await click("[data-takeover-control]");
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "grant", on: false }));
    expect($("[data-remote-live-screen]")!.dataset.remoteInput).toBe("none");
    expect(socket.closed).toBe(false);

    await click("[data-takeover-close]");
    expect($("[data-sandbox-takeover]")).toBeNull();
    expect(socket.closed).toBe(true);
  });
});

describe("the chat card for a remote session", () => {
  it("puts the screen card first and the facts card under it", async () => {
    act(() => root.render(createElement(StoreProvider, null, createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view }))));
    await flush();
    const order = [...document.querySelectorAll("[data-remote-screen-card], [data-remote-session-card]")].map((node) => node.hasAttribute("data-remote-screen-card") ? "screen" : "facts");
    expect(order).toEqual(["screen", "facts"]);
    // the facts card keeps its details folded and carries no Take control of its own
    expect($("[data-remote-details]")).toBeNull();
    expect($("[data-remote-session-card] [data-remote-take-control]")).toBeNull();
  });

  it("shows no screen on a server without a desktop and says shell only", async () => {
    act(() => root.render(createElement(StoreProvider, null, createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, headless: true } }))));
    await flush();
    expect($("[data-remote-screen-card]")).toBeNull();
    expect($("[data-remote-headless]")!.textContent).toBe("Serveur sans interface : shell seulement");
    expect(requests.some((request) => request.url.endsWith("/screen"))).toBe(false);
  });

  it("says why the facts are missing and lets the technician name an unknown OS", async () => {
    act(() => root.render(createElement(StoreProvider, null, createElement(RemoteSessionCard, {
      botId: "melonie", threadId: "thread-1", view: { ...view, hostname: undefined, osName: undefined, user: undefined, os: "windows", osKnown: false, inventory: "os-unknown" },
    }))));
    await flush();
    expect($("[data-remote-facts-notice]")!.dataset.remoteFactsNotice).toBe("os-unknown");
    // the poste row says OS inconnu, never a guessed Windows (8F2NZU was a Mac)
    expect($("[data-remote-field=poste]")!.textContent).toContain("OS inconnu");
    expect($("[data-remote-field=poste]")!.textContent).not.toContain("Windows");
    expect(document.body.textContent).not.toContain("n/a");
    await click("[data-remote-os=macos]");
    await flush();
    expect(requests).toContainEqual({ url: `/api/bots/melonie/remote-sessions/${view.id}/os`, method: "POST" });
  });
});
