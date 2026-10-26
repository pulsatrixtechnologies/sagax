// Engine hooks, end to end (Phase 0, item 0.2): the real harness server with
// the fake Claude CLI honouring the hooks block of its private --settings
// file. A PostToolUse hook delivers the full tool result to the harness,
// which spills it to a private file, attaches it to the tool's activity row,
// and lets the turn's digest claim full evidence. A forged bearer is refused.
// With SAGAX_HOOKS=0 the driver registers nothing and the digest says so.
//
// Same POSIX gating as branching.test.ts (the fake CLI is a shebang script).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

interface Msg {
  id: string;
  role: string;
  kind: string;
  text?: string;
  tool?: { name: string; itemId?: string; fullResult?: boolean; output?: string };
  digest?: { hookCoverage: string; tools: Array<{ name: string; count: number }> };
}

const BIG = `line ${"x".repeat(80)}\n`.repeat(200); // ~17 KB: past the 6 KB preview

function harness(label: string, serverEnv: Record<string, string>, instanceEnv: Record<string, string> = {}) {
  // picked in beforeAll: freePortBlock is async and harness() is not
  let PORT = 0;
  let BASE = "";
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  beforeAll(async () => {
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), `omb-hooks-${label}-`));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_TURN_STATE: join(home, "turns"),
            FAKE_CLAUDE_PROMPTS: join(home, "prompts.ndjson"),
            FAKE_CLAUDE_HOOKS: "1",
            FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([
              { name: "Bash", input: { command: "cat big.log" }, ok: true, output: BIG },
              { name: "Read", input: { file_path: "a.ts" }, ok: true, output: "const a = 1;" },
            ]),
            ...instanceEnv,
          },
          config: { cli: FAKE_CLAUDE },
        },
      },
    }));
    const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), ...serverEnv };
    if (process.env.PATH) env.PATH = process.env.PATH;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], { cwd: join(SERVER_DIR, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {}
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);
  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });
  return {
    api,
    getBot,
    waitFor,
    home: () => home,
    runTurn: async () => {
      const created = (await api("POST", "/api/bots")).body.bot;
      expect((await api("PATCH", `/api/bots/${created.id}`, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
      expect((await api("POST", `/api/bots/${created.id}/messages`, { text: "read the big log" })).status).toBe(202);
      await waitFor(async () => {
        const b = await getBot(created.id);
        return !!b && !b.busy && b.messages.some((m: Msg) => m.kind === "digest");
      }, "the turn to settle with a digest");
      return getBot(created.id);
    },
  };
}

posixOnly("engine hooks e2e (fake Claude honouring the settings hooks)", () => {
  const h = harness("on", {});

  it("delivers full tool results through PostToolUse: spilled to a private file, attached to the activity row, digest evidence full", async () => {
    const bot = await h.runTurn();
    const tools: Msg[] = bot.messages.filter((m: Msg) => m.kind === "activity" && m.tool);
    expect(tools.map((m) => m.tool!.name)).toEqual(["Bash", "Read"]);
    for (const row of tools) {
      expect(row.tool!.itemId).toBeTruthy();
      expect(row.tool!.fullResult).toBe(true);
      expect(row.tool).not.toHaveProperty("outputPath");
    }
    expect(JSON.stringify(tools)).not.toContain(h.home());
    const root = join(h.home(), ".sagax", "tool-results");
    const threads = readdirSync(root);
    expect(threads).toHaveLength(1);
    const dir = join(root, threads[0]!);
    const files = readdirSync(dir).map((name) => join(dir, name));
    expect(files).toHaveLength(2);
    for (const file of files) expect(statSync(file).mode & 0o777).toBe(0o600);
    const bash = tools[0]!.tool!;
    const spilled = files.map((file) => readFileSync(file, "utf8")).find((text) => text.startsWith("line "))!;
    expect(spilled.length).toBeGreaterThan(10_000);
    expect(spilled).toContain(BIG.slice(0, 200));
    // the row's own preview stays bounded; the file has the rest
    expect((bash.output ?? "").length).toBeLessThan(7_000);
    const digest: Msg = bot.messages.find((m: Msg) => m.kind === "digest");
    expect(digest.digest?.hookCoverage).toBe("full");
    expect(digest.text).not.toContain("from tool previews");
  }, 60_000);

  it("refuses a hook call whose bearer is not a live hooks capability", async () => {
    const forged = await h.api("POST", "/api/internal/hook", { event: "PostToolUse", payload: { tool_use_id: "x" } }, { authorization: "Bearer not-a-real-token" });
    expect(forged.status).toBe(401);
  });
});

posixOnly("engine hooks e2e: compaction", () => {
  const h = harness("compact", {}, { FAKE_CLAUDE_COMPACT: "1", FAKE_CLAUDE_COMPACT_AT: "tool" });

  it("hides the engine's own compaction, even mid tool call, and hands the latest digests back as plain-text context", async () => {
    const bot = await h.runTurn();
    // the fake compacts on its SECOND turn, while the first tool call is in
    // flight; one more turn so the first turn's digest exists first
    expect((await h.api("POST", `/api/bots/${bot.id}/messages`, { text: "and again" })).status).toBe(202);
    await h.waitFor(async () => {
      const b = await h.getBot(bot.id);
      return !b.busy && b.messages.filter((m: Msg) => m.kind === "digest").length >= 2;
    }, "the second turn to settle with its digest");
    const after = await h.getBot(bot.id);
    // nothing about a compaction reaches the chat: no row, no chip, no notice
    expect(after.messages.filter((m: Msg) => m.kind === "compaction")).toEqual([]);
    expect(JSON.stringify(after.messages.filter((m: Msg) => m.role === "bot"))).not.toMatch(/compact/i);
    // the tool call in flight during the compaction finished normally
    const secondTurnTools: Msg[] = after.messages.filter((m: Msg) => m.kind === "activity" && m.tool).slice(-2);
    expect(secondTurnTools.map((m) => m.tool!.name)).toEqual(["Bash", "Read"]);
    for (const row of secondTurnTools) expect(row.tool!.fullResult).toBe(true);
    expect(after.messages.filter((m: Msg) => m.kind === "digest").at(-1)!.digest!.hookCoverage).toBe("full");
    // the fake echoes what SessionStart's stdout gave it, which must be the
    // first turn's digest line
    const replies: Msg[] = after.messages.filter((m: Msg) => m.role === "bot" && m.kind === "text" && m.text);
    expect(replies.at(-1)!.text).toContain("[What ");
    expect(replies.at(-1)!.text).toContain("did in an earlier turn");
    expect(replies.at(-1)!.text).toContain("Bash ×1");
  }, 90_000);
});

posixOnly("engine hooks e2e: a shell call that hit its time limit", () => {
  const dumpDir = mkdtempSync(join(tmpdir(), "sagax-hooks-timeout-dump-"));
  const dump = join(dumpDir, "turn.json");
  afterAll(() => removeTempDir(dumpDir));
  const h = harness("timeout", {}, {
    FAKE_CLAUDE_DUMP: dump,
    FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([
      { name: "Bash", input: { command: "ffmpeg -i talk.mp3 -ar 16000 talk.wav" }, ok: false, output: "Exit code 143\nCommand timed out after 2m 0s" },
      { name: "Bash", input: { command: "find / -iname 'ggml-*.bin'" }, ok: false, output: "Exit code 143\nCommand timed out after 2m 0s" },
      { name: "Bash", input: { command: "false" }, ok: false, output: "Exit code 1" },
    ]),
  });

  it("tells the engine how to rerun it, and the prompt said so up front", async () => {
    const bot = await h.runTurn();
    const reply: Msg = bot.messages.filter((m: Msg) => m.role === "bot" && m.kind === "text" && m.text).at(-1);
    expect(reply.text!.match(/hit the shell time limit/g)).toHaveLength(2);
    expect(reply.text).toContain("up to 600000");
    expect(reply.text).toContain("mdfind -name");
    const preview = await h.api("GET", `/api/bots/${bot.id}/system-prompt`);
    const shell = preview.body.sections.find((s: { id: string }) => s.id === "shell");
    expect(shell?.text).toContain("Long-running shell commands");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.systemPrompt).toContain(shell.text.trim());
    expect(seen.env.BASH_MAX_TIMEOUT_MS).toBe("600000");
  }, 60_000);
});

posixOnly("engine hooks e2e with SAGAX_HOOKS=0", () => {
  const h = harness("off", { SAGAX_HOOKS: "0" });

  it("registers nothing: rows keep only previews and the digest says so", async () => {
    const bot = await h.runTurn();
    const tools: Msg[] = bot.messages.filter((m: Msg) => m.kind === "activity" && m.tool);
    expect(tools.length).toBe(2);
    for (const row of tools) {
      expect(row.tool!.fullResult).toBeUndefined();
      expect(row.tool).not.toHaveProperty("outputPath");
    }
    const digest: Msg = bot.messages.find((m: Msg) => m.kind === "digest");
    expect(digest.digest?.hookCoverage).toBe("preview");
  }, 60_000);
});
