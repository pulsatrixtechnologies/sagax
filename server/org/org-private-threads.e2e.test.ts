// Private threads on a Perspicax organization server, through the real
// server, the fake provider (server/testing/fake-oidc-provider.ts) and the
// fake Claude CLI (owner: "When talking to a shared bot, we should not be able
// to use the same thread. Being multiple in the same chat is for groups."):
//
//   PT-1  bob opens alice's shared bot on his own thread; neither reads,
//         writes, exports, streams, searches or fetches the files of the
//         other's thread; an edit holder changes the bot, never reads it;
//         an organization admin holding a grant reads nobody's thread
//   PT-2  a group chat with alice, bob and the bot: both read and write it,
//         erin (not in it) gets nothing; removing bob closes it to him
//   PT-3  the one-time migration ran and logged its counts only
//   PT-4  only a group's owner changes its settings or deletes it; another
//         person reads them and may leave; an admin may delete (moderation)
//   PT-5  single stream (thread mode off) on a shared bot: bob's new topic
//         carries the digest of his own earlier topic, never alice's
//   PT-6  (#1098) a member sets the working folder of his own bot and his own
//         group, his own Show tool calls and his own voice keys, with no
//         admin; another member gets 403/404 on his bot and group and never
//         sees his preference or his keys. A member's folder stays in his
//         own roots: never another member's, a system folder or a symlink
//         out of a folder opened to him; an admin keeps any folder
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { turnWithPrompt } from "../testing/turn-dump-log.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9PTALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9PTBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9PTCAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9PTDAVE00000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "admin" };
const ERIN: FakeOidcUser = { sub: "01J9PTERIN00000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };
// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

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

type WireBot = { id: string; threadId: string; tasks: Array<{ threadId: string; title: string; ownerPrincipalId?: string }>; messages: Array<{ kind: string; role: string; text?: string }> };
const botOf = async (auth: Auth, id: string) => ((await api("GET", "/api/bots", auth)).body.bots as WireBot[]).find((bot) => bot.id === id);

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

posixOnly("Perspicax organization: private threads with a shared bot, group chats shared", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol" | "dave" | "erin", string>;
  let botId = "";
  let aliceThread = "";
  let bobThread = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, ERIN].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-private-threads-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    // PT-6: a folder an admin opened to every member
    mkdirSync(join(home, "opened"), { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP_LOG: join(home, "claude-turns.jsonl") }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } } },
      organization: { memberFolders: { "*": [join(home, "opened")] } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = await api("GET", "/api/org/directory", alice);
      const list = got.body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 5 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol"), dave: idOf("dave"), erin: idOf("erin") };
    // the organization's key (SAGAX_ANTHROPIC_API_KEY) serves by itself since 2026-10-01
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("PT-3: the one-time migration ran and logged counts, never an id", async () => {
    const line = log.split("\n").find((entry) => entry.includes("[private-threads] migration:"));
    expect(line, log.slice(-2000)).toBeTruthy();
    expect(line).not.toMatch(/pr_|@/);
  });

  it("PT-1: bob talks to alice's shared bot in his own private thread, and nobody reads anyone else's", async () => {
    const created = await api("POST", "/api/bots", alice, { name: "Xavier" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    aliceThread = created.body.bot.threadId;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    for (const [who, level] of [["bob", "use"], ["carol", "edit"], ["dave", "use"]] as const) {
      const shared = await api("PUT", `/api/bots/${botId}/grants`, alice, { target: `user:${ids[who]}`, level });
      expect(shared.status, shared.text).toBe(200);
    }
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const daveStream = await openStream(dave);

    expect((await api("POST", `/api/bots/${botId}/messages`, alice, { text: "alice secret plan" })).status).toBe(202);
    const bobsView = await botOf(bob, botId);
    expect(bobsView, "bob lists the shared bot").toBeTruthy();
    bobThread = bobsView!.threadId;
    expect(bobThread).toBeTruthy();
    expect(bobThread).not.toBe(aliceThread);
    expect(bobsView!.tasks.map((task) => task.threadId)).toEqual([bobThread]);
    expect(bobsView!.tasks[0]!.ownerPrincipalId).toBe(ids.bob);
    const bobSent = await api("POST", `/api/bots/${botId}/messages`, bob, { text: "bob private note" });
    expect(bobSent.status, bobSent.text).toBe(202);
    await waitFor(async () => (await botOf(bob, botId))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    await waitFor(async () => (await botOf(alice, botId))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);

    // list: each sees their own thread only
    const alicesView = (await botOf(alice, botId))!;
    expect(alicesView.threadId).toBe(aliceThread);
    expect(alicesView.tasks.map((task) => task.threadId)).toEqual([aliceThread]);
    expect(JSON.stringify(alicesView)).not.toContain("bob private note");
    expect(JSON.stringify(alicesView)).not.toContain(bobThread);
    const bobsNow = (await botOf(bob, botId))!;
    expect(bobsNow.messages.some((m) => m.text === "bob private note")).toBe(true);
    expect(JSON.stringify(bobsNow)).not.toContain("alice secret plan");
    expect(JSON.stringify(bobsNow)).not.toContain(aliceThread);

    // read, post, export, events, switch, rename, delete: the other's thread reads as missing
    const refused = async (auth: Auth, thread: string) => [
      await api("GET", `/api/threads/${thread}/messages`, auth),
      await api("GET", `/api/threads/${thread}/export`, auth),
      await api("GET", `/api/threads/${thread}/events`, auth),
      await api("GET", `/api/threads/${thread}/files`, auth),
      await api("POST", `/api/bots/${botId}/messages`, auth, { text: "intruding", threadId: thread }),
      await api("POST", `/api/bots/${botId}/tasks/${thread}`, auth),
      await api("PATCH", `/api/bots/${botId}/tasks/${thread}`, auth, { title: "mine now" }),
      await api("DELETE", `/api/bots/${botId}/tasks/${thread}`, auth),
      // Regenerate title (from upstream) reads the thread to name it.
      await api("POST", `/api/bots/${botId}/tasks/${thread}/title`, auth),
      await api("POST", `/api/bots/${botId}/read`, auth, { threadId: thread }),
      await api("POST", `/api/bots/${botId}/compact`, auth, { threadId: thread }),
      await api("POST", `/api/bots/${botId}/interrupt`, auth, { threadId: thread }),
      await api("POST", `/api/threads/${thread}/respond`, auth, { requestId: "nope", behavior: "allow" }),
      await api("GET", `/api/bots/${botId}/requests/aaaaaaaaaaaaaaaaaaaa?threadId=${thread}`, auth),
    ].map((got) => got.status);
    const bobOnAlice = await refused(bob, aliceThread);
    expect(bobOnAlice.every((status) => status === 404 || status === 403), JSON.stringify(bobOnAlice)).toBe(true);
    const aliceOnBob = await refused(alice, bobThread);
    expect(aliceOnBob.every((status) => status === 404 || status === 403), JSON.stringify(aliceOnBob)).toBe(true);
    // an edit holder changes the bot, never reads a thread
    expect((await api("PATCH", `/api/bots/${botId}`, carol, { name: "Xavier 2" })).status).toBe(200);
    const carolOnBoth = [...await refused(carol, aliceThread), ...await refused(carol, bobThread)];
    expect(carolOnBoth.every((status) => status === 404 || status === 403), JSON.stringify(carolOnBoth)).toBe(true);
    // an organization admin holding a grant reads nobody's thread
    const daveOnBoth = [...await refused(dave, aliceThread), ...await refused(dave, bobThread)];
    expect(daveOnBoth.every((status) => status === 404 || status === 403), JSON.stringify(daveOnBoth)).toBe(true);
    expect(JSON.stringify(await botOf(dave, botId))).not.toMatch(/alice secret plan|bob private note/);
    // nothing was written into the other's thread
    expect(JSON.stringify((await api("GET", `/api/threads/${aliceThread}/messages`, alice)).body)).not.toContain("intruding");
    expect(JSON.stringify((await api("GET", `/api/threads/${bobThread}/messages`, bob)).body)).not.toContain("intruding");

    // search: no hit in someone else's thread, even an admin's search
    const searchText = async (auth: Auth, q: string) => (await api("GET", `/api/search?q=${encodeURIComponent(q)}`, auth)).text;
    expect(await searchText(bob, "alice secret plan")).not.toContain(aliceThread);
    expect(await searchText(alice, "bob private note")).not.toContain(bobThread);
    expect(await searchText(dave, "bob private note")).not.toContain(bobThread);
    expect(await searchText(bob, "bob private note")).toContain(bobThread);
    expect(await searchText(bob, "secret plan")).not.toContain("secret plan");

    // files: a file in bob's thread is bob's
    const uploaded = await fetch(`${BASE}/api/attachments`, { method: "POST", headers: { "content-type": "image/png", cookie: bob.cookie! }, body: PNG });
    expect(uploaded.status).toBe(201);
    const saved = await uploaded.json() as { path: string };
    const file = `/api/attachments/${saved.path.split("/").pop()}`;
    expect((await api("POST", `/api/bots/${botId}/messages`, bob, { text: `bob's picture ![x](${file})`, threadId: bobThread })).status).toBe(202);
    await waitFor(async () => JSON.stringify((await api("GET", `/api/threads/${bobThread}/messages`, bob)).body).includes(file.split("/").pop()!));
    // the reference scan is kept a minute: wait it out before reading as alice
    const name = file.split("/").pop()!;
    await waitFor(async () => (await fetch(`${BASE}/api/attachments/${name}`, { headers: { cookie: alice.cookie! } })).status === 404, 70_000);
    expect((await fetch(`${BASE}/api/attachments/${name}`, { headers: { cookie: dave.cookie! } })).status).toBe(404);
    expect((await fetch(`${BASE}/api/attachments/${name}`, { headers: { cookie: bob.cookie! } })).status).toBe(200);

    // live frames: each stream carries its own thread only
    await sleep(500);
    expect(aliceStream.text()).toContain("alice secret plan");
    expect(aliceStream.text()).not.toContain("bob private note");
    expect(aliceStream.text()).not.toContain(bobThread);
    expect(bobStream.text()).toContain("bob private note");
    expect(bobStream.text()).not.toContain("alice secret plan");
    expect(bobStream.text()).not.toContain(aliceThread);
    expect(daveStream.text()).not.toMatch(/alice secret plan|bob private note/);
    for (const stream of [aliceStream, bobStream, daveStream]) stream.close();

    // a new thread is its creator's, and only theirs
    const fresh = await api("POST", `/api/bots/${botId}/tasks`, bob, { title: "Bob's second" });
    expect(fresh.status, fresh.text).toBe(201);
    expect(fresh.body.task.ownerPrincipalId).toBe(ids.bob);
    expect(fresh.body.bot.threadId).toBe(fresh.body.task.threadId);
    expect((await botOf(bob, botId))!.tasks.map((task) => task.threadId).sort()).toEqual([bobThread, fresh.body.task.threadId].sort());
    expect((await botOf(alice, botId))!.tasks.map((task) => task.threadId)).toEqual([aliceThread]);
    expect((await botOf(alice, botId))!.threadId).toBe(aliceThread);
  }, 180_000);

  it("PT-2: a group chat is shared by its people and the bot speaks there; removing a person closes it to them", async () => {
    const bob = await signIn(BOB);
    const erin = await signIn(ERIN);
    const room = await api("POST", "/api/groups", alice, {
      name: "Dumpling & co.", memberIds: [botId], humanIds: [ids.alice, ids.bob, ids.erin],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const roomThread = room.body.group.threadId as string;
    // erin holds no grant on the bot, yet talks to it in the group
    expect((await botOf(erin, botId))).toBeUndefined();
    for (const [auth, text] of [[alice, "group hello from alice"], [bob, "group hello from bob"], [erin, "group hello from erin"]] as const) {
      const posted = await api("POST", `/api/groups/${roomId}/messages`, auth, { text });
      expect(posted.status, posted.text).toBe(202);
    }
    for (const auth of [alice, bob, erin]) {
      const transcript = await waitFor(async () => {
        const got = await api("GET", `/api/threads/${roomThread}/messages`, auth);
        const text = JSON.stringify(got.body);
        return got.status === 200 && text.includes("group hello from alice") && text.includes("group hello from bob") && text.includes("group hello from erin") ? text : null;
      });
      expect(transcript).toBeTruthy();
    }
    await waitFor(async () => {
      const got = await api("GET", `/api/threads/${roomThread}/messages`, erin);
      return (got.body.messages as Array<{ role: string; kind: string; text?: string }> | undefined)?.some((m) => m.role === "bot" && m.kind === "text" && m.text) ?? false;
    }, 30_000);
    // erin still reads none of the private threads
    expect((await api("GET", `/api/threads/${bobThread}/messages`, erin)).status).toBe(404);
    // carol is not in the group
    const carol = await signIn(CAROL);
    expect((await api("GET", `/api/threads/${roomThread}/messages`, carol)).status).toBe(404);
    expect((await api("POST", `/api/groups/${roomId}/messages`, carol, { text: "let me in" })).status).toBe(404);

    // alice removes erin: the group closes to her at once
    const removed = await api("PATCH", `/api/groups/${roomId}`, alice, { humanIds: [ids.alice, ids.bob] });
    expect(removed.status, removed.text).toBe(200);
    expect((await api("GET", `/api/threads/${roomThread}/messages`, erin)).status).toBe(404);
    expect((await api("POST", `/api/groups/${roomId}/messages`, erin, { text: "still here?" })).status).toBe(404);
    expect((await api("GET", `/api/threads/${roomThread}/messages`, bob)).status).toBe(200);
  }, 120_000);
  it("PT-4: only the group's owner changes its settings; others may leave; an admin may delete it", async () => {
    const bob = await signIn(BOB);
    const erin = await signIn(ERIN);
    const dave = await signIn(DAVE);
    const room = await api("POST", "/api/groups", alice, {
      name: "Owner rule", memberIds: [botId], humanIds: [ids.alice, ids.bob, ids.erin, ids.dave],
      setup: { bulletin: "", defaultResponder: { kind: "mentions" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    expect(room.body.group.ownerId).toBe(ids.alice);

    // bob, erin and dave (an admin) are listed but do not own it
    for (const [auth, patch] of [
      [bob, { name: "Mine now" }],
      [bob, { bulletin: "new rules" }],
      [bob, { defaultResponder: { kind: "everyone" } }],
      [bob, { humanIds: [ids.alice, ids.bob, ids.erin, ids.dave, ids.carol] }],
      [erin, { memberIds: [] }],
      [dave, { bulletin: "admin override" }],
      [dave, { humanIds: [ids.alice, ids.bob, ids.dave] }],
    ] as const) {
      const refused = await api("PATCH", `/api/groups/${roomId}`, auth, patch);
      expect(refused.status, JSON.stringify(patch)).toBe(403);
      expect(refused.body.code).toBe("not_group_owner");
    }
    expect((await api("DELETE", `/api/groups/${roomId}`, erin)).status).toBe(403);
    // marking it read stays everyone's
    expect((await api("PATCH", `/api/groups/${roomId}`, bob, { unread: false })).status).toBe(200);

    // the owner changes everything
    const owned = await api("PATCH", `/api/groups/${roomId}`, alice, { name: "Owner rule 2", bulletin: "be brief", defaultResponder: { kind: "member", botId } });
    expect(owned.status, owned.text).toBe(200);
    expect(owned.body.group).toMatchObject({ name: "Owner rule 2", bulletin: "be brief", defaultResponder: { kind: "member", botId } });

    // erin leaves on her own
    const left = await api("PATCH", `/api/groups/${roomId}`, erin, { humanIds: [ids.alice, ids.bob, ids.dave] });
    expect(left.status, left.text).toBe(200);
    expect((await api("GET", `/api/threads/${room.body.group.threadId}/messages`, erin)).status).toBe(404);

    // an organization admin may delete it for moderation
    expect((await api("DELETE", `/api/groups/${roomId}`, dave)).status).toBe(200);

    // an employee owns the group they create: picks its responder and deletes it
    const bolt = await api("POST", "/api/bots", bob, { name: "Bolt owner rule" });
    expect(bolt.status, bolt.text).toBe(201);
    const mine = await api("POST", "/api/groups", bob, { name: "Bob's room", memberIds: [bolt.body.bot.id] });
    expect(mine.status, mine.text).toBe(201);
    expect(mine.body.group.ownerId).toBe(ids.bob);
    expect((await api("PATCH", `/api/groups/${mine.body.group.id}`, bob, { defaultResponder: { kind: "mentions" } })).status).toBe(200);
    // alice, an admin not listed in it, does not even see it
    expect((await api("PATCH", `/api/groups/${mine.body.group.id}`, alice, { name: "not yours" })).status).toBe(404);
    expect((await api("DELETE", `/api/groups/${mine.body.group.id}`, bob)).status).toBe(200);
  }, 120_000);
  it("PT-5: single stream on a shared bot: each person's digest holds their own topics only", async () => {
    const bob = await signIn(BOB);
    const settled = async (auth: Auth, thread: string, text: string) => waitFor(async () => {
      const got = await api("GET", `/api/threads/${thread}/messages`, auth);
      const messages = (got.body.messages ?? []) as Array<{ role: string; kind: string; text?: string }>;
      const at = messages.findIndex((m) => m.role === "user" && m.text === text);
      return at >= 0 && messages.slice(at + 1).some((m) => m.role === "bot" && m.kind === "text");
    }, 30_000);
    // Both write from a single-stream client in their own first thread.
    expect((await api("POST", `/api/bots/${botId}/messages`, alice, { text: "ALICE-ONLY stream topic", threadId: aliceThread, singleStream: true })).status).toBe(202);
    await settled(alice, aliceThread, "ALICE-ONLY stream topic");
    expect((await api("POST", `/api/bots/${botId}/messages`, bob, { text: "BOB-FIRST stream topic", threadId: bobThread, singleStream: true })).status).toBe(202);
    await settled(bob, bobThread, "BOB-FIRST stream topic");
    // Bob's new topic: a fresh thread of his, with his own earlier topic only.
    const topic = await api("POST", `/api/bots/${botId}/tasks`, bob, { stream: true });
    // 2026-10-28: a topic of Bob's nobody wrote in yet already is a new
    // topic (200, that thread); otherwise a fresh one (201)
    expect([200, 201], topic.text).toContain(topic.status);
    const topicThread = topic.body.task.threadId as string;
    expect(topic.body.task.ownerPrincipalId).toBe(ids.bob);
    expect(JSON.stringify(topic.body)).not.toContain("streamSegment");
    expect((await api("POST", `/api/bots/${botId}/messages`, bob, { text: "BOB-SECOND what came before?", threadId: topicThread, singleStream: true })).status).toBe(202);
    await settled(bob, topicThread, "BOB-SECOND what came before?");
    // the prompt of this turn, not of whichever turn ran last (#3634): the
    // follow-up of Bob's first topic can run after it
    const sent = await turnWithPrompt(join(home, "claude-turns.jsonl"), "BOB-SECOND what came before?");
    const prompt = sent.systemPrompt ?? "";
    expect(prompt).toContain("Earlier topics in this same conversation");
    expect(prompt).toContain(`id ${bobThread}`);
    expect(prompt).not.toContain(aliceThread);
    expect(prompt).not.toContain("ALICE-ONLY");
    expect(prompt).not.toContain("alice secret plan");
  }, 120_000);

  it("PT-6 (#1098): a member sets his own folders, display preference and voice keys; another member reaches none of it", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const erin = await signIn(ERIN);
    // a folder an admin opened to members
    const folder = join(home, "opened", "bob-work");
    mkdirSync(folder, { recursive: true });

    // his own bot's working folder, no admin, the path still checked
    const bolt = await api("POST", "/api/bots", bob, { name: "Bolt folders" });
    expect(bolt.status, bolt.text).toBe(201);
    const boltId = bolt.body.bot.id as string;
    const moved = await api("PATCH", `/api/bots/${boltId}`, bob, { cwd: folder });
    expect(moved.status, moved.text).toBe(200);
    expect((await api("PATCH", `/api/bots/${boltId}`, bob, { cwd: join(home, "nowhere") })).status).toBe(400);
    // his own bot's workspace is his too
    const boltSpace = join(realpathSync(join(home, ".sagax")), "workspaces", boltId);
    mkdirSync(boltSpace, { recursive: true });
    expect((await api("PATCH", `/api/bots/${boltId}`, bob, { cwd: boltSpace })).status).toBe(200);
    // another member never reaches it
    expect([403, 404]).toContain((await api("PATCH", `/api/bots/${boltId}`, carol, { cwd: folder })).status);

    // isolation on the shared server: carol cannot point her own bot at
    // bob's bot's workspace, at a system folder, at the server's data, or
    // through a symlink or `..` out of a folder opened to her
    const hers = await api("POST", "/api/bots", carol, { name: "Carol folders" });
    expect(hers.status, hers.text).toBe(201);
    const hersId = hers.body.bot.id as string;
    symlinkSync(boltSpace, join(home, "opened", "to-bob"));
    for (const target of [boltSpace, "/", "/etc", tmpdir(), join(home, ".sagax"), join(home, "opened", "to-bob"), join(home, "opened", "..", ".sagax")]) {
      const refused = await api("PATCH", `/api/bots/${hersId}`, carol, { cwd: target });
      expect(refused.status, `${target}: ${refused.text}`).toBe(403);
      expect(refused.body.code).toBe("folder_outside_own_space");
    }
    const create = await api("POST", "/api/bots", carol, { name: "Carol elsewhere", cwd: boltSpace });
    expect(create.body.bot?.cwd, create.text).not.toBe(boltSpace);
    if (create.body.bot?.id) await api("DELETE", `/api/bots/${create.body.bot.id}`, carol);
    const task = await api("POST", `/api/bots/${hersId}/tasks`, carol, { cwd: "/etc" });
    expect(task.status, task.text).toBe(403);
    // the admin keeps any existing folder
    const admin = await signIn(ALICE);
    const adminBot = await api("POST", "/api/bots", admin, { name: "Alice folders" });
    expect(adminBot.status, adminBot.text).toBe(201);
    expect((await api("PATCH", `/api/bots/${adminBot.body.bot.id}`, admin, { cwd: tmpdir() })).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${adminBot.body.bot.id}`, admin)).status).toBe(200);

    // his own group's working folder; a listed person who does not own it is refused
    const room = await api("POST", "/api/groups", bob, { name: "Bob folders", memberIds: [boltId], humanIds: [ids.bob, ids.erin] });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const roomFolder = await api("PATCH", `/api/groups/${roomId}`, bob, { cwd: folder });
    expect(roomFolder.status, roomFolder.text).toBe(200);
    expect(roomFolder.body.group.cwd).toBe(folder);
    // a group folder outside his own roots: refused
    const outside = await api("PATCH", `/api/groups/${roomId}`, bob, { cwd: "/etc" });
    expect(outside.status, outside.text).toBe(403);
    expect(outside.body.code).toBe("folder_outside_own_space");
    const listed = await api("PATCH", `/api/groups/${roomId}`, erin, { cwd: home });
    expect(listed.status, listed.text).toBe(403);
    expect([403, 404]).toContain((await api("PATCH", `/api/groups/${roomId}`, carol, { cwd: home })).status);

    // Show tool calls: his own display choice, not the installation's
    const before = (await api("GET", "/api/config", carol)).body.features?.showToolCalls === true;
    const pref = await api("PATCH", "/api/me/experimental", bob, { features: { showToolCalls: !before } });
    expect(pref.status, pref.text).toBe(200);
    expect((await api("GET", "/api/config", bob)).body.features.showToolCalls).toBe(!before);
    expect((await api("GET", "/api/config", carol)).body.features?.showToolCalls === true).toBe(before);

    // his own voice key: saved for him, never answered back, never carol's
    const saved = await api("PUT", "/api/me/voice-keys/elevenlabs", bob, { key: "sk_bob_voice_key_0001" });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.elevenlabs).toEqual({ configured: true, last4: "0001" });
    expect(saved.text).not.toContain("sk_bob_voice_key");
    expect((await api("GET", "/api/me/voice-keys", carol)).body.elevenlabs).toEqual({ configured: false, last4: null });
    // carol's removal is her own: bob's key stays
    expect((await api("DELETE", "/api/me/voice-keys/elevenlabs", carol)).status).toBe(200);
    expect((await api("GET", "/api/me/voice-keys", bob)).body.elevenlabs.configured).toBe(true);
    // OpenAI is a personal voice key too since #1693: his, never carol's
    const openai = await api("PUT", "/api/me/voice-keys/openai", bob, { key: "sk_bob_voice_key_0002" });
    expect(openai.status, openai.text).toBe(200);
    expect(openai.text).not.toContain("sk_bob_voice_key");
    expect((await api("GET", "/api/me/voice-keys", carol)).body.openai).toEqual({ configured: false, last4: null });
    expect((await api("DELETE", "/api/me/voice-keys/openai", bob)).body.openai.configured).toBe(false);
    expect([403, 404]).toContain((await api("PUT", "/api/me/voice-keys/not-a-provider", bob, { key: "sk_bob_voice_key_0003" })).status);
    expect((await api("DELETE", "/api/me/voice-keys/elevenlabs", bob)).body.elevenlabs.configured).toBe(false);

    expect((await api("DELETE", `/api/groups/${roomId}`, bob)).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${boltId}`, bob)).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${hersId}`, carol)).status).toBe(200);
  }, 120_000);
});
