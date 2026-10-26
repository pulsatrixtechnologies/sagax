// Slice 6 of the Perspicax organization through the real server: routines in
// their person's name (scenario D). The fake provider keeps routine
// delegation families apart from sign-in ones and reports them in its
// directory; the fake Claude CLI really calls the Perspicax MCP profile of
// the bot (FAKE_CLAUDE_MCP_CALLS). Since 2026-10-08 (JC) a routine always
// acts in its owner's name: the delegation is issued at sign-in by token
// exchange through the link, never asked, and cannot be turned off.
//
//   sign-in     alice signs in: her delegation is issued, no consent; the
//               route is read-only (no POST, no DELETE)
//   scenario D  her routine runs while she has no session: the engine uses
//               her key (the bot owner's), the MCP call runs as her through
//               her delegation, the exchanged token is revoked after
//   renewal     a run within the renewal window refreshes nothing
//   revoke      a revoke in the console never pauses the routine: the next
//               run gets a new delegation from her session
//   old px      a Perspicax that cannot issue one only skips the run
//   someone     bob's routine on alice's bot runs as bob (his delegation,
//   else        alice's key, never his own subscription or key: the bot's
//               routines always run on its owner's credentials, 2026-10-01),
//               then pauses no_right when he loses `run`
//   owner pays  a routine a shared editor rewrote or started is refused,
//               with the owner's card, when the owner has no credentials,
//               and when the owner is disabled; the owner's notification
//               opens the run in the bot's Coding activity, where the card
//               (hers alone) is, never bob's private thread
//   transient   Perspicax unreachable: the run fails, the routine is kept
//   person out  a disable pauses the routine person_out; no runs follow
//   disk        no refresh or access token is ever written in clear
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE_KEY = "sk-ant-test-alice-000000";
const BOB_KEY = "sk-ant-test-bob-0000000000";
const ALICE: FakeOidcUser = { sub: "01J9S6ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S6BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9S6CAROL00000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const PROFILE = { id: "01J9S6PROFILEDISPATCH00001", slug: "dispatch", name: "Dispatch", description: "Tickets and schedules" };
/** The renewal window of this server (SAGAX_ROUTINE_RENEW_SECONDS). */
const RENEW_SECONDS = 45;

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
type RoutineRow = { id: string; runAs?: { principalId: string; name: string }; suspended?: { reason: string } };
type Message = { id: string; kind: string; role: string; access?: { reason: string; routineId?: string; runAsPrincipalId?: string; suspendReason?: string; payer?: string; payerPrincipalId?: string; cause?: string; routine?: boolean }; digest?: { access?: { via: string; payer: string; payerPrincipalId?: string; routine?: boolean } } };

async function routineOf(auth: Auth, id: string): Promise<RoutineRow | undefined> {
  return ((await api("GET", "/api/routines", auth)).body.routines as RoutineRow[] | undefined)?.find((r) => r.id === id);
}
async function runsOf(auth: Auth, routineId: string): Promise<Run[]> {
  return (((await api("GET", "/api/routines", auth)).body.runs ?? []) as Run[]).filter((r) => r.routineId === routineId);
}
/** A run to its end, as a person who may run it. */
async function runNow(auth: Auth, routineId: string): Promise<Run> {
  const started = await api("POST", `/api/routines/${routineId}/run`, auth, {});
  expect(started.status, started.text).toBe(201);
  const id = started.body.run.id as string;
  return waitFor(async () => (await runsOf(auth, routineId)).find((r) => r.id === id && ["completed", "failed", "cancelled"].includes(r.status)), 60_000);
}
/** An open /api/events stream: everything it received so far. */
async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}
type Notified = { kind: string; botId: string; threadId: string; audience?: string[]; routineRunId?: string };
/** The notifications a stream received. */
const notificationsIn = (text: string): Notified[] => text.split("\n")
  .filter((line) => line.startsWith("data: "))
  .flatMap((line) => { try { return [JSON.parse(line.slice(6)) as { kind?: string; notification?: Notified }]; } catch { return []; } })
  .filter((frame) => frame.kind === "notify" && frame.notification)
  .map((frame) => frame.notification!);
type ActivityDetail = { id: string; kind: string; status: string; threadId?: string; steps: unknown[]; access?: Message["access"] };
async function runActivity(auth: Auth, botId: string, runId: string): Promise<{ status: number; item?: ActivityDetail }> {
  const got = await api("GET", `/api/bots/${botId}/activity/item?runId=${encodeURIComponent(runId)}`, auth);
  return { status: got.status, item: got.body.item as ActivityDetail | undefined };
}

async function cardsFor(auth: Auth, threadId: string, routineId: string): Promise<Message[]> {
  const messages = ((await api("GET", `/api/threads/${threadId}/messages`, auth)).body.messages ?? []) as Message[];
  return messages.filter((m) => m.kind === "access" && m.access?.reason === "routine_delegation" && m.access.routineId === routineId);
}
/** The scheduler's file, read while nobody is signed in. */
const onDisk = () => JSON.parse(readFileSync(join(home, ".sagax", "routines.json"), "utf8")) as {
  routines: Array<{ id: string; botId?: string; runAs?: string; suspended?: { reason: string } }>;
  runs: Array<Run & { resultsThreadId?: string; threadId?: string }>;
};
/** The thread a run's turn ran in (its own, else its results thread). */
const runThread = (runId: string) => {
  const run = onDisk().runs.find((r) => r.id === runId);
  return run?.threadId ?? run?.resultsThreadId ?? "";
};
/** The access cards stored in a thread, whoever they are for (read from
 * the message store, not through a viewer). */
const storedAccessCards = (threadId: string): NonNullable<Message["access"]>[] => {
  const db = new DatabaseSync(join(home, ".sagax", "messages.db"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT json FROM messages WHERE thread_id = ? AND kind = 'access'").all(threadId) as Array<{ json: string }>;
    return rows.map((row) => (JSON.parse(row.json) as Message).access!).filter(Boolean);
  } finally {
    db.close();
  }
};
/** Every usage row the server booked (server/usage-ledger.ts). */
const usageRows = () => {
  const dir = join(home, ".sagax", "usage");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort().flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
    access?: string; payerPrincipalId?: string; ownerPrincipalId?: string; trigger?: { kind: string; routineId?: string; runAsPrincipalId?: string; principalId?: string };
  }));
};
const engineEnv = () => (JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env;

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
      SAGAX_ROUTINE_RENEW_SECONDS: String(RENEW_SECONDS),
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

posixOnly("Perspicax organization, slice 6: routines in their person's name", () => {
  let alice: Auth;
  let bob: Auth;
  const ids: Record<string, string> = {};
  let x: { id: string; threadId: string };
  let r1 = "";
  let r1Thread = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.profiles = [PROFILE];
    idp.profilesBySub.set(ALICE.sub, [PROFILE.id]);
    idp.profilesBySub.set(BOB.sub, [PROFILE.id]);
    idp.providerKeys.set(`${ALICE.sub}/anthropic`, ALICE_KEY);
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-routines-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: false },
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_DUMP: dump,
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "perspicax_*", tool: "api_list", arguments: {} }]),
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
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    const created = await api("POST", "/api/bots", alice, { name: "Xavier" });
    expect(created.status, created.text).toBe(201);
    x = { id: created.body.bot.id, threadId: created.body.bot.threadId };
    expect((await api("PATCH", `/api/bots/${x.id}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${x.id}/perspicax`, alice, { profiles: [PROFILE.id] })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "run" })).status).toBe(200);
    // the owner's key reaches the engine only once the directory lists it
    await waitFor(async () => (await api("GET", "/api/me/engines", alice)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myKey === true);
    // the retired org key switch of the old config.json is gone after start
    expect(JSON.parse(readFileSync(join(data, "config.json"), "utf8")).organization ?? {}).not.toHaveProperty("memberBotsUseOrgKey");
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("alice's routines act in her name as soon as she signs in: no consent, nothing to turn off", async () => {
    // a session that is gone is refused (the loopback without any session
    // is refused by the gate before the route)
    const gone = { cookie: `${alice.cookie!.split("=")[0]}=omb_s_gone` };
    // fix 2 contract item 5: a session that expired or was revoked is the
    // gate's 401; no session under service trust (the organization default)
    // is the gate's 403.
    const expired = await api("GET", "/api/org/routine-delegation", gone);
    expect(expired.status, expired.text).toBe(401);
    expect(expired.body.error).toMatch(/^unauthorized: this session has expired or was revoked; /);
    const anonymous = await api("GET", "/api/org/routine-delegation");
    expect(anonymous.status, anonymous.text).toBe(403);
    expect(anonymous.body.error).toMatch(/^forbidden: on this shared server a local request without a session may only use the service routes; /);
    // issued at her sign-in (beforeAll), through the link, never asked
    const status = await waitFor(async () => {
      const got = (await api("GET", "/api/org/routine-delegation", alice)).body;
      return got.state === "active" ? got : null;
    });
    expect(status).toMatchObject({ state: "active", suspended: 0, consentedAt: expect.any(Number), renewedAt: expect.any(Number), principalId: ids.alice });
    expect(status).not.toHaveProperty("manageUrl");
    expect(status.expiresAt - status.renewedAt).toBe(30 * 86_400_000);
    expect(idp.delegationOf(ALICE.sub)).not.toBeNull();
    expect(idp.delegationIssues.filter((issue) => issue.sub === ALICE.sub)).toEqual([{ sub: ALICE.sub, ok: true }]);
    expect(idp.lastAuthorize?.scope ?? "").not.toContain("pulsabot:routines");
    // no consent to start, nothing to revoke from Sagax
    for (const method of ["POST", "DELETE"]) {
      const refused = await api(method, "/api/org/routine-delegation", alice, method === "POST" ? {} : undefined);
      expect(refused.status, refused.text).toBeGreaterThanOrEqual(400);
    }
    expect(idp.delegationOf(ALICE.sub)).not.toBeNull();
  }, 30_000);

  it("scenario D: her routine runs while she has no session, on her key and her delegation", async () => {
    const routine = await api("POST", "/api/routines", alice, { name: "Hourly report", botId: x.id, prompt: "Write the hourly report.", postResults: true,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 4_000 } });
    expect(routine.status, routine.text).toBe(201);
    r1 = routine.body.routine.id;
    expect(routine.body.routine.runAs).toEqual({ principalId: ids.alice, name: "Alice" });
    // alice signs out of her only session before the routine is due
    expect((await api("POST", "/api/auth/logout", alice, {})).status).toBe(200);
    expect((await api("GET", "/api/org/routine-delegation", alice)).status).toBe(401);
    if (existsSync(dump)) rmSync(dump);
    const exchangesBefore = idp.exchanges.length;
    const refreshesBefore = idp.refreshes.length;
    const run = await waitFor(async () => existsSync(join(home, ".sagax", "routines.json")) &&
      onDisk().runs.find((r) => r.routineId === r1 && ["completed", "failed"].includes(r.status)), 60_000);
    expect(run.status, run.error).toBe("completed");
    expect(run.runAs).toBe(ids.alice);
    expect(engineEnv().ANTHROPIC_API_KEY).toBe(ALICE_KEY);
    const exchanges = idp.exchanges.slice(exchangesBefore);
    expect(exchanges.map((e) => ({ sub: e.sub, ok: e.ok }))).toEqual([{ sub: ALICE.sub, ok: true }]);
    expect(idp.mcpRequests.filter((r) => r.method === "POST" && r.sub === ALICE.sub).length).toBeGreaterThan(0);
    await waitFor(async () => idp.exchangeRevoked.includes(exchanges[0]!.token!));
    // within the renewal window: nothing refreshed
    expect(idp.refreshes.slice(refreshesBefore).filter((r) => r.delegation)).toEqual([]);
    alice = await signIn(ALICE);
    r1Thread = run.resultsThreadId ?? x.threadId;
    // her report is in the results thread when she is back
    const report = ((await api("GET", `/api/threads/${r1Thread}/messages`, alice)).body.messages ?? []) as Array<{ kind: string }>;
    expect(report.some((m) => m.kind === "routine.run")).toBe(true);
  }, 90_000);

  it("a second run within the window reuses the renewal", async () => {
    const refreshesBefore = idp.refreshes.length;
    const run = await runNow(alice, r1);
    expect(run.status, run.error).toBe("completed");
    expect(idp.refreshes.slice(refreshesBefore).filter((r) => r.delegation)).toEqual([]);
  }, 90_000);

  it("Perspicax unreachable skips the run and keeps the routine", async () => {
    // past the window, the next run renews: make that refresh fail once
    await sleep(RENEW_SECONDS * 1000 + 500);
    idp.failNextToken(503);
    const failed = await runNow(alice, r1);
    expect(failed).toMatchObject({ status: "failed", error: "Perspicax is unreachable; this run is skipped" });
    expect((await routineOf(alice, r1))?.suspended).toBeUndefined();
    const refreshesBefore = idp.refreshes.length;
    const again = await runNow(alice, r1);
    expect(again.status, again.error).toBe("completed");
    expect(idp.refreshes.slice(refreshesBefore)).toEqual([expect.objectContaining({ sub: ALICE.sub, delegation: true })]);
    expect((await api("GET", "/api/org/routine-delegation", alice)).body.state).toBe("active");
  }, 150_000);

  it("a revoke in the console never pauses the routine: the next run gets a new delegation from her session", async () => {
    const cardsBefore = (await cardsFor(alice, r1Thread, r1)).length;
    const issuesBefore = idp.delegationIssues.length;
    expect(idp.revokeDelegation(ALICE.sub)).toBe(1);
    // the directory reports it within a poll; Sagax drops its copy
    await waitFor(async () => (await api("GET", "/api/org/routine-delegation", alice)).body.state === "none", 20_000);
    expect((await routineOf(alice, r1))?.suspended).toBeUndefined();
    const run = await runNow(alice, r1);
    expect(run.status, run.error).toBe("completed");
    expect(idp.delegationIssues.slice(issuesBefore)).toEqual([{ sub: ALICE.sub, ok: true }]);
    expect(idp.delegationOf(ALICE.sub)).not.toBeNull();
    expect((await api("GET", "/api/org/routine-delegation", alice)).body.state).toBe("active");
    expect((await routineOf(alice, r1))?.suspended).toBeUndefined();
    expect(await cardsFor(alice, r1Thread, r1)).toHaveLength(cardsBefore);
  }, 90_000);

  it("bob's routine on alice's bot runs as bob, on alice's key, then pauses no_right", async () => {
    const refreshesBefore = idp.refreshes.length;
    bob = await signIn(BOB);
    // his own delegation comes with his sign-in, never asked
    await waitFor(async () => idp.delegationOf(BOB.sub) !== null);
    const created = await api("POST", "/api/routines", bob, { name: "Bob's check", botId: x.id, prompt: "Check for Bob.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(created.status, created.text).toBe(201);
    const r2 = created.body.routine.id as string;
    expect(created.body.routine.runAs).toEqual({ principalId: ids.bob, name: "Bob" });
    expect((await routineOf(bob, r2))?.suspended).toBeUndefined();
    // alice's delegation was not touched for bob's routine
    expect(idp.refreshes.slice(refreshesBefore).filter((r) => r.sub === ALICE.sub && r.delegation)).toEqual([]);
    // bob has his own subscription and key: they never pay for the bot's routine
    idp.providerKeys.set(`${BOB.sub}/anthropic`, BOB_KEY);
    const bobLogin = join(home, ".sagax", "principals", ids.bob!, "claude");
    mkdirSync(bobLogin, { recursive: true, mode: 0o700 });
    writeFileSync(join(bobLogin, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    bob = await signIn(BOB);
    await waitFor(async () => {
      const claude = (await api("GET", "/api/me/engines", bob)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude");
      return claude?.myKey === true && claude?.myTurns === "subscription";
    });
    if (existsSync(dump)) rmSync(dump);
    const exchangesBefore = idp.exchanges.length;
    const ran = await runNow(bob, r2);
    expect(ran.status, ran.error).toBe("completed");
    expect(idp.exchanges.slice(exchangesBefore).map((e) => e.sub)).toEqual([BOB.sub]);
    expect(engineEnv().ANTHROPIC_API_KEY).toBe(ALICE_KEY);
    expect(engineEnv().CLAUDE_CONFIG_DIR ?? "").not.toContain(ids.bob!);
    expect(idp.resolveRequests.at(-1)).toEqual({ sub: ALICE.sub, provider: "anthropic" });
    expect(log).not.toContain(BOB_KEY);
    // the usage ledger says the owner's key paid for this run
    const paid = await waitFor(async () => usageRows().findLast((row) => row.trigger?.kind === "routine" && row.trigger.routineId === r2) ?? null, 15_000);
    expect(paid).toMatchObject({ access: "owner-key", payerPrincipalId: ids.alice, ownerPrincipalId: ids.alice, trigger: { runAsPrincipalId: ids.bob } });
    // bob speaking to the same bot himself (his own private thread): his own
    // subscription, no key at all
    rmSync(dump);
    const own = await api("POST", `/api/bots/${x.id}/tasks`, bob, { title: "Bob's own" });
    expect(own.status, own.text).toBe(201);
    const asked = await api("POST", `/api/bots/${x.id}/messages`, bob, { text: "bob asks himself", threadId: own.body.task.threadId });
    expect(asked.status, asked.text).toBe(202);
    await waitFor(async () => existsSync(dump) && JSON.stringify(JSON.parse(readFileSync(dump, "utf8")).prompt).includes("bob asks himself"), 30_000);
    expect(engineEnv().CLAUDE_CONFIG_DIR).toBe(bobLogin);
    expect(engineEnv().ANTHROPIC_API_KEY).toBeUndefined();
    // bob loses run: the next run pauses the routine no_right
    expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    const refused = await runNow(alice, r2);
    expect(refused).toMatchObject({ status: "failed", error: "Bob can no longer run this bot's routines" });
    expect((await routineOf(alice, r2))?.suspended?.reason).toBe("no_right");
    // alice rewrites its work: it runs as alice now
    const edited = await api("PATCH", `/api/routines/${r2}`, alice, { prompt: "Check for Alice." });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.routine.runAs).toEqual({ principalId: ids.alice, name: "Alice" });
    expect(edited.body.routine.suspended).toBeUndefined();
  }, 150_000);

  it("a routine a shared editor rewrote and starts runs on the owner's credentials: none, refused with the owner's card", async () => {
    const r2 = onDisk().routines.find((r) => r.id !== r1 && r.botId === x.id)!.id;
    expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "edit" })).status).toBe(200);
    bob = await signIn(BOB);
    const edited = await api("PATCH", `/api/routines/${r2}`, bob, { prompt: "Check for Bob again." });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.routine.runAs).toEqual({ principalId: ids.bob, name: "Bob" });
    // alice's key leaves Perspicax; bob still has his subscription and key
    idp.providerKeys.delete(`${ALICE.sub}/anthropic`);
    alice = await signIn(ALICE);
    await waitFor(async () => (await api("GET", "/api/me/engines", alice)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myKey === false);
    if (existsSync(dump)) rmSync(dump);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const refused = await runNow(bob, r2);
    expect(refused.status).toBe("failed");
    expect(existsSync(dump)).toBe(false);
    // the run's thread is bob's (its runAs, private threads). 2026-10-01: the
    // card is the owner's alone (her credentials are missing), so bob, who
    // started the run, sees none; alice is notified
    const thread = runThread(refused.id);
    await waitFor(async () => log.includes(`refused: no_access/no_credentials`));
    const stored = storedAccessCards(thread).findLast((access) => access.reason === "no_access");
    expect(stored).toMatchObject({ payer: "owner", payerPrincipalId: ids.alice, routine: true, cause: "no_credentials" });
    const bobView = ((await api("GET", `/api/threads/${thread}/messages`, bob)).body.messages ?? []) as Message[];
    expect(bobView.some((m) => m.kind === "access" && m.access?.reason === "no_access")).toBe(false);
    // alice still cannot read bob's private thread
    const aliceThread = await api("GET", `/api/threads/${thread}/messages`, alice);
    expect(((aliceThread.body.messages ?? []) as Message[]).some((m) => m.kind === "access")).toBe(false);
    // her notification names no thread, only the run: it opens the bot's
    // Coding activity; bob, not in the card's audience, gets none
    const notified = await waitFor(async () => notificationsIn(aliceStream.text()).find((n) => n.routineRunId === refused.id) ?? null, 15_000);
    expect(notified).toMatchObject({ kind: "turn-failed", botId: x.id, threadId: "", audience: [ids.alice] });
    expect(notificationsIn(aliceStream.text()).some((n) => n.threadId === thread)).toBe(false);
    expect(notificationsIn(bobStream.text()).some((n) => n.routineRunId === refused.id || (n.kind === "turn-failed" && n.threadId === thread))).toBe(false);
    aliceStream.close();
    bobStream.close();
    // there, the run carries her card with its actions (her subscription,
    // her key in Perspicax), and nothing of bob's thread
    const ownerView = await runActivity(alice, x.id, refused.id);
    expect(ownerView.status).toBe(200);
    expect(ownerView.item).toMatchObject({ id: `run:${refused.id}`, kind: "routine", status: "failed", steps: [] });
    expect(ownerView.item!.threadId).toBeUndefined();
    expect(ownerView.item!.access).toMatchObject({ reason: "no_access", payer: "owner", payerPrincipalId: ids.alice, routine: true, cause: "no_credentials", subscriptionSignIn: true, keysUrl: expect.any(String) });
    // bob reads his run (and his thread) without her card
    const runAsView = await runActivity(bob, x.id, refused.id);
    expect(runAsView.status).toBe(200);
    expect(runAsView.item!.threadId).toBe(thread);
    expect(runAsView.item!.access).toBeUndefined();
    // carol, who neither owns the bot nor runs the routine, does not see the run
    const carol = await signIn(CAROL);
    expect((await runActivity(carol, x.id, refused.id)).status).not.toBe(200);
    // the key is back for what follows
    idp.providerKeys.set(`${ALICE.sub}/anthropic`, ALICE_KEY);
    alice = await signIn(ALICE);
    await waitFor(async () => (await api("GET", "/api/me/engines", alice)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myKey === true);
  }, 120_000);

  it("a room bob creates without naming its people is his to see, and a room goal on it is his", async () => {
    const own = await api("POST", "/api/bots", bob, { name: "Yann" });
    expect(own.status, own.text).toBe(201);
    const room = await api("POST", "/api/groups", bob, { name: "Bob's room", memberIds: [own.body.bot.id], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    expect(((await api("GET", "/api/groups", bob)).body.groups as Array<{ id: string }>).map((g) => g.id)).toContain(roomId);
    // carol, not listed, does not see it
    const carol = await signIn(CAROL);
    expect(((await api("GET", "/api/groups", carol)).body.groups as Array<{ id: string }>).map((g) => g.id)).not.toContain(roomId);
    const schedule = { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 };
    const noRoom = await api("POST", "/api/routines", bob, { name: "Goal", botId: own.body.bot.id, prompt: "Plan.", target: "room-goal", enabled: false, schedule });
    expect(noRoom.status, noRoom.text).toBe(400);
    expect(noRoom.body.error).toBe("Choose a room for this goal");
    const goal = await api("POST", "/api/routines", bob, { name: "Goal", botId: own.body.bot.id, prompt: "Plan.", target: "room-goal", groupId: roomId, enabled: false, schedule });
    expect(goal.status, goal.text).toBe(201);
    expect(goal.body.routine.runAs).toEqual({ principalId: ids.bob, name: "Bob" });
    expect(goal.body.routine.suspended).toBeUndefined();
  }, 60_000);

  it("a Perspicax that cannot issue a delegation only skips the run: never paused, no card", async () => {
    idp.tamper = { noDelegationExchange: true };
    try {
      const carol = await signIn(CAROL);
      // her delegation from an earlier sign-in ends in the console; this
      // Perspicax cannot issue her a new one
      idp.revokeDelegation(CAROL.sub);
      await waitFor(async () => (await api("GET", "/api/org/routine-delegation", carol)).body.state === "none", 20_000);
      const own = await api("POST", "/api/bots", carol, { name: "Zoe" });
      expect(own.status, own.text).toBe(201);
      const created = await api("POST", "/api/routines", carol, { name: "Carol's check", botId: own.body.bot.id, prompt: "Check.", enabled: false,
        schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
      expect(created.status, created.text).toBe(201);
      const r3 = created.body.routine.id as string;
      const skipped = await runNow(carol, r3);
      expect(skipped).toMatchObject({ status: "failed", error: "Perspicax did not issue Carol's routine access yet; this run is skipped and the next one tries again" });
      expect(idp.delegationIssues.filter((issue) => issue.sub === CAROL.sub).at(-1)).toEqual({ sub: CAROL.sub, ok: false, error: "invalid_request" });
      expect((await routineOf(carol, r3))?.suspended).toBeUndefined();
      expect(onDisk().routines.find((r) => r.id === r3)?.suspended).toBeUndefined();
      expect(storedAccessCards(own.body.bot.threadId).filter((access) => access.reason === "routine_delegation")).toEqual([]);
      expect(idp.delegationOf(CAROL.sub)).toBeNull();
    } finally {
      idp.tamper = {};
    }
  }, 60_000);

  it("a disable in Perspicax pauses her routine person_out, and no run follows", async () => {
    idp.disable(ALICE.sub);
    idp.setDirectoryStatus(ALICE.sub, "disabled");
    await waitFor(async () => onDisk().routines.find((r) => r.id === r1)?.suspended?.reason === "person_out");
    expect(idp.delegationOf(ALICE.sub)).toBeNull();
    const runs = onDisk().runs.filter((r) => r.routineId === r1).length;
    // the scheduler ticks every 10 s: nothing new for R1 over a tick
    await sleep(12_000);
    expect(onDisk().runs.filter((r) => r.routineId === r1).length).toBe(runs);
    // bob's run of a routine of her bot (it acts as bob): refused, her
    // credentials are off, and never bob's own instead
    const r2 = onDisk().routines.find((r) => r.botId === x.id && r.id !== r1 && r.runAs === ids.bob)?.id;
    expect(r2).toBeTruthy();
    if (existsSync(dump)) rmSync(dump);
    const refused = await runNow(bob, r2!);
    expect(refused.status).toBe("failed");
    expect(existsSync(dump)).toBe(false);
    const thread = runThread(refused.id);
    const stored = await waitFor(async () => storedAccessCards(thread).findLast((access) => access.cause === "payer_disabled") ?? null);
    expect(stored).toMatchObject({ reason: "no_access", payer: "owner", payerPrincipalId: ids.alice, routine: true });
    // the owner's card: bob, who started the run, does not get it
    const bobView = ((await api("GET", `/api/threads/${thread}/messages`, bob)).body.messages ?? []) as Message[];
    expect(bobView.some((m) => m.kind === "access" && m.access?.cause === "payer_disabled")).toBe(false);
  }, 60_000);

  it("never writes a refresh or access token in clear", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        else if (stat.isFile() && /pxl[ro]1\./.test(readFileSync(path, "latin1"))) hits.push(path);
      }
    };
    walk(join(home, ".sagax"));
    if (existsSync(dump)) walk(dirname(dump));
    expect(hits.filter((path) => !path.startsWith(join(home, "link")))).toEqual([]);
    expect(log).not.toMatch(/pxl[ro]1\./);
  });
});
