// Perspicax runs end to end against the in-process fake of its API: the
// client (contract of Perspicax PR #372), the provider a bot launches with,
// and the manager's local record of a thread-launched run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startFakePerspicaxAgents, type FakePerspicaxAgents } from "../testing/fake-perspicax-agents.ts";
import { CloudAgentCredentialStore } from "./credentials.ts";
import { CloudAgentManager } from "./manager.ts";
import { PerspicaxAgentsClient } from "./perspicax-client.ts";
import { createPerspicaxProvider, pickEnvironment, repoSlug } from "./providers/perspicax.ts";
import { CloudAgentStore } from "./store.ts";
import type { PerspicaxEnvironment } from "../../shared/cloud-agents.ts";

let fake: FakePerspicaxAgents;
let dataDir = "";

beforeEach(async () => {
  fake = await startFakePerspicaxAgents({ tickMs: 0 });
});

afterEach(async () => {
  await fake.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

const access = () => ({ baseUrl: fake.url, token: fake.token, link: () => fake.linkToken });

describe("PerspicaxAgentsClient", () => {
  it("lists environments and runs with the link token and the sign-in as subject", async () => {
    const client = new PerspicaxAgentsClient();
    const envs = await client.environments(access());
    expect(envs.map((env) => env.name)).toEqual(["demo/web-app", "demo/api"]);
    const runs = await client.runs(access(), { mine: true });
    expect(runs.length).toBeGreaterThanOrEqual(6);
    expect(runs.find((run) => run.id === "run_01merged0a3f")?.pr).toMatchObject({ number: 42, state: "merged" });
  });

  it("turns a refused sign-in token into a 403 ProviderHttpError without the token in it", async () => {
    const client = new PerspicaxAgentsClient();
    const error = await client.environments({ baseUrl: fake.url, token: "wrong-token-value", link: () => fake.linkToken }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 403 });
    expect(String((error as Error).message)).not.toContain("wrong-token-value");
  });

  it("sends the link token as the Bearer and the acting person's sign-in as the subject, SSE included", async () => {
    const seen: Headers[] = [];
    const client = new PerspicaxAgentsClient(async (input, init) => { seen.push(new Headers(init?.headers)); return fetch(input, init); });
    await client.runs(access(), { mine: true });
    const abort = new AbortController();
    for await (const event of client.stream(access(), "run_01merged0a3f", 0, abort.signal)) { if (event.seq >= 1) abort.abort(); }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const headers of seen) {
      expect(headers.get("authorization")).toBe(`Bearer ${fake.linkToken}`);
      expect(headers.get("x-perspicax-subject-token")).toBe(fake.token);
    }
  });

  it("is refused when the sign-in token is the Bearer alone, as Perspicax refuses it", async () => {
    const res = await fetch(`${fake.url}/api/v1/agents/runs?mine=true`, { headers: { authorization: `Bearer ${fake.token}` } });
    expect(res.status).toBe(401);
    const client = new PerspicaxAgentsClient();
    await expect(client.runs({ baseUrl: fake.url, token: fake.token, link: () => null })).rejects.toMatchObject({ status: 501, code: "not_linked" });
  });

  it("reads the link token again once after a 401 (it rotated)", async () => {
    const client = new PerspicaxAgentsClient();
    let rereads = 0;
    const rotated = { baseUrl: fake.url, token: fake.token, link: () => "old-link-token", relink: () => { rereads++; return fake.linkToken; } };
    expect((await client.environments(rotated)).length).toBeGreaterThan(0);
    expect(rereads).toBe(1);
  });

  it("refuses an id that is not a run id before it reaches a path", async () => {
    const client = new PerspicaxAgentsClient();
    await expect(client.run(access(), "../environments")).rejects.toMatchObject({ status: 400 });
  });

  it("creates a run, plays its events and streams them as SSE", async () => {
    const client = new PerspicaxAgentsClient();
    const run = await client.create(access(), { env_id: "env_01demoweb", prompt: "Corrige le bouton", origin: "sagax" });
    expect(run.state).toBe("queued");
    for (let i = 0; i < 20; i++) fake.tick();
    const after = await client.run(access(), run.id);
    expect(after.state).toBe("idle");
    expect(after.pr).toMatchObject({ state: "draft" });
    const events = await client.events(access(), run.id);
    expect(events[0]?.kind).toBe("requested");
    expect(events.map((e) => e.kind)).toContain("tool_call");
    const abort = new AbortController();
    const seen: number[] = [];
    for await (const event of client.stream(access(), run.id, 2, abort.signal)) {
      seen.push(event.seq);
      if (event.seq === events.at(-1)!.seq) abort.abort();
    }
    expect(seen[0]).toBe(3);
    expect(seen.at(-1)).toBe(events.at(-1)!.seq);
  });

  it("reads the diff, commits and files, and follows up", async () => {
    const client = new PerspicaxAgentsClient();
    const diff = await client.diff(access(), "run_01merged0a3f");
    expect(diff.available).toBe(true);
    expect(diff.items.map((file) => file.path)).toEqual(["src/invoices/list.ts", "src/invoices/list.test.ts", "docs/invoices.md"]);
    expect(diff.items[1]).toMatchObject({ status: "added", removed: 0 });
    expect(diff.items[2]?.previewable).toBe(true);
    expect((await client.commits(access(), "run_01merged0a3f")).items).toHaveLength(2);
    expect((await client.files(access(), "run_01merged0a3f")).items.some((f) => f.path === "src/invoices/list.ts")).toBe(true);
    const followed = await client.followUp(access(), "run_02draft00b71", "Ajoute un test de plus", "queue");
    expect(followed.state).toBe("running");
  });

  it("reads every page of a list and keeps a teammate's run out of mine", async () => {
    const seen: string[] = [];
    const client = new PerspicaxAgentsClient(async (input, init) => {
      seen.push(String(input));
      return fetch(input, init);
    });
    const all = await client.runs(access());
    const mine = await client.runs(access(), { mine: true });
    expect(all.some((run) => run.id === "run_08team000b12")).toBe(true);
    expect(mine.some((run) => run.id === "run_08team000b12")).toBe(false);
    expect(mine.every((run) => run.requested_by === "person_demo")).toBe(true);
    // newest first by created_at, as Perspicax lists them
    const created = mine.map((run) => run.created_at);
    expect([...created].sort().reverse()).toEqual(created);
    expect(seen.some((url) => url.includes("page=1") && url.includes("page_size=200"))).toBe(true);
  });

  it("follows every page of a Page<T> answer", async () => {
    const pages = [
      { items: [{ id: "run_a" }, { id: "run_b" }], page: 1, page_size: 2, total: 3 },
      { items: [{ id: "run_c" }], page: 2, page_size: 2, total: 3 },
    ];
    const client = new PerspicaxAgentsClient(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      return new Response(JSON.stringify(pages[page - 1] ?? { items: [], page, page_size: 2, total: 3 }), { headers: { "content-type": "application/json" } });
    });
    expect((await client.runs(access())).map((run) => run.id)).toEqual(["run_a", "run_b", "run_c"]);
  });

  it("shows Perspicax's own message from a {code, message} error body", async () => {
    const client = new PerspicaxAgentsClient();
    await expect(client.create(access(), { env_id: "env_nope", prompt: "x" })).rejects.toMatchObject({ status: 404, message: "environment env_nope" });
    await expect(client.stop(access(), "run_01merged0a3f")).rejects.toMatchObject({ status: 409 });
    await expect(client.archive(access(), "run_07live000a55")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("stop it first") });
  });

  it("puts an ended run back in the queue on a follow-up, as Perspicax does", async () => {
    const client = new PerspicaxAgentsClient();
    const followed = await client.followUp(access(), "run_04branch0d9e", "Ajoute une section Mise à jour", "steer");
    expect(followed.state).toBe("queued");
    for (let i = 0; i < 20; i++) fake.tick();
    expect((await client.run(access(), "run_04branch0d9e")).state).toBe("idle");
  });

  it("resumes the stream after the Last-Event-ID it sends", async () => {
    const headers: (string | null)[] = [];
    const client = new PerspicaxAgentsClient(async (input, init) => {
      headers.push(new Headers(init?.headers).get("last-event-id"));
      return fetch(input, init);
    });
    const events = await client.allEvents(access(), "run_01merged0a3f");
    const abort = new AbortController();
    const seen: number[] = [];
    for await (const event of client.stream(access(), "run_01merged0a3f", 5, abort.signal)) {
      seen.push(event.seq);
      if (event.seq === events.at(-1)!.seq) abort.abort();
    }
    expect(headers.at(-1)).toBe("5");
    expect(seen[0]).toBe(6);
  });
});

describe("PerspicaxAgentsClient before Perspicax P1.5 (no artifact routes)", () => {
  let early: FakePerspicaxAgents;
  beforeEach(async () => { early = await startFakePerspicaxAgents({ tickMs: 0, artifactRoutes: false }); });
  afterEach(async () => { await early.close(); });
  const earlyAccess = () => ({ baseUrl: early.url, token: early.token, link: () => early.linkToken });

  it("reads the diff and the commits from the run's latest diff and commits events", async () => {
    const client = new PerspicaxAgentsClient();
    const diff = await client.diff(earlyAccess(), "run_01merged0a3f");
    expect(diff.available).toBe(true);
    expect(diff.items.map((file) => file.path)).toEqual(["src/invoices/list.ts", "src/invoices/list.test.ts", "docs/invoices.md"]);
    expect((await client.commits(earlyAccess(), "run_01merged0a3f")).items).toHaveLength(2);
    expect(await client.files(earlyAccess(), "run_01merged0a3f")).toEqual({ available: false, items: [] });
  });

  it("says a run with no diff event has nothing yet, and an approval is not available yet", async () => {
    const client = new PerspicaxAgentsClient();
    expect(await client.diff(earlyAccess(), "run_06approv0f42")).toEqual({ available: false, items: [] });
    await expect(client.approve(earlyAccess(), "run_06approv0f42", "ap_1", "Autoriser")).rejects.toMatchObject({ status: 501, code: "not_available" });
  });
});

describe("pickEnvironment", () => {
  const env = (id: string, owner: string, name: string): PerspicaxEnvironment => ({
    id, name: `${owner}/${name}`, scope: "personnelle", engine_default: "claude-code", model_default: "m",
    repos: [{ provider: "github", owner, name, default_branch: "main" }],
  });

  it("finds the environment by repository URL", () => {
    expect(repoSlug("https://github.com/Demo/Web-App.git")).toBe("demo/web-app");
    expect(pickEnvironment([env("e1", "demo", "web-app"), env("e2", "demo", "api")], { repo: "https://github.com/demo/api" }).id).toBe("e2");
  });

  it("asks when several environments hold the repository", () => {
    expect(() => pickEnvironment([env("e1", "demo", "api"), env("e2", "demo", "api")], { repo: "demo/api" }))
      .toThrow(/Ask the person which one[\s\S]*env_id e1[\s\S]*env_id e2/);
  });

  it("refuses an unknown env_id and a repository no environment holds", () => {
    expect(() => pickEnvironment([env("e1", "demo", "api")], { envId: "nope" })).toThrow(/No Perspicax environment nope/);
    expect(() => pickEnvironment([env("e1", "demo", "api")], { repo: "demo/other" })).toThrow(/No Perspicax environment holds demo\/other/);
  });
});

describe("CloudAgentManager with the perspicax provider", () => {
  const manager = (token: string | null) => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-perspicax-"));
    const store = new CloudAgentStore(dataDir);
    const credentials = new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 7) }));
    const completions: string[] = [];
    const mgr = new CloudAgentManager({
      store,
      credentials,
      providers: new Map([["perspicax", createPerspicaxProvider(fetch, () => fake.url, undefined, () => fake.linkToken)]]),
      accessToken: async () => token,
      onComplete: (event) => { completions.push(event.summary); },
    });
    return { mgr, completions };
  };

  it("launches from a thread with the sign-in token and mirrors stats and PR", async () => {
    const { mgr } = manager(fake.token);
    const record = await mgr.launch({
      botId: "bot-1",
      threadId: "thread-1",
      principalId: "pr_alice",
      launch: { provider: "perspicax", prompt: "Corrige la pagination", repos: [{ url: "https://github.com/demo/web-app" }] },
    });
    expect(record).toMatchObject({ provider: "perspicax", envId: "env_01demoweb", origin: "sagax", botId: "bot-1", threadId: "thread-1" });
    expect(fake.runs().find((run) => run.id === record.externalId)?.origin).toBe("sagax");
    for (let i = 0; i < 20; i++) fake.tick();
    const synced = await mgr.refresh(record.id);
    expect(synced?.status).toBe("idle");
    expect(synced?.pr).toMatchObject({ state: "draft" });
    expect(synced?.stats?.files).toBeGreaterThan(0);
    expect(synced?.gitBranches[0]?.branch).toMatch(/^px\//);
  });

  it("wakes the bot when a turn ends idle, once per turn, and again after a follow-up", async () => {
    const { mgr, completions } = manager(fake.token);
    const record = await mgr.launch({ botId: "bot-1", threadId: "thread-1", principalId: "pr_alice", launch: { provider: "perspicax", prompt: "Corrige", repos: [{ url: "https://github.com/demo/web-app" }] } });
    for (let i = 0; i < 20; i++) fake.tick();
    await mgr.refresh(record.id);
    await mgr.refresh(record.id);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toContain("PR en brouillon");
    await mgr.followUp(record.id, "pr_alice", { text: "Encore un test", mode: "steer" });
    await mgr.refresh(record.id);
    for (let i = 0; i < 20; i++) fake.tick();
    await mgr.refresh(record.id);
    expect(completions).toHaveLength(2);
  });

  it("refuses a personal run without the person's sign-in for its engine, and watches one it launched", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-perspicax-"));
    const watched: string[] = [];
    let signedIn = false;
    const personal = { ready: (_p: string, engine: string) => signedIn ? { ok: true as const } : { ok: false as const, message: `no ${engine} sign-in` }, watch: (_p: string, runId: string) => { watched.push(runId); } };
    const mgr = new CloudAgentManager({
      store: new CloudAgentStore(dataDir),
      credentials: new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 7) })),
      providers: new Map([["perspicax", createPerspicaxProvider(fetch, () => fake.url, () => personal, () => fake.linkToken)]]),
      accessToken: async () => fake.token,
    });
    const launch = { botId: "bot-1", threadId: "thread-1", principalId: "pr_alice", launch: { provider: "perspicax" as const, prompt: "Corrige", repos: [{ url: "https://github.com/demo/web-app" }] } };
    await expect(mgr.launch(launch)).rejects.toMatchObject({ status: 409, code: "no_subscription", message: "no claude-code sign-in" });
    expect(fake.runs().filter((r) => r.prompt === "Corrige")).toHaveLength(0);
    signedIn = true;
    const record = await mgr.launch(launch);
    expect(watched).toEqual([record.externalId]);
    // A team environment uses the organization's key: no check, no watch.
    signedIn = false;
    await mgr.launch({ ...launch, launch: { ...launch.launch, repos: [{ url: "https://github.com/demo/api" }] } });
    expect(watched).toHaveLength(1);
  });

  it("asks which environment when the repository is missing and several exist", async () => {
    const { mgr } = manager(fake.token);
    await expect(mgr.launch({ botId: "bot-1", threadId: "thread-1", principalId: "pr_alice", launch: { provider: "perspicax", prompt: "x" } }))
      .rejects.toThrow(/Which repository\?/);
  });

  it("keeps a record waiting, not failed, while the person has no live sign-in", async () => {
    let token: string | null = fake.token;
    dataDir = mkdtempSync(join(tmpdir(), "sagax-perspicax-"));
    const store = new CloudAgentStore(dataDir);
    const mgr = new CloudAgentManager({
      store,
      credentials: new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 7) })),
      providers: new Map([["perspicax", createPerspicaxProvider(fetch, () => fake.url, undefined, () => fake.linkToken)]]),
      accessToken: async () => token,
    });
    const record = await mgr.launch({ botId: "b", threadId: "t", principalId: "p", launch: { provider: "perspicax", prompt: "x", envId: "env_01demoweb" } });
    token = null;
    const after = await mgr.refresh(record.id);
    expect(after?.status).not.toBe("failed");
    await expect(mgr.syncActive()).resolves.toBeUndefined();
  });
});

describe("CloudAgentStore files", () => {
  it("keeps Perspicax runs out of the file an older build parses, and skips a bad row instead of wiping", async () => {
    const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
    dataDir = mkdtempSync(join(tmpdir(), "sagax-store-"));
    const store = new CloudAgentStore(dataDir);
    store.create({ botId: "b", threadId: "t", principalId: "p", provider: "cursor", externalId: "bc-1", name: "A", repos: [] });
    store.create({ botId: "b", threadId: "t", principalId: "p", provider: "perspicax", externalId: "run_1", name: "B", repos: [], status: "queued", envId: "env_1", origin: "sagax" });
    const legacy = JSON.parse(readFileSync(join(dataDir, "cloud-agents", "records.json"), "utf8"));
    expect(legacy.agents.map((a: { provider: string }) => a.provider)).toEqual(["cursor"]);
    const px = JSON.parse(readFileSync(join(dataDir, "cloud-agents", "perspicax-records.json"), "utf8"));
    expect(px.agents.map((a: { provider: string }) => a.provider)).toEqual(["perspicax"]);
    legacy.agents.push({ id: "garbage" });
    writeFileSync(join(dataDir, "cloud-agents", "records.json"), JSON.stringify(legacy));
    const reopened = new CloudAgentStore(dataDir);
    expect(reopened.listAll().map((a) => a.externalId).sort()).toEqual(["bc-1", "run_1"]);
    reopened.patch(reopened.listAll()[0]!.id, { name: "A2" });
    expect(existsSync(join(dataDir, "cloud-agents", "records.json.bak"))).toBe(true);
  });

  it("writes only the statuses an older build knows to records.json", async () => {
    const { readFileSync } = await import("node:fs");
    dataDir = mkdtempSync(join(tmpdir(), "sagax-store-"));
    const store = new CloudAgentStore(dataDir);
    const row = store.create({ botId: "b", threadId: "t", principalId: "p", provider: "cursor", externalId: "bc-1", name: "A", repos: [] });
    store.patch(row.id, { status: "expired" });
    const legacy = JSON.parse(readFileSync(join(dataDir, "cloud-agents", "records.json"), "utf8"));
    expect(legacy.agents[0].status).toBe("failed");
    expect(store.get(row.id)?.status).toBe("expired");
  });
});

describe("testing the perspicax provider", () => {
  it("never tests a token pasted in the request, only the person's own sign-in", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-perspicax-"));
    const tested: string[] = [];
    const mgr = new CloudAgentManager({
      store: new CloudAgentStore(dataDir),
      credentials: new CloudAgentCredentialStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 7) })),
      providers: new Map([["perspicax", { ...createPerspicaxProvider(fetch, () => fake.url, undefined, () => fake.linkToken), testToken: async (token: string) => { tested.push(token); } }]]),
      accessToken: async () => fake.token,
    });
    await mgr.testCredential("pr_alice", "perspicax", "someone-elses-sign-in-token");
    expect(tested).toEqual([fake.token]);
  });
});
