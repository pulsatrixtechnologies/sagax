// Organization server, through the real server and the fake provider:
//
//   PD-1  alice opens a direct conversation with bob from the directory: only
//         the two read, list, stream, search and write it; an admin, another
//         member and the loopback operator get nothing; it stays people-only
//         (no bot, no rename, no memory; threads are PT-1) and opening it again
//         answers the same one; bob is notified, alice is not
//   PD-2  a service account and oneself are not someone to write to
//   GM-1  a group's memory: its owner edits it, a member reads it only, a
//         stranger gets 404, and a removed member loses it at once
//   RM-1  a room with three people: the one tagged with @ is notified (and
//         the room is unread for them only), the others are not; a message
//         that tags nobody notifies nobody; @all only once its owner allows it
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
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
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9PTALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9PTBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9PTCAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9PTDAVE00000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "admin" };
const ERIN: FakeOidcUser = { sub: "01J9PTERIN00000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };

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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

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
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
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

const SERVICE: FakeOidcUser = { sub: "01J9PTSERVICE00000000000S", email: null as unknown as string, name: "Robot", preferred_username: "robot", role: "employee" };

posixOnly("Perspicax organization: direct conversations between people, group memory", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol" | "dave" | "erin" | "robot", string>;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [
      ...[ALICE, BOB, CAROL, DAVE, ERIN].map((user) => idp.personOf(user)),
      { ...idp.personOf(SERVICE), kind: "service" as const },
    ];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-people-dms-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = await api("GET", "/api/org/directory", alice);
      const list = got.body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 6 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol"), dave: idOf("dave"), erin: idOf("erin"), robot: idOf("robot") };
    expect(people.find((person) => person.login === "robot")).toMatchObject({ service: true });
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("PD-1: a direct conversation is the two people's only, people-only, and notifies the other", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE); // an organization admin
    const opened = await api("POST", "/api/people-dms", alice, { principalId: ids.bob });
    expect(opened.status, opened.text).toBe(201);
    const dm = opened.body.group as { id: string; threadId: string; peopleDm: boolean; humanIds: string[]; memberIds: string[] };
    expect(dm.peopleDm).toBe(true);
    expect(dm.memberIds).toEqual([]);
    expect([...dm.humanIds].sort()).toEqual([ids.alice, ids.bob].sort());
    // opening it again, from either side, answers the same conversation
    expect((await api("POST", "/api/people-dms", alice, { principalId: ids.bob })).body.group.id).toBe(dm.id);
    const back = await api("POST", "/api/people-dms", bob, { principalId: ids.alice });
    expect(back.status).toBe(200);
    expect(back.body.group.id).toBe(dm.id);

    const bobStream = await openStream(bob);
    const aliceStream = await openStream(alice);
    const carolStream = await openStream(carol);
    const daveStream = await openStream(dave);
    const sent = await api("POST", `/api/groups/${dm.id}/messages`, alice, { text: "lunch at noon, just us?" });
    expect(sent.status, sent.text).toBe(202);
    expect(sent.body.message.sender).toMatchObject({ id: ids.alice });
    expect((await api("POST", `/api/groups/${dm.id}/messages`, bob, { text: "sure, see you there" })).status).toBe(202);

    for (const auth of [alice, bob]) {
      const got = await api("GET", `/api/threads/${dm.threadId}/messages`, auth);
      expect(got.status).toBe(200);
      expect(got.text).toContain("lunch at noon");
      expect(got.text).toContain("see you there");
      expect(((await api("GET", "/api/groups", auth)).body.groups as Array<{ id: string }>).map((g) => g.id)).toContain(dm.id);
    }
    // carol (a member), dave (an organization admin) and a caller with no
    // session (the operator's console, or nobody) all get nothing
    for (const auth of [carol, dave, {}]) {
      const missing = Object.keys(auth).length ? [404] : [401, 403, 404];
      expect(missing).toContain((await api("GET", `/api/threads/${dm.threadId}/messages`, auth)).status);
      expect(missing).toContain((await api("GET", `/api/threads/${dm.threadId}/export`, auth)).status);
      expect(missing).toContain((await api("POST", `/api/groups/${dm.id}/messages`, auth, { text: "let me in" })).status);
      const listed = await api("GET", "/api/groups", auth);
      expect(JSON.stringify(listed.body)).not.toContain(dm.id);
    }
    // search: the two find it, nobody else does
    const search = async (auth: Auth) => (await api("GET", `/api/search?q=${encodeURIComponent("lunch at noon")}`, auth)).text;
    await waitFor(async () => (await search(bob)).includes(dm.threadId));
    expect(await search(carol)).not.toContain(dm.threadId);
    expect(await search(dave)).not.toContain(dm.threadId);

    // live: bob is notified of alice's message, alice of bob's, nobody else hears it
    await waitFor(async () => bobStream.text().includes("lunch at noon"));
    await waitFor(async () => aliceStream.text().includes("see you there"));
    const notices = (text: string) => text.split("\n").filter((line) => line.startsWith("data:") && line.includes('"kind":"notify"') && line.includes('"kind":"message"'));
    expect(notices(bobStream.text()).some((line) => line.includes("lunch at noon"))).toBe(true);
    expect(notices(bobStream.text()).some((line) => line.includes("see you there"))).toBe(false);
    expect(notices(aliceStream.text()).some((line) => line.includes("lunch at noon"))).toBe(false);
    for (const stream of [carolStream, daveStream]) {
      expect(stream.text()).not.toContain("lunch at noon");
      expect(stream.text()).not.toContain(dm.id);
    }
    for (const stream of [bobStream, aliceStream, carolStream, daveStream]) stream.close();

    // people-only, single conversation, nothing else changes
    expect((await api("PATCH", `/api/groups/${dm.id}`, alice, { name: "renamed" })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${dm.id}`, alice, { humanIds: [ids.alice, ids.bob, ids.carol] })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${dm.id}`, alice, { memberIds: ["anything"] })).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${dm.id}`, bob, { unread: false })).status).toBe(200);
    // threads like a bot's (server/people-threads.e2e.test.ts)
    expect((await api("POST", `/api/groups/${dm.id}/tasks`, alice, {})).status).toBe(201);
    expect((await api("DELETE", `/api/groups/${dm.id}`, alice)).status).toBe(400);
    expect((await api("GET", `/api/groups/${dm.id}/memory`, alice)).status).toBe(404);
  }, 120_000);

  it("PD-2: a service account and oneself are not someone to write to", async () => {
    expect((await api("POST", "/api/people-dms", alice, { principalId: ids.robot })).body).toMatchObject({ code: "service_account" });
    expect((await api("POST", "/api/people-dms", alice, { principalId: ids.alice })).status).toBe(400);
    expect((await api("POST", "/api/people-dms", alice, { principalId: "pr_nobody" })).status).toBe(400);
    expect((await api("POST", "/api/people-dms", {}, { principalId: ids.bob })).status).not.toBe(201);
  });

  it("RM-1: a person tagged with @ in a room is notified like a direct message, nobody else", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const bot = await api("POST", "/api/bots", alice, { name: "Quietbot" });
    expect(bot.status, bot.text).toBe(201);
    // the bot answers when it is tagged only: people talk among themselves
    const room = await api("POST", "/api/groups", alice, {
      name: "Release", memberIds: [bot.body.bot.id], humanIds: [ids.alice, ids.bob, ids.carol],
      setup: { bulletin: "", defaultResponder: { kind: "mentions" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const threadId = room.body.group.threadId as string;
    const streams = { alice: await openStream(alice), bob: await openStream(bob), carol: await openStream(carol) };
    const notices = (text: string, words: string) => text.split("\n").filter((line) => line.startsWith("data:") && line.includes('"kind":"notify"') && line.includes('"kind":"message"') && line.includes(words));

    expect((await api("POST", `/api/groups/${roomId}/messages`, alice, { text: "@Bob can you check the release notes?" })).status).toBe(202);
    await waitFor(async () => notices(streams.bob.text(), "release notes").length > 0);
    const [notice] = notices(streams.bob.text(), "release notes");
    expect(JSON.parse(notice!.slice("data:".length)).notification).toMatchObject({
      kind: "message", botId: "", threadId, groupId: roomId, title: "Alice in Release", audience: [ids.bob],
    });
    // the room is unread for bob, and for nobody else, until he reads it
    const unread = async (auth: Auth) => ((await api("GET", "/api/groups", auth)).body.groups as Array<{ id: string; unread: boolean }>).find((g) => g.id === roomId)?.unread;
    expect(await unread(bob)).toBe(true);
    expect(await unread(carol)).toBe(false);
    expect((await api("POST", `/api/groups/${roomId}/read`, carol)).status).toBe(200);
    expect(await unread(bob)).toBe(true);
    expect((await api("POST", `/api/groups/${roomId}/read`, bob)).status).toBe(200);
    expect(await unread(bob)).toBe(false);

    // a message that tags nobody keeps the room's rules, and @all is off by default
    expect((await api("POST", `/api/groups/${roomId}/messages`, alice, { text: "nobody tagged in this one" })).status).toBe(202);
    expect((await api("POST", `/api/groups/${roomId}/messages`, alice, { text: "@all first call" })).status).toBe(202);
    // only the owner turns @all on
    expect((await api("PATCH", `/api/groups/${roomId}`, bob, { mentionAll: true })).status).toBe(403);
    const allowed = await api("PATCH", `/api/groups/${roomId}`, alice, { mentionAll: true });
    expect(allowed.status, allowed.text).toBe(200);
    expect(allowed.body.group.mentionAll).toBe(true);
    expect((await api("POST", `/api/groups/${roomId}/messages`, bob, { text: "@all second call" })).status).toBe(202);
    await waitFor(async () => notices(streams.carol.text(), "second call").length > 0 && notices(streams.alice.text(), "second call").length > 0);
    await sleep(500);

    for (const stream of Object.values(streams)) {
      expect(notices(stream.text(), "nobody tagged")).toEqual([]);
      expect(notices(stream.text(), "first call")).toEqual([]);
    }
    expect(notices(streams.alice.text(), "release notes")).toEqual([]);
    expect(notices(streams.carol.text(), "release notes")).toEqual([]);
    expect(notices(streams.bob.text(), "second call")).toEqual([]);
    for (const stream of Object.values(streams)) stream.close();
  }, 60_000);

  it("GM-1: the group's owner edits its memory, members read it, a removed member loses it", async () => {
    const bob = await signIn(BOB);
    const erin = await signIn(ERIN);
    const carol = await signIn(CAROL);
    const bot = await api("POST", "/api/bots", alice, { name: "Opsbot" });
    expect(bot.status, bot.text).toBe(201);
    const room = await api("POST", "/api/groups", alice, {
      name: "Ops", memberIds: [bot.body.bot.id], humanIds: [ids.alice, ids.bob, ids.erin],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const first = await api("GET", `/api/groups/${roomId}/memory`, alice);
    expect(first.body).toMatchObject({ enabled: true, canEdit: true });
    const saved = await api("PUT", `/api/groups/${roomId}/memory`, alice, { text: "- deploys after 17h\n", expectedHash: first.body.hash });
    expect(saved.status, saved.text).toBe(200);
    const bobView = await api("GET", `/api/groups/${roomId}/memory`, bob);
    expect(bobView.body).toMatchObject({ canEdit: false, text: "- deploys after 17h\n" });
    expect((await api("PUT", `/api/groups/${roomId}/memory`, bob, { text: "- mine\n" })).status).toBe(403);
    expect((await api("PUT", `/api/groups/${roomId}/memory`, bob, { enabled: false })).status).toBe(403);
    expect((await api("GET", `/api/groups/${roomId}/memory`, carol)).status).toBe(404);
    expect((await api("GET", `/api/groups/${roomId}/memory`, erin)).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${roomId}`, alice, { humanIds: [ids.alice, ids.bob] })).status).toBe(200);
    expect((await api("GET", `/api/groups/${roomId}/memory`, erin)).status).toBe(404);
  }, 60_000);
});
