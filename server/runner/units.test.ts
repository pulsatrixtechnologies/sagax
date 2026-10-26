// Pure pieces of sagax-runner: masking, secrets on disk, the diff contract,
// protocol parsing, the engine event mapping and the driver plan.
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { capDiff, parseUnifiedDiff } from "./diff.ts";
import { decisionFor, mapRuntimeEvent } from "./engine.ts";
import { driverPlan } from "./engine-drivers.ts";
import { bundleHeads, gitEnv, runBranchProblem } from "./git.ts";
import { MASK, Masker } from "./mask.ts";
import { controlBase, parseBootstrap, parseCommands, parseSecrets, sameControlOrigin } from "./protocol.ts";
import { firstTurn } from "./runner.ts";
import { terminalEvents, truncateUtf8 } from "./relay.ts";
import { SecretStore } from "./secrets.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) removeTempDir(dir); });

describe("Masker", () => {
  it("masks every value, the longest first, and each line of a multi-line value", () => {
    const masker = new Masker();
    expect(masker.add("abcdef123", "abcdef123456", "-----BEGIN KEY-----\nline-two-secret\n", "abc")).toEqual(["abc"]);
    expect(masker.mask("x abcdef123456 y abcdef123 z")).toBe(`x ${MASK} y ${MASK} z`);
    expect(masker.mask("printed: line-two-secret")).toBe(`printed: ${MASK}`);
    expect(masker.maskDeep({ a: ["abcdef123"], b: 3 })).toEqual({ a: [MASK], b: 3 });
  });

  it("masks a secret split across two chunks of a stream", () => {
    const masker = new Masker();
    masker.add("s3cr3t-value");
    const stream = masker.stream();
    const out = stream.push("before s3cr") + stream.push("3t-value after s3") + stream.push("cr3t-val") + stream.push("ue!") + stream.end();
    expect(out).toBe(`before ${MASK} after ${MASK}!`);
    expect(out).not.toContain("s3cr");
  });
});

describe("SecretStore", () => {
  it("writes 0400 files, keeps setup_only out of the agent, refuses reserved names", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-secrets-"));
    dirs.push(root);
    const store = new SecretStore(join(root, "s"));
    const problems = store.write([
      { name: "DB_PASSWORD", value: "pw-123456", setup_only: true },
      { name: "API_TOKEN", value: "tok-123456", setup_only: false },
      { name: "PATH", value: "/evil", setup_only: false },
      { name: "ANTHROPIC_API_KEY", value: "x", setup_only: false },
      { name: "bad name", value: "x", setup_only: false },
    ]);
    expect(problems.map((p) => p.name)).toEqual(["PATH", "ANTHROPIC_API_KEY", "bad name"]);
    expect(statSync(join(root, "s", "DB_PASSWORD")).mode & 0o777).toBe(0o400);
    expect(statSync(join(root, "s")).mode & 0o777).toBe(0o700);
    expect(store.setupEnv()).toMatchObject({ DB_PASSWORD: "pw-123456", API_TOKEN: "tok-123456" });
    expect(store.eraseSetupOnly()).toEqual(["DB_PASSWORD"]);
    expect(existsSync(join(root, "s", "DB_PASSWORD"))).toBe(false);
    expect(store.agentEnv()).toEqual({ PX_SECRETS_DIR: join(root, "s"), API_TOKEN: "tok-123456" });
    expect(readFileSync(join(root, "s", "API_TOKEN"), "utf8")).toBe("tok-123456");
    store.wipeAll();
    expect(existsSync(join(root, "s"))).toBe(false);
  });

  it("treats a missing setup_only as setup_only (the default)", () => {
    expect(parseSecrets({ secrets: [{ name: "A", value: "v" }] })).toEqual([{ name: "A", value: "v", setup_only: true }]);
    expect(() => parseSecrets({})).toThrow();
  });
});

describe("diff into DiffView files", () => {
  const sample = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@ export",
    " keep",
    "-old",
    "+new",
    " tail",
    "diff --git a/new.md b/new.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.md",
    "@@ -0,0 +1,1 @@",
    "+# title",
    "diff --git a/img.png b/img.png",
    "Binary files a/img.png and b/img.png differ",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "",
  ].join("\n");

  it("parses paths, statuses, counts and numbered lines", () => {
    const files = parseUnifiedDiff(sample);
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ["src/a.ts", "modified", 1, 1],
      ["new.md", "added", 1, 0],
      ["img.png", "modified", 0, 0],
      ["gone.txt", "deleted", 0, 1],
    ]);
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "keep" },
      { kind: "del", old: 2, text: "old" },
      { kind: "add", new: 2, text: "new" },
      { kind: "ctx", old: 3, new: 3, text: "tail" },
    ]);
    expect(files[1]!.previewable).toBe(true);
    expect(files[2]!.binary).toBe(true);
  });

  it("drops the hunks of the largest files first to fit a batch", () => {
    const files = parseUnifiedDiff(sample);
    const { files: capped, truncated } = capDiff(files, 600);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ files: capped }))).toBeLessThanOrEqual(600);
    expect(capped.length).toBeGreaterThan(0);
  });
});

describe("protocol", () => {
  const base = controlBase("https://px.example.com");

  it("accepts https or loopback http only", () => {
    expect(() => controlBase("http://px.example.com")).toThrow(/https/);
    expect(() => controlBase("https://user:pw@px.example.com")).toThrow();
    expect(controlBase("http://127.0.0.1:9000").origin).toBe("http://127.0.0.1:9000");
  });

  it("keeps the token on PX_CONTROL_URL's origin", () => {
    expect(sameControlOrigin(base, "https://px.example.com/api/v1/agents/runner/git/a/b.git")).toBe(true);
    expect(sameControlOrigin(base, "https://px.example.com.evil.test/x")).toBe(false);
    expect(sameControlOrigin(base, "https://github.com/a/b.git")).toBe(false);
    const raw = {
      run_id: "r", env_id: "e", title: "t", prompt: "p", engine: "codex", model: null, effort: null,
      repo: { owner: "a", name: "b" }, base_branch: "main", branch: "px/x", existing_branch: false, setup: "", verify: [],
      git_url: "https://px.example.com/api/v1/agents/runner/git/a/b.git",
      model_proxy: { anthropic: "https://px.example.com/api/v1/agents/model-proxy/anthropic", openai: "https://evil.test/v1" },
      followup: null, resume: null, limits: { max_duration_sec: 60 },
    };
    expect(() => parseBootstrap(raw, base)).toThrow(/model_proxy/);
    expect(() => parseBootstrap({ ...raw, model_proxy: { ...raw.model_proxy, openai: "https://px.example.com/api/v1/agents/model-proxy/openai" }, engine: "gemini" }, base)).toThrow(/engine/);
  });

  it("validates the bootstrap's cursor, commits, author and approval level", () => {
    const raw = {
      run_id: "r", env_id: "e", title: "t", prompt: "p", engine: "codex", model: null, effort: null,
      repo: { owner: "a", name: "b" }, base_branch: "main", branch: "px/x", existing_branch: false, setup: "", verify: [],
      git_url: "https://px.example.com/api/v1/agents/runner/git/a/b.git",
      model_proxy: { anthropic: "https://px.example.com/api/v1/agents/model-proxy/anthropic", openai: "https://px.example.com/api/v1/agents/model-proxy/openai" },
      followup: null, resume: null, limits: {},
    };
    expect(parseBootstrap(raw, base)).toMatchObject({ commands_after: 0, base_sha: null, last_pushed_sha: null, author: null, approval_level: "auto" });
    const sha = "c".repeat(40);
    expect(parseBootstrap({ ...raw, commands_after: 7, base_sha: sha, author: { name: "A B", email: "a@b.c" }, approval_level: "full" }, base))
      .toMatchObject({ commands_after: 7, base_sha: sha, author: { name: "A B", email: "a@b.c" }, approval_level: "full" });
    expect(() => parseBootstrap({ ...raw, base_sha: "main" }, base)).toThrow(/base_sha/);
    expect(() => parseBootstrap({ ...raw, author: { name: "A <x>", email: "a@b.c" } }, base)).toThrow(/author/);
    expect(() => parseBootstrap({ ...raw, approval_level: "custom" }, base)).toThrow(/approval_level/);
    expect(() => parseBootstrap({ ...raw, commands_after: -1 }, base)).toThrow(/commands_after/);
  });

  it("parses commands and moves the cursor past unknown kinds", () => {
    expect(parseCommands({ commands: [{ seq: 3, kind: "future", data: {} }, { seq: 2, kind: "approve", data: { approval_id: "a", option: "allow" } }] }))
      .toEqual({ commands: [{ seq: 2, kind: "approve", data: { approval_id: "a", option: "allow" } }], lastSeq: 3 });
  });

  it("parses a duration an admin extended and drops a bad one", () => {
    expect(parseCommands({ commands: [
      { seq: 4, kind: "limits", data: { max_duration_sec: 7200 } },
      { seq: 5, kind: "limits", data: { max_duration_sec: 12 * 3600 + 1 } },
      { seq: 6, kind: "limits", data: { max_duration_sec: "60" } },
      { seq: 7, kind: "limits", data: {} },
    ] })).toEqual({ commands: [{ seq: 4, kind: "limits", data: { max_duration_sec: 7200 } }], lastSeq: 7 });
  });

  it("rebuilds the context of a followup on a relaunched Pod", () => {
    const b = parseBootstrap({
      run_id: "r", env_id: "e", title: "t", prompt: "Fix it", engine: "claude-code", model: null, effort: null,
      repo: { owner: "a", name: "b" }, base_branch: "main", branch: "px/x", existing_branch: true, setup: "", verify: [],
      git_url: "https://px.example.com/api/v1/agents/runner/git/a/b.git",
      model_proxy: { anthropic: "https://px.example.com/api/v1/agents/model-proxy/anthropic", openai: "https://px.example.com/api/v1/agents/model-proxy/openai" },
      followup: { text: "And the tests", mode: "queue" }, resume: { session_id: null, summary: "Fixed the parser." }, limits: {},
    }, base);
    const turn = firstTurn(b);
    expect(turn.resumeCursor).toBeUndefined();
    expect(turn.text).toContain("Fix it");
    expect(turn.text).toContain("Fixed the parser.");
    expect(turn.text).toContain("And the tests");
    expect(firstTurn({ ...b, resume: { session_id: "s1", summary: "" } })).toMatchObject({ text: "And the tests", resumeCursor: "s1" });
  });
});

describe("git helpers", () => {
  it("refuses any branch but px/* and never the base", () => {
    expect(runBranchProblem("px/fix-1", "main")).toBeNull();
    expect(runBranchProblem("main", "main")).not.toBeNull();
    expect(runBranchProblem("px/", "main")).not.toBeNull();
    expect(runBranchProblem("px/a..b", "main")).not.toBeNull();
    expect(runBranchProblem("px/a b", "main")).not.toBeNull();
    expect(runBranchProblem("px/main", "px/main")).not.toBeNull();
  });

  it("puts the header in GIT_CONFIG_* for the git URL only, never on argv", () => {
    const env = gitEnv({ gitUrl: "https://px.example.com/g/a/b.git", token: "tok", env: { PATH: "/bin", GIT_DIR: "/x" } }, true);
    expect(env.GIT_DIR).toBeUndefined();
    const keys = Object.keys(env).filter((k) => k.startsWith("GIT_CONFIG_KEY_")).map((k) => env[k]);
    expect(keys).toContain("http.https://px.example.com/g/a/b.git.extraHeader");
    expect(Object.values(env)).toContain("Authorization: Bearer tok");
    expect(Object.values(gitEnv({ gitUrl: "u", token: "tok", env: {} }, false))).not.toContain("Authorization: Bearer tok");
  });

  it("reads the references of a bundle header", () => {
    const sha = "a".repeat(40);
    const bytes = Buffer.from(`# v2 git bundle\n-${"b".repeat(40)} base\n${sha} refs/heads/px/x\n\nPACK`);
    expect(bundleHeads(bytes)).toEqual([{ sha, ref: "refs/heads/px/x" }]);
    expect(bundleHeads(Buffer.from("not a bundle"))).toEqual([]);
  });
});

describe("engine events", () => {
  const ev = (event: Record<string, unknown>) => ({ eventId: "e1", provider: "p", threadId: "t", createdAt: "", ...event }) as RuntimeEvent;

  it("maps the canonical runtime events to protocol events", () => {
    expect(mapRuntimeEvent(ev({ type: "item.completed", itemType: "assistant_text", text: "hi" })).events).toEqual([{ kind: "message", data: { role: "assistant", text: "hi" } }]);
    expect(mapRuntimeEvent(ev({ type: "item.started", itemType: "tool", itemId: "i", title: "Bash", summary: "ls" })).events)
      .toEqual([{ kind: "tool_call", data: { id: "i", name: "Bash", input_summary: "ls" } }]);
    expect(mapRuntimeEvent(ev({ type: "item.completed", itemType: "tool", itemId: "i", ok: false, output: "err" })).events)
      .toEqual([{ kind: "tool_result", data: { id: "i", ok: false, output_summary: "err" } }]);
    expect(mapRuntimeEvent(ev({ type: "session.started", sessionId: "s" })).events).toEqual([{ kind: "session", data: { session_id: "s" } }]);
    expect(mapRuntimeEvent(ev({ type: "content.delta", streamKind: "assistant_text", delta: "x" })).events).toEqual([]);
    const question = mapRuntimeEvent(ev({ type: "request.opened", requestId: "q", requestType: "question", tool: "AskUserQuestion", summary: "Which?", choices: ["A", "B"] }));
    expect(question.ask).toMatchObject({ approvalId: "q", requestType: "question", choices: ["A", "B"] });
    expect(decisionFor(question.ask!, "B")).toEqual({ behavior: "answer", message: "B" });
  });

  it("fails closed on an unknown approval option", () => {
    const ask = { approvalId: "a", requestId: "a", requestType: "permission" as const, choices: ["allow", "deny"] };
    expect(decisionFor(ask, "allow")).toEqual({ behavior: "allow" });
    expect(decisionFor(ask, "allow_session").behavior).toBe("deny");
    expect(decisionFor(ask, "yes please").behavior).toBe("deny");
    expect(decisionFor({ ...ask, choices: ["allow", "deny", "allow_session"] }, "allow_session")).toEqual({ behavior: "allow", always: true });
  });

  it("splits terminal text in 16 KiB events and truncates on a character", () => {
    const events = terminalEvents("é".repeat(10_000));
    expect(events.length).toBe(2);
    for (const e of events) expect(Buffer.byteLength((e.data as { text: string }).text)).toBeLessThanOrEqual(16 * 1024);
    expect(truncateUtf8("ééé", 4, "")).toBe("éé");
  });
});

describe("driver plan", () => {
  const input = {
    model: null, effort: "high", cwd: "/workspace/repo",
    environment: { ANTHROPIC_BASE_URL: "https://px/a", ANTHROPIC_API_KEY: "tok", OPENAI_BASE_URL: "https://px/o/v1", OPENAI_API_KEY: "tok" },
  };

  it("points Claude Code at the proxy with the run token as its key", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-plan-"));
    dirs.push(root);
    const plan = driverPlan({ ...input, engine: "claude-code", stateDir: root });
    expect(plan).toMatchObject({ driver: "claude", effort: "high", environment: { ANTHROPIC_BASE_URL: "https://px/a", ANTHROPIC_API_KEY: "tok" } });
  });

  it("runs Codex on the driver's Company provider at the proxy, key in the environment only", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-plan-"));
    dirs.push(root);
    const plan = driverPlan({ ...input, engine: "codex", model: "gpt-x", stateDir: root });
    expect(plan.config).toEqual({ cli: "codex", fullAuto: false, managed: { url: "https://px/o/v1", models: ["gpt-x"] } });
    expect(plan.environment).toMatchObject({ SAGAX_COMPANY_API_KEY: "tok", CODEX_HOME: join(root, "codex") });
    expect(JSON.stringify(plan.config)).not.toContain("tok");
    expect(() => driverPlan({ ...input, engine: "codex", stateDir: root })).toThrow(/modèle/);
  });
});

describe("sagax-run image", () => {
  it("is built locally only and runs the runner as uid 1000 with no command from the request", () => {
    const script = readFileSync(new URL("../../scripts/build-run-image.sh", import.meta.url), "utf8");
    expect(script).not.toMatch(/--push\b|docker push|type=registry/);
    expect(script).toContain("RUN_IMAGE_PUSH");
    const dockerfile = readFileSync(new URL("../../deploy/run/Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toMatch(/^ARG SANDBOX_IMAGE=/m);
    expect(dockerfile).toMatch(/^FROM \$\{SANDBOX_IMAGE\}$/m);
    expect(dockerfile).toContain('ENV ENGINE_SET="claude codex"');
    expect(dockerfile).toMatch(/^USER 1000:1000$/m);
    // No Hermes in this image: the overlay runs npm only (a venv found fails).
    expect(dockerfile).toContain("harden-image-deps.mjs --no-venv --root /usr/local/lib/node_modules");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/node", "/opt/sagax-runner/dist-server/sagax-runner.js"]');
    const bundle = readFileSync(new URL("../../scripts/bundle-server.mjs", import.meta.url), "utf8");
    expect(bundle.match(/const ENTRY_POINTS = \[([\s\S]*?)\];/)?.[1]).toMatch(/["']sagax-runner\.ts["']/);
  });
});
