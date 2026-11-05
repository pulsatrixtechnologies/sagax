// @vitest-environment happy-dom
// The page view (2026-10-28, the reference design's open page): the title pill
// renames on Enter and cancels on Escape; a newer version named by the
// conversation (the bot changed the page) draws the page again at the place
// its reader had; the × closes.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ path: string; init?: RequestInit }> = [];
let summary: Record<string, unknown>;

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === "/api/pages/policy") return { linkSharing: true, readerComments: true };
    const version = /\/versions\/(\d+)$/.exec(path);
    if (version) return { version: { n: Number(version[1]), kind: "html", title: "T", state: "proposed", previewPath: `/pages/preview/abcdefgh12345678/${version[1]}` } };
    if (init?.method === "PATCH") {
      summary = { ...summary, title: JSON.parse(String(init.body)).title };
      return { page: summary };
    }
    return { page: summary };
  }),
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
  ApiError: class ApiError extends Error {},
}));

vi.mock("./WidgetFrame", () => ({ useWidgetTheme: () => ({ scheme: "dark", css: "" }) }));

import { resetOpenPage, rememberPagePlace } from "@/lib/open-page";
import { PageSurface } from "./PageViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const version = (n: number) => ({ n, kind: "html", title: "Bilan", createdAt: n, state: "proposed", bytes: 10, botId: "b1" });
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  calls.length = 0;
  resetOpenPage();
  summary = { id: "abcdefgh12345678", title: "Bilan", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "b1", threadId: "t1", createdAt: 1, updatedAt: 1, expired: false, versions: [version(1)] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

function render(props: Record<string, unknown>) {
  act(() => root!.render(createElement(PageSurface, { pageId: "abcdefgh12345678", onClose: () => {}, ...props } as never)));
}

const frameSrc = () => host.querySelector("iframe[data-page-viewer-frame]")?.getAttribute("src") ?? "";

describe("the open page", () => {
  it("draws the page bare, in the app's theme, at the place its reader had", async () => {
    rememberPagePlace("abcdefgh12345678", 320);
    render({});
    await flush();
    expect(frameSrc()).toMatch(/^\/pages\/preview\/abcdefgh12345678\/1\?bare=1&theme=(light|dark)&y=320$/);
    // the page is never handed over as a srcdoc
    expect(host.querySelector("iframe[srcdoc]")).toBeNull();
  });

  it("the title pill renames on Enter, and Escape leaves the title as it was", async () => {
    render({});
    await flush();
    act(() => (host.querySelector("[data-page-title]") as HTMLButtonElement).click());
    const input = host.querySelector("[data-page-title-edit] input") as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector("[data-page-title-edit]")).toBeNull();
    expect(calls.some((call) => call.init?.method === "PATCH")).toBe(false);

    act(() => (host.querySelector("[data-page-title]") as HTMLButtonElement).click());
    const field = host.querySelector("[data-page-title-edit] input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(field, "  Bilan   du mois ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector("[data-page-title-edit]") as HTMLFormElement).requestSubmit();
    });
    await flush();
    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(patch?.path).toBe("/api/pages/abcdefgh12345678");
    expect(JSON.parse(String(patch!.init!.body))).toEqual({ title: "Bilan du mois" });
    expect(host.querySelector("[data-page-title]")?.textContent).toContain("Bilan du mois");
  });

  it("a newer version from the bot is drawn in place, at the same place", async () => {
    render({ latestVersion: 1 });
    await flush();
    expect(frameSrc()).toContain("/1?");
    rememberPagePlace("abcdefgh12345678", 900);
    summary = { ...summary, versions: [version(1), version(2)] };
    render({ latestVersion: 2 });
    await flush();
    expect(frameSrc()).toMatch(/\/2\?bare=1&theme=(light|dark)&y=900$/);
  });

  it("the round × closes", async () => {
    const onClose = vi.fn();
    render({ onClose });
    await flush();
    act(() => (host.querySelector("[data-page-close]") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers Always on top only in an own desktop window (#2046)", async () => {
    render({ follow: true });
    await flush();
    act(() => (host.querySelector("[data-page-more]") as HTMLButtonElement).click());
    // the menu portals to document.body
    expect(document.querySelector("[data-page-always-on-top]")).toBeNull();
    // close the menu and remount so open state does not carry over
    act(() => root!.unmount());
    host.innerHTML = "";
    root = createRoot(host);

    const setAlwaysOnTop = vi.fn(async () => true);
    const isAlwaysOnTop = vi.fn(async () => false);
    (window as unknown as { artifactWindowSelf: { isAlwaysOnTop: typeof isAlwaysOnTop; setAlwaysOnTop: typeof setAlwaysOnTop } }).artifactWindowSelf = {
      isAlwaysOnTop,
      setAlwaysOnTop,
    };
    render({ follow: true });
    await flush();
    act(() => (host.querySelector("[data-page-more]") as HTMLButtonElement).click());
    await flush();
    const row = document.querySelector("[data-page-always-on-top]") as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute("aria-checked")).toBe("false");
    await act(async () => { row.click(); });
    await flush();
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
    delete (window as unknown as { artifactWindowSelf?: unknown }).artifactWindowSelf;
  });
});

describe("page Full screen (#2043)", () => {
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;
  let fullscreenElement: Element | null = null;

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen = vi.fn(async function (this: Element) {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    delete (window as { ogb?: unknown }).ogb;
  });

  afterEach(() => {
    delete (window as { ogb?: unknown }).ogb;
  });

  it("keeps Full screen in the page toolbar next to Share", async () => {
    render({});
    await flush();
    const button = host.querySelector<HTMLButtonElement>("[data-page-fullscreen]");
    const share = host.querySelector("[data-page-share]");
    const frame = host.querySelector("[data-page-viewer-frame]");
    expect(button).not.toBeNull();
    expect(share).not.toBeNull();
    expect(button!.parentElement).toBe(share!.parentElement);
    expect(frame?.contains(button) ?? false).toBe(false);
  });

  it("asks the OS for full screen during the click and toggles the label", async () => {
    render({});
    await flush();
    const button = () => host.querySelector<HTMLButtonElement>("[data-page-fullscreen]")!;
    expect(button().getAttribute("aria-pressed")).toBe("false");
    let duringClick = false;
    let requestedDuringClick = false;
    requestFullscreen.mockImplementation(async function (this: Element) {
      if (duringClick) requestedDuringClick = true;
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await act(async () => {
      duringClick = true;
      button().click();
      duringClick = false;
    });
    expect(requestedDuringClick).toBe(true);
    expect(button().getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button().click(); });
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it("uses Electron setFullScreen when the preload bridge is present", async () => {
    const set = vi.fn(async () => true);
    const listeners = new Set<(fullscreen: boolean) => void>();
    window.ogb = {
      windowFullscreen: {
        set,
        state: async () => ({ fullscreen: false }),
        onChanged: (cb: (fullscreen: boolean) => void) => {
          listeners.add(cb);
          return () => { listeners.delete(cb); };
        },
      },
    } as unknown as Window["ogb"];
    render({});
    await flush();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-page-fullscreen]")!.click(); });
    expect(set).toHaveBeenCalledWith(true);
    expect(requestFullscreen).not.toHaveBeenCalled();
    await act(async () => { for (const listener of listeners) listener(true); });
    expect(host.querySelector<HTMLButtonElement>("[data-page-fullscreen]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("Escape does not close the page while OS full screen is on", async () => {
    const onClose = vi.fn();
    render({ onClose });
    await flush();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-page-fullscreen]")!.click(); });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
