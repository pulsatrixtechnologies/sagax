// @vitest-environment happy-dom
// Ask the bot about a selected passage, in place (#4099): the page's own
// frame says where the selection is; the app draws the outline, the
// "Selected text" tag and the small composer with the bot's avatar; Send is
// the person's message about the page and the passage; while the bot works
// the composer shows the working line; a new version asks the frame to find
// the passage again; Escape puts it away without closing the page.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let summary: Record<string, unknown>;

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/api/pages/policy") return { linkSharing: true, readerComments: true };
    const version = /\/versions\/(\d+)$/.exec(path);
    if (version) return { version: { n: Number(version[1]), kind: "markdown", title: "Bilan", state: "draft", previewPath: `/pages/preview/abcdefgh12345678/${version[1]}` } };
    return { page: summary };
  }),
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
  ApiError: class ApiError extends Error {},
}));

vi.mock("./WidgetFrame", () => ({ useWidgetTheme: () => ({ scheme: "light", css: "" }) }));

import { resetOpenPage } from "@/lib/open-page";
import { setLocale, t } from "@/lib/i18n";
import { PAGE_SELECTION_MESSAGE, pageSelectionRequest } from "../../shared/page-selection";
import { PageSurface } from "./PageViewer";
import { selectionComposerPlace } from "./PageSelectionAsk";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const version = (n: number) => ({ n, kind: "markdown", title: "Bilan", createdAt: n, state: "draft", bytes: 10, botId: "b1" });
const anchor = { kind: "text" as const, quote: "Le volume a augmenté", prefix: "Septembre. ", suffix: " de 12 %.", path: "body > p", tag: "p" };
let root: Root | null = null;
let host: HTMLElement;
/** The page's own frame inside the preview wrapper, as the app sees it. */
let pageWindow: { postMessage: ReturnType<typeof vi.fn> };

beforeEach(() => {
  setLocale("en");
  resetOpenPage();
  summary = { id: "abcdefgh12345678", title: "Bilan", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "b1", threadId: "t1", createdAt: 1, updatedAt: 1, expired: false, versions: [version(1)] };
  pageWindow = { postMessage: vi.fn() };
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

// every preview wrapper frame holds the fake page window (no frame loads here)
const realContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
beforeAll(() => {
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get: () => ({ frames: [pageWindow], postMessage: () => {} }) });
});
afterAll(() => {
  if (realContentWindow) Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", realContentWindow);
});

/** The preview wrapper's frame. */
function wireFrame(): HTMLIFrameElement {
  return host.querySelector<HTMLIFrameElement>("iframe[data-page-viewer-frame]")!;
}

async function post(data: unknown, source: unknown = pageWindow) {
  await act(async () => { window.dispatchEvent(new MessageEvent("message", { data, source: source as never })); });
}

const selected = (rect = { x: 40, y: 120, w: 200, h: 18 }) => ({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect });
const ask = (over: Record<string, unknown> = {}) => ({ avatar: createElement("span", { "data-test-avatar": "" }), botName: "Scout", working: false, onSend: vi.fn(), ...over });

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(target: HTMLElement, name: string) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
}

describe("ask the bot about a selected passage, in place (#4099)", () => {
  it("a selection in the page draws the outline, the Selected text tag and a small composer with the bot's avatar", async () => {
    render({ ask: ask() });
    await flush();
    wireFrame();
    expect(host.querySelector("[data-page-selection-ask]")).toBeNull();
    // a message from any other window is not the page's
    await post(selected(), {});
    expect(host.querySelector("[data-page-selection-ask]")).toBeNull();
    await post(selected());
    const outline = host.querySelector<HTMLElement>("[data-page-selection-outline]")!;
    expect(outline).not.toBeNull();
    expect(outline.style.left).toBe("38px");
    expect(outline.style.top).toBe("118px");
    expect(outline.querySelector("[data-page-selection-tag]")!.textContent).toBe(t("pages.selection.tag"));
    const composer = host.querySelector<HTMLElement>("[data-page-selection-composer='ready']")!;
    expect(composer.querySelector("[data-test-avatar]")).not.toBeNull();
    const input = composer.querySelector<HTMLInputElement>("input")!;
    expect(input.getAttribute("placeholder")).toBe(t("pages.selection.placeholder"));
    expect(document.activeElement).toBe(input);
    expect(composer.querySelector<HTMLButtonElement>("[data-page-selection-send]")!.disabled).toBe(true);
  });

  it("Send is the person's message about the page and the passage; the working line shows while the bot works; a new version is asked to find the passage again", async () => {
    const onSend = vi.fn();
    render({ ask: ask({ onSend }) });
    await flush();
    wireFrame();
    await post(selected());
    const input = host.querySelector<HTMLInputElement>("[data-page-selection-composer] input")!;
    await type(input, "Plus court, s'il te plaît");
    await key(input, "Enter");
    expect(onSend).toHaveBeenCalledWith("Plus court, s'il te plaît", { pageId: "abcdefgh12345678", title: "Bilan", version: 1, selection: anchor });
    // the bot works: the chat's working line, in place
    render({ ask: ask({ onSend, working: true }) });
    await flush();
    const working = host.querySelector<HTMLElement>("[data-page-selection-composer='working'] [data-page-selection-working]")!;
    expect(working.textContent).toBe(t("pages.botWorking"));
    // its new version is drawn in place; the frame is asked for the passage
    summary = { ...summary, versions: [version(1), version(2)] };
    render({ ask: ask({ onSend, working: false }), latestVersion: 2 });
    await flush();
    const frame = wireFrame();
    expect(frame.getAttribute("src")).toContain("/abcdefgh12345678/2");
    await act(async () => { frame.dispatchEvent(new Event("load")); });
    expect(pageWindow.postMessage).toHaveBeenCalledWith(pageSelectionRequest(anchor), "*");
    // found again: the outline follows it
    await post(selected({ x: 40, y: 300, w: 180, h: 18 }));
    expect(host.querySelector<HTMLElement>("[data-page-selection-outline]")!.style.top).toBe("298px");
    // not found in this version: the outline goes
    await post({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: null });
    expect(host.querySelector("[data-page-selection-ask]")).toBeNull();
  });

  it("a bot busy with something else still takes the ask (it queues like the chat); the working line comes only after it", async () => {
    const onSend = vi.fn();
    render({ ask: ask({ onSend, working: true }) });
    await flush();
    wireFrame();
    await post(selected());
    // busy before the ask: the field, not the working line
    expect(host.querySelector("[data-page-selection-working]")).toBeNull();
    const input = host.querySelector<HTMLInputElement>("[data-page-selection-composer='ready'] input")!;
    await type(input, "Plus court");
    expect(host.querySelector<HTMLButtonElement>("[data-page-selection-send]")!.disabled).toBe(false);
    await key(input, "Enter");
    expect(onSend).toHaveBeenCalledWith("Plus court", { pageId: "abcdefgh12345678", title: "Bilan", version: 1, selection: anchor });
    expect(host.querySelector("[data-page-selection-composer='working'] [data-page-selection-working]")).not.toBeNull();
  });

  it("Escape puts the composer away and drops the selection in the page, without closing the page", async () => {
    const onClose = vi.fn();
    render({ ask: ask(), onClose });
    await flush();
    wireFrame();
    await post(selected());
    await key(host.querySelector<HTMLInputElement>("[data-page-selection-composer] input")!, "Escape");
    expect(host.querySelector("[data-page-selection-ask]")).toBeNull();
    expect(pageWindow.postMessage).toHaveBeenCalledWith(pageSelectionRequest(null), "*");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is offered only where it is given (the person's own page over its bot's conversation)", async () => {
    render({});
    await flush();
    wireFrame();
    await post(selected());
    expect(host.querySelector("[data-page-selection-ask]")).toBeNull();
  });

  it("the composer goes under the passage, over it near the bottom, and never past a side", () => {
    expect(selectionComposerPlace({ x: 40, y: 120, w: 200, h: 18 }, 800, 600)).toEqual({ left: 40, top: 146, width: 380 });
    expect(selectionComposerPlace({ x: 40, y: 560, w: 200, h: 18 }, 800, 600)).toEqual({ left: 40, top: 508, width: 380 });
    expect(selectionComposerPlace({ x: 700, y: 120, w: 60, h: 18 }, 800, 600)).toEqual({ left: 412, top: 146, width: 380 });
    expect(selectionComposerPlace({ x: 10, y: 120, w: 60, h: 18 }, 300, 600)).toEqual({ left: 8, top: 146, width: 284 });
  });
});
