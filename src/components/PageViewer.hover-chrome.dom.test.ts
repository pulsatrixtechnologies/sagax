// @vitest-environment happy-dom
// #2336: a page in a window of its own shows only its content until the
// pointer is over the window or the keyboard focus is inside it; the header
// then shows the last refresh on the left and the controls on the right.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let summary: Record<string, unknown>;
vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/api/pages/policy") return { linkSharing: true, readerComments: true };
    const version = /\/versions\/(\d+)$/.exec(path);
    if (version) return { version: { n: Number(version[1]), kind: "html", title: "T", state: "proposed", previewPath: `/pages/preview/abcdefgh12345678/${version[1]}` } };
    return { page: summary };
  }),
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
  ApiError: class ApiError extends Error {},
}));
vi.mock("./WidgetFrame", () => ({ useWidgetTheme: () => ({ scheme: "dark", css: "" }) }));

import { resetOpenPage } from "@/lib/open-page";
import { PageSurface } from "./PageViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let pointer: ((inside: boolean) => void) | null = null;
const unsubscribe = vi.fn();
let host: HTMLElement;
beforeEach(() => {
  pointer = null;
  unsubscribe.mockClear();
  window.artifactWindowSelf = {
    fitContent: async () => null,
    isAlwaysOnTop: async () => false,
    setAlwaysOnTop: async () => true,
    onPointer: (cb) => { pointer = cb; return unsubscribe; },
  };
  resetOpenPage();
  summary = { id: "abcdefgh12345678", title: "Bilan", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "b1", threadId: "t1", createdAt: 1, updatedAt: 1, expired: false, versions: [{ n: 1, kind: "html", title: "Bilan", createdAt: 1, state: "proposed", bytes: 10, botId: "b1" }] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  delete window.artifactWindowSelf;
  root = null;
  document.body.innerHTML = "";
});

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const render = (props: Record<string, unknown>) =>
  act(() => root!.render(createElement(PageSurface, { pageId: "abcdefgh12345678", onClose: () => {}, ...props } as never)));
const surface = () => host.querySelector("[data-page-surface]") as HTMLElement;
const header = () => host.querySelector("[data-page-header]") as HTMLElement;

describe("own page window: chrome until hover (#2336)", () => {
  it("hides the header while idle and shows it on hover", async () => {
    render({ follow: true });
    await flush();
    expect(surface().dataset.pageChrome).toBe("hidden");
    expect(header().className).toContain("opacity-0");
    expect(host.querySelector("[data-page-drag]")).toBeNull();
    act(() => { surface().dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
    expect(surface().dataset.pageChrome).toBe("shown");
    expect(header().className).not.toContain("opacity-0");
    // the header is the window's drag region while shown (no native title bar)
    expect(host.querySelector("[data-page-drag]")?.className).toContain("window-drag");
    act(() => { surface().dispatchEvent(new MouseEvent("pointerout", { bubbles: true })); });
    expect(surface().dataset.pageChrome).toBe("hidden");
  });

  it("shows the header on keyboard focus and hides it when focus leaves", async () => {
    render({ follow: true });
    await flush();
    const close = host.querySelector("[data-page-close]") as HTMLButtonElement;
    // hidden controls stay in the tab order and reveal the header when focused
    expect(close.tabIndex).toBe(0);
    act(() => { close.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(surface().dataset.pageChrome).toBe("shown");
    act(() => { close.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null })); });
    expect(surface().dataset.pageChrome).toBe("hidden");
  });

  it("shows the last refresh on the left, relative, with the exact time in the tooltip", async () => {
    render({ follow: true });
    await flush();
    const refreshed = host.querySelector("[data-page-refreshed]") as HTMLElement;
    expect(refreshed).not.toBeNull();
    expect(refreshed.textContent).toMatch(/\S/);
    expect(refreshed.title).toMatch(/\S/);
    const header = host.querySelector("[data-page-header]")!;
    // order: close, last refresh ... controls
    const kids = [...header.children];
    expect(kids.indexOf(host.querySelector("[data-page-close]")!)).toBeLessThan(kids.indexOf(refreshed));
  });

  it("follows the cursor that main reports, even over the content frame", async () => {
    render({ follow: true });
    await flush();
    expect(pointer).not.toBeNull();
    act(() => pointer!(true));
    expect(surface().dataset.pageChrome).toBe("shown");
    act(() => pointer!(false));
    expect(surface().dataset.pageChrome).toBe("hidden");
    act(() => root!.unmount());
    expect(unsubscribe).toHaveBeenCalled();
    root = createRoot(host);
  });

  it("keeps the header in a browser tab (no desktop window, native chrome stays)", async () => {
    delete window.artifactWindowSelf;
    render({ follow: true });
    await flush();
    expect(surface().dataset.pageChrome).toBeUndefined();
    expect(header().className).not.toContain("opacity-0");
  });

  it("keeps the header always shown in the page over a conversation (no own window)", async () => {
    render({});
    await flush();
    expect(surface().dataset.pageChrome).toBeUndefined();
    expect(header().className).not.toContain("opacity-0");
    expect(host.querySelector("[data-page-refreshed]")).toBeNull();
    expect(host.querySelector("[data-page-drag]")).toBeNull();
  });
});
