// #2418: a room a member creates with their own bots and another person
// (humanIds). The bots' audience is the owner alone (visibility), yet the
// room's people list opens the room to both people: the creator and the
// guest see it, post in it, and the lead bot answers. Before the fix the
// one visibility gate every request passes judged the room by its bots'
// audience only and refused the send with "no such channel".
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const CAPABILITY_KEY = "org-bot-room-capability";
const ALICE: FakeOidcUser = { sub: "01J9S6ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9S6BOB00000000000000B", name: "Bob", preferred_username: "bob", email: "bob@acme.test", role: "employee", teams: [] };
const DAVE: FakeOidcUser = { sub: "01J9S6DAVE00000000000000D", name: "Dave", preferred_username: "dave", email: "dave@acme.test", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}), ...headers },
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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
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
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
      SAGAX_ORG_NAME: "Acme",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

posixOnly("Organization: a room with my bots and another person (#2418)", () => {
  let alice: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, DAVE].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-mixed-room-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: {}, config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  const roomIds = async (auth: Auth) => ((await api("GET", "/api/groups", auth)).body.groups as Array<{ id: string }> ?? []).map((g) => g.id);
  const transcript = async (auth: Auth, threadId: string) => {
    const got = await api("GET", `/api/threads/${threadId}/messages?limit=60`, auth);
    return got.status === 200 ? (got.body.messages ?? []) as Array<{ role?: string; text?: string; from?: { botId?: string } }> : null;
  };

  it("creator and guest open the room, post in it, and the lead answers; never no such channel", async () => {
    const bob = await signIn(BOB);
    const make = async (name: string) => {
      const created = await api("POST", "/api/bots", bob, { name });
      expect(created.status, created.text).toBe(201);
      const bot = created.body.bot as { id: string; threadId: string };
      // the owner keeps the bot to themself (#1098: "admins" becomes the owner)
      const restricted = await api("PATCH", `/api/bots/${bot.id}`, bob, { visibility: "admins" });
      expect(restricted.status, restricted.text).toBe(200);
      return bot;
    };
    const lead = await make("Marc");
    const designer = await make("Bot Designer");
    const created = await api("POST", "/api/groups", bob, { name: "Marc & co.", memberIds: [lead.id, designer.id], humanIds: [ids.bob, ids.dave] });
    expect(created.status, created.text).toBe(201);
    const roomId = created.body.group.id as string;
    const roomThread = created.body.group.threadId as string;

    // the creator: listed, opened, posts, and the lead answers
    expect(await roomIds(bob)).toContain(roomId);
    const sent = await api("POST", `/api/groups/${roomId}/messages`, bob, { text: "Hello !" });
    expect(sent.text).not.toContain("no such channel");
    expect(sent.status, sent.text).toBeLessThan(300);
    await waitFor(async () => (await transcript(bob, roomThread))?.some((m) => m.role === "bot" && m.from?.botId === lead.id));

    // the guest: listed, opened, posts
    const dave = await signIn(DAVE);
    expect(await roomIds(dave)).toContain(roomId);
    expect(await transcript(dave, roomThread), "guest opens the room").not.toBeNull();
    const guest = await api("POST", `/api/groups/${roomId}/messages`, dave, { text: "Salut @Bot Designer" });
    expect(guest.text).not.toContain("no such channel");
    expect(guest.status, guest.text).toBeLessThan(300);
  }, 90_000);
});
