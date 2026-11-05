// Slice 4 of the Perspicax organization through the real server, against the
// local fake provider (teams claim, directory teams and provider_keys, the
// owner key resolve) and the fake Claude and Codex CLIs:
//
//   S4-1  teams from the id_token and the directory reach the session and
//         /api/org/directory
//   S4-3  a bot shared with a person and a team; the person who speaks
//         pays: bob's own key answers bob, never the owner's (2026-10-01);
//         someone outside sees nothing
//   S4-5  levels: use, run, edit, manage
//   S4-6  a team manager administers grants of their team with the anchor
//   S4-7  an admin administers a bot they cannot open
//   S4-4  removal from the team through the directory, then through a
//         refreshed id_token, narrows at once
//   S4-9  a person's own Codex subscription pays for their own turns, on
//         their bots and on bots shared with them; for someone else only
//         when its owner pays (#1137: the default on the owner's own
//         subscription), and each person pays (with their own default
//         model, else the same tier on an engine they can pay for, #1154)
//         once the owner chooses so
//   S4-10 a section shared with a team; a room with a team
//   S4-12 a shared section opens only what its owners consented to; a
//         read-only member changes nothing; moving rooms needs moderators
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_CODEX_LOGIN = join(SERVER_DIR, "testing", "fake-codex-login-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE_KEY = "sk-ant-test-alice-key-0001";
const BOB_KEY = "sk-ant-test-bob-key-00001";
const TEAM_T = "01J9S4TEAMT0000000000000TT";
const TEAM_U = "01J9S4TEAMU0000000000000UU";
const ALICE: FakeOidcUser = { sub: "01J9S4ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9S4BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const CAROL: FakeOidcUser = { sub: "01J9S4CAROL0000000000000C", name: "Carol", preferred_username: "carol", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const DAVE: FakeOidcUser = { sub: "01J9S4DAVE00000000000000D", name: "Dave", preferred_username: "dave", role: "employee", teams: [{ id: TEAM_U, name: "U", manager: false }] };
const MIA: FakeOidcUser = { sub: "01J9S4MIA000000000000000M", name: "Mia", preferred_username: "mia", role: "manager", teams: [{ id: TEAM_T, name: "T", manager: true }] };
const ERIN: FakeOidcUser = { sub: "01J9S4ERIN00000000000000E", name: "Erin", preferred_username: "erin", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
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

async function openStream(auth: Auth): Promise<{ text: () => string; ended: Promise<void>; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      const ended = new Promise<void>((done) => { res.on("end", () => done()); res.on("close", () => done()); res.on("error", () => done()); });
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, ended, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

const botIds = async (auth: Auth) => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string }> ?? []).map((b) => b.id);
const botOf = async (auth: Auth, id: string) => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; messages: Array<{ kind: string; role: string; text?: string; access?: any }> }>).find((b) => b.id === id);

async function createBot(auth: Auth, name: string, instanceId: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, auth, { modelSelection: { instanceId, model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  return { id: created.body.bot.id, threadId: created.body.bot.threadId };
}

function setDirectoryTeams(tMembers: string[]) {
  idp.directoryTeams = [
    { id: TEAM_T, name: "T", managers: [MIA.sub], members: tMembers },
    { id: TEAM_U, name: "U", managers: [], members: [DAVE.sub] },
  ];
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
      // the directory refreshes at boot and at every sign-in only, so each
      // path (directory, refreshed id_token) is proven on its own
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_OIDC_REFRESH_AFTER_SECONDS: "2",
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

posixOnly("Perspicax organization, slice 4: rights, teams, owner keys, sections", () => {
  let alice: Auth;
  const ids: Record<string, string> = {};
  let x: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_CODEX_LOGIN, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, MIA, ERIN].map((user) => idp.personOf(user));
    setDirectoryTeams([CAROL.sub]);
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-rights-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", access: "api", environment: { FAKE_CLAUDE_DUMP: dump }, config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true } },
        codex: { driver: "codex", environment: { SAGAX_DEVICE_AUTH_FIXTURE: "1" }, config: { cli: FAKE_CODEX_LOGIN } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 6 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S4-1: the teams claim and the directory reach the session and the directory", async () => {
    const carol = await signIn(CAROL);
    expect((await api("GET", "/api/auth/session", carol)).body).toMatchObject({ perspicaxRole: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] });
    const mia = await signIn(MIA);
    expect((await api("GET", "/api/auth/session", mia)).body).toMatchObject({ perspicaxRole: "manager", teams: [{ id: TEAM_T, manager: true }] });
    const directory = (await api("GET", "/api/org/directory", mia)).body;
    expect(directory.teams.find((t: { id: string }) => t.id === TEAM_T)).toEqual({ id: TEAM_T, name: "T", managers: [ids.mia], members: [ids.carol] });
    expect(directory.viewer).toMatchObject({ principalId: ids.mia, orgRole: "member", perspicaxRole: "manager", managedTeamIds: [TEAM_T] });
  });

  it("S4-3: shared with bob and team T; bob's own key answers bob, never alice's; dave sees none of it", async () => {
    idp.providerKeys.set(`${ALICE.sub}/anthropic`, ALICE_KEY);
    idp.providerKeys.set(`${BOB.sub}/anthropic`, BOB_KEY);
    alice = await signIn(ALICE); // a sign-in refreshes the directory: provider_keys now lists alice and bob
    x = await createBot(alice, "Xavier", "claude");
    expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    const team = await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `team:${TEAM_T}`, level: "use" });
    expect(team.status, team.text).toBe(200);
    expect(team.body.grants.find((g: { target: string }) => g.target === `team:${TEAM_T}`)).toMatchObject({ kind: "team", label: "T", level: "use" });
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE);
    const daveStream = await openStream(dave);
    expect(await botIds(bob)).toContain(x.id);
    expect(await botIds(carol)).toContain(x.id);
    expect(await botIds(dave)).not.toContain(x.id);
    await waitFor(async () => (await api("GET", "/api/me/engines", alice)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myKey === true);
    // bob has no subscription: his own key comes before the organization's
    expect((await api("GET", "/api/me/engines", bob)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")).toMatchObject({ myKey: true, orgKey: true, myTurns: "key" });
    expect((await api("POST", `/api/bots/${x.id}/messages`, bob, { text: "ping from bob" })).status).toBe(202);
    await waitFor(async () => (await botOf(bob, x.id))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    await waitFor(async () => existsSync(dump));
    const env = (JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env;
    expect(env.ANTHROPIC_API_KEY).toBe(BOB_KEY);
    expect(idp.resolveRequests.map((r) => r.sub)).not.toContain(ALICE.sub);
    expect(idp.resolveRequests.at(-1)).toEqual({ sub: BOB.sub, provider: "anthropic" });
    expect(log).not.toContain(ALICE_KEY);
    expect(log).not.toContain(BOB_KEY);
    // the thread says "your key" to bob, without the key
    const digest = await waitFor(async () => (await botOf(bob, x.id))?.messages.find((m) => m.kind === "digest" && (m as { digest?: { access?: unknown } }).digest?.access) ?? null, 15_000);
    expect((digest as unknown as { digest: { access: unknown } }).digest.access).toEqual({ via: "speaker-key", payer: "speaker", payerPrincipalId: ids.bob });
    expect(JSON.stringify(digest)).not.toContain(BOB_KEY);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${x.threadId}/messages`, dave)).status);
    expect([403, 404]).toContain((await api("GET", `/api/bots/${x.id}/grants`, dave)).status);
    expect((await api("GET", `/api/search?q=${encodeURIComponent("ping from bob")}`, dave)).text).not.toContain(x.id);
    await sleep(300);
    expect(daveStream.text()).not.toContain(x.id);
    daveStream.close();
  }, 60_000);

  it("S4-5: levels", async () => {
    const bob = await signIn(BOB);
    expect((await api("PATCH", `/api/bots/${x.id}`, bob, { name: "X2" })).status).toBe(403);
    const routine = await api("POST", "/api/routines", alice, { name: "Daily", botId: x.id, prompt: "Report.", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } });
    expect(routine.status, routine.text).toBe(201);
    const run = await api("POST", `/api/routines/${routine.body.routine.id}/run`, bob);
    // private threads: at use, alice's routine (and the thread it writes)
    // is hers alone, so bob does not even see it; run opens it to him
    expect(run.status).toBe(404);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "run" });
    // Run now (2026-10-08): alice's routine is for her (the owner), the
    // person it runs as or an admin; at run, bob runs routines of his own
    const notHis = await api("POST", `/api/routines/${routine.body.routine.id}/run`, bob);
    expect(notHis.status).toBe(403);
    expect(notHis.body.code).toBe("run_now_not_allowed");
    const his = await api("POST", "/api/routines", bob, { name: "Bob's", botId: x.id, prompt: "Report.", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } });
    expect(his.status, his.text).toBe(201);
    expect((await api("POST", `/api/routines/${his.body.routine.id}/run`, bob)).status).toBe(201);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "edit" });
    expect((await api("PATCH", `/api/bots/${x.id}`, bob, { name: "Xavier 2" })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${x.id}`, bob, { approvalMode: "full" })).status).toBe(403);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "manage" });
    expect((await api("PUT", `/api/bots/${x.id}/grants`, bob, { target: `user:${ids.dave}`, level: "use" })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, bob, { target: `user:${ids.dave}`, level: "manage" })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${x.id}`, bob)).status).toBe(403);
    // back to use for what follows; dave's grant goes
    await api("DELETE", `/api/bots/${x.id}/grants/${encodeURIComponent(`user:${ids.dave}`)}`, alice);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" });
  }, 60_000);

  it("S4-6: the manager administers her team's grants under the anchor, never opening the bot", async () => {
    const mia = await signIn(MIA);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${x.threadId}/messages`, mia)).status);
    const listed = (await api("GET", "/api/org/bots", mia)).body.bots as Array<{ id: string; grants: Array<{ target: string }> }>;
    expect(listed.find((b) => b.id === x.id)?.grants.map((g) => g.target)).toEqual([`team:${TEAM_T}`]);
    // the list carries the bot's public look and whether it works now, nothing more of it
    const shownX = listed.find((b) => b.id === x.id) as unknown as { look?: Record<string, unknown>; running?: unknown };
    expect(typeof shownX.running).toBe("boolean");
    // S4-5 ran Bob's routine on it: the bot reads running until that run ends
    await waitFor(async () => ((await api("GET", "/api/org/bots", mia)).body.bots as Array<{ id: string; running?: unknown }>).find((b) => b.id === x.id)?.running === false, 30_000);
    expect(typeof shownX.look?.color).toBe("string");
    expect(Object.keys(shownX.look ?? {}).every((key) => ["id", "name", "title", "color", "avatarUrl", "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY", "mascotBody", "mascotSkin", "mascotLook"].includes(key))).toBe(true);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `team:${TEAM_T}`, level: "run" })).status).toBe(403);
    // she never opens what she administers: no entry for herself, on a bot,
    // or a room that lists her team (sections share nothing any more)
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `user:${ids.mia}`, level: "use" })).status).toBe(403);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${x.threadId}/messages`, mia)).status);
    const tRoom = await api("POST", "/api/groups", alice, { name: "Team T room", memberIds: [x.id], humanIds: [`team:${TEAM_T}`], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(tRoom.status, tRoom.text).toBe(201);
    expect([403, 404]).toContain((await api("PATCH", `/api/groups/${tRoom.body.group.id}`, mia, { humanIds: [`team:${TEAM_T}`, ids.mia] })).status);
    const roomsOfMia = ((await api("GET", "/api/bots", mia)).body.groups as Array<{ id: string }>).map((g) => g.id);
    expect(roomsOfMia).not.toContain(tRoom.body.group.id);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `user:${ids.carol}`, level: "use" })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `user:${ids.dave}`, level: "use" })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${x.id}/grants/${encodeURIComponent(`team:${TEAM_T}`)}`, mia)).status).toBe(200);
    const carol = await signIn(CAROL);
    expect(await botIds(carol)).toContain(x.id); // through her own grant now
    const y = await createBot(alice, "Yan", "claude");
    expect((await api("PUT", `/api/bots/${y.id}/grants`, mia, { target: `team:${TEAM_T}`, level: "use" })).body.code).toBe("not_allowed");
    // restore: team T at use, carol's own grant gone
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `team:${TEAM_T}`, level: "use" });
    await api("DELETE", `/api/bots/${x.id}/grants/${encodeURIComponent(`user:${ids.carol}`)}`, alice);
  }, 60_000);

  it("S4-7: an admin administers a member's bot she cannot open", async () => {
    const erin = await signIn(ERIN);
    const z = await createBot(erin, "Zed", "claude");
    alice = await signIn(ALICE);
    expect(await botIds(alice)).not.toContain(z.id);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${z.threadId}/messages`, alice)).status);
    expect((await api("PUT", `/api/bots/${z.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    expect(((await api("GET", "/api/org/bots", alice)).body.bots as Array<{ id: string }>).map((b) => b.id)).toContain(z.id);
    // bob speaking to erin's bot: his own key (erin has none), never hers
    const bob = await signIn(BOB);
    const resolvedBefore = idp.resolveRequests.length;
    expect((await api("POST", `/api/bots/${z.id}/messages`, bob, { text: "hello erin's bot" })).status).toBe(202);
    await waitFor(async () => (await botOf(bob, z.id))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    expect((await botOf(bob, z.id))?.messages.some((m) => m.kind === "access")).toBe(false);
    // read from Perspicax (or its 60 s cache) with bob's subject only
    expect(idp.resolveRequests.slice(resolvedBefore).map((r) => r.sub).filter((sub) => sub !== BOB.sub)).toEqual([]);
    await waitFor(async () => existsSync(dump) && JSON.stringify(JSON.parse(readFileSync(dump, "utf8")).prompt).includes("hello erin's bot"));
    expect((JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env.ANTHROPIC_API_KEY).toBe(BOB_KEY);
  }, 60_000);

  it("S4-4: leaving the team through the directory, then through a refreshed id_token, narrows at once", async () => {
    let carol = await signIn(CAROL);
    expect(await botIds(carol)).toContain(x.id);
    const stream = await openStream(carol);
    // 1. the directory: carol leaves T; a sign-in by someone else refreshes it
    setDirectoryTeams([]);
    idp.setTeams(CAROL.sub, []);
    await signIn(DAVE);
    await Promise.race([stream.ended, sleep(10_000).then(() => { throw new Error(`carol's stream stayed open\n${log.slice(-2000)}`); })]);
    expect(await botIds(carol)).not.toContain(x.id);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${x.id}/messages`, carol, { text: "still?" })).status);
    // back in T
    setDirectoryTeams([CAROL.sub]);
    idp.setTeams(CAROL.sub, CAROL.teams);
    await signIn(DAVE);
    carol = await signIn(CAROL);
    await waitFor(async () => (await botIds(carol)).includes(x.id));
    // 2. the id_token: only the claim changes; her next refresh applies it
    idp.setTeams(CAROL.sub, []);
    await waitFor(async () => !(await botIds(carol)).includes(x.id), 20_000);
    idp.setTeams(CAROL.sub, CAROL.teams);
  }, 90_000);

  it("S4-9: erin's own Codex subscription answers for her only", async () => {
    const erin = await signIn(ERIN);
    const started = await api("POST", "/api/me/engines/codex/login/start", erin, {});
    expect(started.status, started.text).toBe(200);
    const flowId = started.body.auth.flowId as string;
    writeFileSync(join(home, ".omb-fake-codex-login-approved"), "yes");
    await waitFor(async () => (await api("GET", `/api/me/engines/codex/login/status?flowId=${encodeURIComponent(flowId)}`, erin)).body.auth?.phase === "succeeded", 20_000);
    const engines = (await api("GET", "/api/me/engines", erin)).body.engines as Array<{ instanceId: string; subscription: { signedIn: boolean }; myTurns: string }>;
    expect(engines.find((e) => e.instanceId === "codex")).toMatchObject({ subscription: { supported: true, signedIn: true }, myTurns: "subscription" });
    const dir = join(home, ".sagax", "principals", ids.erin!, "codex");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, ".pulsabot-login.json")).mode & 0o777).toBe(0o600);
    // another person's session cannot read erin's flow, and no engine without personal sign-in
    const bob = await signIn(BOB);
    expect((await api("GET", `/api/me/engines/codex/login/status?flowId=${encodeURIComponent(flowId)}`, bob)).status).toBe(404);
    // Codex has no organization key (login-backed): bob's turns there need his own
    expect((await api("GET", "/api/me/engines", bob)).body.engines.find((e: { instanceId: string }) => e.instanceId === "codex")).toMatchObject({ subscription: { signedIn: false }, orgKey: false, myTurns: "none" });
    // #1137: a bot on its owner's own subscription is paid by its owner by
    // default: bob writes to erin's codex bot and gets an answer on erin's
    // subscription, needing none of his own
    const w = await createBot(erin, "Wendy", "codex");
    expect((await api("PUT", `/api/bots/${w.id}/grants`, erin, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    expect((await api("GET", `/api/bots/${w.id}/runtime-settings`, erin)).body.settings.turnPayer).toBe("owner");
    expect((await api("GET", "/api/bots", bob)).body.bots.find((b: { id: string }) => b.id === w.id)).toMatchObject({ turnPayerDefault: "owner" });
    // only erin chooses who pays for her bot
    expect((await api("PATCH", `/api/bots/${w.id}/runtime-settings`, bob, { turnPayer: "speaker" })).status).toBe(403);
    expect((await api("POST", `/api/bots/${w.id}/messages`, bob, { text: "hi wendy" })).status).toBe(202);
    await waitFor(async () => (await botOf(bob, w.id))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    const ownerPaid = await waitFor(async () => (await botOf(bob, w.id))?.messages.find((m) => m.kind === "digest" && (m as { digest?: { access?: unknown } }).digest?.access) ?? null, 15_000);
    expect((ownerPaid as unknown as { digest: { access: unknown } }).digest.access).toEqual({ via: "subscription", payer: "owner", payerPrincipalId: ids.erin });
    expect((await botOf(bob, w.id))?.messages.some((m) => m.kind === "access")).toBe(false);
    // isolation: bob's conversation stays his; erin paying gives her no read of it
    expect(JSON.stringify((await botOf(erin, w.id))?.messages ?? [])).not.toContain("hi wendy");
    // erin chooses that each person pays: bob's next message is his to pay.
    // He cannot pay for Codex, so (#1154) the bot answers him on the model
    // of the same tier on an engine he can pay for (Claude, his own key),
    // and the reply names the pick it left. No card: one is shown only when
    // nothing he can pay for runs (server/turns/turn-model-routing.test.ts).
    expect((await api("PATCH", `/api/bots/${w.id}/runtime-settings`, erin, { turnPayer: "speaker" })).status).toBe(200);
    const textReplies = async () => ((await botOf(bob, w.id))?.messages ?? []).filter((m) => m.role === "bot" && m.kind === "text" && m.text);
    const firstReplies = (await textReplies()).length;
    rmSync(dump, { force: true });
    expect((await api("POST", `/api/bots/${w.id}/messages`, bob, { text: "hi again wendy" })).status).toBe(202);
    await waitFor(async () => (await textReplies()).length > firstReplies, 30_000);
    const moved = (await textReplies()).at(-1) as unknown as { turnRun?: { instanceId: string; requested?: { instanceId: string; model: string } } };
    expect(moved.turnRun).toMatchObject({ instanceId: "claude", requested: { instanceId: "codex" } });
    await waitFor(async () => existsSync(dump));
    expect((JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env.ANTHROPIC_API_KEY).toBe(BOB_KEY);
    expect((await botOf(bob, w.id))?.messages.some((m) => m.kind === "access")).toBe(false);
    // with a default model of his own (his first starred one: Claude, on his
    // own key), the bot answers bob on that one first
    const starred = await api("PATCH", "/api/me/preferences", bob, { set: { "sagax.modelFavorites.v1": JSON.stringify([["claude", "fake-model"]]) } });
    expect(starred.status, starred.text).toBe(200);
    const accessCards = async () => ((await botOf(bob, w.id))?.messages ?? []).filter((m) => m.kind === "access").length;
    const repliesBefore = (await textReplies()).length;
    const cardsBefore = await accessCards();
    rmSync(dump, { force: true });
    expect((await api("POST", `/api/bots/${w.id}/messages`, bob, { text: "third time wendy" })).status).toBe(202);
    await waitFor(async () => (await textReplies()).length > repliesBefore, 30_000);
    expect(((await textReplies()).at(-1) as unknown as { turnRun?: unknown }).turnRun).toMatchObject({ instanceId: "claude", model: "fake-model", requested: { instanceId: "codex" } });
    await waitFor(async () => existsSync(dump));
    expect((JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env.ANTHROPIC_API_KEY).toBe(BOB_KEY);
    expect(await accessCards()).toBe(cardsBefore);
    // #1154 in a group: bob's turn there runs on a model he pays for too,
    // and the reply names the bot's model it left
    const room = await api("POST", "/api/groups", erin, { name: "Wendy room", memberIds: [w.id], humanIds: [ids.bob], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    const roomThread = room.body.group.threadId as string;
    rmSync(dump, { force: true });
    const posted = await api("POST", `/api/groups/${room.body.group.id}/messages`, bob, { text: "hi room", threadId: roomThread });
    expect(posted.status, posted.text).toBeLessThan(300);
    const roomReply = await waitFor(async () => {
      const read = await api("GET", `/api/threads/${roomThread}/messages`, bob);
      return ((read.body.messages ?? []) as Array<{ role: string; kind: string; text?: string; turnRun?: unknown }>).find((m) => m.role === "bot" && m.kind === "text" && m.text) ?? null;
    }, 30_000);
    expect(roomReply.turnRun).toMatchObject({ instanceId: "claude", model: "fake-model", requested: { instanceId: "codex", model: "fake-model" } });
    await waitFor(async () => existsSync(dump));
    expect((JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env.ANTHROPIC_API_KEY).toBe(BOB_KEY);
    expect(log).not.toContain(BOB_KEY);
    expect((await api("POST", "/api/me/engines/codex/login/sign-out", erin, {})).status).toBe(200);
    expect(existsSync(join(dir, ".pulsabot-login.json"))).toBe(false);
  }, 60_000);

  it("S4-10 and S4-11: sections are personal (no members, no placement), and a room with a team", async () => {
    const v = await createBot(alice, "Vera", "claude");
    const created = await api("POST", "/api/org/sections", alice, { name: "Ventes" });
    expect(created.status, created.text).toBe(201);
    const id = created.body.section.id as string;
    const dave = await signIn(DAVE);
    const carol = await signIn(CAROL);
    const groups = async (auth: Auth) => ((await api("GET", "/api/bots", auth)).body.groups as Array<{ id: string }>).map((g) => g.id);
    const placed = await api("PUT", `/api/org/sections/${id}/bots`, alice, { add: [v.id] });
    expect(placed.status, placed.text).toBe(410);
    const shared = await api("PUT", `/api/org/sections/${id}/members`, alice, { members: [{ target: `team:${TEAM_U}`, role: "participant" }], defaultLevel: "use" });
    expect(shared.status, shared.text).toBe(410);
    expect(shared.body.code).toBe("sections_are_personal");
    expect(await botIds(dave)).not.toContain(v.id);
    // even filed under a section name, a bot reaches a team only by its own grant
    expect((await api("POST", "/api/sidebar-sections", alice, { name: "Ventes", botIds: [v.id] })).status).toBe(200);
    expect(await botIds(dave)).not.toContain(v.id);
    await waitFor(async () => (await api("DELETE", `/api/org/sections/${id}`, alice)).status === 200, 30_000);

    // a room listing team U: dave sees and posts, carol does not see it
    const u = await createBot(alice, "Ursula", "claude");
    const room = await api("POST", "/api/groups", alice, { name: "Team U room", memberIds: [u.id], humanIds: [`team:${TEAM_U}`], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    expect(await groups(dave)).toContain(room.body.group.id);
    expect(await groups(carol)).not.toContain(room.body.group.id);
    expect((await api("POST", "/api/groups", alice, { name: "Bad", memberIds: [u.id], humanIds: ["team:NOPE"] })).status).toBe(400);
  }, 60_000);

  it("S4-12: a bot filed in someone's section never opens to anyone else", async () => {
    alice = await signIn(ALICE);
    const bob = await signIn(BOB);
    const a1 = await createBot(alice, "Ada", "claude");
    const bx = await createBot(bob, "Bex", "claude");
    expect((await api("POST", "/api/sidebar-sections", alice, { name: "Ops", botIds: [a1.id] })).status).toBe(200);
    const dave = await signIn(DAVE);
    const created = await api("POST", "/api/org/sections", dave, { name: "Dave sec" });
    expect(created.status, created.text).toBe(201);
    expect((await api("PUT", `/api/org/sections/${created.body.section.id}/members`, dave, { members: [{ target: `user:${ids.erin}`, role: "participant" }] })).status).toBe(410);
    const listed = (await api("GET", "/api/bots", dave)).body as { bots: Array<{ id: string }> };
    expect(listed.bots.map((b) => b.id)).not.toContain(a1.id);
    expect(listed.bots.map((b) => b.id)).not.toContain(bx.id);
    expect((await api("GET", `/api/threads/${a1.threadId}/messages`, dave)).status).toBe(404);
    expect((await api("GET", `/api/threads/${a1.threadId}/messages`, bob)).status).toBe(404);
  }, 60_000);
});
