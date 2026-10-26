// The member API (server/org-member-routes.ts, Perspicax plan lot C.1)
// through the real server: the local fake provider signs the assertions an
// AI client's calls carry (`act.sub` perspicax-mcp) and the fake Claude CLI
// answers the turns.
//
// Fixture: Alice (organization admin), Bob (member, member defaults), Zoe
// (member whose profiles grant no client key, never signed in to Sagax).
// Orion is Bob's bot on the `slow` engine (answers after 0.8 s, or when a
// gate file appears for a `[gate:NAME]` prompt). Atlas is Alice's bot, with a
// routine.
//
//   M1  a member lists their bots and sends with a wait: the reply comes back
//   M2  a long job answers pending with the thread id, then reads back
//   M3  permission refusals name the key; a bot out of reach stays out
//   M4  an admin runs a routine, reads its run, nudges a person
//   M5  the admin API still refuses an AI client's assertion; audit rows
//   M6  lot C.3: a streamed send stops at a card, the AI client answers it
//       (recorded `via: ai-client` with the person's name), the watch then
//       ends with the structured summary
//   M7  the agent-to-agent tools (agents/{tool}): a person's AI client lists,
//       sends (blocking and async + await_turn) and reads pages; scopes hold
//   M9  2026-10-17: an ask_user question with three options: the stream
//       carries it in line, the pending list shows it to its owner only, a
//       bare allow is 409 option_required, an option closes it (the bot gets
//       the option's words), a second answer is alreadyAnswered
//   M8  Perspicax #321: create_agent makes a temporary agent the app never
//       shows; get_agent reads its profile; only its owner or an admin pins
//       or deletes it; delete_agent archives it and keeps it on disk
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect, type Socket } from "node:net";
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
const ALICE: FakeOidcUser = { sub: "01J9M1ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9M1BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const ZOE: FakeOidcUser = { sub: "01J9M1ZOE00000000000000Z", name: "Zoe", preferred_username: "zoe", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let gates: string;
let log = "";
let idp: FakeOidcProvider;
const sockets: Socket[] = [];

type Auth = { cookie?: string; bearer?: string };
type Reply = { status: number; body: any; text: string; headers: Headers };
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
  return { status: res.status, body: parsed, text, headers: res.headers };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
/** An open /api/events stream: everything it received so far. */
async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}
/** The threads a stream's notifications named. */
const notifiedThreads = (text: string): string[] => text.split("\n")
  .filter((line) => line.startsWith("data: "))
  .flatMap((line) => { try { return [JSON.parse(line.slice(6)) as { kind?: string; notification?: { threadId?: string } }]; } catch { return []; } })
  .flatMap((frame) => (frame.kind === "notify" && frame.notification?.threadId ? [frame.notification.threadId] : []));
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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** One AI client call for this person, as Perspicax signs it. */
const member = (method: string, sub: string, user: FakeOidcUser, body?: unknown, actor = "perspicax-mcp") =>
  api(method, `/api/org/member/${sub}`, {
    bearer: idp.consoleAssertion({
      sub: user.sub, aud: BASE, role: user.role === "admin" ? "admin" : "employee", teams: user.teams ?? [],
      claims: (c) => ({ ...c, act: { sub: actor } }),
    }),
  }, body);

async function createBot(auth: Auth, name: string, instanceId: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const bot = created.body.bot;
  const patched = await api("PATCH", `/api/bots/${bot.id}`, auth, { modelSelection: { instanceId, model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  return { id: bot.id, threadId: bot.threadId };
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
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
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

posixOnly("Perspicax AI clients: the Sagax member API", () => {
  let alice: Auth;
  let bob: Auth;
  const ids: Record<string, string> = {};
  const bots: Record<string, { id: string; threadId: string }> = {};
  let routineId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    // Zoe's profiles grant bots.create and nothing for AI clients.
    idp.directoryPeople = [idp.personOf(ALICE), idp.personOf(BOB), { ...idp.personOf(ZOE), permissions: ["bots.create"] }];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-member-"));
    gates = join(home, "gates");
    mkdirSync(gates, { recursive: true });
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
        slow: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        hold: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json"), FAKE_CLAUDE_RELEASE: join(gates, "release") }, config: { cli: FAKE_CLAUDE, fullAuto: false } },
        ask: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "ask-dump.json"), FAKE_CLAUDE_RELEASE: join(gates, "ask-release") }, config: { cli: FAKE_CLAUDE, fullAuto: false } },
        // a Claude Code recent enough for --restricted (a confined turn)
        mail: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_RELEASE: join(gates, "mail-release"), FAKE_CLAUDE_DUMP: join(home, "mail-dump.json"), FAKE_CLAUDE_VERSION: "2.1.290" }, config: { cli: FAKE_CLAUDE, fullAuto: false } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    bots.orion = await createBot(bob, "Orion", "slow");
    bots.atlas = await createBot(alice, "Atlas", "claude");
    bots.vega = await createBot(alice, "Vega", "hold");
    bots.lyra = await createBot(alice, "Lyra", "ask");
    bots.mira = await createBot(alice, "Mira", "mail");
    const routine = await api("POST", "/api/routines", alice, { name: "Daily digest", botId: bots.atlas.id, prompt: "Write the digest.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    routineId = routine.body.routine.id;
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("M1: a member lists the bots they can use and sends with a wait: the reply comes back", async () => {
    const caps = await member("GET", "capabilities", BOB);
    expect(caps.status, caps.text).toBe(200);
    expect(caps.headers.get("x-sagax-member-api")).toBe("1");
    expect(caps.body.routes).toEqual(expect.arrayContaining(["GET bots", "POST bots/{id}/messages"]));

    const listed = await member("GET", "bots", BOB);
    expect(listed.status, listed.text).toBe(200);
    const orion = (listed.body.bots as Array<any>).find((bot) => bot.id === bots.orion!.id);
    expect(orion).toMatchObject({ name: "Orion", source: "mine", status: "idle", canMessage: true, owner: { principalId: ids.bob, sub: BOB.sub, name: "Bob" } });
    // Alice's private bot is not Bob's to see
    expect((listed.body.bots as Array<any>).some((bot) => bot.id === bots.atlas!.id)).toBe(false);

    const events = await openStream(bob);
    const sent = await member("POST", `bots/${bots.orion!.id}/messages`, BOB, { text: "count the open tickets", wait: 30 });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body).toMatchObject({ botId: bots.orion!.id, status: "done", pending: false, reply: expect.stringContaining("count the open tickets") });
    expect(sent.body.threadId).toMatch(/\w/);
    // the message is Bob's, in Bob's own conversation
    const thread = await api("GET", `/api/threads/${sent.body.threadId}/messages?limit=50`, bob);
    const mine = (thread.body.messages as Array<any>).find((m) => m.id === sent.body.messageId);
    expect(mine).toMatchObject({ role: "user", text: "count the open tickets" });
    // #291: an AI client works in a hidden conversation. Bob's chat with
    // Orion did not move to it, his bot list does not list it, it left no
    // unread dot, and the client's next send continues it.
    const after = await api("GET", "/api/bots?messages=0", bob);
    const orion2 = (after.body.bots as Array<any>).find((bot) => bot.id === bots.orion!.id);
    expect(orion2.threadId).not.toBe(sent.body.threadId);
    expect((orion2.tasks as Array<any>).some((task) => task.threadId === sent.body.threadId)).toBe(false);
    expect(orion2.unread).toBe(false);
    const again = await member("POST", `bots/${bots.orion!.id}/messages`, BOB, { text: "and the closed ones", wait: 30 });
    expect(again.status, again.text).toBe(200);
    expect(again.body.threadId).toBe(sent.body.threadId);
    // and it never buzzed Bob, while his own chat with Orion still does
    const own = await api("POST", `/api/bots/${bots.orion!.id}/messages`, bob, { text: "my own question", threadId: orion2.threadId });
    expect(own.status, own.text).toBeLessThan(300);
    await waitFor(async () => notifiedThreads(events.text()).includes(orion2.threadId), 30_000);
    expect(notifiedThreads(events.text())).not.toContain(sent.body.threadId);
    events.close();
  }, 60_000);

  it("M2: a long job answers pending with the thread id, and the thread read gives the reply later", async () => {
    const sent = await member("POST", `bots/${bots.orion!.id}/messages`, BOB, { text: "[gate:long] rebuild the report", wait: 2, newThread: true });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body).toMatchObject({ pending: true, status: "working", reply: null });
    const threadId = sent.body.threadId as string;
    const cursor = sent.body.cursor as string;
    const working = await member("GET", `threads/${threadId}?since=${cursor}`, BOB);
    expect(working.body).toMatchObject({ threadId, status: "working", messages: [] });
    writeFileSync(join(gates, "long"), "");
    const done = await waitFor(async () => {
      const got = await member("GET", `threads/${threadId}?since=${cursor}`, BOB);
      return got.body.status === "idle" && got.body.messages?.some((m: any) => m.role === "bot") ? got : null;
    }, 30_000);
    expect(done.body.messages.at(-1)).toMatchObject({ role: "bot", kind: "text", text: expect.stringContaining("rebuild the report") });
    expect(done.body.cursor).not.toBe(cursor);
  }, 60_000);

  it("M3: a missing permission is refused by name; a bot out of reach stays out; an unknown actor is refused", async () => {
    const zoe = await member("GET", "bots", ZOE);
    expect(zoe.status, zoe.text).toBe(403);
    expect(zoe.body).toMatchObject({ code: "forbidden_permission", permission: "clients.botsRead" });
    const run = await member("POST", `routines/${routineId}/run`, BOB, {});
    expect(run.status).toBe(403);
    expect(run.body).toMatchObject({ code: "forbidden_permission", permission: "clients.routinesRun" });
    const nudge = await member("POST", `people/${ALICE.sub}/nudge`, BOB, {});
    expect(nudge.body.permission).toBe("clients.peopleNudge");
    // Bob may message, but not a bot that is not his to see
    const hidden = await member("POST", `bots/${bots.atlas!.id}/messages`, BOB, { text: "hello" });
    expect(hidden.status, hidden.text).toBe(404);
    const thread = await member("GET", `threads/${bots.atlas!.threadId}`, BOB);
    expect(thread.status, thread.text).toBeGreaterThanOrEqual(403);
    expect((await member("GET", "bots", BOB, undefined, "someone")).body.code).toBe("assertion_invalid");
  }, 60_000);

  it("M4: an admin runs a routine, reads its run and nudges a person by Perspicax user id", async () => {
    const run = await member("POST", `routines/${routineId}/run`, ALICE, {});
    expect(run.status, run.text).toBe(201);
    expect(run.body.run).toMatchObject({ routineId, id: expect.any(String) });
    const read = await waitFor(async () => {
      const got = await member("GET", `routines/runs/${run.body.run.id}`, ALICE);
      return got.status === 200 && got.body.run.status === "completed" ? got : null;
    }, 30_000);
    expect(read.body.run).toMatchObject({ routineId, botId: bots.atlas!.id, status: "completed" });
    const nudge = await member("POST", `people/${BOB.sub}/nudge`, ALICE, {});
    expect(nudge.status, nudge.text).toBe(200);
    expect(nudge.body).toMatchObject({ ok: true, id: expect.any(String) });
  }, 60_000);

  it("M5: the admin API refuses an AI client's assertion; the audit names the client and never the text", async () => {
    const refused = await api("GET", "/api/org/admin/capabilities", {
      bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin", claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }) }),
    });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe("assertion_invalid");
    const audit = await api("GET", "/api/org/admin/audit?category=client", { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
    expect(audit.status, audit.text).toBe(200);
    const rows = audit.body.rows as Array<any>;
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(["client.message", "client.routine_run", "client.nudge"]));
    expect(rows.find((row) => row.action === "client.message").actor).toMatchObject({ kind: "person", name: "Bob", via: "perspicax-mcp" });
    expect(JSON.stringify(rows)).not.toContain("open tickets");
  }, 60_000);

  it("M6: a streamed send stops at a card; the AI client answers it as the person; the watch ends with the summary", async () => {
    const events = (text: string) => text.trim().split("\n").map((line) => JSON.parse(line) as any);
    const assertion = () => idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin", teams: [], claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }) });
    const streamed = fetch(`${BASE}/api/org/member/bots/${bots.vega!.id}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${assertion()}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "clean the build", wait: 60, stream: true }),
    });
    // The held turn asks to run a command, through the harness's broker.
    const holdDump = join(home, "hold-dump.json");
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const cardId = "c6-bash-1";
    socket.write(JSON.stringify({ t: "ask", id: cardId, kind: "permission", tool: "Bash", input: { command: "rm -rf build" } }) + "\n");

    const res = await streamed;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const first = events(await res.text());
    expect(first[0]).toMatchObject({ event: "started", botId: bots.vega!.id });
    expect(first.some((e) => e.event === "progress")).toBe(true);
    const approval = first.find((e) => e.event === "approval");
    expect(approval?.approval, JSON.stringify(first)).toMatchObject({ id: cardId, tool: "Bash" });
    const final = first.at(-1);
    expect(final).toMatchObject({ event: "final", status: "waiting", pending: true });
    const threadId = final.threadId as string;
    const messageId = final.messageId as string;

    // Who may answer it: Alice owns Vega; Bob does not even reach the thread.
    const check = await member("GET", `approvals/${cardId}?threadId=${threadId}`, ALICE);
    expect(check.body, check.text).toMatchObject({ canAnswer: true, whoCanApprove: { kind: "owner", principalId: ids.alice, name: "Alice" } });
    expect((await member("GET", `approvals/${cardId}?threadId=${threadId}`, BOB)).status).toBeGreaterThanOrEqual(403);
    const bobAnswer = await member("POST", `approvals/${cardId}`, BOB, { threadId, decision: "allow" });
    expect(bobAnswer.body).toMatchObject({ code: "forbidden_permission", permission: "clients.approvalsAnswer" });
    const answered = await member("POST", `approvals/${cardId}`, ALICE, { threadId, decision: "allow" });
    expect(answered.status, answered.text).toBe(200);
    const card = await waitFor(async () => {
      const got = await api("GET", `/api/threads/${threadId}/messages?limit=100`, alice);
      return (got.body.messages as Array<any> | undefined)?.find((m) => m.card?.requestId === cardId && m.card.answeredBy);
    });
    expect(card.card).toMatchObject({ answered: "allow", answeredBy: { kind: "session", name: "Alice", via: "ai-client" } });

    writeFileSync(join(gates, "release"), "");
    const watched = await fetch(`${BASE}/api/org/member/threads/${threadId}/stream?anchor=${messageId}&wait=30`, { headers: { authorization: `Bearer ${assertion()}` } });
    expect(watched.status).toBe(200);
    const second = events(await watched.text());
    const done = second.at(-1);
    expect(done, JSON.stringify(second)).toMatchObject({ event: "final", status: "done", pending: false, reply: "released" });
    expect(done.summary).toMatchObject({
      text: "released",
      approvals: [{ id: cardId, tool: "Bash", decision: "allow", by: "Alice", via: "ai-client" }],
      threadUrl: `${BASE}/#thread=${threadId}&bot=${bots.vega!.id}`,
    });
    const audit = await api("GET", "/api/org/admin/audit?category=client", { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
    expect((audit.body.rows as Array<any>).find((row) => row.action === "client.approval")).toMatchObject({ actor: { kind: "person", name: "Alice", via: "perspicax-mcp" } });
  }, 90_000);

  it("M7: agents/{tool}: list, send blocking and async, await_turn, read pages; scopes refuse", async () => {
    const listed = await member("POST", "agents/list_agents", BOB, {});
    expect(listed.status, listed.text).toBe(200);
    const listedIds = (listed.body.agents as Array<any>).map((agent) => agent.id);
    expect(listedIds).toContain(bots.orion!.id);
    expect(listedIds).not.toContain(bots.atlas!.id);
    const found = await member("POST", "agents/find_agents", BOB, { query: "orion", limit: 64 });
    expect((found.body.agents as Array<any>).map((agent) => agent.id)).toEqual([bots.orion!.id]);
    expect((await member("POST", "agents/find_agents", BOB, { query: "orion", limit: 65 })).status).toBe(400);

    const blocking = await member("POST", "agents/send_prompt", BOB, {
      agent_id: bots.orion!.id, prompt: "sum the invoices", mode: "blocking", timeout_ms: 30_000,
      files: [{ path: "notes/invoices.txt", content_base64: Buffer.from("42\n").toString("base64") }],
    });
    expect(blocking.status, blocking.text).toBe(200);
    expect(blocking.body).toMatchObject({ finished: true, reply: expect.stringContaining("sum the invoices") });
    expect(String(blocking.body.handle)).toMatch(/^turn_/);
    const threadId = blocking.body.thread_id as string;

    const sent = await member("POST", "agents/send_prompt", BOB, { agent_id: bots.orion!.id, prompt: "[gate:a2a] and the credits", mode: "async" });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body).toMatchObject({ accepted: true, thread_id: threadId });
    const early = await member("POST", "agents/await_turn", BOB, { agent_id: bots.orion!.id, handle: sent.body.handle, timeout_ms: 1_000 });
    expect(early.body).toMatchObject({ finished: false });
    expect(String(early.body.next)).toContain("never send the prompt again");
    writeFileSync(join(gates, "a2a"), "");
    const awaited = await member("POST", "agents/await_turn", BOB, { agent_id: bots.orion!.id, handle: sent.body.handle, timeout_ms: 30_000 });
    expect(awaited.status, awaited.text).toBe(200);
    expect(awaited.body.finished).toBe(true);
    // a forged handle is refused
    expect((await member("POST", "agents/await_turn", BOB, { agent_id: bots.orion!.id, handle: `${sent.body.handle}x` })).status).toBe(400);

    const latest = await member("POST", "agents/read_latest_page", BOB, { agent_id: bots.orion!.id, limit: 12 });
    expect(latest.status, latest.text).toBe(200);
    const texts = (latest.body.entries as Array<any>).map((entry) => entry.text as string);
    expect(texts.some((text) => text.startsWith("sum the invoices") && text.includes("inbox/bob/invoices.txt")), JSON.stringify(latest.body)).toBe(true);
    expect(readFileSync(join(home, ".sagax", "workspaces", bots.orion!.id, "inbox", "bob", "invoices.txt"), "utf8")).toBe("42\n");
    const cold = await member("POST", "agents/read_transcript_cold", BOB, { agent_id: bots.orion!.id });
    expect(cold.status, cold.text).toBe(200);
    // the AI client's conversation stays hidden (#302)
    const after = await api("GET", "/api/bots?messages=0", bob);
    const orion = (after.body.bots as Array<any>).find((bot) => bot.id === bots.orion!.id);
    expect(orion.threadId).not.toBe(threadId);

    // scopes: create needs clients.agentsCreate (off for members); Zoe holds no client key
    expect((await member("POST", "agents/create_agent", BOB, { name: "Nova" })).body).toMatchObject({ code: "forbidden_scope", scope: "agents.create" });
    expect((await member("POST", "agents/list_agents", ZOE, {})).body).toMatchObject({ code: "forbidden_scope" });
    expect((await member("POST", "agents/delete_agent", BOB, {})).body).toMatchObject({ code: "forbidden_scope", scope: "agents.create" });

    const audit = await api("GET", "/api/org/admin/audit?category=client", { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
    const rows = (audit.body.rows as Array<any>).filter((row) => String(row.action).startsWith("agents."));
    expect(rows.find((row) => row.action === "agents.send_prompt")).toMatchObject({ actor: { kind: "person", name: "Bob" } });
    expect(JSON.stringify(rows)).not.toContain("sum the invoices");
  }, 90_000);

  it("M9: an ask_user question with three options: in line, listed, option_required, answered by option, idempotent", async () => {
    const events = (text: string) => text.trim().split("\n").map((line) => JSON.parse(line) as any);
    const assertion = () => idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin", teams: [], claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }) });
    const streamed = fetch(`${BASE}/api/org/member/bots/${bots.lyra!.id}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${assertion()}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "livre le rapport", wait: 60, stream: true }),
    });
    const dump = join(home, "ask-dump.json");
    await waitFor(async () => existsSync(dump), 20_000);
    const socketPath = (JSON.parse(readFileSync(dump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const socket = connect(socketPath);
    sockets.push(socket);
    let received = "";
    socket.on("data", (chunk) => { received += chunk.toString(); });
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const cardId = "c9-ask-1";
    const choices = ["Livrer ici", "Livrer ici et par le relais", "Non"];
    socket.write(JSON.stringify({ t: "ask", id: cardId, kind: "question", tool: "ask_user", input: { question: "Où livrer le rapport ?", choices } }) + "\n");

    const res = await streamed;
    const first = events(await res.text());
    const final = first.at(-1);
    expect(final, JSON.stringify(first)).toMatchObject({ event: "final", status: "waiting", pending: true });
    expect(final.approval).toMatchObject({ id: cardId, kind: "question", answerWith: "option", choices: choices.map((label, i) => ({ id: String(i + 1), label })) });
    const threadId = final.threadId as string;

    // Listed to Alice (her bot's card); Bob reaches none of it.
    const listed = await member("GET", "approvals?status=pending", ALICE);
    expect(listed.status, listed.text).toBe(200);
    expect((listed.body.approvals as Array<any>).find((a) => a.id === cardId)).toMatchObject({ threadId, botId: bots.lyra!.id, botName: "Lyra", canAnswer: true });
    const bobList = await member("GET", "approvals?status=pending", BOB);
    expect(bobList.status, bobList.text).toBe(200);
    expect(JSON.stringify(bobList.body)).not.toContain(cardId);

    // A bare allow cannot pick for her.
    const bare = await member("POST", `approvals/${cardId}`, ALICE, { threadId, decision: "allow" });
    expect(bare.status, bare.text).toBe(409);
    expect(bare.body).toMatchObject({ code: "option_required", options: choices.map((label, i) => ({ id: String(i + 1), label })) });
    expect(received).toBe("");

    const answered = await member("POST", `approvals/${cardId}`, ALICE, { threadId, option: "Livrer ici et par le relais" });
    expect(answered.status, answered.text).toBe(200);
    expect(answered.body).toMatchObject({ answered: true, closed: true, decision: "allow", option: "Livrer ici et par le relais" });
    await waitFor(async () => received.includes("\n"));
    expect(JSON.parse(received.split("\n")[0]!)).toMatchObject({ t: "answer", id: cardId, behavior: "answer", message: "Livrer ici et par le relais" });
    const page = await api("GET", `/api/threads/${threadId}/messages?limit=100`, alice);
    expect((page.body.messages as Array<any>).find((m) => m.card?.requestId === cardId)?.card.answered).toBeDefined();
    expect((await member("GET", `threads/${threadId}`, ALICE)).body.approvals).toEqual([]);

    const again = await member("POST", `approvals/${cardId}`, ALICE, { threadId, option: "Non" });
    expect(again.status, again.text).toBe(200);
    expect(again.body).toMatchObject({ closed: true, alreadyAnswered: true });
    expect(received.trim().split("\n")).toHaveLength(1);
    writeFileSync(join(gates, "ask-release"), "");
  }, 90_000);

  it("M8: temporary agents: hidden from the app, profile, owner-only pin and delete, archive kept on disk", async () => {
    const events = await openStream(alice);
    const made = await member("POST", "agents/create_agent", ALICE, { name: "Scratch 321", description: "One branch only", idle_hours: 2 });
    expect(made.status, made.text).toBe(200);
    expect(made.body.agent).toMatchObject({ name: "Scratch 321", temporary: true });
    const id = made.body.agent.id as string;

    // the app never lists it, not even to its owner, and no live frame names it
    expect(((await api("GET", "/api/bots?messages=0", alice)).body.bots as Array<any>).some((bot) => bot.id === id)).toBe(false);
    // the AI client and the other agents reach it
    expect(((await member("POST", "agents/list_agents", ALICE, {})).body.agents as Array<any>).find((agent) => agent.id === id)).toMatchObject({ temporary: true });

    const got = await member("POST", "agents/get_agent", ALICE, { agent_id: id });
    expect(got.status, got.text).toBe(200);
    expect(got.body).toMatchObject({
      agent: { id, name: "Scratch 321", temporary: true },
      owner: { principal_id: ids.alice },
      temporary: { idle_hours: 2, pinned: false },
    });
    expect(got.body.profile).toMatchObject({ voice_settings: expect.any(Object), headings: expect.any(Array) });
    expect(String(got.body.profile_url)).toBe(`${idp.issuer.replace(/\/+$/, "")}/console/sagax/bots/${id}`);
    expect(got.body.temporary.expires_at).toBeGreaterThan(Date.now());

    // another person: out of their reach, and never theirs to pin
    expect((await member("POST", "agents/get_agent", BOB, { agent_id: id })).body.code).toBe("unknown_agent");
    const bobPin = await api("PUT", `/api/bots/${id}/temporary-pin`, bob, { pinned: true });
    expect(bobPin.status, bobPin.text).not.toBe(200);
    // the owner pins it: it no longer expires
    const pinned = await api("PUT", `/api/bots/${id}/temporary-pin`, alice, { pinned: true });
    expect(pinned.status, pinned.text).toBe(200);
    expect((await member("POST", "agents/get_agent", ALICE, { agent_id: id })).body.temporary).toMatchObject({ pinned: true, expires_at: null });

    // delete_agent archives it: gone from every list, its conversation kept
    const deleted = await member("POST", "agents/delete_agent", ALICE, { agent_id: id });
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body).toMatchObject({ agent_id: id, archived: true });
    expect(deleted.body.purge_at - deleted.body.archived_at).toBe(30 * 24 * 3_600_000);
    expect(((await member("POST", "agents/list_agents", ALICE, {})).body.agents as Array<any>).some((agent) => agent.id === id)).toBe(false);
    expect((await member("POST", "agents/get_agent", ALICE, { agent_id: id })).body.code).toBe("unknown_agent");
    expect((await member("POST", "agents/delete_agent", ALICE, { agent_id: id })).body.code).toBe("unknown_agent");
    const stored = (JSON.parse(readFileSync(join(home, ".sagax", "bots.json"), "utf8")) as Array<any>).find((bot) => bot.id === id);
    expect(stored.temporary).toMatchObject({ ownerPrincipalId: ids.alice, idleHours: 2, archived: { reason: "deleted", by: { kind: "person", principalId: ids.alice } } });
    expect((await api("POST", `/api/bots/${id}/messages`, alice, { text: "still there?" })).status).toBe(410);
    // a lasting bot is never deleted from here
    expect((await member("POST", "agents/delete_agent", ALICE, { agent_id: bots.atlas!.id })).body.code).toBe("not_temporary");

    await sleep(500);
    events.close();
    expect(events.text()).not.toContain(id);

    const audit = await api("GET", "/api/org/admin/audit?category=client", { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
    const rows = audit.body.rows as Array<any>;
    expect(rows.find((row) => row.action === "agents.create_agent" && row.after?.outcome === "ok")?.after).toMatchObject({ temporary: true, idleHours: 2 });
    expect(rows.find((row) => row.action === "agents.delete_agent" && row.after?.outcome === "ok")).toMatchObject({ target: { kind: "bot", id }, actor: { kind: "person", name: "Alice" } });
    expect(rows.some((row) => row.action === "agents.temporary.pinned")).toBe(true);
  }, 90_000);

  it("M10: bot email (contract v2): only the inbound mail route takes perspicax-mail; body signed; owner checked; a confined run, once", async () => {
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const mailAssertion = (user: FakeOidcUser, body: unknown, actor = "perspicax-mail") => ({
      bearer: idp.consoleAssertion({ sub: user.sub, aud: BASE, role: "employee", teams: [], claims: (c) => ({ ...c, act: { sub: actor }, body_sha256: sha(JSON.stringify(body)) }) }),
    });
    const mail = (botId: string, key = "1") => ({
      version: 1, botId, messageId: "<m10@mail.example.com>", dedupeKey: sha(`m10-${key}`), receivedAt: new Date().toISOString(),
      from: { address: "ana@example.com", name: "Ana" }, to: "mira@bots.example.org",
      subject: "Facture M10", text: "Corps secret M10", truncated: false,
      auth: { spf: "pass", dkim: "pass", verified: true }, attachments: [],
    });
    const deliver = (user: FakeOidcUser, body: unknown, actor?: string) => api("POST", "/api/org/inbound-mail", mailAssertion(user, body, actor), body);
    const mira = bots.mira!;
    // the member and admin APIs refuse the mail relay's actor
    expect((await member("GET", "bots", ALICE, undefined, "perspicax-mail")).body.code).toBe("assertion_invalid");
    expect((await api("GET", "/api/org/admin/capabilities", mailAssertion(ALICE, {}))).status).toBe(401);
    // the inbound route refuses every other actor, and a body the assertion does not sign
    const mcp = await deliver(ALICE, mail(mira.id), "perspicax-mcp");
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("x-sagax-mail-api")).toBe("1");
    const unsigned = await api("POST", "/api/org/inbound-mail", mailAssertion(ALICE, mail(mira.id, "other")), mail(mira.id));
    expect(unsigned.status).toBe(401);
    // Bob's bot is not Alice's
    expect((await deliver(ALICE, mail(bots.orion!.id))).body).toEqual({ error: "not_owner" });
    expect((await deliver(ALICE, mail("bot_nobody"))).body).toEqual({ error: "no_bot" });
    const none = await deliver(ALICE, mail(mira.id));
    expect(none.status, none.text).toBe(202);
    expect(none.body).toEqual({ triggers: 0, delivered: 0, duplicate: 0, ignored: 0, reason: "no_trigger" });
    // a botmail trigger: no secret, no setup
    const created = await api("POST", "/api/webhooks", alice, { name: "Mail", prompt: "Lis le courriel.", botId: mira.id, enabled: true, source: { type: "botmail", events: [], filters: { subject: ["facture"] } } });
    expect(created.status, created.text).toBe(201);
    expect(created.body.sourceSetup).toBeUndefined();
    expect(created.body.webhook.signingSecretSet).toBeUndefined();
    const delivered = await deliver(ALICE, mail(mira.id, "2"));
    expect(delivered.body).toEqual({ triggers: 1, delivered: 1, duplicate: 0, ignored: 0 });
    const again = await deliver(ALICE, mail(mira.id, "2"));
    expect(again.body).toEqual({ triggers: 1, delivered: 0, duplicate: 1, ignored: 0 });
    // S2: the mail-woken run is confined: no shell (--restricted), Ask, the mail fenced
    const dumpFile = join(home, "mail-dump.json");
    const confined = await waitFor(async () => (existsSync(dumpFile) ? JSON.parse(readFileSync(dumpFile, "utf8")) : null), 30_000);
    expect(confined.argv).toContain("--restricted");
    expect(JSON.stringify(confined.argv)).not.toContain("bypassPermissions");
    expect(confined.argv[confined.argv.indexOf("--permission-mode") + 1]).toBe("default");
    // second review: the confined run hands no work on, on any server: no
    // teammate (ask, delegate, coordinate), no room, no parallel task
    const comms = { bearer: confined.mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN as string };
    for (const [path, body] of [
      ["/api/internal/delegate-bot", { toBotId: bots.atlas!.id, message: "Lance le script." }],
      ["/api/internal/ask-bot", { toBotId: bots.atlas!.id, message: "Lance le script.", depth: 0 }],
      ["/api/internal/coordinate-bots", { tasks: [{ toBotId: bots.atlas!.id, message: "Lance le script." }] }],
      ["/api/internal/post-to-room", { message: "Lance le script." }],
      ["/api/internal/threads", { title: "Script", message: "Lance le script." }],
    ] as const) {
      const refused = await api("POST", path, comms, body);
      expect(refused.status, `${path} ${refused.text}`).toBe(403);
      expect(refused.body.code, path).toBe("botmail_confined");
    }
    writeFileSync(join(gates, "mail-release"), "");
    // the owner opts in: the next mail's run gets the bot's usual tools
    const opted = await api("PATCH", `/api/webhooks/${created.body.webhook.id}`, alice, { source: { type: "botmail", events: [], filters: { subject: ["facture"] }, allowFullTools: true } });
    expect(opted.status, opted.text).toBe(200);
    rmSync(dumpFile, { force: true });
    expect((await deliver(ALICE, mail(mira.id, "3"))).body).toMatchObject({ delivered: 1 });
    // the new run is a new conversation, so a new engine process
    const full = await waitFor(async () => {
      const dump = existsSync(dumpFile) ? JSON.parse(readFileSync(dumpFile, "utf8")) : null;
      return dump && dump.pid !== confined.pid ? dump : null;
    }, 30_000);
    expect(full.argv).not.toContain("--restricted");
    // the profile row: this fake Perspicax has no address route (an older one): nothing to show
    const address = await api("GET", `/api/bots/${mira.id}/inbound-mail`, alice);
    expect(address.status, address.text).toBe(200);
    expect(address.body).toEqual({ available: false, address: null, enabled: false, canChange: false });
    // one audit row per delivery: the full sender (JC decision 3), never the subject or text
    const rows = await waitFor(async () => {
      const audit = await api("GET", "/api/org/admin/audit?category=webhook", { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
      const found = ((audit.body.rows ?? []) as Array<any>).filter((row) => row.action === "bot-mail.delivered");
      return found.length >= 4 ? found : null;
    }, 10_000);
    expect(rows[0]).toMatchObject({ target: { kind: "bot", id: mira.id }, actor: { kind: "person", via: "perspicax-mail" }, after: { sender: "ana@example.com" } });
    expect(JSON.stringify(rows)).not.toMatch(/Facture M10|Corps secret/);
    expect(log).not.toMatch(/Corps secret M10/);
  }, 120_000);
});
