// Scale a WebP down and encode a PNG (2026-10-21), for the one format resvg
// cannot draw. These functions are synchronous and heavy: they run in the
// worker thread (webp-scale-worker.ts), never on the server's main thread. Box filter (average of the source pixels under each target pixel):
// good for the large reductions a phone photo needs, no native module.
import { deflateSync } from "node:zlib";

import type { DecodedWebp } from "./webp-decode.ts";
import { decodeWebp } from "./webp-decode.ts";

export interface Size {
  width: number;
  height: number;
}

/** Average `source` RGBA down to `size` (never up). */
export function boxScale(source: DecodedWebp, size: Size): { width: number; height: number; data: Uint8Array } {
  const { width: sw, height: sh, data: src } = source;
  const tw = Math.max(1, Math.min(size.width, sw));
  const th = Math.max(1, Math.min(size.height, sh));
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty += 1) {
    const y0 = Math.floor((ty * sh) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * sh) / th));
    for (let tx = 0; tx < tw; tx += 1) {
      const x0 = Math.floor((tx * sw) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * sw) / tw));
      // Alpha-weighted, so a transparent pixel does not darken its neighbours.
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = (y * sw + x) * 4;
          const alpha = src[p + 3]!;
          r += src[p]! * alpha;
          g += src[p + 1]! * alpha;
          b += src[p + 2]! * alpha;
          a += alpha;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (ty * tw + tx) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: tw, height: th, data: out };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) for (const byte of part) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4), data), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode RGBA as a PNG: RGB (colour type 2) when nothing is transparent. */
export function encodePng(image: { width: number; height: number; data: Uint8Array }): Buffer {
  const { width, height, data } = image;
  let opaque = true;
  for (let p = 3; p < data.length; p += 4) if (data[p] !== 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4;
  const row = 1 + width * channels;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    const at = y * row + 1;
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const o = at + x * channels;
      raw[o] = data[p]!;
      raw[o + 1] = data[p + 1]!;
      raw[o + 2] = data[p + 2]!;
      if (!opaque) raw[o + 3] = data[p + 3]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Decode, scale and encode on the calling thread. Only the worker runs this
 * (webp-scale.worker.ts): a 16 Mpx picture holds the thread for seconds. */
export async function scaleWebpInline(bytes: Uint8Array, size: Size): Promise<Buffer> {
  return encodePng(boxScale(await decodeWebp(bytes), size));
}
