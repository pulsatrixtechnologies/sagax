// #2615: a bot its owner puts in a room with another person is "partially
// shared": it talks with that person in the room, and nowhere else. Through
// the real server on an organization home (fake Perspicax provider, fake
// Claude CLI): the other person writes in the room, and is refused the bot
// itself (listing, direct message, its other threads, its private memory).
// Fictional people and data only.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "..", "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

/** In the owner's private things; never in an answer the guest gets. */
const PRIVATE_MARK = "zqroomonlyc4e1";

const OWNER: FakeOidcUser = { sub: "01JAZROOMONLYOWNER000000OW", name: "Bea Owner", preferred_username: "bea", role: "employee", teams: [] };
const GUEST: FakeOidcUser = { sub: "01JAZROOMONLYGUEST000000GU", name: "Ari Guest", preferred_username: "ari", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie: string };
type Answer = { status: number; body: any; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function api(method: string, path: string, auth?: Auth, body?: unknown): Promise<Answer> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}

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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "..", "index.ts")], {
    cwd: join(SERVER_DIR, "..", ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key-roomonly",
      SAGAX_ORG_NAME: "Room Only Org",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
  });
}

posixOnly("a bot in a room with another person is reachable in that room only (#2615)", () => {
  let owner: Auth;
  let guest: Auth;
  let bot: { id: string; threadId: string };
  let taskThread = "";
  let room = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: OWNER });
    idp.directoryPeople = [OWNER, GUEST].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1], 5_176, 30);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "sagax-room-only-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", access: "api", config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } } },
    }));
    await start();
    owner = await signIn(OWNER);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", owner)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 2 ? got : null;
    });
    const id = (login: string) => people.find((p) => p.login === login)!.principalId;
    guest = await signIn(GUEST);

    const created = await api("POST", "/api/bots", owner, { name: "Bea desk bot" });
    expect(created.status, created.text).toBe(201);
    bot = { id: created.body.bot.id, threadId: created.body.bot.threadId };
    const patched = await api("PATCH", `/api/bots/${bot.id}`, owner, { modelSelection: { instanceId: "claude", model: "fake-model" } });
    expect(patched.status, patched.text).toBe(200);
    // the owner's own conversation, a second thread and private memory
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, owner, { text: `private note ${PRIVATE_MARK}` });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => {
      const got = (await api("GET", `/api/threads/${bot.threadId}/messages`, owner)).body.messages as Array<{ role: string; kind: string; text?: string }> | undefined;
      return got?.some((m) => m.role === "bot" && m.kind === "text" && m.text);
    });
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, owner, { title: `side ${PRIVATE_MARK}` });
    taskThread = task.body.task?.threadId ?? task.body.task?.id ?? "";
    expect(taskThread, task.text).toBeTruthy();
    const memory = await api("PUT", `/api/bots/${bot.id}/memory/file`, owner, { path: "memory/private.md", text: `- ${PRIVATE_MARK}\n` });
    expect(memory.status, memory.text).toBeLessThan(300);
    // the room: the owner, the guest and the bot
    const made = await api("POST", "/api/groups", owner, { name: "Desk room", memberIds: [bot.id], humanIds: [id("bea"), id("ari")], setup: { defaultResponder: { kind: "member", botId: bot.id } } });
    expect(made.status, made.text).toBeLessThan(300);
    room = made.body.group.id;
  }, 180_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) await removeTempDir(home);
  });

  it("reaches each probe as the owner (the guest's refusals are about her, not the routes)", async () => {
    expect((await api("GET", "/api/bots", owner)).body.bots.map((b: { id: string }) => b.id)).toContain(bot.id);
    for (const thread of [bot.threadId, taskThread]) expect((await api("GET", `/api/threads/${thread}/messages`, owner)).status).toBe(200);
    const file = await api("GET", `/api/bots/${bot.id}/memory/file?path=${encodeURIComponent("memory/private.md")}`, owner);
    expect(file.status, file.text).toBe(200);
    expect(file.text).toContain(PRIVATE_MARK);
  });

  it("lets the guest talk with the bot in the room", async () => {
    const groups = (await api("GET", "/api/groups", guest)).body.groups as Array<{ id: string }>;
    expect(groups.map((g) => g.id)).toContain(room);
    const posted = await api("POST", `/api/groups/${room}/messages`, guest, { text: "hello desk" });
    expect(posted.status, posted.text).toBeLessThan(300);
  });

  it("does not list the bot for the guest outside the room", async () => {
    const listed = await api("GET", "/api/bots", guest);
    expect(listed.status).toBe(200);
    expect((listed.body.bots as Array<{ id: string }>).map((b) => b.id)).not.toContain(bot.id);
  });

  it("refuses the guest a direct message to the bot", async () => {
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, guest, { text: "hello in private" });
    expect([403, 404], sent.text).toContain(sent.status);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, guest, { title: "my own thread" });
    expect([403, 404], task.text).toContain(task.status);
  });

  it("refuses the guest the bot's other threads", async () => {
    for (const thread of [bot.threadId, taskThread]) {
      const read = await api("GET", `/api/threads/${thread}/messages`, guest);
      expect([403, 404], `${thread}: ${read.text}`).toContain(read.status);
      expect(read.text).not.toContain(PRIVATE_MARK);
    }
  });

  it("refuses the guest the bot's private memory", async () => {
    const file = await api("GET", `/api/bots/${bot.id}/memory/file?path=${encodeURIComponent("memory/private.md")}`, guest);
    expect([403, 404], file.text).toContain(file.status);
    expect(file.text).not.toContain(PRIVATE_MARK);
  });

  it("keeps the owner's private thread out of what the room shows the guest", async () => {
    const group = (await api("GET", "/api/groups", guest)).body.groups.find((g: { id: string }) => g.id === room);
    const messages = await api("GET", `/api/threads/${group.threadId}/messages`, guest);
    expect(messages.status, messages.text).toBe(200);
    expect(messages.text).not.toContain(PRIVATE_MARK);
  });
});
