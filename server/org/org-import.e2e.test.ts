// Slice 8 through two real servers: a solo Sagax exports the operator's own
// bots as an organization copy, and a person signed in to an organization
// server (the fake provider, server/testing/fake-oidc-provider.ts) imports
// it as theirs.
//
//   export    solo, loopback operator: the document parses, carries no secret
//   import    bob: owner, private sections, no grants, routines paused and
//             run as bob, approval ask, memory and threads as chosen
//   others    carol sees none of it (list, by id)
//   refusals  solo 403, no session 401, text 415, invalid 400, foreign 400,
//             no audit row for any of them
//   again     a second import is additive (fresh names, first copy unchanged)
//   teams     POST /api/teams/import on the org server lands the caller's bots
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseOrgImportDocument } from "../../shared/org-import.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9S8ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S8BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9S8CAROL00000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const SECRET = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE00";

let PORT = 0;
let ORG = "";
let SOLO = "";
let idp: FakeOidcProvider;
let orgHome = "";
let soloHome = "";
const children: ChildProcess[] = [];
let log = "";

type Auth = { cookie?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(base: string, method: string, path: string, auth?: Auth, body?: unknown, contentType = "application/json") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": contentType } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const start = await fetch(`${ORG}/auth/oidc/start`, { redirect: "manual" });
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

function startServer(home: string, port: number, env: Record<string, string>) {
  const child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  children.push(child);
  return waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
    } catch {
      return false;
    }
  });
}

/** The organization's admin activity rows, as an admin reads them. The rows
 * are sealed on disk (2026-10-27, #1263), so they are read through the
 * route, not the files. */
async function auditRows(as: Auth): Promise<Array<{ action: string; who?: string; target?: unknown; after?: Record<string, unknown> }>> {
  const got = await call(ORG, "GET", "/api/admin-activity?what=org", as);
  expect(got.status, got.text).toBe(200);
  return got.body.entries;
}

posixOnly("slice 8: copy a solo Sagax's bots into an organization", () => {
  let alice: Auth;
  let bob: Auth;
  let carol: Auth;
  const ids: Record<string, string> = {};
  let document: any;
  let atlasId = "";
  let boltId = "";

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1, 2, 3]);
    ORG = `http://127.0.0.1:${PORT}`;
    SOLO = `http://127.0.0.1:${PORT + 2}`;
    orgHome = mkdtempSync(join(tmpdir(), "omb-org-import-org-"));
    soloHome = mkdtempSync(join(tmpdir(), "omb-org-import-solo-"));
    mkdirSync(join(orgHome, ".sagax"), { recursive: true });
    mkdirSync(join(orgHome, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(orgHome, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: ORG, link_token: idp.linkToken,
    }), { mode: 0o640 });
    await Promise.all([
      startServer(orgHome, PORT, {
        SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: ORG,
        SAGAX_PERSPICAX_LINK_FILE: join(orgHome, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5", SAGAX_ORG_NAME: "Acme",
      }),
      startServer(soloHome, PORT + 2, {}),
    ]);
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
    carol = await signIn(CAROL);
    const people = await waitFor(async () => {
      const got = (await call(ORG, "GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;

    // The solo operator's bots, room and routine (loopback is the operator).
    const atlas = await call(SOLO, "POST", "/api/bots", undefined, { name: "Atlas" });
    expect(atlas.status, atlas.text).toBe(201);
    atlasId = atlas.body.bot.id;
    const bolt = await call(SOLO, "POST", "/api/bots", undefined, { name: "Bolt" });
    boltId = bolt.body.bot.id;
    const soul = await call(SOLO, "PATCH", `/api/bots/${atlasId}`, undefined, { description: `deploy key ${SECRET}` });
    expect(soul.status, soul.text).toBe(200);
    mkdirSync(join(soloHome, ".sagax", "workspaces", atlasId), { recursive: true, mode: 0o700 });
    writeFileSync(join(soloHome, ".sagax", "workspaces", atlasId, "MEMORY.md"), "Remember the deploy window is Friday.\n", { mode: 0o600 });
    const room = await call(SOLO, "POST", "/api/groups", undefined, { name: "Atlas and Bolt", memberIds: [atlasId, boltId] });
    expect(room.status, room.text).toBe(201);
    const routine = await call(SOLO, "POST", "/api/routines", undefined, { name: "Hourly", prompt: "check", botId: atlasId, enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 } });
    expect(routine.status, routine.text).toBe(201);
  }, 120_000);

  afterAll(async () => {
    for (const child of children) {
      child.kill("SIGTERM");
      await waitForExit(child);
    }
    await idp?.close();
    removeTempDir(orgHome);
    removeTempDir(soloHome);
  });

  it("exports the operator's chosen bots from the solo server, scrubbed", async () => {
    const exported = await call(SOLO, "POST", "/api/org/export", undefined, { bots: [{ id: atlasId, threads: true, memory: true }, { id: boltId, threads: false, memory: false }] });
    expect(exported.status, exported.text).toBe(200);
    expect(exported.body.filename).toMatch(/^sagax-org-copy-\d{4}-\d{2}-\d{2}\.json$/);
    document = exported.body.document;
    const parsed = parseOrgImportDocument(document);
    expect(parsed.backup.bots.map((bot) => bot.name).sort()).toEqual(["Atlas", "Bolt"]);
    expect(parsed.backup.groups.map((group) => group.name)).toEqual(["Atlas and Bolt"]);
    expect(parsed.backup.routines.map((routine) => routine.name)).toEqual(["Hourly"]);
    expect(parsed.backup.bots.find((bot) => bot.name === "Bolt")!.memory).toBeUndefined();
    expect(parsed.backup.bots.find((bot) => bot.name === "Atlas")!.memory?.file).toContain("Friday");
    expect(JSON.stringify(document)).not.toContain(SECRET);
    expect(exported.body.summary.redacted).toBeGreaterThanOrEqual(1);
    expect((await call(SOLO, "POST", "/api/org/export", undefined, { bots: [{ id: "nope", threads: true, memory: true }] })).body.code).toBe("unknown_bot");
    expect((await call(SOLO, "POST", "/api/org/import", undefined, document)).body).toMatchObject({ code: "identity_perspicax" });
  });

  it("refuses imports that are not a signed-in person's valid copy, without an audit row", async () => {
    expect(await call(ORG, "POST", "/api/org/import", undefined, document)).toMatchObject({ status: 401, body: { code: "session_required" } });
    expect((await call(ORG, "POST", "/api/org/import", bob, JSON.stringify(document), "text/plain")).status).toBe(415);
    expect(await call(ORG, "POST", "/api/org/import", bob, document.backup)).toMatchObject({ status: 400, body: { code: "invalid_document" } });
    const foreign = structuredClone(document);
    foreign.people.bots[atlasId].owner = "pr_22222222-2222-4222-8222-222222222222";
    expect(await call(ORG, "POST", "/api/org/import", bob, foreign)).toMatchObject({ status: 400, body: { code: "foreign_owner" } });
    const sneaky = structuredClone(document);
    sneaky.backup.bots.find((bot: { key: string }) => bot.key === boltId).tasks[0].messages.push({ id: "x", role: "user", text: "hi", at: 1, parentId: null });
    expect(await call(ORG, "POST", "/api/org/import", bob, sneaky)).toMatchObject({ status: 400, body: { code: "invalid_document" } });
    expect((await auditRows(alice)).filter((row) => row.action === "org.import")).toHaveLength(0);
    expect(((await call(ORG, "GET", "/api/bots", bob)).body.bots as unknown[]).length).toBe(0);
  });

  it("imports the copy as bob's private bots, rooms and paused routines", async () => {
    const imported = await call(ORG, "POST", "/api/org/import", bob, document);
    expect(imported.status, imported.text).toBe(201);
    expect(imported.body.subject).toEqual({ iss: idp.issuer, sub: BOB.sub });
    expect(imported.body.routines).toEqual([expect.objectContaining({ name: "Hourly", enabled: false })]);
    const report = imported.body as { bots: Array<{ id: string; name: string; section: string; memoryFiles: number }>; groups: Array<{ id: string }> };
    const orgBots = (await call(ORG, "GET", "/api/org/bots", alice)).body.bots as Array<{ id: string; ownerPrincipalId: string; grants: unknown[] }>;
    const bobsList = (await call(ORG, "GET", "/api/bots", bob)).body.bots as Array<{ id: string; approvalMode?: string; computer?: string; browser?: boolean }>;
    for (const bot of report.bots) {
      expect(orgBots.find((entry) => entry.id === bot.id)).toMatchObject({ ownerPrincipalId: ids.bob, grants: [] });
      const wire = bobsList.find((entry) => entry.id === bot.id)!;
      expect(wire.approvalMode).toBe("ask");
      expect(wire.computer ?? "off").toBe("off");
      expect(wire.browser ?? false).toBe(false);
      expect(bot.section).not.toBe("");
      // carol never sees it
      expect([403, 404]).toContain((await call(ORG, "GET", `/api/bots/${bot.id}`, carol)).status);
    }
    expect(report.bots.find((bot) => bot.name === "Atlas")!.memoryFiles).toBe(1);
    const carolList = (await call(ORG, "GET", "/api/bots", carol)).body.bots as Array<{ id: string }>;
    expect(carolList.some((bot) => report.bots.some((mine) => mine.id === bot.id))).toBe(false);
    const routines = (await call(ORG, "GET", "/api/routines", bob)).body.routines as Array<{ name: string; enabled: boolean; runAs?: { principalId: string } }>;
    expect(routines.find((routine) => routine.name === "Hourly")).toMatchObject({ enabled: false, runAs: { principalId: ids.bob } });
    const rows = (await auditRows(alice)).filter((row) => row.action === "org.import");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target: { kind: "server" }, who: "Bob", after: { bots: 2, rooms: 1, routines: 1 } });
    expect(JSON.stringify(rows[0])).not.toContain("Atlas");
  });

  it("is additive: a second import gives fresh names and leaves the first copy alone", async () => {
    const before = (await call(ORG, "GET", "/api/bots", bob)).body.bots as Array<{ id: string; name: string }>;
    const again = await call(ORG, "POST", "/api/org/import", bob, document);
    expect(again.status, again.text).toBe(201);
    const names = (again.body.bots as Array<{ name: string }>).map((bot) => bot.name);
    for (const name of names) expect(before.map((bot) => bot.name)).not.toContain(name);
    const after = (await call(ORG, "GET", "/api/bots", bob)).body.bots as Array<{ id: string; name: string }>;
    for (const bot of before) expect(after.find((candidate) => candidate.id === bot.id)?.name).toBe(bot.name);
  });

  it("lands a team import on the organization server as the caller's own bots", async () => {
    const imported = await call(ORG, "POST", "/api/teams/import", alice, document.backup);
    expect(imported.status, imported.text).toBe(201);
    const orgBots = (await call(ORG, "GET", "/api/org/bots", alice)).body.bots as Array<{ id: string; ownerPrincipalId: string }>;
    for (const bot of imported.body.bots as Array<{ id: string }>) {
      expect(orgBots.find((entry) => entry.id === bot.id)?.ownerPrincipalId).toBe(ids.alice);
    }
  });
});
