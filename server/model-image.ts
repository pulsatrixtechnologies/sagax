// Fit an image for a model before a turn sends it (2026-10-20).
//
// Every picture a turn hands an engine (a composer attachment, a picture
// read out of an Office document) goes through fitTurnImagesForModel. A
// vision API refuses or chokes on a large picture: Claude takes at most 5 MB
// and 8000 px per image and recommends a long edge of about 1568 px; other
// engines are stricter. A phone photo is often 6000 x 4000 px and 12 MB, and
// before this a bot answered that the picture was "too heavy" to open.
//
// So a picture above MODEL_IMAGE_MAX_EDGE px on its long edge, or above
// MODEL_IMAGE_MAX_BYTES, is scaled down once (resvg, already shipped for
// charts and avatars) into a PNG copy, and that copy is what the engine gets.
// The original stays as stored: the person still sees it full size. A copy
// still too heavy is scaled further. A picture already within both bounds is
// sent as is. A picture that cannot be read stays as it was: the engine says
// what it sees, never a size refusal from here.
//
// Copies of top-level attachments live in `<attachments>/.model/`, removed
// with their upload (see modelImageCopyPath's callers); copies of a picture
// in a subfolder (`.office/<upload>/`) sit beside it and go with that folder.
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import type { renderAsync as RenderAsync } from "@resvg/resvg-js";

import { ATTACHMENTS_DIR, modelImageCopyPath } from "./attachments.ts";
import type { TurnImageInput } from "./contracts.ts";
import { nativeRequire } from "./data/engine.ts";
import { serverApprovalWords } from "./approval-words.ts";
import { WebpUndecodable, scaleWebpOffThread } from "./webp-scale-worker.ts";

/** Claude's recommended long edge; beyond it a model only scales down itself. */
export const MODEL_IMAGE_MAX_EDGE = 1568;
/** Per-image bound, with room for base64 under the 5 MB API limit. */
export const MODEL_IMAGE_MAX_BYTES = 3_750_000;
/** Smallest long edge tried before keeping the smallest copy made. */
const MIN_EDGE = 512;
/** A side above this is not decoded (a 20000 px side is already absurd). */
const MAX_SOURCE_SIDE = 20_000;
/** Most pixels drawn for one picture (resvg holds them all, 4 bytes each). */
const MAX_SOURCE_PIXELS = 50_000_000;
/** A WebP is decoded to RGBA in memory (4 bytes a pixel) in a worker thread:
 * a larger one is refused. */
export const MAX_WEBP_PIXELS = 16_000_000;

export type ModelImageRefusalReason = "too-big" | "unreadable";

/** A WebP that cannot be shrunk for the model (too big to decode, damaged,
 * animated). The turn is refused with a message; the original is never sent. */
export class ModelImageRefused extends Error {
  readonly status = 422;
  readonly reason: ModelImageRefusalReason;
  constructor(reason: ModelImageRefusalReason, language?: string) {
    super(refusalText(reason, language));
    this.reason = reason;
  }
}

const REFUSALS: Record<"en" | "fr", Record<ModelImageRefusalReason, string>> = {
  en: {
    "too-big": "This WebP picture is too large to shrink for the model (over 16 megapixels). Send it as a PNG or JPEG, or make it smaller.",
    unreadable: "This WebP picture could not be read (it is damaged or animated). Send it as a PNG or JPEG.",
  },
  fr: {
    "too-big": "Cette image WebP est trop grande pour être réduite avant d'aller au modèle (plus de 16 mégapixels). Envoyez-la en PNG ou en JPEG, ou réduisez-la.",
    unreadable: "Cette image WebP est illisible (abîmée ou animée). Envoyez-la en PNG ou en JPEG.",
  },
};

function refusalText(reason: ModelImageRefusalReason, language?: string): string {
  const locale = serverApprovalWords(language).locale;
  return REFUSALS[locale.startsWith("fr") ? "fr" : "en"][reason];
}

function isWebp(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/webp") return true;
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  return view.length === 12 && view.toString("latin1", 0, 4) === "RIFF" && view.toString("latin1", 8, 12) === "WEBP";
}

export interface RasterSize {
  width: number;
  height: number;
}

/** The pixel size a PNG, JPEG, GIF or WebP declares in its header; null when
 * it cannot be read. Nothing is decoded. */
export function rasterSize(bytes: Uint8Array): RasterSize | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  if (view.length >= 24 && view.readUInt32BE(0) === 0x89504e47 && view.toString("latin1", 12, 16) === "IHDR") {
    return ok(view.readUInt32BE(16), view.readUInt32BE(20));
  }
  if (view.length >= 10 && view.toString("latin1", 0, 3) === "GIF") {
    return ok(view.readUInt16LE(6), view.readUInt16LE(8));
  }
  if (view.length >= 30 && view.toString("latin1", 0, 4) === "RIFF" && view.toString("latin1", 8, 12) === "WEBP") {
    const chunk = view.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return ok(view.readUInt16LE(26) & 0x3fff, view.readUInt16LE(28) & 0x3fff);
    if (chunk === "VP8L") {
      const b = view.readUInt32LE(21);
      return ok((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") return ok(view.readUIntLE(24, 3) + 1, view.readUIntLE(27, 3) + 1);
    return null;
  }
  if (view.length >= 4 && view[0] === 0xff && view[1] === 0xd8) {
    let at = 2;
    while (at + 9 < view.length) {
      if (view[at] !== 0xff) return null;
      const marker = view[at + 1]!;
      if (marker === 0xff) { at += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = view.readUInt16BE(at + 2);
      if (length < 2) return null;
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok(view.readUInt16BE(at + 7), view.readUInt16BE(at + 5));
      }
      at += 2 + length;
    }
  }
  return null;
}

/** The size scaled so the long edge is at most `edge`, never up. */
export function boundedSize(size: RasterSize, edge: number): RasterSize {
  const long = Math.max(size.width, size.height);
  if (long <= edge) return size;
  const scale = edge / long;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** Draw `bytes` at `size` px as a PNG. Injectable for tests. */
export type ScaleRenderer = (bytes: Buffer, mime: TurnImageInput["mime"], size: RasterSize) => Promise<Buffer>;

let resvgModule: { renderAsync: typeof RenderAsync } | null = null;
/** resvg off the main thread (its async render runs on the libuv pool), so a
 * 6000 x 4000 photo never stalls the server for other people. */
export const resvgScale: ScaleRenderer = async (bytes, mime, size) => {
  resvgModule ??= nativeRequire()("@resvg/resvg-js") as { renderAsync: typeof RenderAsync };
  const href = `data:${mime};base64,${bytes.toString("base64")}`;
  const { width, height } = size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" preserveAspectRatio="none" href="${href}"/></svg>`;
  return Buffer.from((await resvgModule.renderAsync(svg, { fitTo: { mode: "original" } })).asPng());
};

export interface FittedImage {
  bytes: Buffer;
  mime: TurnImageInput["mime"];
  size: RasterSize;
  resized: boolean;
}

/** Fit one picture: long edge at most MODEL_IMAGE_MAX_EDGE, at most
 * MODEL_IMAGE_MAX_BYTES. Null when it cannot be read or drawn. */
export async function fitImageForModel(bytes: Buffer, mime: TurnImageInput["mime"], renderer?: ScaleRenderer): Promise<FittedImage | null> {
  const size = rasterSize(bytes);
  const webp = isWebp(bytes, mime);
  if (!size) {
    // An unreadable header is only the model's problem when the file is small.
    if (webp && bytes.length > MODEL_IMAGE_MAX_BYTES) throw new ModelImageRefused("unreadable");
    return null;
  }
  if (Math.max(size.width, size.height) <= MODEL_IMAGE_MAX_EDGE && bytes.length <= MODEL_IMAGE_MAX_BYTES) {
    return { bytes, mime, size, resized: false };
  }
  // resvg 2.6 draws a WebP as an empty frame, so a WebP is decoded by libwebp
  // in a worker thread (webp-scale-worker.ts) and comes out as a PNG like any
  // other format. One that cannot be shrunk is refused, never sent as stored.
  if (webp && size.width * size.height > MAX_WEBP_PIXELS) throw new ModelImageRefused("too-big");
  if (size.width > MAX_SOURCE_SIDE || size.height > MAX_SOURCE_SIDE || size.width * size.height > MAX_SOURCE_PIXELS) return null;
  const render = renderer ?? (webp ? (data: Buffer, _mime: TurnImageInput["mime"], to: RasterSize) => scaleWebpOffThread(data, to) : resvgScale);
  let edge = Math.min(MODEL_IMAGE_MAX_EDGE, Math.max(size.width, size.height));
  let smallest: FittedImage | null = null;
  for (;;) {
    const target = boundedSize(size, edge);
    let out: Buffer;
    try {
      out = await render(bytes, mime, target);
    } catch (error) {
      if (webp && error instanceof WebpUndecodable) throw new ModelImageRefused("unreadable");
      return smallest;
    }
    if (!rasterSize(out)) return smallest;
    const fitted: FittedImage = { bytes: out, mime: "image/png", size: target, resized: true };
    if (out.length <= MODEL_IMAGE_MAX_BYTES) return fitted;
    smallest = fitted;
    if (edge <= MIN_EDGE) return smallest;
    edge = Math.max(MIN_EDGE, Math.floor(edge * 0.75));
  }
}

export { modelImageCopyPath };

export interface FitTurnImagesOptions {
  attachmentsDir?: string;
  render?: ScaleRenderer;
  /** The server's language setting: words the refusal of a WebP in it. */
  language?: string;
}

/** The turn's pictures as the engine should get them: each one within the
 * model bounds, a scaled copy where the stored picture is too large. */
export async function fitTurnImagesForModel(images: readonly TurnImageInput[], options: FitTurnImagesOptions = {}): Promise<TurnImageInput[]> {
  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  // One at a time: each draw holds a decoded picture in memory.
  const out: TurnImageInput[] = [];
  for (const image of images) out.push(await fitOne(image, attachmentsDir, options.render, options.language));
  return out;
}

async function fitOne(image: TurnImageInput, attachmentsDir: string, render: ScaleRenderer | undefined, language?: string): Promise<TurnImageInput> {
  try {
    const copy = modelImageCopyPath(attachmentsDir, image.path);
    if (existsSync(copy) && statSync(copy).mtimeMs >= statSync(image.path).mtimeMs) {
      return { path: copy, mime: "image/png", bytes: statSync(copy).size };
    }
    const bytes = await readFile(image.path);
    const fitted = await fitImageForModel(bytes, image.mime, render);
    if (!fitted || !fitted.resized) return image;
    mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
    const temp = `${copy}.${randomUUID()}.tmp`;
    await writeFile(temp, fitted.bytes, { mode: 0o600 });
    chmodSync(temp, 0o600);
    await rename(temp, copy);
    return { path: copy, mime: fitted.mime, bytes: fitted.bytes.length };
  } catch (error) {
    if (error instanceof ModelImageRefused) throw new ModelImageRefused(error.reason, language);
    console.warn(`model image: kept as stored (${error instanceof Error ? error.message : "unknown"})`);
    return image;
  }
}
