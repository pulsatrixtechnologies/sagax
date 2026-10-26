// @vitest-environment happy-dom
// A widget blends into the bubble: no frame ground, tools on hover, and a
// skin change reaches the frame as a posted theme instead of a reload.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WIDGET_THEME_MESSAGE } from "@/lib/widget-kit";
import { WidgetFrame } from "./WidgetFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-skin");
});

function mount(code: string, imperfect = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(WidgetFrame, { code, imperfect })));
  return host;
}

describe("WidgetFrame", () => {
  it("marks a widget that failed its last self-check discreetly, and only that one", () => {
    expect(mount("<p>x</p>", true).querySelector("[data-widget-imperfect]")?.textContent).toBeTruthy();
    act(() => root?.unmount());
    expect(mount("<p>x</p>").querySelector("[data-widget-imperfect]")).toBeNull();
  });

  it("builds the document with the variables of the active skin", () => {
    document.documentElement.style.setProperty("--code-color-scheme", "dark");
    document.documentElement.style.setProperty("--color-panel", "#161616");
    document.documentElement.style.setProperty("--color-ink", "#f5f5f5");
    const host = mount("<div class=\"card\">x</div>");
    const iframe = host.querySelector("iframe")!;
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("--card:#161616");
    expect(srcdoc).toContain("--foreground:#f5f5f5");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.className).toContain("bg-transparent");
    expect(iframe.style.colorScheme).toBe("dark");
  });

  it("has no ground or header band: the tools are icons shown on hover or focus", () => {
    const host = mount("<p>x</p>");
    const frame = host.querySelector("[data-widget-frame]")!;
    expect(frame.className).not.toMatch(/\bbg-|\bborder\b/);
    const tools = host.querySelector("[data-widget-tools]")!;
    expect(tools.className).toContain("opacity-0");
    expect(tools.className).toContain("group-hover/widget:opacity-100");
    expect(tools.className).toContain("group-focus-within/widget:opacity-100");
    // a touch screen has no hover: the tools stay visible there
    expect(tools.className).toContain("touch:opacity-100");
    const labels = [...tools.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["View source", "Restart widget", "Full screen"]);
    // icons only: no visible words in the bar
    expect(tools.textContent).toBe("");
  });

  it("posts the new theme to the frame when the skin changes, without reloading it", async () => {
    document.documentElement.style.setProperty("--code-color-scheme", "dark");
    document.documentElement.style.setProperty("--color-panel", "#161616");
    const host = mount("<p>x</p>");
    const iframe = host.querySelector("iframe")!;
    const srcdoc = iframe.getAttribute("srcdoc");
    const post = vi.fn();
    Object.defineProperty(iframe, "contentWindow", { configurable: true, value: { postMessage: post } });

    // the tokens are read where the widget sits (happy-dom does not inherit
    // custom properties, so they are set on the widget's own element)
    const frame = host.querySelector<HTMLElement>("[data-widget-frame]")!;
    await act(async () => {
      frame.style.setProperty("--code-color-scheme", "light");
      frame.style.setProperty("--color-panel", "#fafafa");
      document.documentElement.dataset.skin = "pulsatrix-light";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const themed = post.mock.calls.map(([message]) => message as { type: string; css: string }).filter((message) => message.type === WIDGET_THEME_MESSAGE);
    expect(themed.at(-1)?.css).toContain("--card:#fafafa");
    expect(themed.at(-1)?.css).toContain("color-scheme:light");
    expect(post.mock.calls.at(-1)?.[1]).toBe("*");
    // same frame, same document: the widget keeps its state
    expect(host.querySelector("iframe")).toBe(iframe);
    expect(iframe.getAttribute("srcdoc")).toBe(srcdoc);
    expect(iframe.style.colorScheme).toBe("light");
  });
});
