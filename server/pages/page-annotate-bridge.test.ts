// The frame's side of Annotate (ANNOTATE_BRIDGE_SOURCE in
// server/pages/published-pages-render.ts), run in a document: dormant until its
// parent turns annotation mode on; a selection becomes an anchor with the
// page's own words; anchors are found again, the right occurrence by what
// comes before and after; only messages from the parent are heard.
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ANNOTATE_BRIDGE_SOURCE, STATE_BRIDGE_SOURCE } from "./published-pages-render.ts";

let posted: unknown[] = [];
let win: Window;
let document: Window["document"];
const parent = { postMessage: (message: unknown) => { posted.push(message); } };

/** A fresh page in its own window, whose parent (the wrapper) records what
 * the frame posts. */
function load(html: string) {
  win = new Window({ url: "https://frame.example/" });
  Object.defineProperty(win, "parent", { value: parent });
  document = win.document;
  document.body.innerHTML = html;
  posted = [];
  new Function("window", "document", ANNOTATE_BRIDGE_SOURCE)(win, document);
}

function fromParent(data: unknown, source: unknown = parent) {
  win.dispatchEvent(new win.MessageEvent("message", { data, source: source as never }));
}

async function select(node: unknown, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node as never, start);
  range.setEnd(node as never, end);
  win.getSelection()!.removeAllRanges();
  win.getSelection()!.addRange(range);
  document.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

afterEach(() => { void win?.happyDOM.close(); });

describe("the frame's side of Annotate", () => {
  it("says nothing about a selection until its parent turns annotation mode on", async () => {
    load("<p>Premier paragraphe du rapport.</p>");
    await select(document.querySelector("p")!.firstChild, 0, 7);
    expect(posted).toEqual([]);
    // a page's own script posting as if it were the parent is not heard
    fromParent({ type: "sagax-annotate-mode", v: 1, on: true }, win);
    await select(document.querySelector("p")!.firstChild, 0, 7);
    expect(posted).toEqual([]);
  });

  it("a selection becomes an anchor: the words, a little before and after, a path", async () => {
    load("<h1>Titre</h1><p>Le volume a augmenté de 12 % ce mois.</p>");
    fromParent({ type: "sagax-annotate-mode", v: 1, on: true });
    await select(document.querySelector("p")!.firstChild, 3, 9);
    expect(posted).toEqual([{ type: "sagax-annotate-select", v: 1, anchor: { kind: "text", quote: "volume", prefix: "TitreLe ", suffix: " a augmenté de 12 % ce mois.", path: "body > p", tag: "p" } }]);
  });

  it("finds each anchor again, the right occurrence by its context, and tells the order in the page", () => {
    load("<p>Total : 12 postes.</p><p>Réseau : 12 postes.</p>");
    fromParent({ type: "sagax-annotate-marks", v: 1, marks: [
      { id: "second", resolved: false, active: false, anchor: { kind: "text", quote: "12 postes", prefix: "Réseau : ", suffix: ".", path: "body", tag: "p" } },
      { id: "first", resolved: false, active: false, anchor: { kind: "text", quote: "12 postes", prefix: "Total : ", suffix: ".", path: "body", tag: "p" } },
      { id: "gone", resolved: false, active: false, anchor: { kind: "text", quote: "absent", prefix: "", suffix: "", path: "body", tag: "p" } },
    ] });
    const found = posted.find((message) => (message as { type?: string }).type === "sagax-annotate-found") as { ids: string[] };
    // happy-dom lays nothing out (every top is 0): page order falls back to the order found
    expect(found.ids.sort()).toEqual(["first", "second"]);
    expect(found.ids).not.toContain("gone");
  });

  it("a part of the page is anchored by a click, never followed", () => {
    load('<table><tbody><tr><td>Réseau</td><td><a href="https://example.com/x">31</a></td></tr></tbody></table>');
    fromParent({ type: "sagax-annotate-mode", v: 1, on: true });
    const link = document.querySelector("a")!;
    const click = new win.MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(posted).toEqual([{ type: "sagax-annotate-select", v: 1, anchor: { kind: "element", quote: "31", prefix: "", suffix: "", path: "body > table > tbody > tr > td:nth-of-type(2) > a", tag: "a" } }]);
  });

  it("uses no network", () => {
    for (const word of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "location", "open("]) expect(ANNOTATE_BRIDGE_SOURCE).not.toContain(word);
  });
});

describe("the frame's shared state (#1544)", () => {
  function loadState() {
    load("<p>x</p>");
    new Function("window", "document", STATE_BRIDGE_SOURCE)(win, document);
    return (win as unknown as { sagax: { page: { ready: Promise<void>; get(k: string): unknown; entry(k: string): unknown; all(): unknown; canWrite(k?: string): boolean; level(k: string): string; me(): string; set(k: string, v: unknown): Promise<boolean>; subscribe(f: (s: unknown) => void): () => void } } }).sagax.page;
  }

  it("asks its parent for the state, and hears only its parent", async () => {
    const page = loadState();
    expect(posted).toEqual([{ type: "sagax-state-ask", v: 1 }]);
    const seen: unknown[] = [];
    page.subscribe((state) => seen.push(state));
    fromParent({ type: "sagax-state", v: 1, entries: { k: { value: 1, name: "Evil", at: 1 } } }, win);
    expect(page.get("k")).toBeUndefined();
    fromParent({ type: "sagax-state", v: 1, canWrite: true, entries: { "ticket:1": { value: { taken: true }, name: "Reader", at: 5 } } });
    await page.ready;
    expect(page.get("ticket:1")).toEqual({ taken: true });
    expect(page.entry("ticket:1")).toEqual({ value: { taken: true }, name: "Reader", at: 5 });
    expect(page.canWrite()).toBe(true);
    expect(seen).toHaveLength(1);
    // a copy: the page cannot change what the next reader sees by mutating it
    (page.get("ticket:1") as { taken: boolean }).taken = false;
    expect(page.get("ticket:1")).toEqual({ taken: true });
  });

  it("a set goes to its parent and resolves with its answer", async () => {
    const page = loadState();
    const done = page.set("ticket:1", { taken: true });
    expect(posted.at(-1)).toEqual({ type: "sagax-state-set", v: 1, id: 1, key: "ticket:1", value: { taken: true } });
    fromParent({ type: "sagax-state-result", v: 1, id: 1, ok: true });
    await expect(done).resolves.toBe(true);
    const refused = page.set("ticket:2", 1);
    fromParent({ type: "sagax-state-result", v: 1, id: 2, ok: false, error: "Sign in to change this page." });
    await expect(refused).rejects.toThrow("Sign in to change this page.");
  });

  it("knows who writes which key as the wrapper tells (2026-10-29), and the reader's handle", async () => {
    const page = loadState();
    fromParent({ type: "sagax-state", v: 1, canWrite: true, me: "h1", access: { role: "anon", rules: { "vote:*": "anyone", decision: "owner" }, locked: ["vote:closed"], publicLink: true }, entries: { "vote:h1": { value: "yes", name: "Anonyme", at: 5, who: "h1" } } });
    await page.ready;
    expect(page.me()).toBe("h1");
    expect(page.entry("vote:h1")).toEqual({ value: "yes", name: "Anonyme", at: 5, who: "h1" });
    expect(page.canWrite()).toBe(true);
    expect(page.canWrite("vote:x")).toBe(true);
    expect(page.canWrite("vote:closed")).toBe(false);
    expect(page.canWrite("decision")).toBe(false);
    expect(page.canWrite("other")).toBe(false);
    expect(page.level("vote:x")).toBe("anyone");
    expect(page.level("other")).toBe("signed_in");
    fromParent({ type: "sagax-state", v: 1, canWrite: true, access: { role: "owner", rules: { decision: "owner" }, locked: [], publicLink: false }, entries: {} });
    expect(page.canWrite("decision")).toBe(true);
  });

  it("cannot be replaced by the page, and uses no network", () => {
    loadState();
    expect(() => { (win as unknown as { sagax: unknown }).sagax = {}; }).toThrow();
    for (const word of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "location"]) expect(STATE_BRIDGE_SOURCE).not.toContain(word);
  });
});
