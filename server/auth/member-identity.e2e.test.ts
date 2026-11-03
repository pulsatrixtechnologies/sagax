// A member of the organization through the real server: she signs in with
// Pulsatrix (the fake provider, server/testing/fake-oidc-provider.ts; slice 8
// removed the interim invite links) and then sees herself, not the operator,
// in /api/config and in config frames; she creates a bot that is hers alone,
// edits and deletes only her own bots, and still cannot reach server admin
// routes. A guest (a person with no organization role) creates nothing.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const OWNER_NAME = "Alex Martin";
const OWNER_EMAIL = "owner@example.com";
const OWNER_ABOUT = "private note about the operator";
const ZARA = "zara@example.test";
const MAX = "max@example.test";
const GUEST_ID = "pr_0f0f0f0f-1111-4222-8333-444455556666";
// What Caddy adds in front of the server: the request is remote, so it gets
// no loopback trust and needs its own session.
const REMOTE = { "x-forwarded-for": "198.51.100.23", "x-forwarded-proto": "https" };

const ZARA_USER: FakeOidcUser = { sub: "01J9S8ZARA000000000000000Z", email: ZARA, preferred_username: "zara", role: "employee" };
const MAX_USER: FakeOidcUser = { sub: "01J9S8MAX0000000000000000M", email: MAX, preferred_username: "max", role: "employee" };
const AVA = "ava@example.test";
const AVA_USER: FakeOidcUser = { sub: "01J9S8AVA0000000000000000A", email: AVA, name: "Ava Admin", preferred_username: "ava", role: "admin" };

let child: ChildProcess | undefined;
let idp: FakeOidcProvider | undefined;
let home = "";
let log = "";
let maxCookie = "";
let guestToken = "";
let zaraCookie = "";
let avaCookie = "";

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
async function signIn(user: FakeOidcUser): Promise<string> {
  idp!.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return cookiePair(session!);
}

type Who = "owner" | "zara" | "max" | "guest" | "ava";
function headersFor(who: Who): Record<string, string> {
  if (who === "ava") return { ...REMOTE, cookie: avaCookie };
  if (who === "zara") return { ...REMOTE, cookie: zaraCookie };
  if (who === "max") return { ...REMOTE, cookie: maxCookie };
  if (who === "guest") return { ...REMOTE, authorization: `Bearer ${guestToken}` };
  return {};
}

async function api(method: string, path: string, options: { body?: unknown; as?: Who; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...headersFor(options.as ?? "owner"),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, text, cookie: res.headers.get("set-cookie") };
}

async function until<T>(check: () => T | undefined, ms = 5_000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}

posixOnly("an organization member's identity and bots", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-member-identity-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    // #1098: a folder an admin opened to members
    mkdirSync(join(home, "opened"), { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      profile: { name: OWNER_NAME, email: OWNER_EMAIL, aboutMe: OWNER_ABOUT },
      organization: { memberFolders: { "*": [join(home, "opened")] } },
    }));
    idp = await startFakeOidcProvider({ user: ZARA_USER });
    idp.directoryPeople = [ZARA_USER, MAX_USER, AVA_USER].map((user) => idp!.personOf(user));
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    // A guest: a person the server knows, in no sign-in list.
    writeFileSync(join(data, "principals.json"), JSON.stringify({
      version: 1,
      principals: [{ id: GUEST_ID, kind: "guest", email: "gus@example.test", createdAt: 1 }],
    }));
    const registry = new SessionRegistry({ file: join(data, "sessions.json") });
    guestToken = registry.issue({ label: "Guest", principalId: GUEST_ID, scopes: ["client"] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "..", "index.ts")], {
      cwd: join(SERVER_DIR, "..", ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
        SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        // The operator at this computer, as on a desktop or a one-person server.
        SAGAX_LOOPBACK_TRUST: "owner",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    zaraCookie = await signIn(ZARA_USER);
    maxCookie = await signIn(MAX_USER);
    avaCookie = await signIn(AVA_USER);
  }, 40_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await idp?.close();
    await removeTempDir(home);
  });

  it("describes the operator to the operator, as before", async () => {
    const config = await api("GET", "/api/config");
    expect(config.status).toBe(200);
    expect(config.body.profile).toMatchObject({ name: OWNER_NAME, email: OWNER_EMAIL, aboutMe: OWNER_ABOUT });
    expect(config.body.viewer).toMatchObject({ operator: true, email: OWNER_EMAIL, name: OWNER_NAME, role: "owner", canCreateBots: true });
    expect(config.body.viewer.principalId).toMatch(/^pr_/);
  });

  it("describes a member as herself and never sends her the operator's email or about-me", async () => {
    const config = await api("GET", "/api/config", { as: "zara" });
    expect(config.status, config.text).toBe(200);
    expect(config.body.profile).toEqual({ name: "zara", email: ZARA, aboutMe: "", avatarUrl: "" });
    expect(config.body.viewer).toMatchObject({ operator: false, email: ZARA, name: "zara", role: "member", canCreateBots: true });
    expect(config.body.viewer.principalId).toMatch(/^pr_/);
    expect(config.text).not.toContain(OWNER_EMAIL);
    expect(config.text).not.toContain(OWNER_ABOUT);
    const seeded = await api("GET", "/api/config", { as: "max" });
    expect(seeded.body.viewer).toMatchObject({ operator: false, email: MAX, name: "max", role: "member", canCreateBots: true });
    expect(seeded.body.viewer.principalId).not.toBe(config.body.viewer.principalId);
  });

  it("sends each stream a config frame naming its own viewer", async () => {
    const controller = new AbortController();
    const res = await fetch(`${BASE}/api/events`, { headers: headersFor("zara"), signal: controller.signal });
    expect(res.status).toBe(200);
    let text = "";
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        /* aborted */
      }
    })();
    await until(() => text.includes('"hello"') || undefined);
    const saved = await api("PUT", "/api/config", { body: { language: "fr" } });
    expect(saved.status, saved.text).toBe(200);
    const frame = await until(() => text.split("\n").find((line) => line.startsWith("data:") && line.includes('"kind":"config"')));
    controller.abort();
    await pump;
    expect(frame).toBeTruthy();
    const payload = JSON.parse(frame!.slice(5));
    expect(payload.profile).toEqual({ name: "zara", email: ZARA, aboutMe: "", avatarUrl: "" });
    expect(payload.viewer).toMatchObject({ operator: false, email: ZARA, role: "member" });
    expect(frame).not.toContain(OWNER_EMAIL);
  });

  let zaraBot = "";
  let opsBot = "";

  it("lets a member create a bot that is hers alone", async () => {
    const created = await api("POST", "/api/bots", { as: "zara", body: { name: "Scout", settings: { soul: "Be brief.", color: "green" } } });
    expect(created.status, created.text).toBe(201);
    zaraBot = created.body.bot.id;
    const me = (await api("GET", "/api/config", { as: "zara" })).body.viewer.principalId;
    expect(created.body.bot.ownerUserId).toBe(me);
    const hers = await api("GET", "/api/bots", { as: "zara" });
    expect(hers.body.bots.map((b: any) => b.id)).toContain(zaraBot);
    const his = await api("GET", "/api/bots", { as: "max" });
    expect(his.body.bots.map((b: any) => b.id)).not.toContain(zaraBot);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "max", body: { name: "Mine now" } })).status).toBe(404);
    expect((await api("DELETE", `/api/bots/${zaraBot}`, { as: "max" })).status).toBe(404);
  });

  // 2026-10-26: a team file imported for herself lands as her own bots,
  // with a member's defaults; a server folder, a backup and the guest stay
  // refused (her choice of who sees them is hers, #1098).
  it("lets a member import a team file as her own bots, and keeps the server's parts an admin's", async () => {
    const manifest = { format: "openmaus.team", version: 2, team: { name: "Zara imports", members: [{ key: "helper", name: "Imported helper", appearance: { color: "blue" } }] } };
    const imported = await api("POST", "/api/teams/import", { as: "zara", body: manifest });
    expect(imported.status, imported.text).toBe(201);
    const id = imported.body.bots[0].id as string;
    const me = (await api("GET", "/api/config", { as: "zara" })).body.viewer.principalId;
    const mine = (await api("GET", "/api/bots", { as: "zara" })).body.bots.find((b: any) => b.id === id);
    expect(mine?.ownerUserId).toBe(me);
    expect(mine?.cwd ?? "").toBe("");
    expect((await api("GET", "/api/bots", { as: "max" })).body.bots.map((b: any) => b.id)).not.toContain(id);
    expect((await api("POST", "/api/teams/import?mode=project&cwd=%2F", { as: "zara", body: manifest })).status).toBe(403);
    // #1098: who sees her imported bots is hers to choose, and she stays in it
    const narrowed = await api("POST", "/api/teams/import?visibility=admins", { as: "zara", body: manifest });
    expect(narrowed.status, narrowed.text).toBe(201);
    const narrowedId = narrowed.body.bots[0].id as string;
    expect((await api("GET", "/api/bots", { as: "zara" })).body.bots.map((b: any) => b.id)).toContain(narrowedId);
    expect((await api("DELETE", `/api/bots/${narrowedId}`, { as: "zara" })).status).toBe(200);
    expect((await api("POST", "/api/teams/import", { as: "zara", body: { format: "openmaus.backup" } })).status).toBe(403);
    expect((await api("POST", "/api/teams/import", { as: "guest", body: manifest })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${id}`, { as: "zara" })).status).toBe(200);
  });

  // 2026-10-26 (no admin gating, #1107/#1138): where a member's bot works in
  // her own environment, its approval level, its team and a preset the server
  // offers are hers. 2026-10-28 (#1098): its working folder too
  // (folders.botWorkingFolder, held by every member; the path is still
  // checked). What stays refused: a preset the server does not offer.
  it("lets a member set her own bot's environment, its working folder included", async () => {
    const mine: string[] = [];
    for (const body of [
      { name: "Shell", settings: { computer: "local" } },
      { name: "Loose", settings: { approvalMode: "auto" } },
      { name: "Team", section: "Ops" },
    ]) {
      const created = await api("POST", "/api/bots", { as: "zara", body });
      expect(created.status, `${JSON.stringify(body)}: ${created.text}`).toBe(201);
      mine.push(created.body.bot.id);
    }
    // #1098 (isolation): a folder in her own roots, never the server's root
    const outside = await api("POST", "/api/bots", { as: "zara", body: { name: "Outside", settings: { cwd: "/" } } });
    expect(outside.status, outside.text).toBe(403);
    expect(outside.body.code).toBe("folder_outside_own_space");
    const folder = await api("POST", "/api/bots", { as: "zara", body: { name: "Folder", settings: { cwd: join(home, "opened") } } });
    expect(folder.status, folder.text).toBe(201);
    mine.push(folder.body.bot.id);
    expect((await api("POST", "/api/bots", { as: "zara", body: { name: "Preset", preset: "no-such-preset" } })).status).toBe(404);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { cwd: "/" } })).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { cwd: join(home, "opened") } })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { cwd: "/no/such/folder/1098" } })).status).toBe(400);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { cwd: null } })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { approvalMode: "auto" } })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { approvalMode: "ask" } })).status).toBe(200);
    for (const id of mine) expect((await api("DELETE", `/api/bots/${id}`, { as: "zara" })).status).toBe(200);
  });

  // Owner 2026-10-09: a member manages her own bot's Rules and Docs like its
  // Soul (server/routes/bot-workspace.ts); MEMORY.md stays an admin's.
  it("lets a member edit her own bot's rules and documents, and no one else's", async () => {
    const rules = await api("PUT", `/api/bots/${zaraBot}/workspace/file`, { as: "zara", body: { path: "RULES.md", text: "# Rules\n\n- Never quote a price.\n" } });
    expect(rules.status, rules.text).toBe(200);
    const doc = await api("PUT", `/api/bots/${zaraBot}/workspace/file`, { as: "zara", body: { path: "docs/onboarding.md", text: "# Onboarding\n" } });
    expect(doc.status, doc.text).toBe(200);
    expect((await api("GET", `/api/bots/${zaraBot}/workspace/file?path=RULES.md`, { as: "zara" })).body.text).toContain("Never quote a price.");
    const listing = await api("GET", `/api/bots/${zaraBot}/workspace`, { as: "zara" });
    expect(listing.status, listing.text).toBe(200);
    expect(listing.body.entries.map((entry: any) => entry.path)).toEqual(expect.arrayContaining(["RULES.md", "docs/onboarding.md"]));
    const renamed = await api("POST", `/api/bots/${zaraBot}/workspace/docs/rename`, { as: "zara", body: { from: "docs/onboarding.md", to: "docs/clients.md" } });
    expect(renamed.status, renamed.text).toBe(200);
    expect((await api("DELETE", `/api/bots/${zaraBot}/workspace/file?path=docs/clients.md`, { as: "zara" })).status).toBe(200);
    // only rules and documents: memory stays on the admin routes
    expect((await api("PUT", `/api/bots/${zaraBot}/workspace/file`, { as: "zara", body: { path: "MEMORY.md", text: "x" } })).status).toBe(400);
    // 2026-10-26 (#1107): the memory of her own bot is hers too; only the
    // route's owner check keeps it from another member (below)
    expect((await api("PUT", `/api/bots/${zaraBot}/memory/file`, { as: "zara", body: { path: "MEMORY.md", text: "# Memory\n" } })).status).toBe(200);
    // another member is refused: 404 when she cannot see the bot (the
    // server's visibility gate answers first), 403 when she can
    for (const [method, path, body] of [
      ["GET", `/api/bots/${zaraBot}/workspace`, undefined],
      ["GET", `/api/bots/${zaraBot}/workspace/file?path=RULES.md`, undefined],
      ["PUT", `/api/bots/${zaraBot}/workspace/file`, { path: "RULES.md", text: "# Hijacked\n" }],
      ["DELETE", `/api/bots/${zaraBot}/workspace/file?path=RULES.md`, undefined],
      ["GET", `/api/bots/${zaraBot}/workspace/download?path=RULES.md`, undefined],
      ["PUT", `/api/bots/${zaraBot}/memory/file`, { path: "MEMORY.md", text: "# Hijacked\n" }],
    ] as const) {
      expect([403, 404], `${method} ${path}`).toContain((await api(method, path, { as: "max", body })).status);
    }
    const ops = await api("POST", "/api/bots", { body: { name: "Ops rules" } });
    const zaraId = (await api("GET", "/api/config", { as: "zara" })).body.viewer.principalId;
    expect((await api("POST", `/api/bots/${ops.body.bot.id}/direct-grants`, { body: { userId: zaraId } })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${ops.body.bot.id}/workspace/file`, { as: "zara", body: { path: "RULES.md", text: "# Hijacked\n" } })).status).toBe(403);
    expect((await api("GET", `/api/bots/${zaraBot}/workspace/file?path=RULES.md`)).body.text).toContain("Never quote a price.");
  });

  it("lets a member edit and delete only her own bots", async () => {
    const renamed = await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { name: "Scout 2", soul: "Be very brief." } });
    expect(renamed.status, renamed.text).toBe(200);
    expect(renamed.body.bot.name).toBe("Scout 2");
    const ops = await api("POST", "/api/bots", { body: { name: "Ops" } });
    expect(ops.status).toBe(201);
    opsBot = ops.body.bot.id;
    const zaraId = (await api("GET", "/api/config", { as: "zara" })).body.viewer.principalId;
    const granted = await api("POST", `/api/bots/${opsBot}/direct-grants`, { body: { userId: zaraId } });
    expect(granted.status, granted.text).toBe(200);
    expect((await api("GET", "/api/bots", { as: "zara" })).body.bots.map((b: any) => b.id)).toContain(opsBot);
    expect((await api("PATCH", `/api/bots/${opsBot}`, { as: "zara", body: { name: "Hijacked" } })).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${opsBot}`, { as: "zara", body: { color: "red" } })).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${opsBot}/profile`, { as: "zara", body: { name: "Hijacked" } })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${opsBot}`, { as: "zara" })).status).toBe(403);
    expect((await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === opsBot)?.name).toBe("Ops");
    const own = await api("PATCH", `/api/bots/${zaraBot}/profile`, { as: "zara", body: { title: "Researcher" } });
    expect(own.status, own.text).toBe(200);
    const deleted = await api("DELETE", `/api/bots/${zaraBot}`, { as: "zara" });
    expect(deleted.status, deleted.text).toBe(200);
    expect((await api("GET", "/api/bots")).body.bots.map((b: any) => b.id)).not.toContain(zaraBot);
  });

  it("keeps a guest from creating bots", async () => {
    const config = await api("GET", "/api/config", { as: "guest" });
    expect(config.status, config.text).toBe(200);
    expect(config.body.viewer).toMatchObject({ operator: false, principalId: GUEST_ID, role: null, canCreateBots: false });
    expect(config.text).not.toContain(OWNER_EMAIL);
    const refused = await api("POST", "/api/bots", { as: "guest", body: { name: "Nope" } });
    expect(refused.status).toBe(403);
  });

  it("gives a member no server admin route", async () => {
    for (const [method, path, body] of [
      ["PUT", "/api/config", { profile: { name: "Zara" } }],
      ["PUT", "/api/config", { language: "en" }],
      ["GET", "/api/auth/sessions", undefined],
      ["POST", "/api/auth/pairing", { label: "x", scopes: ["admin"] }],
      ["POST", "/api/org/invites", { email: "eve@example.test" }],
      ["PATCH", "/api/instances/claude", { cli: "" }],
      ["POST", "/api/mcp/servers", { name: "x", command: "echo" }],
      ["POST", "/api/org-library/add", { packageId: "00000000-0000-4000-8000-000000000000" }],
    ] as const) {
      const res = await api(method, path, { as: "zara", ...(body !== undefined ? { body } : {}) });
      expect(res.status, `${method} ${path}: ${res.text}`).toBe(403);
    }
    // the MCP list is names and state only: a member's bot picks from it,
    // and no command, URL or header of the server's own comes with it
    const servers = await api("GET", "/api/mcp/servers", { as: "zara" });
    expect(servers.status, servers.text).toBe(200);
    for (const row of servers.body.servers) expect(Object.keys(row).sort().filter((key) => ["command", "args", "url", "headers", "env"].includes(key))).toEqual([]);
    expect((await api("GET", "/api/config")).body.profile.name).toBe(OWNER_NAME);
    // the engines list is theirs to read (Model providers, the model
    // picker) without anything of the server's own account or install
    const engines = await api("GET", "/api/instances", { as: "zara" });
    expect(engines.status, engines.text).toBe(200);
    for (const row of engines.body.instances as Array<Record<string, any>>) {
      expect(row.cli ?? row.cliCandidates ?? row.claudeAccount ?? row.install ?? row.snapshot.account).toBeUndefined();
    }
  });

  // Perspicax owns a signed-in person's name and email: the UI shows them
  // read-only with a link to the issuer console, and the server refuses to
  // change them, even for an organization admin.
  it("tells every signed-in person that Perspicax manages their name and email", async () => {
    const manageUrl = `${new URL(idp!.issuer).origin}/console/me`;
    for (const who of ["zara", "ava"] as const) {
      const session = await api("GET", "/api/auth/session", { as: who });
      expect(session.status, session.text).toBe(200);
      expect(session.body).toMatchObject({ identity: "perspicax", profileManagedBy: "perspicax", profileManageUrl: manageUrl });
      const config = await api("GET", "/api/config", { as: who });
      expect(config.body.viewer).toMatchObject({ profileManagedBy: "perspicax", profileManageUrl: manageUrl });
    }
    const ava = await api("GET", "/api/config", { as: "ava" });
    expect(ava.body.viewer).toMatchObject({ operator: false, name: "Ava Admin", email: AVA });
    expect(ava.body.profile).toMatchObject({ name: "Ava Admin", email: AVA });
    // the operator at the server's own console keeps the local profile
    const owner = await api("GET", "/api/config");
    expect(owner.body.viewer.profileManagedBy).toBeUndefined();
    expect((await api("GET", "/api/auth/session")).body.profileManagedBy).toBeUndefined();
  });

  it("refuses an organization admin's name or email with identity_perspicax", async () => {
    for (const profile of [{ name: "Someone Else" }, { email: "other@example.test" }, { name: "Ava", email: AVA }]) {
      const refused = await api("PUT", "/api/config", { as: "ava", body: { profile } });
      expect(refused.status, refused.text).toBe(403);
      expect(refused.body.code).toBe("identity_perspicax");
    }
    const patched = await api("PATCH", "/api/config", { as: "ava", body: { profile: { name: "x" } } });
    expect(patched.status).toBe(403);
    expect(patched.body.code).toBe("identity_perspicax");
    // the rest of the config is still an admin's to change
    const language = await api("PUT", "/api/config", { as: "ava", body: { language: "en" } });
    expect(language.status, language.text).toBe(200);
    const owner = await api("GET", "/api/config");
    expect(owner.body.profile).toMatchObject({ name: OWNER_NAME, email: OWNER_EMAIL });
  });

  it("takes a changed name from Perspicax at the next sign-in", async () => {
    // Perspicax changed the name: its directory says so as well as its sign-in, and the directory
    // is what the server reads back, so the fixture's directory follows the rename.
    const renamed = { ...AVA_USER, name: "Ava Q. Admin" };
    idp!.directoryPeople = [ZARA_USER, MAX_USER, renamed].map((user) => idp!.personOf(user));
    avaCookie = await signIn(renamed);
    const config = await api("GET", "/api/config", { as: "ava" });
    expect(config.body.viewer.name).toBe("Ava Q. Admin");
    expect((await api("GET", "/api/auth/session", { as: "ava" })).body.name).toBe("Ava Q. Admin");
  });
});
