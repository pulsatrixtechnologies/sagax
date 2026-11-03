// Shared with someone who owns no bot, on a Perspicax organization server,
// through the real server, the fake provider and the fake Claude CLI (owner:
// "When I shared a bot, I need to create a bot in order for the group bot to
// show up for the person I shared the bot to."):
//
//   SV-1  bob, who owns no bot and is already connected, sees alice's bot as
//         soon as she shares it (use) and her group as soon as she adds him,
//         in his list and on his open stream, without reconnecting by hand
//   SV-2  carol, who owns no bot, signs in after the share: her first
//         snapshot already holds the shared bot and the group
//   SV-3  neither ever reads alice's own thread with the bot
//   SV-4  in a group, every person sees every bot's public identity (name,
//         label, look), whoever owns it: carol sees alice's Scout beside her
//         own Yuki and a rename at once, yet cannot open Scout outside it
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
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9SVALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9SVBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9SVCAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };

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

/** An open /api/events stream: what it received, and whether the server ended it. */
async function openStream(auth: Auth): Promise<{ text: () => string; ended: () => boolean; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    let over = false;
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      for (const event of ["end", "close", "error"]) res.on(event, () => { over = true; });
      resolve({ text: () => received, ended: () => over, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

/** The frames a stream carried, parsed. */
const framesOf = (text: string) => text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)) as Record<string, any>);

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

posixOnly("Perspicax organization: a bot and a group shared with someone who owns no bot", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol", string>;
  let botId = "";
  let aliceThread = "";
  let roomId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-shared-visible-"));
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
      return list && list.length === 3 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol") };
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("SV-1: bob, connected with no bot of his own, sees the shared bot and the group at once", async () => {
    const bob = await signIn(BOB);
    // bob owns nothing and sees nothing yet
    const before = (await api("GET", "/api/bots", bob)).body;
    expect(before.bots).toEqual([]);
    expect(before.groups).toEqual([]);
    const stream = await openStream(bob);
    await waitFor(async () => framesOf(stream.text()).some((frame) => frame.kind === "hello"));

    const created = await api("POST", "/api/bots", alice, { name: "Xavier" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    aliceThread = created.body.bot.threadId;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    expect((await api("POST", `/api/bots/${botId}/messages`, alice, { text: "alice secret plan" })).status).toBe(202);
    const room = await api("POST", "/api/groups", alice, {
      name: "Planning", memberIds: [botId], humanIds: [ids.alice],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    roomId = room.body.group.id;

    // alice shares the bot with bob (use): his open stream learns it, either
    // with the bot itself or by ending so the app takes a fresh snapshot
    const shared = await api("PUT", `/api/bots/${botId}/grants`, alice, { target: `user:${ids.bob}`, level: "use" });
    expect(shared.status, shared.text).toBe(200);
    await waitFor(async () => stream.ended() || framesOf(stream.text()).some((frame) => frame.kind === "bot" && frame.bot?.id === botId));
    const listed = (await api("GET", "/api/bots", bob)).body;
    expect(listed.bots.map((bot: { id: string }) => bot.id)).toEqual([botId]);

    // alice adds bob to the group: the same, on a stream opened after the share
    const live = stream.ended() ? await openStream(bob) : stream;
    await waitFor(async () => framesOf(live.text()).some((frame) => frame.kind === "hello"));
    const added = await api("PATCH", `/api/groups/${roomId}`, alice, { humanIds: [ids.alice, ids.bob] });
    expect(added.status, added.text).toBe(200);
    await waitFor(async () => live.ended() || framesOf(live.text()).some((frame) => frame.kind === "group" && frame.group?.id === roomId));
    const withRoom = (await api("GET", "/api/bots", bob)).body;
    expect(withRoom.groups.map((group: { id: string }) => group.id)).toEqual([roomId]);
    expect(withRoom.bots.map((bot: { id: string }) => bot.id)).toEqual([botId]);
    expect((await api("GET", "/api/groups", bob)).body.groups.map((group: { id: string }) => group.id)).toEqual([roomId]);

    // SV-3: bob's view of the bot is his own thread, never alice's
    const mine = withRoom.bots[0] as WireBot;
    expect(mine.threadId).not.toBe(aliceThread);
    expect(mine.tasks.map((task) => task.threadId)).not.toContain(aliceThread);
    expect(JSON.stringify(withRoom)).not.toContain("alice secret plan");
    expect((await api("GET", `/api/threads/${aliceThread}/messages`, bob)).status).toBe(404);
    expect(live.text() + stream.text()).not.toContain("alice secret plan");
    stream.close();
    live.close();
  }, 120_000);

  it("SV-2: carol, with no bot of her own, signs in after the share and her first snapshot holds both", async () => {
    expect((await api("PUT", `/api/bots/${botId}/grants`, alice, { target: `user:${ids.carol}`, level: "use" })).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${roomId}`, alice, { humanIds: [ids.alice, ids.bob, ids.carol] })).status).toBe(200);
    const carol = await signIn(CAROL);
    const stream = await openStream(carol);
    await waitFor(async () => framesOf(stream.text()).some((frame) => frame.kind === "hello"));
    const first = (await api("GET", "/api/bots", carol)).body;
    expect(first.bots.map((bot: { id: string }) => bot.id)).toEqual([botId]);
    expect(first.groups.map((group: { id: string }) => group.id)).toEqual([roomId]);
    expect((first.bots[0] as WireBot).threadId).not.toBe(aliceThread);
    expect(JSON.stringify(first)).not.toContain("alice secret plan");
    stream.close();
  }, 60_000);

  it("SV-4: every person in a group sees each bot's name and look, never more", async () => {
    const carol = await signIn(CAROL);
    const yuki = await api("POST", "/api/bots", carol, { name: "Yuki" });
    expect(yuki.status, yuki.text).toBe(201);
    const scout = await api("POST", "/api/bots", alice, { name: "Scout" });
    expect(scout.status, scout.text).toBe(201);
    const scoutId = scout.body.bot.id as string;
    const look = { character: "shape", shape: "blob" };
    const styled = await api("PATCH", `/api/bots/${scoutId}`, alice, { title: "Researcher", color: "blue", mascotLook: look, instructions: "scout private instructions" });
    expect(styled.status, styled.text).toBe(200);
    const room = await api("POST", "/api/groups", alice, {
      name: "Scout & co.", memberIds: [scoutId, botId], humanIds: [ids.alice, ids.carol],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    const scoutRoom = room.body.group.id as string;
    // carol does not own the room: she brings her own bot in
    // (server/groups/group-ownership.ts), but cannot take alice's out or change
    // the room's settings
    const joined = await api("PATCH", `/api/groups/${scoutRoom}`, carol, { memberIds: [scoutId, botId, yuki.body.bot.id] });
    expect(joined.status, joined.text).toBe(200);
    for (const patch of [
      { memberIds: [botId, yuki.body.bot.id] },
      { name: "Carol's room" },
      { bulletin: "carol rules" },
      { defaultResponder: { kind: "mentions" } },
    ]) {
      const refused = await api("PATCH", `/api/groups/${scoutRoom}`, carol, patch);
      expect(refused.status, JSON.stringify(patch)).toBe(403);
      expect(refused.body.code).toBe("not_group_owner");
    }

    const listed = (await api("GET", "/api/bots", carol)).body;
    const seen = listed.groups.find((group: { id: string }) => group.id === scoutRoom);
    expect(seen.memberProfiles.map((profile: { name: string }) => profile.name)).toEqual(["Scout", "Xavier", "Yuki"]);
    const scoutProfile = seen.memberProfiles[0];
    expect(scoutProfile).toMatchObject({ id: scoutId, name: "Scout", title: "Researcher", color: "blue" });
    expect(scoutProfile.mascotLook?.character).toBe("shape");
    expect(Object.keys(scoutProfile).sort()).toEqual(expect.arrayContaining(["id", "name", "title", "color", "avatarUrl"]));
    for (const key of Object.keys(scoutProfile)) {
      expect(["id", "name", "title", "color", "avatarUrl", "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY", "mascotBody", "mascotSkin", "mascotLook"]).toContain(key);
    }
    expect(JSON.stringify(listed)).not.toContain("scout private instructions");
    // the same in GET /api/groups
    const rooms = (await api("GET", "/api/groups", carol)).body.groups as Array<{ id: string; memberProfiles: Array<{ name: string }> }>;
    expect(rooms.find((group) => group.id === scoutRoom)!.memberProfiles.map((profile) => profile.name)).toEqual(["Scout", "Xavier", "Yuki"]);
    // Scout is not carol's to open: not in her bots, its details refused
    expect(listed.bots.map((bot: { id: string }) => bot.id)).not.toContain(scoutId);
    expect(await botOf(carol, scoutId)).toBeUndefined();
    for (const sub of ["soul", "system-prompt", "memory", "skills"]) {
      expect([403, 404], sub).toContain((await api("GET", `/api/bots/${scoutId}/${sub}`, carol)).status);
    }
    expect([403, 404]).toContain((await api("PATCH", `/api/bots/${scoutId}`, carol, { name: "Mine now" })).status);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${scoutId}/messages`, carol, { text: "hi" })).status);

    // a rename reaches carol's open stream as the room's new profile
    const stream = await openStream(carol);
    await waitFor(async () => framesOf(stream.text()).some((frame) => frame.kind === "hello"));
    expect((await api("PATCH", `/api/bots/${scoutId}`, alice, { name: "Scout Prime" })).status).toBe(200);
    await waitFor(async () => framesOf(stream.text()).some((frame) => frame.kind === "group" && frame.group?.id === scoutRoom &&
      frame.group.memberProfiles?.some((profile: { id: string; name: string }) => profile.id === scoutId && profile.name === "Scout Prime")));
    expect(stream.text()).not.toContain("scout private instructions");
    stream.close();

    // carol takes her own bot back out
    const left = await api("PATCH", `/api/groups/${scoutRoom}`, carol, { memberIds: [scoutId, botId] });
    expect(left.status, left.text).toBe(200);
  }, 60_000);
});
