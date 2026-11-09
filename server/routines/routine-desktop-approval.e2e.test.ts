// 2026-11-04 (a person: "when a bot requires an approval card while running
// a routine, I can only approve them on my iPhone; I get no card visible
// from Sagax desktop"). The phone reads every waiting task's cards itself;
// the desktop reads the Approvals inbox, the live stream and the cards of
// the conversations it shows. On a real organization server (Perspicax
// identity, fake OIDC, an engine that holds its turn so the test asks its
// permission broker like an engine):
//
//   R1  a routine whose run-as is the person: the card of its run is in the
//       person's Approvals, decidable, naming the bot and the routine; the
//       stream brings that session the card (with its requestId) and the
//       approval notification; the run's task waits on the person (what the
//       desktop badge and chat box read); an Allow from Approvals reaches
//       the engine and the run goes on
//   R2  a team routine (a room goal) run as the person: the same in the
//       room's conversation, a Deny from the room's card reaches the engine
import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { openSse } from "../testing/sse.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE: FakeOidcUser = { sub: "01J9RDALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9RDBOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}), origin: BASE },
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

posixOnly("a routine run's approval reaches the desktop (Approvals, stream, waiting task)", () => {
  let alice: Auth;
  let aliceId = "";
  const dumpPath = () => join(home, "hold-dump.json");
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-routine-desktop-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({ version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: { hold: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: dumpPath() }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } } },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { SAGAX_TEST_FIXED_WORKSPACE: "1", ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600", SAGAX_ANTHROPIC_API_KEY: ORG_KEY, SAGAX_ORG_NAME: "Acme" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => { try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; } }, 60_000);
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 2 ? got : null;
    });
    aliceId = people.find((person) => person.login === "alice")!.principalId;
  }, 90_000);
  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  /** A bot of the person on the held engine, at Ask so its calls draw a card. */
  async function holdBot(name: string) {
    const created = await api("POST", "/api/bots", alice, { name });
    expect(created.status, created.text).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };
    expect((await api("PATCH", `/api/bots/${bot.id}`, alice, { modelSelection: { instanceId: "hold", model: "fake-model" }, approvalMode: "ask" })).status).toBe(200);
    return bot;
  }

  /** The run's live turn: its permission broker, asked like an engine. */
  async function brokerOfRun() {
    await waitFor(async () => existsSync(dumpPath()), 30_000);
    const mcp = JSON.parse(readFileSync(dumpPath(), "utf8")).mcpConfig.mcpServers;
    const socket: Socket = connect(mcp.ogb.args.at(-1));
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    let answer: any;
    let buffer = "";
    socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
    const ask = (id: string) => socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool: "WebFetch", input: { url: "https://example.com/report", prompt: "read" } }) + "\n");
    return { ask, answer: () => answer, close: () => socket.destroy() };
  }

  async function startRun(body: Record<string, unknown>) {
    rmSync(dumpPath(), { force: true });
    const created = await api("POST", "/api/routines", alice, { prompt: "Sweep the board.", enabled: false, schedule: { type: "cron", expression: "30 18 * * 1-5", timeZone: "America/Toronto" }, ...body });
    expect(created.status, created.text).toBe(201);
    const started = await api("POST", `/api/routines/${created.body.routine.id}/run`, alice);
    expect(started.status, started.text).toBe(201);
    return started.body.run as { id: string };
  }

  const runOf = async (id: string) => ((await api("GET", "/api/routines", alice)).body.runs as any[]).find((run) => run.id === id);

  it("R1: a routine run as the person: Approvals (bot and routine named, decidable), the stream's card and notification, the waiting task, Allow from Approvals goes on", async () => {
    const bot = await holdBot("Scout");
    const stream = await openSse(`${BASE}/api/events`, { cookie: alice.cookie!, origin: BASE });
    const broker = await (async () => {
      const run = await startRun({ name: "Morning sweep", botId: bot.id });
      const b = await brokerOfRun();
      return { ...b, run };
    })();
    try {
      const requestId = "rd-r1-1";
      broker.ask(requestId);
      const live = await waitFor(async () => { const run = await runOf(broker.run.id); return run?.threadId ? run : null; });
      expect(live.runAs).toBe(aliceId);

      // (1) Approvals: the run's card, decidable, the bot and the routine named
      const row = await waitFor(async () => ((await api("GET", "/api/approvals", alice)).body.pending as any[]).find((entry) => entry.requestId === requestId));
      expect(row).toMatchObject({ threadId: live.threadId, botName: "Scout", routineName: "Morning sweep", scope: "mine", kind: "permission", decidable: true });
      expect(row.message?.card?.requestId).toBe(requestId);

      // (2)(3) the stream brings this session the card and the notification
      await stream.until((frame) => frame.kind === "message" && frame.threadId === live.threadId && frame.message?.card?.requestId === requestId, 10_000);
      // the card is mirrored into the bot's own chat (nothing invisible, #2901);
      // the banner opens on that view, which answers through the run's card
      const mirror = await waitFor(async () => ((await api("GET", `/api/threads/${bot.threadId}/messages?limit=60`, alice)).body.messages as any[])
        .find((message) => message.card?.approvalOrigin?.requestId === requestId));
      const notice = await stream.until((frame) => frame.kind === "notify" && frame.notification?.kind === "approval" && frame.notification.requestId === mirror.card.requestId, 10_000);
      expect(notice.notification).toMatchObject({ threadId: bot.threadId, botId: bot.id, cardId: mirror.id });

      // the run's hidden task waits on the person: the desktop badge and the
      // chat's approval box read it from /api/bots
      const task = (await api("GET", "/api/bots?messages=0", alice)).body.bots.find((entry: any) => entry.id === bot.id).tasks.find((entry: any) => entry.threadId === live.threadId);
      expect(task).toMatchObject({ routineRunId: broker.run.id, activity: "waiting-on-you" });
      // the run sheet reads the run's own thread
      const page = await api("GET", `/api/threads/${live.threadId}/messages?limit=60`, alice);
      expect((page.body.messages as any[]).find((message) => message.card?.requestId === requestId)?.card).toMatchObject({ requestType: "permission", tool: "WebFetch" });

      // (4) Allow from Approvals: the engine hears it, the run goes on
      const answered = await api("POST", "/api/approvals/bulk", alice, { decision: "allow", items: [{ threadId: live.threadId, requestId }] });
      expect(answered.body, answered.text).toMatchObject({ answered: 1 });
      await waitFor(async () => broker.answer());
      expect(broker.answer()).toMatchObject({ id: requestId, behavior: "allow" });
      expect((await runOf(broker.run.id)).status).toBe("running");
      expect(((await api("GET", "/api/approvals", alice)).body.pending as any[]).some((entry) => entry.requestId === requestId)).toBe(false);
    } finally {
      broker.close();
      stream.close();
      await api("POST", `/api/routine-runs/${broker.run.id}/cancel`, alice).catch(() => undefined);
      await api("POST", `/api/bots/${bot.id}/interrupt`, alice, {}).catch(() => undefined);
    }
  }, 120_000);

  it("R2: a team routine (a room goal) run as the person: Approvals names the room, the stream brings the card and the notification, Deny from the card goes to the engine", async () => {
    const bot = await holdBot("Lead");
    await waitFor(async () => !((await api("GET", "/api/bots", alice)).body.bots as Array<{ busy?: boolean }>).some((entry) => entry.busy), 30_000);
    const room = await api("POST", "/api/groups", alice, { name: "Ops room", memberIds: [bot.id], humanIds: [aliceId], setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } } });
    expect(room.status, room.text).toBeLessThan(300);
    const stream = await openSse(`${BASE}/api/events`, { cookie: alice.cookie!, origin: BASE });
    const run = await startRun({ name: "Team review", botId: bot.id, target: "room-goal", groupId: room.body.group.id });
    const broker = await brokerOfRun();
    try {
      const requestId = "rd-r2-1";
      broker.ask(requestId);
      const row = await waitFor(async () => ((await api("GET", "/api/approvals", alice)).body.pending as any[]).find((entry) => entry.requestId === requestId));
      expect(row).toMatchObject({ botName: "Lead", roomName: "Ops room", kind: "permission", decidable: true });
      expect((await runOf(run.id)).runAs).toBe(aliceId);
      await stream.until((frame) => frame.kind === "message" && frame.threadId === row.threadId && frame.message?.card?.requestId === requestId, 10_000);
      await stream.until((frame) => frame.kind === "notify" && frame.notification?.kind === "approval" && frame.notification.requestId === requestId, 10_000);
      const denied = await api("POST", `/api/threads/${row.threadId}/respond`, alice, { requestId, behavior: "deny" });
      expect(denied.status, denied.text).toBe(200);
      await waitFor(async () => broker.answer());
      expect(broker.answer()).toMatchObject({ id: requestId, behavior: "deny" });
    } finally {
      broker.close();
      stream.close();
      await api("POST", `/api/routine-runs/${run.id}/cancel`, alice).catch(() => undefined);
    }
  }, 120_000);
});
