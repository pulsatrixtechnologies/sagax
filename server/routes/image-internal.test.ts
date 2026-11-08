import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ImageInternalDeps } from "./image-internal.ts";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const capability = { botId: "b", threadId: "t", generation: "g" };
let home = "";
let mod: typeof import("./image-internal.ts");

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "sagax-image-route-"));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("SAGAX_DATA_DIR", join(home, ".sagax"));
  mod = await import("./image-internal.ts");
});
afterAll(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

async function call(body: unknown, deps: Partial<ImageInternalDeps> = {}) {
  const appended: unknown[] = [];
  const fetchCalls: string[] = [];
  const handler = mod.createImageInternalRoutes({
    owner: () => "solo",
    credential: async () => ({ provider: "xai", key: "k", baseUrl: "https://api.x.ai/v1", model: "m" }),
    image: async () => ({ bytes: Buffer.from(PNG_B64, "base64"), mime: "image/png" }),
    append: (_cap, attachment) => appended.push(attachment),
    fetch: (async (url: string) => { fetchCalls.push(url); return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] })); }) as unknown as typeof fetch,
    ...deps,
  });
  let status = 0;
  let payload: Record<string, unknown> = {};
  const json = ((_res: unknown, s: number, b: Record<string, unknown>) => { status = s; payload = b; }) as never;
  await handler({ res: {} as never, path: mod.IMAGE_INTERNAL_PATH, method: "POST", json, capability, readBody: async () => body } as never);
  return { status, payload, appended, fetchCalls };
}

describe("POST /api/internal/image (#2954)", () => {
  it("edits the attached image and posts it in the chat as the bot's image", async () => {
    const out = await call({ prompt: "put this person in Paris" });
    expect(out.status).toBe(200);
    expect(out.payload).toMatchObject({ ok: true, mode: "edit", provider: "xai" });
    expect(out.fetchCalls).toEqual(["https://api.x.ai/v1/images/edits"]);
    expect(out.appended).toEqual([expect.objectContaining({ kind: "image", mime: "image/png", name: "Edited image.png" })]);
  });

  it("generates from scratch when asked not to use the attachment", async () => {
    const out = await call({ prompt: "a cat", use_attached_image: false });
    expect(out.payload).toMatchObject({ mode: "generate" });
    expect(out.fetchCalls).toEqual(["https://api.x.ai/v1/images/generations"]);
  });

  it("answers in one line with the action when no provider is connected", async () => {
    const out = await call({ prompt: "x" }, { credential: async () => null });
    expect(out.status).toBe(409);
    expect(out.payload).toMatchObject({ code: "no_provider" });
    expect(String(out.payload.error)).toMatch(/Connect xAI .* or OpenAI in Settings > Providers/);
    expect(out.fetchCalls).toEqual([]);
  });

  it("refuses an empty prompt", async () => {
    expect((await call({ prompt: "" })).status).toBe(400);
  });
});
