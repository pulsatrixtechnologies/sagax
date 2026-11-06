// @vitest-environment happy-dom
import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  searchMemes: vi.fn(),
  materializeMeme: vi.fn(),
}));

vi.mock("@/lib/memes", () => ({
  searchMemes: fixture.searchMemes,
  materializeMeme: fixture.materializeMeme,
}));

import { MemePicker } from "./MemePicker";

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;
beforeEach(() => {
  fixture.searchMemes.mockReset();
  fixture.materializeMeme.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  anchor = document.createElement("button");
  anchor.setAttribute("data-composer-memes", "");
  document.body.append(anchor);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  anchor.remove();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("MemePicker", () => {
  it("loads trending on open and shows a setup hint without a key", async () => {
    fixture.searchMemes.mockResolvedValue({
      hits: [{
        id: "imgflip:1",
        title: "Distracted Boyfriend",
        previewUrl: "https://example.test/p.jpg",
        url: "https://example.test/f.jpg",
        width: 100,
        height: 100,
        provider: "imgflip",
        attribution: "Imgflip",
        still: true,
      }],
      keyConfigured: false,
      setupHint: "Add a key",
    });
    const onPick = vi.fn();
    const anchorRef = { current: anchor } as RefObject<HTMLElement | null>;
    act(() => root.render(createElement(MemePicker, {
      open: true,
      onClose: () => undefined,
      anchorRef,
      onPick,
    })));
    await flush();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(fixture.searchMemes).toHaveBeenCalledWith("");
    expect(container.querySelector("[data-meme-picker]")).not.toBeNull();
    expect(container.querySelector("[data-meme-setup-hint]")).not.toBeNull();
    expect(container.querySelector('[data-meme-hit="imgflip:1"]')).not.toBeNull();
    expect(container.textContent).toContain("Memes");
  });

  it("materializes a hit on click and calls onPick", async () => {
    fixture.searchMemes.mockResolvedValue({
      hits: [{
        id: "tenor:abc",
        title: "High five",
        previewUrl: "https://example.test/p.gif",
        url: "https://example.test/f.gif",
        width: 200,
        height: 150,
        provider: "tenor",
        attribution: "Via Tenor",
      }],
      keyConfigured: true,
    });
    fixture.materializeMeme.mockResolvedValue({
      attachment: {
        kind: "image",
        path: "/tmp/meme.gif",
        mime: "image/gif",
        name: "High_five.gif",
        meme: { provider: "tenor", attribution: "Via Tenor", sourceId: "tenor:abc" },
      },
    });
    const onPick = vi.fn();
    const onClose = vi.fn();
    const anchorRef = { current: anchor } as RefObject<HTMLElement | null>;
    act(() => root.render(createElement(MemePicker, {
      open: true,
      onClose,
      anchorRef,
      onPick,
    })));
    await flush();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    const hit = container.querySelector('[data-meme-hit="tenor:abc"]') as HTMLButtonElement;
    expect(hit).not.toBeNull();
    await act(async () => { hit.click(); });
    await flush();
    expect(fixture.materializeMeme).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
      path: "/tmp/meme.gif",
      meme: expect.objectContaining({ provider: "tenor", attribution: "Via Tenor" }),
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
