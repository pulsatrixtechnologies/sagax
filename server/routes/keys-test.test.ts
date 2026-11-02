// Characterization of POST /api/keys/test.
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.ts";
import { createKeysTestRoutes, type KeysTestRouteDeps } from "./keys-test.ts";
import { PASS } from "./table.ts";

function harness(overrides: Partial<KeysTestRouteDeps> = {}) {
  const accepted: Array<[string, string]> = [];
  const rejected: Array<[string, string]> = [];
  const check = vi.fn(async () => ({ ok: true as const, check: "models" as const, models: ["gpt-test"] }));
  const deps: KeysTestRouteDeps = {
    cfg: () => ({ openai: { key: "sk-saved" } } as AppConfig),
    checkProviderKey: check,
    noteKeyAccepted: (url, key) => { accepted.push([url, key]); },
    noteKeyRejected: (url, key) => { rejected.push([url, key]); },
    ...overrides,
  };
  const route = createKeysTestRoutes(deps);
  const call = async (body: unknown, path = "/api/keys/test", method = "POST") => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const out = await route({
      req: { headers: { "content-type": "application/json" } } as never,
      res: { setHeader: () => undefined } as never,
      url: new URL(`http://localhost${path}`),
      path,
      method,
      auth: { kind: "loopback", scopes: ["admin"] } as never,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => body) as never,
    });
    return { out, sent: sent[0], accepted, rejected, check };
  };
  return { call, accepted, rejected, check };
}

describe("POST /api/keys/test", () => {
  it("refuses an unknown provider, a non-string key, an empty key and an overlong key", async () => {
    const h = harness({ cfg: () => ({} as AppConfig) });
    expect((await h.call({ provider: "nope" })).sent).toMatchObject({ status: 400 });
    expect((await h.call({ provider: "openai", key: 1 })).sent).toEqual({ status: 400, body: { error: "key must be a string" } });
    expect((await h.call({ provider: "openai" })).sent).toEqual({
      status: 400,
      body: { error: "No key to test. Paste one or save one first." },
    });
    expect((await h.call({ provider: "openai", key: "x".repeat(513) })).sent).toEqual({
      status: 400,
      body: { error: "That does not look like an API key." },
    });
  });

  it("refuses a URL this workspace does not already know", async () => {
    const h = harness();
    const { sent } = await h.call({ provider: "openai", key: "sk-x", url: "https://evil.example/v1" });
    expect(sent).toEqual({
      status: 400,
      body: { error: "url must be the provider's default address or a server configured on this workspace." },
    });
    expect(h.check).not.toHaveBeenCalled();
  });

  it("checks a pasted key and notes acceptance (not for anthropic)", async () => {
    const h = harness();
    const { sent, accepted } = await h.call({ provider: "openai", key: " sk-live " });
    expect(sent).toEqual({ status: 200, body: { ok: true, check: "models", models: ["gpt-test"] } });
    expect(h.check).toHaveBeenCalledWith({ provider: "openai", key: "sk-live", url: undefined });
    expect(accepted).toEqual([["https://api.openai.com/v1", "sk-live"]]);
  });

  it("uses the saved key when none is pasted, and never notes anthropic", async () => {
    const h = harness({
      cfg: () => ({ anthropic: { key: "sk-ant" } } as AppConfig),
      checkProviderKey: async () => ({ ok: true, check: "models", models: [] }),
    });
    const { sent, accepted } = await h.call({ provider: "anthropic" });
    expect(sent?.status).toBe(200);
    expect(accepted).toEqual([]);
  });

  it("notes a rejected key", async () => {
    const h = harness({
      checkProviderKey: async () => ({ ok: false, reason: "rejected", status: 401 }),
    });
    const { sent, rejected } = await h.call({ provider: "openai", key: "sk-bad" });
    expect(sent).toEqual({ status: 200, body: { ok: false, reason: "rejected", status: 401 } });
    expect(rejected).toEqual([["https://api.openai.com/v1", "sk-bad"]]);
  });

  it("passes other paths", async () => {
    const h = harness();
    expect((await h.call({}, "/api/keys", "POST")).out).toBe(PASS);
    expect((await h.call({}, "/api/keys/test", "GET")).out).toBe(PASS);
  });
});
