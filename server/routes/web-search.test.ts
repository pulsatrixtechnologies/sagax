// /api/me/web-search: the person's own setting (no admin scope needed), the
// key never answered back; /api/internal/web-search: the server adds the key
// to the HTTP call and answers wrapped results without it.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createWebSearchStore, webSearchScope } from "../web-search/store.ts";
import { createWebSearchInternalRoutes } from "./web-search-internal.ts";
import { createWebSearchRoutes } from "./web-search.ts";

const KEY = "test-key-not-real-1111-lmno";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-web-search-route-"));
  dirs.push(dir);
  const vault = randomBytes(32);
  return createWebSearchStore(dir, () => ({ kind: "key", key: vault }));
}

const member = (principalId: string) => ({ kind: "session", via: "bearer", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

function fakeFetch(calls: Array<{ url: string; init: RequestInit }>, body: unknown = { web: { results: [{ title: "T", url: "https://t.example/", description: "s" }] } }) {
  return async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

function settings(organization: boolean, refuse?: (url: string) => Promise<string | null>) {
  const store = makeStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const route = createWebSearchRoutes({
    store,
    scope: (auth) => webSearchScope(organization, auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : null),
    fetch: fakeFetch(calls),
    ...(refuse ? { refuseAddress: refuse } : {}),
  });
  const call = async (method: string, path: string, body: unknown, auth: RequestAuth) => {
    let status = 0;
    let sent: unknown;
    const res = { headersSent: false, writableEnded: false, setHeader() {} };
    await route({
      req: {} as never, res: res as never, url: new URL(path, "http://x"), path, method, auth,
      json: ((_r: unknown, code: number, payload: unknown) => { status = code; sent = payload; }) as unknown as typeof json,
      readBody: (async () => body) as unknown as typeof readBody,
    });
    return { status, body: sent as Record<string, unknown> };
  };
  return { store, call, calls };
}

describe("/api/me/web-search", () => {
  it("needs no admin scope: a client session may call it", () => {
    for (const method of ["GET", "PUT", "DELETE"]) expect(requiredScope(method, "/api/me/web-search")).toBe("client");
    expect(requiredScope("POST", "/api/me/web-search/test")).toBe("client");
  });

  it("saves a member's own key and never answers it back", async () => {
    const h = settings(true);
    const ada = member("pr_ada");
    const saved = await h.call("PUT", "/api/me/web-search", { provider: "brave", key: KEY }, ada);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ provider: "brave", baseUrl: null, keyConfigured: true, last4: "lmno", ready: true });
    const read = await h.call("GET", "/api/me/web-search", undefined, ada);
    expect(JSON.stringify(read.body)).not.toContain(KEY);
    // Another person's settings are their own.
    expect((await h.call("GET", "/api/me/web-search", undefined, member("pr_bob"))).body).toMatchObject({ provider: null, ready: false });
    expect((await h.call("DELETE", "/api/me/web-search", undefined, ada)).body).toMatchObject({ provider: null, keyConfigured: false });
  });

  it("refuses an organization session with no person, a bad provider or a bad key", async () => {
    const h = settings(true);
    expect((await h.call("GET", "/api/me/web-search", undefined, { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth)).status).toBe(401);
    for (const body of [{ provider: "nope", key: KEY }, { provider: "brave", key: "short" }, { provider: "brave", key: "has space inside" }, { provider: "searxng", baseUrl: "ftp://x" }, null]) {
      expect((await h.call("PUT", "/api/me/web-search", body, member("pr_ada"))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("verifies with the typed key, or the saved one", async () => {
    const h = settings(false);
    const owner = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
    const typed = await h.call("POST", "/api/me/web-search/test", { provider: "brave", key: KEY }, owner);
    expect(typed).toEqual({ status: 200, body: { ok: true, results: 1 } });
    expect((h.calls[0]!.init.headers as Record<string, string>)["x-subscription-token"]).toBe(KEY);
    expect((await h.call("POST", "/api/me/web-search/test", {}, owner)).status).toBe(400);
    await h.call("PUT", "/api/me/web-search", { provider: "brave", key: KEY }, owner);
    expect((await h.call("POST", "/api/me/web-search/test", { provider: "brave" }, owner)).status).toBe(200);
    expect((await h.call("POST", "/api/me/web-search/test", {}, owner)).status).toBe(200);
    expect(h.calls).toHaveLength(3);
  });

  it("asks the address guard about a SearXNG instance", async () => {
    const h = settings(true, async (url) => url.includes("10.0.0.5") ? "On an organization server, the SearXNG instance must be reachable on the public internet." : null);
    const ada = member("pr_ada");
    expect((await h.call("PUT", "/api/me/web-search", { provider: "searxng", baseUrl: "http://10.0.0.5:8080" }, ada)).status).toBe(400);
    expect((await h.call("PUT", "/api/me/web-search", { provider: "searxng", baseUrl: "https://search.example.org" }, ada)).body).toMatchObject({ provider: "searxng", ready: true });
  });
});

describe("/api/internal/web-search", () => {
  function internal(config: ReturnType<typeof makeStore>["config"] extends (...a: never[]) => infer R ? R : never) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const route = createWebSearchInternalRoutes({ config: () => config, fetch: fakeFetch(calls) });
    const call = async (body: unknown) => {
      let status = 0;
      let sent: unknown;
      await route({
        res: { headersSent: false, writableEnded: false } as never, path: "/api/internal/web-search", method: "POST",
        json: ((_r: unknown, code: number, payload: unknown) => { status = code; sent = payload; }) as unknown as typeof json,
        capability: { botId: "bot-a", threadId: "thread-a", generation: "g" },
        readBody: async () => body as Record<string, unknown>,
      });
      return { status, body: sent as Record<string, unknown> };
    };
    return { call, calls };
  }

  it("adds the key to the HTTP request only, and wraps the results as untrusted", async () => {
    const h = internal({ provider: "brave", key: KEY });
    const answer = await h.call({ query: "sagax", count: 2 });
    expect(answer.status).toBe(200);
    expect((h.calls[0]!.init.headers as Record<string, string>)["x-subscription-token"]).toBe(KEY);
    const text = String(answer.body.text);
    expect(text.startsWith("<<<UNTRUSTED source=\"web search\">>>")).toBe(true);
    expect(text).toContain("https://t.example/");
    expect(JSON.stringify(answer.body)).not.toContain(KEY);
  });

  it("says when the person has no provider, and makes no call", async () => {
    const h = internal(null);
    const answer = await h.call({ query: "x" });
    expect(answer.status).toBe(404);
    expect(h.calls).toHaveLength(0);
    expect((await internal({ provider: "brave" }).call({ query: "x" })).status).toBe(404);
    expect((await h.call({ query: "" })).status).toBe(400);
  });
});
