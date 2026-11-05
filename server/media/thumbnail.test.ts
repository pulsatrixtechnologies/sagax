import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearThumbnailCache, THUMB_EDGE, thumbnailable, thumbnailFor } from "./thumbnail.ts";

const png = (width: number, height: number) => {
  const head = Buffer.alloc(33);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "latin1");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
};

describe("Library thumbnails", () => {
  beforeEach(() => clearThumbnailCache());

  it("only pictures the app can draw have one", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "IMAGE/PNG"]) expect(thumbnailable(mime)).toBe(true);
    for (const mime of ["image/heic", "application/pdf", "text/plain", "video/mp4"]) expect(thumbnailable(mime)).toBe(false);
  });

  it("draws a THUMB_EDGE square once and serves the same bytes from the cache", async () => {
    const render = vi.fn(async () => Buffer.from("small"));
    const load = vi.fn(async () => png(4000, 3000));
    const first = await thumbnailFor("k1", load, "image/png", render);
    const second = await thumbnailFor("k1", load, "image/png", render);
    expect(first?.toString()).toBe("small");
    expect(second).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(expect.anything(), "image/png", THUMB_EDGE);
    // the cached call does not read the picture again
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives null for a type it cannot draw, an unreadable header, a huge picture or a renderer failure", async () => {
    const render = vi.fn(async () => Buffer.from("x"));
    expect(await thumbnailFor("a", async () => Buffer.from("x"), "application/pdf", render)).toBeNull();
    expect(await thumbnailFor("b", async () => Buffer.from("not an image"), "image/png", render)).toBeNull();
    expect(await thumbnailFor("c", async () => png(20_000, 20_000), "image/png", render)).toBeNull();
    expect(await thumbnailFor("d", async () => png(10, 10), "image/png", async () => { throw new Error("bad"); })).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("draws an SVG without needing a raster header", async () => {
    const render = vi.fn(async () => Buffer.from("svg-thumb"));
    expect((await thumbnailFor("s", async () => Buffer.from("<svg/>"), "image/svg+xml", render))?.toString()).toBe("svg-thumb");
  });
});
