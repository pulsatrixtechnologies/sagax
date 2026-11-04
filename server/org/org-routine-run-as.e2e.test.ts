// "Runs as" in the routine modal (owner, 2026-10-08) through the real server:
// who may choose the person a routine runs as, and that the run then acts
// with that person's delegation.
//
//   options   an admin sees every active person (never a service account),
//             someone without `run` listed but not selectable, someone who
//             never signed in marked pending; a team manager sees their
//             team; a regular person gets no dropdown
//   save      an admin sets anyone active who may run the bot; nobody can
//             set a person without rights, a service account or someone
//             outside the directory; a regular person cannot choose; a
//             manager stays within their teams; each change is in the
//             admin activity log with who made it
//   runner    the run acts as the chosen person (their delegation)
//   run now   the bot's owner, the person it runs as or an admin; one run in
//             flight; one manual row in the activity log; a paused routine
//             stays paused
//   skip      a person who never signed in has no delegation: the run is
//             skipped with #149's neutral line, the routine is not paused
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { waitForServerReady } from "../testing/server-ready.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE_KEY = "sk-ant-test-alice-runas00";
const TEAM_T = "01J9RUNASTEAMT000000000000";
const TEAM_U = "01J9RUNASTEAMU000000000000";
const ALICE: FakeOidcUser = { sub: "01J9RUNASALICE000000000000", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9RUNASBOB00000000000000", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const CAROL: FakeOidcUser = { sub: "01J9RUNASCAROL000000000000", name: "Carol", preferred_username: "carol", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const DAVE: FakeOidcUser = { sub: "01J9RUNASDAVE0000000000000", name: "Dave", preferred_username: "dave", role: "employee", teams: [{ id: TEAM_U, name: "U", manager: false }] };
const MIA: FakeOidcUser = { sub: "01J9RUNASMIA00000000000000", name: "Mia", preferred_username: "mia", role: "manager", teams: [{ id: TEAM_T, name: "T", manager: true }] };
/** Never signs in: no delegation. */
const ERIN: FakeOidcUser = { sub: "01J9RUNASERIN0000000000000", name: "Erin", preferred_username: "erin", role: "employee", teams: [] };
/** Not shared the bot: no right to run it. */
const FRANK: FakeOidcUser = { sub: "01J9RUNASFRANK000000000000", name: "Frank", preferred_username: "frank", role: "employee", teams: [] };
const ROBOT: FakeOidcUser = { sub: "01J9RUNASROBOT000000000000", name: "Dispatch robot", preferred_username: "robot", role: "employee" };
const PROFILE = { id: "01J9RUNASPROFILE0000000001", slug: "dispatch", name: "Dispatch", description: "Tickets" };

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

type Run = { id: string; routineId: string; status: string; error?: string; runAs?: string };
async function runNow(auth: Auth, routineId: string): Promise<Run> {
  const started = await api("POST", `/api/routines/${routineId}/run`, auth, {});
  expect(started.status, started.text).toBe(201);
  const id = started.body.run.id as string;
  return waitFor(async () => (((await api("GET", "/api/routines", auth)).body.runs ?? []) as Run[])
    .find((r) => r.id === id && ["completed", "failed", "blocked", "cancelled"].includes(r.status)), 60_000);
}
type Option = { principalId: string; name: string; selectable: boolean; reason?: string; pending?: true };
const optionsFor = async (auth: Auth, query: string) => {
  const got = await api("GET", `/api/routines/run-as-options?${query}`, auth);
  expect(got.status, got.text).toBe(200);
  return got.body as { canChoose: boolean; people: Option[]; current?: { principalId: string; name: string; pending?: true } };
};
async function runAsRows(as: Auth): Promise<any[]> {
  await sleep(150);
  const res = await api("GET", "/api/admin-activity?what=bot", as);
  expect(res.status, res.text).toBe(200);
  return (res.body.entries as any[]).filter((entry) => entry.action === "routine.run_as");
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
  await waitForServerReady(child, BASE, () => log);
}

posixOnly("routine modal: Runs as", () => {
  let alice: Auth;
  let bob: Auth;
  let mia: Auth;
  const ids: Record<string, string> = {};
  let botId = "";
  const schedule = () => ({ type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 });

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.profiles = [PROFILE];
    for (const user of [ALICE, BOB, CAROL, ERIN]) idp.profilesBySub.set(user.sub, [PROFILE.id]);
    idp.providerKeys.set(`${ALICE.sub}/anthropic`, ALICE_KEY);
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, MIA, ERIN, FRANK].map((user) => idp.personOf(user));
    idp.directoryPeople.push({ ...idp.personOf(ROBOT), kind: "service" as const });
    idp.directoryTeams = [
      { id: TEAM_T, name: "T", managers: [MIA.sub], members: [CAROL.sub] },
      { id: TEAM_U, name: "U", managers: [], members: [DAVE.sub] },
    ];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-routine-run-as-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_DUMP: join(home, "claude-dump.json"),
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "perspicax", tool: "api_list", arguments: {} }]),
            FAKE_CLAUDE_MCP_DUMP: join(home, "mcp-dump.json"),
          },
          config: { cli: FAKE_CLAUDE, fullAuto: true },
        },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 8 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    const created = await api("POST", "/api/bots", alice, { name: "Xavier" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    for (const login of ["bob", "carol", "dave", "mia", "erin"]) {
      const shared = await api("PUT", `/api/bots/${botId}/grants`, alice, { target: `user:${ids[login]}`, level: "run" });
      expect(shared.status, shared.text).toBe(200);
    }
    await waitFor(async () => (await api("GET", "/api/me/engines", alice)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myKey === true);
    bob = await signIn(BOB);
    mia = await signIn(MIA);
    await waitFor(async () => idp.delegationOf(BOB.sub) !== null);
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("an admin sees every active person, never a service account; no right listed but not selectable; never signed in pending", async () => {
    const options = await optionsFor(alice, `botId=${botId}&target=bot`);
    expect(options.canChoose).toBe(true);
    expect(options.current).toMatchObject({ principalId: ids.alice, name: "Alice" });
    const byLogin = (login: string) => options.people.find((person) => person.principalId === ids[login]);
    expect(options.people.map((person) => person.name).sort()).toEqual(["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Mia"]);
    expect(options.people.some((person) => person.principalId === ids.robot)).toBe(false);
    expect(byLogin("frank")).toMatchObject({ selectable: false, reason: "no_right" });
    expect(byLogin("bob")).toMatchObject({ selectable: true });
    expect(byLogin("bob")).not.toHaveProperty("pending");
    expect(byLogin("erin")).toMatchObject({ selectable: true, pending: true });
  });

  it("a team manager sees their team and themselves; a regular person gets no dropdown", async () => {
    const managed = await optionsFor(mia, `botId=${botId}&target=bot`);
    expect(managed.canChoose).toBe(true);
    expect(managed.people.map((person) => person.name).sort()).toEqual(["Carol", "Mia"]);
    const regular = await optionsFor(bob, `botId=${botId}&target=bot`);
    expect(regular).toMatchObject({ canChoose: false, people: [], current: { principalId: ids.bob, name: "Bob" } });
  });

  let bobRoutine = "";
  it("an admin sets anyone active who may run the bot; the change is in the activity log with who made it", async () => {
    const created = await api("POST", "/api/routines", alice, { name: "Bob's report", botId, prompt: "Report.", enabled: false, schedule: schedule(), runAs: ids.bob });
    expect(created.status, created.text).toBe(201);
    bobRoutine = created.body.routine.id;
    expect(created.body.routine.runAs).toEqual({ principalId: ids.bob, name: "Bob" });
    const row = await waitFor(async () => (await runAsRows(alice)).find((entry) => entry.target?.id === bobRoutine));
    expect(row).toMatchObject({
      action: "routine.run_as", who: "Alice",
      target: { kind: "routine", id: bobRoutine, name: "Bob's report" },
      after: { runAs: { principalId: ids.bob, name: "Bob" } },
    });
    // an edit that keeps the person writes no row
    expect((await api("PATCH", `/api/routines/${bobRoutine}`, alice, { name: "Bob's daily report", runAs: ids.bob })).status).toBe(200);
    expect((await runAsRows(alice)).filter((row) => row.target?.id === bobRoutine)).toHaveLength(1);
    // the options of the routine name its person
    expect((await optionsFor(alice, `routineId=${bobRoutine}`)).current).toMatchObject({ principalId: ids.bob, name: "Bob" });
  });

  it("nobody can make a routine run as a person without rights on the bot, a service account or a stranger", async () => {
    const base = { name: "Refused", botId, prompt: "No.", enabled: false, schedule: schedule() };
    const frank = await api("POST", "/api/routines", alice, { ...base, runAs: ids.frank });
    expect(frank.status, frank.text).toBe(403);
    expect(frank.body).toMatchObject({ code: "run_as_no_right", error: expect.stringContaining("Frank cannot run this bot's routines") });
    const robot = await api("POST", "/api/routines", alice, { ...base, runAs: ids.robot ?? "pr_00000000-0000-4000-8000-00000000robo" });
    expect(robot.status, robot.text).toBe(400);
    expect(robot.body.code).toBe("run_as_not_person");
    const stranger = await api("POST", "/api/routines", alice, { ...base, runAs: "pr_00000000-0000-4000-8000-000000000999" });
    expect(stranger.status, stranger.text).toBe(400);
    const changed = await api("PATCH", `/api/routines/${bobRoutine}`, alice, { runAs: ids.frank });
    expect(changed.status, changed.text).toBe(403);
    expect((await api("GET", "/api/routines", alice)).body.routines.find((r: { id: string }) => r.id === bobRoutine).runAs.principalId).toBe(ids.bob);
  });

  it("a regular person cannot choose someone else", async () => {
    const refused = await api("PATCH", `/api/routines/${bobRoutine}`, bob, { runAs: ids.carol });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("run_as_not_allowed");
    const own = await api("POST", "/api/routines", bob, { name: "Bob's own", botId, prompt: "Mine.", enabled: false, schedule: schedule(), runAs: ids.carol });
    expect(own.status, own.text).toBe(403);
  });

  it("a manager chooses within their teams only", async () => {
    const carol = await api("POST", "/api/routines", mia, { name: "Carol's check", botId, prompt: "Check.", enabled: false, schedule: schedule(), runAs: ids.carol });
    expect(carol.status, carol.text).toBe(201);
    expect(carol.body.routine.runAs).toEqual({ principalId: ids.carol, name: "Carol" });
    const row = await waitFor(async () => (await runAsRows(alice)).find((entry) => entry.target?.id === carol.body.routine.id));
    expect(row).toMatchObject({ who: "Mia", after: { runAs: { principalId: ids.carol } } });
    const dave = await api("POST", "/api/routines", mia, { name: "Dave's check", botId, prompt: "Check.", enabled: false, schedule: schedule(), runAs: ids.dave });
    expect(dave.status, dave.text).toBe(403);
    expect(dave.body.code).toBe("run_as_out_of_scope");
    // the routine runs as bob (outside her teams): she may still edit its
    // schedule, which keeps bob
    const kept = await api("PATCH", `/api/routines/${bobRoutine}`, mia, { name: "Bob's report (Mia)", runAs: ids.bob });
    expect(kept.status, kept.text).toBe(200);
    expect(kept.body.routine.runAs.principalId).toBe(ids.bob);
  });

  it("the run acts as the chosen person, through their delegation", async () => {
    const exchangesBefore = idp.exchanges.length;
    const run = await runNow(alice, bobRoutine);
    expect(run.status, run.error).toBe("completed");
    expect(run.runAs).toBe(ids.bob);
    // Readiness and execution each use this person's account exchange.
    expect(idp.exchanges.slice(exchangesBefore).map((exchange) => exchange.sub)).toEqual([BOB.sub, BOB.sub]);
  }, 90_000);

  it("Run now: the person it runs as may, someone else with run may not; one run in flight; audited as manual; a paused routine stays paused", async () => {
    const carol = await signIn(CAROL);
    const refused = await api("POST", `/api/routines/${bobRoutine}/run`, carol, {});
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("run_now_not_allowed");
    bob = await signIn(BOB);
    const [first, second] = await Promise.all([
      api("POST", `/api/routines/${bobRoutine}/run`, bob, {}),
      api("POST", `/api/routines/${bobRoutine}/run`, bob, {}),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.code).toBe("run_in_flight");
    const started = (first.status === 201 ? first : second).body.run as Run & { manual?: boolean; triggerSource?: string };
    expect(started.runAs).toBe(ids.bob);
    const finished = await waitFor(async () => (((await api("GET", "/api/routines", bob)).body.runs ?? []) as Run[])
      .find((r) => r.id === started.id && ["completed", "failed", "blocked", "cancelled"].includes(r.status)), 60_000);
    expect(finished.status, finished.error).toBe("completed");
    // the routine was off (enabled: false) and stays off
    expect((await api("GET", "/api/routines", alice)).body.routines.find((r: { id: string }) => r.id === bobRoutine).enabled).toBe(false);
    await waitFor(async () => ((await api("GET", "/api/admin-activity?what=bot", alice)).body.entries as any[]).some((entry) => entry.action === "routine.run_now" && entry.after?.runId === started.id));
    const rows = ((await api("GET", "/api/admin-activity?what=bot", alice)).body.entries as any[]).filter((entry) => entry.action === "routine.run_now" && entry.after?.runId === started.id);
    expect(rows).toEqual([expect.objectContaining({ who: "Bob", target: expect.objectContaining({ kind: "routine", id: bobRoutine }), after: { runId: started.id, trigger: "manual", runAs: ids.bob } })]);
  }, 90_000);

  it("a person who never signed in: the modal hint, then the run is skipped with the neutral line, not paused", async () => {
    const created = await api("POST", "/api/routines", alice, { name: "Erin's report", botId, prompt: "Report.", enabled: false, schedule: schedule(), runAs: ids.erin });
    expect(created.status, created.text).toBe(201);
    const routineId = created.body.routine.id as string;
    expect((await optionsFor(alice, `routineId=${routineId}`)).current).toEqual({ principalId: ids.erin, name: "Erin", pending: true });
    const skipped = await runNow(alice, routineId);
    // b0cec80619: an admission refusal blocks this run, without pausing the routine.
    expect(skipped).toMatchObject({ status: "blocked", error: "Perspicax did not issue Erin's routine access yet; this run is skipped and the next one tries again" });
    const routine = (await api("GET", "/api/routines", alice)).body.routines.find((r: { id: string }) => r.id === routineId);
    expect(routine.suspended).toBeUndefined();
    expect(routine.runAs).toEqual({ principalId: ids.erin, name: "Erin" });
  }, 90_000);
});
