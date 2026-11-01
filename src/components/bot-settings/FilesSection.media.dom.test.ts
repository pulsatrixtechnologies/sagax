// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ThreadFile } from "@/lib/chat-files";
import { MediaPreviewDialog } from "./FilesSection";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { loadingOlder: {} }, dispatch: vi.fn() }),
}));

const clip: ThreadFile = {
  id: "0123456789abcdef01234567",
  messageId: "message-1",
  source: "upload",
  path: "/private/clip.mp4",
  name: "clip.mp4",
  mime: "video/mp4",
  at: Date.UTC(2026, 9, 31),
  size: 1024 * 1024 * 1024,
  available: true,
};

describe("streaming media dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("gives video playback the opaque Range URL without fetching a Blob", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      root.render(createElement(MediaPreviewDialog, { threadId: "thread-1", file: clip, kind: "video", onClose: vi.fn() }));
    });
    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toBe("/api/threads/thread-1/files/0123456789abcdef01234567?preview=1");
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(fetcher).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading");
    await act(async () => video?.dispatchEvent(new Event("loadedmetadata")));
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
