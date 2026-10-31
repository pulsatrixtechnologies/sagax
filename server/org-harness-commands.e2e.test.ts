// Engine slash commands on an organization server through the real server,
// the fake provider and the fake Claude CLI (server/harness-commands.ts,
// AGENTS.md "Engine slash commands in the chat"):
//
//   speaker   the list is the SPEAKER's: alice and bob, each on their own
//             Claude subscription, get their own login directory's commands
//             (CLAUDE_CONFIG_DIR), each cached apart; carol on the
//             organization key and erin on her own key share the server's
//   group     ?groupId= lists a member's commands for the person asking:
//             their own list, a read-only section member is refused, a
//             person outside the room gets 404
//   send      a typed command reaches only the bot it names, verbatim, in a
//             1:1 and in a group
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { splitLaunchNote } from "./testing/launch-note.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-cmds-00";
const ERIN_KEY = "sk-ant-test-erin-key-cmds-0";
const TEAM_U = "01J9SCTEAMU0000000000000UU";
const ALICE: FakeOidcUser = { sub: "01J9SCALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9SCBOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const CAROL: FakeOidcUser = { sub: "01J9SCCAROL0000000000000C", name: "Carol", preferred_username: "carol", role: "employee", teams: [] };
const DAVE: FakeOidcUser = { sub: "01J9SCDAVE00000000000000D", name: "Dave", preferred_username: "dave", role: "employee", teams: [{ id: TEAM_U, name: "U", manager: false }] };
const ERIN: FakeOidcUser = { sub: "01J9SCERIN00000000000000E", name: "Erin", preferred_username: "erin", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let probes = "";
let prompts = "";
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
const jsonl = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
/** The CLAUDE_CONFIG_DIR of every command listing the engine ran. */
const probeDirs = (): Array<string | null> => jsonl(probes).map((probe) => probe.env?.CLAUDE_CONFIG_DIR ?? null);
/** The text of every turn the engine received. */
const turnTexts = (): string[] => jsonl(prompts).map((prompt) => {
  const content = splitLaunchNote(prompt).prompt?.message?.content;
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => part.text ?? "").join("") : "";
});

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

async function createBot(auth: Auth, name: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, auth, { modelSelection: { instanceId: "claude", model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  // #1137: each person pays here, so each one's own subscription lists the
  // commands (on the owner's own subscription the owner would pay by default)
  const payer = await api("PATCH", `/api/bots/${created.body.bot.id}/runtime-settings`, auth, { turnPayer: "speaker" });
  expect(payer.status, payer.text).toBe(200);
  return { id: created.body.bot.id, threadId: created.body.bot.threadId };
}

/** A person's own Claude subscription, signed in, with their own commands. */
function subscribe(principalId: string, commands: string[]): string {
  const dir = join(home, ".sagax", "principals", principalId, "claude");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
  writeFileSync(join(dir, "fake-commands.json"), JSON.stringify(commands.map((name) => ({ name, description: `${name} skill`, argumentHint: "" }))));
  return dir;
}

const names = (answer: { body: { commands?: Array<{ name: string }> } }) => (answer.body.commands ?? []).map((command) => command.name);

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

posixOnly("Perspicax organization: engine slash commands per speaker", () => {
  const ids: Record<string, string> = {};
  const people: Record<string, Auth> = {};
  const dirs: Record<string, string> = {};
  let x: { id: string; threadId: string };
  let y: { id: string; threadId: string };
  let room: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, ERIN].map((user) => idp.personOf(user));
    idp.directoryTeams = [{ id: TEAM_U, name: "U", managers: [], members: [DAVE.sub] }];
    idp.providerKeys.set(`${ERIN.sub}/anthropic`, ERIN_KEY);
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-commands-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    probes = join(home, "probes.jsonl");
    prompts = join(home, "prompts.jsonl");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: {
          FAKE_CLAUDE_COMMANDS_LOG: probes, FAKE_CLAUDE_PROMPTS: prompts,
          FAKE_CLAUDE_DUMP: join(home, "discovery-prompt.json"),
          FAKE_CLAUDE_MCP_DUMP: join(home, "discovery-tools.json"),
          FAKE_CLAUDE_MCP_TEXT_LIMIT: "4000",
          FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
            { server: "agents", tool: "skills_list", arguments: {}, when: "discovery fixture" },
            { server: "agents", tool: "workspace_read", arguments: { path: "capability-skills/me/skills/packing-list/SKILL.md" }, when: "discovery fixture" },
          ]),
        }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
    people.alice = await signIn(ALICE);
    const listed = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", people.alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 5 ? got : null;
    });
    for (const person of listed) ids[person.login] = person.principalId;
    dirs.alice = subscribe(ids.alice!, ["alice-notes"]);
    dirs.bob = subscribe(ids.bob!, ["bob-notes"]);
    for (const [login, user] of [["alice", ALICE], ["bob", BOB], ["carol", CAROL], ["dave", DAVE], ["erin", ERIN]] as const) people[login] = await signIn(user);
    for (const login of ["alice", "bob"]) {
      await waitFor(async () => (await api("GET", "/api/me/engines", people[login])).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myTurns === "subscription");
    }
    await waitFor(async () => (await api("GET", "/api/me/engines", people.erin)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.myKey === true);
    x = await createBot(people.alice!, "Xavier");
    y = await createBot(people.alice!, "Yara");
    for (const bot of [x, y]) {
      for (const login of ["bob", "carol", "erin"]) {
        const granted = await api("PUT", `/api/bots/${bot.id}/grants`, people.alice, { target: `user:${ids[login]}`, level: "use" });
        expect(granted.status, granted.text).toBe(200);
      }
    }
    const created = await api("POST", "/api/groups", people.alice, {
      name: "Ops room", memberIds: [x.id, y.id], humanIds: [ids.alice, ids.bob, ids.carol, ids.erin],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(created.status, created.text).toBe(201);
    room = { id: created.body.group.id, threadId: created.body.group.threadId };
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("uses the room speaker's Me skills in the prompt, discovery and actual tool read", async () => {
    const skill = (description: string, instructions: string) => `---\nname: packing-list\ndescription: ${description}\n---\n${instructions}\n`;
    const aliceSkill = await api("POST", "/api/me/skills-library", people.alice, { text: skill("Alice packing", "ALICE_ONLY_INSTRUCTIONS") });
    expect(aliceSkill.status, aliceSkill.text).toBe(201);
    const bobSkill = await api("POST", "/api/me/skills-library", people.bob, { text: skill("Bob packing", "BOB_ONLY_INSTRUCTIONS") });
    expect(bobSkill.status, bobSkill.text).toBe(201);
    const replies = async () => ((await api("GET", `/api/threads/${room.threadId}/messages`, people.bob)).body.messages as Array<{ role: string; kind: string }>).filter((message) => message.role === "bot" && message.kind === "text");
    const before = (await replies()).length;
    const sent = await api("POST", `/api/groups/${room.id}/messages`, people.bob, { text: "@Yara discovery fixture" });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => (await replies()).length > before, 30_000);
    const prompt = JSON.parse(readFileSync(join(home, "discovery-prompt.json"), "utf8")).systemPrompt as string;
    expect(prompt).toContain("Bob packing");
    expect(prompt).not.toContain("Alice packing");
    const tools = JSON.parse(readFileSync(join(home, "discovery-tools.json"), "utf8")).calls as Array<{ tool: string; ok: boolean; text: string }>;
    expect(tools.map((call) => [call.tool, call.ok])).toEqual([["skills_list", true], ["workspace_read", true]]);
    expect(tools[0]!.text).toContain("Bob packing");
    expect(tools[0]!.text).not.toContain("Alice packing");
    expect(tools[1]!.text).toContain("BOB_ONLY_INSTRUCTIONS");
    expect(tools[1]!.text).not.toContain("ALICE_ONLY_INSTRUCTIONS");
  }, 60_000);

  it("lists each person's own subscription commands, cached apart; keys share the server's", async () => {
    const groupPath = (botId: string) => `/api/bots/${botId}/harness-commands?groupId=${room.id}&threadId=${room.threadId}`;
    const before = probeDirs().length;
    const alice = await api("GET", groupPath(x.id), people.alice);
    expect(alice.status, alice.text).toBe(200);
    expect(names(alice)).toEqual(expect.arrayContaining(["compact", "alice-notes"]));
    expect(names(alice)).not.toContain("bob-notes");
    const bob = await api("GET", groupPath(x.id), people.bob);
    expect(names(bob)).toEqual(expect.arrayContaining(["compact", "bob-notes"]));
    expect(names(bob)).not.toContain("alice-notes");
    // two probes, one per subscription, each in that person's login directory
    expect(probeDirs().slice(before)).toEqual([dirs.alice, dirs.bob]);
    // asked again: each person's list comes from the cache
    expect(names(await api("GET", groupPath(x.id), people.alice))).toContain("alice-notes");
    expect(names(await api("GET", groupPath(x.id), people.bob))).toContain("bob-notes");
    expect(probeDirs().length).toBe(before + 2);

    // carol (the organization's key) and erin (her own key) read the
    // server's list: one probe, no person's directory, no person's commands
    const carol = await api("GET", groupPath(x.id), people.carol);
    expect(carol.status, carol.text).toBe(200);
    const erin = await api("GET", groupPath(x.id), people.erin);
    for (const answer of [carol, erin]) {
      expect(names(answer)).toContain("compact");
      expect(names(answer)).not.toContain("alice-notes");
      expect(names(answer)).not.toContain("bob-notes");
    }
    const shared = probeDirs().slice(before + 2);
    expect(shared).toHaveLength(1);
    expect(shared[0] ?? "").not.toContain(join(".sagax", "principals"));

    // the 1:1 route is the speaker's too: bob on alice's bot, his own thread
    const own = await api("POST", `/api/bots/${x.id}/tasks`, people.bob, { title: "Bob's own" });
    expect(own.status, own.text).toBe(201);
    const direct = await api("GET", `/api/bots/${x.id}/harness-commands?threadId=${own.body.task.threadId}`, people.bob);
    expect(direct.status, direct.text).toBe(200);
    expect(names(direct)).toContain("bob-notes");
    expect(names(direct)).not.toContain("alice-notes");
    expect(probeDirs().at(-1)).toBe(dirs.bob);
  }, 60_000);

  it("a person's own command reaches only the bot it names, verbatim", async () => {
    const roomReplies = async () => ((await api("GET", `/api/threads/${room.threadId}/messages`, people.bob)).body.messages as Array<{ role: string; kind: string; from?: { botId: string } }>)
      .filter((message) => message.role === "bot" && message.kind === "text");
    const repliesBefore = (await roomReplies()).length;
    const turnsBefore = turnTexts().length;
    const sent = await api("POST", `/api/groups/${room.id}/messages`, people.bob, { text: "@Yara /bob-notes summarise what @Xavier said" });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => (await roomReplies()).length > repliesBefore, 30_000);
    // let a member that would (wrongly) answer show up
    await sleep(1_500);
    expect(turnTexts().slice(turnsBefore)).toEqual(["/bob-notes summarise what @Xavier said"]);
    expect((await roomReplies()).slice(repliesBefore).map((message) => message.from?.botId)).toEqual([y.id]);
  }, 60_000);

  it("sections share nothing: the room of a team lists for its people and hides from outsiders", async () => {
    const section = await api("POST", "/api/org/sections", people.alice, { name: "Ventes" });
    expect(section.status, section.text).toBe(201);
    const sectionId = section.body.section.id as string;
    expect((await api("PUT", `/api/org/sections/${sectionId}/members`, people.alice, { members: [{ target: `team:${TEAM_U}`, role: "readonly" }], defaultLevel: "use" })).status).toBe(410);
    const before = probeDirs().length;
    // dave is not in alice's Ops room: it does not exist for him
    expect((await api("GET", `/api/bots/${x.id}/harness-commands?groupId=${room.id}`, people.dave)).status).toBe(404);
    expect(probeDirs().length).toBe(before);
  }, 60_000);
});
