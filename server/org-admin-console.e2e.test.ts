// The Perspicax console's Sagax admin routes (console design 2026-10-08,
// section 5) through the real server, with the local fake provider signing
// console assertions and the fake Claude CLI answering turns.
//
// Fixture: Alice (organization admin), Bob (member, team T), Mona (manager
// of T), Zoe (member, outside T). Two bots: Atlas (Alice's) and Beacon
// (Bob's, held open so it raises an approval card). A routine on Atlas. A
// pending admin approval on Beacon.
//
//   C1  capabilities and overview
//   C2  people: list, detail, disable, reset access, connections revoke
//   C3  bots: list, detail, clone, archive and restore, transfer, model,
//       bulk, package and import, stop and delete
//   C4  routines and approvals
//   C5  connections, usage, logs, incidents, audit, settings
//   C6  a bot's look and persona, its picture
//   C7  the routines calendar: past and planned runs, by scope
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { engineOffer, offeredEngines, ownAccountOnly } from "../shared/offered-engines.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const TEAM_T = "01J9C1TEAMT0000000000000TT";
const ALICE: FakeOidcUser = { sub: "01J9C1ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9C1BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const MONA: FakeOidcUser = { sub: "01J9C1MONA00000000000000M", name: "Mona", preferred_username: "mona", role: "manager", teams: [{ id: TEAM_T, name: "T", manager: true }] };
const ZOE: FakeOidcUser = { sub: "01J9C1ZOE00000000000000Z", name: "Zoe", preferred_username: "zoe", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

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

type AssertionExtra = Partial<Parameters<FakeOidcProvider["consoleAssertion"]>[0]>;
const console$ = (user: FakeOidcUser, extra: AssertionExtra = {}): Auth => ({
  bearer: idp.consoleAssertion({ sub: user.sub, aud: BASE, role: user.role === "admin" || user.role === "manager" ? user.role : "employee", teams: user.teams ?? [], ...extra }),
});
/** One console call: `GET overview`, `POST bots/x/clone`. */
const admin = (method: string, sub: string, user: FakeOidcUser, body?: unknown, extra: AssertionExtra = {}) =>
  api(method, `/api/org/admin/${sub}`, console$(user, extra), body);
const french = { claims: (c: Record<string, unknown>) => ({ ...c, locale: "fr" }) };

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
      SAGAX_IMAGE: "sagax:test",
      SAGAX_IMAGE_COMMIT: "c0ffee",
      // C1's broken engine answers 429. Limit failover would resend that
      // message on a working engine, so the console would never see a failure.
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

posixOnly("Perspicax console: the Sagax admin routes", () => {
  let alice: Auth;
  let bob: Auth;
  let zoe: Auth;
  const ids: Record<string, string> = {};
  const bots: Record<string, { id: string; threadId: string }> = {};
  let routineId = "";
  const sockets: Socket[] = [];
  let cardId = "";
  let seeded = new Set<string>();

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, MONA, ZOE].map((user) => idp.personOf(user));
    idp.directoryTeams = [{ id: TEAM_T, name: "T", managers: [MONA.sub], members: [BOB.sub] }];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-console-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "backup-status.json"), JSON.stringify({ enabled: true, schedule: "daily 03:00 UTC", lastAt: "2026-10-08T03:00:00Z", ok: true }));
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        // The organization's key (SAGAX_ANTHROPIC_API_KEY) serves only an
        // API-key instance (config.ts injectedEnvironment, #1812): every
        // fixture engine is one, so a member's turn runs on that key.
        claude: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP: join(home, "claude-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } },
        hold: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } },
        broken: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_MODE: "api-error", FAKE_CLAUDE_API_ERROR: "429 Too Many Requests: rate limit reached" }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } },
        // A subscription engine: only a person's own sign-in runs it, never the organization's key.
        own: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 4 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    // The first run seeds one bot with a random name from server/names.ts
    // (Atlas and Pixel are in that list): the name filters below leave it out.
    seeded = new Set(((await admin("GET", "bots", ALICE)).body.bots as Array<{ id: string }>).map((bot) => bot.id));
    expect(seeded.size).toBe(1);
    bob = await signIn(BOB);
    await signIn(MONA);
    zoe = await signIn(ZOE);
    bots.atlas = await createBot(alice, "Atlas", "claude");
    bots.beacon = await createBot(bob, "Beacon", "hold");
    const routine = await api("POST", "/api/routines", alice, { name: "Daily digest", botId: bots.atlas.id, prompt: "Write the digest.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    routineId = routine.body.routine.id;
    // one settled turn on Atlas (usage, latency)
    expect((await api("POST", `/api/bots/${bots.atlas.id}/messages`, alice, { text: "hello" })).status).toBe(202);
    // a pending admin card on Beacon (a member's server command)
    expect((await api("POST", `/api/bots/${bots.beacon.id}/messages`, bob, { text: "hold for cards" })).status).toBe(202);
    const holdDump = join(home, "hold-dump.json");
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    cardId = "c1-bash-1";
    socket.write(JSON.stringify({ t: "ask", id: cardId, kind: "permission", tool: "Bash", input: { command: "uptime" } }) + "\n");
    await waitFor(async () => {
      const got = await api("GET", `/api/threads/${bots.beacon.threadId}/messages?limit=100`, bob);
      return (got.body.messages as Array<{ card?: any }> | undefined)?.some((m) => m.card?.requestId === cardId);
    });
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("C1: capabilities name the release and every route; the overview counts what happened", async () => {
    const caps = await admin("GET", "capabilities", ZOE);
    expect(caps.status, caps.text).toBe(200);
    expect(caps.headers.get("x-sagax-admin-api")).toBe("1");
    const pkg = JSON.parse(readFileSync(join(SERVER_DIR, "..", "package.json"), "utf8")) as { forkVersion: string };
    expect(caps.body).toMatchObject({ version: pkg.forkVersion, api: 6, permissionsVersion: 1 });
    expect(caps.body.mascots.map((entry: { id: string }) => entry.id)).toEqual(["owl", "crab", "shape", "trombi", "bunbu", "shiba", "grump", "ogre", "frog"]);
    expect(caps.body.permissions.length).toBeGreaterThan(20);
    // api 4: every engine with its Cloud or Local group and how people get access
    expect(caps.body.engines.length).toBeGreaterThan(0);
    for (const engine of caps.body.engines) {
      expect(engine).toMatchObject({ id: expect.any(String), name: expect.any(String), installed: expect.any(Boolean) });
      expect(["cloud", "local"]).toContain(engine.kind);
      expect(["oauth", "apiKey", "none"]).toContain(engine.auth);
    }
    expect(caps.body.routes).toEqual(expect.arrayContaining(["GET capabilities", "GET overview", "GET bots", "GET usage", "GET audit"]));

    expect((await admin("GET", "overview", ZOE)).body.code).toBe("forbidden_role");
    const overview = await waitFor(async () => {
      const got = await admin("GET", "overview", ALICE);
      return got.body.turns?.last24h >= 1 && got.body.latency?.some((row: { p50Ms: number | null }) => row.p50Ms !== null) ? got : null;
    }, 30_000);
    expect(overview.body).toMatchObject({
      version: pkg.forkVersion,
      deploy: { image: "sagax:test", commit: "c0ffee", builtAt: null },
      sandboxes: { enabled: false, running: 0, limit: null },
      routines: { runs24h: 0, failed24h: 0 },
      backup: { lastAt: Date.UTC(2026, 9, 8, 3), ok: true },
    });
    expect(overview.body.host.memTotalBytes).toBeGreaterThan(0);
    expect(overview.body.host.load).toHaveLength(3);
    expect(overview.body.engines.map((engine: { id: string }) => engine.id)).toEqual(expect.arrayContaining(["claude", "hold", "broken"]));
    expect(overview.body.latency.find((row: { engine: string }) => row.engine === "claude")).toMatchObject({ turns: 1, p50Ms: expect.any(Number), p90Ms: expect.any(Number) });
    expect(overview.body.presence).toEqual({ online: expect.any(Number), idle: 0, away: expect.any(Number), offline: expect.any(Number) });
    // a manager counts their reach: Mona reaches Bob and herself, not Alice's turn
    const mona = await admin("GET", "overview", MONA);
    expect(mona.body.turns.last24h).toBe(0);
    expect(JSON.stringify(overview.body)).not.toContain("sk-ant-");
  }, 60_000);

  it("C1: a failed turn is an error by readable reason, in the console's language", async () => {
    const broken = await createBot(alice, "Brittle", "broken");
    expect((await api("POST", `/api/bots/${broken.id}/messages`, alice, { text: "fail please" })).status).toBe(202);
    const got = await waitFor(async () => {
      const reply = await admin("GET", "overview", ALICE, undefined, french);
      return reply.body.errors?.last24h >= 1 ? reply : null;
    }, 30_000);
    expect(got.body.errors.byReason).toContainEqual({ reason: "rate_limited", label: "Le fournisseur limite le débit", count: expect.any(Number) });
    bots.brittle = broken;
  }, 60_000);

  it("C1: bots carry status, label and threads, page and filter; usage rows name their engine; audit filters", async () => {
    const all = await admin("GET", "bots", ALICE);
    const atlas = (all.body.bots as Array<any>).find((bot) => bot.id === bots.atlas!.id);
    expect(atlas).toMatchObject({ status: "active", label: null, threads: 1, routines: 1 });
    expect(routineId).toMatch(/\w/);
    const paged = await admin("GET", `bots?owner=${ids.bob}&limit=1`, ALICE);
    expect(paged.body).toMatchObject({ items: [{ id: bots.beacon!.id, owner: { name: "Bob" } }], next: null });
    expect((await admin("GET", "bots?q=atl", ALICE)).body.items.map((bot: { id: string }) => bot.id).filter((id: string) => !seeded.has(id))).toEqual([bots.atlas!.id]);
    const usage = await admin("GET", "usage", ALICE);
    expect((usage.body.rows as Array<any>).find((row) => row.botId === bots.atlas!.id)).toMatchObject({ engine: "claude", turns: 1 });
    const audit = await admin("GET", `audit?category=rights&target=${bots.atlas!.id}`, ALICE);
    expect(audit.status, audit.text).toBe(200);
    expect((audit.body.rows as Array<any>).every((row) => row.category === "rights" && row.target?.id === bots.atlas!.id)).toBe(true);
  });

  it("C2: people, a person's page, disable and enable, reset access, revoke connections", async () => {
    const list = await admin("GET", "people", ALICE);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((row: { name: string }) => row.name)).toEqual(["Alice", "Bob", "Mona", "Zoe"]);
    expect(list.body.items.find((row: any) => row.name === "Bob")).toMatchObject({ principalId: ids.bob, sub: BOB.sub, role: "member", disabled: false, bots: 1 });
    expect(list.body.items.find((row: any) => row.name === "Alice")).toMatchObject({ role: "admin", turns30d: expect.any(Number) });
    expect((await admin("GET", "people?role=admin", ALICE)).body.items.map((row: { name: string }) => row.name)).toEqual(["Alice"]);
    // Mona manages T (Bob): herself and Bob, never Alice or Zoe
    expect((await admin("GET", "people", MONA)).body.items.map((row: { name: string }) => row.name)).toEqual(["Bob", "Mona"]);
    expect((await admin("GET", `people/${ids.alice}`, MONA)).status).toBe(404);
    expect((await admin("GET", "people", ZOE)).body.code).toBe("forbidden_role");

    const page = await admin("GET", `people/${ids.bob}`, ALICE);
    expect(page.status, page.text).toBe(200);
    expect(page.body).toMatchObject({ name: "Bob", bots: [{ id: bots.beacon!.id }], connections: { engines: expect.any(Array), mcpServers: [] }, routinesAsRunner: [] });
    expect((await admin("GET", `people/${ids.alice}`, ALICE)).body.routinesAsRunner).toEqual([{ id: routineId, name: "Daily digest", botId: bots.atlas!.id }]);
    // 2026-10-09: a person's effective permissions (no list from this fake
    // Perspicax: the member defaults); an admin holds every key
    expect(page.body.permissions).toMatchObject({ source: "defaults", effective: expect.arrayContaining(["bots.create", "sharing.grants"]), narrowedBy: [] });
    expect((await admin("GET", `people/${ids.alice}`, ALICE)).body.permissions).toMatchObject({ source: "admin", effective: expect.arrayContaining(["host.shell"]) });

    // Disable: Mona cannot; Alice cannot disable herself; Zoe's session ends
    expect((await admin("POST", `people/${ids.zoe}/disable`, MONA, { disabled: true })).body.code).toBe("forbidden_role");
    expect((await admin("POST", `people/${ids.alice}/disable`, ALICE, { disabled: true })).body.code).toBe("self");
    expect((await api("GET", "/api/bots", zoe)).status).toBe(200);
    const off = await admin("POST", `people/${ids.zoe}/disable`, ALICE, { disabled: true, reason: "Contract ended" });
    expect(off.status, off.text).toBe(200);
    expect(off.body.person).toMatchObject({ principalId: ids.zoe, disabled: true, disabledBy: "sagax" });
    expect((await api("GET", "/api/bots", zoe)).status).toBe(401);
    const again = await signIn(ZOE);
    expect((await api("GET", "/api/bots", again)).status).toBe(401);
    expect((await admin("GET", "capabilities", ZOE)).body.code).toBe("person_disabled");
    const on = await admin("POST", `people/${ids.zoe}/disable`, ALICE, { disabled: false });
    expect(on.body.person).toMatchObject({ disabled: false, disabledBy: null });
    zoe = await signIn(ZOE);
    expect((await api("GET", "/api/bots", zoe)).status).toBe(200);

    // Reset access: Zoe's sessions end
    const reset = await admin("POST", `people/${ids.zoe}/reset-access`, ALICE, { scope: "sessions" });
    expect(reset.status, reset.text).toBe(200);
    expect(reset.body.cleared).toMatchObject({ engineLogins: 0, sessions: expect.any(Number) });
    expect(reset.body.cleared.sessions).toBeGreaterThanOrEqual(1);
    expect((await api("GET", "/api/bots", zoe)).status).toBe(401);
    zoe = await signIn(ZOE);
    expect((await admin("POST", `people/${ids.zoe}/reset-access`, ALICE, { scope: "keys" })).body.code).toBe("bad_request");

    // Revoke: nothing to remove; a bad body is refused
    const revoked = await admin("POST", `people/${ids.bob}/connections/revoke`, ALICE, { all: true });
    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body).toMatchObject({ removed: [], connections: { principalId: ids.bob, connections: [] } });
    expect((await admin("POST", `people/${ids.bob}/connections/revoke`, ALICE, { kind: "nope" })).body.code).toBe("bad_request");

    const audit = await waitFor(async () => {
      const rows = (await admin("GET", `audit?category=people&target=${ids.zoe}`, ALICE)).body.rows as Array<any> | undefined;
      return rows && rows.some((row) => row.action === "person.reset_access") ? rows : null;
    });
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["person.console_disable", "person.console_enable", "person.reset_access"]));
    expect(audit.find((row) => row.action === "person.console_disable")).toMatchObject({ actor: { kind: "person", principalId: ids.alice, via: "console" }, after: { disabled: true, reason: "Contract ended" } });
  }, 60_000);

  it("C3: a bot's page, clone, archive and restore, transfer, model, bulk, package and import, stop and delete", async () => {
    const page = await admin("GET", `bots/${bots.atlas!.id}`, ALICE);
    expect(page.status, page.text).toBe(200);
    expect(page.body.bot).toMatchObject({
      id: bots.atlas!.id, name: "Atlas", status: "active", threads: { count: 1 }, soul: { chars: expect.any(Number) },
      permissions: { approvalMode: expect.any(String), fullAccess: false },
      routineList: [{ id: routineId, name: "Daily digest", enabled: false, schedule: "Every hour" }],
    });
    expect(page.text).not.toContain('"prompt"');
    expect((await admin("GET", `bots/${bots.atlas!.id}`, MONA)).status).toBe(404);

    // clone Atlas for Bob: model and settings, no grants, no routines, no threads
    const cloned = await admin("POST", `bots/${bots.atlas!.id}/clone`, ALICE, { ownerSub: BOB.sub, name: "Atlas for Bob" });
    expect(cloned.status, cloned.text).toBe(201);
    expect(cloned.body.bot).toMatchObject({ name: "Atlas for Bob", owner: { principalId: ids.bob }, engine: { instanceId: "claude" }, model: "fake-model", grants: [], routines: 0, threads: 1, status: "active" });
    const copyId = cloned.body.bot.id as string;
    expect(((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string }>).map((bot) => bot.id)).toContain(copyId);
    // a manager clones in reach only (Bob's Beacon, for herself)
    expect((await admin("POST", `bots/${bots.atlas!.id}/clone`, MONA, {})).status).toBe(404);
    const monaCopy = await admin("POST", `bots/${bots.beacon!.id}/clone`, MONA, { ownerPrincipalId: ids.mona });
    expect(monaCopy.status, monaCopy.text).toBe(201);
    expect((await admin("POST", `bots/${bots.beacon!.id}/clone`, MONA, { ownerPrincipalId: ids.alice })).body.code).toBe("owner_not_found");

    // archive and restore
    const cirrus = await createBot(alice, "Cirrus", "claude");
    const archived = await admin("POST", `bots/${cirrus.id}/archive`, ALICE, {});
    expect(archived.body.bot.status, archived.text).toBe("archived");
    expect((await admin("GET", "bots?status=archived", ALICE)).body.items.map((bot: { id: string }) => bot.id)).toContain(cirrus.id);
    expect((await admin("POST", `bots/${cirrus.id}/restore`, ALICE, {})).body.bot.status).toBe("active");

    // model: another installed engine; an unknown engine is refused
    const model = await admin("POST", `bots/${cirrus.id}/model`, ALICE, { engineInstanceId: "hold", model: null });
    expect(model.status, model.text).toBe(200);
    expect(model.body.bot).toMatchObject({ engine: { instanceId: "hold" }, model: expect.any(String) });
    expect((await admin("POST", `bots/${cirrus.id}/model`, ALICE, { engineInstanceId: "ghost", model: "x" })).body.code).toBe("engine_not_installed");

    // transfer: Bob owns it, Alice keeps manage; a manager may not
    expect((await admin("POST", `bots/${cirrus.id}/transfer`, MONA, { ownerPrincipalId: ids.mona })).body.code).toBe("forbidden_role");
    const moved = await admin("POST", `bots/${cirrus.id}/transfer`, ALICE, { ownerSub: BOB.sub });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.bot.owner).toMatchObject({ principalId: ids.bob, name: "Bob" });
    expect(moved.body.bot.grants).toContainEqual(expect.objectContaining({ target: `user:${ids.alice}`, level: "manage" }));

    // bulk
    const bulk = await admin("POST", "bots/bulk", ALICE, { action: "archive", ids: [cirrus.id, copyId, "nope-bot"] });
    expect(bulk.body.results).toEqual([{ id: cirrus.id, ok: true }, { id: copyId, ok: true }, { id: "nope-bot", ok: false, code: "not_found", message: "No such bot." }]);
    // 2026-10-16: Approve for me in bulk (never Full), one approval.mode row
    expect((await admin("POST", "bots/bulk", ALICE, { action: "approvalMode", ids: [bots.atlas!.id], mode: "full" })).status).toBe(400);
    const toAuto = await admin("POST", "bots/bulk", ALICE, { action: "approvalMode", ids: [bots.atlas!.id], mode: "auto", threads: true });
    expect(toAuto.body.results, toAuto.text).toEqual([{ id: bots.atlas!.id, ok: true }]);
    expect((await admin("GET", `bots/${bots.atlas!.id}`, ALICE)).body.bot.permissions.approvalMode).toBe("auto");
    const listed = ((await admin("GET", "bots", ALICE)).body.bots as Array<{ id: string; approvalMode: string }>).find((bot) => bot.id === bots.atlas!.id);
    expect(listed?.approvalMode).toBe("auto");
    expect((await admin("POST", "bots/bulk", ALICE, { action: "approvalMode", ids: [bots.atlas!.id], mode: "ask" })).body.results).toEqual([{ id: bots.atlas!.id, ok: true }]);
    // 2026-10-26 (owner): no organization switch takes Auto from members' bots;
    // a saved false is ignored
    expect((await admin("POST", "settings", ALICE, { memberAutoApproval: false })).status).toBe(200);
    expect((await admin("GET", "settings", ALICE)).body.org).toMatchObject({ memberAutoApproval: true });

    // package and import
    const pkg = await fetch(`${BASE}/api/org/admin/bots/${bots.atlas!.id}/package`, { headers: { authorization: `Bearer ${console$(ALICE).bearer}` } });
    expect(pkg.status).toBe(200);
    expect(pkg.headers.get("content-disposition")).toContain("attachment");
    const document = await pkg.json() as Record<string, unknown>;
    expect(document).toMatchObject({ format: "openmaus.package", version: 2 });
    expect(JSON.stringify(document)).not.toContain("sk-ant-");
    const imported = await admin("POST", "bots/import", ALICE, { package: document, ownerSub: ZOE.sub, name: "Atlas for Zoe" });
    expect(imported.status, imported.text).toBe(201);
    expect(imported.body.bot).toMatchObject({ name: "Atlas for Zoe", owner: { principalId: ids.zoe } });
    expect(imported.body.warnings).toEqual(expect.any(Array));
    expect((await admin("POST", "bots/import", ALICE, { package: { format: "nope" } })).body.code).toBe("invalid_package");

    // stop and delete
    expect((await admin("POST", `bots/${bots.atlas!.id}/stop`, ALICE, {})).status).toBe(200);
    expect((await admin("POST", `bots/${copyId}/delete`, ALICE, { confirm: "wrong" })).body.code).toBe("confirm_required");
    const deleted = await admin("POST", `bots/${copyId}/delete`, ALICE, { confirm: "Atlas for Bob" });
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body).toEqual({ deleted: copyId });
    expect((await admin("GET", `bots/${copyId}`, ALICE)).status).toBe(404);

    const audit = await waitFor(async () => {
      const rows = (await admin("GET", "audit?category=bot&limit=100", ALICE)).body.rows as Array<any> | undefined;
      return rows && rows.some((row) => row.action === "bot.force_delete") ? rows : null;
    });
    for (const action of ["bot.clone", "bot.archive", "bot.restore", "bot.model", "bot.transfer", "bot.export", "bot.import", "bot.force_stop", "bot.force_delete"]) {
      expect(audit.map((row) => row.action), action).toContain(action);
    }
    expect(audit.find((row) => row.action === "bot.transfer")).toMatchObject({ actor: { via: "console", principalId: ids.alice }, after: { ownerPrincipalId: ids.bob } });
  }, 90_000);

  it("C4: the organization's approval queue, a console decision in the history", async () => {
    const queue = await admin("GET", "approvals?scope=org", ALICE);
    expect(queue.status, queue.text).toBe(200);
    const card = (queue.body.approvals as Array<any>).find((entry) => entry.requestId === cardId);
    expect(card).toMatchObject({ botId: bots.beacon!.id, kind: "admin", tool: "Bash", decidable: true, owner: { principalId: ids.bob } });
    expect((await admin("GET", "approvals?scope=org", MONA)).body.code).toBe("forbidden_role");
    // Bob's own list never carries the admin card
    expect(((await admin("GET", "approvals", BOB)).body.approvals as Array<any>).map((entry) => entry.requestId)).not.toContain(cardId);
    const answered = await admin("POST", `approvals/${bots.beacon!.threadId}/${cardId}`, ALICE, { decision: "allow" });
    expect(answered.status, answered.text).toBe(200);
    const history = await waitFor(async () => {
      const got = await admin("GET", "approvals/history", ALICE);
      return (got.body.items as Array<any> | undefined)?.find((entry) => entry.requestId === cardId) ? got : null;
    });
    expect((history.body.items as Array<any>).find((entry) => entry.requestId === cardId)).toMatchObject({
      botId: bots.beacon!.id, threadId: bots.beacon!.threadId, type: "tool", tool: "Bash", decision: "allow", by: { principalId: ids.alice, name: "Alice" }, at: expect.any(Number),
    });
    expect(((await admin("GET", "approvals?scope=org", ALICE)).body.approvals as Array<any>).map((entry) => entry.requestId)).not.toContain(cardId);
    expect((await admin("GET", "approvals/history", MONA)).body.code).toBe("forbidden_role");
  }, 30_000);

  it("C4: routines across members, resume, run now, the run history", async () => {
    // the package imported for Zoe in C3 brought its routine along, off
    expect((await admin("GET", "routines", ALICE)).body.items).toHaveLength(2);
    const list = await admin("GET", `routines?bot=${bots.atlas!.id}`, ALICE);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items).toEqual([expect.objectContaining({
      id: routineId, name: "Daily digest", botId: bots.atlas!.id, botName: "Atlas", owner: expect.objectContaining({ principalId: ids.alice }),
      runAs: expect.objectContaining({ principalId: ids.alice }), schedule: "Every hour", enabled: false, nextRunAt: null, lastRun: null, failures7d: 0,
    })]);
    expect(list.text).not.toContain("Write the digest.");
    expect((await admin("GET", "routines?status=paused", ALICE)).body.items).toHaveLength(2);
    expect((await admin("GET", "routines", MONA)).body.items).toEqual([]);
    expect((await admin("GET", `routines/${routineId}`, MONA)).status).toBe(404);
    expect((await admin("POST", `routines/${routineId}/pause`, MONA, { paused: false })).status).toBe(404);

    const resumed = await admin("POST", `routines/${routineId}/pause`, ALICE, { paused: false });
    expect(resumed.status, resumed.text).toBe(200);
    expect(resumed.body.routine).toMatchObject({ enabled: true, nextRunAt: expect.any(Number) });
    const run = await admin("POST", `routines/${routineId}/run`, ALICE, {});
    expect(run.status, run.text).toBe(200);
    expect(run.body.run).toMatchObject({ id: expect.any(String), status: "running" });
    const runs = await waitFor(async () => {
      const got = await admin("GET", `routines/${routineId}/runs`, ALICE);
      const items = got.body.items as Array<any> | undefined;
      return items?.[0] && items[0].status !== "running" ? items : null;
    }, 40_000);
    expect(runs[0]).toMatchObject({ id: run.body.run.id, status: "ok", reason: null, threadId: expect.any(String), endedAt: expect.any(Number) });
    expect((await admin("GET", `routines/${routineId}`, ALICE)).body.routine.lastRun).toMatchObject({ status: "ok" });
    const paused = await admin("POST", `routines/${routineId}/pause`, ALICE, { paused: true });
    expect(paused.body.routine.enabled).toBe(false);
    // the pause row can land a moment after its answer: read until it shows
    const audit = await waitFor(async () => {
      const rows = (await admin("GET", `audit?category=bot&target=${routineId}`, ALICE)).body.rows as Array<any>;
      return rows.some((row) => row.action === "routine.pause") ? rows : null;
    }, 10_000);
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["routine.resume", "routine.run_now", "routine.pause"]));
    expect(audit.find((row) => row.action === "routine.run_now")).toMatchObject({ actor: { via: "console", principalId: ids.alice } });
  }, 60_000);

  it("C5: connections with a test, logs, incidents, settings", async () => {
    const connections = await admin("GET", "connections", ALICE);
    expect(connections.status, connections.text).toBe(200);
    expect(connections.body.engines.find((engine: { id: string }) => engine.id === "claude")).toMatchObject({ installed: true, orgKey: true, people: expect.any(Number) });
    expect(connections.body.people.map((entry: any) => entry.person.name)).toEqual(expect.arrayContaining(["Alice", "Bob", "Mona", "Zoe"]));
    expect(connections.body).toMatchObject({ mcpServers: [], marketplaces: [], skills: [] });
    expect(connections.text).not.toContain("sk-ant-");
    expect((await admin("GET", "connections", MONA)).body.code).toBe("forbidden_role");

    const test = await admin("POST", "connections/test", ALICE, { kind: "engine", id: "claude" });
    expect(test.status, test.text).toBe(200);
    expect(test.body).toEqual({ ok: true, latencyMs: expect.any(Number), reason: null, label: null });
    expect((await admin("POST", "connections/test", ALICE, { kind: "engine", id: "ghost" })).body).toMatchObject({ ok: false, reason: "engine_not_installed" });

    const logs = await admin("GET", "logs?limit=500", ALICE);
    expect(logs.status, logs.text).toBe(200);
    expect(logs.body.lines.length).toBeGreaterThan(0);
    expect(logs.body.lines[0]).toEqual({ seq: expect.any(Number), at: expect.any(Number), level: expect.any(String), area: expect.anything(), message: expect.any(String) });
    expect(logs.text).not.toContain(ORG_KEY);
    expect(logs.text).not.toContain(idp.linkToken);
    expect((await admin("GET", "logs?level=error", ALICE)).body.lines.every((line: { level: string }) => line.level === "error")).toBe(true);
    expect((await admin("GET", "logs", MONA)).body.code).toBe("forbidden_role");

    const incidents = await admin("GET", "incidents", ALICE, undefined, french);
    expect(incidents.status, incidents.text).toBe(200);
    expect(incidents.body.items.find((item: any) => item.bot.id === bots.brittle!.id)).toMatchObject({ kind: "failed", reason: "rate_limited", label: "Le fournisseur limite le débit", threadId: bots.brittle!.threadId });

    const settings = await admin("GET", "settings", ALICE);
    expect(settings.status, settings.text).toBe(200);
    expect(settings.body).toMatchObject({
      // 2026-10-26: no organization switch for Full access, a saved value is ignored
      org: { allowFullAccess: true, orgKeyConfigured: true },
      policies: { allowedMarketplaces: null, allowedEngines: null, ownAccountsOutsideList: false },
      backup: { enabled: true, schedule: "daily 03:00 UTC", ok: true },
    });
    const saved = await admin("POST", "settings", ALICE, { allowFullAccess: false, allowedEngines: ["claude", "hold"], pluginMarketplaces: { mode: "list", allow: ["acme/plugins"] }, defaults: { approvalMode: "ask" } });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.settings).toMatchObject({
      org: { allowFullAccess: true },
      policies: { allowedEngines: ["claude", "hold"], allowedMarketplaces: ["acme/plugins"], defaults: { approvalMode: "ask" } },
    });
    // 2026-10-09: the list reaches the app's config, a bot on an engine left
    // off moves to Auto on an allowed one, and Sagax refuses a model there
    expect((await api("GET", "/api/config", alice)).body.allowedEngines).toEqual(["claude", "hold"]);
    const listed = (await api("GET", "/api/bots", alice)).body.bots as Array<any>;
    expect(listed.find((bot) => bot.id === bots.brittle!.id)?.modelSelection).toMatchObject({ instanceId: expect.stringMatching(/^(claude|hold)$/), auto: true });
    expect(listed.find((bot) => bot.id === bots.atlas!.id)?.modelSelection).toMatchObject({ instanceId: "claude", model: "fake-model" });
    // 2026-10-18 (owner): an engine the organization does not offer is picked
    // nowhere (shared/offered-engines.ts), and the moved bot says so in one
    // line. 2026-10-30: off for everyone, the admin included, even on their
    // own subscription: Alice (an admin) signed in to Claude herself.
    const aliceClaude = join(home, ".sagax", "principals", ids.alice!, "claude");
    mkdirSync(aliceClaude, { recursive: true });
    writeFileSync(join(aliceClaude, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }));
    const instances = (await api("GET", "/api/instances", alice)).body.instances as Array<{ instanceId: string }>;
    expect(instances.map((row) => row.instanceId)).toEqual(expect.arrayContaining(["claude", "hold"]));
    expect(instances.map((row) => row.instanceId)).not.toContain("broken");
    expect(instances.map((row) => row.instanceId)).not.toContain("own");
    const mine = await api("GET", "/api/me/engines", alice);
    expect(mine.status, mine.text).toBe(200);
    const access = mine.body.engines as Array<{ instanceId: string; orgNotAllowed?: boolean; myTurns: string }>;
    // #1533 / #1812: an API-key engine runs on a key, never on a sign-in: her
    // turns there are the organization's key even though she signed in.
    expect(access.find((row) => row.instanceId === "claude")).toMatchObject({ myTurns: "org-key" });
    expect(access.find((row) => row.instanceId === "broken")).toBeUndefined();
    expect(access.find((row) => row.instanceId === "own")).toBeUndefined();
    const context = { organization: true, allowedEngines: ["claude", "hold"], mine: access };
    expect(engineOffer(context, "broken")).toBe("notAllowed");
    const offered = offeredEngines(instances, context).map((row) => row.instanceId);
    expect(offered).not.toContain("broken");
    expect(offered).toEqual(expect.arrayContaining(["claude", "hold"]));
    const ownRefused = await api("PATCH", `/api/bots/${bots.atlas!.id}/tasks/${bots.atlas!.threadId}`, alice, { modelSelection: { instanceId: "broken", model: "fake-model" }, updateBotDefault: true });
    expect(ownRefused.status, ownRefused.text).toBe(403);
    // the organization lets own accounts through: it comes back for her, said so
    const ownOn = await admin("POST", "settings", ALICE, { ownAccountsOutsideList: true });
    expect(ownOn.body.settings.policies).toMatchObject({ ownAccountsOutsideList: true });
    expect((await api("GET", "/api/config", alice)).body.ownAccountsOutsideList).toBe(true);
    const ownAccess = (await api("GET", "/api/me/engines", alice)).body.engines as Array<{ instanceId: string; orgNotAllowed?: boolean; myTurns: string }>;
    // her own sign-in runs the subscription engine left off the list; the
    // API-key one off the list stays off (no own account runs it)
    expect(ownAccess.find((row) => row.instanceId === "own")).toMatchObject({ orgNotAllowed: true, myTurns: "subscription" });
    const ownContext = { organization: true, allowedEngines: ["claude", "hold"], ownAccountsOutsideList: true, mine: ownAccess };
    expect(engineOffer(ownContext, "own")).toBe("offered");
    expect(ownAccountOnly(ownContext, "own")).toBe(true);
    expect(((await api("GET", "/api/instances", alice)).body.instances as Array<{ instanceId: string }>).map((row) => row.instanceId)).toContain("own");
    // 2026-10-30: a sign-in the provider refused since no longer pays: never
    // "subscription" (nor Ready on it); no organization key serves this engine
    writeFileSync(join(aliceClaude, ".pulsabot-login-expired.json"), JSON.stringify({ at: Date.now() }));
    const expired = ((await api("GET", "/api/me/engines", alice)).body.engines as Array<{ instanceId: string; myTurns: string; subscription: { expired?: boolean } }>).find((row) => row.instanceId === "own");
    expect(expired).toMatchObject({ myTurns: "expired", subscription: { signedIn: true, expired: true } });
    rmSync(join(aliceClaude, ".pulsabot-login-expired.json"), { force: true });
    // off again: gone at once, and her own sign-in is put back as it was
    expect((await admin("POST", "settings", ALICE, { ownAccountsOutsideList: false })).body.settings.policies).toMatchObject({ ownAccountsOutsideList: false });
    expect(((await api("GET", "/api/me/engines", alice)).body.engines as Array<{ instanceId: string }>).map((row) => row.instanceId)).not.toContain("own");
    rmSync(aliceClaude, { recursive: true, force: true });
    const moved = (await api("GET", `/api/threads/${bots.brittle!.threadId}/messages?limit=100`, alice)).body.messages as Array<{ kind?: string; tool?: { name: string; engineMove?: { from: string; to: string } } }>;
    const line = moved.find((message) => message.tool?.engineMove);
    expect(line?.tool?.engineMove).toEqual({ from: expect.any(String), to: expect.any(String) });
    expect(line?.tool?.name).toMatch(/^notice: Your organization no longer offers .+\. This bot now uses Auto, starting on .+\.$/);
    const refused = await api("PATCH", `/api/bots/${bots.atlas!.id}/tasks/${bots.atlas!.threadId}`, alice, { modelSelection: { instanceId: "broken", model: "fake-model" }, updateBotDefault: true });
    expect(refused.status, refused.text).toBe(403);
    // the engine policy holds for the console's model change
    expect((await admin("POST", `bots/${bots.atlas!.id}/model`, ALICE, { engineInstanceId: "broken", model: null })).body.code).toBe("engine_not_allowed");
    expect((await admin("POST", "settings", ALICE, { allowedEngines: ["ghost"] })).body.code).toBe("engine_not_installed");
    // 2026-10-17: an empty list is "none" (Perspicax 1.8.34), never "every engine"
    const none = await admin("POST", "settings", ALICE, { allowedEngines: [] });
    expect(none.body.settings.policies).toMatchObject({ allowedEngines: [] });
    expect((await api("GET", "/api/config", alice)).body.allowedEngines).toEqual([]);
    expect((await admin("POST", `bots/${bots.atlas!.id}/model`, ALICE, { engineInstanceId: "claude", model: null })).body.code).toBe("engine_not_allowed");
    const noneRefused = await api("PATCH", `/api/bots/${bots.atlas!.id}/tasks/${bots.atlas!.threadId}`, alice, { modelSelection: { instanceId: "hold", model: "fake-model" }, updateBotDefault: true });
    expect(noneRefused.status, noneRefused.text).toBe(403);
    expect((await admin("POST", "settings", ALICE, { nope: true })).body.code).toBe("bad_request");
    const reset = await admin("POST", "settings", ALICE, { allowFullAccess: true, allowedEngines: null, pluginMarketplaces: { mode: "any" } });
    expect(reset.body.settings.policies).toMatchObject({ allowedEngines: null, allowedMarketplaces: null });
    expect(((await api("GET", "/api/instances", alice)).body.instances as Array<{ instanceId: string }>).map((row) => row.instanceId)).toContain("broken");
    const audit = (await admin("GET", "audit?category=org&limit=50", ALICE)).body.rows as Array<any>;
    expect(audit.filter((row) => row.action === "org.settings" && row.actor.via === "console").map((row) => row.changed[0])).toEqual(expect.arrayContaining(["allowFullAccess", "allowedEngines", "ownAccountsOutsideList", "pluginMarketplaces", "defaults"]));
  }, 60_000);

  it("C5: the vault export policy (2026-10-18), and a pairing code is no recent sign-in", async () => {
    // on by default; the console and Settings > Organization both carry it
    expect((await admin("GET", "settings", ALICE)).body.org).toMatchObject({ allowVaultExport: true });
    expect((await api("POST", "/api/me/credentials/list", alice, {})).body).not.toHaveProperty("exportBlocked");
    const off = await admin("POST", "settings", ALICE, { allowVaultExport: false });
    expect(off.status, off.text).toBe(200);
    expect(off.body.settings.org).toMatchObject({ allowVaultExport: false });
    expect((await api("GET", "/api/org", alice)).body.settings).toMatchObject({ allowVaultExport: false });
    expect((await api("POST", "/api/me/credentials/list", alice, {})).body.exportBlocked).toBe(true);
    const refused = await api("POST", "/api/me/credentials/export", alice, { format: "chrome-csv", acknowledge: "plaintext" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("export_blocked_by_org");
    // a member cannot turn it back on; an admin can, in Settings > Organization
    expect((await api("PATCH", "/api/org/settings", bob, { allowVaultExport: true })).status).toBe(403);
    const on = await api("PATCH", "/api/org/settings", alice, { allowVaultExport: true });
    expect(on.status, on.text).toBe(200);
    expect(on.body.settings).toMatchObject({ allowVaultExport: true });
    expect((await api("POST", "/api/me/credentials/list", alice, {})).body).not.toHaveProperty("exportBlocked");
    // the audit is written after the answer
    await expect.poll(async () => ((await admin("GET", "audit?category=org&limit=50", ALICE)).body.rows as Array<any>)
      .filter((row) => row.action === "org.settings" && row.changed?.[0] === "allowVaultExport").length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

    // Alice just signed in with Pulsatrix: a recent sign-in. A code made with
    // her session (what a bot's manage_pairing does) redeems into a session
    // of hers that is not one.
    expect((await api("GET", "/api/security-keys", await signIn(ALICE))).body).not.toHaveProperty("needsSignIn");
    const pairing = await api("POST", "/api/auth/pairing", alice, {});
    expect(pairing.status, pairing.text).toBe(200);
    const paired = await api("POST", "/api/auth/pair", undefined, { code: pairing.body.code, label: "bot" });
    expect(paired.status, paired.text).toBe(200);
    const bearer = { bearer: paired.body.token as string };
    expect((await api("GET", "/api/security-keys", bearer)).body.needsSignIn).toBe(true);
    // nor does it pass the vault export's recent sign-in, while a fresh
    // Pulsatrix sign-in of hers does
    const viaCode = await api("POST", "/api/me/credentials/export", bearer, { format: "chrome-csv", acknowledge: "plaintext" });
    expect(viaCode.status, viaCode.text).toBe(403);
    expect(viaCode.body.code).toBe("reauth_required");
    const fresh = await api("POST", "/api/me/credentials/export", await signIn(ALICE), { format: "chrome-csv", acknowledge: "plaintext" });
    expect(fresh.status, fresh.text).toBe(200);
  }, 60_000);

  it("C6: a bot's look and persona, its picture behind a strong ETag", async () => {
    const pixel = await createBot(alice, "Pixel", "claude");
    const plain = await admin("GET", `bots/${pixel.id}`, ALICE);
    expect(plain.body.bot.look).toMatchObject({ kind: "default", character: "owl", family: "classics", skin: "none", image: null });
    expect((await admin("GET", `bots/${pixel.id}/avatar`, ALICE)).body.code).toBe("not_found");
    const dressed = await api("PATCH", `/api/bots/${pixel.id}`, alice, { title: "Design helper", description: "Draws the mockups.", mascotLook: { character: "bunbu", skins: { bunbu: "pastel" } } });
    expect(dressed.status, dressed.text).toBe(200);
    const listed = ((await admin("GET", "bots?q=pixel", ALICE)).body.items as Array<any>).find((bot) => bot.id === pixel.id);
    expect(listed.look).toMatchObject({ kind: "mascot", character: "bunbu", family: "animals", skin: "pastel", image: null });
    expect(listed.persona).toEqual({ displayName: "Pixel", title: "Design helper", description: "Draws the mockups." });

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const uploaded = await fetch(`${BASE}/api/attachments`, { method: "POST", headers: { "content-type": "image/png", cookie: alice.cookie! }, body: new Uint8Array(png) });
    expect(uploaded.status).toBe(201);
    const file = ((await uploaded.json()) as { path: string }).path.split(/[\\/]/).pop()!;
    expect((await api("PATCH", `/api/bots/${pixel.id}`, alice, { avatarUrl: `/api/attachments/${file}`, avatarCrop: "circle" })).status).toBe(200);
    const page = await admin("GET", `bots/${pixel.id}`, ALICE);
    expect(page.body.bot.look).toMatchObject({ kind: "image", character: "bunbu", image: { crop: "circle", zoom: 1, focusX: 0.5, focusY: 0.5, type: "image/png", version: expect.stringMatching(/^[0-9a-f]{16}$/) } });
    expect(page.text).not.toContain(file);
    const picture = await fetch(`${BASE}/api/org/admin/bots/${pixel.id}/avatar`, { headers: { authorization: `Bearer ${console$(ALICE).bearer}` } });
    expect(picture.status).toBe(200);
    expect(Buffer.from(await picture.arrayBuffer())).toEqual(png);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(picture.headers.get("cache-control")).toBe("private, no-cache");
    expect(picture.headers.get("x-content-type-options")).toBe("nosniff");
    expect(picture.headers.get("etag")).toBe(`"${page.body.bot.look.image.version}"`);
    const again = await fetch(`${BASE}/api/org/admin/bots/${pixel.id}/avatar`, { headers: { authorization: `Bearer ${console$(ALICE).bearer}`, "if-none-match": picture.headers.get("etag")! } });
    expect(again.status).toBe(304);
    // a manager out of reach, and an employee, never see it
    expect((await admin("GET", `bots/${pixel.id}/avatar`, MONA)).status).toBe(404);
    expect((await admin("GET", `bots/${pixel.id}/avatar`, ZOE)).body.code).toBe("forbidden_role");
  }, 60_000);

  it("C7: the routines calendar: a run and the planned ones, by scope", async () => {
    const clock = await createBot(alice, "Clock", "claude");
    const created = await api("POST", "/api/routines", alice, { name: "Hourly check", botId: clock.id, prompt: "Check the clock.", enabled: true,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } });
    expect(created.status, created.text).toBe(201);
    const id = created.body.routine.id as string;
    const started = await admin("POST", `routines/${id}/run`, ALICE, {});
    expect(started.status, started.text).toBe(200);
    await waitFor(async () => {
      const got = await admin("GET", `routines/${id}/runs`, ALICE);
      return (got.body.items as Array<any> | undefined)?.[0]?.status === "ok";
    }, 40_000);
    const window = `from=${Date.now() - 86_400_000}&to=${Date.now() + 86_400_000}`;
    const all = await admin("GET", `routines/runs?scope=all&routine=${id}&${window}`, ALICE);
    expect(all.status, all.text).toBe(200);
    const items = all.body.items as Array<any>;
    expect(items[0]).toMatchObject({
      id: started.body.run.id, routineId: id, routineName: "Hourly check", botId: clock.id, botName: "Clock", state: "ok", planned: false,
      trigger: "manual", owner: { principalId: ids.alice, name: "Alice" }, runAs: { principalId: ids.alice }, threadId: expect.any(String), endedAt: expect.any(Number),
    });
    const planned = items.filter((item) => item.planned);
    expect(planned.length).toBeGreaterThanOrEqual(23);
    expect(planned[0]).toMatchObject({ state: "planned", threadId: null, durationMs: expect.any(Number) });
    expect(all.text).not.toContain("Check the clock.");
    // a member sees their own routines only; a wider scope needs its permission
    expect((await admin("GET", `routines/runs?${window}`, ZOE)).body.items.some((item: { routineId: string }) => item.routineId === id)).toBe(false);
    expect((await admin("GET", `routines/runs?scope=team&${window}`, ZOE)).body).toMatchObject({ code: "routine_scope_not_allowed", permission: "routines.viewTeam" });
    expect((await admin("GET", `routines/runs?scope=team&${window}`, MONA)).body.items.some((item: { routineId: string }) => item.routineId === id)).toBe(false);
    expect((await admin("GET", "routines/runs?from=2026-01-01&to=2026-06-01", ALICE)).body.code).toBe("bad_request");
    expect((await admin("GET", `routines/${id}`, ALICE)).status).toBe(200);
    expect((await admin("POST", `routines/${id}/pause`, ALICE, { paused: true })).status).toBe(200);
  }, 60_000);
});
