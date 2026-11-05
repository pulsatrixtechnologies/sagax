// Organization server, through the real server (an isolated fixture: its own
// temporary home, fake Perspicax and fake engine):
//
//   PR-1  alice and bob are signed in with an event stream each: alice sees
//         bob online; bob's desktop reports the screen locked and alice's
//         stream hears presence.changed (away) at once; bob hides his
//         presence and alice reads him offline with no time while bob still
//         sees his own state, marked hidden
//   PR-2  a service account gets no presence, and its stream hears none
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

posixOnly("Perspicax organization: presence", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "robot", string>;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [
      ...[ALICE, BOB].map((user) => idp.personOf(user)),
      { ...idp.personOf(SERVICE), kind: "service" as const },
    ];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-presence-"));
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
    ids = { alice: idOf("alice"), bob: idOf("bob"), robot: idOf("robot") };
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  const presenceOf = async (auth: Auth, id: string) => {
    const got = await api("GET", "/api/org/presence", auth);
    expect(got.status, got.text).toBe(200);
    return (got.body.people as Array<{ principalId: string; state: string; lastSeenAt: number | null; hidden?: boolean }>).find((row) => row.principalId === id);
  };
  const framesAbout = (stream: { text: () => string }, id: string) => stream.text().split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
    .filter((frame) => frame?.kind === "presence.changed")
    .flatMap((frame) => (frame.people as Array<{ principalId: string; state: string }>).filter((row) => row.principalId === id).map((row) => ({ ...row, audience: frame.audience })));

  it("PR-1: online, away when the desktop locks, offline for the others when hidden", async () => {
    const bob = await signIn(BOB);
    const aliceStream = await openStream(alice);
    // nobody connected yet is offline
    expect(await presenceOf(alice, ids.bob)).toMatchObject({ state: "offline", lastSeenAt: null });
    const bobStream = await openStream(bob);
    await waitFor(async () => (await presenceOf(alice, ids.bob))?.state === "online");
    await waitFor(async () => framesAbout(aliceStream, ids.bob).some((row) => row.state === "online"));
    const beat = await api("POST", "/api/presence/heartbeat", bob, { pageId: "desktop-page-1", kind: "desktop", idleMs: 0, systemIdle: "active" });
    expect(beat.status, beat.text).toBe(200);
    expect(beat.body).toMatchObject({ state: "online" });

    // bob's computer locks: away at once, live on alice's stream
    const locked = await api("POST", "/api/presence/heartbeat", bob, { pageId: "desktop-page-1", kind: "desktop", idleMs: 0, systemIdle: "locked" });
    expect(locked.body).toMatchObject({ state: "away" });
    await waitFor(async () => framesAbout(aliceStream, ids.bob).some((row) => row.state === "away"));
    expect(await presenceOf(alice, ids.bob)).toMatchObject({ state: "away" });

    // bob hides his presence: offline with no time for alice, real for bob
    const saved = await api("PUT", "/api/me/preferences", bob, { preferences: { "sagax.presenceVisible.v1": "0" } });
    expect(saved.status, saved.text).toBe(200);
    expect(await presenceOf(alice, ids.bob)).toEqual({ principalId: ids.bob, state: "offline", lastSeenAt: null });
    expect(await presenceOf(bob, ids.bob)).toMatchObject({ state: "away", hidden: true });
    await waitFor(async () => framesAbout(aliceStream, ids.bob).some((row) => row.state === "offline" && row.audience === undefined));
    // the real state went to bob's own stream only
    await waitFor(async () => framesAbout(bobStream, ids.bob).some((row) => row.audience === ids.bob && row.state === "away"));
    expect(framesAbout(aliceStream, ids.bob).some((row) => row.audience !== undefined)).toBe(false);
    // presence is never written to a chat
    expect(JSON.stringify((await api("GET", "/api/groups", alice)).body)).not.toContain("presence");

    const shown = await api("PUT", "/api/me/preferences", bob, { preferences: { "sagax.presenceVisible.v1": "1" } });
    expect(shown.status).toBe(200);
    expect(await presenceOf(alice, ids.bob)).toMatchObject({ state: "away" });
    aliceStream.close();
    bobStream.close();
  }, 60_000);

  it("PR-2: a service account gets no presence and hears none", async () => {
    const robot = await signIn(SERVICE);
    const refused = await api("GET", "/api/org/presence", robot);
    expect(refused.status).toBe(403);
    expect(refused.body.people).toBeUndefined();
    expect((await api("POST", "/api/presence/heartbeat", robot, { pageId: "robot-page-01", kind: "web", idleMs: 0 })).status).toBe(403);
    const robotStream = await openStream(robot);
    const bob = await signIn(BOB);
    const bobStream = await openStream(bob);
    await api("POST", "/api/presence/heartbeat", bob, { pageId: "web-page-0001", kind: "web", idleMs: 10 * 60_000 });
    await sleep(500);
    expect(robotStream.text()).not.toContain("presence.changed");
    // and the robot is listed for nobody
    expect(await presenceOf(alice, ids.robot)).toBeUndefined();
    robotStream.close();
    bobStream.close();
  }, 60_000);
});
