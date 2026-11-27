// @vitest-environment happy-dom
// The seats as a page holds them (#5404, shape-alive.ts useAliveSeat): the
// faces of a group's stack share one seat, a mascot only just off screen has
// none (no margin), and the turns stop while the window is hidden.
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AliveSeatAskContext, setAliveSeats, useAliveSeat, ALIVE_TURN_MS, type AliveSeatAsk } from "./shape-alive";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** An IntersectionObserver the test drives. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  takeRecords() { return []; }
}

function Face({ id, busy = false }: { id: string; busy?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const on = useAliveSeat(ref, true, busy);
  return createElement("span", { ref, "data-id": id, "data-on": on ? "1" : "0" });
}
const face = (id: string, ask?: AliveSeatAsk) => createElement(AliveSeatAskContext.Provider, { key: id, value: ask ?? null }, createElement(Face, { id }));

let host: HTMLDivElement;
let root: Root;
let hidden = false;
const el = (id: string) => host.querySelector(`[data-id="${id}"]`)!;
const on = () => [...host.querySelectorAll("[data-on='1']")].map((node) => node.getAttribute("data-id")).sort();
function show(id: string, visible = true) {
  act(() => {
    for (const observer of FakeObserver.all) {
      if (observer.targets.has(el(id))) observer.callback([{ target: el(id), isIntersecting: visible } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    }
  });
}

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => setAliveSeats(null));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the seats as a page holds them", () => {
  it("asks with no margin around the screen: a mascot only just off it (a closed drawer) has no seat", () => {
    act(() => root.render([face("a"), face("b")]));
    expect(FakeObserver.all.length).toBeGreaterThan(0);
    for (const observer of FakeObserver.all) expect(observer.options?.rootMargin ?? "0px").toMatch(/^0(px)?$/);
    show("a");
    expect(on()).toEqual(["a"]);
    show("a", false);
    expect(on()).toEqual([]);
  });

  it("lets the faces of one group's stack share one seat", () => {
    act(() => setAliveSeats(2));
    const stack = { share: "stack-1" };
    act(() => root.render([face("f1", stack), face("f2", stack), face("f3", stack), face("a"), face("b")]));
    for (const id of ["f1", "f2", "f3", "a", "b"]) show(id);
    // the stack is one seat, a row the other one: four mascots alive on two seats
    expect(on()).toHaveLength(4);
    expect(on()).toEqual(expect.arrayContaining(["f1", "f2", "f3"]));
    // a face off screen lives no more, the others keep the seat
    show("f3", false);
    expect(on()).toEqual(expect.arrayContaining(["f1", "f2"]));
    expect(on()).not.toContain("f3");
  });

  it("keeps the pinned tile's seat through the turns", () => {
    vi.useFakeTimers();
    act(() => setAliveSeats(2));
    act(() => root.render([face("tile", { keep: true }), face("a"), face("b"), face("c")]));
    for (const id of ["a", "b", "c", "tile"]) show(id);
    for (let turn = 0; turn < 8; turn += 1) {
      expect(on(), `turn ${turn}`).toContain("tile");
      expect(on()).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(ALIVE_TURN_MS); });
    }
  });

  it("takes no turn while the window is hidden, and takes them again once it shows", () => {
    vi.useFakeTimers();
    act(() => setAliveSeats(1));
    act(() => root.render([face("a"), face("b"), face("c")]));
    for (const id of ["a", "b", "c"]) show(id);
    const first = on();
    expect(first).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(ALIVE_TURN_MS); });
    const second = on();
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
    // hidden: no timer runs, nothing changes hands
    hidden = true;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(ALIVE_TURN_MS * 4); });
    expect(on()).toEqual(second);
    // shown again: the turns go on
    hidden = false;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    act(() => { vi.advanceTimersByTime(ALIVE_TURN_MS); });
    expect(on()).toHaveLength(1);
    expect(on()).not.toEqual(second);
  });
});
