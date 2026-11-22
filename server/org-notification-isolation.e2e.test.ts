// Organization server, through the real server (an isolated fixture: its own
// temporary home, fake Perspicax and fake engine), misuse guardrails in
// enforce mode:
//
//   NI-1  a member's request to their own bot is refused by the security
//         policy: the member reads the refusal, and the admin's app hears
//         nothing about the member's bot (no notify frame on the admin's
//         stream, no notify line the phones would follow). The admins read
//         the refusal in the console's activity log, not in the app.
//   NI-2  another person's Live call (#5147): its state reaches the person on
//         the call, whose bot it is, and nobody else. Another admin's stream
//         carries no `live.call` frame, their GET /api/live/call reads no
//         call, and their own start is refused without the other call's
//         details; a member's stream carries nothing either.
//   NI-3  the local operator (#5152): a member's bot answers the member, who
//         hears its notification. The stream of the operator at this computer
//         (loopback) and of a phone they paired from it with admin access
//         (their own admin session) carries the operator's own bots and rooms
//         only: nothing of the member's bot. Their lists say the same.
//
// A silence is only worth something beside the noise: the admin's own bot,
// created after the refusal (or the call), reaches the admin's stream, so
// the stream was live when the frame would have been sent.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { startFakeOpenAiLive, type FakeOpenAiLive } from "./testing/fake-openai-live.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ADMIN: FakeOidcUser = { sub: "01J9PTADMIN000000000000AD", email: "admin@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const MEMBER: FakeOidcUser = { sub: "01J9PTMEMBER00000000000MB", email: "member@example.test", name: "Max", preferred_username: "max", role: "employee" };
const OTHER_ADMIN: FakeOidcUser = { sub: "01J9PTADMIN000000000000BE", email: "bea@example.test", name: "Bea", preferred_username: "bea", role: "admin" };
const LIVE_KEY = "sk-fake-live-e2e";
const SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";

let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
let live: FakeOpenAiLive;

type Auth = { cookie?: string; token?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.token ? { authorization: `Bearer ${auth.token}` } : {}),
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

/** A signed-in stream, or with no auth the operator at this computer (loopback). */
async function openStream(auth?: Auth): Promise<{ text: () => string; close: () => void }> {
  let query = "";
  if (auth) {
    const { body } = await api("POST", "/api/auth/stream-ticket", auth);
    expect(body.ticket).toMatch(/^sgx_tick_/);
    query = `?ticket=${encodeURIComponent(body.ticket)}`;
  }
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events${query}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

const frames = (stream: { text: () => string }) => stream.text().split("\n")
  .filter((line) => line.startsWith("data: "))
  .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
  .filter(Boolean) as Array<Record<string, any>>;

posixOnly("Perspicax organization: a member's bot is never announced in another person's app", () => {
  let admin: Auth;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, MEMBER, OTHER_ADMIN].map((user) => idp.personOf(user));
    live = await startFakeOpenAiLive();
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-notify-isolation-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
        SAGAX_ORG_NAME: "Acme",
        SAGAX_MISUSE_GUARDRAILS: "enforce",
        // NI-3: a loopback request is the operator at this computer
        SAGAX_LOOPBACK_TRUST: "owner",
        // NI-2: Live calls on, against the fake GPT-Live
        SAGAX_LIVE_CALLS: "1",
        SAGAX_OPENAI_LIVE_URL: live.url,
        SAGAX_OPENAI_API_KEY: LIVE_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server exited during boot:\n${log}`);
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    }, 40_000);
    admin = await signIn(ADMIN);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await live?.stop();
    if (home) removeTempDir(home);
  });

  it("NI-1: a refusal on a member's own bot stays out of the admin's app and phones", async () => {
    const member = await signIn(MEMBER);
    const created = await api("POST", "/api/bots", member, { name: "Field helper" });
    expect(created.status, created.text).toBe(201);
    const memberBot = created.body.bot.id as string;
    const adminStream = await openStream(admin);

    // the member's own request, refused by the security policy
    const refused = await api("POST", `/api/bots/${memberBot}/messages`, member, { text: "sudo -i" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("misuse_blocked");

    // ordering barrier: the admin's own bot reaches the admin's stream
    const own = await api("POST", "/api/bots", admin, { name: "Desk helper" });
    expect(own.status, own.text).toBe(201);
    const adminBot = own.body.bot.id as string;
    await waitFor(async () => frames(adminStream).some((frame) => frame.kind === "bot" && frame.bot?.id === adminBot));
    await sleep(300);

    const aboutMemberBot = frames(adminStream).filter((frame) => frame.kind === "notify" && frame.notification?.botId === memberBot);
    expect(aboutMemberBot).toEqual([]);
    // the phones follow the same frames (one [notify] line per frame on its way out)
    expect(log).not.toMatch(new RegExp(`\\[notify\\][^\\n]*bot=${memberBot}`));
    adminStream.close();
  }, 60_000);

  it("NI-2: another person's Live call reaches that person only", async () => {
    const bea = await signIn(OTHER_ADMIN);
    const member = await signIn(MEMBER);
    const created = await api("POST", "/api/bots", bea, { name: "Line helper" });
    expect(created.status, created.text).toBe(201);
    const beaBot = created.body.bot.id as string;
    const adminStream = await openStream(admin);
    const beaStream = await openStream(bea);
    const memberStream = await openStream(member);

    // Bea calls her own bot: her stream follows the call
    const started = await api("POST", "/api/live/session", bea, { botId: beaBot, sdp: SDP, client: "desktop" });
    expect(started.status, started.text).toBe(201);
    const callId = started.body.call.callId as string;
    await waitFor(async () => frames(beaStream).some((frame) => frame.kind === "live.call" && frame.call?.callId === callId));
    expect((await api("GET", "/api/live/call", bea)).body.call).toMatchObject({ callId, botId: beaBot });

    // ordering barrier: the admin's own bot reaches the admin's stream
    const own = await api("POST", "/api/bots", admin, { name: "Desk helper two" });
    expect(own.status, own.text).toBe(201);
    const adminBot = own.body.bot.id as string;
    await waitFor(async () => frames(adminStream).some((frame) => frame.kind === "bot" && frame.bot?.id === adminBot));
    await sleep(300);

    // another admin hears nothing of it: no frame, no running call, a bare refusal
    expect(frames(adminStream).filter((frame) => frame.kind === "live.call")).toEqual([]);
    expect(frames(memberStream).filter((frame) => frame.kind === "live.call")).toEqual([]);
    expect((await api("GET", "/api/live/call", admin)).body).toEqual({ call: null });
    const refused = await api("POST", "/api/live/session", admin, { botId: adminBot, sdp: SDP, client: "desktop" });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.activeCall).toBeUndefined();
    expect(refused.text).not.toContain(beaBot);

    // Bea hangs up: the end reaches her stream, and still nobody else's
    expect((await api("POST", "/api/live/call/end", bea, { callId })).status).toBe(200);
    await waitFor(async () => frames(beaStream).some((frame) => frame.kind === "live.call" && frame.call?.callId === callId && frame.call?.status === "ended"));
    await sleep(300);
    expect(frames(adminStream).filter((frame) => frame.kind === "live.call")).toEqual([]);
    expect(frames(memberStream).filter((frame) => frame.kind === "live.call")).toEqual([]);
    adminStream.close();
    beaStream.close();
    memberStream.close();
  }, 60_000);

  it("NI-3: the local operator's stream carries their own bots, never a member's (#5152)", async () => {
    // a phone the operator paired from this computer with admin access: an
    // admin session that is the local operator
    const opened = await api("POST", "/api/auth/pairing", undefined, { scopes: ["admin", "client"], label: "Operator phone" });
    expect(opened.status, opened.text).toBe(200);
    const paired = await api("POST", "/api/auth/pair", undefined, { code: opened.body.code });
    expect(paired.status, paired.text).toBe(200);
    expect(paired.body.session.principalId).toBeTruthy();
    const operatorPhone: Auth = { token: paired.body.token };
    const member = await signIn(MEMBER);
    const created = await api("POST", "/api/bots", member, { name: "Survey helper" });
    expect(created.status, created.text).toBe(201);
    const memberBot = created.body.bot.id as string;
    const operatorStream = await openStream();
    const phoneStream = await openStream(operatorPhone);
    const memberStream = await openStream(member);
    const aboutMemberBot = (stream: { text: () => string }) => frames(stream).filter((frame) => frame.kind === "notify" && frame.notification?.botId === memberBot);

    // the member's bot answers the member: the member hears its notification
    const sent = await api("POST", `/api/bots/${memberBot}/messages`, member, { text: "Summarize the site visit" });
    expect(sent.status, sent.text).toBeLessThan(300);
    await waitFor(async () => aboutMemberBot(memberStream).length > 0, 40_000);

    // ordering barrier: the operator's own bot, and a room they make at this
    // computer, reach both of the operator's streams
    const own = await api("POST", "/api/bots", undefined, { name: "Console helper" });
    expect(own.status, own.text).toBe(201);
    const operatorBot = own.body.bot.id as string;
    const room = await api("POST", "/api/groups", undefined, { name: "Console room", memberIds: [operatorBot] });
    expect(room.status, room.text).toBe(201);
    const operatorRoom = room.body.group.id as string;
    // a room they make with a colleague, as the room picker does: they stay in it
    const memberId = (await api("GET", "/api/config", member)).body.viewer.principalId as string;
    const shared = await api("POST", "/api/groups", undefined, { name: "Console and colleague", memberIds: [operatorBot], humanIds: [memberId] });
    expect(shared.status, shared.text).toBe(201);
    const sharedRoom = shared.body.group.id as string;
    // and one their phone makes with a colleague (an admin session): they stay in it too
    const fromPhone = await api("POST", "/api/groups", operatorPhone, { name: "Phone and colleague", memberIds: [operatorBot], humanIds: [memberId] });
    expect(fromPhone.status, fromPhone.text).toBe(201);
    const phoneRoom = fromPhone.body.group.id as string;
    const ownRooms = [operatorRoom, sharedRoom, phoneRoom];
    const seesOwn = (stream: { text: () => string }) => frames(stream).some((frame) => frame.kind === "bot" && frame.bot?.id === operatorBot)
      && ownRooms.every((id) => frames(stream).some((frame) => frame.kind === "group" && frame.group?.id === id));
    await waitFor(async () => seesOwn(operatorStream) && seesOwn(phoneStream));
    await sleep(300);

    expect(aboutMemberBot(operatorStream)).toEqual([]);
    expect(aboutMemberBot(phoneStream)).toEqual([]);
    // nor any other frame of the member's bot
    expect(operatorStream.text()).not.toContain(memberBot);
    expect(phoneStream.text()).not.toContain(memberBot);
    // the operator's lists say what their streams say
    for (const who of [undefined, operatorPhone]) {
      const bots = (await api("GET", "/api/bots", who)).body.bots.map((bot: any) => bot.id);
      expect(bots).toContain(operatorBot);
      expect(bots).not.toContain(memberBot);
      const rooms = (await api("GET", "/api/groups", who)).body.groups.map((group: any) => group.id);
      for (const id of ownRooms) expect(rooms).toContain(id);
    }
    expect((await api("GET", "/api/bots", member)).body.bots.map((bot: any) => bot.id)).toContain(memberBot);
    operatorStream.close();
    phoneStream.close();
    memberStream.close();
  }, 90_000);
});
