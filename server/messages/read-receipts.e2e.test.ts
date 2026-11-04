// Read receipts on an organization server, through the real server and the
// fake provider (server/messages/read-receipts.ts):
//
//   RR-1  a room with two people and a bot: the bot's position moves when its
//         turn's prompt carries the message, a person's when their app says
//         they saw it, forward only; positions reach the room's people live
//         (thread.read), never the transcript; someone outside the room gets
//         404 and an admin who is not a member leaves no receipt
//   RR-2  a 1:1 with a bot: the bot's position is the message its turn consumed
//   RR-3  a conversation between two people: "Send read receipts" off hides
//         that person's position from the other and the other's from them
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


const frames = (text: string, kind: string) => text.split("\n")
  .filter((line) => line.startsWith("data:"))
  .map((line) => JSON.parse(line.slice(5)) as Record<string, unknown>)
  .filter((frame) => frame.kind === kind);

posixOnly("Perspicax organization: read receipts", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol" | "dave", string>;
  let botId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-read-receipts-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", access: "api", config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = await api("GET", "/api/org/directory", alice);
      const list = got.body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 4 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId.toLowerCase();
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol"), dave: idOf("dave") };
    const created = await api("POST", "/api/bots", alice, { name: "Quasar" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("RR-1: a room's people and bot leave positions, live, forward only, members only", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE); // an organization admin, not in the room
    const room = await api("POST", "/api/groups", alice, {
      name: "Ops", memberIds: [botId], humanIds: [ids.alice, ids.bob],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const threadId = room.body.group.threadId as string;
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const carolStream = await openStream(carol);

    const sent = await api("POST", `/api/groups/${roomId}/messages`, alice, { text: "deploy at five?" });
    expect(sent.status, sent.text).toBe(202);
    const asked = sent.body.message.id as string;
    // the bot read it when its turn's prompt carried it
    const botRead = await waitFor(async () => {
      const got = await api("GET", `/api/threads/${threadId}/read`, alice);
      return got.body.reads?.[`bot:${botId}`]?.messageId === asked ? got.body : null;
    }, 60_000);
    expect(botRead.self).toBe(ids.alice);
    const reply = await waitFor(async () => {
      const got = await api("GET", `/api/threads/${threadId}/messages`, alice);
      return (got.body.messages as Array<{ id: string; role: string; kind: string; text?: string }>).find((m) => m.role === "bot" && m.kind === "text" && m.text);
    }, 60_000);
    const transcriptBefore = (await api("GET", `/api/threads/${threadId}/messages`, alice)).body.messages.length as number;

    // bob's app showed him the reply
    const seen = await api("POST", `/api/threads/${threadId}/read`, bob, { messageId: reply.id });
    expect(seen.status, seen.text).toBe(200);
    expect(seen.body.read.messageId).toBe(reply.id);
    // an older message never moves it back
    const back = await api("POST", `/api/threads/${threadId}/read`, bob, { messageId: asked });
    expect(back.body.read.messageId).toBe(reply.id);
    expect((await api("POST", `/api/threads/${threadId}/read`, bob, { messageId: "nope" })).status).toBe(404);
    expect((await api("POST", `/api/threads/${threadId}/read`, bob, {})).status).toBe(400);

    const view = await api("GET", `/api/threads/${threadId}/read`, alice);
    expect(view.body.reads[ids.bob].messageId).toBe(reply.id);
    expect(view.body.reads[`bot:${botId}`].messageId).toBe(asked);
    expect((await api("GET", `/api/threads/${threadId}/read`, bob)).body.self).toBe(ids.bob);

    // someone outside the room sees nothing; an admin moderating leaves no receipt
    expect((await api("GET", `/api/threads/${threadId}/read`, carol)).status).toBe(404);
    expect((await api("POST", `/api/threads/${threadId}/read`, carol, { messageId: reply.id })).status).toBe(404);
    expect([403, 404]).toContain((await api("POST", `/api/threads/${threadId}/read`, dave, { messageId: reply.id })).status);
    expect(Object.keys((await api("GET", `/api/threads/${threadId}/read`, alice)).body.reads).sort()).toEqual([`bot:${botId}`, ids.bob].sort());

    // live to the room's people, never to anyone else
    await waitFor(async () => frames(aliceStream.text(), "thread.read").some((frame) => frame.participantId === ids.bob));
    expect(frames(aliceStream.text(), "thread.read").some((frame) => frame.participantId === `bot:${botId}`)).toBe(true);
    expect(frames(bobStream.text(), "thread.read").some((frame) => frame.participantId === `bot:${botId}`)).toBe(true);
    expect(frames(carolStream.text(), "thread.read")).toEqual([]);
    for (const stream of [aliceStream, bobStream, carolStream]) stream.close();

    // never written to the chat
    expect((await api("GET", `/api/threads/${threadId}/messages`, alice)).body.messages.length).toBe(transcriptBefore);
  }, 120_000);

  it("RR-2: in a 1:1 the bot's position is the message its turn consumed", async () => {
    const bot = (await api("GET", "/api/bots", alice)).body.bots.find((candidate: { id: string }) => candidate.id === botId) as { threadId: string };
    expect((await api("POST", `/api/bots/${botId}/messages`, alice, { text: "summarize the week", threadId: bot.threadId })).status).toBe(202);
    const asked = await waitFor(async () => {
      const got = await api("GET", `/api/threads/${bot.threadId}/messages`, alice);
      return (got.body.messages as Array<{ id: string; role: string; text?: string }>).find((m) => m.role === "user" && m.text === "summarize the week");
    });
    await waitFor(async () => (await api("GET", `/api/threads/${bot.threadId}/read`, alice)).body.reads?.[`bot:${botId}`]?.messageId === asked.id, 60_000);
  }, 90_000);

  it("RR-3: between two people, turning receipts off hides both ways", async () => {
    const bob = await signIn(BOB);
    const opened = await api("POST", "/api/people-dms", alice, { principalId: ids.bob });
    expect(opened.status, opened.text).toBe(201);
    const dm = opened.body.group as { id: string; threadId: string };
    const first = await api("POST", `/api/groups/${dm.id}/messages`, alice, { text: "lunch?" });
    expect(first.status, first.text).toBe(202);
    expect((await api("POST", `/api/threads/${dm.threadId}/read`, bob, { messageId: first.body.message.id })).body.read.messageId).toBe(first.body.message.id);
    const answer = await api("POST", `/api/groups/${dm.id}/messages`, bob, { text: "sure" });
    expect((await api("POST", `/api/threads/${dm.threadId}/read`, alice, { messageId: answer.body.message.id })).status).toBe(200);
    expect(Object.keys((await api("GET", `/api/threads/${dm.threadId}/read`, alice)).body.reads).sort()).toEqual([ids.alice, ids.bob].sort());

    const aliceStream = await openStream(alice);
    const off = await api("PUT", "/api/me/preferences", bob, { preferences: { "sagax.readReceipts.v1": "off" } });
    expect(off.status, off.text).toBe(200);
    // alice's app is told to fetch again, and no longer sees bob's position
    await waitFor(async () => frames(aliceStream.text(), "thread.read").some((frame) => frame.threadId === dm.threadId && frame.reset === true));
    expect(Object.keys((await api("GET", `/api/threads/${dm.threadId}/read`, alice)).body.reads)).toEqual([ids.alice]);
    // and bob sees nobody's, nor leaves a new one
    expect((await api("GET", `/api/threads/${dm.threadId}/read`, bob)).body.reads).toEqual({});
    const later = await api("POST", `/api/groups/${dm.id}/messages`, alice, { text: "12:30?" });
    expect((await api("POST", `/api/threads/${dm.threadId}/read`, bob, { messageId: later.body.message.id })).body.read).toBeNull();
    expect(frames(aliceStream.text(), "thread.read").some((frame) => frame.participantId === ids.bob)).toBe(false);
    aliceStream.close();

    expect((await api("PUT", "/api/me/preferences", bob, { preferences: {} })).status).toBe(200);
    const back = await api("GET", `/api/threads/${dm.threadId}/read`, alice);
    expect(back.body.reads[ids.bob].messageId).toBe(first.body.message.id);
  }, 90_000);
});
