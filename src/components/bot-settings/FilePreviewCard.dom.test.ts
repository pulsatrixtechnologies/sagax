// @vitest-environment happy-dom
// The library's hover card: it opens after the hover delay, at once on
// keyboard focus, closes on Escape, and shows the first lines of a text file.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn(), useStore: () => ({ state: {}, dispatch: () => undefined }) }));

import { HOVER_OPEN_DELAY_MS, HoverCard } from "../LinkHoverCard";
import { FilePreviewCard } from "./FilesSection";
import { clearTextPreviewCache } from "@/lib/file-preview";
import type { ThreadFile } from "@/lib/chat-files";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const file = (name: string): ThreadFile => ({ id: "f1", messageId: "m1", source: "upload", path: name, name, at: 0, size: 120, available: true });

describe("library hover card", () => {
  it("opens only after the delay, and Escape closes it", () => {
    vi.useFakeTimers();
    act(() => root.render(createElement(HoverCard, {
      kind: "file-preview",
      card: () => createElement("div", { "data-card": "" }, "preview"),
      children: (anchor) => createElement("button", { ...anchor, type: "button" }, "file"),
    })));
    const button = container.querySelector("button")!;
    act(() => { button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })); });
    act(() => { button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false, pointerType: "mouse" })); });
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS - 50); });
    expect(document.querySelector("[data-file-preview]")).toBeNull();
    act(() => { vi.advanceTimersByTime(60); });
    const card = document.querySelector("[data-file-preview]");
    expect(card?.getAttribute("role")).toBe("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(card?.id);
    act(() => { button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector("[data-file-preview]")).toBeNull();
  });

  it("shows the first lines of a text file", async () => {
    clearTextPreviewCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("# Title\nbody line\n")));
    await act(async () => root.render(createElement(FilePreviewCard, { threadId: "t1", file: file("notes.md") })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector("[data-file-preview-card=text] pre")?.textContent).toBe("# Title\nbody line");
    expect(container.textContent).toContain("notes.md");
  });

  it("shows the picture of an image without fetching it", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(FilePreviewCard, { threadId: "t1", file: file("photo.png") })));
    expect(container.querySelector("[data-file-preview-card=image] img")?.getAttribute("src")).toBe("/api/threads/t1/files/f1?preview=1");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
