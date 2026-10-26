// sagax-runner against a local fake of Perspicax (server/testing/
// fake-perspicax-runner.ts) and a fake engine adapter: the whole cycle of the
// contract runner <-> Perspicax, with no network beyond loopback and no real
// engine. The git endpoint is real smart HTTP over a local bare repository.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RuntimeEvent, SendTurnInput } from "../contracts.ts";
import { FakePerspicax } from "../testing/fake-perspicax-runner.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { EngineFactoryInput, RunnerAdapter, RunnerEngineHandle } from "./engine.ts";
import { bundleHeads, gitEnv, NO_PUSH_URL } from "./git.ts";
import { MASK } from "./mask.ts";
import { ControlClient, controlBase } from "./protocol.ts";
import { runRunner, type RunnerResult } from "./runner.ts";

const TOKEN = "runtok_" + "A".repeat(20) + "Zq9_xY-kLmN0pQrStUv";
const SETUP_SECRET = "setup-only-value-9f8e7d";
const AGENT_SECRET = "agent-visible-value-1a2b3c";
const BRANCH = "px/fix-widgets-ab12";

type TurnScript = (turn: SendTurnInput, engine: FakeEngine) => Promise<void> | void;

/** A provider adapter the test scripts turn by turn. */
class FakeEngine implements RunnerAdapter {
  readonly turns: SendTurnInput[] = [];
  readonly responses: Array<{ requestId: string; decision: unknown }> = [];
  readonly steered: string[] = [];
  readonly interrupts: number[] = [];
  input: EngineFactoryInput | null = null;
  disposed = false;
  private listeners = new Set<(event: RuntimeEvent) => void>();
  private answers = new Map<string, (decision: unknown) => void>();
  private releaseHang: (() => void) | null = null;
  private turnCount = 0;
  scripts: TurnScript[] = [];

  emit(event: Record<string, unknown>): void {
    const full = { eventId: `ev-${Math.random()}`, provider: "fake", threadId: this.turns.at(-1)?.threadId ?? "", createdAt: new Date().toISOString(), ...event } as RuntimeEvent;
    for (const listener of this.listeners) listener(full);
  }

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendTurn(turn: SendTurnInput) {
    this.turns.push(turn);
    const turnId = `turn-${++this.turnCount}`;
    const script = this.scripts.shift() ?? (() => undefined);
    setTimeout(() => {
      void (async () => {
        this.emit({ type: "turn.started", turnId });
        await script(turn, this);
        this.emit({ type: "turn.completed", turnId, ok: true });
      })();
    }, 5);
    return { turnId };
  }

  waitAnswer(requestId: string): Promise<unknown> {
    return new Promise((resolve) => this.answers.set(requestId, resolve));
  }

  hang(): Promise<void> {
    return new Promise((resolve) => { this.releaseHang = resolve; });
  }

  async interruptTurn() {
    this.interrupts.push(Date.now());
    this.releaseHang?.();
  }

  async respondToRequest(_threadId: string, requestId: string, decision: unknown) {
    this.responses.push({ requestId, decision });
    this.answers.get(requestId)?.(decision);
    return "allowed-once" as const;
  }

  async steer(_threadId: string, text: string) {
    this.steered.push(text);
    return "steered" as const;
  }

  async stopAll() {}
}

let root: string;
let bare: string;
let fake: FakePerspicax;
let engine: FakeEngine;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
}

function bootstrapFor(overrides: Record<string, unknown> = {}) {
  return (base: string) => ({
    run_id: "run0001abcd",
    env_id: "env0001abcd",
    title: "Fix the widgets",
    prompt: "Add hello.txt",
    engine: "claude-code",
    model: "claude-test",
    effort: null,
    repo: { owner: "acme", name: "widgets" },
    base_branch: "main",
    branch: BRANCH,
    existing_branch: false,
    setup: 'echo "setup has $SETUP_TOKEN" && test -f "$PX_SECRETS_DIR/SETUP_TOKEN" && echo setup-file-ok',
    verify: ["test -f hello.txt", 'echo "verify sees $AGENT_TOKEN"'],
    git_url: `${base}/api/v1/agents/runner/git/acme/widgets.git`,
    model_proxy: { anthropic: `${base}/api/v1/agents/model-proxy/anthropic`, openai: `${base}/api/v1/agents/model-proxy/openai` },
    followup: null,
    resume: null,
    limits: { max_duration_sec: 3600 },
    ...overrides,
  });
}

async function setup(overrides: Record<string, unknown> = {}): Promise<void> {
  fake = new FakePerspicax({
    token: TOKEN,
    bareRepo: bare,
    bootstrap: bootstrapFor(overrides),
    secrets: [
      { name: "SETUP_TOKEN", value: SETUP_SECRET, setup_only: true },
      { name: "AGENT_TOKEN", value: AGENT_SECRET, setup_only: false },
    ],
  });
  await fake.start();
}

function start(): { result: Promise<RunnerResult>; dirs: { workspace: string; secrets: string } } {
  const workspace = join(root, "workspace");
  const secrets = join(root, "shm", "px-secrets");
  mkdirSync(workspace, { recursive: true });
  const factory = async (input: EngineFactoryInput): Promise<RunnerEngineHandle> => {
    engine.input = input;
    return {
      adapter: engine,
      turnDefaults: { cwd: input.cwd, model: input.model ?? undefined, approvalMode: "auto" },
      dispose: async () => { engine.disposed = true; },
    };
  };
  const result = runRunner({
    client: new ControlClient({ base: controlBase(fake.base), token: TOKEN, timeoutMs: 10_000 }),
    token: TOKEN,
    engineFactory: factory,
    workspace,
    secretsDir: secrets,
    stateDir: join(root, "state"),
    env: { PATH: process.env.PATH, HOME: workspace, LANG: "C.UTF-8" },
    pollWaitSec: 1,
    relayFlushDelayMs: 10,
    log: () => undefined,
  });
  return { result, dirs: { workspace, secrets } };
}

const writeHello: TurnScript = (turn, eng) => {
  const cwd = turn.cwd!;
  eng.emit({ type: "session.started", sessionId: "sess-1" });
  eng.emit({ type: "item.started", itemType: "tool", itemId: "t1", title: "Bash", summary: "cat $PX_SECRETS_DIR/AGENT_TOKEN" });
  writeFileSync(join(cwd, "hello.txt"), "hello\n");
  eng.emit({ type: "item.completed", itemType: "tool", itemId: "t1", ok: true, output: `${AGENT_SECRET}\nkey=${TOKEN}` });
  eng.emit({ type: "item.completed", itemType: "assistant_text", text: `Done. The secret was ${AGENT_SECRET}.` });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sagax-runner-"));
  bare = join(root, "origin.git");
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(root, "init", "--quiet", "--bare", "-b", "main", bare);
  git(seed, "init", "--quiet", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# widgets\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "init");
  git(seed, "push", "--quiet", bare, "main");
  engine = new FakeEngine();
});

afterEach(async () => {
  await fake?.close();
  removeTempDir(root);
});

describe("sagax-runner cycle", () => {
  it("runs bootstrap, setup, a turn, verify, commit, bundle, idle, a followup and stop", async () => {
    await setup();
    let setupOnlyFileSeenByEngine: boolean | null = null;
    engine.scripts.push((turn, eng) => {
      setupOnlyFileSeenByEngine = existsSync(join(eng.input!.environment.PX_SECRETS_DIR!, "SETUP_TOKEN"));
      return writeHello(turn, eng);
    });
    engine.scripts.push((turn) => { writeFileSync(join(turn.cwd!, "second.txt"), "two\n"); });
    const { result, dirs } = start();

    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    const repo = join(dirs.workspace, "repo");

    // Secrets: written 0400 before setup; setup_only erased before the engine.
    expect(fake.secretsCalls).toBe(1);
    expect(setupOnlyFileSeenByEngine).toBe(false);
    expect(existsSync(join(dirs.secrets, "AGENT_TOKEN"))).toBe(true);
    expect(statSync(join(dirs.secrets, "AGENT_TOKEN")).mode & 0o777).toBe(0o400);
    const env = engine.input!.environment;
    expect(env.AGENT_TOKEN).toBe(AGENT_SECRET);
    expect(env.SETUP_TOKEN).toBeUndefined();
    // Model proxy with the run token as key (CA-10).
    expect(env.ANTHROPIC_BASE_URL).toBe(fake.modelProxy.anthropic);
    expect(env.ANTHROPIC_API_KEY).toBe(TOKEN);
    expect(env.OPENAI_BASE_URL).toBe(`${fake.modelProxy.openai}/v1`);
    expect(env.OPENAI_API_KEY).toBe(TOKEN);
    expect(engine.turns[0]!.text).toBe("Add hello.txt");
    expect(engine.turns[0]!.cwd).toBe(repo);

    // Git guard: no header in .git/config, push URL neutralized, hook.
    const config = readFileSync(join(repo, ".git", "config"), "utf8");
    expect(config).not.toContain(TOKEN);
    expect(config.toLowerCase()).not.toContain("extraheader");
    expect(git(repo, "config", "--get", "remote.origin.pushurl").trim()).toBe(NO_PUSH_URL);
    expect(existsSync(join(repo, ".git", "hooks", "pre-push"))).toBe(true);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(BRANCH);
    // Every request carried the run token; git only read.
    expect(fake.requests.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(fake.gitRequests.some((r) => r.includes("receive-pack"))).toBe(false);

    // verify, commit by Pulsatrix Agent, stats, diff, commits, one-ref bundle.
    const verify = await fake.waitFor((e) => e.kind === "verify");
    expect((verify.data.commands as Array<{ ok: boolean }>).map((c) => c.ok)).toEqual([true, true]);
    expect(git(repo, "log", "-1", "--format=%an").trim()).toBe("Pulsatrix Agent");
    const stats = await fake.waitFor((e) => e.kind === "stats");
    expect(stats.data).toMatchObject({ files: 1, added: 1, removed: 0, commits: 1 });
    const diff = await fake.waitFor((e) => e.kind === "diff");
    expect((diff.data.files as Array<{ path: string; status: string }>)[0]).toMatchObject({ path: "hello.txt", status: "added" });
    expect(fake.bundles).toHaveLength(1);
    const heads = bundleHeads(fake.bundles[0]!);
    expect(heads.map((h) => h.ref)).toEqual([`refs/heads/${BRANCH}`]);
    expect(heads[0]!.sha).toBe(stats.data.head_sha);
    const check = join(root, "check");
    git(root, "clone", "--quiet", bare, check);
    writeFileSync(join(root, "b1.bundle"), fake.bundles[0]!);
    git(check, "bundle", "verify", "--quiet", join(root, "b1.bundle"));
    git(check, "fetch", "--quiet", join(root, "b1.bundle"), `refs/heads/${BRANCH}:refs/heads/fetched`);
    expect(git(check, "log", "-1", "--format=%an %s", "fetched").trim()).toBe("Pulsatrix Agent Fix the widgets");
    // Incremental: the base is the one prerequisite.
    const mainSha = git(bare, "rev-parse", "main").trim();
    expect(prerequisites(fake.bundles[0]!)).toEqual([mainSha]);

    // A followup runs a second turn in the same session, then a new bundle.
    fake.push("followup", { text: "Also add second.txt", mode: "queue" });
    await fake.waitFor((e) => e.kind === "message" && e.data.role === "user");
    await expectEventually(() => fake.bundles.length === 2);
    expect(engine.turns[1]!.text).toBe("Also add second.txt");
    expect(engine.turns[1]!.resumeCursor).toBe("sess-1");
    expect(bundleHeads(fake.bundles[1]!).map((h) => h.ref)).toEqual([`refs/heads/${BRANCH}`]);
    // The second bundle starts from the first push.
    expect(prerequisites(fake.bundles[1]!)).toEqual([heads[0]!.sha]);
    writeFileSync(join(root, "b2.bundle"), fake.bundles[1]!);
    git(check, "bundle", "verify", "--quiet", join(root, "b2.bundle"));
    await expectEventually(() => fake.states().filter((s) => s === "idle").length === 2);

    fake.push("stop");
    const done = await result;
    expect(done.exit).toBe("stopped");
    expect(fake.states()).toEqual(["setup", "running", "idle", "running", "idle", "finished"]);
    expect(engine.disposed).toBe(true);
    expect(existsSync(dirs.secrets)).toBe(false);

    // Masking: no secret and no token in anything the runner sent.
    const sent = JSON.stringify(fake.events);
    expect(sent).not.toContain(SETUP_SECRET);
    expect(sent).not.toContain(AGENT_SECRET);
    expect(sent).not.toContain(TOKEN);
    expect(sent).toContain(MASK);
    const terminal = fake.events.filter((e) => e.kind === "terminal").map((e) => String(e.data.text)).join("");
    expect(terminal).toContain(`setup has ${MASK}`);
    expect(terminal).toContain("setup-file-ok");
    expect(terminal).toContain(`verify sees ${MASK}`);
  }, 60_000);

  it("relays an approval and answers it from the approve command", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push(async (turn, eng) => {
      eng.emit({ type: "request.opened", requestId: "ask-1", requestType: "permission", tool: "Bash", summary: "rm -rf build", allowSession: true });
      const decision = await eng.waitAnswer("ask-1");
      eng.emit({ type: "request.resolved", requestId: "ask-1", behavior: (decision as { behavior: string }).behavior, source: "user" });
      writeFileSync(join(turn.cwd!, "approved.txt"), "ok\n");
    });
    const { result } = start();
    const approval = await fake.waitFor((e) => e.kind === "approval");
    expect(approval.data).toMatchObject({ approval_id: "ask-1", title: "Bash", choices: ["allow", "deny", "allow_session"] });
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "waiting_for_approval");
    fake.push("approve", { approval_id: "ask-1", option: "allow" });
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    expect(engine.responses).toEqual([{ requestId: "ask-1", decision: { behavior: "allow" } }]);
    expect(fake.states()).toEqual(["setup", "running", "waiting_for_approval", "running", "idle"]);
    fake.push("stop");
    expect((await result).exit).toBe("stopped");
  }, 60_000);

  it("steers a followup into a running turn and interrupts for another", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push(async (_turn, eng) => { await eng.hang(); });
    engine.scripts.push(() => undefined);
    const { result } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "running");
    fake.push("followup", { text: "steer me", mode: "steer" });
    await expectEventually(() => engine.steered.length === 1);
    fake.push("followup", { text: "do this instead", mode: "interrupt" });
    await expectEventually(() => engine.turns.length === 2);
    expect(engine.interrupts.length).toBeGreaterThan(0);
    expect(engine.turns[1]!.text).toBe("do this instead");
    fake.push("stop");
    expect((await result).exit).toBe("stopped");
  }, 60_000);

  it("stops the engine during a turn: finished, nothing published", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push(async (turn, eng) => { writeFileSync(join(turn.cwd!, "partial.txt"), "x\n"); await eng.hang(); });
    const { result, dirs } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "running");
    fake.push("stop");
    const done = await result;
    expect(done.exit).toBe("stopped");
    expect(engine.interrupts.length).toBeGreaterThan(0);
    expect(fake.bundles).toHaveLength(0);
    expect(fake.states().at(-1)).toBe("finished");
    expect(existsSync(dirs.secrets)).toBe(false);
  }, 60_000);

  it("re-arms its deadline from a limits command (a duration an admin extended)", async () => {
    await setup({ setup: "", verify: [], limits: { max_duration_sec: 3 } });
    engine.scripts.push(async (_turn, eng) => { await eng.hang(); });
    const { result } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "running");
    fake.push("limits", { max_duration_sec: 3600 });
    await new Promise((resolve) => setTimeout(resolve, 4500));
    fake.push("stop");
    const done = await result;
    expect(done.exit).toBe("stopped");
  }, 60_000);

  it("stops cleanly on a 401: no further event, engine disposed, secrets wiped", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push(writeHello);
    const { result, dirs } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    const before = fake.events.length;
    fake.revoked = true;
    fake.push("followup", { text: "never runs", mode: "queue" });
    const done = await result;
    expect(done.exit).toBe("unauthorized");
    expect(fake.events.length).toBe(before);
    expect(engine.turns).toHaveLength(1);
    expect(engine.disposed).toBe(true);
    expect(existsSync(dirs.secrets)).toBe(false);
  }, 60_000);

  it("stops at once when the bootstrap answers 401", async () => {
    await setup();
    fake.revoked = true;
    const { result } = start();
    expect((await result).exit).toBe("unauthorized");
    expect(fake.events).toHaveLength(0);
    expect(engine.input).toBeNull();
  }, 30_000);
});

describe("sagax-runner Git guard (negative)", () => {
  it("refuses a push from the clone: pushurl, pre-push hook, and 403 on receive-pack", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push(writeHello);
    const { result, dirs } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    const repo = join(dirs.workspace, "repo");
    const plainEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

    // 1. origin's push URL is no-push://.
    const viaOrigin = await runAsync("git", ["push", "origin", BRANCH], { cwd: repo, env: plainEnv });
    expect(viaOrigin.status).not.toBe(0);
    expect(viaOrigin.stderr).toMatch(/no-push|protocol/i);

    // 2. Straight to a reachable remote: the pre-push hook refuses.
    const viaPath = await runAsync("git", ["push", bare, `${BRANCH}:refs/heads/main`], { cwd: repo, env: plainEnv });
    expect(viaPath.status).not.toBe(0);
    expect(viaPath.stderr).toContain("push refused");

    // 3. Even with the run token and no hook, Perspicax refuses receive-pack.
    const withToken = gitEnv({ gitUrl: fake.gitUrl, token: TOKEN, env: plainEnv }, true);
    const viaPerspicax = await runAsync("git", ["-c", "core.hooksPath=/dev/null", "push", fake.gitUrl, `${BRANCH}:refs/heads/main`], { cwd: repo, env: withToken });
    expect(viaPerspicax.status).not.toBe(0);
    expect(viaPerspicax.stderr).toMatch(/403/);
    expect(git(bare, "rev-parse", "main").trim()).not.toBe(git(repo, "rev-parse", "HEAD").trim());

    fake.push("stop");
    await result;
  }, 60_000);

  it.each([
    ["the base branch", { branch: "main" }],
    ["a branch outside px/", { branch: "feature/x" }],
    ["a path trick", { branch: "px/../main" }],
  ])("fails the run before cloning on %s", async (_label, overrides) => {
    await setup(overrides);
    const { result } = start();
    const done = await result;
    expect(done.exit).toBe("failed");
    expect(fake.states()).toEqual(["setup", "failed"]);
    expect(fake.gitRequests).toHaveLength(0);
    expect(engine.input).toBeNull();
  }, 30_000);

  it("never sends the token to a git URL outside Perspicax", async () => {
    await setup({ git_url: "https://github.com/acme/widgets.git" });
    const { result } = start();
    const done = await result;
    expect(done.exit).toBe("failed");
    expect(done.error).toMatch(/git_url/);
    expect(fake.secretsCalls).toBe(0);
  }, 30_000);
});

describe("sagax-runner review cases", () => {
  it("retries a bootstrap answered 503, then runs", async () => {
    await setup({ setup: "", verify: [] });
    fake.bootstrapFailures = 1;
    engine.scripts.push(writeHello);
    const { result } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle", 30_000);
    fake.push("stop");
    expect((await result).exit).toBe("stopped");
  }, 60_000);

  it("never publishes a branch that carries a secret value", async () => {
    await setup({ setup: 'printf "token=%s\\n" "$SETUP_TOKEN" > config.txt', verify: [] });
    engine.scripts.push(writeHello);
    const { result } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    expect(fake.bundles).toHaveLength(0);
    const warning = fake.events.find((e) => e.kind === "warning" && String(e.data.text).includes("non publiée"));
    expect(String(warning?.data.text)).toContain("config.txt");
    expect(JSON.stringify(fake.events)).not.toContain(SETUP_SECRET);
    fake.push("stop");
    await result;
  }, 60_000);

  it("masks a secret that straddles a 16 KiB cut or a 4 KiB summary", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push((_turn, eng) => {
      eng.emit({ type: "item.started", itemType: "tool", itemId: "t9", title: "Bash", summary: "dump" });
      eng.emit({ type: "item.completed", itemType: "tool", itemId: "t9", ok: true, output: `${"x".repeat(4_090)}${AGENT_SECRET}${"y".repeat(12_280)}${AGENT_SECRET}${"z".repeat(100)}` });
    });
    const { result } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    const sent = JSON.stringify(fake.events);
    for (let k = 6; k < AGENT_SECRET.length; k++) {
      expect(sent).not.toContain(AGENT_SECRET.slice(0, k) + "\\n[...");
    }
    const terminal = fake.events.filter((e) => e.kind === "terminal").map((e) => String(e.data.text)).join("");
    expect(terminal).not.toContain(AGENT_SECRET.slice(0, 10));
    expect(terminal.split(MASK).length - 1).toBe(2);
    for (const e of fake.events.filter((ev) => ev.kind === "terminal")) expect(Buffer.byteLength(String(e.data.text))).toBeLessThanOrEqual(16 * 1024);
    expect(sent).not.toContain(AGENT_SECRET);
    fake.push("stop");
    await result;
  }, 60_000);

  it("kills what setup left running, so no process keeps setup_only secrets", async () => {
    await setup({ setup: 'sleep 30 & echo $! > "$HOME/bg.pid"; echo started', verify: [] });
    engine.scripts.push(writeHello);
    const { result, dirs } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "running");
    const pid = Number(readFileSync(join(dirs.workspace, "bg.pid"), "utf8").trim());
    expect(pid).toBeGreaterThan(0);
    await expectEventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 5_000);
    fake.push("stop");
    await result;
  }, 60_000);

  it("shows a refused bundle as a warning and sends the branch again next time", async () => {
    await setup({ setup: "", verify: [] });
    fake.bundleRefuseOnce = "not a fast forward";
    engine.scripts.push(writeHello);
    engine.scripts.push((turn) => { writeFileSync(join(turn.cwd!, "second.txt"), "two\n"); });
    const { result } = start();
    await fake.waitFor((e) => e.kind === "warning" && String(e.data.text).includes("not a fast forward"));
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    fake.push("followup", { text: "more", mode: "queue" });
    await expectEventually(() => fake.bundles.length === 2);
    // Nothing was accepted: the second bundle still starts from the base.
    expect(prerequisites(fake.bundles[1]!)).toEqual([git(bare, "rev-parse", "main").trim()]);
    fake.push("stop");
    await result;
  }, 60_000);

  it("takes the author and the approval level from the bootstrap", async () => {
    await setup({ setup: "", verify: [], author: { name: "Ada Dev", email: "ada@users.noreply.example.com" }, approval_level: "ask" });
    engine.scripts.push(writeHello);
    const { result, dirs } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    expect(engine.input!.approvalMode).toBe("ask");
    expect(engine.input!.environment.GIT_AUTHOR_EMAIL).toBe("ada@users.noreply.example.com");
    expect(git(join(dirs.workspace, "repo"), "log", "-1", "--format=%an <%ae>").trim()).toBe("Ada Dev <ada@users.noreply.example.com>");
    fake.push("stop");
    await result;
  }, 60_000);

  it("drops an events batch Perspicax refuses (4xx) and goes on", async () => {
    await setup({ setup: "", verify: [] });
    fake.eventsStatusOnce = 422;
    engine.scripts.push(writeHello);
    const { result } = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    fake.push("stop");
    expect((await result).exit).toBe("stopped");
  }, 60_000);

  it("on a followup Pod, catches up with commits pushed to the branch since", async () => {
    await setup({ setup: "", verify: [] });
    engine.scripts.push(writeHello);
    const first = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle");
    const stopSeq = fake.push("stop");
    await first.result;
    // What Perspicax pushed, plus a commit a person added on the PR.
    writeFileSync(join(root, "b1.bundle"), fake.bundles[0]!);
    git(bare, "fetch", "--quiet", join(root, "b1.bundle"), `refs/heads/${BRANCH}:refs/heads/${BRANCH}`);
    const person = join(root, "person");
    git(root, "clone", "--quiet", "-b", BRANCH, bare, person);
    writeFileSync(join(person, "review.txt"), "fix\n");
    git(person, "add", ".");
    git(person, "commit", "--quiet", "-m", "review fix");
    git(person, "push", "--quiet", "origin", BRANCH);
    const personHead = git(person, "rev-parse", "HEAD").trim();

    engine = new FakeEngine();
    // commands_after: the old stop (consumed by the first Pod) is not replayed.
    expect(fake.lastSeq).toBe(stopSeq);
    fake.newPod(bootstrapFor({ setup: "", verify: [], followup: { text: "Also add second.txt", mode: "queue" }, resume: { session_id: "sess-1", summary: "hello.txt added" }, commands_after: stopSeq, last_pushed_sha: personHead }));
    engine.scripts.push((turn) => { writeFileSync(join(turn.cwd!, "second.txt"), "two\n"); });
    const second = start();
    await fake.waitFor((e) => e.kind === "state" && e.data.state === "idle").catch((error) => { throw new Error(`${error.message} ${JSON.stringify(fake.events.filter((e) => e.kind === "state" || e.kind === "warning"))}`); });
    expect(engine.turns[0]).toMatchObject({ text: "Also add second.txt", resumeCursor: "sess-1" });
    expect(fake.bundles).toHaveLength(1);
    const head = bundleHeads(fake.bundles[0]!)[0]!.sha;
    expect(prerequisites(fake.bundles[0]!)).toEqual([personHead]);
    writeFileSync(join(root, "b2.bundle"), fake.bundles[0]!);
    git(person, "fetch", "--quiet", join(root, "b2.bundle"), `refs/heads/${BRANCH}:refs/heads/next`);
    expect(git(person, "merge-base", "--is-ancestor", personHead, head)).toBe("");
    fake.push("stop");
    await second.result;
  }, 90_000);
});

function prerequisites(bundle: Buffer): string[] {
  const header = bundle.subarray(0, bundle.indexOf("\n\n")).toString("utf8");
  return header.split("\n").filter((line) => line.startsWith("-")).map((line) => line.slice(1).split(" ")[0]!);
}

/** Async on purpose: the fake Perspicax runs in this process, so a
 * synchronous child would block the very server it talks to. */
function runAsync(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

async function expectEventually(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
