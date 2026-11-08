// #2983: a person's own model servers for pi over HTTP (add, test, edit,
// remove), the sealed store, the probe, and the pi provider they become.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  mergeModelServers,
  ownModelServers,
  PiOwnModelServersStore,
  PI_OWN_MODEL_SERVERS_FILE,
  probeModelServer,
  type ProbeResult,
} from "../pi-own-model-servers.ts";
import { createPiModelServerRoutes } from "./pi-model-servers.ts";
import { PASS } from "./table.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function store() {
  const dir = mkdtempSync(join(tmpdir(), "pi-servers-"));
  dirs.push(dir);
  const key = randomBytes(32);
  return { dir, store: new PiOwnModelServersStore(dir, () => ({ kind: "key", key }) as never) };
}

function harness(probe: (url: string, key?: string) => Promise<ProbeResult> = async () => ({ ok: true, models: [{ id: "qwen", contextWindow: 32768 }] })) {
  const { dir, store: s } = store();
  let who: string | null = "pr_alice";
  const probes: Array<{ url: string; key?: string }> = [];
  const route = createPiModelServerRoutes({
    scope: () => (who === null ? null : { principalId: who }),
    store: s,
    probe: async (url, key) => { probes.push({ url, key }); return probe(url, key); },
    now: () => new Date("2026-11-08T12:00:00Z"),
  });
  const call = async (method: string, path: string, body?: unknown, type = "application/json") => {
    const sent: Array<{ status: number; body: any }> = [];
    const out = await route({
      req: { headers: { "content-type": type } } as never,
      res: {} as never, url: new URL(`http://localhost${path}`), path, method, auth: {} as RequestAuth,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => body) as never,
    });
    return { out, sent: sent[0]! };
  };
  return { call, dir, store: s, probes, as(id: string | null) { who = id; } };
}

const BASE = "/api/me/pi-model-servers";

describe("pi model server routes", () => {
  it("adds and tests a server, then lists it without its key", async () => {
    const h = harness();
    const added = await h.call("POST", BASE, { name: "oMLX", url: "http://127.0.0.1:8000/v1/", key: "sk-local" });
    expect(added.sent.status).toBe(201);
    expect(added.sent.body.server).toMatchObject({ name: "oMLX", url: "http://127.0.0.1:8000/v1", configured: true, models: [{ id: "qwen", contextWindow: 32768 }] });
    expect(added.sent.body.server.provider).toBe(`px-own-${added.sent.body.server.id}`);
    expect(added.sent.body.test).toEqual({ ok: true, models: 1 });
    expect(h.probes).toEqual([{ url: "http://127.0.0.1:8000/v1", key: "sk-local" }]);
    const listed = await h.call("GET", BASE);
    expect(JSON.stringify(listed.sent.body)).not.toContain("sk-local");
    expect(listed.sent.body.servers).toHaveLength(1);
    // sealed on disk: neither the key nor the name in clear
    const raw = readFileSync(join(h.dir, "principals", "pr_alice", PI_OWN_MODEL_SERVERS_FILE), "utf8");
    expect(raw).not.toContain("sk-local");
    expect(raw).not.toContain("oMLX");
  });

  it("keeps a server whose test failed and says why", async () => {
    const h = harness(async () => ({ ok: false, error: "The server could not be reached at this address." }));
    const added = await h.call("POST", BASE, { name: "Ollama", url: "http://localhost:11434/v1" });
    expect(added.sent.status).toBe(201);
    expect(added.sent.body.test).toEqual({ ok: false, error: "The server could not be reached at this address." });
    expect(added.sent.body.server.models).toEqual([]);
    expect(ownModelServers(h.store.list({ principalId: "pr_alice" }))).toEqual([]);
  });

  it("edits, drops the key, re-tests and removes", async () => {
    const h = harness();
    const id = (await h.call("POST", BASE, { name: "Box", url: "https://llm.example.test/v1", key: "k1" })).sent.body.server.id;
    const renamed = await h.call("PATCH", `${BASE}/${id}`, { name: "Box 2" });
    expect(renamed.sent.body.server.name).toBe("Box 2");
    expect(renamed.sent.body.test).toBeUndefined();
    expect(h.probes).toHaveLength(1);
    const dropped = await h.call("PATCH", `${BASE}/${id}`, { key: "" });
    expect(dropped.sent.body.server.configured).toBe(false);
    expect(h.probes).toHaveLength(2);
    const tested = await h.call("POST", `${BASE}/${id}/test`);
    expect(tested.sent.body.test).toEqual({ ok: true, models: 1 });
    expect(tested.sent.body.server.checkedAt).toBe("2026-11-08T12:00:00.000Z");
    expect((await h.call("DELETE", `${BASE}/${id}`)).sent.status).toBe(200);
    expect((await h.call("GET", BASE)).sent.body.servers).toEqual([]);
  });

  it("refuses a public http address, a bad body and a wrong content type", async () => {
    const h = harness();
    expect((await h.call("POST", BASE, { name: "Open", url: "http://8.8.8.8/v1" })).sent.status).toBe(400);
    expect((await h.call("POST", BASE, { name: "", url: "https://a.example.test/v1" })).sent.status).toBe(400);
    expect((await h.call("POST", BASE, { name: "A", url: "https://a.example.test/v1", extra: 1 })).sent.status).toBe(400);
    expect((await h.call("POST", BASE, { name: "A", url: "https://a.example.test/v1" }, "text/plain")).sent.status).toBe(415);
    expect((await h.call("PUT", BASE)).sent.status).toBe(405);
    expect(h.probes).toHaveLength(0);
  });

  it("keeps each person's servers apart and needs a signed-in person", async () => {
    const h = harness();
    const id = (await h.call("POST", BASE, { name: "Mine", url: "https://a.example.test/v1" })).sent.body.server.id;
    h.as("pr_bob");
    expect((await h.call("GET", BASE)).sent.body.servers).toEqual([]);
    expect((await h.call("DELETE", `${BASE}/${id}`)).sent.status).toBe(404);
    h.as(null);
    expect((await h.call("GET", BASE)).sent.status).toBe(403);
  });

  it("passes other paths", async () => {
    const h = harness();
    expect((await h.call("GET", "/api/me/other")).out).toBe(PASS);
  });
});

describe("pi own model servers", () => {
  it("become pi providers, Perspicax's first", () => {
    const own = ownModelServers([{ id: "sx-0123456789", name: "Local", url: "http://127.0.0.1:8000/v1", models: [{ id: "m" }] }]);
    expect(own[0]).toMatchObject({ instanceId: "sx-0123456789", scope: "personal", apiKey: "", models: [{ id: "m" }] });
    const merged = mergeModelServers([{ ...own[0]!, name: "From Perspicax" }], own);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("From Perspicax");
  });

  it("probes /models and reads the context size", async () => {
    let asked = "";
    let auth = "";
    const fetchImpl = (async (url: string, init: RequestInit) => {
      asked = url;
      auth = String((init.headers as Record<string, string>).authorization ?? "");
      return new Response(JSON.stringify({ data: [{ id: "a", max_model_len: 4096 }, { id: "b" }, { id: "a" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await probeModelServer("http://h/v1/", "k", fetchImpl)).toEqual({ ok: true, models: [{ id: "a", contextWindow: 4096 }, { id: "b" }] });
    expect(asked).toBe("http://h/v1/models");
    expect(auth).toBe("Bearer k");
    const refused = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    expect(await probeModelServer("http://h/v1", undefined, refused)).toEqual({ ok: false, error: "The server refused the key." });
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await probeModelServer("http://h/v1", undefined, down)).ok).toBe(false);
  });
});
