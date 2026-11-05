// A person's own GitHub account, MCP servers, plugins and skills on an
// organization server (owner report 2026-10-02: "I'm trying to add the
// GitHub MCP or even log into GitHub ... and it's not letting me"), through
// the real server against the fake Perspicax, the fake Claude CLI, an
// in-test provisioner (the real handler and upgrade over a FakeDocker), a
// fake GitHub, a fake OAuth MCP server and a local git marketplace:
//
//   OC-1  what still refuses: the server-wide MCP list stays an admin's, and
//         a server-wide command is never added (it would run on the host)
//   OC-2  Connecter GitHub: the device flow stores the token for that person
//         only and writes it where gh and git read it in their environment
//   OC-3  a person's own remote MCP servers: their GitHub connection as the
//         bearer, and an OAuth sign-in through this server's callback
//   OC-4  a person's own command runs in their server environment, mounted
//         for their turns only, with their own servers beside it
//   OC-5  plugins: a marketplace and a plugin on the owner's bot, loaded with
//         --plugin-dir, hooks stripped; use is read-only; the admin's list
//   OC-6  skills: a member adds a skill to their own bot
//   OC-7  a member does the whole flow with no admin, on a bot someone
//         shared at manage
//   OC-8  sagax_integrations off from an older Perspicax (ignored): the member
//         still manages everything and what they saved stays usable
//   OC-9  an organization admin lists and revokes a person's connections;
//         a member and an unsigned loopback are refused; no secret is returned
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SandboxdVerifier } from "../sandbox/sandboxd-auth.ts";
import { SandboxService } from "../sandbox/sandboxd-core.ts";
import { createSandboxdHandler, createSandboxdUpgradeHandler } from "../sandboxd.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { FakeDocker } from "../testing/fake-docker.ts";
import { startFakeOAuthMcp, type FakeOAuthMcp } from "../testing/fake-oauth-mcp-server.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { freePortBlock } from "../testing/ports.ts";
import { sandboxKeyForPrincipal, sandboxNames, sandboxdConfigFromEnv } from "../sandbox/user-sandbox-spec.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32" || !hasGit());
const ORG_KEY = "sk-ant-test-org-key-000000";
const SANDBOXD_KEY = "d".repeat(64);
const INSTANCE = "oc";
const GITHUB_TOKEN = "gho_fake_device_token_bob_000000";
const ALICE: FakeOidcUser = { sub: "01J9OCALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9OCBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const UMA: FakeOidcUser = { sub: "01J9OCUMA00000000000000U", email: "uma@example.test", name: "Uma", preferred_username: "uma", role: "employee", teams: [] };
const RITA: FakeOidcUser = { sub: "01J9OCRITA0000000000000R", email: "rita@example.test", name: "Rita", preferred_username: "rita", role: "employee", teams: [] };

function hasGit(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let mcpDump = "";
let engineDump = "";
let log = "";
let idp: FakeOidcProvider;
let provisioner: Server;
let github: Server;
let githubBase = "";
let devicePolls = 0;
let oauth: FakeOAuthMcp;
const docker = new FakeDocker();

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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

type Message = { role: string; kind: string; text?: string };
const threadMessages = async (auth: Auth, threadId: string) => ((await api("GET", `/api/threads/${threadId}/messages`, auth)).body.messages ?? []) as Message[];

/** The Authorization header a remote personal server is reached with: on
 * the engine's own config, or inside Sagax's gate (2026-10-29, #1604: a
 * custom server sits behind mcp-gate, a remote one through
 * mcp-remote-proxy, which carries the server's headers in its own
 * environment, never in the engine's argv). */
function remoteAuthorization(server: { headers?: Record<string, string>; env?: Record<string, string> } | undefined): string | undefined {
  if (!server) return undefined;
  if (server.headers?.Authorization) return server.headers.Authorization;
  try {
    const upstream = JSON.parse(server.env?.SAGAX_GATE_UPSTREAM ?? "{}") as { env?: Record<string, string> };
    const remote = JSON.parse(upstream.env?.SAGAX_REMOTE_MCP_SERVER ?? "{}") as { headers?: Record<string, string> };
    return remote.headers?.Authorization;
  } catch {
    return undefined;
  }
}

async function turn(auth: Auth, bot: { id: string; threadId: string }, text: string): Promise<string> {
  const before = (await threadMessages(auth, bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text").length;
  if (existsSync(mcpDump)) rmSync(mcpDump);
  if (existsSync(engineDump)) rmSync(engineDump);
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text });
  expect(sent.status, sent.text).toBe(202);
  const reply = await waitFor(async () => {
    const replies = (await threadMessages(auth, bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text" && m.text);
    return replies.length > before ? replies.at(-1)! : null;
  }, 40_000);
  await waitFor(async () => !((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; busy?: boolean }>).find((b) => b.id === bot.id)?.busy);
  return reply.text ?? "";
}

async function createBot(auth: Auth, name: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const bot = { id: created.body.bot.id as string, threadId: created.body.bot.threadId as string };
  expect((await api("PATCH", `/api/bots/${bot.id}`, auth, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
  return bot;
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(new URLSearchParams(body)));
  });
}

/** github.com's device flow and api.github.com/user, as Sagax calls them. */
async function startFakeGithub(): Promise<void> {
  github = createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && req.url === "/login/device/code") {
      const form = await readForm(req);
      if (form.get("client_id") !== "Iv1.sagax-test") return send(400, { error: "incorrect_client_credentials" });
      return send(200, { device_code: "device-xyz", user_code: "WDJB-MJHT", verification_uri: `${githubBase}/login/device`, expires_in: 900, interval: 1 });
    }
    if (req.method === "POST" && req.url === "/login/oauth/access_token") {
      const form = await readForm(req);
      devicePolls += 1;
      if (form.get("device_code") !== "device-xyz") return send(200, { error: "bad_verification_code" });
      return devicePolls < 2 ? send(200, { error: "authorization_pending" }) : send(200, { access_token: GITHUB_TOKEN, token_type: "bearer", scope: "repo,read:org,gist,workflow" });
    }
    if (req.method === "GET" && req.url === "/user") {
      if (req.headers.authorization !== `Bearer ${GITHUB_TOKEN}`) return send(401, { message: "Bad credentials" });
      return send(200, { login: "bob-gh", name: "Bob GitHub" }, { "x-oauth-scopes": "repo, read:org, gist, workflow" });
    }
    // Before a clone Sagax asks the API which credential reads the repository (github-access.ts, #271).
    const repoRoute = /^\/repos\/acme\/(tools|uma-tools|rita-tools)$/.exec(req.url ?? "");
    if (req.method === "GET" && repoRoute) {
      // readable without a credential (a person with no GitHub connection), as the local git marketplace is
      return send(200, { full_name: `acme/${repoRoute[1]}`, private: false });
    }
    send(404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
  githubBase = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
}

/** A Claude Code marketplace in a local git repository, reached as
 * https://github.com/acme/tools through git's insteadOf. */
function marketplaceRepo(root: string, name = "acme-tools"): string {
  const repo = join(root, name);
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  write(".claude-plugin/marketplace.json", JSON.stringify({ name, plugins: [{ name: "reviewer", source: "./plugins/reviewer", description: "Reviews code", version: "1.0.0" }] }));
  write("plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer", hooks: "./hooks/hooks.json" }));
  write("plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review a diff\n---\nReview it.");
  write("plugins/reviewer/hooks/hooks.json", JSON.stringify({ hooks: { PreToolUse: [] } }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" } });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "marketplace");
  return repo;
}

posixOnly("organization: a person's own GitHub, MCP servers, plugins and skills", () => {
  let alice: Auth;
  let bob: Auth;
  let uma: Auth;
  let rita: Auth;
  const ids: Record<string, string> = {};
  let bobBot: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: INSTANCE }));
    await service.installEgressPolicy();
    const verifier = new SandboxdVerifier(SANDBOXD_KEY);
    provisioner = createServer(createSandboxdHandler(service, verifier));
    provisioner.on("upgrade", createSandboxdUpgradeHandler(service, verifier));
    await new Promise<void>((resolve) => provisioner.listen(0, "127.0.0.1", resolve));
    await startFakeGithub();
    oauth = await startFakeOAuthMcp({ registration: true });
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, UMA, RITA].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-connections-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(home, "sandboxd-key"), `${SANDBOXD_KEY}\n`, { mode: 0o400 });
    const repo = marketplaceRepo(home);
    // A marketplace a member adds is private to her (#989): another member
    // adding the same one is told the name is taken, so each member who adds
    // one in this file has her own.
    const umaRepo = marketplaceRepo(home, "uma-tools");
    const ritaRepo = marketplaceRepo(home, "rita-tools");
    const gitConfig = join(home, "gitconfig");
    writeFileSync(gitConfig, [repo, umaRepo, ritaRepo].map((dir, index) => `[url "file://${dir}"]\n\tinsteadOf = https://github.com/acme/${["tools", "uma-tools", "rita-tools"][index]}.git\n`).join(""));
    mcpDump = join(home, "mcp-dump.json");
    engineDump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: {
          // fcce56775 (#1812): this fixture uses the organization API key.
          driver: "claudeAgent", access: "api",
          environment: {
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "mytools", tool: "whoami", arguments: {} }]),
            FAKE_CLAUDE_MCP_DUMP: mcpDump,
            FAKE_CLAUDE_DUMP: engineDump,
          },
          config: { cli: FAKE_CLAUDE, fullAuto: true, requireApiKey: true },
        },
      },
    }));
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
        SAGAX_SANDBOXD_URL: `http://127.0.0.1:${(provisioner.address() as AddressInfo).port}`,
        SAGAX_SANDBOXD_KEY_FILE: join(home, "sandboxd-key"),
        SAGAX_SANDBOX_INSTANCE: INSTANCE,
        SAGAX_GITHUB_CLIENT_ID: "Iv1.sagax-test",
        SAGAX_GITHUB_WEB_ORIGIN: githubBase,
        SAGAX_GITHUB_API_ORIGIN: githubBase,
        // the fake OAuth MCP server and the fake GitHub MCP listen on loopback
        SAGAX_PERSONAL_MCP_ALLOW_PRIVATE: "1",
        GIT_CONFIG_GLOBAL: gitConfig,
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
    uma = await signIn(UMA);
    rita = await signIn(RITA);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 4 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bobBot = await createBot(bob, "Bobby");
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await oauth?.close();
    await new Promise<void>((resolve) => provisioner?.close(() => resolve()));
    await new Promise<void>((resolve) => github?.close(() => resolve()));
    if (home) removeTempDir(home);
  });

  it("OC-1: the server-wide MCP list stays the admin's, and never takes a command", async () => {
    const member = await api("POST", "/api/mcp/servers", bob, { name: "gh", type: "http", url: "https://api.githubcopilot.com/mcp/" });
    expect(member.status).toBe(403);
    const command = await api("POST", "/api/mcp/servers", alice, { name: "local", command: "npx", args: ["-y", "x"] });
    expect(command.status, command.text).toBe(403);
    expect(command.body.code).toBe("org_host_command");
    // a bot still cannot run `claude plugin ...` on the host: Bash is denied
    // there (withholdHostTools), whatever SAGAX_CLAUDE_ALLOW says
  });

  it("OC-2: Connecter GitHub stores the token for that person only and writes it into their environment", async () => {
    const before = await api("GET", "/api/me/connections", bob);
    expect(before.status, before.text).toBe(200);
    expect(before.body.github).toMatchObject({ state: "none", deviceFlow: true });
    const started = await api("POST", "/api/me/github/device", bob, {});
    expect(started.status, started.text).toBe(200);
    expect(started.body).toMatchObject({ userCode: "WDJB-MJHT", verificationUri: `${githubBase}/login/device` });
    const connected = await waitFor(async () => {
      const view = await api("GET", "/api/me/connections", bob);
      return view.body.github?.state === "connected" ? view : null;
    });
    expect(connected.body.github).toMatchObject({ login: "bob-gh", via: "device" });
    expect(connected.text).not.toContain(GITHUB_TOKEN);
    expect((await api("GET", "/api/me/connections", alice)).body.github.state).toBe("none");
    const bobContainer = sandboxNames(sandboxKeyForPrincipal(INSTANCE, ids.bob!)).container;
    const written = await waitFor(async () => docker.execs.find((entry) => entry.exec.Env.includes(`SAGAX_GH_TOKEN=${GITHUB_TOKEN}`)) ?? null);
    expect(written.name).toBe(bobContainer);
    expect(written.exec.Cmd.join(" ")).not.toContain(GITHUB_TOKEN);
    // the script builds the path from $HOME/.config/gh and hosts.yml
    expect(written.exec.Cmd.join(" ")).toContain("$HOME/.config/gh");
    expect(written.exec.Cmd.join(" ")).toContain("hosts.yml");
    // a pasted token that GitHub refuses is refused
    expect((await api("POST", "/api/me/github/token", alice, { token: "nope" })).body.code).toBe("token_refused");
  }, 60_000);

  it("OC-3: a person's own remote servers: GitHub as the bearer, and an OAuth sign-in through this server", async () => {
    const gh = await api("POST", "/api/me/mcp/servers", bob, { name: "github", url: `${oauth.base}/github-mcp`, auth: "github" });
    expect(gh.status, gh.text).toBe(201);
    expect(gh.body.servers.find((server: { name: string }) => server.name === "github")).toMatchObject({ authState: "connected", auth: "github" });
    const notes = await api("POST", "/api/me/mcp/servers", bob, { name: "notes", url: oauth.mcpUrl, auth: "oauth" });
    expect(notes.status, notes.text).toBe(201);
    expect(notes.body.servers.find((server: { name: string }) => server.name === "notes")).toMatchObject({ authState: "needs_sign_in" });
    const start = await api("POST", "/api/me/mcp/servers/notes/oauth/start", bob, {});
    expect(start.status, start.text).toBe(200);
    expect(start.body.redirectUri).toBe(`${BASE}/api/mcp-oauth/callback`);
    const callback = await oauth.authorize(start.body.authorizationUrl);
    const landed = await fetch(callback);
    expect(landed.status).toBe(200);
    const listed = await api("GET", "/api/me/connections", bob);
    expect(listed.body.servers.find((server: { name: string }) => server.name === "notes")).toMatchObject({ authState: "connected" });
    expect(listed.text).not.toMatch(/access_[0-9a-f]/);
    // nobody else sees them
    expect((await api("GET", "/api/me/connections", alice)).body.servers).toEqual([]);
  }, 60_000);

  it("OC-4: a person's own command runs in their server environment, for their turns only", async () => {
    const added = await api("POST", "/api/me/mcp/servers", bob, { name: "mytools", command: "fake-mcp-server", args: ["--stdio"], env: { API_KEY: "k-123" } });
    expect(added.status, added.text).toBe(201);
    expect(added.text).not.toContain("k-123");
    const reply = await turn(bob, bobBot, "use my tools");
    expect(reply).toContain("mcp:whoami:ok");
    const bobContainer = sandboxNames(sandboxKeyForPrincipal(INSTANCE, ids.bob!)).container;
    const call = (JSON.parse(readFileSync(mcpDump, "utf8")) as { calls: Array<{ server: string; text: string }> }).calls.find((entry) => entry.server === "mytools")!;
    expect(call.text).toContain(`container=${bobContainer}`);
    expect(call.text).toContain("env=API_KEY");
    expect(call.text).toContain("user=1000:1000");
    const engine = JSON.parse(readFileSync(engineDump, "utf8")) as { mcpConfig: { mcpServers: Record<string, { url?: string; headers?: Record<string, string>; env?: Record<string, string> }> } };
    const servers = engine.mcpConfig.mcpServers;
    expect(remoteAuthorization(servers.github)).toBe(`Bearer ${GITHUB_TOKEN}`);
    expect(remoteAuthorization(servers.notes)).toMatch(/^Bearer /);
    // the engine gets Sagax's stdio proxy, never the person's command or its variables
    expect(servers.mytools).toBeTruthy();
    expect(JSON.stringify(servers.mytools)).not.toContain("fake-mcp-server");
    expect(JSON.stringify(servers.mytools)).not.toContain("k-123");
    // Alice's turn on her own bot gets none of Bob's servers
    const aliceBot = await createBot(alice, "Alba");
    expect(await turn(alice, aliceBot, "anything")).toContain("mcp:absent");
    const aliceEngine = JSON.parse(readFileSync(engineDump, "utf8")) as { mcpConfig: { mcpServers: Record<string, unknown> } };
    for (const name of ["github", "notes", "mytools"]) expect(Object.keys(aliceEngine.mcpConfig.mcpServers)).not.toContain(name);
  }, 120_000);

  it("OC-5: plugins from a marketplace on the owner's bot, loaded with --plugin-dir; use is read-only; the admin's list", async () => {
    const added = await api("POST", `/api/bots/${bobBot.id}/plugins/marketplaces`, bob, { source: "acme/tools" });
    expect(added.status, added.text).toBe(201);
    expect(added.body.marketplace.plugins).toEqual([expect.objectContaining({ name: "reviewer", installed: false })]);
    const installed = await api("POST", `/api/bots/${bobBot.id}/plugins/install`, bob, { marketplace: "acme-tools", plugin: "reviewer" });
    expect(installed.status, installed.text).toBe(201);
    expect(installed.body.plugin.removed).toEqual(expect.arrayContaining(["hooks", "plugin.json hooks"]));
    await turn(bob, bobBot, "review this");
    const argv = (JSON.parse(readFileSync(engineDump, "utf8")) as { argv: string[] }).argv;
    const dir = argv[argv.indexOf("--plugin-dir") + 1]!;
    expect(argv).toContain("--plugin-dir");
    expect(existsSync(join(dir, "skills", "review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "hooks"))).toBe(false);
    // a member the bot is not shared with sees nothing; with use, reads only
    expect((await api("GET", `/api/bots/${bobBot.id}/plugins`, uma)).status).toBe(404);
    expect((await api("PUT", `/api/bots/${bobBot.id}/grants`, bob, { target: `user:${ids.uma}`, level: "use" })).status).toBe(200);
    const read = await api("GET", `/api/bots/${bobBot.id}/plugins`, uma);
    expect(read.status, read.text).toBe(200);
    expect(read.body.canChange).toBe(false);
    expect((await api("PATCH", `/api/bots/${bobBot.id}/plugins/reviewer@acme-tools`, uma, { enabled: false })).body.code).toBe("plugins_owner_only");
    // the admin keeps a list: it binds what is shared with the whole
    // organization, never a member's own marketplace (2026-10-27, #1098: a
    // member's own bots are theirs, the organization's list does not limit
    // them)
    const policy = await api("PATCH", "/api/org/settings", alice, { pluginMarketplaces: { mode: "list", allow: ["pulsatrixtechnologies/*"] } });
    expect(policy.status, policy.text).toBe(200);
    expect(policy.body.settings.pluginMarketplaces).toEqual({ mode: "list", allow: ["pulsatrixtechnologies/*"] });
    const own = await api("POST", `/api/bots/${bobBot.id}/plugins/marketplaces`, bob, { source: "acme/tools" });
    expect(own.status, own.text).toBe(201);
    const alba = await createBot(alice, "Alba Shared");
    const refused = await api("POST", `/api/bots/${alba.id}/plugins/marketplaces`, alice, { source: "acme/shared-tools", visibility: "org" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("marketplace_not_allowed");
    expect((await api("PATCH", "/api/org/settings", alice, { pluginMarketplaces: { mode: "any" } })).status).toBe(200);
  }, 120_000);

  it("OC-5b: Capabilities > Organization sources and access saves through the live route, never echoes a token, and refuses a member", async () => {
    const clientId = await api("PATCH", "/api/org/settings", alice, { githubClientId: " Ov23liExampleClient " });
    expect(clientId.status, clientId.text).toBe(200);
    expect(clientId.body.settings.github).toMatchObject({ clientId: "Ov23liExampleClient" });
    // the organization's GitHub credentials are in the one list
    // (/api/me/github/credentials), not in these settings (2026-10-28)
    const secret = "ghp_" + "e2e".repeat(12) + "9876";
    const refused = await api("PATCH", "/api/org/settings", alice, { githubTokens: { op: "add", label: "Depots internes", token: secret } });
    expect(refused.status).toBe(400);
    expect(refused.text).not.toContain(secret);
    const added = await api("POST", "/api/me/github/credentials", alice, { op: "add", label: "Depots internes", token: secret, scope: "org" });
    expect(added.status, added.text).toBe(200);
    expect(added.text).not.toContain(secret);
    const read = await api("GET", "/api/org", alice);
    expect(read.text).not.toContain(secret);
    expect(read.body.settings).not.toHaveProperty("githubTokens");
    // a member sees the organization's by label only, and cannot change the client id
    const memberRead = await api("GET", "/api/me/github/credentials", bob);
    expect(memberRead.text).not.toContain(secret);
    expect(memberRead.body.credentials.map((entry: { label: string }) => entry.label)).toContain("Depots internes");
    expect((await api("PATCH", "/api/org/settings", bob, { githubClientId: "Ov23liOther" })).status).toBe(403);
    const id = (added.body.credentials as Array<{ id: string; label: string }>).find((entry) => entry.label === "Depots internes")!.id;
    expect((await api("POST", "/api/me/github/credentials", alice, { op: "remove", id })).status).toBe(200);
    expect((await api("PATCH", "/api/org/settings", alice, { githubClientId: null })).status).toBe(200);
  });

  it("OC-6: a member adds a skill to their own bot", async () => {
    const text = "---\nname: greet\ndescription: Greet people\n---\nSay hello.";
    const created = await api("POST", `/api/bots/${bobBot.id}/skill-template`, bob, { name: "greet", description: "Greet people", text, source: "template", enabled: true });
    expect(created.status, created.text).toBe(201);
    const listed = await api("GET", `/api/bots/${bobBot.id}/skills`, bob);
    expect(listed.body.skills.map((skill: { name: string }) => skill.name)).toContain("greet");
    // a person with use on it reads and cannot change
    expect((await api("GET", `/api/bots/${bobBot.id}/skills`, uma)).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${bobBot.id}/skills/greet`, uma)).status).toBe(403);
  });

  it("OC-7: a member does the whole flow with no admin, on a bot shared with them at manage", async () => {
    expect((await api("GET", "/api/config", uma)).body.viewer.integrationsManagedByAdmin).toBeUndefined();
    // GitHub by a pasted token, then the GitHub MCP with it and a token server
    const connected = await api("POST", "/api/me/github/token", uma, { token: GITHUB_TOKEN });
    expect(connected.status, connected.text).toBe(200);
    expect(connected.body.github).toMatchObject({ state: "connected", login: "bob-gh", via: "token" });
    const gh = await api("POST", "/api/me/mcp/servers", uma, { name: "github", url: `${oauth.base}/github-mcp`, auth: "github" });
    expect(gh.status, gh.text).toBe(201);
    const tok = await api("POST", "/api/me/mcp/servers", uma, { name: "tracker", url: `${oauth.base}/tracker-mcp`, auth: "token", token: "t-uma-000" });
    expect(tok.status, tok.text).toBe(201);
    const mine = await api("GET", "/api/me/connections", uma);
    expect(mine.body.managedByAdmin).toBeUndefined();
    expect(mine.body.servers.map((server: { name: string }) => server.name).sort()).toEqual(["github", "tracker"]);
    // Bob lets Uma manage his bot: she adds the marketplace, installs, adds a skill
    expect((await api("PUT", `/api/bots/${bobBot.id}/grants`, bob, { target: `user:${ids.uma}`, level: "manage" })).status).toBe(200);
    expect((await api("GET", `/api/bots/${bobBot.id}/plugins`, uma)).body.canChange).toBe(true);
    const market = await api("POST", `/api/bots/${bobBot.id}/plugins/marketplaces`, uma, { source: "acme/uma-tools" });
    expect(market.status, market.text).toBe(201);
    const installed = await api("POST", `/api/bots/${bobBot.id}/plugins/install`, uma, { marketplace: "uma-tools", plugin: "reviewer" });
    expect(installed.status, installed.text).toBe(201);
    const text = "---\nname: triage\ndescription: Triage issues\n---\nTriage.";
    const skill = await api("POST", `/api/bots/${bobBot.id}/skill-template`, uma, { name: "triage", description: "Triage issues", text, source: "template", enabled: true });
    expect(skill.status, skill.text).toBe(201);
    expect((await api("PATCH", `/api/bots/${bobBot.id}/skills/triage`, uma, { enabled: false })).status).toBe(200);
    expect((await api("DELETE", `/api/bots/${bobBot.id}/skills/triage`, uma)).status).toBe(200);
    expect((await api("PUT", `/api/bots/${bobBot.id}/grants`, bob, { target: `user:${ids.uma}`, level: "use" })).status).toBe(200);
  }, 120_000);

  // 2026-10-26 (owner, no admin gating): a person's own plugins, skills, MCP
  // servers and GitHub account work in their own environment. The Perspicax
  // person sheet's `sagax_integrations` is no longer read (removed
  // 2026-10-30; an older Perspicax may still send it): she keeps managing
  // everything, and what she saved stays usable.
  it("OC-8: sagax_integrations off changes nothing: she still manages her own connections, and they stay usable", async () => {
    const ritaBot = await createBot(rita, "Rita's");
    const own = await api("POST", "/api/me/mcp/servers", rita, { name: "ritas", url: `${oauth.base}/rita-mcp`, auth: "token", token: "t-rita-000" });
    expect(own.status, own.text).toBe(201);
    const text = "---\nname: notes\ndescription: Take notes\n---\nTake notes.";
    expect((await api("POST", `/api/bots/${ritaBot.id}/skill-template`, rita, { name: "notes", description: "Take notes", text, source: "template", enabled: true })).status).toBe(201);
    expect((await api("POST", `/api/bots/${ritaBot.id}/plugins/marketplaces`, rita, { source: "acme/rita-tools" })).status).toBe(201);
    expect((await api("POST", `/api/bots/${ritaBot.id}/plugins/install`, rita, { marketplace: "rita-tools", plugin: "reviewer" })).status).toBe(201);
    await turn(rita, ritaBot, "before");
    const before = JSON.parse(readFileSync(engineDump, "utf8")) as { argv: string[]; mcpConfig: { mcpServers: Record<string, { headers?: Record<string, string>; env?: Record<string, string> }> } };
    expect(remoteAuthorization(before.mcpConfig.mcpServers.ritas)).toBe("Bearer t-rita-000");
    expect(before.argv).toContain("--plugin-dir");

    // an admin turns it off in Perspicax; the directory brings it here
    idp.directoryPeople = idp.directoryPeople.map((person) => (person.sub === RITA.sub ? { ...person, sagax_integrations: "off" as const } : person));
    // the directory is read again (a few seconds): the field is ignored, so
    // nothing visible changes; wait for a sync before asserting
    await sleep(6_000);
    const config = await api("GET", "/api/config", rita);
    expect(config.body.viewer.integrationsManagedByAdmin).toBeUndefined();
    const listed = await api("GET", "/api/me/connections", rita);
    expect(listed.status).toBe(200);
    expect(listed.body.managedByAdmin).toBeUndefined();
    expect(listed.body.servers.map((server: { name: string }) => server.name)).toEqual(["ritas"]);
    expect(await api("GET", `/api/bots/${ritaBot.id}/plugins`, rita).then((res) => res.body)).toMatchObject({ canChange: true });
    expect((await api("PATCH", "/api/me/mcp/servers/ritas", rita, { enabled: true })).status).toBe(200);
    const more = "---\nname: more\ndescription: More\n---\nMore.";
    expect((await api("POST", `/api/bots/${ritaBot.id}/skill-template`, rita, { name: "more", description: "More", text: more, source: "template", enabled: true })).status).toBe(201);
    expect((await api("DELETE", `/api/bots/${ritaBot.id}/skills/more`, rita)).status).toBe(200);
    // what she saved stays usable: her server is mounted and her plugin loaded
    await turn(rita, ritaBot, "after");
    const after = JSON.parse(readFileSync(engineDump, "utf8")) as { argv: string[]; mcpConfig: { mcpServers: Record<string, { headers?: Record<string, string>; env?: Record<string, string> }> } };
    expect(remoteAuthorization(after.mcpConfig.mcpServers.ritas)).toBe("Bearer t-rita-000");
    expect(after.argv).toContain("--plugin-dir");
    expect((await api("DELETE", "/api/me/mcp/servers/ritas", rita)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${ritaBot.id}/plugins/reviewer@rita-tools`, rita, { enabled: false })).status).toBe(200);
  }, 180_000);

  it("OC-9: an admin lists and revokes a person's connections; a member cannot; nothing secret is returned", async () => {
    const connections = `/api/org/people/${ids.bob}/connections`;
    const listed = await api("GET", connections, alice);
    expect(listed.status, listed.text).toBe(200);
    // GitHub is the login (the display name is separate). A plugin is its key
    // (`reviewer@acme-tools`), not the plugin's own name.
    const labels = (listed.body.connections as Array<{ kind: string; name?: string; login?: string; key?: string }>).map((entry) =>
      entry.kind === "github" ? entry.login : entry.kind === "plugin" ? entry.key : entry.name);
    for (const name of ["bob-gh", "github", "notes", "mytools", "reviewer@acme-tools"]) expect(labels, listed.text).toContain(name);
    for (const secret of [GITHUB_TOKEN, "k-123", "WDJB-MJHT", "t-uma-000"]) expect(listed.text).not.toContain(secret);
    expect((await api("GET", connections, rita)).status).toBe(403);
    expect((await api("POST", `${connections}/revoke`, bob, { all: true })).status).toBe(403);
    const open = await fetch(`${BASE}${connections}`);
    expect(open.status).toBe(403);

    const one = await api("POST", `${connections}/revoke`, alice, { kind: "mcp", name: "mytools" });
    expect(one.status, one.text).toBe(200);
    expect(one.text).not.toContain("k-123");
    const afterOne = await turn(bob, bobBot, "use my tools");
    expect(afterOne).toContain("mcp:absent");
    const engine = JSON.parse(readFileSync(engineDump, "utf8")) as { mcpConfig: { mcpServers: Record<string, unknown> } };
    expect(engine.mcpConfig.mcpServers.mytools).toBeUndefined();
    expect(engine.mcpConfig.mcpServers.notes).toBeTruthy();

    const all = await api("POST", `${connections}/revoke`, alice, { all: true });
    expect(all.status, all.text).toBe(200);
    expect(all.text).not.toContain(GITHUB_TOKEN);
    const cleared = await api("GET", connections, alice);
    expect(cleared.body.connections).toEqual([]);
    await turn(bob, bobBot, "again");
    const gone = JSON.parse(readFileSync(engineDump, "utf8")) as { argv: string[]; mcpConfig: { mcpServers: Record<string, unknown> } };
    for (const name of ["github", "notes", "mytools"]) expect(gone.mcpConfig.mcpServers[name]).toBeUndefined();
    expect(JSON.stringify(gone)).not.toContain(GITHUB_TOKEN);
    expect(gone.argv ?? []).not.toContain("--plugin-dir");
    const mine = await api("GET", "/api/me/connections", bob);
    expect(mine.body.servers).toEqual([]);
    expect(mine.body.github.state).toBe("none");

    const activity = await waitFor(async () => {
      const rows = (await api("GET", "/api/admin-activity?what=people", alice)).body.entries as Array<{ action: string }> | undefined;
      return rows?.some((entry) => entry.action === "connections.revoke") ? rows : null;
    });
    const text = JSON.stringify(activity);
    expect(text).toContain("connections.revoke");
    expect(text).not.toContain(GITHUB_TOKEN);
    expect(text).not.toContain("k-123");
  }, 180_000);
});
