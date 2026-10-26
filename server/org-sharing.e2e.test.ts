// Slice 3 of the Perspicax organization through the real server, against the
// local fake provider (server/testing/fake-oidc-provider.ts, now with the
// Pulsa Bot directory) and the fake Claude CLI:
//
//   S3-3  the directory creates principals before anyone signs in; the first
//         sign-in lands on the same principal
//   S3-4  B: an admin shares a bot with bob; bob sees it, writes, gets a reply
//         produced with the organization key; dave sees nothing of it
//   S3-5  C: the grant removed, bob's stream ends and the bot is gone at once
//   S3-6  F: no org key (an admin cleared it in Settings > Connections; the
//         org key switch is gone since 2026-10-01) or no installed engine
//         gives an access card to the person who spoke, no turn
//   S3-6b F on every path a person reaches: a queued send, an edit, a bot hop
//   S3-7  Full access on a member's bot is its owner's, confirmed once
//   S3-7b its cards that reach past its own workspace (a shell command, a
//         write to the shared Claude settings, a read of the config) wait for
//         an organization admin; a file inside its workspace is the owner's
//   S3-7c a built-in Sagax read (list_bots) of a member's bot is its owner's
//         to answer; a server command reaches every admin's stream at once
//         (org.approvals), lists who asked, and the admin's Allow releases it
//   S3-10 the directory is the backstop: a disabled person's session ends
//   S3-11 the authenticated health lists the engines and whether installed
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9S3ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S3BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9S3DAVE000000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "employee" };
const ERIN: FakeOidcUser = { sub: "01J9S3ERIN000000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };
const PACKAGE_VERSION = (JSON.parse(readFileSync(join(SERVER_DIR, "..", "package.json"), "utf8")) as { version: string }).version;

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
let log = "";
let idp: FakeOidcProvider;
let prompts = "";
const TEST_CAPABILITY_KEY = "org-sharing-fixture-capability";

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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** An open /api/events stream: everything it received so far, and whether the server ended it. */
async function openStream(auth: Auth): Promise<{ text: () => string; ended: Promise<void>; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      const ended = new Promise<void>((done) => { res.on("end", () => done()); res.on("close", () => done()); res.on("error", () => done()); });
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, ended, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

const botsOf = async (auth: Auth) => (await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; threadId: string; messages: Array<{ kind: string; role: string; text?: string; access?: any }> }>;

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
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
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

posixOnly("Perspicax organization, slice 3: directory, sharing with a user, access cards", () => {
  let alice: Auth;
  let bobId = "";
  let daveId = "";
  let shared: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, DAVE, ERIN].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-sharing-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    // every prompt any fake Claude process receives: the proof a turn never ran
    prompts = join(home, "claude-prompts.jsonl");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_PROMPTS: prompts }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        // a turn that never ends on its own: how a bot is held busy
        stuck: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_PROMPTS: prompts }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        ghost: { driver: "claudeAgent", config: { cli: "/nonexistent/claude", fullAuto: true } },
        // held open with its permission broker reachable: how cards are raised
        hold: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        grok: { driver: "grokAgent", config: { cli: FAKE_ACP, fullAuto: false } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S3-3: lists the directory's people with principal ids before they sign in, and a sign-in lands on the same one", async () => {
    const org = await waitFor(async () => {
      const got = await api("GET", "/api/org", alice);
      return got.body.link?.state === "ok" ? got.body : null;
    });
    expect(org).toMatchObject({ org: { name: "Acme", identity: { kind: "perspicax", issuer: idp.issuer, serverId: idp.serverId } }, viewerRole: "admin", settings: { orgKeyConfigured: true } });
    expect(org.settings).not.toHaveProperty("memberBotsUseOrgKey");
    expect(idp.directoryRequests.at(-1)).toMatchObject({ authorization: `Bearer ${idp.linkToken}`, "x-pulsabot-version": PACKAGE_VERSION });
    const people = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string; role: string; disabled: boolean }>;
    expect(people.map((p) => p.login)).toEqual(["alice", "bob", "dave", "erin"]);
    expect(people.find((p) => p.login === "alice")?.role).toBe("admin");
    bobId = people.find((p) => p.login === "bob")!.principalId;
    daveId = people.find((p) => p.login === "dave")!.principalId;
    expect(bobId).toMatch(/^pr_/);
    const bob = await signIn(BOB);
    expect((await api("GET", "/api/auth/session", bob)).body.principalId).toBe(bobId);
    // a member reads the directory and the organization, never changes the settings
    expect((await api("GET", "/api/org/directory", bob)).status).toBe(200);
    expect((await api("GET", "/api/org", bob)).body.viewerRole).toBe("member");
    expect((await api("PATCH", "/api/org/settings", bob, { interimAttachDays: 3 })).status).toBe(403);
    // the retired switch is refused, even from an admin
    expect((await api("PATCH", "/api/org/settings", alice, { memberBotsUseOrgKey: true })).status).toBe(400);
    expect((await api("POST", "/api/org/invites", alice, { email: "x@example.test" })).status).toBe(403);
  });

  it("S3-11: the authenticated health lists the engines and which are installed", async () => {
    const engines = (await api("GET", "/api/health", alice)).body.engines as Array<{ instanceId: string; driver: string; installed: boolean }>;
    expect(engines.find((e) => e.instanceId === "claude")).toMatchObject({ driver: "claudeAgent", installed: true });
    expect(engines.find((e) => e.instanceId === "ghost")).toMatchObject({ driver: "claudeAgent", installed: false });
    expect(engines.find((e) => e.instanceId === "grok")).toMatchObject({ installed: true });
    // a member signed in reads it too; a session-less local caller (any bot's
    // shell on this shared server) learns the app name only
    const bob = await signIn(BOB);
    expect(Array.isArray((await api("GET", "/api/health", bob)).body.engines)).toBe(true);
    const bare = await api("GET", "/api/health");
    expect(bare.status).toBe(200);
    expect(bare.body).toEqual({ app: "openmausbot", product: "sagax" });
  });

  it("S3-4 (B): shared with bob, answered with the org key; dave sees none of it", async () => {
    // The organization's key serves by itself (2026-10-01): bob has no
    // subscription and no key of his own. Slice 8: the settings also carry
    // the interim attach window (none here). The org's GitHub OAuth App
    // (none), the plugin marketplace policy (any, the default) and the
    // labeled access tokens (none).
    expect((await api("GET", "/api/org", alice)).body.settings).toEqual({
      orgKeyConfigured: true, allowFullAccess: false, allowVaultExport: true, memberEnvironmentAutonomy: true, confidentialThreadsByDefault: false, memberAutoApproval: true, interimAttach: { until: null, people: 0 },
      github: { clientId: null, fromEnvironment: false }, pluginMarketplaces: { mode: "any" },
      githubTokens: [],
    });
    shared = await createBot(alice, "Xavier", "claude");
    const refusals = [
      await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: "bob@example.test" }),
      await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: (await api("GET", "/api/auth/session", alice)).body.principalId }),
    ];
    expect(refusals.map((r) => r.body.code)).toEqual(["unknown_person", "self"]);
    const granted = await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: bobId });
    expect(granted.status, granted.text).toBe(200);
    expect(granted.body.directGrants).toEqual([bobId]);

    const bob = await signIn(BOB);
    const dave = await signIn(DAVE);
    const daveStream = await openStream(dave);
    expect((await botsOf(bob)).map((b) => b.id)).toContain(shared.id);
    const sent = await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "ping from bob" });
    expect(sent.status, sent.text).toBe(202);
    const reply = await waitFor(async () => {
      const bot = (await botsOf(bob)).find((b) => b.id === shared.id);
      return bot?.messages.find((m) => m.role === "bot" && m.kind === "text" && m.text) ?? null;
    }, 30_000);
    expect(reply.text).toBeTruthy();
    // organization mode names the person by their display name, never their email
    const asked = (await botsOf(bob)).find((b) => b.id === shared.id)?.messages
      .find((m) => m.role === "user" && m.text === "ping from bob") as { sender?: { name: string } } | undefined;
    expect(asked?.sender?.name).toBe("Bob");
    expect(JSON.stringify(asked)).not.toContain("bob@example.test");
    await waitFor(async () => existsSync(dump));
    const env = (JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env;
    expect(env.ANTHROPIC_API_KEY).toBe(ORG_KEY);
    expect(log).toContain(`[omb-turn] bot=${shared.id}`);
    // the thread says what paid, without the key
    const digest = await waitFor(async () => (await botsOf(bob)).find((b) => b.id === shared.id)?.messages.find((m) => m.kind === "digest" && (m as { digest?: { access?: unknown } }).digest?.access) ?? null, 15_000);
    expect((digest as unknown as { digest: { access: unknown } }).digest.access).toEqual({ via: "org-key", payer: "organization" });
    expect(JSON.stringify(digest)).not.toContain(ORG_KEY);

    expect((await botsOf(dave)).map((b) => b.id)).not.toContain(shared.id);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${shared.threadId}/messages`, dave)).status);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${shared.id}/messages`, dave, { text: "hi" })).status);
    const search = await api("GET", `/api/search?q=${encodeURIComponent("ping from bob")}`, dave);
    expect(search.text).not.toContain(shared.id);
    expect(search.text).not.toContain(shared.threadId);
    await sleep(300);
    expect(daveStream.text()).not.toContain(shared.id);
    expect(daveStream.text()).not.toContain(shared.threadId);
    daveStream.close();
  }, 60_000);

  it("2026-10-16: the organization's key serves bob only for the engines Perspicax gives him", async () => {
    const setBob = (list: string[] | undefined) => {
      idp.directoryPeople = idp.directoryPeople.map((person) => (person.sub === BOB.sub ? { ...person, sagax_server_engines: list } : person));
    };
    // a bot of its own, so the cards here never meet the other cases'
    const own = await createBot(alice, "Yves", "claude");
    expect((await api("POST", `/api/bots/${own.id}/direct-grants`, alice, { userId: bobId })).status).toBe(200);
    setBob(["codex"]);
    const bob = await signIn(BOB);
    const refused = () => api("POST", `/api/bots/${own.id}/messages`, bob, { text: `not given ${Date.now()}` });
    const card = await waitFor(async () => {
      expect((await refused()).status).toBe(202);
      await sleep(400);
      const bot = (await botsOf(bob)).find((b) => b.id === own.id);
      return bot?.messages.find((m) => m.kind === "access" && (m as { access?: { cause?: string } }).access?.cause === "server_engine_not_allowed") ?? null;
    }, 30_000);
    expect(card.access).toMatchObject({ reason: "no_access", engine: "Claude", botId: own.id, payer: "speaker", payerPrincipalId: bobId, cause: "server_engine_not_allowed" });
    // once the directory says so, nothing runs on the organization's key for him
    const before = readFileSync(dump, "utf8");
    expect((await refused()).status).toBe(202);
    await sleep(1_000);
    expect(readFileSync(dump, "utf8")).toBe(before);
    // his engines page says the organization's key does not serve him here
    const mine = (await api("GET", "/api/me/engines", bob)).body.engines as Array<{ instanceId: string; orgKey: boolean; orgKeyNotGiven?: boolean; myTurns: string }>;
    expect(mine.find((engine) => engine.instanceId === "claude")).toMatchObject({ orgKey: false, orgKeyNotGiven: true, myTurns: "none" });
    setBob(undefined);
    await signIn(BOB);
  }, 60_000);

  it("S3-5 (C): removing bob's grant ends his stream and the bot is gone for him at once", async () => {
    const bob = await signIn(BOB);
    const stream = await openStream(bob);
    const removed = await api("DELETE", `/api/bots/${shared.id}/direct-grants/${bobId}`, alice);
    expect(removed.status, removed.text).toBe(200);
    expect(removed.body.directGrants).toEqual([]);
    await Promise.race([stream.ended, sleep(5_000).then(() => { throw new Error("bob's stream stayed open"); })]);
    expect((await botsOf(bob)).map((b) => b.id)).not.toContain(shared.id);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "still here?" })).status);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${shared.threadId}/messages`, bob)).status);
    // only the owner removes, and only a grant that exists
    expect((await api("DELETE", `/api/bots/${shared.id}/direct-grants/${bobId}`, alice)).status).toBe(404);
  });

  it("S3-6 (F): without the org key or an installed engine, the send is accepted and the card says why", async () => {
    // an admin clears the organization's key in Settings > Connections
    expect((await api("PATCH", "/api/config", alice, { anthropic: { key: "" } })).status).toBe(200);
    await waitFor(async () => (await api("GET", "/api/org", alice)).body.settings?.orgKeyConfigured === false);
    expect((await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: bobId })).status).toBe(200);
    const bob = await signIn(BOB);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const before = readFileSync(dump, "utf8");
    const sent = await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "no key now" });
    expect(sent.status, sent.text).toBe(202);
    const card = await waitFor(async () => {
      const bot = (await botsOf(bob)).find((b) => b.id === shared.id);
      return bot?.messages.find((m) => m.kind === "access") ?? null;
    });
    // bob spoke: the card is his to act on (his subscription, his key)
    expect(card.access).toMatchObject({ reason: "no_access", engine: "Claude", botId: shared.id, payer: "speaker", payerPrincipalId: bobId, cause: "no_credentials", subscriptionSignIn: true, keysUrl: `${idp.issuer}/console/pulsabot/keys` });
    expect(readFileSync(dump, "utf8")).toBe(before);
    // private threads: bob hears his own thread's failure; alice, the bot's
    // owner, hears nothing of bob's conversation
    await waitFor(async () => bobStream.text().includes("turn-failed"));
    bobStream.close();
    await sleep(300);
    expect(aliceStream.text()).not.toContain("no key now");
    expect(aliceStream.text()).not.toContain("turn-failed");
    aliceStream.close();

    // the same rule in a room: bob's message there gets the card, not a turn
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    const room = await api("POST", "/api/groups", alice, { name: "Pay questions", memberIds: [shared.id], humanIds: [aliceId, bobId],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    const roomThread = room.body.group.threadId as string;
    const aliceRoomStream = await openStream(alice);
    const bobRoomStream = await openStream(bob);
    const posted = await api("POST", `/api/groups/${room.body.group.id}/messages`, bob, { text: "room ping" });
    expect(posted.status, posted.text).toBe(202);
    const roomCard = await waitFor(async () => {
      const got = await api("GET", `/api/threads/${roomThread}/messages`, bob);
      return (got.body.messages as Array<{ kind: string; access?: unknown }> | undefined)?.find((m) => m.kind === "access") ?? null;
    });
    expect(roomCard.access).toMatchObject({ reason: "no_access", botId: shared.id, payerPrincipalId: bobId });
    expect(readFileSync(dump, "utf8")).toBe(before);
    // 2026-10-01: bob's card is his alone. Alice, in the same room, sees his
    // message and nothing in place of the card: not in the list, the room,
    // the live stream, the export or search.
    await waitFor(async () => bobRoomStream.text().includes('"kind":"access"'));
    await waitFor(async () => bobRoomStream.text().includes("turn-failed"));
    await sleep(300);
    const aliceRoom = await api("GET", `/api/threads/${roomThread}/messages`, alice);
    expect(aliceRoom.status, aliceRoom.text).toBe(200);
    expect((aliceRoom.body.messages as Array<{ kind: string; text?: string }>).some((m) => m.text === "room ping")).toBe(true);
    expect((aliceRoom.body.messages as Array<{ kind: string }>).some((m) => m.kind === "access")).toBe(false);
    const aliceGroups = await api("GET", "/api/groups", alice);
    expect(JSON.stringify(aliceGroups.body)).not.toContain('"kind":"access"');
    expect(aliceRoomStream.text()).toContain("room ping");
    expect(aliceRoomStream.text()).not.toContain('"kind":"access"');
    expect(aliceRoomStream.text()).not.toContain("turn-failed");
    aliceRoomStream.close();
    bobRoomStream.close();
    const aliceExport = await api("GET", `/api/threads/${roomThread}/export?format=json`, alice);
    expect(aliceExport.status).toBe(200);
    expect((aliceExport.body.messages as Array<{ kind: string }>).some((m) => m.kind === "access")).toBe(false);
    const bobExport = await api("GET", `/api/threads/${roomThread}/export?format=json`, bob);
    expect((bobExport.body.messages as Array<{ kind: string }>).some((m) => m.kind === "access")).toBe(true);
    for (const q of ["Claude", "access", "subscription"]) {
      const found = await api("GET", `/api/search?q=${q}&threadId=${roomThread}`, alice);
      expect(found.status, found.text).toBe(200);
      expect((found.body.hits as Array<{ kind: string }>).some((hit) => hit.kind === "access")).toBe(false);
    }

    const ghost = await createBot(alice, "Ghost", "ghost");
    expect((await api("POST", `/api/bots/${ghost.id}/messages`, alice, { text: "hello?" })).status).toBe(202);
    const missing = await waitFor(async () => (await botsOf(alice)).find((b) => b.id === ghost.id)?.messages.find((m) => m.kind === "access") ?? null);
    expect(missing.access).toMatchObject({ reason: "engine_missing", botId: ghost.id });

    // 2026-10-01: the server's own sign-ins no longer serve an admin's own
    // bot; an engine with no sign-in or key of hers and no org key is refused
    const own = await createBot(alice, "Grokker", "grok");
    expect((await api("POST", `/api/bots/${own.id}/messages`, alice, { text: "ping" })).status).toBe(202);
    const ownCard = await waitFor(async () => (await botsOf(alice)).find((b) => b.id === own.id)?.messages.find((m) => m.kind === "access") ?? null);
    expect(ownCard.access).toMatchObject({ reason: "no_access", payer: "owner", cause: "no_credentials" });
    // #114: Grok Build has a personal sign-in (`grok login --device-auth`),
    // so the card offers it to the person who has to act
    expect(ownCard.access.subscriptionSignIn).toBe(true);
  }, 60_000);

  it("S3-6b (F): bob's queued send, his edit and his bot's ask_bot on alice's bot get the card, never a turn", async () => {
    // the organization key is still cleared (S3-6); bob still holds his grant on Xavier
    const bob = await signIn(BOB);
    const promptsNow = () => (existsSync(prompts) ? readFileSync(prompts, "utf8") : "");
    const accessCards = async (auth: Auth, botId: string) =>
      ((await botsOf(auth)).find((b) => b.id === botId)?.messages ?? []).filter((m) => m.kind === "access");

    // 1. queued: alice's turn holds the bot, bob's words wait for it. Alice
    // runs on her own Claude subscription (the server's sign-ins no longer
    // serve an admin, 2026-10-01): the marker a finished sign-in leaves.
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId as string;
    const aliceLogin = join(home, ".sagax", "principals", aliceId, "claude");
    mkdirSync(aliceLogin, { recursive: true, mode: 0o700 });
    writeFileSync(join(aliceLogin, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    const held = await createBot(alice, "Holder", "stuck");
    expect((await api("POST", `/api/bots/${held.id}/direct-grants`, alice, { userId: bobId })).status).toBe(200);
    expect((await api("POST", `/api/bots/${held.id}/messages`, alice, { text: "hold on, alice" })).status).toBe(202);
    await waitFor(async () => promptsNow().includes("hold on, alice"));
    const queued = await api("POST", `/api/bots/${held.id}/messages`, bob, { text: "queued from bob" });
    expect(queued.status, queued.text).toBe(202);
    // never folded into alice's running turn: private threads put bob's
    // words in his own conversation with the bot, not behind alice's
    expect(queued.body.steered).toBeUndefined();
    const aliceThread = (await botsOf(alice)).find((b) => b.id === held.id)!.threadId;
    const bobThread = (await botsOf(bob)).find((b) => b.id === held.id)!.threadId;
    expect(bobThread).not.toBe(aliceThread);
    expect(JSON.stringify((await api("GET", `/api/threads/${aliceThread}/messages`, alice)).body)).not.toContain("queued from bob");
    const stopped = await api("POST", `/api/bots/${held.id}/interrupt`, alice, {});
    expect(stopped.status, stopped.text).toBeLessThan(300);
    const heldCard = await waitFor(async () => (await accessCards(bob, held.id))[0] ?? null);
    expect(heldCard.access).toMatchObject({ reason: "no_access", botId: held.id });
    await waitFor(async () => log.includes(`bot=${held.id} refused: no_access`));
    expect(promptsNow()).not.toContain("queued from bob");

    // 2. edit: bob reruns his own message on Xavier
    const xavier = (await botsOf(bob)).find((b) => b.id === shared.id)!;
    const mine = xavier.messages.find((m) => m.role === "user" && m.kind === "text" && m.text === "no key now") as { id?: string } | undefined;
    expect(mine?.id).toBeTruthy();
    const cardsBefore = (await accessCards(bob, shared.id)).length;
    const edited = await api("POST", `/api/bots/${shared.id}/messages/${mine!.id}/edit`, bob, { text: "edited by bob" });
    expect(edited.status, edited.text).toBe(202);
    await waitFor(async () => (await accessCards(bob, shared.id)).length > cardsBefore);
    await sleep(300);
    expect(promptsNow()).not.toContain("edited by bob");

    // 3. a bot hop: bob's own bot asks alice's Xavier
    const bee = await createBot(bob, "Bee", "claude");
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openmausbot-test-capability": TEST_CAPABILITY_KEY },
      body: JSON.stringify({ botId: bee.id, threadId: bee.threadId, kind: "agents" }),
    });
    expect(minted.status).toBe(201);
    const token = ((await minted.json()) as { token: string }).token;
    const aliceCards = (await accessCards(alice, shared.id)).length;
    const refusals = () => log.split(`bot=${shared.id} refused: no_access`).length;
    const refusedBefore = refusals();
    const hop = await fetch(`${BASE}/api/internal/ask-bot`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ toBotId: shared.id, message: "hop from bee" }),
    });
    const hopText = await hop.text();
    expect(hop.status, hopText).toBe(200);
    // the hop speaks for bob (Bee's owner): refused, and the card is bob's,
    // never shown to alice in her thread with Xavier
    await waitFor(async () => refusals() > refusedBefore);
    await sleep(300);
    expect((await accessCards(alice, shared.id)).length).toBe(aliceCards);
    expect(promptsNow()).not.toContain("hop from bee");
  }, 60_000);

  it("S3-12: a bot reaches its owner's bots and the ones shared with them, never another person's", async () => {
    // Sections are each person's own here and bot.section stays empty, so
    // the section rule alone once put every person's bots in one team.
    const dave = await signIn(DAVE);
    const bob = await signIn(BOB);
    const dot = await createBot(dave, "Dot", "claude");
    const dash = await createBot(dave, "Dash", "claude");
    const bee = (await botsOf(bob)).find((b) => (b as { name?: string }).name === "Bee")!;
    const capability = async (bot: { id: string; threadId: string }, roomCoordination = false) => {
      const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-openmausbot-test-capability": TEST_CAPABILITY_KEY },
        body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, kind: "agents", roomCoordination }),
      });
      expect(minted.status).toBe(201);
      return ((await minted.json()) as { token: string }).token;
    };
    const roster = async (token: string) => {
      const got = await fetch(`${BASE}/api/internal/agents`, { headers: { authorization: `Bearer ${token}` } });
      expect(got.status).toBe(200);
      return ((await got.json()) as { bots: Array<{ id: string }> }).bots.map((b) => b.id);
    };

    const dotToken = await capability(dot);
    expect(await roster(dotToken)).toEqual([dash.id]);
    // Bee (bob's) sees alice's bots shared with bob, not dave's nor alice's others
    const beeRoster = await roster(await capability(bee));
    expect(beeRoster).toContain(shared.id);
    expect(beeRoster).not.toContain(dot.id);
    expect(beeRoster).not.toContain(dash.id);

    // asking another person's bot by id is refused before any turn
    const promptsNow = () => (existsSync(prompts) ? readFileSync(prompts, "utf8") : "");
    const hop = await fetch(`${BASE}/api/internal/ask-bot`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${dotToken}` },
      body: JSON.stringify({ toBotId: shared.id, message: "hop from dot" }),
    });
    expect(hop.status).toBe(403);
    await sleep(300);
    expect(promptsNow()).not.toContain("hop from dot");

    // A chat turn answers ask_bot with 409 and uses coordinate_bots: the
    // same scope holds there, for a bot id and for a room dot is not in.
    const room = await api("POST", "/api/groups", bob, { name: "Bob's desk", memberIds: [bee.id] });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const chatToken = await capability(dot, true);
    const targets = await fetch(`${BASE}/api/internal/room-targets`, { headers: { authorization: `Bearer ${chatToken}` } });
    const listed = (await targets.json()) as { bots: Array<{ id: string }>; rooms: Array<{ id: string; members: Array<{ id: string }> }> };
    expect(targets.status, JSON.stringify(listed)).toBe(200);
    expect(listed.bots.map((b) => b.id)).toEqual([dash.id]);
    expect(listed.rooms.map((r) => r.id)).not.toContain(roomId);
    expect(listed.rooms.flatMap((r) => r.members.map((m) => m.id)).every((id) => id === dash.id)).toBe(true);
    const coordinate = async (body: Record<string, unknown>) => {
      const sent = await fetch(`${BASE}/api/internal/coordinate-bots`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${chatToken}` },
        body: JSON.stringify(body),
      });
      return { status: sent.status, text: await sent.text() };
    };
    const direct = await coordinate({ botIds: [shared.id], message: "work from dot" });
    expect(direct.status, direct.text).toBe(403);
    const intoRoom = await coordinate({ groupId: roomId, botIds: [bee.id], message: "work from dot" });
    expect(intoRoom.status, intoRoom.text).toBe(403);
    // its owner's own bot is still reached
    const own = await coordinate({ botIds: [dash.id], message: "work for dash" });
    expect(own.status, own.text).toBe(200);
    await sleep(300);
    expect(promptsNow()).not.toContain("work from dot");
  }, 60_000);

  it("S3-7: Full access on a member's bot is its owner's choice, confirmed once; Custom never", async () => {
    // off until an admin turns it on (2026-10-11)
    const allowed = await api("PATCH", "/api/org/settings", alice, { allowFullAccess: true });
    expect(allowed.status, allowed.text).toBe(200);
    const erin = await signIn(ERIN);
    const created = await api("POST", "/api/bots", erin, { name: "Zed" });
    expect(created.status, created.text).toBe(201);
    const zed = created.body.bot;
    // no New bot policy saved: an organization's new bot starts on Ask
    expect(zed.approvalMode).toBe("ask");
    expect(zed.ownerUserId).toBe((await api("GET", "/api/auth/session", erin)).body.principalId);
    // an admin reaches a member's Direct only when it is shared with them
    expect((await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "custom" })).status).toBe(404);
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    expect((await api("POST", `/api/bots/${zed.id}/direct-grants`, erin, { userId: aliceId })).status).toBe(200);
    // Custom stays the org rule (2026-10-01: Full follows org-full-access.ts)
    expect((await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "custom" })).body.code).toBe("member_bot_full_access");
    // Full: the owner must confirm the warning once for this bot
    const unconfirmed = await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "full" });
    expect(unconfirmed.status, unconfirmed.text).toBe(409);
    expect(unconfirmed.body.code).toBe("full_access_confirm_required");
    // any other approval level stays outside a member's fields
    expect((await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "auto" })).status).toBe(403);
    // an admin is not the owner: never Full on someone else's bot
    const full = await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "full", confirmFullAccess: true });
    expect(full.status, full.text).toBe(403);
    expect(full.body.code).toBe("full_access_owner_only");
    expect((await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "custom" })).body.code).toBe("member_bot_full_access");
    expect((await api("GET", "/api/org/approvals", alice)).body).toEqual({ approvals: [] });
    expect((await api("GET", "/api/org/approvals", erin)).status).toBe(403);
  });

  it("S3-7b: a member's bot's card outside its workspace needs an admin; the owner's answer is 403", async () => {
    // the organization's key is back: erin's own turn runs on it
    expect((await api("PATCH", "/api/config", alice, { anthropic: { key: ORG_KEY } })).status).toBe(200);
    const erin = await signIn(ERIN);
    const wren = await createBot(erin, "Wren", "hold");
    const holdDump = join(home, "hold-dump.json");
    expect((await api("POST", `/api/bots/${wren.id}/messages`, erin, { text: "hold for cards" })).status).toBe(202);
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `s37b-${tool}-${sockets.length}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      const card = await waitFor(async () => {
        const got = await api("GET", `/api/threads/${wren.threadId}/messages?limit=100`, erin);
        return (got.body.messages as Array<{ card?: any }> | undefined)?.find((m) => m.card?.requestId === id)?.card ?? null;
      });
      return { id, card, answer: () => answer };
    };
    const respond = (auth: Auth, requestId: string, extra: Record<string, unknown> = {}) =>
      api("POST", `/api/threads/${wren.threadId}/respond`, auth, { requestId, behavior: "allow", ...extra });
    try {
      const data = realpathSync(join(home, ".sagax"));
      // the shared Claude settings (a hook there runs on every bot's next turn)
      const settings = await ask("Write", { file_path: join(data, ".claude", "settings.json"), content: "{\"hooks\":{}}" });
      expect(settings.card.adminApproval).toBe(true);
      expect(settings.card.allowSession).toBeUndefined();
      const refused = await respond(erin, settings.id);
      expect(refused.status, refused.text).toBe(403);
      expect(refused.body.code).toBe("admin_approval_required");
      expect(settings.answer()).toBeUndefined();
      // the workspace keys and the engines' credentials
      for (const [tool, input] of [
        ["Read", { file_path: join(data, "config.json") }],
        ["Edit", { file_path: join(data, ".claude", ".credentials.json"), old_string: "a", new_string: "b" }],
        ["Bash", { command: "cat /proc/1/environ" }],
      ] as const) {
        const card = await ask(tool, input);
        expect(card.card.adminApproval, tool).toBe(true);
        expect((await respond(erin, card.id)).body.code).toBe("admin_approval_required");
      }
      // an organization admin approves it, once
      expect((await respond(alice, settings.id, { always: true })).status).toBe(400);
      const approved = await respond(alice, settings.id);
      expect(approved.status, approved.text).toBe(200);
      await waitFor(async () => settings.answer()?.behavior === "allow");

      // a file inside the bot's own workspace is the owner's to approve, once
      const inside = await ask("Write", { file_path: join(data, "task-workspaces", wren.id, wren.threadId, "notes.md"), content: "hi" });
      expect(inside.card.adminApproval).toBeUndefined();
      expect(inside.card.allowSession).toBeUndefined();
      const owned = await respond(erin, inside.id);
      expect(owned.status, owned.text).toBe(200);
      await waitFor(async () => inside.answer()?.behavior === "allow");
    } finally {
      for (const socket of sockets) socket.destroy();
      await api("POST", `/api/bots/${wren.id}/interrupt`, erin, {});
    }
  }, 60_000);

  it("S3-7c: list_bots runs for a member without an admin; a server command reaches the admins live and their answer releases it", async () => {
    const erin = await signIn(ERIN);
    const bram = await createBot(erin, "Bram", "hold");
    const holdDump = join(home, "hold-dump.json");
    rmSync(holdDump, { force: true });
    const adminStream = await openStream(alice);
    const memberStream = await openStream(erin);
    expect((await api("POST", `/api/bots/${bram.id}/messages`, erin, { text: "which bots do you see" })).status).toBe(202);
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    const send = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `s37c-${tool}-${sockets.length}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      return { id, answer: () => answer };
    };
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const { id, answer } = await send(tool, input);
      const card = await waitFor(async () => {
        const got = await api("GET", `/api/threads/${bram.threadId}/messages?limit=100`, erin);
        return (got.body.messages as Array<{ card?: any }> | undefined)?.find((m) => m.card?.requestId === id)?.card ?? null;
      });
      return { id, card, answer };
    };
    const respond = (auth: Auth, requestId: string) =>
      api("POST", `/api/threads/${bram.threadId}/respond`, auth, { requestId, behavior: "allow" });
    try {
      // a built-in read in the member's own scope: no admin, and since
      // 2026-10-16 no card either (server/sagax-internal-tools.ts)
      const list = await send("mcp__agents__list_bots", {});
      await waitFor(async () => list.answer()?.behavior === "allow");

      // a command on the server waits for an admin and says who
      const shell = await ask("Bash", { command: "cat /etc/hostname" });
      expect(shell.card.adminApproval).toBe(true);
      expect(shell.card.adminNames).toContain("Alice");
      expect((await respond(erin, shell.id)).body.code).toBe("admin_approval_required");
      // every admin's stream hears of it at once; a member's never does
      await waitFor(async () => adminStream.text().includes(`"kind":"org.approvals"`) && adminStream.text().includes(shell.id));
      expect(memberStream.text()).not.toContain(`"kind":"org.approvals"`);
      const waiting = (await api("GET", "/api/org/approvals", alice)).body.approvals as Array<Record<string, unknown>>;
      expect(waiting.find((entry) => entry.requestId === shell.id)).toMatchObject({ botName: "Bram", ownerName: "Erin", requestedBy: "Erin", tool: "Bash" });
      expect(waiting.some((entry) => entry.requestId === list.id)).toBe(false);

      // the admin's Allow releases the member's turn and settles the card for both
      const approved = await respond(alice, shell.id);
      expect(approved.status, approved.text).toBe(200);
      await waitFor(async () => shell.answer()?.behavior === "allow");
      await waitFor(async () => {
        const got = await api("GET", `/api/threads/${bram.threadId}/messages?limit=100`, erin);
        return Boolean((got.body.messages as Array<{ card?: any }>).find((m) => m.card?.requestId === shell.id)?.card?.answered);
      });
      await waitFor(async () => /"kind":"org.approvals","count":0/.test(adminStream.text()));
      expect(((await api("GET", "/api/org/approvals", alice)).body.approvals as Array<{ requestId: string }>).some((entry) => entry.requestId === shell.id)).toBe(false);
    } finally {
      for (const socket of sockets) socket.destroy();
      adminStream.close();
      memberStream.close();
      await api("POST", `/api/bots/${bram.id}/interrupt`, erin, {});
    }
  }, 60_000);

  it("S3-7d (2026-10-14): a member's bot asks its owner, never an admin, for what stays in the owner's rights; rules, modes and the admin route", async () => {
    const erin = await signIn(ERIN);
    const cora = await createBot(erin, "Cora", "hold");
    const holdDump = join(home, "hold-dump.json");
    rmSync(holdDump, { force: true });
    expect((await api("POST", `/api/bots/${cora.id}/messages`, erin, { text: "update my tickets" })).status).toBe(202);
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    // ask, then either a card shows up or the answer comes back without one
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `s37d-${sockets.length}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      const settled = await waitFor(async () => {
        if (answer) return { card: null as any };
        const got = await api("GET", `/api/threads/${cora.threadId}/messages?limit=200`, erin);
        const card = (got.body.messages as Array<{ card?: any }> | undefined)?.find((m) => m.card?.requestId === id)?.card;
        return card ? { card } : null;
      });
      return { id, card: settled.card, answer: () => answer };
    };
    const respond = (auth: Auth, requestId: string, extra: Record<string, unknown> = {}) =>
      api("POST", `/api/threads/${cora.threadId}/respond`, auth, { requestId, behavior: "allow", ...extra });
    const CW = "mcp__perspicax_gox__cw_psa__write";
    try {
      // a ConnectWise write through Perspicax (the owner's own tokens): the owner's card
      const first = await ask(CW, { resource: "service/tickets/41", operation: "update", body: { status: "In progress" } });
      expect(first.card, "a card for the owner").toBeTruthy();
      expect(first.card.adminApproval).toBeUndefined();
      expect(first.card.ownerRule).toMatchObject({ tool: "perspicax_gox__cw_psa__write", scope: { resource: "service/tickets", operation: "update" } });
      // never in an admin's queue
      expect(((await api("GET", "/api/org/approvals", alice)).body.approvals as Array<{ requestId: string }>).some((row) => row.requestId === first.id)).toBe(false);
      // an admin cannot answer, or save a rule on, someone else's owner card
      expect([403, 404]).toContain((await respond(alice, first.id, { rule: "allow" })).status);
      // a rule must agree with the answer
      expect((await respond(erin, first.id, { behavior: "deny", rule: "allow" })).status).toBe(400);
      // Always allow: saved for Erin, then the answer goes out
      const saved = await respond(erin, first.id, { rule: "allow" });
      expect(saved.status, saved.text).toBe(200);
      await waitFor(async () => first.answer()?.behavior === "allow");
      const mine = (await api("GET", "/api/approval-rules", erin)).body.rules as Array<Record<string, any>>;
      expect(mine).toEqual([expect.objectContaining({ botId: cora.id, behavior: "allow", scope: { resource: "service/tickets", operation: "update" } })]);
      // kept per person: Alice (an admin) has none of Erin's rules
      expect((await api("GET", "/api/approval-rules", alice)).body.rules).toEqual([]);

      // the same kind of call no longer asks
      const again = await ask(CW, { resource: "service/tickets/77", operation: "update", body: { status: "Waiting" } });
      expect(again.card).toBeNull();
      expect(again.answer()?.behavior).toBe("allow");

      // a delete is destructive: the allow rule does not cover it
      const del = await ask(CW, { resource: "service/tickets/77", operation: "delete" });
      expect(del.card).toBeTruthy();
      expect(del.card.ownerRule.destructive).toBe("delete");
      // Always deny: refused now and from then on, without a card
      expect((await respond(erin, del.id, { behavior: "deny", rule: "deny" })).status).toBe(200);
      await waitFor(async () => del.answer()?.behavior === "deny");
      const delAgain = await ask(CW, { resource: "service/tickets/78", operation: "delete" });
      expect(delAgain.card).toBeNull();
      expect(delAgain.answer()?.behavior).toBe("deny");

      // modes: the owner's only
      expect([403, 404]).toContain((await api("PUT", `/api/bots/${cora.id}/permission-mode`, alice, { mode: "auto" })).status);
      expect((await api("GET", `/api/bots/${cora.id}/permission-mode`, erin)).body.mode).toBe("approval");
      expect((await api("PUT", `/api/bots/${cora.id}/permission-mode`, erin, { mode: "auto" })).status).toBe(200);
      const schedule = await ask(CW, { resource: "schedule/entries", operation: "create", body: {} });
      expect(schedule.card).toBeNull();
      expect(schedule.answer()?.behavior).toBe("allow");
      // an edited rule: only its owner edits it; Ask every time keeps a card even in auto
      const ruleIdEarly = mine[0]!.id as string;
      expect((await api("PATCH", `/api/approval-rules/${ruleIdEarly}`, alice, { behavior: "ask" })).status).toBe(404);
      const toAsk = await api("PATCH", `/api/approval-rules/${ruleIdEarly}`, erin, { behavior: "ask" });
      expect(toAsk.status, toAsk.text).toBe(200);
      expect(toAsk.body.rule).toMatchObject({ behavior: "ask", scope: { resource: "service/tickets", operation: "update" } });
      const askRule = await ask(CW, { resource: "service/tickets/80", operation: "update", body: {} });
      expect(askRule.card, "an Ask every time rule still asks in auto").toBeTruthy();
      expect((await respond(erin, askRule.id)).status).toBe(200);
      await waitFor(async () => askRule.answer()?.behavior === "allow");
      expect((await api("PATCH", `/api/approval-rules/${ruleIdEarly}`, erin, { behavior: "allow" })).status).toBe(200);
      // auto still asks for a destructive call no rule covers
      const bulk = await ask(CW, { resource: "service/tickets", operation: "update", ids: [1, 2, 3], body: { status: "Closed" } });
      expect(bulk.card?.ownerRule?.destructive).toBe("bulk");
      expect((await respond(erin, bulk.id, { behavior: "deny" })).status).toBe(200);

      // bypass needs an explicit confirmation
      const unconfirmed = await api("PUT", `/api/bots/${cora.id}/permission-mode`, erin, { mode: "bypass" });
      expect(unconfirmed.status).toBe(400);
      expect(unconfirmed.body.code).toBe("bypass_confirmation_required");
      // and the organization's Full access policy: off, Bypass stays off
      expect((await api("PATCH", "/api/org/settings", alice, { allowFullAccess: false })).status).toBe(200);
      const policyOff = await api("PUT", `/api/bots/${cora.id}/permission-mode`, erin, { mode: "bypass", confirmBypass: true });
      expect(policyOff.status).toBe(403);
      expect(policyOff.body.code).toBe("bypass_not_allowed");
      expect((await api("GET", `/api/bots/${cora.id}/permission-mode`, erin)).body.canBypass).toBe(false);
      expect((await api("PATCH", "/api/org/settings", alice, { allowFullAccess: true })).status).toBe(200);
      expect((await api("PUT", `/api/bots/${cora.id}/permission-mode`, erin, { mode: "bypass", confirmBypass: true })).status).toBe(200);
      const project = await ask(CW, { resource: "project/projects", operation: "update", body: {} });
      expect(project.card).toBeNull();
      expect(project.answer()?.behavior).toBe("allow");
      // bypass asks nothing but writes every approval to the journal
      const journal = join(realpathSync(join(home, ".sagax")), "decisions");
      await waitFor(async () => existsSync(journal) && readdirSync(journal).some((file) =>
        readFileSync(join(journal, file), "utf8").split("\n").some((line) => line.includes(`"requestId":"${project.id}"`) && line.includes(`"source":"owner-bypass"`))));
      // no mode reaches past the owner's rights: a server command still waits for an admin
      const shell = await ask("Bash", { command: "cat /etc/hostname" });
      expect(shell.card.adminApproval).toBe(true);
      // #855: the card carries an admin-kind rule, never one the owner could keep
      expect(shell.card.ownerRule?.from).toBe("admin");
      expect((await respond(erin, shell.id, { rule: "allow" })).status).toBe(403);
      // #855: an admin may keep Always allow on the admin card (an admin rule)
      expect((await respond(alice, shell.id, { rule: "allow" })).status).toBe(200);
      await waitFor(async () => shell.answer()?.behavior === "allow");

      // revoke: the rule goes, the next ticket update asks again (back on approval)
      expect((await api("PUT", `/api/bots/${cora.id}/permission-mode`, erin, { mode: "approval" })).status).toBe(200);
      const ruleId = mine[0]!.id as string;
      expect((await api("DELETE", `/api/approval-rules/${ruleId}`, alice)).status).toBe(404);
      expect((await api("DELETE", `/api/approval-rules/${ruleId}`, erin)).status).toBe(200);
      const asksAgain = await ask(CW, { resource: "service/tickets/90", operation: "update", body: {} });
      expect(asksAgain.card).toBeTruthy();
      expect((await respond(erin, asksAgain.id)).status).toBe(200);
    } finally {
      for (const socket of sockets) socket.destroy();
      await api("POST", `/api/bots/${cora.id}/interrupt`, erin, {});
    }
  }, 90_000);

  it("S3-10: a person disabled in Perspicax is logged out by the directory, with no back-channel push", async () => {
    const dave = await signIn(DAVE);
    expect((await api("GET", "/api/auth/session", dave)).status).toBe(200);
    idp.setDirectoryStatus(DAVE.sub, "disabled");
    await waitFor(async () => (await api("GET", "/api/auth/session", dave)).status === 401, 15_000);
    const people = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; disabled: boolean }>;
    expect(people.find((p) => p.principalId === daveId)?.disabled).toBe(true);
    // a disabled person cannot be granted
    expect((await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: daveId })).body.code).toBe("unknown_person");
  }, 30_000);
});
