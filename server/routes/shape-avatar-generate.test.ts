import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  SHAPE_AVATAR_PROMPT_MARKER,
  generateShapeAvatarDef,
} from "../../shared/shape-avatar-generate.ts";
import { validateShapeAvatarDef } from "../../shared/shape-avatar-def.ts";
import {
  createShapeAvatarGenerateInternalRoutes,
  createShapeAvatarGenerateRoutes,
} from "./shape-avatar-generate.ts";
import { PASS } from "./table.ts";

function mockAuth(): any {
  return { kind: "session", scopes: ["client", "admin"], session: { principalId: "p1" } };
}

async function callPublic(
  handler: ReturnType<typeof createShapeAvatarGenerateRoutes>,
  path: string,
  body: unknown,
): Promise<{ status: number; body: any; passed?: boolean }> {
  let status = 0;
  let payload: any = null;
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    end(this: { writableEnded: boolean }) { this.writableEnded = true; },
  } as unknown as ServerResponse;
  const json = (_res: ServerResponse, code: number, data: unknown) => {
    status = code;
    payload = data;
    (res as any).writableEnded = true;
  };
  const readBody = async () => body as Record<string, unknown>;
  const out = await handler({
    req: {} as IncomingMessage,
    res,
    url: new URL(`http://x${path}`),
    path,
    method: "POST",
    auth: mockAuth(),
    json: json as any,
    readBody: readBody as any,
  });
  if (out === PASS) return { status: 0, body: null, passed: true };
  return { status, body: payload };
}

describe("shape-avatar generate routes", () => {
  it("falls back to presets when the engine is missing", async () => {
    const handler = createShapeAvatarGenerateRoutes({
      bot: (id) => (id === "b1" ? { id: "b1" } : undefined),
      mayChange: () => true,
      generate: () => null,
    });
    const result = await callPublic(handler, "/api/bots/b1/shape-avatar/generate", { direction: "coffee mug" });
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("fallback");
    expect(validateShapeAvatarDef(result.body.def).ok).toBe(true);
    expect(result.body.def.id).toBe("cup");
  });

  it("uses the model answer when it validates (fake engine)", async () => {
    const modelDef = generateShapeAvatarDef("pad");
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(SHAPE_AVATAR_PROMPT_MARKER);
      return JSON.stringify(modelDef);
    });
    const handler = createShapeAvatarGenerateRoutes({
      bot: () => ({ id: "b1" }),
      mayChange: () => true,
      generate: () => generate,
    });
    const result = await callPublic(handler, "/api/bots/b1/shape-avatar/generate", { direction: "game controller" });
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("model");
    expect(result.body.def.id).toBe("pad");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries once on invalid model text then falls back", async () => {
    const generate = vi.fn(async () => "not json at all");
    const handler = createShapeAvatarGenerateRoutes({
      bot: () => ({ id: "b1" }),
      mayChange: () => true,
      generate: () => generate,
    });
    const result = await callPublic(handler, "/api/bots/b1/shape-avatar/generate", { direction: "friendly rocket" });
    expect(result.status).toBe(200);
    expect(result.body.source).toBe("fallback");
    expect(result.body.def.id).toBe("ship");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("refuses strangers and missing bots", async () => {
    const handler = createShapeAvatarGenerateRoutes({
      bot: (id) => (id === "b1" ? { id: "b1" } : undefined),
      mayChange: () => false,
      generate: () => null,
    });
    expect((await callPublic(handler, "/api/bots/b1/shape-avatar/generate", { direction: "mug" })).status).toBe(403);
    expect((await callPublic(handler, "/api/bots/missing/shape-avatar/generate", { direction: "mug" })).status).toBe(404);
  });

  it("internal route returns a definition for the capability bot", async () => {
    const modelDef = generateShapeAvatarDef("bulb");
    const internal = createShapeAvatarGenerateInternalRoutes({
      generate: () => async () => JSON.stringify(modelDef),
    });
    let status = 0;
    let payload: any = null;
    const res = { headersSent: false, writableEnded: false } as ServerResponse;
    const json = (_r: ServerResponse, code: number, data: unknown) => {
      status = code;
      payload = data;
    };
    await internal({
      res,
      path: "/api/internal/shape-avatar/generate",
      method: "POST",
      json: json as any,
      capability: { botId: "bot-x", threadId: "t1", generation: "g1" },
      readBody: async () => ({ direction: "idea lamp" }),
    });
    expect(status).toBe(200);
    expect(payload.source).toBe("model");
    expect(payload.def.id).toBe("bulb");
  });
});
