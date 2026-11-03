// Small square thumbnails for the Library tab (2026-10-28).
//
// A Library row is 24 px wide. It must never pull the full picture: the
// thumbnail route (GET /api/threads/:id/files/:fileId?thumb=1) opens the
// file under the same grant as the download, draws it once as a THUMB_EDGE px
// square (object-fit cover, resvg, already shipped for charts and avatars)
// and keeps the PNG in a small in-memory cache, so the next row render costs
// a few KB. A WebP goes through the libwebp worker first (resvg draws it
// empty). A picture that cannot be drawn gives null: the row keeps its icon.
import type { renderAsync as RenderAsync } from "@resvg/resvg-js";

import { nativeRequire } from "../data/engine.ts";
import { boundedSize, rasterSize } from "../models/model-image.ts";
import { scaleWebpOffThread } from "../webp-scale-worker.ts";

/** Side of the square, in px: 4x the 24 px icon it replaces, for dense screens. */
export const THUMB_EDGE = 96;
/** Largest source read for a thumbnail. A bigger picture keeps its icon. */
export const THUMB_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 50_000_000;
const MAX_WEBP_PIXELS = 16_000_000;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const CACHE_ENTRIES = 400;

export type ThumbMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
const THUMB_MIMES: ReadonlySet<string> = new Set<ThumbMime>(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

/** Whether a stored type can have a thumbnail. */
export function thumbnailable(mime: string): mime is ThumbMime {
  return THUMB_MIMES.has(mime.toLowerCase());
}

/** Draw `bytes` as a `edge` px square, cropped to fill. Injectable for tests. */
export type SquareRenderer = (bytes: Buffer, mime: string, edge: number) => Promise<Buffer>;

let resvgModule: { renderAsync: typeof RenderAsync } | null = null;
export const resvgSquare: SquareRenderer = async (bytes, mime, edge) => {
  resvgModule ??= nativeRequire()("@resvg/resvg-js") as { renderAsync: typeof RenderAsync };
  const href = `data:${mime};base64,${bytes.toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}"><image width="${edge}" height="${edge}" preserveAspectRatio="xMidYMid slice" href="${href}"/></svg>`;
  return Buffer.from((await resvgModule.renderAsync(svg, { fitTo: { mode: "original" } })).asPng());
};

const cache = new Map<string, Buffer>();

/** The thumbnail of one picture as a PNG, or null when it cannot be drawn.
 * `key` identifies the stored bytes (file id and size and mtime): the same
 * key returns the cached PNG without reading the picture again. */
export async function thumbnailFor(key: string, load: () => Promise<Buffer>, mime: string, render: SquareRenderer = resvgSquare): Promise<Buffer | null> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const normalized = mime.toLowerCase();
  if (!thumbnailable(normalized)) return null;
  const bytes = await load();
  let drawn: Buffer;
  try {
    if (normalized === "image/svg+xml") {
      if (bytes.length > MAX_SVG_BYTES) return null;
      drawn = await render(bytes, normalized, THUMB_EDGE);
    } else {
      const size = rasterSize(bytes);
      if (!size || size.width * size.height > MAX_SOURCE_PIXELS) return null;
      if (normalized === "image/webp") {
        if (size.width * size.height > MAX_WEBP_PIXELS) return null;
        // Shrink in the worker first, then crop the small PNG to the square.
        const small = await scaleWebpOffThread(bytes, boundedSize(size, THUMB_EDGE * 2));
        drawn = await render(small, "image/png", THUMB_EDGE);
      } else {
        drawn = await render(bytes, normalized, THUMB_EDGE);
      }
    }
  } catch {
    return null;
  }
  cache.set(key, drawn);
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  return drawn;
}

/** Tests: empty the cache. */
export function clearThumbnailCache(): void {
  cache.clear();
}
