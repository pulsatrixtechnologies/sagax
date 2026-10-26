// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./WidgetControls", () => ({ useWidgetForm: () => ({ imagesAllowed: true, allowImages: () => {} }) }));

const { WidgetImage } = await import("./WidgetContent");

let host: HTMLDivElement;
let root: Root;
const where = { card: undefined } as unknown as Parameters<typeof WidgetImage>[0]["where"];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("WidgetImage when the picture does not arrive", () => {
  it("says Image unavailable with a Retry, never an empty framed box, and tries again", async () => {
    const node = { id: "img-1", type: "Image", src: "https://img.example.com/gone.png", alt: "Preview", frame: true } as Parameters<typeof WidgetImage>[0]["node"];
    await act(async () => root.render(createElement(WidgetImage, { node, where })));
    const first = host.querySelector("img")!;
    expect(first.getAttribute("src")).toBe("https://img.example.com/gone.png");

    await act(async () => first.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    const alert = host.querySelector("[data-widget-image-failed]");
    expect(alert?.textContent).toContain("Image unavailable");
    const retry = alert?.querySelector("button");
    expect(retry?.textContent).toContain("Retry");
    expect(retry?.getAttribute("aria-label")).toBe("Retry loading Preview");

    await act(async () => retry!.click());
    const again = host.querySelector("img");
    expect(again).not.toBeNull();
    expect(again).not.toBe(first);
    expect(host.querySelector("[data-widget-image-failed]")).toBeNull();
  });

  it("a new address gets its own try", async () => {
    const node = (src: string) => ({ id: "img-1", type: "Image", src }) as Parameters<typeof WidgetImage>[0]["node"];
    await act(async () => root.render(createElement(WidgetImage, { node: node("https://img.example.com/a.png"), where })));
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("[data-widget-image-failed]")).not.toBeNull();
    await act(async () => root.render(createElement(WidgetImage, { node: node("https://img.example.com/b.png"), where })));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://img.example.com/b.png");
  });
});
