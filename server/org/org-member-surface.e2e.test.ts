// Lot S1 through the real server: a person's surface bot (server/temporary-
// agents.ts isSurfaceBot) and its hidden conversations, driven by a host
// product through the member API (server/org/org-member-routes.ts).
//
// Fixture: Alice (organization admin), Bob (member, member defaults). Orion
// is Bob's ordinary bot.
//
//   S1  Bob makes his surface bot (clients.botsMessage is the route's key),
//       once; a second call answers the same bot
//   S2  a hidden turn per host chat (newThread, then threadId), streamed;
//       two chats sent at once on two models each keep their own model
//   S3  isolation, one check per surface: the app's bot list, the event
//       stream and notifications, the member bot list, the agent API (list,
//       find, send), the catalogue, the admin console's bots and files, an
//       admin's app session on its routes, the member API as another person,
//       search, routines, Today
//   S4  deleting a hidden conversation: it reads as gone; another person's
//       is unknown
//   S5  usage and logs: the person reads every row of it; an administrator
//       one total per person, no conversation or bot id, no log row of it
//   S6  erasing the person erases the bot and its conversations; its usage
//       rows stay (no text), and nothing of it reappears for an administrator
//   S7  a retry of a new conversation's send after a restart lands in the
//       same conversation and runs nothing twice
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE: FakeOidcUser = { sub: "01J9S1ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9S1BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };

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
  try { parsed = JSON.parse(text); } catch { /* not JSON, or NDJSON */ }
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function waitFor<T>(read: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** One call as the host product signs it for this person (the console actor). */
const member = (method: string, sub: string, user: FakeOidcUser, body?: unknown, actor = "console") =>
  api(method, `/api/org/member/${sub}`, {
    bearer: idp.consoleAssertion({
      sub: user.sub, aud: BASE, role: user.role === "admin" ? "admin" : "employee", teams: user.teams ?? [],
      claims: (c) => ({ ...c, act: { sub: actor } }),
    }),
  }, body);
/** One admin console call. */
const admin = (method: string, sub: string) => api(method, `/api/org/admin/${sub}`, { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
/** The stored bots, as the server last saved them. */
const storedBots = (): Array<any> => JSON.parse(readFileSync(join(home, ".sagax", "bots.json"), "utf8")) as Array<any>;
const ndjson = (text: string): Array<Record<string, any>> => text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>);

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
      SAGAX_ORG_NAME: "Example",
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

posixOnly("lot S1: a person's surface bot and its hidden conversations", () => {
  let alice: Auth;
  let bob: Auth;
  const ids: Record<string, string> = {};
  let orion = "";
  let surface = "";
  const chats: string[] = [];

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [idp.personOf(ALICE), idp.personOf(BOB)];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-surface-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP_LOG: join(home, "turns.jsonl") }, config: { cli: FAKE_CLAUDE, requireApiKey: true, fullAuto: true } },
        second: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP_LOG: join(home, "turns.jsonl") }, config: { cli: FAKE_CLAUDE, requireApiKey: true, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 2 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    const created = await api("POST", "/api/bots", bob, { name: "Orion" });
    expect(created.status, created.text).toBe(201);
    orion = created.body.bot.id;
    expect((await api("PATCH", `/api/bots/${orion}`, bob, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S1: Bob makes his surface bot (clients.botsMessage is enough), once", async () => {
    const made = await member("POST", "surface-bot", BOB, { name: "Desk" });
    expect(made.status, made.text).toBe(201);
    expect(made.body).toMatchObject({ bot: { id: expect.any(String), name: "Desk" }, created: true });
    surface = made.body.bot.id;
    const again = await member("POST", "surface-bot", BOB, { name: "Other" });
    expect(again.status, again.text).toBe(200);
    expect(again.body).toMatchObject({ bot: { id: surface, name: "Desk" }, created: false });
    const stored = await waitFor(() => storedBots().find((bot) => bot.id === surface));
    expect(stored.temporary).toMatchObject({ surface: true, ownerPrincipalId: ids.bob, pinned: { principalId: ids.bob } });
    expect(stored.ownerUserId).toBe(ids.bob);
    // one conversation per host chat, side by side
    expect(await waitFor(() => storedBots().find((bot) => bot.id === surface)?.maxConcurrentThreads)).toBe(16);
  }, 60_000);

  it("S2: a hidden turn per host chat, streamed; two chats at once on two models keep their own", async () => {
    const events = await openStream(bob);
    const first = await member("POST", `bots/${surface}/messages`, BOB, { text: "first chat zebrafinch", newThread: true, stream: true, wait: 60, modelSelection: { instanceId: "claude", model: "fake-model" } });
    expect(first.status, first.text).toBe(200);
    const lines = ndjson(first.text);
    expect(lines[0]).toMatchObject({ event: "started", botId: surface });
    const final = lines.at(-1)!;
    expect(final, first.text).toMatchObject({ event: "final", status: "done", reply: expect.any(String) });
    chats.push(lines[0]!.threadId as string);
    const second = await member("POST", `bots/${surface}/messages`, BOB, { text: "second chat", newThread: true, wait: 60 });
    expect(second.status, second.text).toBe(200);
    chats.push(second.body.threadId as string);
    expect(chats[1]).not.toBe(chats[0]);

    const [a, b] = await Promise.all([
      member("POST", `bots/${surface}/messages`, BOB, { text: "on claude", threadId: chats[0], wait: 60, modelSelection: { instanceId: "claude", model: "fake-model" } }),
      member("POST", `bots/${surface}/messages`, BOB, { text: "on second", threadId: chats[1], wait: 60, modelSelection: { instanceId: "second", model: "fake-model" } }),
    ]);
    expect(a.status, a.text).toBe(200);
    expect(b.status, b.text).toBe(200);
    expect(a.body).toMatchObject({ threadId: chats[0], status: "done" });
    expect(b.body).toMatchObject({ threadId: chats[1], status: "done" });
    const tasks = await waitFor(() => {
      const bot = storedBots().find((row) => row.id === surface);
      const rows = (bot?.tasks ?? []) as Array<any>;
      const one = rows.find((task) => task.threadId === chats[0]);
      const two = rows.find((task) => task.threadId === chats[1]);
      return two?.modelSelection?.instanceId === "second" ? { one, two } : null;
    });
    expect(tasks.one?.modelSelection?.instanceId ?? "claude").toBe("claude");
    expect(tasks.two.modelSelection).toMatchObject({ instanceId: "second", model: "fake-model" });

    // one turn of an ordinary bot of the person, to compare with
    expect((await member("POST", `bots/${orion}/messages`, BOB, { text: "plain turn", wait: 60 })).status).toBe(200);
    // #4920 (liberty audit 2026-11-19 G2): its turns get every agents tool an
    // ordinary bot's turn gets, the ones that reach another bot included
    const turns = readFileSync(join(home, "turns.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { mcpConfig?: { mcpServers?: Record<string, { env?: Record<string, string> }> } });
    const agentsEnvs = turns.flatMap((turn) => Object.values(turn.mcpConfig?.mcpServers ?? {}).map((server) => server.env ?? {})).filter((env) => env.SAGAX_BOT_ID === surface);
    expect(agentsEnvs.length).toBeGreaterThan(0);
    const ordinary = turns.flatMap((turn) => Object.values(turn.mcpConfig?.mcpServers ?? {}).map((server) => server.env ?? {})).find((env) => env.SAGAX_BOT_ID === orion)!;
    expect(ordinary.SAGAX_PEER_HOP).toBe("0");
    for (const env of agentsEnvs) {
      for (const key of ["SAGAX_PEER_HOP", "SAGAX_SKILL_AUTHORING_ENABLED", "SAGAX_OWN_THREAD_CREATION", "SAGAX_ROOM_TURN"]) expect(env[key], key).toBe(ordinary[key]);
    }

    await sleep(500);
    events.close();
    // S3, the event stream and notifications: no frame names the bot or its chats
    const named = events.text().split("\n").filter((line) => [surface, ...chats].some((id) => line.includes(id)));
    expect(named).toEqual([]);
  }, 120_000);

  it("S3: the surface bot leaves every list and admin route, one check per surface", async () => {
    // the app's bot list, the owner's and an admin's
    for (const auth of [bob, alice]) {
      const listed = await api("GET", "/api/bots?messages=0", auth);
      expect(listed.status).toBe(200);
      expect((listed.body.bots as Array<any>).some((bot) => bot.id === surface)).toBe(false);
    }
    // the member bot list (Orion still there)
    const bots = (await member("GET", "bots", BOB)).body.bots as Array<any>;
    expect(bots.some((bot) => bot.id === orion)).toBe(true);
    expect(bots.some((bot) => bot.id === surface)).toBe(false);
    // the agent API: list, find, send, for its owner and an admin
    for (const user of [BOB, ALICE]) {
      const agents = (await member("POST", "agents/list_agents", user, {}, "perspicax-mcp")).body.agents as Array<any>;
      expect(agents.some((agent) => agent.id === surface)).toBe(false);
      const found = await member("POST", "agents/find_agents", user, { query: "Desk" }, "perspicax-mcp");
      expect(JSON.stringify(found.body)).not.toContain(surface);
    }
    expect((await member("POST", "agents/send_prompt", BOB, { agent_id: surface, prompt: "hi" }, "perspicax-mcp")).body.code).toBe("unknown_agent");
    // the catalogue
    const catalogue = await api("GET", "/api/bot-catalog", bob);
    expect(catalogue.status).toBe(200);
    expect(catalogue.text).not.toContain(surface);
    // the admin console: its bots, one bot, its files
    const adminBots = await admin("GET", "bots");
    expect(adminBots.status, adminBots.text).toBe(200);
    expect(adminBots.text).toContain(orion);
    expect(adminBots.text).not.toContain(surface);
    expect((await admin("GET", `bots/${surface}`)).status).toBe(404);
    expect((await admin("GET", `files/${surface}/roots`)).status).toBe(404);
    // an admin's own app session on the bot's and a conversation's routes
    expect((await api("GET", `/api/threads/${chats[0]}/messages?limit=50`, alice)).status).toBe(404);
    expect((await api("POST", `/api/bots/${surface}/messages`, alice, { text: "peek", threadId: chats[0] })).status).toBe(404);
    expect((await api("GET", `/api/bots/${surface}/workspace`, alice)).status).toBe(404);
    // the member API as another person, an admin included
    expect((await member("GET", `threads/${chats[0]}`, ALICE)).status).toBe(404);
    expect((await member("POST", `bots/${surface}/messages`, ALICE, { text: "peek", hidden: true })).status).toBe(404);
    // the owner still reads it through the member API
    const own = await member("GET", `threads/${chats[0]}`, BOB);
    expect(own.status, own.text).toBe(200);
    expect(JSON.stringify(own.body.messages)).toContain("zebrafinch");
    // search: the owner's and an admin's
    for (const auth of [bob, alice]) {
      const searched = await api("GET", "/api/search?q=zebrafinch", auth);
      expect(searched.status, searched.text).toBe(200);
      expect(searched.body.hits).toEqual([]);
    }
    // #4920: it holds a routine and joins a room like any bot of its person;
    // another person, an admin included, still sees none of its routines
    const routine = await api("POST", "/api/routines", bob, { name: "Nightly", botId: surface, prompt: "x", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBeLessThan(300);
    expect(((await api("GET", "/api/routines", alice)).body.routines as Array<any>).some((row) => row.botId === surface)).toBe(false);
    const room = await api("POST", "/api/groups", bob, { name: "Desk room", memberIds: [orion, surface] });
    expect(room.status, room.text).toBeLessThan(300);
    // Today: nothing of it
    const today = await api("GET", "/api/approvals", bob);
    expect(today.status).toBe(200);
    expect(today.text).not.toContain(surface);
  }, 60_000);

  it("S3b (#4625): the files of a person's own bots, their surface bot included, and nobody else's", async () => {
    for (const botId of [surface, orion]) {
      const ws = join(home, ".sagax", "workspaces", botId);
      mkdirSync(ws, { recursive: true });
      writeFileSync(join(ws, "library-note.txt"), `note of ${botId}`);
      writeFileSync(join(ws, ".env"), "PLANTED=1");
    }
    for (const botId of [surface, orion]) {
      const roots = await member("GET", `bots/${botId}/files/roots`, BOB);
      expect(roots.status, roots.text).toBe(200);
      const walked = await member("GET", `bots/${botId}/files/list?recursive=1&root=workspace`, BOB);
      expect(walked.status, walked.text).toBe(200);
      expect((walked.body.entries as Array<any>).map((entry) => entry.path)).toContain("library-note.txt");
      expect(walked.text).not.toContain(".env");
      const read = await member("GET", `bots/${botId}/files/read?root=workspace&path=library-note.txt`, BOB);
      expect(read.body.text).toBe(`note of ${botId}`);
      expect((await member("GET", `bots/${botId}/files/read?root=workspace&path=.env`, BOB)).status).toBe(404);
      // an organization admin, through the member API: nobody's but their own
      for (const action of ["roots", "list?recursive=1", "read?root=workspace&path=library-note.txt"]) {
        const peek = await member("GET", `bots/${botId}/files/${action}`, ALICE);
        expect(peek.status, `${botId} ${action}`).toBe(404);
        expect(peek.text).not.toContain("note of");
      }
    }
  });

  it("S4: deleting a hidden conversation; another person's is unknown", async () => {
    expect((await member("DELETE", `threads/${chats[1]}`, ALICE)).status).toBe(404);
    // a visible conversation is not this route's
    const orionChat = (await api("GET", "/api/bots?messages=0", bob)).body.bots.find((bot: any) => bot.id === orion).threadId as string;
    expect((await member("DELETE", `threads/${orionChat}`, BOB)).status).toBe(404);
    const deleted = await member("DELETE", `threads/${chats[1]}`, BOB);
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, threadId: chats[1] });
    expect((await member("GET", `threads/${chats[1]}`, BOB)).status).toBe(404);
    expect((await member("DELETE", `threads/${chats[1]}`, BOB)).status).toBe(404);
    // the other chat stays
    expect((await member("GET", `threads/${chats[0]}`, BOB)).status).toBe(200);
  }, 60_000);

  it("S5: usage and logs: the person reads it all, an administrator one total per person and no row of it", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const range = `from=${day}&to=${day}`;
    // the person: every row, in their own usage
    const own = await api("GET", `/api/me/usage/traces?${range}`, bob);
    expect(own.status, own.text).toBe(200);
    expect(own.text).toContain(chats[0]);
    // an administrator: no conversation, no bot id, no list of sends
    const ids = [surface, ...chats];
    for (const path of [`/api/usage/traces?${range}`, `/api/usage?${range}&groupBy=bot`, `/api/usage.csv?${range}`, `/api/usage/stats?${range}`]) {
      const read = await api("GET", path, alice);
      expect(read.status, `${path} ${read.text.slice(0, 300)}`).toBe(200);
      for (const id of ids) expect(read.text, path).not.toContain(id);
    }
    const console = await admin("GET", `usage?${range}`);
    expect(console.status, console.text).toBe(200);
    for (const id of ids) expect(console.text).not.toContain(id);
    // one total per person and model, dated the 1st of the month: no day of activity
    const byBot = await api("GET", `/api/usage?${range}&groupBy=bot`, alice);
    expect((byBot.body.groups as Array<any>).filter((group) => group.label === "Chat")).toHaveLength(1);
    const byDay = await api("GET", `/api/usage?from=${day.slice(0, 8)}01&to=${day}&groupBy=day`, alice);
    // the chat's spend sits on the 1st (Orion's own turn stays on its day)
    const chat = (byBot.body.groups as Array<any>).find((group) => group.label === "Chat");
    const first = (byDay.body.groups as Array<any>).find((group) => group.key === `day:${day.slice(0, 8)}01`);
    if (!day.endsWith("-01")) expect(first?.costUsd).toBeCloseTo(chat.costUsd, 6);
    // its tool calls: the person's stats count them, an administrator's never
    const ownStats = await api("GET", `/api/me/usage/stats?${range}`, bob);
    const adminStats = await api("GET", `/api/usage/stats?${range}`, alice);
    expect(ownStats.status, ownStats.text).toBe(200);
    expect(adminStats.status, adminStats.text).toBe(200);
    expect(JSON.stringify(adminStats.body)).not.toContain("Bash");
    // the administrator's logs: no creation, send, stop or delete of it
    for (const read of [await admin("GET", "audit?category=client&limit=500"), await api("GET", `/api/admin-activity?${range}&limit=5000`, alice)]) {
      expect(read.status, read.text.slice(0, 300)).toBe(200);
      for (const id of ids) expect(read.text).not.toContain(id);
      expect(read.text).not.toContain("client.surface_bot");
    }
  }, 60_000);

  it("S6: erasing the person erases the surface bot and its conversations; nothing of it reappears for an administrator", async () => {
    const bobId = ids.bob!;
    const LOGOUT = "http://schemas.openid.net/event/backchannel-logout";
    const PURGED = "https://schemas.openid.net/secevent/risc/event-type/account-purged";
    const token = idp.logoutToken({ sub: BOB.sub, claims: (c) => ({ ...c, events: { [LOGOUT]: {}, [PURGED]: { subject: { format: "iss_sub", iss: idp.issuer, sub: BOB.sub } } } }) });
    const purged = await fetch(`${BASE}/api/auth/oidc/backchannel-logout`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `logout_token=${encodeURIComponent(token)}` });
    expect(purged.status, await purged.clone().text()).toBe(200);
    expect(await purged.json()).toMatchObject({ purged: true });
    await waitFor(() => !storedBots().some((bot) => bot.id === surface));
    // its conversations
    const registry = readFileSync(join(home, ".sagax", "bots.json"), "utf8");
    for (const thread of chats) {
      expect(registry).not.toContain(thread);
      expect(existsSync(join(home, ".sagax", `messages-${thread}.json`))).toBe(false);
    }
    // its usage rows stay, as every bot's (no text; the month's spend does not drop), marked
    const day = new Date().toISOString().slice(0, 10);
    const ledger = readFileSync(join(home, ".sagax", "usage", `${day.slice(0, 7)}.jsonl`), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { botId: string; surface?: true });
    expect(ledger.filter((row) => row.botId === surface).length).toBeGreaterThan(0);
    expect(ledger.filter((row) => row.botId === surface).every((row) => row.surface === true)).toBe(true);
    // and with the bot gone, an administrator still reads nothing of it
    const named = [surface, ...chats];
    for (const read of [
      await api("GET", `/api/usage/traces?from=${day}&to=${day}`, alice),
      await api("GET", `/api/usage.csv?from=${day}&to=${day}`, alice),
      await admin("GET", "audit?category=client&limit=500"),
      await admin("GET", "audit?limit=500"),
      await api("GET", `/api/admin-activity?from=${day}&to=${day}&limit=5000`, alice),
    ]) {
      expect(read.status, read.text.slice(0, 300)).toBe(200);
      for (const id of named) expect(read.text).not.toContain(id);
      expect(read.text).not.toContain("Desk");
    }
    expect(bobId).toBeTruthy();
  }, 60_000);

  it("S7: a retry of a new conversation's send after a restart lands in it, and runs nothing twice", async () => {
    const made = await member("POST", "surface-bot", ALICE, { name: "Front" });
    expect(made.status, made.text).toBe(201);
    const bot = made.body.bot.id as string;
    const body = { text: "only once please", newThread: true, sendId: "s7-send-0000000001", wait: 60 };
    const first = await member("POST", `bots/${bot}/messages`, ALICE, body);
    expect(first.status, first.text).toBe(200);
    const threadId = first.body.threadId as string;
    // the server restarts (the receipt is durable, in the server's database)
    child.kill("SIGTERM");
    await waitForExit(child);
    await start();
    const again = await member("POST", `bots/${bot}/messages`, ALICE, body);
    expect(again.status, again.text).toBe(200);
    expect(again.body.threadId).toBe(threadId);
    const read = await member("GET", `threads/${threadId}?limit=200`, ALICE);
    expect(read.status, read.text).toBe(200);
    expect((read.body.messages as Array<{ role: string; text: string }>).filter((row) => row.role === "user" && row.text === "only once please")).toHaveLength(1);
  }, 90_000);
});
