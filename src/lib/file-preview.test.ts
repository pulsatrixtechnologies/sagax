import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTextPreviewCache, filePreviewKind, firstLines, loadTextPreview, TEXT_PREVIEW_BYTES } from "./file-preview";

const file = (name: string, extra: { mime?: string; size?: number | null; available?: boolean } = {}) =>
  ({ name, mime: extra.mime, size: extra.size ?? 100, available: extra.available ?? true });

describe("filePreviewKind", () => {
  it("shows the picture of an image", () => {
    expect(filePreviewKind(file("photo.png"))).toBe("image");
    expect(filePreviewKind(file("scan", { mime: "image/jpeg" }))).toBe("image");
  });

  it("shows the first lines of text, markdown and code", () => {
    for (const name of ["notes.txt", "README.md", "app.tsx", "data.json", "run.sh"]) expect(filePreviewKind(file(name))).toBe("text");
    expect(filePreviewKind(file("blob", { mime: "text/plain" }))).toBe("text");
  });

  it("falls back to the icon and size for the rest", () => {
    expect(filePreviewKind(file("report.pdf"))).toBe("meta");
    expect(filePreviewKind(file("archive.zip"))).toBe("meta");
    expect(filePreviewKind(file("deck.pptx"))).toBe("meta");
    expect(filePreviewKind(file("huge.log", { size: 50 * 1024 * 1024 }))).toBe("meta");
    expect(filePreviewKind(file("gone.png", { available: false }))).toBe("meta");
  });
});

describe("firstLines", () => {
  it("keeps twelve lines and drops a cut last line", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    expect(firstLines(text, false).split("\n")).toHaveLength(12);
    expect(firstLines("a\nb\nhal", true)).toBe("a\nb");
    expect(firstLines("a\r\nb\r\n", false)).toBe("a\nb");
  });
});

describe("loadTextPreview", () => {
  beforeEach(() => clearTextPreviewCache());

  it("reads at most the cap and caches by address", async () => {
    const big = "x\n".repeat(TEXT_PREVIEW_BYTES);
    const fetcher = vi.fn(async () => new Response(big));
    const signal = new AbortController().signal;
    const text = await loadTextPreview("/f/1", signal, fetcher as unknown as typeof fetch);
    expect(text.split("\n")).toHaveLength(12);
    await loadTextPreview("/f/1", signal, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails on an error answer", async () => {
    const fetcher = vi.fn(async () => new Response("no", { status: 404 }));
    await expect(loadTextPreview("/f/2", new AbortController().signal, fetcher as unknown as typeof fetch)).rejects.toThrow();
  });
});
