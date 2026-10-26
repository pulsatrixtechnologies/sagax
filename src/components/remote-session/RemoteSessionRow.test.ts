// @vitest-environment happy-dom
// The bot panel's remote session row (JC 2026-10-22): computer name once,
// user / OS / end time under it, an X that asks twice, the chat card's
// buttons, and a mini live picture that falls back to an icon.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import { setLocale, t } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { remoteThumbKind, remoteThumbPolls } from "./RemoteSessionThumb";
import { RemoteSessionsPanel, remoteRowSubtitle, remoteRowTitle } from "./RemoteSessionsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view: RemoteSessionView = {
  id: "8f2a0c1d2e3f",
  code: "TP2T2G",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-10-22T15:02:00.000Z",
  hostname: "POSTE-02",
  osName: "Windows 11 Professionnel",
  user: "exemple\\usager",
  inventory: "ready",
  suggestions: [],
};

let host: HTMLDivElement;
let root: Root;
let visible = true;
let requests: Array<{ url: string; method: string }>;

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);

function panel(overrides: Partial<Parameters<typeof RemoteSessionsPanel>[0]> = {}) {
  return createElement(StoreProvider, null, createElement(RemoteSessionsPanel, {
    botId: "melonie", rows: [view], confirmId: null, error: null, onTakeControl: () => undefined, onClose: () => undefined, ...overrides,
  }));
}

beforeEach(() => {
  setLocale("fr");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  requests = [];
  visible = true;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
    observe() { this.cb([{ isIntersecting: visible }]); }
    disconnect() {}
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:thumb-1", revokeObjectURL: () => undefined }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    if (!String(input).endsWith("/screen")) {
      const home = "C:\\Users\\usager";
      return new Response(JSON.stringify({ ok: true, path: home, parent: "C:\\Users", home, roots: ["C:\\"], truncated: false, entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }), { status: 200 });
  }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("row text", () => {
  it("never repeats the code: the name is the title, user / OS / end time the subtitle", () => {
    expect(remoteRowTitle(view)).toBe("POSTE-02");
    const subtitle = remoteRowSubtitle(view);
    expect(subtitle).toBe(`exemple\\usager · Windows 11 Professionnel · se termine à ${formatEndLabel(view.endAt)}`);
    expect(subtitle).not.toContain("TP2T2G");
    const html = renderToStaticMarkup(panel());
    expect(html.match(/TP2T2G/g)?.length).toBe(1); // the tooltip only
  });

  it("falls back to the code as the title when the computer is unnamed, and still says it once", () => {
    const unnamed = { ...view, hostname: undefined };
    expect(remoteRowTitle(unnamed)).toBe("TP2T2G");
    expect(remoteRowSubtitle(unnamed)).not.toContain("TP2T2G");
  });
});

describe("row actions", () => {
  it("closes with an X icon (accessible name), then a red Confirmer pill on the second click", async () => {
    const closed: string[] = [];
    act(() => root.render(panel({ onClose: (v) => closed.push(v.id) })));
    const x = $("[data-remote-close]")!;
    expect(x.dataset.remoteClose).toBe("ask");
    expect(x.getAttribute("aria-label")).toBe("Fermer la session");
    expect(x.textContent).toBe("");
    expect(x.querySelector("svg")).not.toBeNull();
    await act(async () => { x.click(); });
    expect(closed).toEqual([view.id]);
    act(() => root.render(panel({ confirmId: view.id })));
    const pill = $("[data-remote-close]")!;
    expect(pill.dataset.remoteClose).toBe("confirm");
    expect(pill.textContent).toBe("Confirmer");
    expect(pill.className).toContain("bg-danger");
  });

  it("offers Take control, Shell, Envoyer and Télécharger like the chat card", async () => {
    const taken: string[] = [];
    act(() => root.render(panel({ onTakeControl: (v) => taken.push(v.id) })));
    expect($("[data-remote-take-control]")!.textContent).toContain("Prendre le contrôle");
    for (const action of ["shell", "upload", "download"]) expect($(`[data-remote-action="${action}"]`)).not.toBeNull();
    await act(async () => { $("[data-remote-take-control]")!.click(); });
    expect(taken).toEqual([view.id]);
    // Shell is wired to the same endpoint as the chat card
    await act(async () => { $('[data-remote-action="shell"]')!.click(); });
    await flush();
    expect(requests.some((request) => request.url.includes(`/remote-sessions/${view.id}/`) && request.method === "POST")).toBe(true);
    // Télécharger opens the remote file browser
    await act(async () => { $('[data-remote-action="download"]')!.click(); });
    await flush();
    expect(document.body.textContent).toContain(t("remoteSession.browser.downloadSubtitle"));
  });
});

describe("thumbnail", () => {
  it("shows the polled picture and takes control on click", async () => {
    const taken: string[] = [];
    act(() => root.render(panel({ onTakeControl: (v) => taken.push(v.id) })));
    await flush();
    expect(requests.some((request) => request.url.endsWith(`/remote-sessions/${view.id}/screen`))).toBe(true);
    const thumb = $("[data-remote-thumb]")!;
    expect(thumb.dataset.remoteThumb).toBe("picture");
    expect(thumb.querySelector("img")!.getAttribute("src")).toBe("blob:thumb-1");
    await act(async () => { thumb.click(); });
    expect(taken).toEqual([view.id]);
  });

  it("asks for no picture while the row is off screen", async () => {
    visible = false;
    act(() => root.render(panel()));
    await flush();
    expect(requests.filter((request) => request.url.endsWith("/screen"))).toHaveLength(0);
    expect($("[data-remote-thumb]")!.dataset.remoteThumb).toBe("loading");
  });

  it("has placeholder states, and asks for no picture, when headless, OS unknown, denied or closed", async () => {
    const cases: Array<[Partial<RemoteSessionView>, string]> = [
      [{ headless: true }, "headless"],
      [{ osKnown: false, inventory: "os-unknown" }, "unknown"],
      [{ screenDenied: true }, "denied"],
      [{ state: "ended" }, "closed"],
    ];
    for (const [patch, kind] of cases) {
      const v = { ...view, ...patch };
      expect(remoteThumbKind(v, null)).toBe(kind);
      expect(remoteThumbKind(v, "blob:x")).toBe(kind);
      expect(remoteThumbPolls(v)).toBe(false);
      act(() => root.render(panel({ rows: [v] })));
      await flush();
      expect($("[data-remote-thumb]")!.dataset.remoteThumb).toBe(kind);
      expect($("[data-remote-thumb] img")).toBeNull();
    }
    expect(requests.filter((request) => request.url.endsWith("/screen"))).toHaveLength(0);
    expect(remoteThumbKind(view, null)).toBe("loading");
  });
});
