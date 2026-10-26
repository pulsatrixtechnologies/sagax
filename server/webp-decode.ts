// Decode a WebP picture to RGBA pixels (2026-10-21).
//
// resvg 2.6 draws a WebP as an empty frame, so a WebP could not go through
// the model-image downscale like a PNG or a JPEG. libwebp (WebAssembly, see
// webp-wasm.generated.ts) decodes it in memory, with no native module to
// stage in the desktop app or the container image.
import { gunzipSync } from "node:zlib";

import { WEBP_DEC_WASM_GZ_BASE64 } from "./webp-wasm.generated.ts";

export interface DecodedWebp {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel, row by row. */
  data: Uint8ClampedArray;
}

// The server tsconfig has no DOM lib; Node ships the WebAssembly global.
declare const WebAssembly: { Module: new (bytes: Uint8Array) => object };

type DecodeFn = (bytes: ArrayBuffer) => Promise<DecodedWebp>;

let decoder: Promise<DecodeFn> | null = null;

function loadDecoder(): Promise<DecodeFn> {
  decoder ??= (async () => {
    const module = await import("@jsquash/webp/decode.js");
    const wasm = new WebAssembly.Module(gunzipSync(Buffer.from(WEBP_DEC_WASM_GZ_BASE64, "base64")));
    await module.init(wasm as never);
    return module.default as DecodeFn;
  })().catch((error: unknown) => {
    decoder = null;
    throw error;
  });
  return decoder;
}

/** Decode a still WebP (lossy, lossless, with or without alpha). Throws on a
 * damaged file or an animated one: the caller keeps the picture as stored. */
export async function decodeWebp(bytes: Uint8Array): Promise<DecodedWebp> {
  const decode = await loadDecoder();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return decode(copy);
}
