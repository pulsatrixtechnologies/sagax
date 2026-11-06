// /api/me/memes + /api/memes/*: the provider key never leaves the server.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createMemeStore, memeScope } from "../memes/store.ts";
import { createSendMemeInternalRoutes } from "./memes-internal.ts";
import { createMemesRoutes } from "./memes.ts";

const KEY = "test-meme-key-not-real-zz99";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-memes-route-"));
  dirs.push(dir);
  const vault = randomBytes(32);
  return createMemeStore(dir, () => ({ kind: "key", key: vault }));
}

const member = (principalId: string) => ({ kind: "session", via: "bearer", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

function tenorBody() {
  return {
    results: [{
      id: "abc",
      title: "This is fine",
      media_formats: {
        tinygif: { url: "https://media.example/preview.gif", dims: [120, 90] },
        gif: { url: "https://media.example/full.gif", dims: [320, 240] },
      },
    }],
  };
}

// Minimal GIF89a header so upload sniffing accepts the download.
const TINY_GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00\x21\xf9\x04\x01\x00\x00\x00\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x4c\x01\x00\x3b", "binary");

function fakeFetch(calls: Array<{ url: string }>, jsonBody: unknown = tenorBody(), bytes = TINY_GIF) {
  return async (url: string) => {
    calls.push({ url });
    if (String(url).includes("media.example") || String(url).endsWith(".gif")) {
      return new Response(bytes, { status: 200, headers: { "content-type": "image/gif" } });
    }
    if (String(url).includes("imgflip.com")) {
      return new Response(JSON.stringify({
        success: true,
        data: { memes: [{ id: "1", name: "Distracted Boyfriend", url: "https://i.imgflip.com/1.jpg", width: 500, height: 500 }] },
      }), { status: 200 });
    }
    return new Response(JSON.stringify(jsonBody), { status: 200 });
  };
}

function settings(organization: boolean) {
  const store = makeStore();
  const calls: Array<{ url: string }> = [];
  const route = createMemesRoutes({
    store,
    scope: (auth) => memeScope(organization, auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : null),
    fetch: fakeFetch(calls),
  });
  const call = async (method: string, path: string, body: unknown, auth: RequestAuth) => {
    let status = 0;
    let sent: unknown;
    const res = { headersSent: false, writableEnded: false, setHeader() {} };
    await route({
      req: {} as never, res: res as never, url: new URL(path, "http://x"), path: path.split("?")[0]!, method, auth,
      json: ((_r: unknown, code: number, payload: unknown) => { status = code; sent = payload; }) as unknown as typeof json,
      readBody: (async () => body) as unknown as typeof readBody,
    });
    return { status, body: sent as Record<string, unknown> };
  };
  return { store, call, calls };
}

describe("/api/me/memes + /api/memes", () => {
  it("needs no admin scope", () => {
    for (const method of ["GET", "PUT", "DELETE"]) expect(requiredScope(method, "/api/me/memes")).toBe("client");
    expect(requiredScope("GET", "/api/memes/search")).toBe("client");
    expect(requiredScope("GET", "/api/memes/trending")).toBe("client");
    expect(requiredScope("POST", "/api/memes/materialize")).toBe("client");
  });

  it("saves a member's key and never answers it back", async () => {
    const h = settings(true);
    const ada = member("pr_ada");
    const saved = await h.call("PUT", "/api/me/memes", { provider: "tenor", key: KEY }, ada);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ provider: "tenor", keyConfigured: true, last4: "zz99", ready: true });
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    const read = await h.call("GET", "/api/me/memes", undefined, ada);
    expect(JSON.stringify(read.body)).not.toContain(KEY);
    expect((await h.call("GET", "/api/me/memes", undefined, member("pr_bob"))).body).toMatchObject({ provider: null, ready: false });
  });

  it("searches with the sealed key and never returns it", async () => {
    const h = settings(false);
    const owner = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
    await h.call("PUT", "/api/me/memes", { provider: "tenor", key: KEY }, owner);
    const search = await h.call("GET", "/api/memes/search?q=fine", undefined, owner);
    expect(search.status).toBe(200);
    expect(search.body.keyConfigured).toBe(true);
    const hits = search.body.hits as Array<Record<string, unknown>>;
    expect(hits[0]).toMatchObject({ id: "tenor:abc", title: "This is fine", provider: "tenor" });
    expect(JSON.stringify(search.body)).not.toContain(KEY);
    expect(h.calls.some((c) => c.url.includes(KEY))).toBe(true);
  });

  it("without a key still offers Imgflip and a setup hint", async () => {
    const h = settings(false);
    const owner = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
    const trending = await h.call("GET", "/api/memes/trending", undefined, owner);
    expect(trending.status).toBe(200);
    expect(trending.body.keyConfigured).toBe(false);
    expect(String(trending.body.setupHint ?? "")).toMatch(/Settings > Providers > Memes/);
    const hits = trending.body.hits as Array<Record<string, unknown>>;
    expect(hits.some((hit) => hit.provider === "imgflip")).toBe(true);
    expect(JSON.stringify(trending.body)).not.toContain(KEY);
  });
});

describe("/api/internal/send-meme", () => {
  it("posts a meme and refuses when meme replies are off", async () => {
    const store = makeStore();
    store.save({ organization: false }, { provider: "tenor", key: KEY });
    const calls: Array<{ url: string }> = [];
    const posted: unknown[] = [];
    let enabled = true;
    const route = createSendMemeInternalRoutes({
      config: () => store.config({ organization: false }),
      memeRepliesEnabled: () => enabled,
      appendMeme: (_cap, attachment, caption) => { posted.push({ attachment, caption }); },
      fetch: fakeFetch(calls),
    });
    const call = async (body: unknown) => {
      let status = 0;
      let sent: unknown;
      await route({
        res: { headersSent: false, writableEnded: false } as never,
        path: "/api/internal/send-meme",
        method: "POST",
        json: ((_r: unknown, code: number, payload: unknown) => { status = code; sent = payload; }) as unknown as typeof json,
        capability: { botId: "bot-a", threadId: "thread-a", generation: "g" },
        readBody: async () => body as Record<string, unknown>,
      });
      return { status, body: sent as Record<string, unknown> };
    };
    const ok = await call({ query: "this is fine" });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(JSON.stringify(ok.body)).not.toContain(KEY);
    expect(posted).toHaveLength(1);
    enabled = false;
    expect((await call({ query: "high five" })).status).toBe(403);
  });
});
