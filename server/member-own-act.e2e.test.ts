// A member's own environment through the real organization server (#1098,
// 2026-10-28): two members, Bob and Uma, and an admin. Bob's bot asks for
// permissions through its broker socket like an engine, and the test reads
// who has to answer each card.
//
//   OA-1  act that writes on Bob's own bot and his own routes is his own,
//         never an admin's card (act then runs as him and holds the write
//         for his Allow); act on Uma's bot or on a route of the organization
//         still waits for an admin; Uma answers none of it
//   OA-2  the same in Bob's confidential thread, where an admin card would
//         be refused
//   OA-3  writing the ordinary hidden files of his bot's workspace
//         (.gitignore, .github, .vscode) is his card; .git, .claude and
//         .mcp.json still wait for an admin
//   OA-4  Bob turns Full on for his own bot; Uma cannot on his
import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE: FakeOidcUser = { sub: "01J9OAALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9OABOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const UMA: FakeOidcUser = { sub: "01J9OAUMA000000000000000U", email: "uma@example.test", name: "Uma", preferred_username: "uma", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
/** Request ids stay unique across turns: a card is found by its id. */
let asked = 0;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}), origin: BASE },
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

posixOnly("organization server: a member's own act, hidden files and Full access (#1098)", () => {
  let alice: Auth;
  let bob: Auth;
  let uma: Auth;
  const holdDump = () => join(home, "hold-dump.json");

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, UMA].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-own-act-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: {
        // A turn that waits, so the test speaks to its permission broker.
        hold: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } },
      },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { SAGAX_TEST_FIXED_WORKSPACE: "1",
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
        SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
    uma = await signIn(UMA);
    await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as unknown[] | undefined;
      return got && got.length === 3;
    });
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  /** A held turn of `bot` in `threadId` and a way to ask its broker like an engine. */
  async function heldTurn(auth: Auth, bot: { id: string; threadId: string }, text: string) {
    rmSync(holdDump(), { force: true });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text, threadId: bot.threadId });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => existsSync(holdDump()), 20_000);
    const mcp = (JSON.parse(readFileSync(holdDump(), "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers;
    const socketPath = mcp.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `own-act-${bot.id.slice(0, 6)}-${++asked}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      return { id, answer: () => answer };
    };
    const cardOf = async (id: string) => waitFor(async () => {
      const got = await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`, auth);
      return (got.body.messages as Array<{ card?: any }> | undefined)?.find((m) => m.card?.requestId === id)?.card ?? null;
    });
    const noAdminCard = async (id: string) => {
      const rows = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`, auth)).body.messages as Array<{ card?: any }>;
      return !rows.some((m) => m.card?.requestId === id && m.card.adminApproval === true);
    };
    const respond = (who: Auth, requestId: string, behavior: "allow" | "deny") =>
      api("POST", `/api/threads/${bot.threadId}/respond`, who, { requestId, behavior });
    const end = async () => {
      for (const socket of sockets) socket.destroy();
      await api("POST", `/api/bots/${bot.id}/interrupt`, auth, { threadId: bot.threadId });
      await waitFor(async () => !((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; busy?: boolean }>).find((b) => b.id === bot.id)?.busy);
    };
    const act = async (method: string, path: string) => {
      const response = await fetch(`${BASE}/api/internal/act`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${mcp.agents.env.SAGAX_COMMS_TOKEN}` },
        body: JSON.stringify({ method, path }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    return { ask, cardOf, noAdminCard, respond, end, act };
  }

  /** A bot of `auth` on the held engine, at Ask so every call shows a card. */
  async function botOf(auth: Auth, name: string) {
    const created = await api("POST", "/api/bots", auth, { name });
    expect(created.status, created.text).toBe(201);
    const bot = { id: created.body.bot.id as string, threadId: created.body.bot.threadId as string };
    expect((await api("PATCH", `/api/bots/${bot.id}`, auth, { modelSelection: { instanceId: "hold", model: "fake-model" } })).status).toBe(200);
    const level = await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, auth, { approvalMode: "ask" });
    expect(level.status, level.text).toBe(200);
    return bot;
  }

  it("#1993: act never forwards a Sagax session as a console assertion; local reads still run as the person", async () => {
    for (const auth of [alice, bob]) {
      const bot = await botOf(auth, "Wren");
      const turn = await heldTurn(auth, bot, "Read my routines.");
      try {
        for (const path of ["/api/org/admin/routines", "/api/org/admin/routines/example/runs", "/api/org/member/bots"]) {
          const result = await turn.act("GET", path);
          expect(result.status).toBe(400);
          expect(result.body.error).toContain("Connect a Perspicax profile to this bot");
          expect(result.body.error).toContain("/api/routines");
          expect(result.body.error).not.toContain("not a compact JWS");
        }
        const local = await turn.act("GET", "/api/bots");
        expect(local.status).toBe(200);
        const bots = JSON.parse(String(local.body.text)).bots as Array<{ id: string }>;
        expect(bots.some((item) => item.id === bot.id)).toBe(true);
        if (auth === bob) {
          // A member's replay remains scoped to that member.
          const all = (await api("GET", "/api/bots", alice)).body.bots as Array<{ id: string }>;
          expect(all.some((item) => !bots.some((own) => own.id === item.id))).toBe(true);
        }
      } finally {
        await turn.end();
      }
    }
  }, 60_000);

  it("OA-1: act writing on his own bot and routes is his, never an admin's; another's bot or the organization stays an admin's, and Uma answers none of it", async () => {
    const mine = await botOf(bob, "Bob Builder");
    const hers = await botOf(uma, "Uma Notes");
    const turn = await heldTurn(bob, mine, "renomme-toi");
    try {
      // Sagax's own act: the engine card is not an admin's; act itself
      // then runs as Bob and holds the write for his own Allow (bot-act.ts)
      for (const input of [
        { method: "PATCH", path: `/api/bots/${mine.id}`, body: { title: "Builder" } },
        { plugins: { action: "install", botId: mine.id, marketplace: "m", plugin: "p" } },
        { method: "POST", path: "/api/routines", body: { botId: mine.id, name: "Daily" } },
      ]) {
        const own = await turn.ask("mcp__agents__act", input);
        await waitFor(async () => own.answer());
        expect(own.answer()?.behavior, JSON.stringify(input)).toBe("allow");
        expect(await turn.noAdminCard(own.id)).toBe(true);
      }
      // Uma's bot, and a route of the organization: an admin's card
      const other = await turn.ask("mcp__agents__act", { method: "PATCH", path: `/api/bots/${hers.id}`, body: { title: "Taken" } });
      expect((await turn.cardOf(other.id)).adminApproval).toBe(true);
      expect(other.answer()).toBeUndefined();
      const org = await turn.ask("mcp__agents__act", { method: "PUT", path: "/api/config", body: { language: "fr" } });
      expect((await turn.cardOf(org.id)).adminApproval).toBe(true);
      // Uma, another member, answers nothing in Bob's thread
      const foreign = await turn.respond(uma, other.id, "allow");
      expect([403, 404], foreign.text).toContain(foreign.status);
      expect(other.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
    // and she cannot reach his bot herself
    const touched = await api("PATCH", `/api/bots/${mine.id}`, uma, { title: "Hers" });
    expect([403, 404], touched.text).toContain(touched.status);
  }, 90_000);

  it("OA-2: in his confidential thread, act on his own bot is his, instead of an admin card that would be refused", async () => {
    const mine = await botOf(bob, "Bob Private");
    const task = await api("POST", `/api/bots/${mine.id}/tasks`, bob, { title: "Dossier", confidential: true });
    expect(task.status, task.text).toBe(201);
    const thread = { id: mine.id, threadId: task.body.task.threadId as string };
    const level = await api("PATCH", `/api/bots/${mine.id}/tasks/${thread.threadId}`, bob, { approvalMode: "ask" });
    expect(level.status, level.text).toBe(200);
    const turn = await heldTurn(bob, thread, "renomme-toi");
    try {
      const own = await turn.ask("mcp__agents__act", { method: "PATCH", path: `/api/bots/${mine.id}`, body: { title: "Private" } });
      await waitFor(async () => own.answer());
      expect(own.answer()?.behavior).toBe("allow");
      // someone else's bot: an admin's card, refused in a confidential thread
      const hers = await botOf(uma, "Uma Private");
      const other = await turn.ask("mcp__agents__act", { method: "PATCH", path: `/api/bots/${hers.id}`, body: { title: "Taken" } });
      await waitFor(async () => other.answer());
      expect(other.answer()?.behavior).toBe("deny");
      // Uma never reads his confidential thread
      const peek = await api("GET", `/api/threads/${thread.threadId}/messages?limit=10`, uma);
      expect([403, 404], peek.text).toContain(peek.status);
    } finally {
      await turn.end();
    }
  }, 90_000);

  it("OA-3: ordinary hidden files of his bot's workspace are his card; .git, .claude and .mcp.json stay an admin's", async () => {
    const mine = await botOf(bob, "Bob Repo");
    const workspace = join(realpathSync(join(home, ".sagax")), "task-workspaces", mine.id, "repo");
    mkdirSync(workspace, { recursive: true });
    const turn = await heldTurn(bob, mine, "prépare le dépôt");
    try {
      for (const name of [".gitignore", join(".github", "workflows", "ci.yml"), join(".vscode", "settings.json")]) {
        const write = await turn.ask("Write", { file_path: join(workspace, name), content: "x" });
        expect((await turn.cardOf(write.id)).adminApproval, name).not.toBe(true);
      }
      for (const name of [join(".git", "hooks", "pre-commit"), join(".claude", "settings.json"), ".mcp.json"]) {
        const write = await turn.ask("Write", { file_path: join(workspace, name), content: "x" });
        expect((await turn.cardOf(write.id)).adminApproval, name).toBe(true);
      }
    } finally {
      await turn.end();
    }
  }, 90_000);

  it("OA-4: he turns Full on for his own bot; Uma cannot on his", async () => {
    const mine = await botOf(bob, "Bob Full");
    const foreign = await api("PATCH", `/api/bots/${mine.id}`, uma, { approvalMode: "full", confirmFullAccess: true });
    expect([403, 404], foreign.text).toContain(foreign.status);
    const full = await api("PATCH", `/api/bots/${mine.id}`, bob, { approvalMode: "full", confirmFullAccess: true });
    expect(full.status, full.text).toBe(200);
    const stored = ((await api("GET", "/api/bots?messages=0", bob)).body.bots as Array<{ id: string; approvalMode?: string }>).find((bot) => bot.id === mine.id);
    expect(stored?.approvalMode).toBe("full");
  }, 60_000);
});
