// Organization server, through the real server and the fake provider: a
// conversation between two people has threads like a bot (server/people/people-dms.ts).
//
//   PT-1  alice and bob: create, switch, rename, pin, archive, snooze, file
//         in a folder and delete threads; both see the same list; unread and
//         the open thread are each person's own; another member, an
//         organization admin and the loopback operator reach none of it
//   PT-2  a client from before threads (no x-sagax-person-threads header)
//         keeps reading and writing the conversation as it was: its default
//         "General" thread, whatever thread the person has open elsewhere
//   PT-3  a nudge lands in the thread it was sent from
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9PTALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9PTBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9PTCAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9PTDAVE00000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "admin" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; legacy?: boolean };
// A client that knows threads says so on every request; `legacy` is a
// client from before threads (0.4.16), which never does.
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.cookie && !auth.legacy ? { "x-sagax-person-threads": "1" } : {}),
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


posixOnly("Perspicax organization: threads in a conversation between two people", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol" | "dave", string>;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-people-threads-"));
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
      return list && list.length === 4 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol"), dave: idOf("dave") };
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  type Thread = { threadId: string; title: string; pinned?: boolean; archivedAt?: number; snoozedUntil?: number; projectId?: string; unread?: boolean; general?: true; unreadFor?: unknown };
  type Conversation = { id: string; threadId: string; unread: boolean; tasks: Thread[]; projects?: Array<{ id: string; name: string }>; messages?: Array<{ text?: string; kind?: string }>; unreadFor?: unknown };
  const listed = async (auth: Auth, id: string): Promise<Conversation> =>
    ((await api("GET", "/api/groups", auth)).body.groups as Conversation[]).find((group) => group.id === id)!;
  const hydrated = async (auth: Auth, id: string): Promise<Conversation> =>
    ((await api("GET", "/api/bots?messages=50", auth)).body.groups as Conversation[]).find((group) => group.id === id)!;
  const thread = (group: Conversation, threadId: string) => group.tasks.find((task) => task.threadId === threadId);

  it("PT-1: the pair's threads, the same list on both sides, private to them", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE); // an organization admin
    const opened = await api("POST", "/api/people-dms", alice, { principalId: ids.bob });
    expect(opened.status, opened.text).toBe(201);
    const dm = opened.body.group as Conversation;
    const general = dm.threadId;
    expect(dm.tasks).toEqual([expect.objectContaining({ threadId: general, title: "General", general: true })]);

    const bobStream = await openStream(bob);
    const carolStream = await openStream(carol);
    const daveStream = await openStream(dave);

    // create: alice opens a new thread; bob's open thread does not move
    const created = await api("POST", `/api/groups/${dm.id}/tasks`, alice, { title: "Budget" });
    expect(created.status, created.text).toBe(201);
    const budget = created.body.task.threadId as string;
    expect(created.body.group.threadId).toBe(budget);
    expect(created.body.group.messages).toEqual([]);
    const bobSees = await listed(bob, dm.id);
    expect(bobSees.threadId).toBe(general);
    expect(bobSees.tasks.map((task) => task.title).sort()).toEqual(["Budget", "General"]);
    // the stored default thread is still General
    expect((await listed(alice, dm.id)).threadId).toBe(budget);
    expect((await listed({ ...alice, legacy: true }, dm.id)).threadId).toBe(general);

    // a message in Budget: unread for bob only, on Budget only
    const sent = await api("POST", `/api/groups/${dm.id}/messages`, alice, { text: "numbers for Q4", threadId: budget });
    expect(sent.status, sent.text).toBe(202);
    expect(sent.body.threadId).toBe(budget);
    let bobView = await listed(bob, dm.id);
    expect(bobView.unread).toBe(true);
    expect(thread(bobView, budget)?.unread).toBe(true);
    expect(thread(bobView, general)?.unread).toBe(false);
    expect(JSON.stringify(bobView)).not.toContain("unreadFor");
    const aliceView = await listed(alice, dm.id);
    expect(aliceView.unread).toBe(false);
    expect(thread(aliceView, budget)?.unread).toBe(false);
    // a thread that is not this conversation's is refused
    expect((await api("POST", `/api/groups/${dm.id}/messages`, alice, { text: "x", threadId: "not-a-thread" })).status).toBe(400);
    // the thread's messages: the two only
    for (const auth of [alice, bob]) expect((await api("GET", `/api/threads/${budget}/messages`, auth)).text).toContain("numbers for Q4");
    for (const auth of [carol, dave]) expect((await api("GET", `/api/threads/${budget}/messages`, auth)).status).toBe(404);
    expect([401, 403, 404]).toContain((await api("GET", `/api/threads/${budget}/messages`, {})).status);

    // switch: bob opens Budget for himself; alice stays where she is
    const switched = await api("POST", `/api/groups/${dm.id}/tasks/${budget}?messages=20`, bob);
    expect(switched.status, switched.text).toBe(200);
    expect(switched.body.group.threadId).toBe(budget);
    expect(JSON.stringify(switched.body.group.messages)).toContain("numbers for Q4");
    // reading that thread clears bob's dot, never alice's state
    const read = await api("POST", `/api/groups/${dm.id}/read`, bob, { threadId: budget });
    expect(read.status, read.text).toBe(200);
    bobView = await listed(bob, dm.id);
    expect(bobView.unread).toBe(false);
    expect(thread(bobView, budget)?.unread).toBe(false);
    expect(bobView.threadId).toBe(budget);
    // a new thread is titled from its first message, like a bot's
    const blank = await api("POST", `/api/groups/${dm.id}/tasks`, bob, {});
    const blankId = blank.body.task.threadId as string;
    await api("POST", `/api/groups/${dm.id}/messages`, bob, { text: "Offsite planning for March", threadId: blankId });
    expect(thread(await listed(alice, dm.id), blankId)?.title).toMatch(/^Offsite planning/);

    // rename, pin, archive, snooze, folders: one change, both sides see it
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, bob, { title: "Budget 2026" })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, alice, { pinned: true })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${blankId}`, bob, { archivedAt: 1_700_000_000_000 })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${general}`, alice, { snoozedUntil: 0 })).status).toBe(200);
    const folder = await api("POST", `/api/groups/${dm.id}/projects`, alice, { name: "Finance", emoji: "💼" });
    expect(folder.status, folder.text).toBe(201);
    const folderId = folder.body.project.id as string;
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, bob, { projectId: folderId })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, bob, { projectId: "elsewhere" })).status).toBe(400);
    const second = await api("POST", `/api/groups/${dm.id}/projects`, bob, { name: "Later" });
    expect(second.status, second.text).toBe(201);
    expect((await api("PATCH", `/api/groups/${dm.id}/projects/order`, alice, { projectIds: [second.body.project.id, folderId] })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${dm.id}/projects/${folderId}`, bob, { name: "Money" })).status).toBe(200);
    for (const auth of [alice, bob]) {
      const view = await listed(auth, dm.id);
      expect(thread(view, budget)).toMatchObject({ title: "Budget 2026", pinned: true, projectId: folderId });
      expect(thread(view, blankId)).toMatchObject({ archivedAt: 1_700_000_000_000 });
      expect(thread(view, general)).toMatchObject({ snoozedUntil: 0 });
      expect(view.projects?.map((project) => project.name)).toEqual(["Later", "Money"]);
    }
    // an until-activity snooze wakes on the next message
    await api("POST", `/api/groups/${dm.id}/messages`, bob, { text: "back to general" });
    expect(thread(await listed(alice, dm.id), general)?.snoozedUntil).toBeUndefined();
    // unarchive, unpin, unfile with null
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${blankId}`, alice, { archivedAt: null })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, alice, { pinned: false, projectId: null })).status).toBe(200);
    expect(thread(await listed(bob, dm.id), budget)).not.toHaveProperty("projectId");
    // deleting a folder keeps its threads
    expect((await api("DELETE", `/api/groups/${dm.id}/projects/${second.body.project.id}`, bob)).status).toBe(200);

    // nobody else reaches the threads, the folders or the list, admin included
    for (const auth of [carol, dave]) {
      expect((await api("POST", `/api/groups/${dm.id}/tasks`, auth, { title: "let me in" })).status).toBe(404);
      expect((await api("POST", `/api/groups/${dm.id}/tasks/${budget}`, auth)).status).toBe(404);
      expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, auth, { title: "mine" })).status).toBe(404);
      expect((await api("DELETE", `/api/groups/${dm.id}/tasks/${budget}`, auth)).status).toBe(404);
      expect((await api("POST", `/api/groups/${dm.id}/projects`, auth, { name: "x" })).status).toBe(404);
      expect((await api("POST", `/api/groups/${dm.id}/read`, auth, { threadId: budget })).status).toBe(404);
      expect(JSON.stringify((await api("GET", "/api/groups", auth)).body)).not.toContain(dm.id);
      expect((await api("GET", `/api/search?q=${encodeURIComponent("numbers for Q4")}`, auth)).text).not.toContain(budget);
    }
    // the pair finds the thread in search
    await waitFor(async () => (await api("GET", `/api/search?q=${encodeURIComponent("numbers for Q4")}`, bob)).text.includes(budget));
    // live: bob's stream carries the threads, nobody else's does
    await waitFor(async () => bobStream.text().includes("Budget 2026"));
    for (const stream of [carolStream, daveStream]) {
      expect(stream.text()).not.toContain("Budget 2026");
      expect(stream.text()).not.toContain(dm.id);
    }
    for (const stream of [bobStream, carolStream, daveStream]) stream.close();

    // still no turn, no generated title, no turn limit, no deleting the conversation
    expect((await api("POST", `/api/groups/${dm.id}/tasks/${budget}/title`, alice)).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${dm.id}/tasks/${budget}`, alice, { turnTimeoutMinutes: 10 })).status).toBe(400);
    expect((await api("DELETE", `/api/groups/${dm.id}`, alice)).status).toBe(400);

    // delete: either of the two; the last thread stays
    expect((await api("DELETE", `/api/groups/${dm.id}/tasks/${blankId}`, alice)).status).toBe(200);
    const afterDelete = await api("DELETE", `/api/groups/${dm.id}/tasks/${budget}`, bob);
    expect(afterDelete.status, afterDelete.text).toBe(200);
    // bob had Budget open: he is back on the default thread, with its messages
    expect(afterDelete.body.group.threadId).toBe(general);
    expect((await listed(alice, dm.id)).tasks.map((task) => task.threadId)).toEqual([general]);
    expect((await api("DELETE", `/api/groups/${dm.id}/tasks/${general}`, alice)).status).toBe(400);
  }, 180_000);

  it("PT-2: a client from before threads reads and writes the default thread", async () => {
    const bob = await signIn(BOB);
    const legacyBob: Auth = { ...bob, legacy: true };
    const dm = (await api("POST", "/api/people-dms", alice, { principalId: ids.bob })).body.group as Conversation;
    const general = (await listed(alice, dm.id)).tasks.find((task) => task.general)!.threadId;
    const created = await api("POST", `/api/groups/${dm.id}/tasks`, bob, { title: "Side topic" });
    const side = created.body.task.threadId as string;
    await api("POST", `/api/groups/${dm.id}/messages`, bob, { text: "only in the side topic", threadId: side });
    // bob has the side thread open in his new client...
    expect((await listed(bob, dm.id)).threadId).toBe(side);
    // ...his old client still opens the conversation on General, with General's messages
    const old = await hydrated(legacyBob, dm.id);
    expect(old.threadId).toBe(general);
    expect(JSON.stringify(old.messages ?? [])).not.toContain("only in the side topic");
    expect((await listed(legacyBob, dm.id)).threadId).toBe(general);
    // it sees the one conversation it always had, and cannot be moved off it
    expect(old.tasks.map((task) => task.threadId)).toEqual([general]);
    const oldSwitch = await api("POST", `/api/groups/${dm.id}/tasks/${side}?messages=20`, legacyBob);
    expect(oldSwitch.status, oldSwitch.text).toBe(200);
    expect(oldSwitch.body.group.threadId).toBe(general);
    expect((await listed(bob, dm.id)).threadId).toBe(side);
    // opening the conversation answers the default thread too
    const reopened = await api("POST", "/api/people-dms", legacyBob, { principalId: ids.alice });
    expect(reopened.body.group.threadId).toBe(general);
    // a message without a thread (the old client's send) goes to General
    const sent = await api("POST", `/api/groups/${dm.id}/messages`, legacyBob, { text: "from the old app" });
    expect(sent.status, sent.text).toBe(202);
    expect(sent.body.threadId).toBe(general);
    expect((await api("GET", `/api/threads/${general}/messages`, alice)).text).toContain("from the old app");
    // alice's old client reads the whole conversation: every thread is read for her
    expect((await hydrated({ ...alice, legacy: true }, dm.id)).unread).toBe(true);
    await api("POST", `/api/groups/${dm.id}/read`, { ...alice, legacy: true });
    const aliceNow = await listed(alice, dm.id);
    expect(aliceNow.unread).toBe(false);
    expect(aliceNow.tasks.every((task) => task.unread === false)).toBe(true);
  }, 60_000);

  it("PT-3: a nudge lands in the thread it was sent from", async () => {
    const bob = await signIn(BOB);
    const dm = (await api("POST", "/api/people-dms", alice, { principalId: ids.bob })).body.group as Conversation;
    const created = await api("POST", `/api/groups/${dm.id}/tasks`, alice, { title: "Nudge here" });
    const target = created.body.task.threadId as string;
    const nudged = await api("POST", "/api/nudges", alice, { principalId: ids.bob, threadId: target });
    expect(nudged.status, nudged.text).toBe(200);
    expect((await api("GET", `/api/threads/${target}/messages`, bob)).text).toContain("\"kind\":\"nudge\"");
    expect(thread(await listed(bob, dm.id), target)?.unread).toBe(true);
  }, 60_000);
});
