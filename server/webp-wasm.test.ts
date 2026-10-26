import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { WEBP_DEC_WASM_GZ_BASE64 } from "./webp-wasm.generated.ts";

describe("embedded WebP decoder", () => {
  it("is byte for byte the wasm of the pinned @jsquash/webp package", () => {
    const file = createRequire(import.meta.url).resolve("@jsquash/webp/codec/dec/webp_dec.wasm");
    const packaged = readFileSync(file);
    const embedded = gunzipSync(Buffer.from(WEBP_DEC_WASM_GZ_BASE64, "base64"));
    expect(createHash("sha256").update(embedded).digest("hex")).toBe(createHash("sha256").update(packaged).digest("hex"));
  });

  it("names the same sha256 in its header", () => {
    const header = readFileSync(new URL("./webp-wasm.generated.ts", import.meta.url), "utf8");
    const embedded = gunzipSync(Buffer.from(WEBP_DEC_WASM_GZ_BASE64, "base64"));
    expect(header).toContain(`sha256 of the raw .wasm: ${createHash("sha256").update(embedded).digest("hex")}`);
  });
});
