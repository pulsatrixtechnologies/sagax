// The Code routes against the fake Perspicax: the gate (solo = Sagax
// Business), the list joined with a thread-launched record, a launch, a
// follow-up, the artifacts and the SSE relay.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { CloudAgentCredentialStore } from "../cloud-agents/credentials.ts";
import { CloudAgentManager } from "../cloud-agents/manager.ts";
import { PerspicaxAgentsClient } from "../cloud-agents/perspicax-client.ts";
import { createPerspicaxProvider } from "../cloud-agents/providers/perspicax.ts";
import { CloudAgentStore } from "../cloud-agents/store.ts";
import { startFakePerspicaxAgents, type FakePerspicaxAgents } from "../testing/fake-perspicax-agents.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createCodeRoutes } from "./code.ts";
import { PASS } from "./table.ts";

let fake: FakePerspicaxAgents;
let server: Server;
let base = "";
let dataDir = "";
let manager: CloudAgentManager;
let personalHook: Parameters<typeof createCodeRoutes>[0]["personal"] = undefined;

async function boot(mode: "org" | "solo") {
  fake = await startFakePerspicaxAgents({ tickMs: 0 });
  dataDir = mkdtempSync(join(tmpdir(), "sagax-code-routes-"));
  manager = new CloudAgentManager({
    store: new CloudAgentStore(dataDir),
    credentials: new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 3) })),
    providers: new Map([["perspicax", createPerspicaxProvider(fetch, () => fake.url, undefined, () => fake.linkToken)]]),
    accessToken: async () => fake.token,
  });
  const handler = createCodeRoutes({
    client: new PerspicaxAgentsClient(),
    manager,
    reachable: () => mode === "org" ? { ok: true } : { ok: false, reason: "solo" },
    access: async () => mode === "org"
      ? { ok: true, principalId: "pr_alice", access: { baseUrl: fake.url, token: fake.token, link: () => fake.linkToken } }
      : { ok: false, reason: "solo" },
    consoleUrl: () => `${fake.url}/console/agents`,
    botVisible: (_auth, botId) => botId === "bot-1",
    personal: () => personalHook?.() ?? null,
  });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void handler({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "local" } as unknown as RequestAuth, json, readBody })
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fake.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() as Record<string, any> };
};
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, any> };
};

describe("Code routes on a solo server", () => {
  beforeEach(() => boot("solo"));

  it("say Code needs Sagax Business and refuse the data routes", async () => {
    expect(await get("/api/code/status")).toEqual({ status: 200, body: { available: false, reason: "solo", businessUrl: "https://pulsatrix.ca" } });
    expect((await get("/api/code/runs")).status).toBe(404);
  });
});

describe("Code routes on an organization server", () => {
  beforeEach(() => boot("org"));

  it("lists the person's runs newest first, joined with the thread that launched one", async () => {
    const record = await manager.launch({ botId: "bot-1", threadId: "thread-9", principalId: "pr_alice", launch: { provider: "perspicax", prompt: "Corrige", envId: "env_01demoweb" } });
    const { status, body } = await get("/api/code/runs");
    expect(status).toBe(200);
    const items = body.items as { id: string; updated_at: string; botId?: string; threadId?: string }[];
    expect(items.find((run) => run.id === record.externalId)).toMatchObject({ botId: "bot-1", threadId: "thread-9" });
    expect(items.filter((run) => run.botId).length).toBe(1);
    const times = items.map((run) => Date.parse(run.updated_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("launches, follows up, stops and reads the artifacts", async () => {
    expect((await post("/api/code/runs", { prompt: "x" })).status).toBe(400);
    expect((await post("/api/code/runs", { env_id: "env_01demoweb", prompt: "x", engine: "other" })).status).toBe(400);
    const launched = await post("/api/code/runs", { env_id: "env_01demoweb", prompt: "Ajoute un test", engine: "codex" });
    expect(launched.status).toBe(201);
    expect(launched.body.item).toMatchObject({ origin: "sagax", engine: "codex", state: "queued" });
    const id = launched.body.item.id as string;
    for (let i = 0; i < 20; i++) fake.tick();
    const diff = await get(`/api/code/runs/${id}/diff`);
    expect(diff.body.available).toBe(true);
    expect(diff.body.items[0].path).toBe("src/composer/Composer.tsx");
    expect((await get(`/api/code/runs/${id}/commits`)).body.items.length).toBe(1);
    const followed = await post(`/api/code/runs/${id}/followup`, { text: "Encore", mode: "steer" });
    expect(followed.body.item.state).toBe("running");
    expect(fake.events(id).at(-2)?.payload).toMatchObject({ text: "Encore", mode: "steer" });
    expect((await post(`/api/code/runs/${id}/stop`, {})).body.item.state).toBe("stopped");
    expect((await post(`/api/code/runs/${id}/read`, {})).body.item.unread).toBe(false);
  });

  it("answers an approval and relays the run's events live", async () => {
    const answered = await post("/api/code/runs/run_06approv0f42/approve", { approval_id: "ap_1", option: "Autoriser" });
    expect(answered.body.item.state).toBe("running");
    const abort = new AbortController();
    const res = await fetch(`${base}/api/code/runs/run_06approv0f42/stream?after=0`, { signal: abort.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: approval_answer")) text += new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    expect(text).toMatch(/event: requested\nid: 1\ndata: \{/);
    expect(text).not.toContain(fake.token);
  });

  it("lists runs started outside Sagax (console, MCP) but not a teammate's", async () => {
    const items = (await get("/api/code/runs")).body.items as { id: string; origin: string }[];
    expect(items.some((run) => run.origin === "console")).toBe(true);
    expect(items.some((run) => run.id === "run_08team000b12")).toBe(false);
  });

  it("resumes the relayed stream after the browser's Last-Event-ID", async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/api/code/runs/run_01merged0a3f/stream`, { headers: { "last-event-id": "5" }, signal: abort.signal });
    const reader = res.body!.getReader();
    let text = "";
    while (!/\nid: \d+\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    expect(text).toMatch(/\nid: 6\n/);
    expect(text).not.toMatch(/\nid: [1-5]\n/);
  });

  it("refuses a personal launch without the sign-in, and shows a run's subscription state", async () => {
    let signedIn = false;
    const watched: string[] = [];
    personalHook = () => ({
      ready: () => signedIn ? { ok: true } : { ok: false, message: "Connect your Claude subscription in Sagax." },
      watch: (_p, runId) => { watched.push(runId); },
      status: (runId) => runId === "run_03open000c2d" ? { state: "missing", engine: "claude-code" } : undefined,
    });
    try {
      const refused = await post("/api/code/runs", { env_id: "env_01demoweb", prompt: "Corrige" });
      expect(refused).toMatchObject({ status: 409, body: { code: "no_subscription", error: "Connect your Claude subscription in Sagax." } });
      signedIn = true;
      const made = await post("/api/code/runs", { env_id: "env_01demoweb", prompt: "Corrige" });
      expect(made.status).toBe(201);
      expect(watched).toEqual([made.body.item.id]);
      // a team environment (organization key): no check
      signedIn = false;
      expect((await post("/api/code/runs", { env_id: "env_02demoapi", prompt: "Corrige" })).status).toBe(201);
      expect((await get("/api/code/runs/run_03open000c2d")).body.item.subscription).toEqual({ state: "missing", engine: "claude-code" });
    } finally {
      personalHook = undefined;
    }
  });

  it("says a missing artifact route is not available yet instead of failing", async () => {
    expect((await get("/api/code/runs/run_05failed0e11/diff")).body).toEqual({ available: true, items: [] });
    expect((await get("/api/code/runs/run_nope/diff")).status).toBe(404);
  });
});
