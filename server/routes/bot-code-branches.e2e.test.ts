// The bot panel's Coding branches, acted on through the route table with
// real git on a temporary repository and a bare local remote: read the
// branch, commit its changes, push it, read its diff, archive and bring it
// back, and delete: refused while its work is not pushed (until confirmed
// twice) and while it is checked out. A thread the person may not post in,
// or a branch the thread never worked on, reads exactly like not there; on
// an organization server, push needs the person's own GitHub connection,
// a request with no person is refused and no answer carries a server path.
// The default branch (origin's HEAD, or main/master/trunk/develop) is never
// pushed, deleted or proposed; the person's token rides the push only.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../request-auth.ts";
import { repositoryInfo } from "../activity-code-work.ts";
import { BranchArchive, BranchPulls, hostGit, parseStatus, proposedMessage, redactPaths, validBranchName, type GitExec } from "../code-branches.ts";
import type { BotBranchInfo } from "../../shared/bot-code-branches.ts";
import { createBotCodeBranchRoutes, type BotCodeBranchRouteDeps, type BranchCredentials, type RemoteBranchDeps, type RemoteBranchReach } from "./bot-code-branches.ts";
import type { RemoteExec } from "../remote-code-branches.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = 1_800_000_000_000;
let dir = "";
let repo = "";
let remote = "";
let worktree = "";
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
}).trim();

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-branches-")));
  // The person's own git config is not read by the test's git calls.
  const config = join(dir, "gitconfig");
  writeFileSync(config, "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
  process.env.GIT_CONFIG_GLOBAL = config;
  remote = join(dir, "remote.git");
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  const seed = join(dir, "seed");
  git(dir, "clone", remote, seed);
  writeFileSync(join(seed, "README.md"), "hello\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "first");
  git(seed, "push", "origin", "main");
  repo = join(dir, "repo");
  git(dir, "clone", remote, repo);
  // The bot's work: a worktree on feat/widgets with a change not committed,
  // and feat/local, one commit, not pushed, checked out nowhere.
  worktree = join(dir, "wt");
  git(repo, "worktree", "add", "-b", "feat/widgets", worktree);
  writeFileSync(join(worktree, "widget.ts"), "export const widget = 1;\n");
  const other = join(dir, "wt2");
  git(repo, "worktree", "add", "-b", "feat/local", other);
  writeFileSync(join(other, "local.ts"), "export const local = 1;\n");
  git(other, "add", ".");
  git(other, "commit", "-m", "local work");
  git(repo, "worktree", "remove", other);
});

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const bash = (command: string, at: number) => ({ at, tool: { name: "Bash", ok: true, input: { command }, output: "" } });

function deps(overrides: Partial<BotCodeBranchRouteDeps> = {}): BotCodeBranchRouteDeps & { audits: string[] } {
  const audits: string[] = [];
  return {
    audits,
    bot: (id) => (id === "pepper" ? { id, name: "Pepper" } : null),
    tasks: () => [{ threadId: "t1", title: "Add IT tools widgets", cwd: repo }, { threadId: "t-bob", title: "Bob", cwd: repo }],
    viewerId: () => undefined,
    threadWritable: (_bot, threadId) => threadId === "t1",
    messages: () => ({ messages: [bash("git worktree add -b feat/widgets ../wt", NOW - 60_000), bash("git worktree add -b feat/local ../wt2", NOW - 50_000)] }),
    repository: (cwd) => repositoryInfo(cwd, Date.now() + Math.random()),
    organization: () => false,
    credentials: (): BranchCredentials => ({ git: {}, publish: { push: {}, gh: {} } }),
    archive: new BranchArchive(join(dir, `archive-${Math.random()}.json`)),
    audit: (_auth, action) => { audits.push(action); },
    exec: hostGit,
    ...overrides,
  };
}

async function serve(routeDeps: BotCodeBranchRouteDeps) {
  const route = createBotCodeBranchRoutes(routeDeps);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    void dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "session", scopes: ["client"] } as never, json, readBody })
      .then((answered) => { if (!answered) json(res, 404, { error: "unrouted" }); });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get: async (path: string) => {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, body: await res.json() as Record<string, any> };
    },
    post: async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() as Record<string, any> };
    },
  };
}

const q = (branch: string, threadId = "t1") => `threadId=${threadId}&branch=${encodeURIComponent(branch)}`;

describe("Coding branches: acted on where the repository is", () => {
  it("reads the branch now: where, what is not committed, the proposed message", async () => {
    const api = await serve(deps());
    const { status, body } = await api.get(`/api/bots/pepper/code/branch?${q("feat/widgets")}`);
    expect(status).toBe(200);
    const info = body as BotBranchInfo;
    expect(info.place).toBe("server");
    expect(info.folderName).toBe("repo");
    expect(info.canPublish).toBe(true);
    expect(info.state).toMatchObject({ exists: true, pushed: false, ahead: 0, base: "main", isDefault: false });
    expect(info.state!.worktree).toBe(worktree);
    expect(info.state!.changes).toEqual([{ path: "widget.ts", status: "untracked" }]);
    expect(info.proposedMessage).toBe("Add IT tools widgets");
  });

  it("commits the changes with the message, then pushes to the bare remote", async () => {
    // The token stands in as SAGAX_TEST_TOKEN: only the push (and the
    // remote HEAD read with it) may carry it.
    const calls: Array<{ args: string[]; token: boolean }> = [];
    const exec: GitExec = (program, args, options) => {
      calls.push({ args, token: options.env?.SAGAX_TEST_TOKEN === "1" });
      return hostGit(program, args, options);
    };
    const routeDeps = deps({ exec, credentials: () => ({ git: {}, publish: { push: { SAGAX_TEST_TOKEN: "1" }, gh: {} } }) });
    const api = await serve(routeDeps);
    const empty = await api.post("/api/bots/pepper/code/branch/commit", { threadId: "t1", branch: "feat/widgets", message: "  " });
    expect(empty.status).toBe(400);
    const commit = await api.post("/api/bots/pepper/code/branch/commit", { threadId: "t1", branch: "feat/widgets", message: "Add the widget" });
    expect(commit.status).toBe(200);
    expect(commit.body.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commit.body.state).toMatchObject({ ahead: 1, pushed: false, changes: [] });
    expect(git(worktree, "log", "-1", "--format=%s")).toBe("Add the widget");

    const diff = await api.get(`/api/bots/pepper/code/branch/diff?${q("feat/widgets")}`);
    expect(diff.status).toBe(200);
    expect(diff.body.base).toBe("main");
    expect(diff.body.files.map((file: { path: string }) => file.path)).toEqual(["widget.ts"]);

    const push = await api.post("/api/bots/pepper/code/branch/push", { threadId: "t1", branch: "feat/widgets" });
    expect(push.status).toBe(200);
    expect(push.body.state).toMatchObject({ pushed: true, ahead: 0 });
    expect(git(remote, "rev-parse", "refs/heads/feat/widgets")).toBe(commit.body.sha);
    expect(routeDeps.audits).toEqual(["code.branch.commit", "code.branch.push"]);
    const withToken = calls.filter((call) => call.token).map((call) => call.args.find((arg) => arg === "push" || arg === "ls-remote") ?? call.args.join(" "));
    expect(withToken.sort()).toEqual(["ls-remote", "push"]);
  });

  it("never pushes or deletes the default branch: origin's HEAD, or a protected name when origin has no HEAD", async () => {
    git(repo, "branch", "develop", "main");
    const api = await serve(deps({ messages: () => ({ messages: [bash("git checkout -B main", NOW - 60_000), bash("git checkout -b develop", NOW - 50_000)] }) }));
    expect((await api.get(`/api/bots/pepper/code/branch?${q("main")}`)).body.state).toMatchObject({ isDefault: true });
    expect((await api.post("/api/bots/pepper/code/branch/push", { threadId: "t1", branch: "main" })).body.code).toBe("default_branch");
    expect((await api.post("/api/bots/pepper/code/branch/delete", { threadId: "t1", branch: "main", confirmUnpushed: true })).body.code).toBe("default_branch");
    git(repo, "remote", "set-head", "origin", "--delete");
    try {
      expect((await api.get(`/api/bots/pepper/code/branch?${q("develop")}`)).body.state).toMatchObject({ isDefault: true });
      expect((await api.post("/api/bots/pepper/code/branch/push", { threadId: "t1", branch: "develop" })).body.code).toBe("default_branch");
    } finally {
      git(repo, "remote", "set-head", "origin", "main");
    }
    expect(git(remote, "branch", "--list", "develop")).toBe("");
  });

  it("never deletes a checked-out branch, and asks twice before deleting work that is not pushed", async () => {
    const api = await serve(deps());
    const checkedOut = await api.post("/api/bots/pepper/code/branch/delete", { threadId: "t1", branch: "feat/widgets", confirmUnpushed: true });
    expect(checkedOut.status).toBe(409);
    expect(checkedOut.body.code).toBe("checked_out");
    expect(existsSync(worktree)).toBe(true);

    const refused = await api.post("/api/bots/pepper/code/branch/delete", { threadId: "t1", branch: "feat/local" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("unpushed");
    expect(git(repo, "branch", "--list", "feat/local")).toContain("feat/local");

    const confirmed = await api.post("/api/bots/pepper/code/branch/delete", { threadId: "t1", branch: "feat/local", confirmUnpushed: true });
    expect(confirmed.status).toBe(200);
    expect(git(repo, "branch", "--list", "feat/local")).toBe("");
    const gone = await api.get(`/api/bots/pepper/code/branch?${q("feat/local")}`);
    expect(gone.body.state).toMatchObject({ exists: false });
  });

  it("archives a branch in the person's own list and brings it back; the branch stays", async () => {
    const api = await serve(deps());
    const key = "repo:feat/widgets";
    expect((await api.post("/api/bots/pepper/code/branches/archived", { key, archived: true })).body.keys).toEqual([key]);
    expect((await api.get("/api/bots/pepper/code/branches/archived")).body.keys).toEqual([key]);
    expect(git(repo, "branch", "--list", "feat/widgets")).toContain("feat/widgets");
    expect((await api.post("/api/bots/pepper/code/branches/archived", { key, archived: false })).body.keys).toEqual([]);
  });

  it("reads another person's thread, or a branch the thread never touched, like nothing", async () => {
    const api = await serve(deps());
    expect((await api.get(`/api/bots/pepper/code/branch?${q("feat/widgets", "t-bob")}`)).status).toBe(404);
    expect((await api.post("/api/bots/pepper/code/branch/push", { threadId: "t-bob", branch: "feat/widgets" })).status).toBe(404);
    expect((await api.get(`/api/bots/pepper/code/branch?${q("feat/unknown")}`)).status).toBe(404);
    // the folder's checked-out branch is not the thread's just because it is there
    expect((await api.get(`/api/bots/pepper/code/branch?${q("main")}`)).status).toBe(404);
    expect((await api.get(`/api/bots/pepper/code/branch?${q("--upload-pack=x")}`)).status).toBe(400);
    expect((await api.get(`/api/bots/nobody/code/branch?${q("feat/widgets")}`)).status).toBe(404);
  });

  it("on an organization server, pushes and opens pull requests only with the person's own GitHub", async () => {
    const api = await serve(deps({ organization: () => true, viewerId: () => "alice", credentials: () => ({ isolated: true, git: {}, author: { name: "Alice", email: "alice@example.com" } }) }));
    const info = await api.get(`/api/bots/pepper/code/branch?${q("feat/widgets")}`);
    expect(info.body).toMatchObject({ canPublish: false, publishBlocked: "github_not_connected" });
    // a server path means nothing to the person: its folder's name only
    expect(info.body.state.worktree).toBe("wt");
    const push = await api.post("/api/bots/pepper/code/branch/push", { threadId: "t1", branch: "feat/widgets" });
    expect(push.status).toBe(403);
    expect(push.body.code).toBe("github_not_connected");
    const pr = await api.post("/api/bots/pepper/code/branch/pr", { threadId: "t1", branch: "feat/widgets" });
    expect(pr.status).toBe(409);
    expect(pr.body.code).toBe("not_github");
  });

  it("on an organization server, refuses a request with no person and answers without server paths", async () => {
    const anonymous = await serve(deps({ organization: () => true, viewerId: () => undefined }));
    expect((await anonymous.get(`/api/bots/pepper/code/branch?${q("feat/widgets")}`)).body.code).toBe("no_person");
    expect((await anonymous.post("/api/bots/pepper/code/branch/push", { threadId: "t1", branch: "feat/widgets" })).status).toBe(403);
    expect((await anonymous.get("/api/bots/pepper/code/branches/archived")).status).toBe(403);

    const nameless = await serve(deps({ organization: () => true, viewerId: () => "alice", credentials: () => ({ isolated: true, git: {} }) }));
    expect((await nameless.post("/api/bots/pepper/code/branch/commit", { threadId: "t1", branch: "feat/widgets", message: "x" })).body.code).toBe("no_author");

    const api = await serve(deps({ organization: () => true, viewerId: () => "alice", credentials: () => ({ isolated: true, git: {}, author: { name: "Alice", email: "alice@example.com" } }) }));
    writeFileSync(join(worktree, "more.ts"), "export const more = 1;\n");
    const commit = await api.post("/api/bots/pepper/code/branch/commit", { threadId: "t1", branch: "feat/widgets", message: "More" });
    expect(commit.status).toBe(200);
    expect(commit.body.state.worktree).toBe("wt");
    expect(git(worktree, "log", "-1", "--format=%an <%ae>")).toBe("Alice <alice@example.com>");
    const removed = await api.post("/api/bots/pepper/code/branch/delete", { threadId: "t1", branch: "feat/widgets" });
    expect(removed.body.code).toBe("checked_out");
    expect(JSON.stringify([commit.body, removed.body])).not.toContain(dir);

    // local config the bot could have written (a clean filter runs at add/status): refused
    git(repo, "config", "filter.x.clean", "touch /nonexistent-sentinel");
    try {
      const read = await api.get(`/api/bots/pepper/code/branch?${q("feat/widgets")}`);
      expect(read.body.code).toBe("unsafe_config");
      expect(JSON.stringify(read.body)).not.toContain(dir);
    } finally {
      git(repo, "config", "--unset", "filter.x.clean");
    }
  });

  it("never runs a signing program the repository names, even on a solo server", async () => {
    const sentinel = join(dir, "gpg-ran");
    const program = join(dir, "fake-gpg.sh");
    writeFileSync(program, `#!/bin/sh\ntouch ${sentinel}\nexit 1\n`, { mode: 0o755 });
    git(worktree, "config", "commit.gpgSign", "true");
    git(worktree, "config", "gpg.program", program);
    try {
      writeFileSync(join(worktree, "signed.ts"), "export const signed = 1;\n");
      const api = await serve(deps());
      const commit = await api.post("/api/bots/pepper/code/branch/commit", { threadId: "t1", branch: "feat/widgets", message: "Signed?" });
      expect(commit.status).toBe(200);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      git(worktree, "config", "--unset", "commit.gpgSign");
      git(worktree, "config", "--unset", "gpg.program");
    }
  });

  it("says a branch whose repository is elsewhere has no actions here", async () => {
    const api = await serve(deps({ tasks: () => [{ threadId: "t1", title: "x", cwd: join(dir, "not-a-repo") }] }));
    mkdirSync(join(dir, "not-a-repo"), { recursive: true });
    const info = await api.get(`/api/bots/pepper/code/branch?${q("feat/widgets")}`);
    expect(info.body).toMatchObject({ place: "elsewhere", canPublish: false });
    const push = await api.post("/api/bots/pepper/code/branch/push", { threadId: "t1", branch: "feat/widgets" });
    expect(push.status).toBe(409);
    expect(push.body.code).toBe("elsewhere");
  });

  it("is a client route (a member's own session reaches it)", () => {
    expect(requiredScope("POST", "/api/bots/pepper/code/branch/push")).toBe("client");
    expect(requiredScope("GET", "/api/bots/pepper/code/branch")).toBe("client");
    expect(requiredScope("POST", "/api/bots/pepper/code/branches/archived")).toBe("client");
  });
});

describe("Coding branches: on the bot's own computer", () => {
  let botRepo = "";
  beforeEach(() => {
    const tag = Math.random().toString(36).slice(2);
    const botRemote = join(dir, `bot-remote-${tag}.git`);
    git(dir, "init", "--bare", "--initial-branch=main", botRemote);
    const seed = join(dir, `bot-seed-${tag}`);
    git(dir, "clone", botRemote, seed);
    writeFileSync(join(seed, "README.md"), "hi\n");
    git(seed, "add", "."); git(seed, "commit", "-m", "first"); git(seed, "push", "origin", "main");
    botRepo = join(dir, `bot-wt-${tag}`);
    git(dir, "clone", botRemote, botRepo);
    git(botRepo, "checkout", "-b", "feat/on-bot");
    writeFileSync(join(botRepo, "x.ts"), "export const x = 1;\n");
  });

  // The "bot's computer" is the local shell; the repository is a folder the
  // server does not see as a git repository (deps.repository -> undefined).
  const shellExec: RemoteExec = async (command) => {
    const { execFileSync } = await import("node:child_process");
    try {
      const stdout = execFileSync("/bin/sh", ["-c", command], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Bot", GIT_AUTHOR_EMAIL: "bot@example.com", GIT_COMMITTER_NAME: "Bot", GIT_COMMITTER_EMAIL: "bot@example.com" } });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (error) {
      const fail = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { exitCode: typeof fail.status === "number" ? fail.status : 1, stdout: String(fail.stdout ?? ""), stderr: String(fail.stderr ?? "") };
    }
  };

  const remoteDeps = (reach: RemoteBranchReach | null, calls?: Array<{ botId: string; threadId: string }>): RemoteBranchDeps => ({
    reach: () => reach,
    exec: (botId, threadId) => { calls?.push({ botId, threadId }); return shellExec; },
  });

  const remoteOverrides = (reach: RemoteBranchReach | null, calls?: Array<{ botId: string; threadId: string }>): Partial<BotCodeBranchRouteDeps> => ({
    tasks: () => [{ threadId: "t-remote", title: "On the bot", cwd: botRepo }],
    threadWritable: (_bot, threadId) => threadId === "t-remote",
    messages: () => ({ messages: [bash("git checkout -b feat/on-bot", NOW - 60_000)] }),
    repository: () => undefined,
    remote: remoteDeps(reach, calls),
  });

  const online: RemoteBranchReach = { computer: true, online: true, host: "Studio de Max", osKnown: true };
  const qr = (branch = "feat/on-bot") => q(branch, "t-remote");

  it("reads the branch on the bot's computer and offers its actions", async () => {
    const api = await serve(deps(remoteOverrides(online)));
    const { status, body } = await api.get(`/api/bots/pepper/code/branch?${qr()}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ place: "remote", host: "Studio de Max", canPublish: true });
    expect(body.state).toMatchObject({ exists: true, pushed: false, base: "main", isDefault: false });
    expect(body.state.worktree).toBe(botRepo);
    expect(body.state.changes).toEqual([{ path: "x.ts", status: "untracked" }]);
  });

  it("runs commit, diff (no card) and push on the bot's computer, and audits it there", async () => {
    const calls: Array<{ botId: string; threadId: string }> = [];
    const api = await serve(deps(remoteOverrides(online, calls)));
    const commit = await api.post("/api/bots/pepper/code/branch/commit", { threadId: "t-remote", branch: "feat/on-bot", message: "On the bot" });
    expect(commit.status).toBe(200);
    expect(commit.body.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(botRepo, "log", "-1", "--format=%s")).toBe("On the bot");
    const diff = await api.get(`/api/bots/pepper/code/branch/diff?${qr()}`);
    expect(diff.status).toBe(200);
    expect(diff.body.files.map((file: { path: string }) => file.path)).toEqual(["x.ts"]);
    const push = await api.post("/api/bots/pepper/code/branch/push", { threadId: "t-remote", branch: "feat/on-bot" });
    expect(push.status).toBe(200);
    expect(push.body.state).toMatchObject({ pushed: true, ahead: 0 });
    // every command ran against this bot's own conversation, never another's
    expect(calls.every((call) => call.botId === "pepper" && call.threadId === "t-remote")).toBe(true);
  });

  it("says offline, unknown folder and unknown OS plainly, not five disabled rows", async () => {
    const offline = await serve(deps(remoteOverrides({ computer: true, online: false, host: "Studio de Max", osKnown: true })));
    const offInfo = await offline.get(`/api/bots/pepper/code/branch?${qr()}`);
    expect(offInfo.body).toMatchObject({ place: "remote", offline: true, host: "Studio de Max", canPublish: false, publishBlocked: "offline" });
    expect((await offline.post("/api/bots/pepper/code/branch/push", { threadId: "t-remote", branch: "feat/on-bot" })).body.code).toBe("offline");

    const noPath = await serve(deps({ ...remoteOverrides(online), tasks: () => [{ threadId: "t-remote", title: "On the bot", cwd: null }] }));
    expect((await noPath.get(`/api/bots/pepper/code/branch?${qr()}`)).body).toMatchObject({ place: "remote", noPath: true, canPublish: false });

    const windows = await serve(deps(remoteOverrides({ computer: true, online: true, host: "PC", osKnown: true, windows: true })));
    expect((await windows.get(`/api/bots/pepper/code/branch?${qr()}`)).body).toMatchObject({ place: "remote", publishBlocked: "unknown_os", canPublish: false });
  });

  it("stays 'elsewhere' when the bot has no computer at all", async () => {
    const api = await serve(deps({ ...remoteOverrides(null), remote: remoteDeps(null) }));
    const info = await api.get(`/api/bots/pepper/code/branch?${qr()}`);
    expect(info.body).toMatchObject({ place: "elsewhere", canPublish: false, publishBlocked: "elsewhere" });
    expect((await api.post("/api/bots/pepper/code/branch/push", { threadId: "t-remote", branch: "feat/on-bot" })).body.code).toBe("elsewhere");
  });
});

describe("Coding branches: the pieces", () => {
  it("accepts branch names git accepts and nothing that reads as an option", () => {
    for (const name of ["feat/it-tools-widgets", "px/run-1", "fix_2"]) expect(validBranchName(name)).toBe(true);
    for (const name of ["", "-x", "--upload-pack=sh", "HEAD", "a..b", "a b", "a~1", "a:b", "/a", "a/", "a.lock", "a/.b", "a@{1}"]) expect(validBranchName(name)).toBe(false);
  });

  it("says a server path by its last folder only, and leaves URLs alone", () => {
    expect(redactPaths("This branch is checked out in /srv/sagax/data/repos/acme/wt. Remove it.")).toBe("This branch is checked out in wt. Remove it.");
    expect(redactPaths("fatal: '/srv/x/repo/.git/index.lock': File exists")).toBe("fatal: 'index.lock': File exists");
    expect(redactPaths("see https://github.com/o/r/pull/7")).toBe("see https://github.com/o/r/pull/7");
  });

  it("reads git status and proposes a message from the thread, else the files", () => {
    expect(parseStatus(" M src/a.ts\0?? new.ts\0D  gone.ts\0R  b.ts\0a.ts\0")).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "new.ts", status: "untracked" },
      { path: "gone.ts", status: "deleted" },
      { path: "b.ts", status: "renamed", from: "a.ts" },
    ]);
    expect(proposedMessage([], "  Fix   the parser ")).toBe("Fix the parser");
    expect(proposedMessage([{ path: "src/a.ts", status: "modified" }, { path: "b.ts", status: "added" }, { path: "c.ts", status: "added" }])).toBe("Update a.ts, b.ts and 1 more");
  });

  it("finds and opens pull requests through gh with the person's token, scoped to the repository", async () => {
    const calls: Array<{ args: string[]; env?: Record<string, string> }> = [];
    let created = false;
    const exec: GitExec = async (program, args, options) => {
      calls.push({ args: [program, ...args], env: options.env });
      if (args[0] === "api") return { code: 0, stdout: "main\n", stderr: "" };
      if (args[1] === "list") return { code: 0, stdout: created ? JSON.stringify([{ number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN" }]) : "[]", stderr: "" };
      created = true;
      return { code: 0, stdout: "https://github.com/o/r/pull/7\n", stderr: "" };
    };
    const pulls = new BranchPulls(exec, "/tmp", "o/r", { GH_TOKEN: "tok" });
    expect(await pulls.find("feat/x")).toBeUndefined();
    expect(await pulls.open("feat/x", ["Add x"], "Thread title")).toEqual({ number: 7, url: "https://github.com/o/r/pull/7", state: "open" });
    expect(await pulls.open("feat/x", ["Add x"], "Thread title")).toMatchObject({ number: 7, state: "open" });
    const create = calls.filter((call) => call.args[2] === "create");
    expect(create).toHaveLength(1);
    expect(create[0]!.args).toEqual(expect.arrayContaining(["--head=feat/x", "--base=main", "--title=Add x"]));
    expect(calls.filter((call) => call.args[1] !== "api").every((call) => call.args.includes("--repo") && call.args.includes("o/r"))).toBe(true);
    expect(calls.every((call) => call.env?.GH_TOKEN === "tok")).toBe(true);
    // GitHub's own default branch is never proposed, whatever the local refs say
    await expect(pulls.open("main", [], "x")).rejects.toMatchObject({ code: "default_branch" });
  });
});
