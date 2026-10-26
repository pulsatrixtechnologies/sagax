// The native tee is the file people paste into bug reports, so the wiring
// that keeps credentials out of it is tested at the writer — redact.test.ts
// covers the masking function, this covers that appendNative actually calls it.
// (server/testing/setup.ts points HOME at a throwaway dir, so NATIVE_DIR is
// already isolated from the real fleet.)
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureDirs, NATIVE_DIR } from "../config.ts";
import { appendNative, withoutInlineData } from "./native.ts";

beforeAll(() => ensureDirs());

describe("appendNative", () => {
  it("masks the tokens an ACP session/new hands the agent", () => {
    appendNative("t-native", {
      dir: "out",
      source: "acp",
      msg: {
        method: "session/new",
        params: {
          mcpServers: [
            {
              name: "computer",
              env: [
                { name: "OGB_BOX_ID", value: "boat-7" },
                { name: "OGB_BOX_TOKEN", value: "box_live_dontlogme" },
              ],
            },
          ],
        },
      },
    });

    const log = readFileSync(join(NATIVE_DIR, "t-native.ndjson"), "utf8");
    expect(log).not.toContain("box_live_dontlogme");
    // the shape a debugger needs is still there: which server, which var
    expect(log).toContain("session/new");
    expect(log).toContain("OGB_BOX_TOKEN");
    expect(log).toContain("boat-7");
  });

  it("writes the log private to the user", () => {
    appendNative("t-mode", { dir: "in", source: "acp", msg: { hello: "world" } });
    const mode = statSync(join(NATIVE_DIR, "t-mode.ndjson")).mode & 0o777;
    // Windows does not implement POSIX modes; everywhere else, owner-only
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });

  it("never throws, whatever it is handed", () => {
    expect(() => appendNative("t-bad", { dir: "in", source: "acp", msg: undefined })).not.toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => appendNative("t-cyclic", { dir: "in", source: "acp", msg: cyclic })).not.toThrow();
  });
});

describe("appendNative inline data (port de OpenMausBot #3129)", () => {
  it("logs a screenshot's and a data URL's length, never their base64", () => {
    const base64 = "A".repeat(4096);
    const msg = {
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "image", mimeType: "image/png", data: base64 },
        { type: "text", text: "short" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
      ],
    };
    appendNative("t-native-inline", { dir: "in", source: "claude", msg });
    const line = readFileSync(join(NATIVE_DIR, "t-native-inline.ndjson"), "utf8").trim().split("\n").at(-1)!;
    expect(line).not.toContain(base64);
    expect(line).toContain("[base64 data: 4096 base64 chars]");
    expect(line).toContain("[image data: 4096 base64 chars]");
    expect(line).toContain(`[data URL: ${base64.length + "data:image/png;base64,".length} chars]`);
    expect(line).toContain("short");
    // the caller's message is left as it was
    expect(msg.content[1]).toMatchObject({ data: base64 });
  });

  it("keeps short data and fields that are not inline payloads", () => {
    const value = { type: "base64", data: "QUJD" };
    const plain = { data: "B".repeat(4096) };
    expect(withoutInlineData(value)).toBe(value);
    expect(withoutInlineData(plain)).toBe(plain);
  });
});
