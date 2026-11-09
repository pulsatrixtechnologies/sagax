// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemeImage } from "./MemeImage";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: String(query).includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MemeImage", () => {
  it("renders attribution and caption", () => {
    act(() => root.render(createElement(MemeImage, {
      src: "https://example.test/meme.gif",
      attribution: "Via Tenor",
      caption: "This is fine",
      alt: "fine dog",
    })));
    expect(container.querySelector("[data-meme-image]")).not.toBeNull();
    expect(container.querySelector("[data-meme-attribution]")?.textContent).toBe("Via Tenor");
    expect(container.querySelector("[data-meme-caption]")?.textContent).toBe("This is fine");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.test/meme.gif");
  });

  it("marks reduced motion when prefers-reduced-motion is on", () => {
    act(() => root.render(createElement(MemeImage, {
      src: "https://example.test/meme.gif",
      attribution: "Via GIPHY",
    })));
    expect(container.querySelector("[data-meme-motion]")?.getAttribute("data-meme-motion")).toBe("reduced");
  });

  it("shows the GIF whole: no cover crop, never squashed by a height cap", () => {
    act(() => root.render(createElement(MemeImage, { src: "https://example.test/m.gif", attribution: "Via GIPHY" })));
    const img = container.querySelector("[data-meme-img]") as HTMLImageElement;
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
    expect(img.className).toContain("h-auto");
    expect(container.querySelector("button")!.className).toContain("shrink-0");
  });
});
