// @vitest-environment happy-dom
// M-20261119-081 (the owner, 2026-11-19): on the bot page's header the
// mascot sat too far right. Its frame started at the name's left edge, but
// every character is drawn with air on its left (a round shape about 26px at
// 160px, the owl about 19px), so the art looked shifted. The frame now moves
// left by that air, measured on what is drawn.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { drawnLeftInset } from "./drawn-inset";
import { MascotLookPreview } from "./MascotLookPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Box = { left: number; width: number };
/** Every element's box: the frame at 100, the art from `artLeft`. */
function stubBoxes(artLeft: number) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const box: Box = this.matches("[data-mascot-frame], [data-test-frame]") ? { left: 100, width: 168 } : { left: artLeft, width: 120 };
    return { x: box.left, y: 0, left: box.left, top: 0, width: box.width, height: 120, right: box.left + box.width, bottom: 120, toJSON() {} } as DOMRect;
  });
}

describe("drawnLeftInset", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the room between the frame and the leftmost drawn shape", () => {
    stubBoxes(126);
    const frame = document.createElement("span");
    frame.setAttribute("data-test-frame", "");
    frame.innerHTML = '<svg><path d="M0 0"/><circle r="4"/></svg>';
    document.body.append(frame);
    expect(drawnLeftInset(frame)).toBe(26);
    frame.remove();
  });

  it("skips what is never painted (a clip path's geometry) and is 0 with nothing drawn", () => {
    stubBoxes(126);
    const frame = document.createElement("span");
    frame.setAttribute("data-test-frame", "");
    frame.innerHTML = "<svg><defs><clipPath><rect/></clipPath></defs></svg>";
    document.body.append(frame);
    expect(drawnLeftInset(frame)).toBe(0);
    frame.innerHTML = "";
    expect(drawnLeftInset(frame)).toBe(0);
    frame.remove();
  });
});

describe("the bot page's hero mascot", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    setLocale("en");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const hero = (profile: boolean) => createElement(MascotLookPreview, {
    bot: { name: "Pebble", color: "green" },
    // the owl draws its SVG in React (a shape's engine paints after mount, in the browser)
    shown: "owl",
    shownName: "Pebble",
    shownLook: { character: "owl" } as never,
    owlSkin: "classic" as never,
    moves: [],
    owlMotion: null,
    fxMove: null,
    onPlay: () => {},
    onPlayNext: () => {},
    heading: createElement("h2", null, "Pebble"),
    profile,
  });

  it("regression M-20261119-081: moves its frame left by the air its art leaves, so the art lines up with the name", async () => {
    stubBoxes(126);
    await act(async () => { root.render(hero(true)); });
    const frame = host.querySelector<HTMLElement>("[data-mascot-frame]")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("data-mascot-art-inset")).toBe("26");
    expect(frame.style.marginLeft).toBe("-26px");
  });

  it("leaves a frame whose art starts at its edge where it is", async () => {
    stubBoxes(100);
    await act(async () => { root.render(hero(true)); });
    const frame = host.querySelector<HTMLElement>("[data-mascot-frame]")!;
    expect(frame.getAttribute("data-mascot-art-inset")).toBe("0");
    expect(frame.style.marginLeft).toBe("");
  });
});
