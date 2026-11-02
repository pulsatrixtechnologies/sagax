// Routine folders through the real server on an organization server
// (2026-10-28, server/routes/routine-folders.ts): a member sorts, renames,
// moves and undoes on their own bot without an admin, and another member
// never reaches that bot's folders.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MEMBER_ALWAYS_PERMISSIONS } from "../../shared/permissions.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9FOLDERALICE00000000000", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9FOLDERBOB0000000000000", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const CAROL: FakeOidcUser = { sub: "01J9FOLDERCAROL00000000000", name: "Carol", preferred_username: "carol", role: "employee", teams: [] };
const PERMS: Record<string, string[]> = {
  [BOB.sub]: ["bots.create"],
  [CAROL.sub]: ["bots.create"],
};

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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

/** Sign in until the viewer carries the permissions Perspicax sends. */
async function signInWith(user: FakeOidcUser): Promise<Auth> {
  // Every member also holds the keys about their own things (since 2026-10-26).
  const expected = [...new Set([...(PERMS[user.sub] ?? []), ...MEMBER_ALWAYS_PERMISSIONS])].sort();
  return waitFor(async () => {
    const auth = await signIn(user);
    const viewer = (await api("GET", "/api/config", auth)).body.viewer;
    return JSON.stringify([...(viewer?.permissions ?? [])].sort()) === JSON.stringify(expected) ? auth : null;
  });
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

posixOnly("Routine folders: a member arranges their own bot's routines", () => {
  const auth: Record<string, Auth> = {};
  let botId = "";
  const routineIds: string[] = [];
  const schedule = () => ({ type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 });

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => ({ ...idp.personOf(user), ...(PERMS[user.sub] ? { permissions: PERMS[user.sub] } : {}) }));
    idp.directoryTeams = [];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-routine-folders-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ instances: {} }));
    await start();
    auth.alice = await signIn(ALICE);
    for (const user of [BOB, CAROL]) auth[user.preferred_username!] = await signInWith(user);
    const created = await api("POST", "/api/bots", auth.bob, { name: "bob bot" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    for (const name of ["[Daily] Morning summary", "[Dev] Nightly check", "Weekly review"]) {
      const routine = await api("POST", "/api/routines", auth.bob, { name, botId, prompt: "Summarize.", schedule: schedule() });
      expect(routine.status, routine.text).toBe(201);
      routineIds.push(routine.body.routine.id);
    }
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("Sort by prefix, a rename, a move and Undo, all as the member, no admin", async () => {
    const sorted = await api("POST", "/api/routines/folders", auth.bob, { action: "sort-by-prefix", botId });
    expect(sorted.status, sorted.text).toBe(200);
    expect(sorted.body.folders).toEqual(["Daily", "Dev"]);
    const listed = await api("GET", "/api/routines", auth.bob);
    expect(listed.body.folders).toEqual({ [botId]: ["Daily", "Dev"] });
    const byId = (id: string) => (listed.body.routines as Array<{ id: string; name: string; folder?: string }>).find((routine) => routine.id === id)!;
    expect(byId(routineIds[0]!)).toMatchObject({ name: "Morning summary", folder: "Daily" });

    const renamed = await api("POST", "/api/routines/folders", auth.bob, { action: "rename", botId, from: "Dev", to: "Builds" });
    expect(renamed.body.folders).toEqual(["Daily", "Builds"]);
    const patched = await api("PATCH", `/api/routines/${routineIds[2]}`, auth.bob, { folder: "Builds" });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.routine.folder).toBe("Builds");

    const undone = await api("POST", "/api/routines/folders", auth.bob, { action: "restore", botId, undo: sorted.body.undo });
    expect(undone.status, undone.text).toBe(200);
    const after = await api("GET", "/api/routines", auth.bob);
    const names = (after.body.routines as Array<{ name: string }>).map((routine) => routine.name).sort();
    expect(names).toEqual(["Weekly review", "[Daily] Morning summary", "[Dev] Nightly check"]);
  });

  it("another member never reaches this bot's folders", async () => {
    const refused = await api("POST", "/api/routines/folders", auth.carol, { action: "create", botId, name: "Mine" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("needs_run");
    const theirs = await api("GET", "/api/routines", auth.carol);
    expect(theirs.body.folders ?? {}).not.toHaveProperty(botId);
  });
});
