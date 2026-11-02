// Slice 7 through the real server: the Perspicax console's admin API
// (/api/org/admin/*), against the local fake provider that signs console
// assertions with its OIDC key, and the fake Claude CLI.
//
//   S7-A  the assertion gate: missing, forged, wrong audience or server,
//         replayed, an id_token-like or logout token, a session cookie or a
//         loopback request without an assertion; unknown and disabled people
//   S7-B  the role per route
//   S7-C  bots: an admin sees all; a manager sees their reach; metadata only
//   S7-D  usage attributed to principals; a manager sees their reach only
//   S7-E  approvals: owner cards to the owner, admin cards to admins; a console
//         decision resumes the waiting turn once
//   S7-F  the audit: rights, org, approval, people rows, paged
//   S7-G  a bot's files (read only): roots, list, read, download, the path
//         refusals, the reach, the audit rows
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const TEAM_T = "01J9S7TEAMT0000000000000TT";
const TEAM_U = "01J9S7TEAMU0000000000000UU";
const T = { id: TEAM_T, name: "T", manager: false };
const ALICE: FakeOidcUser = { sub: "01J9S7ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9S7BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const CAROL: FakeOidcUser = { sub: "01J9S7CAROL0000000000000C", name: "Carol", preferred_username: "carol", role: "employee", teams: [T] };
const DAVE: FakeOidcUser = { sub: "01J9S7DAVE00000000000000D", name: "Dave", preferred_username: "dave", role: "employee", teams: [{ id: TEAM_U, name: "U", manager: false }] };
const MONA: FakeOidcUser = { sub: "01J9S7MONA00000000000000M", name: "Mona", preferred_username: "mona", role: "manager", teams: [{ ...T, manager: true }] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; bearer?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string; headers: Headers }> => {
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

/** A console assertion as Perspicax signs it, for this person and role. */
const console$ = (user: FakeOidcUser, extra: Partial<Parameters<FakeOidcProvider["consoleAssertion"]>[0]> = {}): Auth => ({
  bearer: idp.consoleAssertion({ sub: user.sub, aud: BASE, role: user.role === "admin" || user.role === "manager" ? user.role : "employee", teams: user.teams ?? [], ...extra }),
});
const admin = (method: string, sub: string, user: FakeOidcUser, body?: unknown, extra: Partial<Parameters<FakeOidcProvider["consoleAssertion"]>[0]> = {}) =>
  api(method, `/api/org/admin/${sub}`, console$(user, extra), body);

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

posixOnly("Perspicax organization, slice 7: the console admin API", () => {
  let alice: Auth;
  let carol: Auth;
  const ids: Record<string, string> = {};
  const bots: Record<string, { id: string; threadId: string }> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, MONA].map((user) => idp.personOf(user));
    idp.directoryTeams = [
      { id: TEAM_T, name: "T", managers: [MONA.sub], members: [CAROL.sub] },
      { id: TEAM_U, name: "U", managers: [], members: [DAVE.sub] },
    ];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-admin-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: join(home, "claude-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        // held open with its permission broker reachable: how cards are raised
        hold: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 5 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    carol = await signIn(CAROL);
    const bob = await signIn(BOB);
    const dave = await signIn(DAVE);
    await signIn(MONA);
    // the organization's key serves by itself since 2026-10-01: the switch is gone
    expect((await api("PATCH", "/api/org/settings", alice, { memberBotsUseOrgKey: true })).status).toBe(400);
    // X: alice's, shared with team T at run; Y: bob's, shared with alice;
    // Z: carol's (member-owned, raises cards); W: dave's, not shared
    bots.x = await createBot(alice, "Xavier", "claude");
    expect((await api("PUT", `/api/bots/${bots.x.id}/grants`, alice, { target: `team:${TEAM_T}`, level: "run" })).status).toBe(200);
    bots.y = await createBot(bob, "Yara", "claude");
    expect((await api("PUT", `/api/bots/${bots.y.id}/grants`, bob, { target: `user:${ids.alice}`, level: "use" })).status).toBe(200);
    bots.z = await createBot(carol, "Zed", "hold");
    bots.w = await createBot(dave, "Wanda", "claude");
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S7-A: only a fresh, valid assertion for this server opens the admin API", async () => {
    const marked = (got: { headers: Headers }) => {
      expect(got.headers.get("x-sagax-admin-api")).toBe("1");
      expect(got.headers.get("cache-control")).toBe("no-store");
    };
    // no assertion: a loopback request and a session cookie are not credentials here
    const bare = await api("GET", "/api/org/admin/bots");
    expect(bare.status).toBe(401);
    expect(bare.body).toMatchObject({ code: "assertion_missing", message: expect.any(String), error: expect.any(String) });
    marked(bare);
    const cookie = await api("GET", "/api/org/admin/bots", alice);
    expect(cookie.body.code).toBe("assertion_missing");
    marked(cookie);
    // forged, aimed elsewhere, another server, another type
    for (const extra of [
      { strayKey: true },
      { aud: "http://127.0.0.1:1" },
      { serverId: "01j9s3fake0000000000other" },
      { header: (h: Record<string, unknown>) => ({ ...h, typ: "JWT" }) },
      { claims: (c: Record<string, unknown>) => ({ ...c, exp: (c.iat as number) + 600 }) },
      { claims: (c: Record<string, unknown>) => ({ ...c, iat: (c.iat as number) - 300, exp: (c.iat as number) - 240 }) },
      { claims: (c: Record<string, unknown>) => ({ ...c, nonce: "n" }) },
    ]) {
      const got = await api("GET", "/api/org/admin/bots", console$(ALICE, extra));
      expect(got.status, JSON.stringify(got.body)).toBe(401);
      expect(got.body.code).toBe("assertion_invalid");
      marked(got);
    }
    const logout = await api("GET", "/api/org/admin/bots", { bearer: idp.logoutToken({ sub: ALICE.sub, claims: (c) => ({ ...c, aud: BASE }) }) });
    expect(logout.body.code).toBe("assertion_invalid");
    // replay
    const once = console$(ALICE);
    expect((await api("GET", "/api/org/admin/bots", once)).status).toBe(200);
    const again = await api("GET", "/api/org/admin/bots", once);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe("assertion_replayed");
    // a person this server never saw
    expect((await admin("GET", "approvals", { sub: "01J9S7NOBODY000000000000N", role: "employee" })).body.code).toBe("unknown_person");
    // the admin API is listed in the health capabilities
    expect((await api("GET", "/api/health", alice)).body.capabilities).toMatchObject({ orgAdminApi: 1, orgAdminFiles: 1 });
    // unknown path and wrong method
    expect((await admin("GET", "nope", ALICE)).status).toBe(404);
    expect((await admin("DELETE", "bots", ALICE)).status).toBe(405);
  });

  it("S7-B: the role decides each route", async () => {
    for (const path of ["bots", "usage", "audit"]) {
      const got = await admin("GET", path, BOB);
      expect(got.status, path).toBe(403);
      expect(got.body.code).toBe("forbidden_role");
    }
    expect((await admin("GET", "audit", MONA)).body.code).toBe("forbidden_role");
    expect((await admin("GET", "bots", MONA)).status).toBe(200);
    expect((await admin("GET", "approvals", BOB)).status).toBe(200);
  });

  it("S7-C: bots, metadata only, by reach", async () => {
    const all = await admin("GET", "bots", ALICE);
    expect(all.status, all.text).toBe(200);
    const byId = new Map((all.body.bots as Array<{ id: string }>).map((bot) => [bot.id, bot as any]));
    // every bot, the server's starter bot included
    for (const bot of [bots.x!, bots.y!, bots.z!, bots.w!]) expect([...byId.keys()]).toContain(bot.id);
    expect(byId.get(bots.x!.id)).toMatchObject({
      name: "Xavier", owner: { principalId: ids.alice, sub: ALICE.sub, name: "Alice" }, ownerRole: "admin",
      engine: { instanceId: "claude", driverKind: "claudeAgent", installed: true }, access: "org-key",
      grants: [{ target: `team:${TEAM_T}`, kind: "team", label: "T", level: "run" }], routines: 0,
    });
    expect(byId.get(bots.z!.id)).toMatchObject({ owner: { name: "Carol" }, ownerRole: "member" });
    for (const forbidden of ["instructions", "messages", "prompt", "memory", "systemPrompt", "env", "environment"]) {
      expect(all.text).not.toContain(`"${forbidden}"`);
    }
    // mona manages T: X (granted to T) and Z (carol is in T); never Y or W
    const mona = await admin("GET", "bots", MONA);
    expect((mona.body.bots as Array<{ id: string }>).map((bot) => bot.id).sort()).toEqual([bots.x!.id, bots.z!.id].sort());
  });

  it("S7-D: usage names principals; a manager reads their reach", async () => {
    const sent = await api("POST", `/api/bots/${bots.x!.id}/messages`, carol, { text: "hello from carol" });
    expect(sent.status, sent.text).toBe(202);
    const sentAlice = await api("POST", `/api/bots/${bots.w!.id}/messages`, await signIn(DAVE), { text: "dave's own" });
    expect(sentAlice.status, sentAlice.text).toBe(202);
    const rows = await waitFor(async () => {
      const got = await admin("GET", "usage", ALICE);
      const list = got.body.rows as Array<any> | undefined;
      return list && list.some((row) => row.botId === bots.x!.id) && list.some((row) => row.botId === bots.w!.id) ? list : null;
    }, 40_000);
    const carolRow = rows.find((row) => row.botId === bots.x!.id);
    expect(carolRow).toMatchObject({
      day: new Date().toISOString().slice(0, 10), botName: "Xavier", owner: { principalId: ids.alice },
      speaker: { kind: "person", principalId: ids.carol, sub: CAROL.sub, name: "Carol" }, turns: 1,
      // the console's keys, plus the speaker's own key (2026-10-01)
      access: { subscription: 0, "owner-key": 0, "speaker-key": 0, "org-key": 1, server: 0, unknown: 0 },
    });
    const mona = await admin("GET", "usage", MONA);
    expect((mona.body.rows as Array<any>).map((row) => row.speaker.name)).toEqual(["Carol"]);
    expect((await admin("GET", "usage?from=2026-01-01&to=2026-12-31", ALICE)).body.code).toBe("bad_request");
  }, 60_000);

  it("S7-E: approvals go to whoever Sagax lets decide; a console decision resumes the turn once", async () => {
    // 2026-10-27 (#1098): a member's new bot starts on Approve for me, which
    // answers a write in its own workspace by itself; the cards read below
    // are the ones Ask shows
    expect((await api("PATCH", `/api/bots/${bots.z!.id}/tasks/${bots.z!.threadId}`, carol, { approvalMode: "ask" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${bots.z!.id}/messages`, carol, { text: "hold for cards" })).status).toBe(202);
    const holdDump = join(home, "hold-dump.json");
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `s7-${tool}-${sockets.length}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      await waitFor(async () => {
        const got = await api("GET", `/api/threads/${bots.z!.threadId}/messages?limit=100`, carol);
        return (got.body.messages as Array<{ card?: any }> | undefined)?.some((m) => m.card?.requestId === id);
      });
      return { id, answer: () => answer };
    };
    try {
      const data = realpathSync(join(home, ".sagax"));
      // a server command of a member's bot: an admin card
      const command = await ask("Bash", { command: "cat /proc/1/environ" });
      // a file in its own workspace: the owner's card
      const own = await ask("Write", { file_path: join(data, "task-workspaces", bots.z!.id, bots.z!.threadId, "notes.md"), content: "hi" });

      const forAlice = (await admin("GET", "approvals", ALICE)).body.approvals as Array<any>;
      expect(forAlice.map((card) => card.requestId)).toEqual([command.id]);
      expect(forAlice[0]).toMatchObject({
        botId: bots.z!.id, botName: "Zed", threadId: bots.z!.threadId, kind: "admin", type: "tool", tool: "Bash",
        owner: { principalId: ids.carol, name: "Carol" }, decidable: true,
        link: `${BASE}/#thread=${bots.z!.threadId}&bot=${bots.z!.id}`,
      });
      expect(forAlice[0].requestedBy).toMatchObject({ principalId: ids.carol });
      const forCarol = (await admin("GET", "approvals", CAROL)).body.approvals as Array<any>;
      expect(forCarol.map((card) => card.requestId)).toEqual([own.id]);
      expect(forCarol[0]).toMatchObject({ kind: "owner", decidable: true });
      expect((await admin("GET", "approvals", BOB)).body.approvals).toEqual([]);

      // neither the owner on an admin card nor an admin on an owner card
      expect((await admin("POST", `approvals/${bots.z!.threadId}/${command.id}`, CAROL, { decision: "allow" })).body.code).toBe("forbidden");
      expect((await admin("POST", `approvals/${bots.z!.threadId}/${own.id}`, ALICE, { decision: "allow" })).body.code).toBe("forbidden");
      expect((await admin("POST", `approvals/${bots.z!.threadId}/${own.id}`, CAROL, { decision: "allow", always: true })).body.code).toBe("bad_request");
      expect((await admin("POST", `approvals/${bots.z!.threadId}/nope`, ALICE, { decision: "allow" })).body.code).toBe("not_found");

      const allowed = await admin("POST", `approvals/${bots.z!.threadId}/${command.id}`, ALICE, { decision: "allow" });
      expect(allowed.status, allowed.text).toBe(200);
      expect(allowed.body).toEqual({ answered: true, decision: "allow" });
      await waitFor(async () => command.answer()?.behavior === "allow");
      const again = await admin("POST", `approvals/${bots.z!.threadId}/${command.id}`, ALICE, { decision: "deny" });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("card_not_pending");
      const denied = await admin("POST", `approvals/${bots.z!.threadId}/${own.id}`, CAROL, { decision: "deny" });
      expect(denied.status, denied.text).toBe(200);
      await waitFor(async () => own.answer()?.behavior === "deny");
      // the card says who answered, from the console
      const card = ((await api("GET", `/api/threads/${bots.z!.threadId}/messages?limit=100`, carol)).body.messages as Array<{ card?: any }>)
        .find((m) => m.card?.requestId === command.id)?.card;
      expect(card).toMatchObject({ answered: "allow", answeredBy: { kind: "session", name: "Alice (console)" } });
      expect((await admin("GET", "approvals", ALICE)).body.approvals).toEqual([]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await api("POST", `/api/bots/${bots.z!.id}/interrupt`, carol, {});
    }
  }, 60_000);

  it("S7-F: the audit reads rights, org, approval and people rows, newest first, paged", async () => {
    expect((await api("DELETE", `/api/bots/${bots.x!.id}/grants/${encodeURIComponent(`team:${TEAM_T}`)}`, alice)).status).toBe(200);
    // dave leaves: the directory marks him out
    idp.setDirectoryStatus(DAVE.sub, "disabled");
    const rows = await waitFor(async () => {
      const got = await admin("GET", "audit", ALICE);
      const list = got.body.rows as Array<any> | undefined;
      return list?.some((row) => row.action === "person.disabled") ? list : null;
    }, 20_000);
    const actions = rows.map((row) => row.action);
    // (no org.settings row: the org key switch it came from is gone, 2026-10-01)
    for (const action of ["grant.set", "grant.remove", "org.link", "approval.answer", "person.disabled"]) expect(actions, action).toContain(action);
    expect(actions).not.toContain("config.update");
    expect(rows[0].at).toBeGreaterThanOrEqual(rows.at(-1).at);
    const answer = rows.find((row) => row.action === "approval.answer" && row.after?.requestId?.startsWith("s7-Bash"));
    expect(answer).toMatchObject({ category: "approval", actor: { kind: "person", principalId: ids.alice, name: "Alice", via: "console" }, target: { kind: "bot", id: bots.z!.id }, after: { decision: "allow", kind: "admin" } });
    const grant = rows.find((row) => row.action === "grant.set" && row.target?.id === bots.x!.id);
    expect(grant).toMatchObject({ category: "rights", actor: { kind: "person", principalId: ids.alice, via: "sagax" }, after: { target: `team:${TEAM_T}`, level: "run" } });
    expect(rows.find((row) => row.action === "person.disabled")).toMatchObject({ category: "people", target: { kind: "person", id: ids.dave } });
    expect(JSON.stringify(rows)).not.toContain("sk-ant-");
    // paging
    const first = await admin("GET", "audit?limit=2", ALICE);
    expect(first.body.rows).toHaveLength(2);
    expect(first.body.next).toBe(first.body.rows[1].id);
    const second = await admin("GET", `audit?limit=2&before=${first.body.next}`, ALICE);
    expect(second.body.rows[0].id).not.toBe(first.body.rows[1].id);
    expect(second.body.rows[0].at).toBeLessThanOrEqual(first.body.rows[1].at);
    // a disabled person is refused
    expect((await admin("GET", "approvals", DAVE)).body.code).toBe("person_disabled");
  }, 40_000);

  it("S7-G: a bot's files, read only, for an admin and a manager in reach", async () => {
    const workspace = join(home, ".sagax", "workspaces", bots.z!.id);
    mkdirSync(join(workspace, "out"), { recursive: true });
    writeFileSync(join(workspace, "out", "notes.txt"), "zed notes\n");
    const roots = await admin("GET", `files/${bots.z!.id}/roots`, ALICE);
    expect(roots.status, roots.text).toBe(200);
    expect(roots.body.bot).toEqual({ id: bots.z!.id, name: "Zed" });
    expect(roots.body.roots).toContainEqual({ id: "workspace", available: true });
    expect(roots.body.roots).toContainEqual({ id: "sandbox", available: false, reason: "person_environment" });
    expect(roots.body.roots).toContainEqual({ id: "desktop", available: false, reason: "own_computer" });
    expect(roots.text).not.toContain(home);
    const list = await admin("GET", `files/${bots.z!.id}/list?root=workspace&path=out`, ALICE);
    expect(list.body.entries).toEqual([expect.objectContaining({ name: "notes.txt", path: "out/notes.txt", type: "file", size: 10 })]);
    const read = await admin("GET", `files/${bots.z!.id}/read?root=workspace&path=out%2Fnotes.txt`, ALICE);
    expect(read.body).toMatchObject({ text: "zed notes\n", binary: false, eof: true });
    const download = await admin("GET", `files/${bots.z!.id}/download?root=workspace&path=out%2Fnotes.txt`, MONA);
    expect(download.status).toBe(200);
    expect(download.text).toBe("zed notes\n");
    expect(download.headers.get("content-disposition")).toContain("notes.txt");
    expect((await admin("GET", `files/${bots.z!.id}/read?root=workspace&path=..%2F${bots.w!.id}%2FMEMORY.md`, ALICE)).body.code).toBe("bad_path");
    // mona reaches Z (carol is in T), never W; bob is an employee
    expect((await admin("GET", `files/${bots.w!.id}/roots`, MONA)).status).toBe(404);
    expect((await admin("GET", `files/${bots.z!.id}/roots`, BOB)).body.code).toBe("forbidden_role");
    const rows = await waitFor(async () => {
      const list = (await admin("GET", "audit", ALICE)).body.rows as Array<any> | undefined;
      return list?.some((row) => row.action === "bot.files.download") ? list : null;
    });
    expect(rows.find((row) => row.action === "bot.files.download")).toMatchObject({
      category: "bot", actor: { kind: "person", principalId: ids.mona, via: "console" },
      target: { kind: "bot", id: bots.z!.id, name: "Zed" }, after: { root: "workspace", path: "out/notes.txt", bytes: 10 },
    });
    expect(rows.find((row) => row.action === "bot.files.read")).toMatchObject({ actor: { principalId: ids.alice } });
  }, 30_000);
});
