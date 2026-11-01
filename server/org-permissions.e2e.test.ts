// The permission matrix (2026-10-09) through the real server against the
// fake Perspicax: a member's profile permissions arrive in the directory
// (`permissions` on the person) and open or close what was "admin only".
//
//   PM-1  no list from Perspicax: the member defaults (no usage, no engines,
//         bots created and shared as before); the viewer carries them
//   PM-2  usage.view opens GET /api/usage (route gate); without it a 403
//         names the permission; an admin always passes
//   PM-3  bots.approvalLevel and folders.botWorkingFolder open fields of a
//         bot the member owns (field gate); an admin passes
//   PM-4  a profile without bots.create or sharing.grants: creating a bot and
//         sharing one answer 403 with the key; the viewer says why
//   PM-5  engines.manage opens the engines (full rows, settings) but never an
//         engine's program path (that is host.shell); unknown keys and
//         server.link from Perspicax are ignored
//   PM-6  server.settings, host.shell, backup.workspace and people.manage
//         open their screens (2026-10-19); never the sign-in lists, the
//         operator's profile, the interim attach window, tool grants, a
//         restore, or an admin's session
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MEMBER_ALWAYS_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS } from "../shared/permissions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CODEX_LOGIN = join(SERVER_DIR, "testing", "fake-codex-login-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9PMALICE00000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9PMBOB000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** Give Bob a permission list (undefined: an older Perspicax sends none),
 * then sign in until the viewer shows it (a sign-in refreshes the directory). */
async function bobWith(permissions: string[] | undefined): Promise<Auth> {
  idp.directoryPeople = [ALICE, BOB].map((user) => ({
    ...idp.personOf(user),
    ...(user === BOB && permissions ? { permissions } : {}),
  }));
  // 2026-10-26: the keys about Bob's own things are always added
  const expected = [...new Set([...(permissions ?? MEMBER_DEFAULT_PERMISSIONS), ...MEMBER_ALWAYS_PERMISSIONS])].filter((key) => !["server.link", "nope.key"].includes(key));
  return waitFor(async () => {
    const auth = await signIn(BOB);
    const viewer = (await api("GET", "/api/config", auth)).body.viewer;
    return JSON.stringify([...(viewer?.permissions ?? [])].sort()) === JSON.stringify([...expected].sort()) ? auth : null;
  });
}

async function start() {
  child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      PATH: process.env.PATH,
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
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

posixOnly("Perspicax organization: the permission matrix", () => {
  let alice: Auth;

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-permissions-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { codex: { driver: "codex", config: { cli: FAKE_CODEX_LOGIN } } },
      // #1098: a folder an admin opened to members (PM-3)
      organization: { memberFolders: { "*": [join(home, "work")] } },
    }));
    await start();
    alice = await signIn(ALICE);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("PM-1: without a list from Perspicax a member holds the member defaults", async () => {
    const bob = await bobWith(undefined);
    const viewer = (await api("GET", "/api/config", bob)).body.viewer;
    expect(viewer.permissionsSource).toBe("defaults");
    expect(viewer.permissions).toEqual([...MEMBER_DEFAULT_PERMISSIONS]);
    expect(viewer.capabilities.viewUsage).toBe(false);
    const admin = (await api("GET", "/api/config", alice)).body.viewer;
    expect(admin.permissionsSource).toBe("admin");
    expect(admin.permissions).toContain("host.shell");
  }, 60_000);

  it("PM-2: usage.view opens the usage ledger, and a refusal names the key", async () => {
    let bob = await bobWith(undefined);
    const refused = await api("GET", "/api/usage?from=2026-10-01&to=2026-10-09", bob);
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body).toMatchObject({ error: "forbidden", permission: "usage.view" });
    expect(refused.body.message).toContain("See usage and spend");
    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "usage.view"]);
    expect((await api("GET", "/api/config", bob)).body.viewer.capabilities.viewUsage).toBe(true);
    const allowed = await api("GET", "/api/usage?from=2026-10-01&to=2026-10-09", bob);
    expect(allowed.status, allowed.text).toBe(200);
    expect((await api("GET", "/api/usage?from=2026-10-01&to=2026-10-09", alice)).status).toBe(200);
  }, 60_000);

  it("PM-3: field permissions open the settings of a bot the member owns", async () => {
    let bob = await bobWith(undefined);
    const created = await api("POST", "/api/bots", bob, { name: "Sprout" });
    expect(created.status, created.text).toBe(201);
    const id = created.body.bot.id as string;
    // 2026-10-26: every setting of their own bot, without a permission list
    const auto = await api("PATCH", `/api/bots/${id}`, bob, { approvalMode: "auto" });
    expect(auto.status, auto.text).toBe(200);
    for (const body of [{ chiefOfStaff: true }, { proactiveMode: "proactive" }, { memoryEnabled: false }, { section: "Ops" }, { chiefOfStaff: false }, { hidden: true }]) {
      const own = await api("PATCH", `/api/bots/${id}`, bob, body);
      expect(own.status, `${JSON.stringify(body)} ${own.text}`).toBe(200);
    }
    expect((await api("PATCH", `/api/bots/${id}`, bob, { hidden: false })).status).toBe(200);
    // the server's managed cloud computer still needs its permission
    expect((await api("PATCH", `/api/bots/${id}`, bob, { cloudBackend: "vps" })).body).toMatchObject({ permission: "bots.computer" });
    const folder = join(home, "work");
    mkdirSync(folder, { recursive: true });
    // 2026-10-28 (#1098): the working folder of their own bot is theirs too
    const ownFolder = await api("PATCH", `/api/bots/${id}`, bob, { cwd: folder });
    expect(ownFolder.status, ownFolder.text).toBe(200);
    // the server still checks the path
    expect((await api("PATCH", `/api/bots/${id}`, bob, { cwd: join(home, "no-such-folder") })).status).toBe(400);
    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "bots.approvalLevel", "folders.botWorkingFolder"]);
    // the organization's automatic levels for members' bots are on by default
    const allowed = await api("PATCH", `/api/bots/${id}`, bob, { approvalMode: "auto" });
    expect(allowed.status, allowed.text).toBe(200);
    const moved = await api("PATCH", `/api/bots/${id}`, bob, { cwd: folder });
    expect(moved.status, moved.text).toBe(200);
    // 2026-10-26: the owner's own Always allow list goes with bots.approvalLevel
    const allowList = await api("PATCH", `/api/bots/${id}`, bob, { alwaysAllow: [] });
    expect(allowList.status, allowList.text).toBe(200);
    // an admin passes without any permission list (an admin opens no one
    // else's bot without a grant, so on their own)
    const elm = await api("POST", "/api/bots", alice, { name: "Elm" });
    expect(elm.status, elm.text).toBe(201);
    // never on another person's bot (it is not even visible to them)
    expect([403, 404]).toContain((await api("PATCH", `/api/bots/${elm.body.bot.id}`, bob, { alwaysAllow: [] })).status);
    const adminPatch = await api("PATCH", `/api/bots/${elm.body.bot.id}`, alice, { approvalMode: "auto", cwd: folder });
    expect(adminPatch.status, adminPatch.text).toBe(200);
  }, 60_000);

  it("PM-4: a profile without bots.create or sharing.grants still creates and shares their own bots (2026-10-26)", async () => {
    const people = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }>;
    const aliceId = people.find((person) => person.login === "alice")!.principalId;
    const bob = await bobWith(MEMBER_DEFAULT_PERMISSIONS.filter((key) => key !== "sharing.grants" && key !== "bots.create"));
    const own = await api("POST", "/api/bots", bob, { name: "Leaf" });
    expect(own.status, own.text).toBe(201);
    const share = await api("PUT", `/api/bots/${own.body.bot.id}/grants`, bob, { target: `user:${aliceId}`, level: "use" });
    expect(share.status, share.text).toBe(200);
    // never someone else's bot
    const oak = await api("POST", "/api/bots", alice, { name: "Oak" });
    expect(oak.status, oak.text).toBe(201);
    expect((await api("PATCH", `/api/bots/${oak.body.bot.id}`, bob, { approvalMode: "auto" })).status).not.toBe(200);
    expect((await api("DELETE", `/api/bots/${oak.body.bot.id}`, bob)).status).not.toBe(200);
    // the memory and change history of their own bot, never of someone else's
    const leaf = own.body.bot.id as string;
    expect((await api("GET", `/api/bots/${leaf}/history`, bob)).status).toBe(200);
    expect((await api("PUT", `/api/bots/${leaf}/memory/file`, bob, { path: "MEMORY.md", text: "Bob's notes" })).status).toBe(200);
    expect((await api("GET", `/api/bots/${leaf}/memory/file`, bob)).body.text).toBe("Bob's notes");
    expect([403, 404]).toContain((await api("GET", `/api/bots/${oak.body.bot.id}/history`, bob)).status);
    expect([403, 404]).toContain((await api("GET", `/api/bots/${oak.body.bot.id}/memory/file`, bob)).status);
    expect([403, 404]).toContain((await api("PUT", `/api/bots/${oak.body.bot.id}/memory/file`, bob, { text: "x" })).status);
  }, 60_000);

  it("PM-5: engines.manage opens the engines, never an engine's program; stray keys are ignored", async () => {
    let bob = await bobWith(undefined);
    const closed = await api("PATCH", "/api/instances/codex", bob, { tools: true });
    expect(closed.status, closed.text).toBe(403);
    expect(closed.body).toMatchObject({ error: "forbidden", permission: "engines.manage" });
    expect(((await api("GET", "/api/instances", bob)).body.instances as Array<Record<string, unknown>>).find((row) => row.instanceId === "codex")?.cli).toBeUndefined();
    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "engines.manage", "server.link", "nope.key"]);
    const viewer = (await api("GET", "/api/config", bob)).body.viewer;
    expect(viewer.permissions).toContain("engines.manage");
    // server.link stays an admin's whatever the list says
    expect(viewer.permissions).not.toContain("server.link");
    expect(viewer.permissions).not.toContain("nope.key");
    expect(log).toContain('unknown permission "nope.key" ignored');
    expect(((await api("GET", "/api/instances", bob)).body.instances as Array<Record<string, unknown>>).find((row) => row.instanceId === "codex")?.cli).toBe(FAKE_CODEX_LOGIN);
    const program = await api("PATCH", "/api/instances/codex", bob, { cli: "/bin/sh" });
    expect(program.status, program.text).toBe(403);
    expect(program.body).toMatchObject({ error: "forbidden", permission: "host.shell", field: "cli" });
    // without server.settings the settings stay closed
    expect((await api("PUT", "/api/config", bob, { profile: { name: "x" } })).status).toBe(403);
  }, 60_000);

  it("PM-6 (2026-10-19): the four admin keys an admin gives in Perspicax open their screens, never what makes admins", async () => {
    // nothing given: every one of them closed, naming its key
    let bob = await bobWith(undefined);
    const closed: Array<[string, string, unknown, string]> = [
      // 2026-10-22: the config write opens to server.settings OR the
      // separate server.experimental key; a member with neither is refused,
      // named by the primary key server.settings.
      ["PATCH", "/api/config", { language: "fr" }, "server.settings"],
      ["PATCH", "/api/org/settings", { allowVaultExport: false }, "server.settings"],
      ["GET", "/api/org/approvals", undefined, "host.shell"],
      ["GET", "/api/workspace-backup/status", undefined, "backup.workspace"],
      ["GET", "/api/auth/sessions", undefined, "people.manage"],
    ];
    for (const [method, path, body, key] of closed) {
      const refused = await api(method, path, bob, body);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(refused.body.permission, `${method} ${path}`).toBe(key);
    }
    expect((await api("GET", "/api/config", bob)).body.viewer.capabilities).toMatchObject({ editConfig: false, manageComputers: false, manageBackups: false });
    // 2026-10-26 (#1201): without host.shell the MCP list opens for the MCP
    // choice of bob's own bot, with each server's name, kind and state only:
    // never a command, its arguments, a URL, a header or a variable.
    const alice = await signIn(ALICE);
    const secret = "pm6-mcp-secret-value";
    const added = await api("POST", "/api/mcp/servers", alice, { name: "pm6fixture", type: "http", url: "https://pm6-mcp.example.test/mcp", headers: { "X-Pm6-Token": secret } });
    expect(added.status, added.text).toBe(201);
    const names = await api("GET", "/api/mcp/servers", bob);
    expect(names.status, names.text).toBe(200);
    expect(names.text).not.toContain(secret);
    expect(names.text).not.toContain("X-Pm6-Token");
    expect(names.text).not.toContain("pm6-mcp.example.test");
    const row = (names.body.servers as Array<Record<string, unknown>>).find((server) => server.name === "pm6fixture");
    expect(row).toBeDefined();
    for (const key of Object.keys(row!)) expect(["name", "type", "enabled", "auth", "source", "managedBy"]).toContain(key);

    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "server.settings", "host.shell", "backup.workspace", "people.manage"]);
    expect((await api("GET", "/api/config", bob)).body.viewer.capabilities).toMatchObject({ editConfig: true, manageKeys: true, manageComputers: true, manageBackups: true });
    // server.settings: the settings, never who is an admin
    const language = await api("PATCH", "/api/config", bob, { language: "fr" });
    expect(language.status, language.text).toBe(200);
    for (const field of ["signIn", "profile", "organization"]) {
      const refused = await api("PATCH", "/api/config", bob, { [field]: field === "signIn" ? { admins: ["bob@example.test"], members: [] } : field === "profile" ? { name: "x", email: "bob@example.test" } : {} });
      expect(refused.status, field).toBe(403);
      expect(refused.body).toMatchObject({ code: "admin_only_field", field });
    }
    // nor an address the server connects to, in any block
    const addresses: Array<[Record<string, unknown>, string]> = [
      [{ decider: { baseUrl: "https://attacker.example.test" } }, "decider.baseUrl"],
      [{ tts: { baseUrl: "https://attacker.example.test" } }, "tts.baseUrl"],
      [{ imageGen: { customUrl: "https://attacker.example.test" } }, "imageGen.customUrl"],
      [{ browserEngine: { attachCdpUrl: "http://127.0.0.1:9333" } }, "browserEngine.attachCdpUrl"],
      [{ openai: { url: "https://attacker.example.test" } }, "openai.url"],
    ];
    for (const [patch, field] of addresses) {
      const refused = await api("PATCH", "/api/config", bob, patch);
      expect(refused.status, field).toBe(403);
      expect(refused.body, field).toMatchObject({ code: "admin_only_field", field, error: "Only an organization admin can change an address the server connects to." });
    }
    // nor a provider key of the server(2026-10-19), in any block
    const providerKeys: Array<[Record<string, unknown>, string]> = [
      [{ openrouter: { key: "sk-test" } }, "openrouter.key"],
      [{ openai: { key: "sk-test" } }, "openai.key"],
      [{ anthropic: { key: "sk-test" } }, "anthropic.key"],
      [{ tts: { key: "tts-test" } }, "tts.key"],
      [{ tts: { fishKey: "tts-test" } }, "tts.fishKey"],
      [{ composio: { apiKey: "ck-test" } }, "composio.apiKey"],
      [{ decider: { key: "dk-test" } }, "decider.key"],
    ];
    for (const [patch, field] of providerKeys) {
      const refused = await api("PATCH", "/api/config", bob, patch);
      expect(refused.status, field).toBe(403);
      expect(refused.body, field).toMatchObject({ code: "admin_only_field", field, error: "Only an organization admin can change a provider key of the server." });
    }
    expect((await api("PATCH", "/api/config", alice, { openrouter: { key: "sk-test" } })).status).toBe(200);
    expect((await api("PATCH", "/api/config", alice, { tts: { baseUrl: "https://tts.example.test" } })).status).toBe(200);
    for (const [patch, field] of [[{ vps: { sshAlias: "host-shell-box" } }, "vps"], [{ box: { token: "x" } }, "box"], [{ features: { vpsComputer: true } }, "features.vpsComputer"]] as const) {
      const refused = await api("PATCH", "/api/config", bob, patch);
      expect(refused.status, field).toBe(403);
      expect(refused.body, field).toMatchObject({ code: "admin_only_field", field });
    }
    const config = (await api("GET", "/api/config", bob)).body;
    expect(config.profile?.email ?? "").toBe("");
    const policy = await api("PATCH", "/api/org/settings", bob, { allowVaultExport: false });
    expect(policy.status, policy.text).toBe(200);
    expect((await api("PATCH", "/api/org/settings", alice, { allowVaultExport: true })).status).toBe(200);
    const window = await api("PATCH", "/api/org/settings", bob, { interimAttachDays: 5 });
    expect(window.status).toBe(403);
    expect(window.body).toMatchObject({ code: "admin_only_field", field: "interimAttachDays" });
    // tool grants stay an admin's
    expect((await api("GET", "/api/tool-grants", bob)).status).toBe(403);
    // host.shell: the server's own MCP servers, the admin approvals queue
    expect((await api("GET", "/api/mcp/servers", bob)).status).toBe(200);
    expect((await api("GET", "/api/org/approvals", bob)).status).toBe(200);
    // backup.workspace: status and export, never a restore
    const backupStatus = await api("GET", "/api/workspace-backup/status", bob);
    expect(backupStatus.status, backupStatus.text).toBe(200);
    expect((await api("POST", "/api/workspace-backup/restore", bob, {})).status).toBe(403);
    expect((await api("POST", "/api/workspace-backup/upload", bob, {})).status).toBe(403);
    // people.manage: sessions, never an admin's
    const listed = await api("GET", "/api/auth/sessions", bob);
    expect(listed.status, listed.text).toBe(200);
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId as string;
    const bobId = (await api("GET", "/api/auth/session", bob)).body.principalId as string;
    const rows = listed.body.sessions as Array<{ id: string; principalId?: string; scopes?: string[] }>;
    const aliceSession = rows.find((row) => row.principalId === aliceId);
    expect(aliceSession).toBeTruthy();
    const refused = await api("DELETE", `/api/auth/sessions/${aliceSession!.id}`, bob);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("target_is_admin");
    expect((await api("GET", "/api/org/people/" + aliceId + "/connections", bob)).body.code).toBe("target_is_admin");
    // an admin's bot: never forced by a delegate
    const aliceBot = await api("POST", "/api/bots", alice, { name: "Vault" });
    expect(aliceBot.status, aliceBot.text).toBe(201);
    const forced = await api("POST", `/api/org/bots/${aliceBot.body.bot.id}/force-stop`, bob, {});
    expect(forced.status).toBe(403);
    expect(forced.body.code).toBe("target_is_admin");
    expect((await api("POST", `/api/org/bots/${aliceBot.body.bot.id}/force-stop`, alice, {})).status).toBe(200);
    // security review: a webhook would run an admin's bot as her
    const hook = await api("POST", "/api/webhooks", bob, { name: "x", prompt: "y", botId: aliceBot.body.bot.id });
    expect(hook.status).toBe(403);
    expect(hook.body.code).toBe("target_is_admin");
    // nor a provider endpoint, the OpenAI-compatible engines or a host switch
    for (const [body, field] of [[{ anthropic: { url: "http://127.0.0.1:9" } }, "anthropic.url"], [{ openaiCompat: [] }, "openaiCompat"], [{ features: { sharedComputers: true } }, "features.sharedComputers"]] as const) {
      const refused = await api("PATCH", "/api/config", bob, body);
      expect(refused.status, field).toBe(403);
      expect(refused.body.field).toBe(field);
    }
    // the custom domain feeds pairing links: an admin's
    expect((await api("POST", "/api/settings/custom-domain", bob, { domain: "evil.example" })).status).toBe(403);
    // another member's session: his to end (a second sign-in of his own here)
    const second = await signIn(BOB);
    const mine = ((await api("GET", "/api/auth/sessions", bob)).body.sessions as Array<{ id: string; principalId?: string }>)
      .filter((row) => row.principalId === bobId);
    expect(mine.length).toBeGreaterThan(1);
    const secondId = (await api("GET", "/api/auth/session", second)).body.id as string | undefined;
    const target = mine.find((row) => row.id !== secondId && row.id !== undefined)!;
    expect((await api("DELETE", `/api/auth/sessions/${target.id}`, second)).status).toBe(200);
    // the admin is unchanged
    expect((await api("GET", "/api/tool-grants", alice)).status).toBe(200);
  }, 90_000);

  it("PM-7 (2026-10-22, ): server.experimental alone flips the experiments and nothing else", async () => {
    const bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "server.experimental"]);
    // the section's capability is off (it is not server.settings), yet the
    // experiment switches write through
    const caps = (await api("GET", "/api/config", bob)).body.viewer.capabilities;
    expect(caps).toMatchObject({ editConfig: false, manageKeys: false });
    const okFeature = await api("PATCH", "/api/config", bob, { features: { dataWindow: true } });
    expect(okFeature.status, okFeature.text).toBe(200);
    expect(okFeature.body.features?.dataWindow).toBe(true);
    // nothing else: a plain setting, an address, a host-reaching feature
    for (const [patch, field] of [
      [{ language: "fr" }, "language"],
      [{ profile: { name: "x" } }, "profile"],
      [{ features: { vpsComputer: true } }, "features.vpsComputer"],
      [{ features: { dataWindow: true }, language: "fr" }, "language"],
    ] as const) {
      const refused = await api("PATCH", "/api/config", bob, patch);
      expect(refused.status, field).toBe(403);
      expect(refused.body.code, field).toBe("admin_only_field");
      expect(refused.body.field, field).toBe(field);
    }
  }, 90_000);
});
