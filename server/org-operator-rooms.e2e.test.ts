// #5152 through the real server: on an organization server the operator at
// this computer (loopback) is filtered for themselves like any person, so a
// room shows to them through its people. Every room of theirs they saw on a
// personal server stays theirs, and the rooms the server makes when they ask
// list them, while a member's lists never show them.
//
//   OR-1  a data directory used first by a personal server (rooms there list
//         nobody), then by an organization server: the operator keeps their
//         room from before the organization; a bot pair's channel keeps no
//         people (dm-has-no-humans) and is theirs through its bots.
//   OR-2  on the organization server, rooms the server makes at the
//         operator's request (a team file with its group chat, a legacy
//         team file's project room, a scheduled call's room) list them: their
//         lists and their stream carry them, and a member's do not.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const FIXTURES = join(SERVER_DIR, "..", "shared", "package-fixtures");
const posixOnly = describe.skipIf(process.platform === "win32");
const ADMIN: FakeOidcUser = { sub: "01J9PTORADMIN0000000000AD", email: "admin@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const MEMBER: FakeOidcUser = { sub: "01J9PTORMEMBER000000000MB", email: "member@example.test", name: "Max", preferred_username: "max", role: "employee" };

let PORT = 0;
let BASE = "";
let home = "";
let data = "";
let log = "";
let child: ChildProcess | null = null;
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

async function start(env: Record<string, string>) {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
      SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1), SAGAX_DATA_DIR: data,
      // a loopback request is the operator at this computer
      SAGAX_LOOPBACK_TRUST: "owner",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  await waitFor(async () => {
    if (child?.exitCode !== null) throw new Error(`server exited during boot:\n${log.slice(-4000)}`);
    try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
  }, 40_000);
}
async function stop() {
  if (!child) return;
  child.kill("SIGTERM");
  await waitForExit(child);
  child = null;
}

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const begin = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(begin.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(begin.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

/** The operator's stream at this computer (loopback). */
async function openStream(): Promise<{ text: () => string; close: () => void }> {
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events`, { headers: { accept: "text/event-stream" } }, (res) => {
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

const rooms = async (auth?: Auth) => {
  const listed = await api("GET", "/api/groups", auth);
  expect(listed.status, listed.text).toBe(200);
  return listed.body.groups as Array<{ id: string; dm?: boolean; humanIds?: string[] }>;
};
const roomIds = async (auth?: Auth) => (await rooms(auth)).map((group) => group.id);

posixOnly("#5152: the operator keeps their rooms on an organization server", () => {
  let member: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, MEMBER].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-operator-rooms-"));
    data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));

    // A personal server first: two bots of the operator, a room with one of
    // them and a room with both (it becomes their pair's channel below).
    // Nothing here lists a person.
    await start({});
    for (const name of ["Desk", "Scout"]) {
      const bot = await api("POST", "/api/bots", undefined, { name });
      expect(bot.status, bot.text).toBe(201);
      ids[name] = bot.body.bot.id;
    }
    const before = await api("POST", "/api/groups", undefined, { name: "Before the org", memberIds: [ids.Desk] });
    expect(before.status, before.text).toBe(201);
    ids.before = before.body.group.id;
    const both = await api("POST", "/api/groups", undefined, { name: "Desk and Scout", memberIds: [ids.Desk, ids.Scout] });
    expect(both.status, both.text).toBe(201);
    ids.pair = both.body.group.id;
    await stop();

    // The two bots' pair channel, as a peer exchange leaves it (no people by
    // design: dm-has-no-humans).
    const groups = JSON.parse(readFileSync(join(data, "groups.json"), "utf8"));
    for (const group of groups) {
      expect(group.humanIds ?? []).toEqual([]);
      expect(group.createdBy).toBeUndefined();
      if (group.id !== ids.pair) continue;
      group.dm = true;
      group.name = "Desk ⇄ Scout";
      group.defaultResponder = { kind: "mentions" };
      delete group.tasks;
      delete group.setupCompletedAt;
      delete group.setupSkippedAt;
    }
    writeFileSync(join(data, "groups.json"), JSON.stringify(groups), { mode: 0o600 });

    // The same data directory, now an organization server.
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    await start({
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key",
      SAGAX_ORG_NAME: "Acme",
    });
    await signIn(ADMIN);
    member = await signIn(MEMBER);
  }, 120_000);

  afterAll(async () => {
    await stop();
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("OR-1: a room from before the organization, and their bots' pair channel, stay the operator's", async () => {
    const mine = await rooms();
    expect(mine.map((group) => group.id)).toContain(ids.before);
    // the pair channel is theirs, and still lists no people
    const pair = mine.find((group) => group.id === ids.pair);
    expect(pair, JSON.stringify(mine)).toMatchObject({ dm: true });
    expect(pair!.humanIds ?? []).toEqual([]);
    const saved = JSON.parse(readFileSync(join(data, "groups.json"), "utf8")).find((group: { id: string }) => group.id === ids.pair);
    expect(saved.humanIds ?? []).toEqual([]);
    // a member sees neither
    const theirs = await roomIds(member);
    expect(theirs).not.toContain(ids.before);
    expect(theirs).not.toContain(ids.pair);
  }, 60_000);

  it("OR-2: the rooms the server makes when the operator asks list them", async () => {
    const stream = await openStream();
    const made: string[] = [];

    // a team file with its group chat
    const team = await api("POST", "/api/teams/import", undefined, JSON.parse(readFileSync(join(FIXTURES, "full-team.v2.json"), "utf8")));
    expect(team.status, team.text).toBe(201);
    expect(team.body.groups).toHaveLength(1);
    made.push(team.body.groups[0].id);
    // a legacy team file's project room
    const project = await api("POST", "/api/teams/import?mode=project&room=Field%20project", undefined, {
      format: "openmaus.team", version: 2, team: { name: "Field", members: [{ key: "writer", name: "Field writer", appearance: { color: "purple" } }] },
    });
    expect(project.status, project.text).toBe(201);
    expect(project.body.group?.id).toBeTruthy();
    made.push(project.body.group.id);
    // a scheduled call's room
    const call = await api("POST", "/api/calendar-calls", undefined, {
      name: "Weekly sync", botIds: [ids.Desk, ids.Scout], schedule: { type: "once", at: Date.now() + 86_400_000 }, durationMinutes: 30,
    });
    expect(call.status, call.text).toBe(201);
    const opened = await api("POST", `/api/calendar-calls/${call.body.call.id}/room`);
    expect(opened.status, opened.text).toBe(200);
    const callRoom = opened.body.group?.id as string;
    expect(callRoom, opened.text).toBeTruthy();
    made.push(callRoom);

    // their lists and their stream carry each one
    const mine = await roomIds();
    for (const id of made) expect(mine).toContain(id);
    await waitFor(async () => made.every((id) => frames(stream).some((frame) => frame.kind === "group" && frame.group?.id === id)));
    stream.close();
    // a member's lists carry none
    const theirs = await roomIds(member);
    for (const id of made) expect(theirs).not.toContain(id);
  }, 90_000);
});
