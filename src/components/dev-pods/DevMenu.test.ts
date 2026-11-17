// @vitest-environment happy-dom
// A pod's menu opened near the bottom of the scrolling rail is drawn on
// <body>, outside the rail, and stays inside the window (flip and shift).
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DevMenu } from "./DevMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function Harness() {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return createElement("div", { "data-scroller": "", style: { overflow: "auto", height: "200px" } },
    createElement("button", { ref: button, type: "button", "data-trigger": "", onClick: () => setOpen(true) }, "..."),
    createElement(DevMenu, { open, anchorRef: button, onClose: () => setOpen(false),
      children: createElement("button", { type: "button", role: "menuitem" }, "Move up") }));
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("dev panel menu", () => {
  it("renders outside the scrolling container and flips and shifts to stay visible near the corner", async () => {
    await act(async () => { root.render(createElement(Harness)); });
    const trigger = container.querySelector<HTMLButtonElement>("[data-trigger]")!;
    trigger.getBoundingClientRect = () => rect(970, 660, 24, 24);
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.hasAttribute("data-anchored-popover") ? rect(0, 0, 200, 160) : original.call(this);
    };
    try {
      await act(async () => { trigger.click(); });
      const menu = document.body.querySelector<HTMLElement>("[data-anchored-popover]")!;
      expect(menu).not.toBeNull();
      expect(menu.getAttribute("role")).toBe("menu");
      expect(container.querySelector("[data-scroller]")!.contains(menu)).toBe(false);
      expect(menu.parentElement).toBe(document.body);
      const top = parseFloat(menu.style.top);
      const left = parseFloat(menu.style.left);
      expect(menu.dataset.side).toBe("top");
      expect(top + 160).toBeLessThanOrEqual(700);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 200).toBeLessThanOrEqual(1000);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });
});
