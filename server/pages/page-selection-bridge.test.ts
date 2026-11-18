// The app's preview frame and the person's selection (#4099,
// SELECTION_BRIDGE_SOURCE in server/pages/published-pages-render.ts), run in
// a document: a selection is posted to the app as the annotation anchor with
// its box, again on scroll or resize, a clear when it goes; the app may name
// a passage to follow in the version just drawn, or drop it; only messages
// from the app are heard; the page's content is never changed. As in the
// app, the frame sits in the preview wrapper: top is the app, parent is the
// wrapper, which relays only capability messages.
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_SELECTION_MESSAGE, pageSelectionRequest, parsePageSelectionMessage } from "../../shared/page-selection.ts";
import { SELECTION_BRIDGE_SOURCE } from "./published-pages-render.ts";

let posted: unknown[] = [];
let toWrapper: unknown[] = [];
let win: Window;
let document: Window["document"];
/** The app (window.top) and the preview wrapper between it and the frame
 * (window.parent): what reaches each is kept apart. */
// (made again by every `load`: a timer of an earlier page, which the script
// debounces a keyboard selection with, never writes in a later test's lists)
let app: { postMessage: (message: unknown) => void } = { postMessage: () => {} };
let wrapper: { postMessage: (message: unknown) => void } = { postMessage: () => {} };

function load(html: string) {
  win = new Window({ url: "https://frame.example/" });
  const mine: unknown[] = [];
  const mineWrapper: unknown[] = [];
  posted = mine;
  toWrapper = mineWrapper;
  app = { postMessage: (message) => { mine.push(message); } };
  wrapper = { postMessage: (message) => { mineWrapper.push(message); } };
  Object.defineProperty(win, "parent", { value: wrapper });
  Object.defineProperty(win, "top", { value: app });
  document = win.document;
  document.body.innerHTML = html;
  new Function("window", "document", SELECTION_BRIDGE_SOURCE)(win, document);
}

/** happy-dom lays nothing out: every box is drawn where a test says. */
function boxes(rect: { left: number; top: number; width: number; height: number }) {
  const box = { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) };
  (win.Range.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => box;
  (win.HTMLElement.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => box;
}

function fromApp(data: unknown, source: unknown = app) {
  win.dispatchEvent(new win.MessageEvent("message", { data, source: source as never }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

async function select(node: unknown, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node as never, start);
  range.setEnd(node as never, end);
  win.getSelection()!.removeAllRanges();
  win.getSelection()!.addRange(range);
  document.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
  // a moment after the pointer is up: a double or triple click is finished first
  await new Promise((resolve) => setTimeout(resolve, 340));
}

afterEach(() => { void win?.happyDOM.close(); });

describe("the preview frame's selection, for the app's in-place ask", () => {
  it("posts the selection as the annotation anchor with its box, without touching the page", async () => {
    load("<h1>Titre</h1><p>Le volume a augmenté de 12 % ce mois.</p>");
    boxes({ left: 40.4, top: 120.6, width: 80, height: 18 });
    const before = document.body.innerHTML;
    await select(document.querySelector("p")!.firstChild, 3, 9);
    expect(posted).toEqual([{ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: { kind: "text", quote: "volume", prefix: "TitreLe ", suffix: " a augmenté de 12 % ce mois.", path: "body > p", tag: "p" }, rect: { x: 40, y: 121, w: 80, h: 18 } }]);
    expect(parsePageSelectionMessage(posted[0])).toEqual({ anchor: (posted[0] as { anchor: unknown }).anchor, rect: { x: 40, y: 121, w: 80, h: 18 } });
    expect(document.body.innerHTML).toBe(before);
  });

  it("posts the box again when the page scrolls or resizes, and a clear when the selection goes", async () => {
    load("<p>Le volume a augmenté.</p>");
    boxes({ left: 10, top: 300, width: 50, height: 16 });
    await select(document.querySelector("p")!.firstChild, 3, 9);
    boxes({ left: 10, top: 100, width: 50, height: 16 });
    win.dispatchEvent(new win.Event("scroll"));
    await tick();
    expect(posted.at(-1)).toMatchObject({ type: PAGE_SELECTION_MESSAGE, rect: { x: 10, y: 100, w: 50, h: 16 } });
    boxes({ left: 4, top: 90, width: 60, height: 32 });
    win.dispatchEvent(new win.Event("resize"));
    await tick();
    expect(posted.at(-1)).toMatchObject({ rect: { x: 4, y: 90, w: 60, h: 32 } });
    // a click elsewhere in the page: the selection is gone
    win.getSelection()!.removeAllRanges();
    document.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
    await tick();
    expect(posted.at(-1)).toEqual({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: null });
    expect(parsePageSelectionMessage(posted.at(-1))).toEqual({ anchor: null });
    // nothing selected any more: a scroll says nothing
    const count = posted.length;
    win.dispatchEvent(new win.Event("scroll"));
    await tick();
    expect(posted).toHaveLength(count);
  });

  it("follows a passage the app names in the version just drawn, the right occurrence by its context, or clears", async () => {
    load("<p>Total : 12 postes.</p><p>Réseau : 12 postes.</p>");
    boxes({ left: 0, top: 50, width: 70, height: 16 });
    const anchor = { kind: "text" as const, quote: "12 postes", prefix: "Réseau : ", suffix: ".", path: "body > p:nth-of-type(2)", tag: "p" };
    fromApp(pageSelectionRequest(anchor));
    expect(posted).toEqual([{ type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect: { x: 0, y: 50, w: 70, h: 16 } }]);
    // its words are no longer in this version: the outline goes
    fromApp(pageSelectionRequest({ ...anchor, quote: "absent" }));
    expect(posted.at(-1)).toEqual({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: null });
  });

  it("talks to the app past the preview wrapper, both ways, and nothing to the wrapper", async () => {
    load("<p>Total : 12 postes.</p>");
    boxes({ left: 5, top: 20, width: 40, height: 16 });
    await select(document.querySelector("p")!.firstChild, 8, 17);
    expect(posted).toEqual([{ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: expect.objectContaining({ quote: "12 postes" }), rect: { x: 5, y: 20, w: 40, h: 16 } }]);
    // the app names a passage to follow: heard though the app is not the parent
    const anchor = { kind: "text" as const, quote: "Total", prefix: "", suffix: " : 12 postes.", path: "body > p", tag: "p" };
    fromApp(pageSelectionRequest(anchor));
    expect(posted.at(-1)).toEqual({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect: { x: 5, y: 20, w: 40, h: 16 } });
    // the app drops it: no more boxes on scroll
    fromApp(pageSelectionRequest(null));
    const count = posted.length;
    win.dispatchEvent(new win.Event("scroll"));
    await tick();
    expect(posted).toHaveLength(count);
    // the wrapper is not the app: it is neither told nor heard
    fromApp(pageSelectionRequest(anchor), wrapper);
    expect(posted).toHaveLength(count);
    expect(toWrapper).toEqual([]);
  });

  it("drops the selection when the app says so, and hears only the app", async () => {
    load("<p>Le volume a augmenté.</p>");
    boxes({ left: 0, top: 0, width: 10, height: 10 });
    // a page's own script posting as if it were the app is not heard
    fromApp(pageSelectionRequest({ kind: "text", quote: "volume", prefix: "", suffix: "", path: "body > p", tag: "p" }), win);
    expect(posted).toEqual([]);
    await select(document.querySelector("p")!.firstChild, 3, 9);
    expect(posted).toHaveLength(1);
    fromApp(pageSelectionRequest(null));
    expect(win.getSelection()!.isCollapsed || win.getSelection()!.rangeCount === 0).toBe(true);
    win.dispatchEvent(new win.Event("scroll"));
    await tick();
    expect(posted).toHaveLength(1);
  });

  it("reports a keyboard selection (Shift and the arrows, Select all) once the keys rest, and not twice for a mouse one", async () => {
    load("<p>Le volume a augmenté de 12 %.</p>");
    boxes({ left: 8, top: 40, width: 120, height: 18 });
    const node = document.querySelector("p")!.firstChild as never;
    const range = document.createRange();
    range.setStart(node, 3);
    range.setEnd(node, 9);
    win.getSelection()!.removeAllRanges();
    win.getSelection()!.addRange(range);
    // no pointer, no Shift keyup: the selection changed on its own
    document.dispatchEvent(new win.Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 420));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: PAGE_SELECTION_MESSAGE, anchor: { quote: "volume" }, rect: { x: 8, y: 40, w: 120, h: 18 } });
    // the same selection, reported again by the browser: said once
    document.dispatchEvent(new win.Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 420));
    expect(posted).toHaveLength(1);
    // a mouse selection is reported by its mouseup, not again after it
    await select(node, 12, 20);
    document.dispatchEvent(new win.Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 420));
    expect(posted.filter((message) => (message as { anchor?: { quote?: string } }).anchor?.quote === "augmenté")).toHaveLength(1);
    expect(posted.at(-1)).toMatchObject({ anchor: { quote: "augmenté" } });
  });

  it("says nothing mid-drag, only when the pointer is up", async () => {
    load("<p>Le volume a augmenté.</p>");
    boxes({ left: 0, top: 0, width: 10, height: 10 });
    const node = document.querySelector("p")!.firstChild as never;
    document.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    const range = document.createRange();
    range.setStart(node, 3);
    range.setEnd(node, 9);
    win.getSelection()!.removeAllRanges();
    win.getSelection()!.addRange(range);
    document.dispatchEvent(new win.Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 420));
    expect(posted).toEqual([]);
    document.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 340));
    expect(posted).toHaveLength(1);
  });

  it("waits for a double or triple click to finish: one report, after the last click", async () => {
    load("<p>Le volume a augmenté de 12 %.</p>");
    boxes({ left: 0, top: 0, width: 10, height: 10 });
    const node = document.querySelector("p")!.firstChild as never;
    for (const [start, end] of [[3, 9], [0, 12], [0, 29]]) {
      document.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      win.getSelection()!.removeAllRanges();
      win.getSelection()!.addRange(range);
      document.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(posted).toEqual([]);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ anchor: { quote: "Le volume a augmenté de 12 %." } });
  });

  it("Escape in the page puts the passage away: a clear to the app, the selection gone", async () => {
    load("<p>Le volume a augmenté.</p>");
    boxes({ left: 0, top: 0, width: 10, height: 10 });
    await select(document.querySelector("p")!.firstChild, 3, 9);
    expect(posted).toHaveLength(1);
    document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(posted.at(-1)).toEqual({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: null });
    expect(win.getSelection()!.rangeCount === 0 || win.getSelection()!.isCollapsed).toBe(true);
    // nothing selected: Escape says nothing
    const count = posted.length;
    document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(posted).toHaveLength(count);
  });

  it("uses no network", () => {
    for (const word of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "location", "open("]) expect(SELECTION_BRIDGE_SOURCE).not.toContain(word);
  });
});

describe("parsePageSelectionMessage", () => {
  const anchor = { kind: "text", quote: "volume", prefix: "", suffix: "", path: "body > p", tag: "p" };

  it("checks and cuts what a frame posted: an anchor with a finite box, or a clear", () => {
    expect(parsePageSelectionMessage({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect: { x: -12.4, y: 3, w: 9.6, h: 2 } })).toEqual({ anchor, rect: { x: -12, y: 3, w: 10, h: 2 } });
    expect(parsePageSelectionMessage({ type: PAGE_SELECTION_MESSAGE, v: 1, anchor: { ...anchor, quote: "x".repeat(900) }, rect: { x: 0, y: 0, w: 1, h: 1 } })!.anchor!.quote).toHaveLength(500);
    for (const bad of [
      null, "x", [], { type: "sagax-annotate-select", v: 1, anchor, rect: { x: 0, y: 0, w: 1, h: 1 } },
      { type: PAGE_SELECTION_MESSAGE, v: 2, anchor: null },
      { type: PAGE_SELECTION_MESSAGE, v: 1, anchor },
      { type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect: { x: Number.NaN, y: 0, w: 1, h: 1 } },
      { type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect: { x: 0, y: 0, w: -1, h: 1 } },
      { type: PAGE_SELECTION_MESSAGE, v: 1, anchor, rect: { x: 0, y: 0, w: "1", h: 1 } },
      { type: PAGE_SELECTION_MESSAGE, v: 1, anchor: { ...anchor, quote: " " }, rect: { x: 0, y: 0, w: 1, h: 1 } },
    ]) {
      expect(parsePageSelectionMessage(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
