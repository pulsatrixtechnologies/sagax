// A room a Primary Bot opens with create_room on an organization server lists
// its owner (humanIds): it shows in that person's room list and stays out of
// everyone else's. Also the "dream-team" event: group.mixed earns its person
// only when they send into a room with two people and two bots.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const ORG_KEY = "sk-ant-test-org-key-000000";
const CAPABILITY_KEY = "org-bot-room-capability";
const ALICE: FakeOidcUser = { sub: "01J9S6ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9S6BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const DAVE: FakeOidcUser = { sub: "01J9S6DAVE00000000000000D", name: "Dave", preferred_username: "dave", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}), ...headers },
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
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
      SAGAX_ORG_NAME: "Acme",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

posixOnly("Organization: a room a Primary Bot creates", () => {
  let alice: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, DAVE].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-bot-room-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: {}, config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  const roomIds = async (auth: Auth) => ((await api("GET", "/api/bots", auth)).body.groups as Array<{ id: string }> ?? []).map((g) => g.id);

  it("lists the owner of the Primary Bot in the room; nobody else sees it", async () => {
    const make = async (name: string) => {
      const created = await api("POST", "/api/bots", alice, { name });
      expect(created.status, created.text).toBe(201);
      return created.body.bot as { id: string; threadId: string };
    };
    const chief = await make("Pickle");
    const research = await make("Crab Research");
    const writing = await make("Crab Writing");
    expect((await api("PATCH", `/api/bots/${chief.id}`, alice, { chiefOfStaff: true, peers: [research.id, writing.id] })).status).toBe(200);
    const minted = await api("POST", "/api/testing/internal-capability", undefined, { botId: chief.id, threadId: chief.threadId, kind: "agents" }, { "x-openmausbot-test-capability": CAPABILITY_KEY });
    expect(minted.status, minted.text).toBe(201);
    const created = await api("POST", "/api/internal/create-room", undefined, { name: "Crab Room", memberIds: [research.id, writing.id], bulletin: "Work together." }, { authorization: `Bearer ${minted.body.token}` });
    expect(created.status, created.text).toBe(201);
    const roomId = created.body.id as string;
    expect(await roomIds(alice)).toContain(roomId);
    const bob = await signIn(BOB);
    const dave = await signIn(DAVE);
    expect(await roomIds(bob)).not.toContain(roomId);
    expect(await roomIds(dave)).not.toContain(roomId);
    expect((await api("GET", `/api/groups/${roomId}`, bob)).status).toBeGreaterThanOrEqual(403);
    // a second person opens it only when its people list names them
    expect((await api("PATCH", `/api/groups/${roomId}`, alice, { humanIds: [ids.alice, ids.bob] })).status).toBe(200);
    expect(await roomIds(bob)).toContain(roomId);
    expect(await roomIds(dave)).not.toContain(roomId);
  }, 60_000);
});
