// #3346 (connectors across engines, L3): a permission request the server
// holds itself, outside any engine, decided by the same request.opened
// pipeline as an engine's ask.
//
//   bus      a held id is answered by the server and never reaches the
//            engine; an id nobody holds (a restart) is "unavailable"; an
//            adapter cannot set connectorHub; the turn's end declines
//   server   through the real organization server and the fake Claude CLI:
//            a connector read passes with no card at Ask; a send shows one
//            card at Ask and at Auto, with Always allow; Deny declines;
//            Always allow answers the next identical request; Full passes;
//            an org Refuse rule refuses; a member's bot gets the member's
//            own card, never an admin card; the card expires when the turn
//            ends; an answer after a restart is "unavailable"
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { makeFakeDriver } from "../testing/fake-driver.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { EventBus } from "./bus.ts";
import { HELD_REQUEST_EXPIRED, HeldRequests, isHeldRequestId } from "./held-requests.ts";

describe("#3346: held requests on the bus", () => {
  async function setup() {
    const fake = makeFakeDriver({ kind: "claudeAgent" });
    const engineAnswers: string[] = [];
    await fake.driver.create({ instanceId: "engine-1", displayName: undefined, environment: {}, enabled: true, config: {} });
    const { instance, emit } = fake.created.get("engine-1")!;
    instance.adapter.respondToRequest = async (_threadId, requestId) => { engineAnswers.push(requestId); return "allowed-once"; };
    const bus = new EventBus(async () => {});
    const seen: RuntimeEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    const held = new HeldRequests((event) => bus.publish(event));
    bus.setHeldRequests(held);
    bus.attach([instance]);
    return { bus, held, instance, emit, seen, engineAnswers };
  }
  const base = { threadId: "thread-1", turnId: "turn-1", providerInstanceId: "engine-1", provider: "claudeAgent", mcpTool: "crm__send_email", outbound: true };

  it("opens a request.opened with the connector facts and connectorHub, answered by the server, never the engine", async () => {
    const { held, instance, seen, engineAnswers } = await setup();
    const { requestId, decision } = held.open(base);
    expect(isHeldRequestId(requestId)).toBe(true);
    const opened = seen.find((event) => event.type === "request.opened") as any;
    expect(opened).toMatchObject({ requestId, mcpTool: "crm__send_email", engineConnector: true, accountConnector: true, connectorHub: true, outbound: true, turnId: "turn-1" });
    expect(await instance.adapter.respondToRequest("thread-1", requestId, { behavior: "allow" })).toBe("allowed-once");
    expect(await decision).toEqual({ behavior: "allow" });
    expect(engineAnswers).toEqual([]);
    expect(seen.find((event) => event.type === "request.resolved")).toMatchObject({ requestId, behavior: "allow", source: "user" });
    // an engine's own id still reaches the engine
    expect(await instance.adapter.respondToRequest("thread-1", "engine-req-1", { behavior: "allow" })).toBe("allowed-once");
    expect(engineAnswers).toEqual(["engine-req-1"]);
  });

  it("deny declines; a held id answered twice, from another thread, or after a restart is unavailable", async () => {
    const { held, instance } = await setup();
    const first = held.open(base);
    expect(await instance.adapter.respondToRequest("thread-2", first.requestId, { behavior: "allow" })).toBe("unavailable");
    expect(await instance.adapter.respondToRequest("thread-1", first.requestId, { behavior: "deny" })).toBe("rejected");
    expect((await first.decision).behavior).toBe("deny");
    expect(await instance.adapter.respondToRequest("thread-1", first.requestId, { behavior: "allow" })).toBe("unavailable");
    // a restart: a fresh process knows no held id
    const second = held.open(base);
    const restarted = await setup();
    expect(await restarted.instance.adapter.respondToRequest("thread-1", second.requestId, { behavior: "allow" })).toBe("unavailable");
  });

  it("an adapter cannot claim connectorHub: the bus drops it", async () => {
    const { emit, seen } = await setup();
    emit({ eventId: "e1", provider: "claudeAgent", threadId: "thread-1", createdAt: new Date().toISOString(), type: "request.opened", requestId: "engine-req-2", requestType: "permission", tool: "other", mcpTool: "crm__send_email", engineConnector: true, accountConnector: true, connectorHub: true } as RuntimeEvent);
    const opened = seen.find((event) => event.type === "request.opened" && event.requestId === "engine-req-2") as any;
    expect(opened).toBeTruthy();
    expect("connectorHub" in opened).toBe(false);
  });

  it("the turn's end declines what it still holds, as a timeout, and only that turn's", async () => {
    const { held, seen } = await setup();
    const mine = held.open(base);
    const other = held.open({ ...base, turnId: "turn-2" });
    held.retireTurn("thread-1", "turn-1");
    expect(await mine.decision).toEqual({ behavior: "deny", message: HELD_REQUEST_EXPIRED });
    expect(seen.find((event) => event.type === "request.resolved" && event.requestId === mine.requestId)).toMatchObject({ behavior: "deny", source: "timeout" });
    expect(held.openCount("thread-1")).toBe(1);
    held.retireTurn("thread-1");
    expect((await other.decision).behavior).toBe("deny");
    expect(held.openCount()).toBe(0);
  });
});

describe("#4081: a request decided as the engine's own ask (the sandbox bridge)", () => {
  async function bus() {
    const fake = makeFakeDriver({ kind: "claudeAgent" });
    await fake.driver.create({ instanceId: "engine-1", displayName: undefined, environment: {}, enabled: true, config: {} });
    const { instance } = fake.created.get("engine-1")!;
    instance.adapter.respondToRequest = async () => "allowed-once";
    const events = new EventBus(async () => {});
    const seen: RuntimeEvent[] = [];
    events.subscribe((event) => seen.push(event));
    const held = new HeldRequests((event) => events.publish(event));
    events.setHeldRequests(held);
    events.attach([instance]);
    return { held, instance, seen };
  }
  const call = { threadId: "thread-1", turnId: "turn-1", providerInstanceId: "engine-1", provider: "claudeAgent", mcpTool: "mcp__perspicax__api_search", input: "{\"query\":\"open\"}", asEngine: true };

  it("names the tool as the engine does and carries no connector fact", async () => {
    const { held, seen } = await bus();
    held.open({ ...call, outbound: true });
    const opened = seen.find((event) => event.type === "request.opened") as any;
    expect(opened).toMatchObject({ tool: "mcp__perspicax__api_search", mcpTool: "mcp__perspicax__api_search" });
    for (const fact of ["engineConnector", "accountConnector", "connectorHub", "outbound"]) expect(fact in opened).toBe(false);
  });

  it("a burst of the same call waits on one request; another input opens its own", async () => {
    const { held, instance, seen } = await bus();
    const first = held.open(call);
    const again = held.open(call);
    const other = held.open({ ...call, input: "{\"query\":\"closed\"}" });
    expect(again.requestId).toBe(first.requestId);
    expect(other.requestId).not.toBe(first.requestId);
    expect(seen.filter((event) => event.type === "request.opened")).toHaveLength(2);
    await instance.adapter.respondToRequest("thread-1", first.requestId, { behavior: "allow" });
    expect(await first.decision).toEqual({ behavior: "allow" });
    expect(await again.decision).toEqual({ behavior: "allow" });
    // settled: the next identical call is a request of its own
    expect(held.open(call).requestId).not.toBe(first.requestId);
  });
});

// ── through the real organization server ─────────────────────────────

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const CAPABILITY = "held-requests-fixture-capability-key-0001";
const ADMIN: FakeOidcUser = { sub: "01J9HRADMIN0000000000000A", email: "admin@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const MEMBER: FakeOidcUser = { sub: "01J9HRMEMBER000000000000M", email: "member@example.test", name: "Max", preferred_username: "max", role: "employee" };
const READ = "crm__list_contacts";
const SEND = "crm__send_email";
const REFUSED = "crm__delete_contact";

let PORT = 0;
let BASE = "";
let child: ChildProcess | undefined;
let home = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; bearer?: string };
type Bot = { id: string; threadId: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, auth?: Auth, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
      origin: BASE,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const pair = (setCookie: string) => setCookie.split(";")[0]!;
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = pair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: pair(session!) };
}

const dumpOf = (instanceId: string) => join(home, `${instanceId}-dump.json`);
const releaseFile = () => join(home, "release");

async function startServer() {
  log = "";
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: { SAGAX_TEST_FIXED_WORKSPACE: "1",
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
      SAGAX_ORG_NAME: "Acme",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
  }, 60_000);
}

async function stopServer() {
  const running = child;
  child = undefined;
  if (!running) return;
  running.kill("SIGTERM");
  await waitForExit(running);
}

posixOnly("#3346: server-held requests through the organization server", () => {
  let admin: Auth;
  let member: Auth;
  const adminConsole = (): Auth => ({ bearer: idp.consoleAssertion({ sub: ADMIN.sub, aud: BASE, role: "admin", teams: [] }) });

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, MEMBER].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-held-requests-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    const hang = (instanceId: string, extra: Record<string, string> = {}) => ({
      driver: "claudeAgent", access: "api",
      environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: dumpOf(instanceId), ...extra },
      config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true },
    });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true, allowFullAccess: true },
      instances: {
        // a turn that waits until it is stopped
        hold: hang("hold"),
        // a turn that ends on its own once the release file exists
        ends: hang("ends", { FAKE_CLAUDE_RELEASE: releaseFile() }),
      },
    }));
    await startServer();
    admin = await signIn(ADMIN);
    member = await signIn(MEMBER);
    await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", admin)).body.people as unknown[] | undefined;
      return got && got.length === 2;
    });
  }, 90_000);

  afterAll(async () => {
    await stopServer();
    await idp?.close();
    if (home) removeTempDir(home);
  });

  async function botOf(auth: Auth, name: string, approvalMode: "ask" | "auto" | "full", instanceId = "hold"): Promise<Bot> {
    const created = await waitFor(async () => {
      const got = await api("POST", "/api/bots", auth, { name });
      return got.status === 201 ? got : null;
    });
    const bot = { id: created.body.bot.id as string, threadId: created.body.bot.threadId as string };
    const model = await api("PATCH", `/api/bots/${bot.id}`, auth, { modelSelection: { instanceId, model: "fake-model" } });
    expect(model.status, model.text).toBe(200);
    const level = approvalMode === "full" ? { approvalMode, confirmFullAccess: true } : { approvalMode };
    const botLevel = await api("PATCH", `/api/bots/${bot.id}`, auth, level);
    expect(botLevel.status, botLevel.text).toBe(200);
    const taskLevel = await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, auth, level);
    expect(taskLevel.status, taskLevel.text).toBe(200);
    return bot;
  }

  /** Start a turn of `bot` that waits, on the fake Claude CLI. */
  async function startTurn(auth: Auth, bot: Bot, instanceId = "hold") {
    rmSync(dumpOf(instanceId), { force: true });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text: "Fais le suivi du client.", threadId: bot.threadId });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => existsSync(dumpOf(instanceId)), 30_000);
  }

  /** The server holds a connector call for the bot's running turn. The
   * promise settles once the request is decided. */
  function hold(bot: Bot, mcpTool: string, outbound?: boolean, asEngine?: boolean): Promise<{ status: number; body: any; text: string }> {
    // like the capability route: no session, only the private test key; the
    // principal is the turn's, never the caller's
    return api("POST", "/api/testing/held-request", undefined, {
      threadId: bot.threadId, mcpTool, summary: `Call ${mcpTool}`, input: JSON.stringify({ to: "client" }), ...(outbound ? { outbound: true } : {}), ...(asEngine ? { asEngine: true } : {}),
    }, { "x-openmausbot-test-capability": CAPABILITY });
  }
  /** #4081: what the sandbox bridge opens for a script's Perspicax call. */
  const bridged = (bot: Bot, tool: string) => hold(bot, `mcp__perspicax__${tool}`, false, true);

  const messages = async (auth: Auth, bot: Bot) => ((await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`, auth)).body.messages ?? []) as any[];
  const heldCards = async (auth: Auth, bot: Bot) => (await messages(auth, bot)).filter((m) => m.card?.requestType === "permission" && typeof m.card.requestId === "string" && isHeldRequestId(m.card.requestId)).map((m) => m.card);
  const cardFor = async (auth: Auth, bot: Bot, requestId?: string) => waitFor(async () => {
    const cards = await heldCards(auth, bot);
    return (requestId ? cards.find((card) => card.requestId === requestId) : cards.find((card) => !card.answered)) ?? null;
  }, 30_000);
  /** The decision journal (admin scope: the organization's audit) says who
   * decided a call of this bot, and how. Rows are written on a queue. */
  const decidedBy = async (_auth: Auth, bot: Bot, source: string) => {
    let rows: any[] = [];
    let status = 0;
    const found = await waitFor(async () => {
      const read = await api("GET", "/api/decisions", admin);
      status = read.status;
      rows = (read.body.decisions ?? []) as any[];
      return rows.some((row) => row.botId === bot.id && row.source === source);
    }, 10_000).catch(() => false);
    expect(found, JSON.stringify({ status, rows: rows.slice(-6) })).toBe(true);
  };
  const respond = (auth: Auth, bot: Bot, requestId: string, behavior: "allow" | "deny", rule?: "allow") =>
    api("POST", `/api/threads/${bot.threadId}/respond`, auth, { requestId, behavior, ...(rule ? { rule } : {}) });
  const end = async (auth: Auth, bot: Bot) => {
    await api("POST", `/api/bots/${bot.id}/interrupt`, auth, { threadId: bot.threadId });
    await waitFor(async () => !((await api("GET", "/api/bots?messages=0", auth)).body.bots as Array<{ id: string; busy?: boolean }>).find((b) => b.id === bot.id)?.busy, 30_000);
  };

  it("the capability route is not reachable without the test key", async () => {
    const bot = await botOf(member, "Keyless", "ask");
    const refused = await api("POST", "/api/testing/held-request", undefined, { threadId: bot.threadId, mcpTool: SEND });
    expect(refused.status).toBe(404);
  }, 60_000);

  it("a held connector read passes with no card at Ask (connector-read)", async () => {
    const bot = await botOf(member, "Reader", "ask");
    await startTurn(member, bot);
    const answer = await hold(bot, READ);
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.behavior).toBe("allow");
    expect(await heldCards(member, bot)).toHaveLength(0);
    await decidedBy(member, bot, "connector-read");
    await end(member, bot);
  }, 90_000);

  it("a held send at Ask shows one card with Always allow; Deny declines", async () => {
    const bot = await botOf(member, "Sender ask", "ask");
    await startTurn(member, bot);
    const pending = hold(bot, SEND, true);
    const card = await cardFor(member, bot);
    expect(card.mcpTool).toBe(SEND);
    expect(card.ownerRule, JSON.stringify(card)).toBeTruthy();
    expect(card.adminApproval).not.toBe(true);
    expect(await heldCards(member, bot)).toHaveLength(1);
    const answered = await respond(member, bot, card.requestId, "deny");
    expect(answered.status, answered.text).toBeLessThan(300);
    const decided = await pending;
    expect(decided.body).toMatchObject({ requestId: card.requestId, behavior: "deny" });
    await end(member, bot);
  }, 90_000);

  it("a held send at Auto shows its card too, and allow runs it", async () => {
    const bot = await botOf(member, "Sender auto", "auto");
    await startTurn(member, bot);
    const pending = hold(bot, SEND, true);
    const card = await cardFor(member, bot);
    expect(card.ownerRule, JSON.stringify(card)).toBeTruthy();
    expect(await heldCards(member, bot)).toHaveLength(1);
    await respond(member, bot, card.requestId, "allow");
    expect((await pending).body.behavior).toBe("allow");
    await end(member, bot);
  }, 90_000);

  it("Always allow saved from the card answers the next identical request with no card", async () => {
    const bot = await botOf(member, "Sender always", "ask");
    await startTurn(member, bot);
    const first = hold(bot, SEND, true);
    const card = await cardFor(member, bot);
    await respond(member, bot, card.requestId, "allow", "allow");
    expect((await first).body.behavior).toBe("allow");
    const second = await hold(bot, SEND, true);
    expect(second.body.behavior).toBe("allow");
    expect(await heldCards(member, bot)).toHaveLength(1);
    await decidedBy(member, bot, "owner-rule");
    await end(member, bot);
  }, 90_000);

  it("Full access approves a held send with no card", async () => {
    const bot = await botOf(member, "Sender full", "full");
    await startTurn(member, bot);
    const answer = await hold(bot, SEND, true);
    expect(answer.body.behavior, answer.text).toBe("allow");
    expect(await heldCards(member, bot)).toHaveLength(0);
    await end(member, bot);
  }, 90_000);

  it("an org Refuse rule refuses a held call, even at Full", async () => {
    const rule = await api("POST", "/api/org/admin/org-approvals/rules", adminConsole(), { when: `utiliser l'outil ${REFUSED}`, behavior: "deny" });
    expect(rule.status, rule.text).toBe(201);
    const bot = await botOf(member, "Refused", "full");
    await startTurn(member, bot);
    const answer = await hold(bot, REFUSED, true);
    expect(answer.body.behavior, answer.text).toBe("deny");
    expect(await heldCards(member, bot)).toHaveLength(0);
    await decidedBy(member, bot, "custom-rule-deny");
    await end(member, bot);
  }, 90_000);

  it("a member's bot shows the member's own card, never an admin card", async () => {
    const bot = await botOf(member, "Member own", "ask");
    await startTurn(member, bot);
    const pending = hold(bot, SEND, true);
    const card = await cardFor(member, bot);
    expect(card.adminApproval).not.toBe(true);
    const rows = await messages(member, bot);
    expect(rows.some((m) => m.card?.requestId === card.requestId && m.card.adminApproval === true)).toBe(false);
    const answered = await respond(member, bot, card.requestId, "allow");
    expect(answered.status, answered.text).toBeLessThan(300);
    expect((await pending).body.behavior).toBe("allow");
    await end(member, bot);
  }, 90_000);

  it("the card expires when the turn ends", async () => {
    rmSync(releaseFile(), { force: true });
    const bot = await botOf(member, "Turn ends", "ask", "ends");
    await startTurn(member, bot, "ends");
    const pending = hold(bot, SEND, true);
    const card = await cardFor(member, bot);
    writeFileSync(releaseFile(), "");
    const decided = await pending;
    expect(decided.body).toMatchObject({ requestId: card.requestId, behavior: "deny", message: HELD_REQUEST_EXPIRED });
    const expired = await waitFor(async () => {
      const now = await cardFor(member, bot, card.requestId);
      return now.expired === true ? now : null;
    });
    expect(expired.options).toEqual([]);
    rmSync(releaseFile(), { force: true });
  }, 90_000);

  it("#4081: a script's Perspicax read is the engine's: a card at Ask, never a connector read", async () => {
    const bot = await botOf(member, "Bridge ask", "ask");
    await startTurn(member, bot);
    const pending = bridged(bot, "api_search");
    const card = await cardFor(member, bot);
    expect(card.mcpTool ?? card.tool).toMatch(/perspicax__api_search/);
    await respond(member, bot, card.requestId, "allow");
    expect((await pending).body.behavior).toBe("allow");
    await end(member, bot);
  }, 90_000);

  it("#4081: at Auto the level answers a script's call as it answers the engine's ask, never as a connector read", async () => {
    const bot = await botOf(member, "Bridge auto", "auto");
    await startTurn(member, bot);
    const read = await bridged(bot, "api_search");
    expect(read.body.behavior, read.text).toBe("allow");
    expect(await heldCards(member, bot)).toHaveLength(0);
    await decidedBy(member, bot, "owner-auto");
    const rows = ((await api("GET", "/api/decisions", admin)).body.decisions ?? []) as any[];
    expect(rows.filter((row) => row.botId === bot.id).map((row) => row.source)).not.toContain("connector-read");
    await end(member, bot);
  }, 90_000);

  it("#4081: an organization Refuse rule refuses a script's Perspicax call, even at Full", async () => {
    const rule = await api("POST", "/api/org/admin/org-approvals/rules", adminConsole(), { when: "utiliser l'outil mcp__perspicax__api_write", behavior: "deny" });
    expect(rule.status, rule.text).toBe(201);
    const bot = await botOf(member, "Bridge refused", "full");
    await startTurn(member, bot);
    const answer = await bridged(bot, "api_write");
    expect(answer.body.behavior, answer.text).toBe("deny");
    expect(await heldCards(member, bot)).toHaveLength(0);
    await end(member, bot);
  }, 90_000);

  it("#4081: a burst of the same script call raises one card, and Always allow answers the next with none", async () => {
    const bot = await botOf(member, "Bridge burst", "ask");
    await startTurn(member, bot);
    const first = bridged(bot, "api_describe");
    const second = bridged(bot, "api_describe");
    const card = await cardFor(member, bot);
    await sleep(500);
    expect(await heldCards(member, bot)).toHaveLength(1);
    await respond(member, bot, card.requestId, "allow", "allow");
    expect((await first).body.behavior).toBe("allow");
    expect((await second).body.behavior).toBe("allow");
    const later = await bridged(bot, "api_describe");
    expect(later.body.behavior).toBe("allow");
    expect(await heldCards(member, bot)).toHaveLength(1);
    await decidedBy(member, bot, "owner-rule");
    await end(member, bot);
  }, 90_000);

  it("an answer after a restart is unavailable", async () => {
    const bot = await botOf(member, "Restarted", "ask");
    await startTurn(member, bot);
    const pending = hold(bot, SEND, true).catch(() => null);
    const card = await cardFor(member, bot);
    await stopServer();
    await pending;
    await startServer();
    member = await signIn(MEMBER);
    const answered = await respond(member, bot, card.requestId, "allow");
    expect(answered.text).toMatch(/unavailable|no longer|not delivered|expired/i);
    expect(answered.body.outcome ?? answered.body.code ?? answered.text).not.toBe("allowed-once");
  }, 120_000);
});
