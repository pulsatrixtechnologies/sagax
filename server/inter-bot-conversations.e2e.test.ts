// A bot-to-bot conversation in BOTH bots' chats (2026-10-19, JC). Real
// organization server, fake Claude CLI: Bob, who owns both bots, has the first ask
// a second bot. Then:
//
//   BC-1  both bots' wire name the one conversation (out on the asker, in on
//         the destination), the same thread, and its messages read through
//         the ordinary thread route hold both bots' words
//   BC-2  a member who may use both bots, one who may use only the asker
//         and one who may use neither are named nothing: not the thread, not the
//         other bot's name
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const BOB: FakeOidcUser = { sub: "01J9BCBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "admin" };
const ANA: FakeOidcUser = { sub: "01J9BCANA00000000000000A", email: "ana@example.test", name: "Ana", preferred_username: "ana", role: "employee" };
const CARL: FakeOidcUser = { sub: "01J9BCCARL0000000000000C", email: "carl@example.test", name: "Carl", preferred_username: "carl", role: "employee" };
const ZOE: FakeOidcUser = { sub: "01J9BCZOE00000000000000Z", email: "zoe@example.test", name: "Zoe", preferred_username: "zoe", role: "employee" };

let BASE = "";
let child: ChildProcess;
let home = "";
let log = "";
let idp: FakeOidcProvider;
type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(200);
  }
}
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
const wire = async (auth: Auth, botId: string): Promise<any | undefined> =>
  ((await api("GET", "/api/bots?messages=0", auth)).body.bots as any[] | undefined)?.find((bot) => bot.id === botId);

posixOnly("organization: a bot-to-bot conversation in both chats", () => {
  let bob: Auth; let ana: Auth; let carl: Auth; let zoe: Auth;
  let alpha = ""; let bravo = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: BOB });
    idp.directoryPeople = [BOB, ANA, CARL, ZOE].map((user) => idp.personOf(user));
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-bot-conversations-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: {
        FAKE_CLAUDE_MCP_DUMP: join(home, "mcp-dump.json"), FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
          { server: "agents", tool: "coordinate_bots", arguments: { bot_ids: ["Bravo"], message: "PEER-HELLO from Alpha", request_key: "bc-1" }, when: "ASK-BRAVO" },
        ]),
      }, config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
        SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key", SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server exited during boot:\n${log}`);
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
    bob = await signIn(BOB);
    const people = await waitFor(async () => {
      const list = (await api("GET", "/api/org/directory", bob)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 4 ? list : null;
    });
    const id = (login: string) => people.find((person) => person.login === login)!.principalId;
    for (const [name, set] of [["Alpha", (v: string) => (alpha = v)], ["Bravo", (v: string) => (bravo = v)]] as const) {
      const created = await api("POST", "/api/bots", bob, { name });
      expect(created.status, created.text).toBe(201);
      set(created.body.bot.id);
      expect((await api("PATCH", `/api/bots/${created.body.bot.id}`, bob, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    }
    for (const [botId, who] of [[alpha, "ana"], [bravo, "ana"], [alpha, "carl"]] as const) {
      const shared = await api("PUT", `/api/bots/${botId}/grants`, bob, { target: `user:${id(who)}`, level: "use" });
      expect(shared.status, shared.text).toBe(200);
    }
    ana = await signIn(ANA); carl = await signIn(CARL); zoe = await signIn(ZOE);
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("BC-1 and BC-2: both chats name the same conversation; whoever cannot read both is named nothing", async () => {
    const made = await api("POST", `/api/bots/${alpha}/tasks`, bob, { title: "Bob's ask", approvalMode: "ask" });
    expect(made.status, made.text).toBe(201);
    const mine = made.body.task.threadId as string;
    expect((await api("POST", `/api/bots/${alpha}/messages`, bob, { text: "ASK-BRAVO now", threadId: mine })).status).toBe(202);
    // the turn's tool call waits on Bob (ask mode): he allows it
    const out = await waitFor(async () => {
      const card = ((await api("GET", `/api/threads/${mine}/messages`, bob)).body.messages ?? [] as any[])
        .find((m: any) => m.card?.requestId && !m.card.answered);
      if (card) await api("POST", `/api/threads/${mine}/respond`, bob, { requestId: card.card.requestId, behavior: "allow" });
      return (await wire(bob, alpha))?.botConversations?.[0];
    });
    expect(out).toMatchObject({ otherBotId: bravo, otherName: "Bravo", direction: "out" });
    const inbound = await waitFor(async () => (await wire(bob, bravo))?.botConversations?.[0]);
    expect(inbound).toMatchObject({ otherBotId: alpha, otherName: "Alpha", direction: "in", threadId: out.threadId });

    const thread = await waitFor(async () => {
      const messages = ((await api("GET", `/api/threads/${out.threadId}/messages`, bob)).body.messages ?? []) as Array<{ role: string; kind: string; text?: string; from?: { name?: string } }>;
      return messages.some((m) => (m.text ?? "").includes("PEER-HELLO") && m.from?.name === "Alpha") ? messages : null;
    });
    expect(thread.length).toBeGreaterThan(0);

    // Carl may use Alpha, not Bravo: nothing is named to him, on either bot
    expect((await wire(carl, alpha))?.botConversations).toBeUndefined();
    expect(JSON.stringify((await api("GET", "/api/bots?messages=0", carl)).body)).not.toContain(out.threadId);
    // Zoe may use neither
    expect(JSON.stringify((await api("GET", "/api/bots?messages=0", zoe)).body)).not.toContain(out.threadId);
    // Ana may use both bots, yet the conversation is the owner's thread: not hers
    for (const id of [alpha, bravo]) expect((await wire(ana, id))?.botConversations).toBeUndefined();
    expect(JSON.stringify((await api("GET", "/api/bots?messages=0", ana)).body)).not.toContain(out.threadId);
  }, 120_000);
});
