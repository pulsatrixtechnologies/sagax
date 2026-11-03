import { describe, expect, it } from "vitest";

import { json, type readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS } from "./table.ts";
import { createTtsProviderRoutes, type TtsProvider } from "./tts-provider.ts";

function harness(current: TtsProvider = "elevenlabs", busy = false) {
  const applied: Array<{ provider: TtsProvider; clearVoices: boolean }> = [];
  let provider = current;
  const route = createTtsProviderRoutes({
    current: () => provider,
    busy: () => busy,
    apply: (next, clearVoices) => {
      applied.push({ provider: next, clearVoices });
      provider = next;
      return { tts: { provider: next } };
    },
    view: (_auth, status) => ({ viewed: status }),
  });
  const call = async (method: string, body: unknown, auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] }, path = "/api/tts/provider") => {
    let status = 0;
    let sent: unknown;
    const res = {
      headersSent: false, writableEnded: false,
      setHeader() {}, writeHead(code: number) { status = code; return this; },
      end(text?: string) { sent = text ? JSON.parse(text) : undefined; },
    };
    const out = await route({
      req: {} as never, res: res as never, url: new URL(path, "http://x"), path, method, auth,
      json: ((r: unknown, code: number, payload: unknown) => { status = code; sent = payload; void r; }) as unknown as typeof json,
      readBody: (async () => body) as unknown as typeof readBody,
    });
    return { out, status, body: sent };
  };
  return { call, applied };
}

describe("PUT /api/tts/provider", () => {
  it("switches the engine alone and clears voice ids only when it changes", async () => {
    const h = harness("elevenlabs");
    const switched = await h.call("PUT", { provider: "fish" });
    expect(switched).toMatchObject({ status: 200, body: { viewed: { tts: { provider: "fish" } } } });
    expect((await h.call("PUT", { provider: "fish" })).status).toBe(200);
    expect(h.applied).toEqual([{ provider: "fish", clearVoices: true }, { provider: "fish", clearVoices: false }]);
  });

  it("takes nothing beside the provider, and only a known one", async () => {
    const h = harness();
    for (const body of [{ provider: "fish", key: "sk-1" }, { provider: "fish", baseUrl: "http://x" }, { provider: "nope" }, {}, [], null, "fish"]) {
      expect((await h.call("PUT", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(h.applied).toEqual([]);
  });

  it("is the owner's or an admin's, never a service's or a client session's", async () => {
    const h = harness();
    const client = { kind: "session", via: "bearer", scopes: ["client"], session: {} } as unknown as RequestAuth;
    const admin = { kind: "session", via: "bearer", scopes: ["admin", "client"], session: {} } as unknown as RequestAuth;
    expect((await h.call("PUT", { provider: "fish" }, { kind: "loopback", scopes: ["client"], trust: "service" })).status).toBe(403);
    expect((await h.call("PUT", { provider: "fish" }, client)).status).toBe(403);
    expect((await h.call("PUT", { provider: "fish" }, admin)).status).toBe(200);
  });

  it("refuses while provider settings are being written, other verbs, and passes other paths", async () => {
    expect((await harness("elevenlabs", true).call("PUT", { provider: "fish" })).status).toBe(409);
    expect((await harness().call("GET", undefined)).status).toBe(405);
    expect((await harness().call("PUT", { provider: "fish" }, undefined, "/api/tts/voices")).out).toBe(PASS);
  });
});
