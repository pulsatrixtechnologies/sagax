// Per-bot team memory sharing on a Perspicax organization server, through
// the real server, the fake provider (server/testing/fake-oidc-provider.ts)
// and the fake Claude CLI. Each 1:1 thread with a bot is its person's own,
// so a team-memory card proposed in one person's thread lists for them and
// never for another member of the section, "shared" or "private". A room's
// card lists for the room's people, as the conversation and the live stream
// deliver it, and never for a member outside the room. The team-memory page
// settling an entry closes that card for all of them. A stored value the
// API never writes reads as private and never breaks export, import or a
// console clone.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const CAPABILITY_KEY = "team-memory-sharing-org-capability";
const ALICE: FakeOidcUser = { sub: "01J9TMALICE000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9TMBOB0000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9TMCAROL00000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; bearer?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
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
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

/** The bot's shell proposes a team-memory entry from this thread. */
async function proposeTeamMemory(botId: string, threadId: string, name: string): Promise<string> {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId, threadId, kind: "agents" }),
  });
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const proposed = await fetch(`${BASE}/api/internal/team-memory`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromBotId: botId, fromThreadId: threadId, kind: "term", name, detail: `${name} means the dispatch board` }),
  });
  const body = await proposed.json() as { status: string; requestId: string };
  expect(proposed.status, JSON.stringify(body)).toBe(201);
  return body.requestId;
}

/** A person's live event stream, parsed frame by frame. */
function openStream(auth: Auth) {
  const controller = new AbortController();
  const frames: any[] = [];
  const state: { hello: any } = { hello: null };
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: { cookie: auth.cookie! }, signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const frame = JSON.parse(line.slice(6));
            if (frame.kind === "hello") state.hello = frame;
            else if (frame.kind !== "ping") frames.push(frame);
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, ready: () => waitFor(async () => state.hello, 10_000), close: () => controller.abort() };
}

posixOnly("Perspicax organization: per-bot team memory sharing", () => {
  let alice: Auth;
  let bob: Auth;
  let carol: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-team-memory-sharing-org-"));
    const data = join(home, ".sagax");
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
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    carol = await signIn(CAROL);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("lists a card in its person's own thread only, shared or private", async () => {
    const makeBot = async (name: string, member: string) => {
      const created = await api("POST", "/api/bots", alice, { name });
      expect(created.status, created.text).toBe(201);
      const id = created.body.bot.id as string;
      const patched = await api("PATCH", `/api/bots/${id}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" }, section: "Ops" });
      expect(patched.status, patched.text).toBe(200);
      const shared = await api("PUT", `/api/bots/${id}/grants`, alice, { target: `user:${ids[member]}`, level: "use" });
      expect(shared.status, shared.text).toBe(200);
      return id;
    };
    const botId = await makeBot("Ops one", "bob");
    await makeBot("Ops two", "carol");
    // Bob's own thread on the bot
    const bobThread = await waitFor(async () => ((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; threadId: string }> | undefined)
      ?.find((bot) => bot.id === botId)?.threadId);
    const inbox = async (auth: Auth, requestId: string) => ((await api("GET", "/api/approvals", auth)).body.pending ?? [])
      .filter((item: any) => item.requestId === requestId);

    for (const sharing of ["shared", "private"] as const) {
      expect((await api("PATCH", `/api/bots/${botId}`, alice, { teamMemorySharing: sharing })).status).toBe(200);
      const requestId = await proposeTeamMemory(botId, bobThread, `Ops board ${sharing}`);
      // the person whose thread it is gets it, answerable
      const bobs = await waitFor(async () => { const rows = await inbox(bob, requestId); return rows.length ? rows : null; }, 10_000);
      expect(bobs[0], sharing).toMatchObject({ threadId: bobThread, decidable: true });
      // another member of the section, without this bot: nothing, whatever the setting
      const carols = await api("GET", "/api/approvals", carol);
      expect(carols.status).toBe(200);
      expect(JSON.stringify(carols.body), sharing).not.toContain(requestId);
      expect(JSON.stringify(carols.body), sharing).not.toContain(`Ops board ${sharing}`);
      expect((await api("POST", `/api/threads/${bobThread}/respond`, carol, { requestId, behavior: "allow" })).status, sharing).toBeOneOf([403, 404]);
      expect((await api("POST", `/api/threads/${bobThread}/respond`, bob, { requestId, behavior: "deny" })).status, sharing).toBe(200);
    }
  }, 90_000);

  it("lists a room's card for the room's people, as the conversation and the stream do, and the page closes it for them", async () => {
    const created = await api("POST", "/api/bots", alice, { name: "Ops room bot" });
    expect(created.status, created.text).toBe(201);
    const botId = created.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" }, section: "Rooms" })).status).toBe(200);
    for (const login of ["bob", "carol"]) {
      expect((await api("PUT", `/api/bots/${botId}/grants`, alice, { target: `user:${ids[login]}`, level: "use" })).status).toBe(200);
    }
    const room = await api("POST", "/api/groups", alice, { name: "Alice and Bob", memberIds: [botId], humanIds: [ids.alice, ids.bob], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    const threadId = room.body.group.threadId as string;
    const inbox = async (auth: Auth, requestId: string) => ((await api("GET", "/api/approvals", auth)).body.pending ?? [])
      .filter((item: any) => item.requestId === requestId);
    const streams = { bob: openStream(bob), carol: openStream(carol) };
    try {
      await Promise.all(Object.values(streams).map((stream) => stream.ready()));
      for (const sharing of ["shared", "private"] as const) {
        expect((await api("PATCH", `/api/bots/${botId}`, alice, { teamMemorySharing: sharing })).status).toBe(200);
        const name = `Room board ${sharing}`;
        const requestId = await proposeTeamMemory(botId, threadId, name);
        // Bob, in the room: the notification, the card in the conversation, and now the inbox row
        expect(await waitFor(async () => streams.bob.frames.find((frame) => frame.kind === "notify" && frame.notification?.requestId === requestId) ?? null, 5_000), sharing).not.toBeNull();
        const card = ((await api("GET", `/api/threads/${threadId}/messages`, bob)).body.messages ?? []).find((m: any) => m.card?.requestId === requestId);
        expect(card?.card?.answered, sharing).toBeUndefined();
        const rows = await waitFor(async () => { const found = await inbox(bob, requestId); return found.length ? found : null; }, 10_000);
        expect(rows[0], sharing).toMatchObject({ threadId, roomName: "Alice and Bob", decidable: true });
        expect(rows[0].message?.card?.requestId, sharing).toBe(requestId);
        // Carol, of the section but outside the room: nothing
        const carols = await api("GET", "/api/approvals", carol);
        expect(JSON.stringify(carols.body), sharing).not.toContain(requestId);
        expect(JSON.stringify(carols.body), sharing).not.toContain("Alice and Bob");
        expect(streams.carol.frames.some((frame) => JSON.stringify(frame).includes(requestId)), sharing).toBe(false);
        // Alice accepts on the team-memory page: Bob's card and row close, live
        expect((await api("PATCH", `/api/team-memory/${requestId}?section=Rooms`, alice, { accept: true })).status, sharing).toBe(200);
        expect(await waitFor(async () => streams.bob.frames.find((frame) => frame.kind === "message.patch" && frame.message?.card?.requestId === requestId && frame.message.card.answered === "allow") ?? null, 5_000), sharing).not.toBeNull();
        expect(await inbox(bob, requestId), sharing).toHaveLength(0);
        const late = await api("POST", `/api/threads/${threadId}/respond`, bob, { requestId, behavior: "deny" });
        expect(late.status, `${sharing}: ${late.text}`).toBe(409);
        expect(late.body, sharing).toMatchObject({ code: "team_memory_settled", outcome: "allowed-once", settledBy: "Alice" });
        expect(streams.carol.frames.some((frame) => JSON.stringify(frame).includes(requestId)), sharing).toBe(false);
      }
    } finally {
      for (const stream of Object.values(streams)) stream.close();
    }
  }, 90_000);

  // last: it restarts the server
  it("reads a stored value the API never writes as private, and exports, imports and clones that bot", async () => {
    const created = await api("POST", "/api/bots", alice, { name: "Corrupt sharing" });
    expect(created.status, created.text).toBe(201);
    const botId = created.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" }, section: "Ops" })).status).toBe(200);
    // a hand edit of the record, while the server is down
    child.kill("SIGTERM");
    await waitForExit(child);
    const file = join(home, ".sagax", "bots.json");
    const records = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
    const record = records.find((bot) => bot.id === botId)!;
    expect(record).toBeDefined();
    record.teamMemorySharing = "everyone";
    writeFileSync(file, JSON.stringify(records));
    await start();
    alice = await signIn(ALICE);
    const sharingOf = async (id: string) => ((await api("GET", "/api/bots?messages=0", alice)).body.bots as any[]).find((bot) => bot.id === id)?.teamMemorySharing;
    expect(await sharingOf(botId)).toBe("everyone");

    // export, then import: the copy is private
    const exportImport = async (id: string) => {
      const exported = await fetch(`${BASE}/api/bots/${id}/export.zip`, { headers: { cookie: alice.cookie! } });
      expect(exported.status).toBe(200);
      const zip = Buffer.from(await exported.arrayBuffer());
      const upload = await fetch(`${BASE}/api/bots/import/upload`, { method: "POST", headers: { cookie: alice.cookie!, "content-type": "application/zip" }, body: zip });
      const staged = await upload.json() as { id: string };
      expect(upload.status, JSON.stringify(staged)).toBe(200);
      const imported = await api("POST", `/api/bots/import/${staged.id}`, alice, {});
      expect(imported.status, imported.text).toBe(201);
      return imported.body.botId as string;
    };
    const copy = await exportImport(botId);
    expect(await sharingOf(copy)).toBe("private");
    // a duplicate of that copy, the same way
    expect(await sharingOf(await exportImport(copy))).toBe("private");

    // the console's clone
    const consoleAuth: Auth = { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin", teams: [] }) };
    const cloned = await api("POST", `/api/org/admin/bots/${botId}/clone`, consoleAuth, {});
    expect(cloned.status, cloned.text).toBe(201);
    expect(await sharingOf(cloned.body.bot.id)).toBe("private");
  }, 90_000);
});
