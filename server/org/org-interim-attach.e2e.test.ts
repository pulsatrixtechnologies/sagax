// Slice 8 through the real server: people from before Perspicax. A data
// directory used before the server signed in with Pulsatrix holds an
// interim person (known only by an address) who owns a bot and is in a room.
// Nobody gets it by signing in with that address, not even the person whose
// Perspicax account carries it; an organization admin attaches it, once,
// inside the window.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9S8IALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const EVE: FakeOidcUser = { sub: "01J9S8IEVE000000000000000E", email: "eve@example.test", name: "Eve", preferred_username: "eve", role: "employee" };
// Mallory typed eve's address into her own Perspicax profile.
const MALLORY: FakeOidcUser = { sub: "01J9S8IMALLORY00000000000M", email: "eve@example.test", name: "Mallory", preferred_username: "mallory", role: "employee" };
const INTERIM = "pr_e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0";

let PORT = 0;
let BASE = "";
let idp: FakeOidcProvider;
let home = "";
let child: ChildProcess | null = null;
let log = "";

type Auth = { cookie?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(method: string, path: string, auth?: Auth, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

async function start(env: Record<string, string>) {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
  });
}
async function stop() {
  if (!child) return;
  child.kill("SIGTERM");
  await waitForExit(child);
  child = null;
}

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const begin = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(begin.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(begin.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

posixOnly("slice 8: people from before Perspicax are attached by an admin, never by an address", () => {
  let alice: Auth;
  let eve: Auth;
  let mallory: Auth;
  const ids: Record<string, string> = {};
  let legacyId = "";
  let roomId = "";

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, EVE, MALLORY].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-interim-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    // Before Perspicax: a solo server with a bot and a room.
    await start({});
    const legacy = await call("POST", "/api/bots", undefined, { name: "Legacy" });
    expect(legacy.status, legacy.text).toBe(201);
    legacyId = legacy.body.bot.id;
    const room = await call("POST", "/api/groups", undefined, { name: "Legacy room", memberIds: [legacyId] });
    expect(room.status, room.text).toBe(201);
    roomId = room.body.group.id;
    await stop();
    // The interim person owns them (seeded as an older server left them).
    const principals = JSON.parse(readFileSync(join(data, "principals.json"), "utf8"));
    principals.principals.push({ id: INTERIM, kind: "human", email: "eve@example.test", createdAt: 1 });
    writeFileSync(join(data, "principals.json"), JSON.stringify(principals), { mode: 0o600 });
    const bots = JSON.parse(readFileSync(join(data, "bots.json"), "utf8"));
    for (const bot of bots) if (bot.id === legacyId) { bot.ownerUserId = INTERIM; delete bot.grants; delete bot.directGrants; }
    writeFileSync(join(data, "bots.json"), JSON.stringify(bots), { mode: 0o600 });
    const groups = JSON.parse(readFileSync(join(data, "groups.json"), "utf8"));
    for (const group of groups) if (group.id === roomId) group.humanIds = [INTERIM];
    writeFileSync(join(data, "groups.json"), JSON.stringify(groups), { mode: 0o600 });

    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    await start({
      SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5", SAGAX_ORG_NAME: "Acme",
    });
    alice = await signIn(ALICE);
    mallory = await signIn(MALLORY);
    eve = await signIn(EVE);
    const people = await waitFor(async () => {
      const got = (await call("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 120_000);

  afterAll(async () => {
    await stop();
    await idp?.close();
    if (home) removeTempDir(home);
  });

  const sees = async (auth: Auth) => {
    const state = (await call("GET", "/api/bots", auth)).body as { bots: Array<{ id: string }>; groups?: Array<{ id: string }> };
    return { bot: state.bots.some((bot) => bot.id === legacyId), room: (state.groups ?? []).some((group) => group.id === roomId) };
  };

  it("gives nothing to anyone who signs in with the interim address", async () => {
    expect(ids.eve).not.toBe(INTERIM);
    expect(ids.mallory).not.toBe(INTERIM);
    for (const who of [eve, mallory]) {
      expect(await sees(who)).toEqual({ bot: false, room: false });
      expect([403, 404]).toContain((await call("GET", `/api/bots/${legacyId}`, who)).status);
    }
  });

  it("lists the interim person to admins only, with no suggestion when two people carry the address", async () => {
    const org = await call("GET", "/api/org", alice);
    expect(org.body.settings.interimAttach).toMatchObject({ people: 1 });
    expect(org.body.settings.interimAttach.until).toBeGreaterThan(Date.now());
    expect(await call("GET", "/api/org/interim-people", eve)).toMatchObject({ status: 403 });
    expect(await call("POST", "/api/org/interim-people/attach", eve, { interimPrincipalId: INTERIM, principalId: ids.eve })).toMatchObject({ status: 403 });
    const listed = await call("GET", "/api/org/interim-people", alice);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.people).toEqual([{ principalId: INTERIM, email: "eve@example.test", bots: 1, rooms: 1, routines: 0, suggested: null }]);
  });

  it("attaches once, at an admin's word: eve owns the bot and the room, mallory still sees nothing", async () => {
    const attached = await call("POST", "/api/org/interim-people/attach", alice, { interimPrincipalId: INTERIM, principalId: ids.eve });
    expect(attached.status, attached.text).toBe(200);
    expect(attached.body).toMatchObject({ attached: { from: INTERIM, to: ids.eve }, rewritten: { bots: 1, rooms: 1 } });
    expect(await sees(eve)).toEqual({ bot: true, room: true });
    expect(await sees(mallory)).toEqual({ bot: false, room: false });
    const orgBots = (await call("GET", "/api/org/bots", alice)).body.bots as Array<{ id: string; ownerPrincipalId: string }>;
    expect(orgBots.find((bot) => bot.id === legacyId)?.ownerPrincipalId).toBe(ids.eve);
    expect(await call("POST", "/api/org/interim-people/attach", alice, { interimPrincipalId: INTERIM, principalId: ids.eve })).toMatchObject({ status: 400, body: { code: "not_interim" } });
    const principals = JSON.parse(readFileSync(join(home, ".sagax", "principals.json"), "utf8")).principals as Array<{ id: string; mergedInto?: string }>;
    expect(principals.find((person) => person.id === INTERIM)?.mergedInto).toBe(ids.eve);
    // the admin activity rows are sealed on disk (2026-10-27, #1263): read
    // through the route, as an admin does
    const activity = await call("GET", "/api/admin-activity?what=org", alice);
    expect(activity.status, activity.text).toBe(200);
    const row = (activity.body.entries as Array<{ action: string }>).find((entry) => entry.action === "person.attach_interim");
    expect(row).toMatchObject({ what: "org", before: { principalId: INTERIM }, after: { principalId: ids.eve } });
    expect(JSON.stringify(row)).not.toContain("@");
  });

  it("closes the window at 0 days", async () => {
    expect((await call("PATCH", "/api/org/settings", alice, { interimAttachDays: 0 })).status).toBe(200);
    expect(await call("GET", "/api/org/interim-people", alice)).toMatchObject({ status: 410, body: { code: "interim_attach_closed" } });
    expect((await call("GET", "/api/org", alice)).body.settings.interimAttach.until).toBeNull();
  });
});
