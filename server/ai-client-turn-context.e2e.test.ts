// What a one-word ping from an AI client puts in front of the engine, through
// the two member API doors Perspicax uses: the deprecated `sagax_send`
// (POST bots/{id}/messages) and the recommended `send_prompt` (POST
// agents/send_prompt). Since #1170 both land in the person's single chat
// with the bot, never a hidden conversation; `thread_id` names one on purpose.
//
// The fake Claude CLI exits after each turn (FAKE_CLAUDE_EXIT_AFTER_TURN), so
// every turn launches again and the dump holds that turn's own launch files:
// its system prompt, its MCP servers, its argv (--resume) and the prompt it
// was handed. The native session a resumed turn continues holds every earlier
// message of the conversation, which the model reads again: the test counts
// it from the thread itself. Estimated tokens are characters / 4.
//
// Set AI_CLIENT_CONTEXT_REPORT=<file> to write the figures there as JSON.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9C1ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9C1BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
/** Earlier exchanges in the AI client's conversation before the pings. */
const EARLIER = 8;
const EARLIER_TEXT = 2_000;

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; bearer?: string };
type Reply = { status: number; body: any; text: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<Reply> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
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

/** One AI client call for this person, as Perspicax signs it. */
const member = (method: string, sub: string, user: FakeOidcUser, body?: unknown) =>
  api(method, `/api/org/member/${sub}`, {
    bearer: idp.consoleAssertion({
      sub: user.sub, aud: BASE, role: user.role === "admin" ? "admin" : "employee", teams: user.teams ?? [],
      claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }),
    }),
  }, body);

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
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key-000000",
      SAGAX_ORG_NAME: "Acme",
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

type Dump = { argv: string[]; prompt: unknown; systemPrompt: string | null; mcpConfig: { mcpServers?: Record<string, unknown> } | null };
type Measure = { door: string; threadId: string; resumed: boolean; system: number; message: number; history: number; mcpServers: string[]; tokens: number };

posixOnly("AI client ping: what the engine is handed (sagax_send vs send_prompt)", () => {
  let bob: Auth;
  let botId = "";
  const dumpPath = () => join(home, "turn-dump.json");

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [idp.personOf(ALICE), idp.personOf(BOB)];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-ai-client-context-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: {
          // fcce56775 (#1812): this fixture is paid by the organization API key.
          driver: "claudeAgent", access: "api",
          // one-shot calls (a conversation title) write elsewhere, so the
          // turn dump always holds the turn just measured
          // each turn ends on its words: one that ends on a tool call is
          // continued once (server/turns/unfinished-turn.ts), and a job's
          // wait could read that continuation as still working (#4128)
          environment: { FAKE_CLAUDE_DUMP: dumpPath(), FAKE_CLAUDE_TEXT_DUMP: join(home, "one-shot-dump.json"), FAKE_CLAUDE_EXIT_AFTER_TURN: "1", FAKE_CLAUDE_TOOL_CALLS: "[]" },
          config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true },
        },
      },
    }));
    await start();
    const alice = await signIn(ALICE);
    const people = await (async () => {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const got = (await api("GET", "/api/org/directory", alice)).body.people as unknown[] | undefined;
        if (got && got.length === 2) return got;
        if (Date.now() > deadline) throw new Error(`directory never filled:\n${log.slice(-3000)}`);
        await sleep(300);
      }
    })();
    expect(people).toHaveLength(2);
    bob = await signIn(BOB);
    const created = await api("POST", "/api/bots", bob, { name: "Orion" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    const patched = await api("PATCH", `/api/bots/${botId}`, bob, { modelSelection: { instanceId: "claude", model: "fake-model" } });
    expect(patched.status, patched.text).toBe(200);
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  /** Characters of every message the conversation holds before `beforeId`. */
  async function historyChars(threadId: string, beforeId: string | null): Promise<number> {
    const read = await api("GET", `/api/threads/${threadId}/messages?limit=500`, bob);
    expect(read.status, read.text).toBe(200);
    const rows = read.body.messages as Array<{ id: string; text?: string }>;
    const end = beforeId ? rows.findIndex((row) => row.id === beforeId) : rows.length;
    return rows.slice(0, end < 0 ? rows.length : end).reduce((n, row) => n + (row.text ?? "").length, 0);
  }

  function readDump(): Dump {
    return JSON.parse(readFileSync(dumpPath(), "utf8")) as Dump;
  }

  async function measure(door: string, threadId: string, messageId: string | null): Promise<Measure> {
    const dump = readDump();
    const resumed = dump.argv.includes("--resume");
    const system = (dump.systemPrompt ?? "").length;
    const message = JSON.stringify(dump.prompt).length;
    const history = resumed ? await historyChars(threadId, messageId) : 0;
    const mcpServers = Object.keys(dump.mcpConfig?.mcpServers ?? {}).sort();
    return { door, threadId, resumed, system, message, history, mcpServers, tokens: Math.ceil((system + message + history) / 4) };
  }

  it("a ping through send_prompt opens a fresh conversation; an explicit thread_id continues the long one (#1170, #2575)", async () => {
    // The AI client's earlier work in the person's chat with the bot.
    let threadId = "";
    for (let i = 0; i < EARLIER; i += 1) {
      const sent = await member("POST", `bots/${botId}/messages`, BOB, { text: `job ${i} ${"x".repeat(EARLIER_TEXT)}`, wait: 30 });
      expect(sent.status, sent.text).toBe(200);
      expect(sent.body.status, sent.text).toBe("done");
      threadId ||= sent.body.threadId;
      expect(sent.body.threadId).toBe(threadId);
    }

    const viaSend = await member("POST", `bots/${botId}/messages`, BOB, { text: "ping", wait: 30 });
    expect(viaSend.status, viaSend.text).toBe(200);
    expect(viaSend.body.threadId).toBe(threadId);
    const send = await measure("sagax_send", threadId, viaSend.body.messageId);

    // send_prompt by default: a fresh conversation (#2575), nothing resumed
    const viaPrompt = await member("POST", "agents/send_prompt", BOB, { agent_id: botId, prompt: "ping", mode: "blocking", timeout_ms: 30_000 });
    expect(viaPrompt.status, viaPrompt.text).toBe(200);
    expect(viaPrompt.body.finished).toBe(true);
    expect(viaPrompt.body.thread_id).not.toBe(threadId);
    const freshRows = await api("GET", `/api/threads/${viaPrompt.body.thread_id}/messages?limit=500`, bob);
    const freshPing = (freshRows.body.messages as Array<{ id: string; role: string; text?: string }>).find((row) => row.role === "user" && row.text === "ping");
    const prompt = await measure("send_prompt", viaPrompt.body.thread_id, freshPing!.id);

    // send_prompt with thread_id: the long conversation, on purpose
    const viaContinue = await member("POST", "agents/send_prompt", BOB, { agent_id: botId, prompt: "ping", mode: "blocking", timeout_ms: 30_000, thread_id: threadId });
    expect(viaContinue.status, viaContinue.text).toBe(200);
    expect(viaContinue.body.thread_id).toBe(threadId);
    const latest = await api("GET", `/api/threads/${threadId}/messages?limit=500`, bob);
    const pingRows = (latest.body.messages as Array<{ id: string; role: string; text?: string }>).filter((row) => row.role === "user" && row.text === "ping");
    const continued = await measure("send_prompt thread_id", threadId, pingRows.at(-1)!.id);

    if (process.env.AI_CLIENT_CONTEXT_REPORT) {
      writeFileSync(process.env.AI_CLIENT_CONTEXT_REPORT, JSON.stringify({ earlier: EARLIER, earlierText: EARLIER_TEXT, rows: [send, prompt, continued], pingPrompt: readDump().prompt }, null, 2));
    }

    expect(send.resumed).toBe(true);
    // the default send_prompt starts clean: nothing before its own ping
    expect(prompt.history).toBe(0);
    expect(prompt.mcpServers).toEqual(send.mcpServers);
    expect(continued.resumed).toBe(true);
    expect(continued.history).toBeGreaterThan(send.history);
    expect(continued.mcpServers).toEqual(send.mcpServers);
    // #4128: every turn ended on its words, so no automatic continuation
    // left a job's wait reading its thread as still working
    expect(log).not.toContain("[unfinished-turn]");
  }, 240_000);
});
