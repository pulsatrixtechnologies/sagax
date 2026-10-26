// A member's own destinations through the real organization server
// (2026-10-19, JC: "everyone should be able to run commands on their own
// VM, PC or cloud computer"). A member (Bob, not an admin) connects his
// Windows desktop app; his bot (Auto: his computer, the cloud one switch
// away) asks for permissions through its broker socket like an engine, and
// the test reads who has to answer each card.
//
//   attachment  Bob sent a .zip: listing and reading it in his own
//               attachments folder (Windows short name, backslashes) runs
//               with no card; a traversal out of it keeps a card (his)
//   computer    a command on his own computer is HIS card at his level,
//               never an admin's, and he can answer it
//   sandbox     his server environment: the same, autonomy policy off too
//   server      a command on the organization's server waits for an admin
//               and the refusal says what to ask for and where; once an
//               admin gives "Run commands on the organization's server" in
//               Perspicax, it is his card; an admin is unchanged
//   choice      the bot choosing his own cloud computer (computer_select)
//               has no card at all, even at Ask (prod 0.5.27)
//   terminal    his own destinations are listed from any bot he talks to;
//               a server host only with that permission
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MEMBER_DEFAULT_PERMISSIONS } from "../shared/permissions.ts";
import { SandboxdVerifier } from "./sandboxd-auth.ts";
import { SandboxService } from "./sandboxd-core.ts";
import { createSandboxdHandler } from "./sandboxd.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { connectFakeDesktop, type FakeDesktop } from "./testing/fake-desktop.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";
import { sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const SANDBOXD_KEY = "e".repeat(64);
const INSTANCE = "e2e-own-dest";
const ALICE: FakeOidcUser = { sub: "01J9S5ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S5BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const BOB_ATTACHMENTS = "C:\\Users\\BOBSMI~1\\AppData\\Local\\Temp\\Sagax\\attachments";

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;
let provisioner: Server;
const docker = new FakeDocker();
/** Request ids stay unique across turns: a card is found by its id. */
let asked = 0;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}), origin: BASE },
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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

posixOnly("organization server: a member's own destinations", () => {
  let alice: Auth;
  let bob: Auth;
  let desktop: FakeDesktop;
  const holdDump = () => join(home, "hold-dump.json");

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: INSTANCE }));
    await service.installEgressPolicy();
    provisioner = createServer(createSandboxdHandler(service, new SandboxdVerifier(SANDBOXD_KEY)));
    await new Promise<void>((resolve) => provisioner.listen(0, "127.0.0.1", resolve));
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-own-dest-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(home, "sandboxd-key"), `${SANDBOXD_KEY}\n`, { mode: 0o400 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: {
        // A turn that waits, so the test speaks to its permission broker.
        hold: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { SAGAX_TEST_FIXED_WORKSPACE: "1", SAGAX_TEST_SEAMS: "1", SAGAX_TERMINAL_TEST: "1",
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
        SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
        SAGAX_ORG_NAME: "Acme",
        SAGAX_SANDBOXD_URL: `http://127.0.0.1:${(provisioner.address() as AddressInfo).port}`,
        SAGAX_SANDBOXD_KEY_FILE: join(home, "sandboxd-key"),
        SAGAX_SANDBOX_INSTANCE: INSTANCE,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
    await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as unknown[] | undefined;
      return got && got.length === 2;
    });
    // Bob's Windows desktop app (a Windows 8.3 short name in the profile path).
    desktop = await connectFakeDesktop({
      base: BASE, cookie: bob.cookie!, name: "Bob's PC", platform: "win32", attachmentsDir: BOB_ATTACHMENTS,
      handle: async (operation) => ({ content: [{ type: "text", text: `desktop:${operation.action}` }] }),
    });
  }, 60_000);

  afterAll(async () => {
    await desktop?.close();
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await new Promise<void>((resolve) => provisioner?.close(() => resolve()));
    if (home) removeTempDir(home);
  });

  /** A held turn of `bot` and a way to ask its broker like an engine. */
  async function heldTurn(auth: Auth, bot: { id: string; threadId: string }, text: string) {
    rmSync(holdDump(), { force: true });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => existsSync(holdDump()), 20_000);
    const mcp = (JSON.parse(readFileSync(holdDump(), "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers;
    const socketPath = mcp.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `own-dest-${bot.id.slice(0, 6)}-${++asked}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      return { id, answer: () => answer };
    };
    const cardOf = async (id: string) => waitFor(async () => {
      const got = await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`, auth);
      return (got.body.messages as Array<{ card?: any }> | undefined)?.find((m) => m.card?.requestId === id)?.card ?? null;
    });
    const noCard = async (id: string) => {
      const rows = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`, auth)).body.messages as Array<{ card?: any }>;
      return !rows.some((m) => m.card?.requestId === id);
    };
    const respond = (who: Auth, requestId: string, behavior: "allow" | "deny", rule?: "allow" | "deny") =>
      api("POST", `/api/threads/${bot.threadId}/respond`, who, { requestId, behavior, ...(rule ? { rule } : {}) });
    const end = async () => {
      for (const socket of sockets) socket.destroy();
      await api("POST", `/api/bots/${bot.id}/interrupt`, auth, {});
      await waitFor(async () => !((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; busy?: boolean }>).find((b) => b.id === bot.id)?.busy);
    };
    return { ask, cardOf, noCard, respond, end, mcpServers: Object.keys(mcp) };
  }

  async function bobBot(name: string) {
    const created = await api("POST", "/api/bots", bob, { name });
    expect(created.status, created.text).toBe(201);
    const bot = { id: created.body.bot.id as string, threadId: created.body.bot.threadId as string };
    expect((await api("PATCH", `/api/bots/${bot.id}`, bob, { modelSelection: { instanceId: "hold", model: "fake-model" } })).status).toBe(200);
    return bot;
  }

  it("his own computer and his attachments: never an admin; reads of what he sent need no card", async () => {
    const pickle = await bobBot("Juniper");
    const turn = await heldTurn(bob, pickle, "lis mon zip");
    try {
      expect(turn.mcpServers).toContain("sagax-desktop");
      // the .zip he attached, unpacked in his own attachments folder: listed
      // and read with no card at all, even at Ask
      const list = await turn.ask("mcp__sagax-desktop__list_files", { path: `${BOB_ATTACHMENTS}\\a6d1def1-fichier` });
      await waitFor(async () => list.answer()?.behavior === "allow");
      expect(await turn.noCard(list.id)).toBe(true);
      const read = await turn.ask("mcp__sagax-desktop__read_file", { path: `${BOB_ATTACHMENTS.replace(/\\/g, "/")}/a6d1def1-fichier/rapport.txt` });
      await waitFor(async () => read.answer()?.behavior === "allow");
      // a traversal out of it is not a read of his attachments: his card
      const escape = await turn.ask("mcp__sagax-desktop__read_file", { path: `${BOB_ATTACHMENTS}\\..\\..\\..\\secret.txt` });
      const escapeCard = await turn.cardOf(escape.id);
      expect(escapeCard.adminApproval).not.toBe(true);
      expect(escape.answer()).toBeUndefined();
      // a command on his own computer: his card at his level, never an
      // admin's (a read-only one runs with no card since #875, so the
      // command here writes)
      const command = await turn.ask("mcp__sagax-desktop__run_command", { command: "npm install", timeout_seconds: 20 });
      const commandCard = await turn.cardOf(command.id);
      expect(commandCard.adminApproval).not.toBe(true);
      const allowed = await turn.respond(bob, command.id, "allow");
      expect(allowed.status, allowed.text).toBe(200);
      await waitFor(async () => command.answer()?.behavior === "allow");
      // security review: his own permission mode (Automatic) never answers
      // a command on his real computer; the card shows
      expect((await api("PUT", `/api/bots/${pickle.id}/permission-mode`, bob, { mode: "auto" })).status).toBe(200);
      const underAuto = await turn.ask("mcp__sagax-desktop__run_command", { command: "npm install" });
      expect((await turn.cardOf(underAuto.id)).adminApproval).not.toBe(true);
      await sleep(300);
      expect(underAuto.answer()).toBeUndefined();
      expect((await api("PUT", `/api/bots/${pickle.id}/permission-mode`, bob, { mode: "approval" })).status).toBe(200);
      // a write elsewhere on his computer: his card too
      const write = await turn.ask("mcp__sagax-desktop__write_file", { path: "C:\\Users\\BOBSMI~1\\Documents\\notes.txt", content: "x" });
      expect((await turn.cardOf(write.id)).adminApproval).not.toBe(true);
      // the Local VM on his computer
      const vm = await turn.ask("mcp__sagax-desktop__local_vm", { action: "run", command: "unzip fichier.zip" });
      await sleep(500);
      if (!(vm.answer()?.behavior === "allow")) expect((await turn.cardOf(vm.id)).adminApproval).not.toBe(true);
      // prod 0.5.27: choosing his own cloud computer (computer_select, Auto)
      // waited for an admin as "Computer select dans Sagax Computer". The
      // bot decides where it works (JC): no card at all, even at Ask.
      expect(turn.mcpServers).toContain("sagax-computer");
      const choose = await turn.ask("mcp__sagax-computer__computer_select", { target: "cloud", reason: "Lancer la commande dans le nuage" });
      await waitFor(async () => choose.answer()?.behavior === "allow");
      expect(await turn.noCard(choose.id)).toBe(true);
    } finally {
      await turn.end();
    }
  }, 120_000);

  it("his server environment: his card even when the organization turns autonomy off", async () => {
    // Works on: the cloud computer (his server environment)
    const prefer = (place: "server" | "computer") => api("PUT", "/api/me/preferences", bob, { preferences: { "sagax.botWorkplace.v1": JSON.stringify({ place, routines: false, network: "all" }) } });
    expect((await prefer("server")).status).toBe(200);
    const off = await api("PATCH", "/api/org/settings", alice, { memberEnvironmentAutonomy: false });
    expect(off.status, off.text).toBe(200);
    const moss = await bobBot("Moss");
    const turn = await heldTurn(bob, moss, "travaille dans le nuage");
    try {
      expect(turn.mcpServers).toContain("sagax-environment");
      const run = await turn.ask("mcp__sagax-environment__run_command", { command: "unzip /workspace/attachments/fichier.zip" });
      expect((await turn.cardOf(run.id)).adminApproval).not.toBe(true);
      const allowed = await turn.respond(bob, run.id, "allow");
      expect(allowed.status, allowed.text).toBe(200);
      // his attachments in his environment: read without a card
      const read = await turn.ask("mcp__sagax-environment__read_file", { path: "/workspace/attachments/fichier/rapport.txt" });
      await waitFor(async () => read.answer()?.behavior === "allow");
    } finally {
      await turn.end();
      await api("PATCH", "/api/org/settings", alice, { memberEnvironmentAutonomy: true });
      await prefer("computer");
    }
  }, 120_000);

  it("PR 3: Always allow on his own cloud computer; his list in settings revokes it; never on his real computer", async () => {
    const prefer = (place: "server" | "computer") => api("PUT", "/api/me/preferences", bob, { preferences: { "sagax.botWorkplace.v1": JSON.stringify({ place, routines: false, network: "all" }) } });
    const sage = await bobBot("Sage");
    expect((await prefer("server")).status).toBe(200);
    let turn = await heldTurn(bob, sage, "travaille dans le nuage");
    try {
      const first = await turn.ask("mcp__sagax-environment__run_command", { command: "npm test" });
      const card = await turn.cardOf(first.id);
      expect(card.adminApproval).not.toBe(true);
      expect(card.ownerRule).toBeTruthy();
      const saved = await turn.respond(bob, first.id, "allow", "allow");
      expect(saved.status, saved.text).toBe(200);
      await waitFor(async () => first.answer()?.behavior === "allow");
      const rules = (await api("GET", "/api/approval-rules", bob)).body.rules as Array<{ id: string; botId: string | null; behavior: string }>;
      const rule = rules.find((row) => row.botId === sage.id && row.behavior === "allow");
      expect(rule).toBeTruthy();
      // the same call now runs with no card
      const again = await turn.ask("mcp__sagax-environment__run_command", { command: "npm test" });
      await waitFor(async () => again.answer()?.behavior === "allow");
      expect(await turn.noCard(again.id)).toBe(true);
      // revoked from his list: the card asks again
      expect((await api("DELETE", `/api/approval-rules/${rule!.id}`, bob)).status).toBe(200);
      const revoked = await turn.ask("mcp__sagax-environment__run_command", { command: "npm test" });
      expect(await turn.cardOf(revoked.id)).toBeTruthy();
      expect(revoked.answer()).toBeUndefined();
    } finally {
      await turn.end();
      await prefer("computer");
    }
    // his real computer (2026-10-19, JC: "Toujours permettre" on every
    // card): offered, bound to the command's one program (2026-10-20, JC,
    // #875), and his own; a chain keeps its card; revoked, the card comes
    // back
    turn = await heldTurn(bob, sage, "sur mon pc");
    try {
      const desktopCall = await turn.ask("mcp__sagax-desktop__run_command", { command: "dir" });
      const card = await turn.cardOf(desktopCall.id);
      expect(card.adminApproval).not.toBe(true);
      expect(card.ownerRule).toMatchObject({ scope: { program: "dir" }, from: "origin" });
      expect((await turn.respond(bob, desktopCall.id, "allow", "allow")).status).toBe(200);
      await waitFor(async () => desktopCall.answer()?.behavior === "allow");
      const rule = ((await api("GET", "/api/approval-rules", bob)).body.rules as Array<{ id: string; botId: string | null; scope: Record<string, string>; from?: string }>)
        .find((row) => row.botId === sage.id && row.scope.program === "dir");
      expect(rule?.from).toBe("origin");
      const again = await turn.ask("mcp__sagax-desktop__run_command", { command: "dir" });
      await waitFor(async () => again.answer()?.behavior === "allow");
      expect(await turn.noCard(again.id)).toBe(true);
      const other = await turn.ask("mcp__sagax-desktop__run_command", { command: "dir & del notes.txt" });
      expect(await turn.cardOf(other.id)).toBeTruthy();
      expect(other.answer()).toBeUndefined();
      // Alice's rules never cover Bob's computer: hers are listed apart
      expect(((await api("GET", "/api/approval-rules", alice)).body.rules as Array<{ id: string }>).some((row) => row.id === rule!.id)).toBe(false);
      expect((await api("DELETE", `/api/approval-rules/${rule!.id}`, alice)).status).toBe(404);
      expect((await api("DELETE", `/api/approval-rules/${rule!.id}`, bob)).status).toBe(200);
      const revoked = await turn.ask("mcp__sagax-desktop__run_command", { command: "dir" });
      expect(await turn.cardOf(revoked.id)).toBeTruthy();
      expect(revoked.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
  }, 150_000);

  it("PR 3: on a bot Alice shares with him, his own destination is HIS card, never an admin's or Alice's", async () => {
    const created = await api("POST", "/api/bots", alice, { name: "Atlas" });
    expect(created.status, created.text).toBe(201);
    const atlasId = created.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${atlasId}`, alice, { modelSelection: { instanceId: "hold", model: "fake-model" } })).status).toBe(200);
    const bobId = (await api("GET", "/api/auth/session", bob)).body.principalId as string;
    const granted = await api("POST", `/api/bots/${atlasId}/direct-grants`, alice, { userId: bobId });
    expect(granted.status, granted.text).toBe(200);
    const bobView = ((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; threadId: string }>).find((bot) => bot.id === atlasId)!;
    expect(bobView).toBeTruthy();
    const atlas = { id: atlasId, threadId: bobView.threadId };
    const turn = await heldTurn(bob, atlas, "ouvre mon pc");
    try {
      expect(turn.mcpServers).toContain("sagax-desktop");
      // a command that writes (a read-only one runs with no card, #875)
      const command = await turn.ask("mcp__sagax-desktop__run_command", { command: "npm install" });
      const card = await turn.cardOf(command.id);
      expect(card.adminApproval).not.toBe(true);
      expect(card.destinationAnswerer).toBe(bobId);
      // Alice owns the bot, but it is Bob's computer: not hers to answer
      expect([403, 404]).toContain((await turn.respond(alice, command.id, "allow")).status);
      const allowed = await turn.respond(bob, command.id, "allow");
      expect(allowed.status, allowed.text).toBe(200);
      await waitFor(async () => command.answer()?.behavior === "allow");
      // his attachments: read with no card
      const read = await turn.ask("mcp__sagax-desktop__read_file", { path: `${BOB_ATTACHMENTS}\\a1b2c3d4-notes.txt` });
      await waitFor(async () => read.answer()?.behavior === "allow");
      // a server command on Alice's bot (she is an admin) from Bob's turn:
      // never Bob's to answer
      const shell = await turn.ask("Bash", { command: "id" });
      await sleep(500);
      expect([403, 404]).toContain((await turn.respond(bob, shell.id, "allow")).status);
      expect(shell.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
  }, 150_000);

  // 2026-10-21 (JC): "Toujours permettre" on a member's bot did not stick:
  // the engine writes its own `description` beside the command, so a rule
  // bound to every argument of the request never met the next one. It now
  // keeps the program for this bot (like a solo bot), for both who may
  // click it: an admin on the admin's card, the owner holding
  // host.commands on his own card. The bot's owner and an admin see it in
  // the bot's rules and may remove it.
  it("Always allow on a member's server command keeps the program for this bot only, owner and admin see and remove it", async () => {
    const rulesOfBot = async (who: Auth, botId: string) =>
      ((await api("GET", `/api/approval-rules?botId=${botId}`, who)).body.rules ?? []) as Array<{ id: string; botId: string | null; from?: string; scope: Record<string, string>; byOther?: boolean; savedBy?: string }>;
    // the admin's card
    const fern = await bobBot("Fern");
    const birch = await bobBot("Birch");
    let turn = await heldTurn(bob, fern, "lance les tests");
    try {
      const first = await turn.ask("Bash", { command: "npm test", description: "Run the test suite" });
      const card = await turn.cardOf(first.id);
      expect(card.adminApproval).toBe(true);
      expect(card.ownerRule).toMatchObject({ scope: { program: "npm" }, from: "admin" });
      expect((await turn.respond(alice, first.id, "allow", "allow")).status).toBe(200);
      await waitFor(async () => first.answer()?.behavior === "allow");
      // the same command with the engine's other words: no card
      const again = await turn.ask("Bash", { command: "npm test", description: "Run tests again" });
      await waitFor(async () => again.answer()?.behavior === "allow");
      expect(await turn.noCard(again.id)).toBe(true);
      // the same program: no card; another program: the admin's card
      const sameProgram = await turn.ask("Bash", { command: "npm run build", description: "Build" });
      await waitFor(async () => sameProgram.answer()?.behavior === "allow");
      expect(await turn.noCard(sameProgram.id)).toBe(true);
      const other = await turn.ask("Bash", { command: "uname -a", description: "Show the system" });
      expect((await turn.cardOf(other.id)).adminApproval).toBe(true);
      expect(other.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
    // never another bot of his
    turn = await heldTurn(bob, birch, "lance les tests");
    try {
      const elsewhere = await turn.ask("Bash", { command: "npm test", description: "Run the test suite" });
      expect((await turn.cardOf(elsewhere.id)).adminApproval).toBe(true);
      expect(elsewhere.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
    // Bob (the owner) sees the admin's rule in Fern's rules and may remove it
    const bobSees = (await rulesOfBot(bob, fern.id)).find((row) => row.from === "admin");
    expect(bobSees).toMatchObject({ botId: fern.id, scope: { program: "npm" }, byOther: true, savedBy: "Alice" });
    // by her name only, never her id (review of #938)
    expect(bobSees).not.toHaveProperty("ownerId");
    expect((await rulesOfBot(bob, birch.id)).some((row) => row.from === "admin")).toBe(false);
    // he may not edit it (it is Alice's), only remove it
    expect((await api("PATCH", `/api/approval-rules/${bobSees!.id}`, bob, { description: "x" })).status).toBe(404);
    expect((await api("DELETE", `/api/approval-rules/${bobSees!.id}`, bob)).status).toBe(200);
    expect((await rulesOfBot(alice, fern.id)).some((row) => row.id === bobSees!.id)).toBe(false);
    turn = await heldTurn(bob, fern, "encore");
    try {
      const revoked = await turn.ask("Bash", { command: "npm test", description: "Run the test suite" });
      expect((await turn.cardOf(revoked.id)).adminApproval).toBe(true);
      expect(revoked.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }

    // the owner holding host.commands answers his own card: his Always
    // allow keeps the program too; an admin sees it and may remove it
    const listed = async () =>
      ((await api("GET", `/api/terminal/resources?botId=${fern.id}&threadId=${fern.threadId}`, bob)).body.resources ?? []) as Array<{ scope?: string }>;
    idp.directoryPeople = [idp.personOf(ALICE), { ...idp.personOf(BOB), permissions: [...MEMBER_DEFAULT_PERMISSIONS, "host.commands"] }];
    await waitFor(async () => (await listed()).some((row) => (row.scope ?? "server") === "server"), 30_000);
    turn = await heldTurn(bob, fern, "lance les tests");
    try {
      const first = await turn.ask("Bash", { command: "npm test", description: "Run the test suite" });
      const card = await turn.cardOf(first.id);
      expect(card.serverCommandHolder).toBe(true);
      expect(card.ownerRule).toMatchObject({ scope: { program: "npm" }, from: "admin" });
      expect((await turn.respond(bob, first.id, "allow", "allow")).status).toBe(200);
      await waitFor(async () => first.answer()?.behavior === "allow");
      const again = await turn.ask("Bash", { command: "npm test -- --watch=false", description: "Run tests once" });
      await waitFor(async () => again.answer()?.behavior === "allow");
      expect(await turn.noCard(again.id)).toBe(true);
      const other = await turn.ask("Bash", { command: "uname -a", description: "Show the system" });
      expect((await turn.cardOf(other.id)).serverCommandHolder).toBe(true);
      expect(other.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
    const aliceSees = (await rulesOfBot(alice, fern.id)).find((row) => row.from === "admin");
    expect(aliceSees).toMatchObject({ botId: fern.id, scope: { program: "npm" }, byOther: true, savedBy: "Bob" });
    expect((await api("DELETE", `/api/approval-rules/${aliceSees!.id}`, alice)).status).toBe(200);
    expect((await rulesOfBot(bob, fern.id)).some((row) => row.id === aliceSees!.id)).toBe(false);
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    await waitFor(async () => !(await listed()).some((row) => (row.scope ?? "server") === "server"), 30_000);
  }, 240_000);

  // Review of #938 (finding 3): a held admin card (here Claude's
  // dangerouslyDisableSandbox, the same as a safety hold or Codex's
  // additional permissions) keeps the whole request: the admin's Always
  // allow on `npm install` never lets `npm run deploy` through.
  it("a held admin card keeps the whole request: npm install kept, npm run deploy still asks", async () => {
    const hazel = await bobBot("Hazel");
    const turn = await heldTurn(bob, hazel, "installe");
    try {
      const held = await turn.ask("Bash", { command: "npm install", dangerouslyDisableSandbox: true, description: "Install" });
      const card = await turn.cardOf(held.id);
      expect(card.adminApproval).toBe(true);
      expect(card.ownerRule?.scope?.program).toBeUndefined();
      expect(card.ownerRule).toMatchObject({ scope: { command: "npm install" }, from: "admin" });
      expect((await turn.respond(alice, held.id, "allow", "allow")).status).toBe(200);
      await waitFor(async () => held.answer()?.behavior === "allow");
      const deploy = await turn.ask("Bash", { command: "npm run deploy", description: "Deploy" });
      expect((await turn.cardOf(deploy.id)).adminApproval).toBe(true);
      expect(deploy.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
  }, 120_000);

  it("the organization's server: an admin's, until an admin gives the permission in Perspicax; an admin is unchanged", async () => {
    const otto = await bobBot("Otto");
    let turn = await heldTurn(bob, otto, "commande serveur");
    try {
      const shell = await turn.ask("Bash", { command: "cat /etc/hostname" });
      const card = await turn.cardOf(shell.id);
      expect(card.adminApproval).toBe(true);
      const refused = await turn.respond(bob, shell.id, "allow");
      expect(refused.status).toBe(403);
      // the refusal says what to ask an admin for, and where they give it
      expect(String(refused.body.error)).toContain("Run commands on the organization's server");
      expect(String(refused.body.error)).toContain("Perspicax");
      // an admin answers it, as before, and (2026-10-19) may keep it: the
      // card offers Always allow to the admin, never Always deny, never to
      // Bob; since 2026-10-21 it keeps the program (cat) for Otto
      expect(card.ownerRule).toMatchObject({ scope: { program: "cat" }, from: "admin" });
      expect((await turn.respond(bob, shell.id, "allow", "allow")).status).toBe(403);
      expect((await turn.respond(alice, shell.id, "deny", "deny")).status).toBe(400);
      const byAdmin = await turn.respond(alice, shell.id, "allow", "allow");
      expect(byAdmin.status, byAdmin.text).toBe(200);
      await waitFor(async () => shell.answer()?.behavior === "allow");
      const adminRule = ((await api("GET", "/api/approval-rules", alice)).body.rules as Array<{ id: string; botId: string | null; from?: string; botName?: string }>)
        .find((row) => row.botId === otto.id);
      expect(adminRule).toMatchObject({ from: "admin", botName: "Otto" });
      // the same program of Otto: no card; another program: an admin's card
      const again = await turn.ask("Bash", { command: "cat /etc/hostname" });
      await waitFor(async () => again.answer()?.behavior === "allow");
      expect(await turn.noCard(again.id)).toBe(true);
      const other = await turn.ask("Bash", { command: "hostname -f" });
      expect((await turn.cardOf(other.id)).adminApproval).toBe(true);
      expect(other.answer()).toBeUndefined();
      // revoked by Alice, the card is back (Bob, its owner, may remove it
      // too since 2026-10-21: see the test above)
      expect((await api("DELETE", `/api/approval-rules/${adminRule!.id}`, alice)).status).toBe(200);
      const revoked = await turn.ask("Bash", { command: "cat /etc/hostname" });
      expect((await turn.cardOf(revoked.id)).adminApproval).toBe(true);
      expect(revoked.answer()).toBeUndefined();
    } finally {
      await turn.end();
    }
    // terminal: his own destinations are listed; the server's test host is not
    const listed = async (auth: Auth, bot: { id: string; threadId: string }) =>
      ((await api("GET", `/api/terminal/resources?botId=${bot.id}&threadId=${bot.threadId}`, auth)).body.resources ?? []) as Array<{ provider: string; scope?: string }>;
    const bobOwn = await listed(bob, otto);
    expect(bobOwn.some((row) => row.provider === "desktop")).toBe(true);
    expect(bobOwn.some((row) => (row.scope ?? "server") === "server")).toBe(false);
    // from Alice's bot he talks to, his own destinations are still his
    const created = await api("POST", "/api/bots", alice, { name: "Shared" });
    const shared = { id: created.body.bot.id as string, threadId: created.body.bot.threadId as string };
    expect((await listed(alice, shared)).some((row) => (row.scope ?? "server") === "server")).toBe(true);

    // an admin gives Bob "Run commands on the organization's server" in
    // Perspicax (a permission set): the directory carries it
    idp.directoryPeople = [idp.personOf(ALICE), { ...idp.personOf(BOB), permissions: [...MEMBER_DEFAULT_PERMISSIONS, "host.commands"] }];
    await waitFor(async () => (await listed(bob, otto)).some((row) => (row.scope ?? "server") === "server"), 30_000);
    turn = await heldTurn(bob, otto, "commande serveur encore");
    try {
      const shell = await turn.ask("Bash", { command: "cat /etc/hostname" });
      const card = await turn.cardOf(shell.id);
      expect(card.adminApproval).not.toBe(true);
      expect(card.serverCommandHolder).toBe(true);
      const allowed = await turn.respond(bob, shell.id, "allow");
      expect(allowed.status, allowed.text).toBe(200);
      await waitFor(async () => shell.answer()?.behavior === "allow");
      // security review: his permission mode never answers a server command
      expect((await api("PUT", `/api/bots/${otto.id}/permission-mode`, bob, { mode: "auto" })).status).toBe(200);
      const underAuto = await turn.ask("Bash", { command: "uptime" });
      const autoCard = await turn.cardOf(underAuto.id);
      expect(autoCard.adminApproval).not.toBe(true);
      await sleep(300);
      expect(underAuto.answer()).toBeUndefined();
      // the right is checked again at the answer: taken back, refused
      idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
      await waitFor(async () => !(await listed(bob, otto)).some((row) => (row.scope ?? "server") === "server"), 30_000);
      const late = await turn.respond(bob, underAuto.id, "allow");
      expect(late.status).toBe(403);
      expect(underAuto.answer()).toBeUndefined();
    } finally {
      await api("PUT", `/api/bots/${otto.id}/permission-mode`, bob, { mode: "approval" });
      await turn.end();
      idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    }
  }, 150_000);
});
