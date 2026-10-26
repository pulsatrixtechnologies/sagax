import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  MODEL_IMAGE_MAX_BYTES,
  MODEL_IMAGE_MAX_EDGE,
  ModelImageRefused,
  boundedSize,
  fitImageForModel,
  fitTurnImagesForModel,
  modelImageCopyPath,
  rasterSize,
} from "./model-image.ts";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** An RGB PNG whose pixels carry some noise, so it does not compress away. */
function noisyPng(width: number, height: number, noiseEvery = 4): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  let seed = 12345;
  for (let y = 0; y < height; y += 1) {
    const at = y * row;
    for (let x = 0; x < width; x += 1) {
      const p = at + 1 + x * 3;
      raw[p] = (x * 255) / width;
      raw[p + 1] = (y * 255) / height;
      if (x % noiseEvery === 0) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        raw[p + 2] = seed >>> 24;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A 2000 x 1000 gradient, left half blue-ish (b 200), right half not (b 20).
const LOSSY_WEBP = Buffer.from("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", "base64");
// An animated WebP (VP8X animation flag, one ANMF frame): libwebp's still decoder refuses it.
const ANIMATED_WEBP = Buffer.from("UklGRnAAAABXRUJQVlA4WAoAAAASAAAAKwEAVwIAQU5JTQYAAAAAAAAAAABBTk1GRAAAAAAAAAAAACsBAFcCAGQAAABWUDhMLAAAAC8rwZUAFxBDNsjzH05gIG2bmbzJC24i+p/jP//5X6bHf/7zv0yf//znf5kC", "base64");
const LOSSLESS_WEBP = Buffer.from("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", "base64");

/** One RGB(A) pixel of an 8-bit PNG made by this server (no interlace). */
function pngPixel(png: Buffer, x: number, y: number): number[] {
  const width = png.readUInt32BE(16);
  const channels = png[25] === 6 ? 4 : 3;
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const row = 1 + width * channels;
  const filter = raw[y * row]!;
  expect(filter).toBe(0);
  const at = y * row + 1 + x * channels;
  return Array.from(raw.subarray(at, at + channels));
}

describe("model image fit", () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads the size of PNG, GIF, JPEG and WebP headers", () => {
    expect(rasterSize(noisyPng(30, 20))).toEqual({ width: 30, height: 20 });
    const gif = Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1");
    expect(rasterSize(gif)).toEqual({ width: 320, height: 240 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x17, 0x70, 0, 0, 0, 0]);
    expect(rasterSize(jpeg)).toEqual({ width: 6000, height: 4000 });
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBPVP8X", 8, "latin1");
    webp.writeUIntLE(1999, 24, 3);
    webp.writeUIntLE(999, 27, 3);
    expect(rasterSize(webp)).toEqual({ width: 2000, height: 1000 });
    expect(rasterSize(Buffer.from("not an image"))).toBeNull();
  });

  it("keeps the aspect ratio and never scales up", () => {
    expect(boundedSize({ width: 6000, height: 4000 }, 1568)).toEqual({ width: 1568, height: 1045 });
    expect(boundedSize({ width: 800, height: 600 }, 1568)).toEqual({ width: 800, height: 600 });
  });

  it("sends a small picture as it is", async () => {
    const png = noisyPng(200, 100);
    const fitted = await fitImageForModel(png, "image/png");
    expect(fitted).toMatchObject({ resized: false, mime: "image/png" });
    expect(fitted!.bytes).toBe(png);
  });

  it("fits a 12 MB 6000 x 4000 picture within the model limits, readable", async () => {
    const big = noisyPng(6000, 4000, 2);
    expect(big.length).toBeGreaterThan(12 * 1024 * 1024);
    const fitted = await fitImageForModel(big, "image/png");
    expect(fitted).not.toBeNull();
    expect(fitted!.resized).toBe(true);
    expect(fitted!.mime).toBe("image/png");
    expect(fitted!.bytes.length).toBeLessThanOrEqual(MODEL_IMAGE_MAX_BYTES);
    // What the engine gets is a real PNG of the scaled size.
    expect(rasterSize(fitted!.bytes)).toEqual(fitted!.size);
    // the picture itself, not an empty frame: a blank 1568 px PNG is a few KB
    expect(fitted!.bytes.length).toBeGreaterThan(200_000);
    expect(Math.max(fitted!.size.width, fitted!.size.height)).toBeLessThanOrEqual(MODEL_IMAGE_MAX_EDGE);
    expect(fitted!.size.width / fitted!.size.height).toBeCloseTo(1.5, 1);
  }, 60_000);

  it("hands the engine a scaled copy and keeps the stored picture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-model-image-"));
    temporary.push(dir);
    const path = join(dir, "123e4567-e89b-42d3-a456-426614174000.png");
    const big = noisyPng(3000, 2000);
    writeFileSync(path, big);
    const [image] = await fitTurnImagesForModel([{ path, mime: "image/png", bytes: big.length }], { attachmentsDir: dir });
    expect(image!.path).toBe(modelImageCopyPath(dir, path));
    expect(image!.path.startsWith(join(dir, ".model"))).toBe(true);
    expect(image!.bytes).toBe(statSync(image!.path).size);
    expect(rasterSize(readFileSync(image!.path))).toEqual({ width: 1568, height: 1045 });
    expect(statSync(path).size).toBe(big.length);
    // a second turn reuses the copy
    const [again] = await fitTurnImagesForModel([{ path, mime: "image/png", bytes: big.length }], { attachmentsDir: dir });
    expect(again).toEqual(image);
  }, 60_000);

  it("keeps a picture it cannot draw as stored instead of failing the turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-model-image-"));
    temporary.push(dir);
    const path = join(dir, "123e4567-e89b-42d3-a456-426614174001.png");
    const big = noisyPng(3000, 2000);
    writeFileSync(path, big);
    const input = { path, mime: "image/png" as const, bytes: big.length };
    const [image] = await fitTurnImagesForModel([input], {
      attachmentsDir: dir,
      render: async () => { throw new Error("no renderer"); },
    });
    expect(image).toEqual(input);
    expect(existsSync(modelImageCopyPath(dir, path))).toBe(false);
  });

  it("puts the copy of a picture in a subfolder beside it", () => {
    expect(modelImageCopyPath("/data/att", "/data/att/.office/up/1.png")).toBe("/data/att/.office/up/1.png.fit.png");
  });
});

describe("model image fit, limits", () => {
  it("scales a lossy WebP down to a PNG (resvg cannot draw it)", async () => {
    const fitted = await fitImageForModel(LOSSY_WEBP, "image/webp");
    expect(fitted).toMatchObject({ resized: true, mime: "image/png", size: { width: MODEL_IMAGE_MAX_EDGE, height: 784 } });
    expect(rasterSize(fitted!.bytes)).toEqual({ width: MODEL_IMAGE_MAX_EDGE, height: 784 });
    expect(fitted!.bytes.length).toBeLessThanOrEqual(MODEL_IMAGE_MAX_BYTES);
    // not an empty frame: the left half is blue-ish, the right half is not
    const left = pngPixel(fitted!.bytes, 100, 400);
    const right = pngPixel(fitted!.bytes, 1400, 400);
    expect(left[2]).toBeGreaterThan(150);
    expect(right[2]).toBeLessThan(80);
    expect(left[0]).toBeLessThan(right[0]);
  });

  it("scales a lossless WebP down to a PNG", async () => {
    const fitted = await fitImageForModel(LOSSLESS_WEBP, "image/webp");
    expect(fitted).toMatchObject({ resized: true, mime: "image/png" });
    expect(rasterSize(fitted!.bytes)).toEqual({ width: MODEL_IMAGE_MAX_EDGE, height: 784 });
    expect(pngPixel(fitted!.bytes, 100, 400)[2]).toBeGreaterThan(150);
  });

  it("recognises a WebP by its bytes when the stored type says otherwise", async () => {
    const fitted = await fitImageForModel(LOSSY_WEBP, "image/png");
    expect(fitted).toMatchObject({ resized: true, mime: "image/png" });
    expect(pngPixel(fitted!.bytes, 100, 400)[2]).toBeGreaterThan(150);
  });

  it("refuses a WebP too big to decode, never sending it as stored", async () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBPVP8X", 8, "latin1");
    webp.writeUIntLE(5999, 24, 3);
    webp.writeUIntLE(3999, 27, 3);
    await expect(fitImageForModel(webp, "image/webp")).rejects.toMatchObject({ reason: "too-big", status: 422 });
  });

  it("refuses a damaged WebP", async () => {
    const broken = Buffer.from(LOSSY_WEBP);
    broken.fill(0x41, 40, 400);
    await expect(fitImageForModel(broken, "image/webp")).rejects.toBeInstanceOf(ModelImageRefused);
    await expect(fitImageForModel(broken, "image/webp")).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("refuses an animated WebP (libwebp decodes stills only)", async () => {
    const large = Buffer.from(ANIMATED_WEBP);
    large.writeUIntLE(1999, 24, 3); // canvas 2000 x 1000: above the model bounds
    large.writeUIntLE(999, 27, 3);
    await expect(fitImageForModel(large, "image/webp")).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("words the refusal in French or English after the server language", async () => {
    const broken = Buffer.from(LOSSY_WEBP);
    broken.fill(0x41, 40, 400);
    const dir = mkdtempSync(join(tmpdir(), "model-image-webp-"));
    try {
      const path = join(dir, "bad.webp");
      writeFileSync(path, broken);
      const image = { path, mime: "image/webp" as const, bytes: broken.length };
      await expect(fitTurnImagesForModel([image], { attachmentsDir: dir, language: "fr" })).rejects.toThrow(/illisible/);
      await expect(fitTurnImagesForModel([image], { attachmentsDir: dir, language: "en" })).rejects.toThrow(/could not be read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scales a WebP without holding the event loop", async () => {
    let longest = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    try {
      await fitImageForModel(LOSSLESS_WEBP, "image/webp");
    } finally {
      clearInterval(timer);
    }
    expect(longest).toBeLessThan(150);
  });

  it("hands the engine a PNG copy of a WebP attachment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "model-image-webp-"));
    try {
      const path = join(dir, "photo.webp");
      writeFileSync(path, LOSSY_WEBP);
      const [out] = await fitTurnImagesForModel([{ path, mime: "image/webp", bytes: LOSSY_WEBP.length }], { attachmentsDir: dir });
      expect(out!.mime).toBe("image/png");
      expect(out!.path).toBe(modelImageCopyPath(dir, path));
      expect(rasterSize(readFileSync(out!.path))).toEqual({ width: MODEL_IMAGE_MAX_EDGE, height: 784 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never draws a picture above the pixel limit", async () => {
    const huge = Buffer.alloc(24);
    huge.writeUInt32BE(0x89504e47, 0);
    huge.write("IHDR", 12, "latin1");
    huge.writeUInt32BE(10_000, 16);
    huge.writeUInt32BE(10_000, 20);
    let drawn = false;
    expect(await fitImageForModel(huge, "image/png", async () => { drawn = true; return Buffer.alloc(0); })).toBeNull();
    expect(drawn).toBe(false);
  });

  it("refuses a copy path outside the attachments folder", () => {
    expect(() => modelImageCopyPath("/data/att", "/tmp/x.png")).toThrow();
  });
});
