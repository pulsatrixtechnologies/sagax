// A member of the organization (not an admin) on a Sagax server joined to
// Perspicax, through the real server against the fake Perspicax and the
// fake Claude and Codex CLIs (2026-10-02 owner report):
//
//   MA-1  a member reads the server's engines (GET /api/instances) without
//         anything of the server's own account, path or install: Model
//         providers and the model picker draw from it
//   MA-2  a member signs in to their own Codex subscription and talks to a
//         bot an admin shared with them; their subscription pays
//   MA-3  Perspicax's sagax_bots "use" (an admin's choice): the person uses
//         the bots shared with them, creates, imports, edits and deletes none
//         (even their own, even with an edit grant), schedules no routine;
//         back to "manage" restores it; an admin is never narrowed
//   MA-4  create_bot on the internal capability belongs to the Primary Bot's
//         person (not the operator); sagax_bots "use" refuses that path too
//   MA-5  Settings > Usage > Plan usage reads the asking person's own
//         subscription login only: never the server's own login, never
//         another person's; one row per provider; the org key is an API-key
//         row with no plan windows (no network: only states that fetch nothing)
//   MA-7  (2026-10-26) a member saves Always allow on a card of her own
//         bot; another member cannot on hers
//   MA-8  (2026-10-26) a member's Primary Bot on Approve for me applies her
//         own team setup and bot deletion on her own turn; another person's
//         turn keeps the card, and someone else's bot stays out of reach
//   MA-9  (2026-10-26) a member's bot on Full access adds a remote MCP server
//         switched on; a command (it would run on the shared server) stays off
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_CODEX_LOGIN = join(SERVER_DIR, "testing", "fake-codex-login-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE: FakeOidcUser = { sub: "01J9MAALICE000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9MABOB0000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const UMA: FakeOidcUser = { sub: "01J9MAUMA0000000000000U", name: "Uma", preferred_username: "uma", role: "employee", teams: [] };
const READ_ONLY = "org_bots_read_only";
const CAPABILITY_KEY = "org-member-access-fixture-capability";

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
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

/** A sign-in refreshes the directory, but fire and forget, and a call while
 * one refresh runs joins it (perspicax-link.ts): the first session after a
 * directory change can still carry the old rights. Sign in again until the
 * viewer shows the change. */
async function signInUntil(user: FakeOidcUser, ready: (viewer: Record<string, unknown>) => boolean): Promise<Auth> {
  return waitFor(async () => {
    const auth = await signIn(user);
    return ready((await api("GET", "/api/config", auth)).body.viewer) ? auth : null;
  });
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

const botIds = async (auth: Auth) => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string }> ?? []).map((b) => b.id);
const botOf = async (auth: Auth, id: string) => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; messages: Array<{ kind: string; role: string; text?: string; access?: any }> }>).find((b) => b.id === id);

async function createBot(auth: Auth, name: string, instanceId: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, auth, { modelSelection: { instanceId, model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  return { id: created.body.bot.id, threadId: created.body.bot.threadId };
}

async function start() {
  child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      // engines/bin holds the one CLI the image manifest below "installed"
      PATH: [join(home, "engines", "bin"), process.env.PATH].filter(Boolean).join(":"),
      SAGAX_ENGINES_MANIFEST: join(home, "engines", "manifest.json"),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      // the directory refreshes at boot and at every sign-in only, so each
      // path (directory, refreshed id_token) is proven on its own
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_OIDC_REFRESH_AFTER_SECONDS: "2",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
      SAGAX_ORG_NAME: "Acme",
      // MA-9: a member's own MCP servers at a local address (no DNS in tests)
      SAGAX_PERSONAL_MCP_ALLOW_PRIVATE: "1",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
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

function setUma(rights: "manage" | "use" | undefined) {
  idp.directoryPeople = [ALICE, BOB, UMA].map((user) => ({
    ...idp.personOf(user),
    ...(user === UMA && rights ? { sagax_bots: rights } : {}),
  }));
}

posixOnly("Perspicax organization: a member's own engines and read-only bots", () => {
  let alice: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_CODEX_LOGIN, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    setUma(undefined);
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-member-access-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    // The image's engines manifest (scripts/install-engines.mjs): Qwen Code
    // baked in, Cursor deliberately not (engines.lock.json notPreinstalled).
    mkdirSync(join(home, "engines", "bin"), { recursive: true });
    writeFileSync(join(home, "engines", "bin", "qwen"), "#!/bin/sh\necho 0.24.7\n", { mode: 0o755 });
    writeFileSync(join(home, "engines", "manifest.json"), JSON.stringify({
      lockVersion: 1, engineSet: "all", arch: "arm64",
      installed: [{ id: "qwen", name: "Qwen Code", drivers: ["qwenAgent"], kind: "npm", version: "0.24.7", bin: "qwen" }],
      notPreinstalled: [{ id: "cursor", name: "Cursor Agent", drivers: ["cursorAgent"], reason: "Cursor is not carried by this test image." }],
    }));
    dump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dump }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        codex: { driver: "codex", environment: { SAGAX_DEVICE_AUTH_FIXTURE: "1" }, config: { cli: FAKE_CODEX_LOGIN } },
        // absent on this server whatever the machine has installed
        cursor: { driver: "cursorAgent", config: { cli: "sagax-test-no-such-cursor-agent" } },
      },
      // Full access is off until an admin turns it on (2026-10-11); MA-5 tests the read-only rule on top of an allowed policy
      organization: { allowFullAccess: true },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("MA-1: a member reads the server's engines without the server's account", async () => {
    const bob = await signIn(BOB);
    const mine = await api("GET", "/api/instances", bob);
    expect(mine.status, mine.text).toBe(200);
    const rows = mine.body.instances as Array<Record<string, any>>;
    expect(rows.map((row) => row.instanceId).sort()).toEqual(expect.arrayContaining(["claude", "codex"]));
    for (const row of rows) {
      for (const field of ["cli", "cliDefault", "cliCandidates", "claudeAccount", "install", "authentication", "freeUpSpace", "managed"]) expect(row[field], field).toBeUndefined();
      expect(row.snapshot.account).toBeUndefined();
      expect(row.snapshot.authenticated).toBeUndefined();
      expect(Array.isArray(row.models?.options)).toBe(true);
    }
    expect(mine.text).not.toContain(FAKE_CLAUDE);
    expect(mine.text).not.toContain(home);
    // the admin still reads the whole row
    const admin = (await api("GET", "/api/instances", alice)).body.instances as Array<Record<string, any>>;
    expect(admin.find((row) => row.instanceId === "codex")?.cli).toBe(FAKE_CODEX_LOGIN);
    // and a member changes nothing there
    expect((await api("PATCH", "/api/instances/codex", bob, { cli: "" })).status).toBe(403);
  }, 60_000);

  it("MA-1b: the image's engines answer from the startup self-check, the ones it leaves out read not available", async () => {
    await waitFor(async () => log.includes("[engines] self-check:"));
    expect(log).toContain("[engines] qwen: 0.24.7 (pinned 0.24.7, ");
    expect(log).toContain("[engines] self-check: 1/1 preinstalled engine(s) start (image set all)");
    const bob = await signIn(BOB);
    const engines = (await api("GET", "/api/me/engines", bob)).body.engines as Array<Record<string, any>>;
    expect(engines.find((engine) => engine.instanceId === "qwen")).toMatchObject({ installed: true });
    expect(engines.find((engine) => engine.instanceId === "qwen")?.notAvailable).toBeUndefined();
    await waitFor(async () => {
      const rows = (await api("GET", "/api/me/engines", bob)).body.engines as Array<Record<string, any>>;
      return rows.find((engine) => engine.instanceId === "cursor")?.installed === false;
    });
    const cursor = ((await api("GET", "/api/me/engines", bob)).body.engines as Array<Record<string, any>>).find((engine) => engine.instanceId === "cursor");
    expect(cursor).toMatchObject({ installed: false, notAvailable: "Cursor is not carried by this test image." });
    const health = (await api("GET", "/api/health", alice)).body.engines as Array<Record<string, any>>;
    expect(health.find((engine) => engine.instanceId === "qwen")).toMatchObject({ installed: true, version: "0.24.7" });
  }, 60_000);

  it("MA-2: a member signs in to their own Codex subscription and talks to a shared bot with it", async () => {
    const shared = await createBot(alice, "Shared", "codex");
    expect((await api("PUT", `/api/bots/${shared.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    const bob = await signIn(BOB);
    expect((await api("GET", "/api/me/engines", bob)).body.engines.find((e: { instanceId: string }) => e.instanceId === "codex")).toMatchObject({ subscription: { supported: true, signedIn: false }, myTurns: "none" });
    const started = await api("POST", "/api/me/engines/codex/login/start", bob, {});
    expect(started.status, started.text).toBe(200);
    const flowId = started.body.auth.flowId as string;
    writeFileSync(join(home, ".omb-fake-codex-login-approved"), "yes");
    await waitFor(async () => (await api("GET", `/api/me/engines/codex/login/status?flowId=${encodeURIComponent(flowId)}`, bob)).body.auth?.phase === "succeeded", 20_000);
    expect((await api("GET", "/api/me/engines", bob)).body.engines.find((e: { instanceId: string }) => e.instanceId === "codex")).toMatchObject({ subscription: { signedIn: true }, myTurns: "subscription" });
    // never the admin's: alice is still signed out of Codex
    expect((await api("GET", "/api/me/engines", alice)).body.engines.find((e: { instanceId: string }) => e.instanceId === "codex")).toMatchObject({ subscription: { signedIn: false } });
    const sent = await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "hello from bob" });
    expect(sent.status, sent.text).toBe(202);
    const reply = await waitFor(async () => (await botOf(bob, shared.id))?.messages.find((m) => m.role === "bot" && m.kind === "text" && m.text) ?? null, 30_000);
    expect(reply.text).toBeTruthy();
    expect((await botOf(bob, shared.id))?.messages.some((m) => m.kind === "access")).toBe(false);
    const digest = await waitFor(async () => (await botOf(bob, shared.id))?.messages.find((m) => m.kind === "digest" && (m as { digest?: { access?: unknown } }).digest?.access) ?? null, 15_000);
    expect((digest as unknown as { digest: { access: unknown } }).digest.access).toMatchObject({ via: "subscription", payer: "speaker", payerPrincipalId: ids.bob });
    expect((await api("POST", "/api/me/engines/codex/login/sign-out", bob, {})).status).toBe(200);
    expect((await api("GET", "/api/me/engines", bob)).body.engines.find((e: { instanceId: string }) => e.instanceId === "codex")).toMatchObject({ subscription: { signedIn: false } });
  }, 90_000);

  it("MA-3: sagax_bots use makes a person read-only; manage restores it; admins keep theirs", async () => {
    // Uma made a bot while she could; then Alice shares one with her at edit
    let uma = await signIn(UMA);
    expect((await api("GET", "/api/config", uma)).body.viewer).toMatchObject({ canCreateBots: true });
    const own = await createBot(uma, "Uma's", "claude");
    const shared = await createBot(alice, "Edit me", "claude");
    expect((await api("PUT", `/api/bots/${shared.id}/grants`, alice, { target: `user:${ids.uma}`, level: "edit" })).status).toBe(200);

    setUma("use");
    uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly === true);
    const viewer = (await api("GET", "/api/config", uma)).body.viewer;
    expect(viewer).toMatchObject({ canCreateBots: false, botsReadOnly: true });
    const created = await api("POST", "/api/bots", uma, { name: "Nope" });
    expect(created.status).toBe(403);
    expect(created.body.error).toBe(READ_ONLY);
    expect((await api("POST", "/api/org/import", uma, { bots: [] })).status).toBe(403);
    // edits, deletes, grants and routines: refused on her own bot and on the shared one
    for (const id of [own.id, shared.id]) {
      expect((await api("PATCH", `/api/bots/${id}`, uma, { name: "Renamed" })).status, id).toBe(403);
      expect((await api("PUT", `/api/bots/${id}/grants`, uma, { target: `user:${ids.bob}`, level: "use" })).status, id).toBe(403);
      expect((await api("POST", "/api/routines", uma, { name: "Daily", botId: id, prompt: "Report.", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } })).status, id).toBe(403);
    }
    expect((await api("DELETE", `/api/bots/${own.id}`, uma)).status).toBe(403);
    // still uses both: they are listed and she talks to them (the
    // organization key pays her turns here)
    const listed = await botIds(uma);
    expect(listed).toEqual(expect.arrayContaining([own.id, shared.id]));
    expect((await api("POST", `/api/bots/${shared.id}/messages`, uma, { text: "read-only hello" })).status).toBe(202);
    await waitFor(async () => (await botOf(uma, shared.id))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    // an admin is never narrowed by the field
    idp.directoryPeople = idp.directoryPeople.map((person) => (person.sub === ALICE.sub ? { ...person, sagax_bots: "use" as const } : person));
    alice = await signIn(ALICE);
    expect((await api("GET", "/api/config", alice)).body.viewer).toMatchObject({ canCreateBots: true });
    expect((await api("PATCH", `/api/bots/${shared.id}`, alice, { name: "Edited" })).status).toBe(200);

    setUma("manage");
    uma = await signInUntil(UMA, (viewer) => !viewer.botsReadOnly);
    expect((await api("GET", "/api/config", uma)).body.viewer).toMatchObject({ canCreateBots: true });
    expect((await api("GET", "/api/config", uma)).body.viewer.botsReadOnly).toBeFalsy();
    expect((await api("PATCH", `/api/bots/${shared.id}`, uma, { name: "Edited by Uma" })).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${own.id}`, uma)).status).toBe(200);
  }, 120_000);

  it("MA-4: create_bot belongs to the Primary Bot's person; use refuses it", async () => {
    let uma = await signIn(UMA);
    const chief = await createBot(uma, "Uma Chief", "claude");
    expect((await api("POST", `/api/bots/${chief.id}/primary`, uma, {})).status).toBe(200);

    // A capability minted for the Primary Bot's thread, as the agents proxy
    // holds during a turn (the fake turn ends before a dumped token is used).
    const tokenOf = async (): Promise<string> => {
      const res = await fetch(`${BASE}/api/testing/internal-capability`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
        body: JSON.stringify({ botId: chief.id, threadId: chief.threadId }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { token: string }).token;
    };
    const createSpecialist = async (token: string, name: string) => {
      const res = await fetch(`${BASE}/api/internal/create-bot`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          fromBotId: chief.id, fromThreadId: chief.threadId, name,
          role: "Ops", instructions: "Help Uma.",
        }),
      });
      return { status: res.status, body: await res.json() as { id?: string; error?: string } };
    };

    const made = await createSpecialist(await tokenOf(), "Uma Scout");
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const orgBots = (await api("GET", "/api/org/bots", alice)).body.bots as Array<{ name: string; ownerPrincipalId: string }>;
    expect(orgBots.find((bot) => bot.name === "Uma Scout")?.ownerPrincipalId).toBe(ids.uma);

    setUma("use");
    uma = await signIn(UMA);
    const refused = await createSpecialist(await tokenOf(), "Uma Denied");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(READ_ONLY);
    expect((await api("GET", "/api/org/bots", alice)).body.bots.some((bot: { name: string }) => bot.name === "Uma Denied")).toBe(false);
  }, 90_000);

  it("MA-4b: any bot of a member creates a bot for her, from her own request only (2026-10-17)", async () => {
    setUma("manage");
    const uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true && viewer.canCreateBots === true);
    const maker = await createBot(uma, "Uma Maker", "claude");
    const capability = async (botId: string, threadId: string, speakerPrincipalId?: string): Promise<string> => {
      const res = await fetch(`${BASE}/api/testing/internal-capability`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
        body: JSON.stringify({ botId, threadId, ...(speakerPrincipalId ? { speakerPrincipalId } : {}) }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { token: string }).token;
    };
    const create = async (from: { id: string; threadId: string }, token: string, name: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch(`${BASE}/api/internal/create-bot`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ fromBotId: from.id, fromThreadId: from.threadId, name, role: "Ops", instructions: "Help Uma.", ...extra }),
      });
      return { status: res.status, body: await res.json() as { id?: string; threadId?: string; error?: string; code?: string } };
    };
    const orgBots = async () => (await api("GET", "/api/org/bots", alice)).body.bots as Array<{ id: string; name: string; ownerPrincipalId: string }>;

    // another person speaking to Uma's bot, or a turn nobody wrote, creates nothing
    expect((await create(maker, await capability(maker.id, maker.threadId, ids.bob), "Bob Asked")).body.code).toBe("not_owner_turn");
    expect((await create(maker, await capability(maker.id, maker.threadId), "Nobody Asked")).body.code).toBe("not_owner_turn");
    // 2026-10-28 (#1098, member-folders.ts): a member names a working folder
    // without any permission, as long as it is in her own roots on the
    // server's disk; a folder outside them (the server's home) is refused
    const folder = await create(maker, await capability(maker.id, maker.threadId, ids.uma), "Uma Folder", { cwd: home });
    expect(folder.status, JSON.stringify(folder.body)).toBe(403);
    expect(folder.body.code).toBe("folder_outside_own_space");
    const ownFolder = join(home, ".sagax", "person-folders", createHash("sha256").update(ids.uma!.trim().toLowerCase()).digest("hex").slice(0, 32));
    mkdirSync(ownFolder, { recursive: true, mode: 0o700 });
    const inOwn = await create(maker, await capability(maker.id, maker.threadId, ids.uma), "Uma Own Folder", { cwd: ownFolder });
    expect(inOwn.status, JSON.stringify(inOwn.body)).toBe(201);
    expect((await orgBots()).find((bot) => bot.name === "Uma Own Folder")?.ownerPrincipalId).toBe(ids.uma);

    // Uma's own request: the bot is hers, locked down like a Primary Bot's
    const made = await create(maker, await capability(maker.id, maker.threadId, ids.uma), "Uma Helper");
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await orgBots()).find((bot) => bot.name === "Uma Helper")?.ownerPrincipalId).toBe(ids.uma);
    const helper = ((await api("GET", "/api/bots", uma)).body.bots as Array<Record<string, any>>).find((bot) => bot.id === made.body.id)!;
    expect(helper).toMatchObject({ autoApprove: false, approvePeerComms: false });
    expect(helper.approvalMode).not.toBe("full");
    expect(helper.chiefOfStaff ?? false).toBe(false);
    expect(helper).not.toHaveProperty("createdByBot");

    // the bot Uma's bot made cannot make another, even from her own request
    const deeper = await create({ id: helper.id, threadId: helper.threadId }, await capability(helper.id, helper.threadId, ids.uma), "Uma Grandchild");
    expect(deeper.status, JSON.stringify(deeper.body)).toBe(409);
    expect(deeper.body.code).toBe("too_deep");
    expect((await orgBots()).some((bot) => ["Bob Asked", "Nobody Asked", "Uma Folder", "Uma Grandchild"].includes(bot.name))).toBe(false);
  }, 90_000);

  it("MA-5: sagax_bots use cannot grant Full access or change the bot's default model", async () => {
    // Uma owns a bot from when she could manage one. Read-only must not
    // raise its approval level or rewrite its default model. A thread title
    // is conversation use and stays allowed. An admin is never narrowed.
    setUma("manage");
    let uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true && viewer.canCreateBots === true);
    const own = await createBot(uma, "Uma Full", "claude");

    setUma("use");
    uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly === true);
    const botFull = await api("PATCH", `/api/bots/${own.id}`, uma, { approvalMode: "full", confirmFullAccess: true });
    expect(botFull.status, botFull.text).toBe(403);
    expect(botFull.body.error).toBe(READ_ONLY);
    const threadFull = await api("PATCH", `/api/bots/${own.id}/tasks/${own.threadId}`, uma, { approvalMode: "full", confirmFullAccess: true });
    expect(threadFull.status, threadFull.text).toBe(403);
    expect(threadFull.body.error).toBe(READ_ONLY);
    const changedDefault = await api("PATCH", `/api/bots/${own.id}/tasks/${own.threadId}`, uma, {
      modelSelection: { instanceId: "codex", model: "fake-model" }, updateBotDefault: true,
    });
    expect(changedDefault.status, changedDefault.text).toBe(403);
    expect(changedDefault.body.error).toBe(READ_ONLY);

    const stored = ((await api("GET", "/api/bots", uma)).body.bots as Array<{ id: string; approvalMode?: string; fullAccessConsent?: unknown; modelSelection?: { instanceId: string } }>).find((bot) => bot.id === own.id);
    expect(stored?.approvalMode).not.toBe("full");
    expect(stored?.fullAccessConsent).toBeFalsy();
    expect(stored?.modelSelection?.instanceId).toBe("claude");
    expect((await api("PATCH", `/api/bots/${own.id}/tasks/${own.threadId}`, uma, { title: "Still mine" })).status).toBe(200);

    idp.directoryPeople = idp.directoryPeople.map((person) => (person.sub === ALICE.sub ? { ...person, sagax_bots: "use" as const } : person));
    alice = await signIn(ALICE);
    const adminBot = await createBot(alice, "Alice Full", "claude");
    const adminFull = await api("PATCH", `/api/bots/${adminBot.id}`, alice, { approvalMode: "full", confirmFullAccess: true });
    expect(adminFull.status, adminFull.text).toBe(200);

    setUma("manage");
    uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true);
    const restored = await api("PATCH", `/api/bots/${own.id}`, uma, { approvalMode: "full", confirmFullAccess: true });
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body.bot.approvalMode).toBe("full");
  }, 90_000);

  it("MA-6: sagax_bots use cannot add or remove a direct grant", async () => {
    setUma("manage");
    let uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true && viewer.canCreateBots === true);
    const own = await createBot(uma, "Uma Shares", "claude");
    const added = await api("POST", `/api/bots/${own.id}/direct-grants`, uma, { userId: ids.bob });
    expect(added.status, added.text).toBe(200);
    expect(added.body.directGrants).toContain(ids.bob);

    setUma("use");
    uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly === true);
    const again = await api("POST", `/api/bots/${own.id}/direct-grants`, uma, { userId: ids.bob });
    expect(again.status, again.text).toBe(403);
    expect(again.body.error).toBe(READ_ONLY);
    const removed = await api("DELETE", `/api/bots/${own.id}/direct-grants/${encodeURIComponent(ids.bob)}`, uma);
    expect(removed.status, removed.text).toBe(403);
    expect(removed.body.error).toBe(READ_ONLY);
    const stored = ((await api("GET", "/api/bots", uma)).body.bots as Array<{ id: string; directGrants?: string[] }>).find((bot) => bot.id === own.id);
    expect(stored?.directGrants).toContain(ids.bob);
  }, 90_000);

  it("MA-5: plan usage reads the person's own subscription, never the server's or another person's", async () => {
    const expiredJwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 600 })).toString("base64url")}.s`;
    // The server's own Codex and Claude logins: an expired token next to a
    // refresh token would show "renews on the next turn" if they were read.
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: expiredJwt, refresh_token: "server-refresh" } }));
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "server-claude", expiresAt: Date.now() - 600_000, refreshToken: "server-refresh" } }));
    // Bob's own Codex sign-in, where the login flow leaves it.
    const bobCodex = join(home, ".sagax", "principals", ids.bob!, "codex");
    mkdirSync(bobCodex, { recursive: true, mode: 0o700 });
    writeFileSync(join(bobCodex, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    writeFileSync(join(bobCodex, "auth.json"), JSON.stringify({ tokens: { access_token: expiredJwt, refresh_token: "bob-refresh" } }), { mode: 0o600 });

    type Row = { id: string; state: string; access: string; instanceId: string | null; failure: { kind: string } | null };
    const rowsOf = async (auth: Auth) => {
      const got = await api("GET", "/api/plan-usage?refresh=1", auth);
      expect(got.status, got.text).toBe(200);
      expect(got.text).not.toMatch(/server-claude|server-refresh|bob-refresh/);
      return got.body.providers as Row[];
    };
    // a member reads their own
    const bob = await signIn(BOB);
    const bobs = await rowsOf(bob);
    expect(bobs.map((row) => [row.id, row.state, row.failure?.kind ?? null])).toEqual([
      ["claude", "signed-out", null],
      ["codex", "error", "renewing"],
      ["claudeApi", "no-windows", null],
    ]);
    expect(bobs.find((row) => row.id === "claude")?.instanceId).toBe("claude");
    // the admin has no Codex sign-in of their own: not the server's, not Bob's
    const alices = await rowsOf(alice);
    expect(alices.map((row) => [row.id, row.state])).toEqual([
      ["claude", "signed-out"],
      ["codex", "signed-out"],
      ["claudeApi", "no-windows"],
    ]);
  }, 60_000);

  const mint = async (botId: string, threadId: string, speakerPrincipalId?: string): Promise<string> => {
    const res = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId, threadId, ...(speakerPrincipalId ? { speakerPrincipalId } : {}) }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { token: string }).token;
  };
  const internal = async (token: string, path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };

  it("MA-7: a member saves Always allow on her own bot's card; another member cannot (2026-10-26)", async () => {
    setUma("manage");
    const uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true);
    const bob = await signIn(BOB);
    const asker = await createBot(bob, "Bob Asker", "claude");
    const peer = await createBot(bob, "Bob Peer", "claude");
    expect((await api("PATCH", `/api/bots/${asker.id}`, bob, { approvePeerComms: true })).status).toBe(200);
    const asked = internal(await mint(asker.id, asker.threadId, ids.bob), "/api/internal/ask-bot", { toBotId: peer.id, message: "Check the report." });
    const card = await waitFor(async () => ((await api("GET", `/api/threads/${asker.threadId}/messages`, bob)).body.messages as Array<{ card?: any }> ?? [])
      .find((message) => message.card?.allowKey && !message.card.answered)?.card);
    // someone else's bot: refused
    const foreign = await api("POST", `/api/bots/${asker.id}/always-allow`, uma, { threadId: asker.threadId, allowKey: card.allowKey });
    expect([403, 404], foreign.text).toContain(foreign.status);
    // her own bot: saved, no admin
    const saved = await api("POST", `/api/bots/${asker.id}/always-allow`, bob, { threadId: asker.threadId, allowKey: card.allowKey });
    expect(saved.status, saved.text).toBe(200);
    const stored = ((await api("GET", "/api/bots?messages=0", bob)).body.bots as Array<{ id: string; alwaysAllow?: string[] }>).find((bot) => bot.id === asker.id);
    expect(stored?.alwaysAllow, JSON.stringify(saved.body).slice(0, 400)).toContain(card.allowKey);
    expect((await api("POST", `/api/threads/${asker.threadId}/respond`, bob, { requestId: card.requestId, behavior: "deny" })).status).toBe(200);
    await asked;
  }, 90_000);

  it("MA-8: Approve for me applies a member's own team setup on her own turn; someone else's turn or bot keeps the card (2026-10-26)", async () => {
    setUma("manage");
    const uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true);
    const bob = await signIn(BOB);
    const chief = await createBot(uma, "Uma Lead", "claude");
    expect((await api("POST", `/api/bots/${chief.id}/primary`, uma, {})).status).toBe(200);
    const level = await api("PATCH", `/api/bots/${chief.id}/tasks/${chief.threadId}`, uma, { approvalMode: "auto" });
    expect(level.status, level.text).toBe(200);
    const writer = await createBot(uma, "Uma Writer", "claude");
    const plan = (botId: string, title: string) => ({ plan: { reason: "Uma asked for it", operations: [{ action: "update", botId, fields: { title } }] } });
    const title = async (id: string) => ((await api("GET", "/api/bots", uma)).body.bots as Array<{ id: string; title?: string }>).find((bot) => bot.id === id)?.title;

    // another person speaking to her Primary Bot: the card stays
    const other = await internal(await mint(chief.id, chief.threadId, ids.bob), "/api/internal/team-setup-requests", plan(writer.id, "Bob's idea"));
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    expect(other.body.state).toBe("pending");
    expect(await title(writer.id)).not.toBe("Bob's idea");
    // her own turn: applied at once, no card
    const own = await internal(await mint(chief.id, chief.threadId, ids.uma), "/api/internal/team-setup-requests", plan(writer.id, "Writer lead"));
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.state).toBe("applied");
    expect(await title(writer.id)).toBe("Writer lead");
    // someone else's bot stays out of reach, even on her own turn
    const bobs = await createBot(bob, "Bob Own", "claude");
    const foreign = await internal(await mint(chief.id, chief.threadId, ids.uma), "/api/internal/team-setup-requests", plan(bobs.id, "Taken"));
    expect(foreign.body.state, JSON.stringify(foreign.body)).not.toBe("applied");
    expect(((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; title?: string }>).find((bot) => bot.id === bobs.id)?.title).not.toBe("Taken");
    // deleting her own bot on her own turn: applied
    const deleted = await internal(await mint(chief.id, chief.threadId, ids.uma), "/api/internal/bot-deletion-requests", { targetBotId: writer.id, reason: "Uma asked" });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(201);
    expect(deleted.body.state).toBe("applied");
    expect(await botIds(uma)).not.toContain(writer.id);
  }, 90_000);

  it("MA-9: a member's bot adds an MCP server to the member's own servers, on at Full access, off below (2026-10-28)", async () => {
    setUma("manage");
    const uma = await signInUntil(UMA, (viewer) => viewer.botsReadOnly !== true);
    const bot = await createBot(uma, "Uma Wires", "claude");
    const full = await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, uma, { approvalMode: "full", confirmFullAccess: true });
    expect(full.status, full.text).toBe(200);
    const token = await mint(bot.id, bot.threadId, ids.uma);
    const remote = await internal(token, "/api/internal/mcp-servers", { name: "umadocs", url: "https://127.0.0.1:9/mcp" });
    expect(remote.status, JSON.stringify(remote.body)).toBe(201);
    expect(remote.body).toMatchObject({ enabled: true, personal: true });
    // her own list, never the server's shared one
    const shared = await api("GET", "/api/mcp/servers", alice);
    expect(JSON.stringify(shared.body)).not.toContain("umadocs");
    // a command runs in her own environment; this server has none
    const command = await internal(token, "/api/internal/mcp-servers", { name: "umacmd", command: "npx", args: ["-y", "notes-mcp"] });
    expect(command.status, JSON.stringify(command.body)).toBe(409);
    expect(command.body.code).toBe("no_environment");
    // below Full: off
    const ask = await createBot(uma, "Uma Asks", "claude");
    const asking = await api("PATCH", `/api/bots/${ask.id}/tasks/${ask.threadId}`, uma, { approvalMode: "ask" });
    expect(asking.status, asking.text).toBe(200);
    const off = await internal(await mint(ask.id, ask.threadId, ids.uma), "/api/internal/mcp-servers", { name: "umaoff", url: "https://127.0.0.1:9/other" });
    expect(off.body).toMatchObject({ enabled: false, personal: true });
    for (const name of ["umadocs", "umaoff"]) await api("DELETE", `/api/me/mcp/servers/${name}`, uma);
  }, 90_000);
});
