// A routine whose engine fails, on a Perspicax organization server, through
// the real server (production, 2026-10-08: "Dispatch matin TN" on Orion showed a bare
// "Failed: rpc_error" on Run now).
//
//   Run now      the owner (an admin) runs her own routine: the turn reaches
//                the engine (no admin gate, no member scope), and a provider
//                refusal (Grok Build answering 402 Payment Required inside a
//                JSON-RPC -32603) fails the run with words that say what
//                refused and what to do, never a bare rpc_error; the server
//                log keeps the RPC failure itself
//   then         the same Run now completes once the engine answers
//   incident     the failed run's incident report goes to her Primary Bot's
//                "Team incidents" thread; a thread there pinned to a model
//                with no credentials on the server (pi on a desktop local
//                model in production; Codex with no login or key here) gives
//                way to the bot's own model with a notice, instead of being
//                refused no_access/no_credentials
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const FAKE_PI = join(SERVER_DIR, "testing", "fake-pi-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9S6ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
/** What grok 1.0.50 answered on production (server data, native thread log). */
const GROK_402 = {
  code: -32603,
  message: "Internal error",
  data: { message: "API error (status 402 Payment Required): Grok Build usage balance exhausted", http_status: 402 },
};

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
let failureFile = "";

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

type Run = { id: string; routineId: string; status: string; error?: string };
type Message = { id: string; kind: string; role: string; text?: string; tool?: { name: string; ok?: boolean }; access?: { reason: string; cause?: string } };

async function runsOf(auth: Auth, routineId: string): Promise<Run[]> {
  return (((await api("GET", "/api/routines", auth)).body.runs ?? []) as Run[]).filter((r) => r.routineId === routineId);
}
async function runNow(auth: Auth, routineId: string): Promise<Run> {
  const started = await api("POST", `/api/routines/${routineId}/run`, auth, {});
  expect(started.status, started.text).toBe(201);
  const id = started.body.run.id as string;
  return waitFor(async () => (await runsOf(auth, routineId)).find((r) => r.id === id && ["completed", "failed", "cancelled"].includes(r.status)), 60_000);
}
async function messagesOf(auth: Auth, threadId: string): Promise<Message[]> {
  return ((await api("GET", `/api/threads/${threadId}/messages`, auth)).body.messages ?? []) as Message[];
}
type Task = { threadId: string; title?: string; modelSelection?: { instanceId: string; model: string } };
async function tasksOf(auth: Auth, botId: string): Promise<Task[]> {
  const bots = (await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; tasks?: Task[] }>;
  return bots.find((bot) => bot.id === botId)?.tasks ?? [];
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      SAGAX_ORG_NAME: "Acme",
      // The Grok 402 is a usage limit: the automatic backup engine would run
      // the routine again on another engine and the run would not fail
      // (server/limit-failover-host.ts). This suite is about the failure.
      SAGAX_LIMIT_FAILOVER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

posixOnly("Perspicax organization: a routine whose engine fails says why", () => {
  let alice: Auth;
  let orion: { id: string; threadId: string };
  let quasar: { id: string; threadId: string };
  let routineId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    chmodSync(FAKE_PI, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    // alice keeps no key in Perspicax: Claude and Grok run on the
    // organization's keys, pi has none to run on (as on production)
    idp.directoryPeople = [idp.personOf(ALICE)];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-routine-failure-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    failureFile = join(home, "grok-failure.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      // the organization's keys (Settings > Connections)
      anthropic: { key: "sk-ant-test-org-0000000000" },
      xai: { key: "xai-test-org-00000000000000" },
      instances: {
        claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
        grok: {
          driver: "grokAgent",
          environment: { FAKE_ACP_GROK_VERSION: "1.0.50", FAKE_ACP_RPC_FAILURE_FILE: failureFile },
          config: { cli: FAKE_ACP, fullAuto: true },
        },
        // an engine that runs here, with no key for alice and no organization key
        pi: { driver: "piAgent", config: { cli: FAKE_PI, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    await waitFor(async () => {
      const engines = (await api("GET", "/api/me/engines", alice)).body.engines as Array<{ instanceId: string; orgKey?: boolean }> | undefined;
      return engines?.find((e) => e.instanceId === "grok")?.orgKey === true && engines.find((e) => e.instanceId === "claude")?.orgKey === true;
    });
    const made = await api("POST", "/api/bots", alice, { name: "Orion" });
    expect(made.status, made.text).toBe(201);
    orion = { id: made.body.bot.id, threadId: made.body.bot.threadId };
    expect((await api("PATCH", `/api/bots/${orion.id}`, alice, { modelSelection: { instanceId: "grok", model: "fake-acp-model" } })).status).toBe(200);
    const chief = await api("POST", "/api/bots", alice, { name: "Quasar" });
    expect(chief.status, chief.text).toBe(201);
    quasar = { id: chief.body.bot.id, threadId: chief.body.bot.threadId };
    expect((await api("PATCH", `/api/bots/${quasar.id}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    const promoted = await api("PATCH", `/api/bots/${quasar.id}`, alice, { chiefOfStaff: true });
    expect(promoted.status, promoted.text).toBe(200);
    const routine = await api("POST", "/api/routines", alice, { name: "Dispatch matin TN", botId: orion.id, prompt: "Run the morning dispatch.",
      schedule: { type: "once", at: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    routineId = routine.body.routine.id;
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("Run now by the owner reaches the engine, and a provider refusal reads as words, not rpc_error", async () => {
    writeFileSync(failureFile, JSON.stringify(GROK_402));
    const run = await runNow(alice, routineId);
    expect(run.status, log.slice(-3000)).toBe("failed");
    expect(run.error).not.toBe("rpc_error");
    expect(run.error).toMatch(/^Grok refused this turn/);
    expect(run.error).toContain("usage balance");
    expect(run.error).toContain("402 Payment Required");
    expect(run.error).toMatch(/Add credit .* or choose another model for this bot\./);
    // the engine was reached (session/prompt), and the server log keeps the RPC failure
    expect(log).toMatch(/\[acp\] Grok turn failed: rpc -32603 \(insufficient_funds\): Internal error: API error \(status 402 Payment Required\): Grok Build usage balance exhausted \(session\/prompt\)/);
    // never the admin gate or a member scope: the owner is an admin
    expect(log).not.toMatch(/admin approval|member tool scope/i);
  }, 90_000);

  it("the same Run now completes once the engine answers", async () => {
    rmSync(failureFile, { force: true });
    const run = await runNow(alice, routineId);
    expect(run.status, `${run.error ?? ""}\n${log.slice(-3000)}`).toBe("completed");
  }, 90_000);

  it("the incident report reaches a Primary Bot thread pinned to an engine without credentials: it falls back, with a notice", async () => {
    // the first failure opened "Team incidents" on Quasar
    const incidents = await waitFor(async () => (await tasksOf(alice, quasar.id)).find((task) => task.title === "Team incidents"));
    // pin it to an engine alice has no credentials for on this server
    // (production: pi on a desktop local model; here pi, no key)
    await waitFor(async () => {
      const busy = (await api("GET", `/api/threads/${incidents.threadId}/messages`, alice)).body.messages as Message[] | undefined;
      return busy !== undefined;
    });
    const pinned = await waitFor(async () => {
      const got = await api("PATCH", `/api/bots/${quasar.id}/tasks/${incidents.threadId}`, alice, { modelSelection: { instanceId: "pi", model: "fake-model" } });
      return got.status === 200 ? got : null;
    }, 30_000);
    expect(pinned.status, pinned.text).toBe(200);
    expect((await tasksOf(alice, quasar.id)).find((task) => task.threadId === incidents.threadId)?.modelSelection?.instanceId).toBe("pi");
    const before = (await messagesOf(alice, incidents.threadId)).length;
    writeFileSync(failureFile, JSON.stringify(GROK_402));
    const run = await runNow(alice, routineId);
    expect(run.status).toBe("failed");
    const notice = await waitFor(async () => (await messagesOf(alice, incidents.threadId)).slice(before)
      .find((message) => message.kind === "activity" && message.tool?.name.startsWith("notice: This thread's model") === true), 30_000);
    expect(notice.tool!.name).toContain("cannot run on this server");
    expect(notice.tool!.name).toContain("has no credentials here for Alice");
    expect(notice.tool!.name).toContain("It now uses Quasar's model");
    // the report ran on Quasar's own model: no no_credentials card, a reply
    const after = await waitFor(async () => {
      const messages = (await messagesOf(alice, incidents.threadId)).slice(before);
      return messages.some((message) => message.role === "bot" && message.kind === "text") ? messages : null;
    }, 30_000);
    expect(after.filter((message) => message.kind === "access" && message.access?.cause === "no_credentials")).toEqual([]);
    expect(log).not.toContain(`bot=${quasar.id} refused: no_access/no_credentials`);
    expect((await tasksOf(alice, quasar.id)).find((task) => task.threadId === incidents.threadId)?.modelSelection?.instanceId ?? "claude").toBe("claude");
    expect(existsSync(failureFile)).toBe(true);
  }, 120_000);
});
