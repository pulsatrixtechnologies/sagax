// The Automations page scope (2026-10-09, the owner) through the real server:
//
//   mine     a member without keys sees only their own routines, and a
//            wider scope is 403 naming the missing key
//   team     routines.viewTeam adds the routines of the people in their
//            teams, never another team's
//   all      routines.viewAll and an admin see every routine
//   filters  teamId, botId, ownerId and status narrow the answer
//   flags    someone else's routine is read-only and withheld
//   clear    Clear logs removes the caller's own runs, or every run in
//            scope with routines.viewAll and scope=all
//   seen     Mark all as read stamps only the caller's own runs and answers
//            with their ids; stopping a run takes the Run now rule
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

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const posixOnly = describe.skipIf(process.platform === "win32");
const TEAM_T = "01J9SCOPETEAMT000000000000";
const TEAM_U = "01J9SCOPETEAMU000000000000";
const ALICE: FakeOidcUser = { sub: "01J9SCOPEALICE000000000000", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9SCOPEBOB00000000000000", name: "Bob", preferred_username: "bob", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const CAROL: FakeOidcUser = { sub: "01J9SCOPECAROL000000000000", name: "Carol", preferred_username: "carol", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const DAVE: FakeOidcUser = { sub: "01J9SCOPEDAVE0000000000000", name: "Dave", preferred_username: "dave", role: "employee", teams: [{ id: TEAM_U, name: "U", manager: false }] };
const PERMS: Record<string, string[]> = {
  [BOB.sub]: ["bots.create"],
  [CAROL.sub]: ["bots.create", "routines.viewTeam"],
  [DAVE.sub]: ["bots.create", "routines.viewAll"],
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

posixOnly("Automations page: routine scope", () => {
  const auth: Record<string, Auth> = {};
  const routineOf: Record<string, string> = {};
  const botOf: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const schedule = () => ({ type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 });

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE].map((user) => ({ ...idp.personOf(user), ...(PERMS[user.sub] ? { permissions: PERMS[user.sub] } : {}) }));
    idp.directoryTeams = [
      { id: TEAM_T, name: "T", managers: [], members: [BOB.sub, CAROL.sub] },
      { id: TEAM_U, name: "U", managers: [], members: [DAVE.sub] },
    ];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-routine-scope-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ instances: {} }));
    await start();
    auth.alice = await signIn(ALICE);
    for (const user of [BOB, CAROL, DAVE]) auth[user.preferred_username!] = await signInWith(user);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", auth.alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 4 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    for (const login of ["alice", "bob", "carol", "dave"]) {
      const created = await api("POST", "/api/bots", auth[login], { name: `${login} bot` });
      expect(created.status, created.text).toBe(201);
      botOf[login] = created.body.bot.id;
      const routine = await api("POST", "/api/routines", auth[login], { name: `${login} report`, botId: botOf[login], prompt: `${login} secret`, enabled: login !== "carol", schedule: schedule() });
      expect(routine.status, routine.text).toBe(201);
      routineOf[login] = routine.body.routine.id;
    }
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  const names = (body: any) => (body.routines as Array<{ name: string }>).map((routine) => routine.name).sort();

  it("a member without keys sees only their own routines; a wider scope is 403 with the key", async () => {
    const mine = await api("GET", "/api/routines", auth.bob);
    expect(mine.status, mine.text).toBe(200);
    expect(names(mine.body)).toEqual(["bob report"]);
    expect(mine.body).toMatchObject({ scope: "mine", allowed: { mine: true, team: false, all: false } });
    expect(mine.body.routines[0]).toMatchObject({ owner: { id: ids.bob, name: "Bob" }, bot: { id: botOf.bob }, canRun: true, canEdit: true, prompt: "bob secret" });
    expect(mine.body.routines[0].teamIds).toContain(TEAM_T);
    const team = await api("GET", "/api/routines?scope=team", auth.bob);
    expect(team.status).toBe(403);
    expect(team.body).toMatchObject({ error: "forbidden", permission: "routines.viewTeam", code: "routine_scope_not_allowed" });
    expect((await api("GET", "/api/routines?scope=all", auth.bob)).body).toMatchObject({ permission: "routines.viewAll" });
    expect((await api("GET", "/api/routines?scope=nope", auth.bob)).status).toBe(400);
  });

  it("routines.viewTeam sees the routines of their teams, never another team's, read-only and withheld", async () => {
    const team = await api("GET", "/api/routines?scope=team", auth.carol);
    expect(team.status, team.text).toBe(200);
    expect(names(team.body)).toEqual(["bob report", "carol report"]);
    const bobs = team.body.routines.find((routine: any) => routine.name === "bob report");
    expect(bobs).toMatchObject({ owner: { id: ids.bob }, canRun: false, canEdit: false, redacted: true, prompt: "" });
    expect((await api("GET", "/api/routines?scope=all", auth.carol)).status).toBe(403);
    expect(team.body.facets.teams.map((entry: any) => entry.id)).toEqual([TEAM_T]);
  });

  it("routines.viewAll and an admin see every routine", async () => {
    for (const login of ["dave", "alice"]) {
      const all = await api("GET", "/api/routines?scope=all", auth[login]);
      expect(all.status, all.text).toBe(200);
      expect(names(all.body)).toEqual(["alice report", "bob report", "carol report", "dave report"]);
      expect(all.body.allowed).toEqual({ mine: true, team: true, all: true });
    }
  });

  it("filters apply", async () => {
    const q = async (query: string) => names((await api("GET", `/api/routines?scope=all&${query}`, auth.dave)).body);
    expect(await q(`teamId=${TEAM_U}`)).toEqual(["dave report"]);
    expect(await q(`botId=${botOf.bob}`)).toEqual(["bob report"]);
    expect(await q(`ownerId=${ids.carol}`)).toEqual(["carol report"]);
    expect(await q("status=paused")).toEqual(["carol report"]);
    expect(await q("status=failing")).toEqual([]);
  });

  it("Clear logs: own runs only, or every run with viewAll and scope=all", async () => {
    // A member asking for a scope they do not hold is refused.
    expect((await api("DELETE", "/api/routine-runs?scope=all", auth.bob)).body).toMatchObject({ permission: "routines.viewAll" });
    // No run is saved yet: each answer is an empty, successful clear.
    for (const [login, query] of [["bob", ""], ["carol", "?scope=team"], ["dave", "?scope=all"], ["alice", `?scope=all&botId=${botOf.bob}`]] as const) {
      const cleared = await api("DELETE", `/api/routine-runs${query}`, auth[login]);
      expect(cleared.status, cleared.text).toBe(200);
      expect(cleared.body.removed).toEqual([]);
    }
  });

  it("Mark all as read: only the caller's own runs, answered by id; stopping a run takes the Run now rule", async () => {
    const past = () => ({ type: "once", at: Date.now() - 13 * 3_600_000 });
    const missedRun = async (login: string) => {
      const made = await api("POST", "/api/routines", auth[login], { name: `${login} stale`, botId: botOf[login], prompt: `${login} stale work`, schedule: past() });
      expect(made.status, made.text).toBe(201);
      const routineId = made.body.routine.id as string;
      return waitFor(async () => {
        const runs = (await api("GET", "/api/routines", auth[login])).body.runs as Array<{ id: string; routineId: string; status: string; seenAt?: number }>;
        return runs.find((run) => run.routineId === routineId && run.status === "missed") ?? null;
      });
    };
    const bobs = await missedRun("bob");
    const daves = await missedRun("dave");

    const seen = await api("POST", "/api/routine-runs/seen-all", auth.bob);
    expect(seen.status, seen.text).toBe(200);
    expect(Object.keys(seen.body).sort()).toEqual(["count", "ids", "runs", "seenAt"]);
    expect(seen.body.ids).toEqual([bobs.id]);
    expect(seen.body.count).toBe(1);
    expect(seen.body.runs).toEqual([]);
    expect(seen.text).not.toContain("dave");
    const daveRuns = (await api("GET", "/api/routines", auth.dave)).body.runs as Array<{ id: string; seenAt?: number }>;
    expect(daveRuns.find((run) => run.id === daves.id)?.seenAt).toBeUndefined();

    // Marking one run seen follows the listing's visibility: another person's
    // run answers 404 and stays unchanged; one's own run is stamped.
    const foreign = await api("POST", `/api/routine-runs/${daves.id}/seen`, auth.bob);
    expect(foreign.status, foreign.text).toBe(404);
    expect(foreign.text).not.toContain("dave");
    expect((await api("POST", "/api/routine-runs/no-such-run/seen", auth.bob)).status).toBe(404);
    const daveAfter = (await api("GET", "/api/routines", auth.dave)).body.runs as Array<{ id: string; seenAt?: number }>;
    expect(daveAfter.find((run) => run.id === daves.id)?.seenAt).toBeUndefined();
    expect((await api("POST", `/api/routine-runs/${daves.id}/seen`, auth.dave)).status).toBe(200);

    // With the right to run Dave's bot, Bob still may not stop Dave's run:
    // neither the bot's owner nor the person it runs as.
    expect((await api("PUT", `/api/bots/${botOf.dave}/grants`, auth.dave, { target: `user:${ids.bob}`, level: "run" })).status).toBe(200);
    const stop = await api("POST", `/api/routine-runs/${daves.id}/cancel`, auth.bob);
    expect(stop.status, stop.text).toBe(403);
    expect(stop.body).toMatchObject({ code: "run_now_not_allowed" });
    // Dave keeps the hand on his own run (no longer active: not found, never refused)
    expect((await api("POST", `/api/routine-runs/${daves.id}/cancel`, auth.dave)).status).toBe(404);
  });
});
