// #4460: team memory never crosses people on an organization server.
//
// Through the real server, the fake provider and the fake Claude CLI: two
// people who share no team of the organization each have their own bots.
// What one person's bot proposes and that person confirms reaches that
// person's bots only: never the other person's bot prompt (preview and a real
// turn), never their team memory listing, never their approvals. That holds
// for bots in no section (the shared "General" key was the leak) and for two
// sections of the same name. Entries a shared team memory already held move,
// at the next start, to their author's own memory, each one listed for its
// author with where it came from; one whose author is unknown is listed for
// the organization's admins, read by nobody's bot.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const CAPABILITY_KEY = "team-memory-people-capability";
const TEAM_FIELD = "01J9TPTEAMAAAA00000000000A";
const TEAM_OFFICE = "01J9TPTEAMBBBB00000000000B";
const ALICE: FakeOidcUser = { sub: "01J9TPALICE000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin", teams: [{ id: TEAM_FIELD, name: "Field", manager: true }] };
const BOB: FakeOidcUser = { sub: "01J9TPBOB0000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee", teams: [{ id: TEAM_OFFICE, name: "Office", manager: false }] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dumpFile = "";
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

async function start() {
  log = "";
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
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key",
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

async function stop() {
  child.kill("SIGTERM");
  await waitForExit(child);
}

/** The bot's shell proposes a team-memory entry from this thread. */
async function proposeTeamMemory(botId: string, threadId: string, name: string, detail: string): Promise<string> {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId, threadId, kind: "agents" }),
  });
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const proposed = await fetch(`${BASE}/api/internal/team-memory`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromBotId: botId, fromThreadId: threadId, kind: "term", name, detail }),
  });
  const body = await proposed.json() as { status: string; requestId: string };
  expect(proposed.status, JSON.stringify(body)).toBe(201);
  return body.requestId;
}

posixOnly("#4460 team memory stays with its person on an organization server", () => {
  let alice: Auth;
  let bob: Auth;
  const ids: Record<string, string> = {};

  const makeBot = async (auth: Auth, name: string, section?: string) => {
    const created = await api("POST", "/api/bots", auth, { name });
    expect(created.status, created.text).toBe(201);
    const id = created.body.bot.id as string;
    const patched = await api("PATCH", `/api/bots/${id}`, auth, { modelSelection: { instanceId: "claude", model: "fake-model" }, ...(section ? { section } : {}) });
    expect(patched.status, patched.text).toBe(200);
    const threadId = await waitFor(async () => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; threadId: string }> | undefined)?.find((bot) => bot.id === id)?.threadId);
    return { id, threadId };
  };
  const promptOf = async (auth: Auth, botId: string) => {
    const preview = await api("GET", `/api/bots/${botId}/system-prompt`, auth);
    expect(preview.status, preview.text).toBe(200);
    return (preview.body.sections as Array<{ id: string; text: string }>).find((section) => section.id === "team-memory")?.text ?? "";
  };
  const confirm = async (auth: Auth, threadId: string, requestId: string) => {
    const answered = await api("POST", `/api/threads/${threadId}/respond`, auth, { requestId, behavior: "allow" });
    expect(answered.status, answered.text).toBe(200);
  };
  /** The system prompt of the turn that received this text (every turn's
   * record is appended; another bot's turn never stands in for it). */
  const turnPromptFor = (text: string) => waitFor(async () => {
    if (!existsSync(dumpFile)) return null;
    const records = readFileSync(dumpFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { prompt?: unknown; systemPrompt?: string });
    return records.find((record) => JSON.stringify(record.prompt ?? "").includes(text)) ?? null;
  });
  const listed = async (auth: Auth, section = "") => (await api("GET", `/api/team-memory?section=${encodeURIComponent(section)}`, auth)).body.entries as Array<{ name: string; movedFrom?: string }> ?? [];

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    idp.directoryTeams = [
      { id: TEAM_FIELD, name: "Field", managers: [ALICE.sub], members: [] },
      { id: TEAM_OFFICE, name: "Office", managers: [], members: [BOB.sub] },
    ];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-team-memory-people-"));
    dumpFile = join(home, "turn-dumps.jsonl");
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: { claude: { driver: "claudeAgent", access: "api", config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true }, environment: { FAKE_CLAUDE_DUMP_LOG: dumpFile } } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 2 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
  }, 60_000);

  afterAll(async () => {
    if (child) await stop();
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("keeps what one person confirmed from the other person's ungrouped bot: prompt, turn, listing, approvals", async () => {
    const aliceBot = await makeBot(alice, "Alice helper");
    const bobBot = await makeBot(bob, "Bob helper");
    const requestId = await proposeTeamMemory(bobBot.id, bobBot.threadId, "Zephyr", "Zephyr is the name of Bob's scheduling bot");
    // the other person never gets the card, an admin neither
    expect(JSON.stringify((await api("GET", "/api/approvals", alice)).body)).not.toContain(requestId);
    // the card tells its person the truth: their own memory, not a team's
    const bobCard = JSON.stringify((await api("GET", "/api/approvals", bob)).body);
    expect(bobCard).toContain(requestId);
    expect(bobCard).toContain("Remember this in the bot owner's own memory?");
    expect(bobCard).not.toContain("for the team");
    await confirm(bob, bobBot.threadId, requestId);

    // Bob's own bot reads it, and the block says whose memory it is
    const bobPrompt = await promptOf(bob, bobBot.id);
    expect(bobPrompt).toContain("Zephyr");
    expect(bobPrompt).toContain("Your own memory, \"Bob\"'s");
    expect(bobPrompt).toContain("\"Office\"");
    // and the instruction after it says the same, never "shared prompts"
    expect(bobPrompt).toContain("only that person's bots read it");
    expect(bobPrompt).not.toContain("shared prompts");
    // Alice's bot does not, in its prompt nor in a real turn
    expect(await promptOf(alice, aliceBot.id)).not.toContain("Zephyr");
    const sent = await api("POST", `/api/bots/${aliceBot.id}/messages`, alice, { text: "Who is Zephyr?", threadId: aliceBot.threadId });
    expect(sent.status, sent.text).toBeLessThan(300);
    const turn = await turnPromptFor("Who is Zephyr?");
    expect((turn.systemPrompt ?? "").length).toBeGreaterThan(100);
    expect(turn.systemPrompt ?? "").not.toContain("Zephyr");
    // nor in Alice's team memory listing, General or any section name
    expect((await api("GET", "/api/team-memory?section=", alice)).status).toBe(200);
    expect(JSON.stringify(await listed(alice))).not.toContain("Zephyr");
    expect(JSON.stringify(await listed(alice, "Ops"))).not.toContain("Zephyr");
    // a member lists and manages their own memory, no admin
    expect((await api("GET", "/api/team-memory?section=", bob)).status).toBe(200);
    expect(JSON.stringify(await listed(bob))).toContain("Zephyr");
  }, 90_000);

  it("keeps two sections of the same name apart", async () => {
    const aliceOps = await makeBot(alice, "Alice ops", "Ops");
    const bobOps = await makeBot(bob, "Bob ops", "Ops");
    const requestId = await proposeTeamMemory(aliceOps.id, aliceOps.threadId, "Nimbus", "Nimbus is the board Alice dispatches from");
    expect(JSON.stringify((await api("GET", "/api/approvals", bob)).body)).not.toContain(requestId);
    // Bob cannot confirm it either
    expect((await api("POST", `/api/threads/${aliceOps.threadId}/respond`, bob, { requestId, behavior: "allow" })).status).toBeOneOf([403, 404]);
    await confirm(alice, aliceOps.threadId, requestId);
    expect(await promptOf(alice, aliceOps.id)).toContain("Nimbus");
    expect(await promptOf(bob, bobOps.id)).not.toContain("Nimbus");
    // a real turn reads the same memory as the preview
    const sent = await api("POST", `/api/bots/${bobOps.id}/messages`, bob, { text: "Where is Nimbus?", threadId: bobOps.threadId });
    expect(sent.status, sent.text).toBeLessThan(300);
    const turn = await turnPromptFor("Where is Nimbus?");
    expect((turn.systemPrompt ?? "").length).toBeGreaterThan(100);
    expect(turn.systemPrompt ?? "").not.toContain("Nimbus");
    expect(JSON.stringify(await listed(bob, "Ops"))).not.toContain("Nimbus");
    // the memory page lists each person's own memory only, an admin included
    const sources = async (auth: Auth) => JSON.stringify((await api("GET", "/api/memory-manager/sources", auth)).body);
    expect(await sources(bob)).not.toContain("Nimbus");
  }, 90_000);

  // last: it restarts the server
  it("moves entries a shared team memory held to their author's own memory, listed for each, and keeps an unknown author's aside", async () => {
    const aliceBot = await makeBot(alice, "Alice legacy");
    const bobBot = await makeBot(bob, "Bob legacy", "Ops");
    await stop();
    const file = join(home, ".sagax", "team-memory.json");
    const at = Date.now() - 14 * 86_400_000;
    const entry = (id: string, name: string, botId: string) => ({
      id, kind: "term", name, detail: `${name} detail`, aliases: [], status: "accepted",
      source: { botId, botName: "legacy", threadId: "", at }, updatedAt: at,
    });
    writeFileSync(file, JSON.stringify({ version: 1, sections: {
      "": [entry("legacy-alice", "Corvid", aliceBot.id), entry("legacy-nobody", "Orphan", "")],
      Ops: [entry("legacy-bob", "Pelican", bobBot.id)],
    } }));
    await start();
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
    expect(log).toMatch(/team memory: 2 shared entries moved to 2 author\(s\)' own memory; 1 without a known author listed for the admins/);

    const alicePrompt = await promptOf(alice, aliceBot.id);
    expect(alicePrompt).toContain("Corvid");
    expect(alicePrompt).not.toContain("Pelican");
    expect(alicePrompt).not.toContain("Orphan");
    const bobPrompt = await promptOf(bob, bobBot.id);
    expect(bobPrompt).toContain("Pelican");
    expect(bobPrompt).not.toContain("Corvid");
    expect(bobPrompt).not.toContain("Orphan");
    // listed for each author, with where it came from; nothing deleted
    expect((await listed(alice)).find((row) => row.name === "Corvid")?.movedFrom).toBe("General");
    const bobs = await listed(bob);
    expect(bobs.find((row) => row.name === "Pelican")?.movedFrom, JSON.stringify(bobs)).toBe("Ops");
    expect(alicePrompt).toContain("[moved from the former shared \"General\" memory]");
    // the entry with no known author was the whole server's: an org admin's
    // memory page lists it, never a member's, never a bot's prompt
    const adminSources = (await api("GET", "/api/memory-manager/sources", alice)).body.sources as Array<{ section?: string; owner?: string }>;
    const unclaimed = adminSources.find((source) => source.owner === "unclaimed");
    expect(unclaimed, JSON.stringify(adminSources)).toBeTruthy();
    expect(JSON.stringify(await listed(alice, unclaimed!.section))).toContain("Orphan");
    expect(JSON.stringify((await api("GET", "/api/memory-manager/sources", bob)).body)).not.toContain("unclaimed");
    expect(JSON.stringify(await listed(bob, unclaimed!.section))).not.toContain("Orphan");
    const stored = readFileSync(file, "utf8");
    for (const name of ["Corvid", "Pelican", "Orphan"]) expect(stored).toContain(name);
  }, 90_000);
});
