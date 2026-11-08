// @vitest-environment happy-dom
// #2791: a row keeps its observers when its key changes (the sidebar's
// density is part of the key), and a scroller that pans both ways (the Team
// map) gets sideways margins too.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeObserver {
  static made: FakeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit) {
    FakeObserver.made.push(this);
  }
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  FakeObserver.made = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load() {
  return (await import("./VirtualRow")).VirtualRow;
}

describe("virtualized rows keep their observers (#2791)", () => {
  it("a key change (density) neither unobserves nor observes the row again", async () => {
    const VirtualRow = await load();
    const list = (key: string) => createElement("div", { "data-virtual-root": "" },
      createElement(VirtualRow, { rowKey: key, estimate: 40, initiallyShown: true, children: "row" }));
    act(() => root.render(list("bot:comfortable:a")));
    const [near, far] = FakeObserver.made;
    expect(near!.observe).toHaveBeenCalledTimes(1);
    expect(far!.observe).toHaveBeenCalledTimes(1);
    act(() => root.render(list("bot:compact:a")));
    expect(near!.observe).toHaveBeenCalledTimes(1);
    expect(near!.unobserve).not.toHaveBeenCalled();
    expect(far!.unobserve).not.toHaveBeenCalled();
  });

  it("a list scroller reaches up and down only; a canvas marked both reaches sideways too", async () => {
    const VirtualRow = await load();
    act(() => root.render(createElement("div", null,
      createElement("div", { "data-virtual-root": "" }, createElement(VirtualRow, { rowKey: "list:a", estimate: 40, children: "a" })),
      createElement("div", { "data-virtual-root": "both" }, createElement(VirtualRow, { rowKey: "team-card:a", estimate: 126, children: "b" })),
    )));
    const margins = FakeObserver.made.map((observer) => observer.options.rootMargin);
    expect(margins).toEqual(["1200px 0px", "3000px 0px", "1200px", "3000px"]);
  });
});
