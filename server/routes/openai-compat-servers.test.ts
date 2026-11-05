// Named OpenAI-compatible servers over HTTP (2026-10-30): add, edit, remove.
// #2054: a member manages their own; org-wide stays admin-only; isolation
// between two members.
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createOpenAiCompatServerRoutes, type OpenAiCompatServerRouteDeps } from "./openai-compat-servers.ts";
import { PASS } from "./table.ts";

type Instances = NonNullable<AppConfig["instances"]>;

function session(principalId: string): RequestAuth {
  return { kind: "session", session: { principalId } as never, via: "bearer", scopes: ["client"] };
}

function harness(overrides: Partial<OpenAiCompatServerRouteDeps> = {}) {
  let instances: Instances = { claude: { driver: "claudeAgent" } };
  let keys: AppConfig["openaiCompatServers"] = {};
  const used = new Set<string>();
  let principal: string | null = "pr_alice";
  let admin = true;
  const deps: OpenAiCompatServerRouteDeps = {
    allowed: () => true,
    isAdmin: () => admin,
    principalId: () => principal,
    instances: () => instances,
    keys: () => keys,
    persist: async (_id, next, nextKeys) => { instances = next; keys = nextKeys; },
    inUse: (id) => used.has(id),
    describe: async () => Object.keys(instances),
    exclusive: (work) => work(),
    ...overrides,
  };
  const route = createOpenAiCompatServerRoutes(deps);
  const call = async (method: string, path: string, body?: unknown, auth: RequestAuth = {} as never) => {
    const sent: Array<{ status: number; body: any }> = [];
    const out = await route({
      req: { headers: { "content-type": "application/json" } } as never,
      res: {} as never, url: new URL(`http://localhost${path}`), path, method, auth,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => body) as never,
    });
    return { out, sent: sent[0]! };
  };
  return {
    call,
    used,
    get: () => ({ instances, keys }),
    asMember(id: string) { principal = id; admin = false; },
    asAdmin(id = "pr_admin") { principal = id; admin = true; },
    asUnsigned() { principal = null; admin = false; },
  };
}

describe("named OpenAI-compatible server routes", () => {
  it("adds, renames, rekeys and removes a server; the key never comes back", async () => {
    const h = harness();
    const added = await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Gateway", url: "https://gw.example.test/v1", key: "k1" });
    expect(added.sent.status).toBe(201);
    const id = added.sent.body.instanceId as string;
    expect(id).toMatch(/^compat-/);
    expect(JSON.stringify(added.sent.body)).not.toContain("k1");
    // admin create: org-wide (no owner)
    expect(h.get().keys).toEqual({ [id]: { key: "k1" } });
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${id}`, { displayName: "Gateway EU" })).sent.status).toBe(200);
    expect(h.get().instances[id]).toMatchObject({ displayName: "Gateway EU" });
    h.used.add(id);
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${id}`)).sent.status).toBe(409);
    h.used.delete(id);
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${id}`)).sent.status).toBe(200);
    expect(h.get()).toEqual({ instances: { claude: { driver: "claudeAgent" } }, keys: {} });
  });

  it("lets a member add, edit and remove their own server (#2054)", async () => {
    const h = harness();
    h.asMember("pr_alice");
    const added = await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Alice lab", url: "https://alice.example.test/v1", key: "alice-key" }, session("pr_alice"));
    expect(added.sent.status).toBe(201);
    const id = added.sent.body.instanceId as string;
    expect(h.get().keys?.[id]).toEqual({ key: "alice-key", ownerPrincipalId: "pr_alice" });
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${id}`, { displayName: "Alice EU" }, session("pr_alice"))).sent.status).toBe(200);
    expect(h.get().instances[id]).toMatchObject({ displayName: "Alice EU" });
    expect(h.get().keys?.[id]).toMatchObject({ ownerPrincipalId: "pr_alice" });
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${id}`, undefined, session("pr_alice"))).sent.status).toBe(200);
    expect(h.get().keys?.[id]).toBeUndefined();
  });

  it("keeps two members isolated from each other's servers (#2054)", async () => {
    const h = harness();
    h.asMember("pr_alice");
    const alice = await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Alice", url: "https://alice.example.test/v1" }, session("pr_alice"));
    const aliceId = alice.sent.body.instanceId as string;
    h.asMember("pr_bob");
    const bob = await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Bob", url: "https://bob.example.test/v1" }, session("pr_bob"));
    const bobId = bob.sent.body.instanceId as string;
    expect(h.get().keys?.[aliceId]?.ownerPrincipalId).toBe("pr_alice");
    expect(h.get().keys?.[bobId]?.ownerPrincipalId).toBe("pr_bob");
    // Bob cannot edit or remove Alice's
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${aliceId}`, { displayName: "Nope" }, session("pr_bob"))).sent).toEqual({
      status: 404, body: { error: "unknown server" },
    });
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${aliceId}`, undefined, session("pr_bob"))).sent).toEqual({
      status: 404, body: { error: "unknown server" },
    });
    // Alice cannot edit Bob's
    h.asMember("pr_alice");
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${bobId}`, { displayName: "Nope" }, session("pr_alice"))).sent.status).toBe(404);
    // each still manages their own
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${aliceId}`, { displayName: "Alice 2" }, session("pr_alice"))).sent.status).toBe(200);
    h.asMember("pr_bob");
    expect((await h.call("DELETE", `/api/instances/openai-compat-servers/${bobId}`, undefined, session("pr_bob"))).sent.status).toBe(200);
  });

  it("keeps org-wide servers admin-only; members may still manage their own", async () => {
    const h = harness();
    h.asAdmin();
    const shared = await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Org", url: "https://org.example.test/v1" });
    const sharedId = shared.sent.body.instanceId as string;
    expect(h.get().keys?.[sharedId]?.ownerPrincipalId).toBeUndefined();
    h.asMember("pr_alice");
    expect((await h.call("PATCH", `/api/instances/openai-compat-servers/${sharedId}`, { displayName: "Nope" }, session("pr_alice"))).sent).toMatchObject({
      status: 403, body: { code: "admin_only_field", field: "openaiCompatServers" },
    });
    expect((await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "Mine", url: "https://mine.example.test/v1" }, session("pr_alice"))).sent.status).toBe(201);
  });

  it("refuses a hosted home, an unsigned create, another engine, a bad address, and passes other paths", async () => {
    expect((await harness({ allowed: () => false }).call("POST", "/api/instances/openai-compat-servers", { displayName: "A", url: "https://a.example.test" })).sent.status).toBe(403);
    const unsigned = harness();
    unsigned.asUnsigned();
    expect((await unsigned.call("POST", "/api/instances/openai-compat-servers", { displayName: "A", url: "https://a.example.test" })).sent).toMatchObject({
      status: 403, body: { code: "sign_in_required" },
    });
    const h = harness();
    expect((await h.call("DELETE", "/api/instances/openai-compat-servers/claude")).sent.status).toBe(404);
    expect((await h.call("POST", "/api/instances/openai-compat-servers", { displayName: "A", url: "http://a.example.test" })).sent.status).toBe(400);
    expect((await h.call("PATCH", "/api/instances/openai-compat-servers", { displayName: "A" })).sent.status).toBe(404);
    expect((await h.call("GET", "/api/instances/openai-compat-servers")).out).toBe(PASS);
    expect((await h.call("POST", "/api/instances/claude-accounts", {})).out).toBe(PASS);
  });
});
