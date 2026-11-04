// Emoji reactions on an organization server, through the real server and the
// fake provider (shared/reactions.ts, docs/messages-reactions.md):
//
//   RX-1  a room: a person toggles their own reaction on a person's and on a
//         bot's message; the chips' actors carry id, kind and name; the
//         change reaches the room's people live (message.patch), never
//         someone outside, who gets 404; no message is written; a bad emoji
//         is 400 and an unknown message 404
//   RX-2  a conversation between two people takes reactions from the pair
//         only
//   RX-3  a bot's react_to_message route: the message it is answering by
//         default, recorded with the bot as the actor, one reaction per
//         message, never its own message, a small budget per turn,
//         remove_reaction, and no message created
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let finishGate: string;
let engineDump: string;
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


const frames = (text: string, kind: string) => text.split("\n")
  .filter((line) => line.startsWith("data:"))
  .map((line) => JSON.parse(line.slice(5)) as Record<string, unknown>)
  .filter((frame) => frame.kind === kind);

posixOnly("Perspicax organization: emoji reactions", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol" | "dave", string>;
  let botId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-reactions-"));
    finishGate = join(home, "finish-turn");
    engineDump = join(home, "engine-dump.json");
    writeFileSync(finishGate, "finish");
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", access: "api", environment: {
        FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate, FAKE_CLAUDE_DUMP: engineDump,
        // 95e8f39e4 continues tool-only endings. Keep Bash, then answer;
        // RX-3 owns when that native turn may finish and retire its token.
        FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([{ name: "Bash", input: { command: "echo hi" }, ok: true, output: "hi" }]),
      }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } } },
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

  type Line = { id: string; role: string; kind: string; text?: string; reactions?: Array<{ emoji: string; actors: Array<{ id: string; kind: string; name: string }>; at: number }> };
  const transcript = async (threadId: string, auth: Auth) => (await api("GET", `/api/threads/${threadId}/messages`, auth)).body.messages as Line[];
  const react = (threadId: string, messageId: string, auth: Auth, emoji: unknown) =>
    api("POST", `/api/threads/${threadId}/messages/${messageId}/reactions`, auth, { emoji });

  it("RX-1: a room's people toggle their own reactions, live to the room only", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const room = await api("POST", "/api/groups", alice, {
      name: "Ops", memberIds: [botId], humanIds: [ids.alice, ids.bob],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const threadId = room.body.group.threadId as string;
    const sent = await api("POST", `/api/groups/${roomId}/messages`, alice, { text: "deploy at five?" });
    expect(sent.status, sent.text).toBe(202);
    const asked = sent.body.message.id as string;
    const reply = await waitFor(async () => (await transcript(threadId, alice)).find((m) => m.role === "bot" && m.kind === "text" && m.text), 60_000);
    await sleep(500);
    const before = (await transcript(threadId, alice)).length;
    const aliceStream = await openStream(alice);
    const carolStream = await openStream(carol);

    // bob on alice's line, alice on the bot's
    const thumbs = await react(threadId, asked, bob, "👍");
    expect(thumbs.status, thumbs.text).toBe(200);
    expect(thumbs.body.added).toBe(true);
    expect(thumbs.body.reactions).toEqual([{ emoji: "👍", actors: [{ id: ids.bob, kind: "person", name: "Bob" }], at: expect.any(Number) }]);
    expect((await react(threadId, reply.id, alice, "❤️")).status).toBe(200);
    expect((await react(threadId, asked, alice, "👍")).body.reactions[0].actors.map((actor: { id: string }) => actor.id)).toEqual([ids.bob, ids.alice]);

    // a second press takes one's own back, never someone else's
    const undone = await react(threadId, asked, alice, "👍");
    expect(undone.body.added).toBe(false);
    expect(undone.body.reactions[0].actors.map((actor: { id: string }) => actor.id)).toEqual([ids.bob]);

    // stored on the message, which stays the only change: no new line
    const after = await transcript(threadId, alice);
    expect(after).toHaveLength(before);
    expect(after.find((m) => m.id === asked)!.reactions).toEqual([{ emoji: "👍", actors: [{ id: ids.bob, kind: "person", name: "Bob" }], at: expect.any(Number) }]);
    expect(after.find((m) => m.id === reply.id)!.reactions![0]).toMatchObject({ emoji: "❤️", actors: [{ id: ids.alice, kind: "person", name: "Alice" }] });

    // live to the room, never outside it
    await waitFor(async () => frames(aliceStream.text(), "message.patch").some((frame) =>
      (frame.message as Line).id === asked && Boolean((frame.message as Line).reactions?.length)));
    await sleep(300);
    expect(frames(carolStream.text(), "message.patch").some((frame) => (frame.message as Line).id === asked)).toBe(false);
    expect(frames(aliceStream.text(), "notify")).toEqual([]);
    aliceStream.close();
    carolStream.close();

    // outside the room: not found; a bad emoji, an unknown message
    expect((await react(threadId, asked, carol, "👍")).status).toBe(404);
    expect((await react(threadId, asked, bob, "hello")).status).toBe(400);
    expect((await react(threadId, asked, bob, "<b>👍</b>")).status).toBe(400);
    expect((await react(threadId, "not-a-message", bob, "👍")).status).toBe(404);
    // a body naming someone else is ignored: the caller is the actor
    const spoof = await api("POST", `/api/threads/${threadId}/messages/${reply.id}/reactions`, bob, { emoji: "🎉", by: botId });
    expect(spoof.body.reactions.find((reaction: { emoji: string }) => reaction.emoji === "🎉").actors).toEqual([{ id: ids.bob, kind: "person", name: "Bob" }]);
  }, 120_000);

  it("RX-2: a conversation between two people takes the pair's reactions only", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const opened = await api("POST", "/api/people-dms", alice, { principalId: ids.bob });
    expect(opened.status, opened.text).toBe(201);
    const dm = opened.body.group as { id: string; threadId: string };
    const line = await api("POST", `/api/groups/${dm.id}/messages`, bob, { text: "shipped" });
    expect(line.status, line.text).toBe(202);
    const hearted = await react(dm.threadId, line.body.message.id, alice, "🎉");
    expect(hearted.status, hearted.text).toBe(200);
    expect(hearted.body.reactions[0].actors).toEqual([{ id: ids.alice, kind: "person", name: "Alice" }]);
    expect((await react(dm.threadId, line.body.message.id, carol, "🎉")).status).toBe(404);
  }, 60_000);

  it("RX-3: a bot reacts from its turn, once per message, never to itself, without a message", async () => {
    const bot = (await api("GET", "/api/bots", alice)).body.bots.find((candidate: { id: string }) => candidate.id === botId) as { threadId: string };
    const busy = async () => (await api("GET", "/api/bots", alice)).body.bots
      .find((candidate: { id: string }) => candidate.id === botId).tasks
      .find((task: { threadId: string }) => task.threadId === bot.threadId).busy === true;
    const say = async (text: string, held = false) => {
      expect((await api("POST", `/api/bots/${botId}/messages`, alice, { text, threadId: bot.threadId })).status).toBe(202);
      await waitFor(async () => {
        const lines = await transcript(bot.threadId, alice);
        const asked = lines.findIndex((message) => message.role === "user" && message.text === text);
        return asked >= 0 && lines.slice(asked + 1).some((message) => message.role === "bot" && message.kind === "text" && message.text)
          && (await busy()) === held;
      }, 60_000);
    };
    await say("ship the fix");
    rmSync(engineDump, { force: true });
    rmSync(finishGate, { force: true });
    try {
      await say("thanks, that is all", true);
      // The exact native turn's mount, not a synthetic capability minted
      // after a turn settled. Match bot, thread and prompt before reading it.
      const mounted = await waitFor(async () => {
        if (!existsSync(engineDump)) return false;
        const dump = JSON.parse(readFileSync(engineDump, "utf8"));
        const env = dump.mcpConfig?.mcpServers?.agents?.env;
        return env?.SAGAX_BOT_ID === botId && env.SAGAX_THREAD_ID === bot.threadId
          && JSON.stringify(dump.prompt ?? "").includes("thanks, that is all") ? env : false;
      });
      const token = mounted.SAGAX_COMMS_TOKEN_FILE
        ? readFileSync(mounted.SAGAX_COMMS_TOKEN_FILE, "utf8").trim() : mounted.SAGAX_COMMS_TOKEN;
      expect(Boolean(token)).toBe(true);
      expect(await busy()).toBe(true);
      const lines = await transcript(bot.threadId, alice);
      const first = lines.find((m) => m.role === "user" && m.text === "ship the fix")!;
      const asked = lines.find((m) => m.role === "user" && m.text === "thanks, that is all")!;
      const own = lines.find((m) => m.role === "bot" && m.kind === "text" && m.text)!;
      const before = lines.length;
      const internal = async (body: unknown) => {
        const res = await fetch(`${BASE}/api/internal/reaction`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() as any };
      };

      // no id: the message it is answering (the person's newest line)
      const thumbs = await internal({ emoji: "👍" });
      expect(thumbs.status, JSON.stringify(thumbs.body)).toBe(200);
      expect(thumbs.body).toMatchObject({ ok: true, messageId: asked.id, emoji: "👍", changed: true });
      // the same again changes nothing; another emoji on that message is refused
      expect((await internal({ emoji: "👍", messageId: asked.id })).body.changed).toBe(false);
      const second = await internal({ emoji: "✅", messageId: asked.id });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("reaction_one");
      // never its own line, never text, never a message of another thread
      expect((await internal({ emoji: "👍", messageId: own.id })).body.code).toBe("reaction_own");
      expect((await internal({ emoji: "thumbs up" })).status).toBe(400);
      expect((await internal({ emoji: "👍", messageId: "nope" })).status).toBe(404);

      // recorded with the bot as the actor, its name for the tooltip
      const stored = (await transcript(bot.threadId, alice)).find((m) => m.id === asked.id)!;
      expect(stored.reactions).toEqual([{ emoji: "👍", actors: [{ id: `bot:${botId}`, kind: "bot", name: "Quasar" }], at: expect.any(Number) }]);

      // remove_reaction, then a new one is allowed
      const removed = await internal({ remove: true, messageId: asked.id });
      expect(removed.body).toMatchObject({ ok: true, changed: true, removed: ["👍"] });
      expect((await internal({ emoji: "✅", messageId: asked.id })).body.changed).toBe(true);
      // and a person's reaction sits beside the bot's
      expect((await react(bot.threadId, asked.id, alice, "✅")).body.reactions[0].actors.map((actor: { kind: string }) => actor.kind)).toEqual(["bot", "person"]);

      // a small budget per turn: three adds (👍, ✅ and this one), then refused
      expect((await internal({ emoji: "👀", messageId: first.id })).body.changed).toBe(true);
      expect((await internal({ remove: true, messageId: first.id })).body.changed).toBe(true);
      const exhausted = await internal({ emoji: "🙏", messageId: first.id });
      expect(exhausted.status, JSON.stringify(exhausted.body)).toBe(429);
      expect(exhausted.body.code, JSON.stringify(exhausted.body)).toBe("reaction_budget");

      // no reaction wrote a line
      expect(await transcript(bot.threadId, alice)).toHaveLength(before);
      expect(await busy()).toBe(true);
      writeFileSync(finishGate, "finish");
      await waitFor(async () => !(await busy()));
      // The same native credential is no longer authorised after its turn.
      expect((await internal({ emoji: "🙏", messageId: first.id })).status).toBe(401);
    } finally {
      writeFileSync(finishGate, "finish");
    }
  }, 120_000);
});
