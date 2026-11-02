// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { JumpToLatestPill } from "./JumpToLatestPill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("JumpToLatestPill", () => {
  let pane: HTMLDivElement;
  let scroller: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    pane = document.createElement("div");
    scroller = document.createElement("div");
    pane.append(scroller);
    document.body.append(pane);
    pane.getBoundingClientRect = () => rect(0, 0, 800, 600);
    scroller.getBoundingClientRect = () => rect(0, 0, 800, 600);
    root = createRoot(pane.appendChild(document.createElement("div")));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    pane.remove();
  });

  const mount = async (chip: DOMRect | null) => {
    scroller.replaceChildren();
    if (chip) {
      const node = document.createElement("button");
      node.setAttribute("data-jump-pill-avoid", "");
      node.getBoundingClientRect = () => chip;
      scroller.append(node);
    }
    const onClick = vi.fn();
    const scrollRef = createRef<HTMLElement>() as { current: HTMLElement | null };
    scrollRef.current = scroller;
    // happy-dom has no layout: the pill's box and offset parent are given.
    const proto = HTMLButtonElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      return this.hasAttribute("data-jump-pill") ? rect(340, 500, 120, 30) : original.call(this);
    };
    const parent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return pane; } });
    await act(async () => root.render(createElement(JumpToLatestPill, { onClick, bottom: 70, scrollRef })));
    proto.getBoundingClientRect = original;
    if (parent) Object.defineProperty(HTMLElement.prototype, "offsetParent", parent);
    else delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
    const pill = document.querySelector<HTMLButtonElement>("[data-jump-pill]")!;
    return { pill, onClick };
  };

  it("stays centered and jumps when nothing is under it", async () => {
    const { pill, onClick } = await mount(null);
    expect(pill.dataset.jumpPill).toBe("center");
    expect(pill.className).toContain("-translate-x-1/2");
    expect(pill.getAttribute("aria-label")).toBe("Jump to latest messages");
    pill.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("steps beside the stacked conversations chip instead of covering it", async () => {
    const { pill } = await mount(rect(300, 505, 200, 24));
    expect(pill.dataset.jumpPill).toBe("beside");
    expect(pill.style.left).toBe("508px");
    expect(pill.className).not.toContain("-translate-x-1/2");
  });

  it("hides while it cannot clear the chip", async () => {
    const { pill } = await mount(rect(60, 505, 680, 24));
    expect(pill.dataset.jumpPill).toBe("hidden");
    expect(pill.className).toContain("invisible");
    expect(pill.getAttribute("aria-hidden")).toBe("true");
  });
});
