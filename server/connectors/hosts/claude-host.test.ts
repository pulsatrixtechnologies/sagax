// The Claude connector host (#3352, connectors across engines L9): one pinned
// `claude -p` call on the person's own Claude sign-in, run by the fake Claude
// CLI in its connector mode (server/testing/fake-claude-cli.ts), with the
// permission prompt tool Sagax ships (server/permission-proxy.ts) between the
// model and the tool.
//
// Proof (the cases of L7): exactly one call with equal arguments; an altered
// send (other input or another tool) is not run and the bot gets a plain
// error, also when the account's own settings allow the tool; the second
// account runs in its own folder; "needs sign-in" posts the Connect card; no
// process is left after the call. And the launch keeps the account's
// connectors on (no strict flag, no setting sources, M8).
//
// POSIX-gated like the other CLI tests (the fake is a shebang script).
import type { ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute } from "../../routes/internal-connectors.ts";
import { createConnectorHub } from "../hub.ts";
import type { ConnectorAccount, ConnectorEntry } from "../types.ts";
import { claudeConnectorHostArgs, claudeConnectorHostEnv, createClaudeConnectorHost, type ClaudeConnectorLaunch } from "./claude-host.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

const MAIL: ConnectorEntry = { name: "Example Mail", state: "connected", tools: [] };
const TOOL = "send_message";
const TOOL_ID = "mcp__claude_ai_Example_Mail__send_message";
const ARGS = { to: "ana@example.com", subject: "Weekly report", body: "Done.", cc: [] as string[] };

function claudeAccount(instanceId: "claude" | "claude-2"): ConnectorAccount {
  return { provider: "claude-ai", driver: "claudeAgent", instanceId, slot: "primary", key: `claude-ai:${instanceId}:primary`, label: "Claude", auth: "subscription", connectors: [MAIL], at: 1 };
}

interface PinnedCall { tool: string; input: Record<string, unknown>; pid: number; configDir: string | null; cwd: string }
interface Trace { pid: number; cwd: string; configDir: string | null }

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const lines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : []);

describe("Claude connector host launch", () => {
  it("keeps the account's connectors on and allows only ToolSearch", () => {
    const args = claudeConnectorHostArgs({ mcpConfig: "/x/mcp.json", settings: "/x/settings.json" });
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--setting-sources");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("ToolSearch");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    expect(args[args.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__ogb__approve");
    const env = claudeConnectorHostEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: "false", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/d" });
    expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ENABLE_TOOL_SEARCH).toBe("true");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/d");
  });
});

posixOnly("Claude connector host (#3352)", () => {
  let root = "";
  let callsFile = "";
  let traceFile = "";
  const dirs = { claude: "", "claude-2": "" };
  let mode = "obey";
  let userAllow = "";

  beforeAll(() => {
    chmodSync(FAKE_CLAUDE, 0o755);
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-claude-host-")));
    callsFile = join(root, "calls.jsonl");
    traceFile = join(root, "launches.jsonl");
    for (const id of ["claude", "claude-2"] as const) {
      const dir = join(root, "ana", id);
      mkdirSync(dir, { recursive: true });
      dirs[id] = dir;
    }
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  const launch = (principalId: string, account: ConnectorAccount): ClaudeConnectorLaunch | undefined => {
    if (principalId !== "ana@example.com") return undefined;
    return {
      cli: FAKE_CLAUDE,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: dirs[account.instanceId as "claude" | "claude-2"],
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
        FAKE_CLAUDE_CONNECTOR_MODE: mode,
        FAKE_CLAUDE_CONNECTOR_CALLS: callsFile,
        FAKE_CLAUDE_CONNECTOR_TRACE: traceFile,
        FAKE_CLAUDE_USER_ALLOW: userAllow,
      },
    };
  };
  const host = createClaudeConnectorHost({ launch, gate: (_label, run) => run(), timeoutMs: 30_000 });
  const reset = (variant: string, allow = "") => {
    mode = variant;
    userAllow = allow;
    rmSync(callsFile, { force: true });
    rmSync(traceFile, { force: true });
  };
  const run = (instanceId: "claude" | "claude-2" = "claude", args: Record<string, unknown> = ARGS, tool = TOOL) =>
    host.call({ principalId: "ana@example.com", account: claudeAccount(instanceId), connector: MAIL, tool, arguments: args, engine: "grokAgent" });

  it("makes exactly one call, with arguments equal to the approved ones", async () => {
    reset("obey");
    const result = await run();
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain(`pinned result of ${TOOL_ID}`);
    const calls = lines<PinnedCall>(callsFile);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toBe(TOOL_ID);
    expect(calls[0]!.input).toEqual(ARGS);
    expect(lines<Trace>(traceFile)).toHaveLength(1);
  }, 40_000);

  it("takes the tool by its rule key or its full id as well", async () => {
    for (const tool of ["claude_ai_Example_Mail__send_message", TOOL_ID]) {
      reset("obey");
      const result = await run("claude", ARGS, tool);
      expect(result.isError).toBeFalsy();
      expect(lines<PinnedCall>(callsFile).map((call) => call.tool)).toEqual([TOOL_ID]);
    }
  }, 60_000);

  it("never reaches another connector than the one named", async () => {
    reset("obey");
    const result = await run("claude", ARGS, "claude_ai_Other_Docs__read_page");
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/is not a tool of Example Mail, so nothing was run/);
    expect(lines<Trace>(traceFile)).toHaveLength(0);
  });

  it("does not run an altered send (other input) and answers a plain error", async () => {
    reset("alter-input");
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.needsSignIn).toBeFalsy();
    expect(result.text).toMatch(/other input than the approved call, so it was not run/);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
  }, 40_000);

  it("does not run an altered send even when the account's own settings allow the tool", async () => {
    reset("alter-input", TOOL_ID);
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/other input than the approved call, so it was not run/);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
  }, 40_000);

  it("does not run another tool than the approved one", async () => {
    reset("other-tool");
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/instead of the approved .*, so it was not run/);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
  }, 40_000);

  it("runs the second account in its own folder", async () => {
    reset("obey");
    const result = await run("claude-2");
    expect(result.isError).toBeFalsy();
    const [trace] = lines<Trace>(traceFile);
    expect(trace?.configDir).toBe(dirs["claude-2"]);
    const [call] = lines<PinnedCall>(callsFile);
    expect(call?.configDir).toBe(dirs["claude-2"]);
    expect(call?.configDir).not.toBe(dirs.claude);
  }, 40_000);

  it("leaves no process after the call, obeyed or refused", async () => {
    const pids: number[] = [];
    for (const variant of ["obey", "alter-input", "other-tool"]) {
      reset(variant);
      await run();
      pids.push(...lines<Trace>(traceFile).map((trace) => trace.pid));
    }
    expect(pids).toHaveLength(3);
    for (const pid of pids) expect(alive(pid)).toBe(false);
  }, 90_000);

  it("posts the Connect card on needs sign-in, through call_connector", async () => {
    reset("needs-sign-in");
    const cards: Array<{ botId: string; threadId: string; principalId: string; instanceId: string }> = [];
    const handler = createCallConnectorInternalRoute({
      ownsThread: (botId, threadId) => botId === "b1" && threadId === "t1",
      principal: () => "Ana@Example.com",
      confined: () => false,
      accounts: (principalId) => (principalId === "ana@example.com" ? [claudeAccount("claude")] : []),
      hub: () => createConnectorHub([host]),
      hold: () => ({ engine: "grokAgent", decision: Promise.resolve({ behavior: "allow" as const }) }),
      signInCard: ({ botId, threadId, principalId, account }) => { cards.push({ botId, threadId, principalId, instanceId: account.instanceId }); return true; },
    });
    let payload: Record<string, unknown> = {};
    await handler({
      res: {} as ServerResponse,
      path: CALL_CONNECTOR_INTERNAL_PATH,
      method: "POST",
      json: ((_res: ServerResponse, _code: number, body: Record<string, unknown>) => { payload = body; }) as never,
      capability: { botId: "b1", threadId: "t1", generation: "g" },
      readBody: async () => ({ connector: "Example Mail", tool: TOOL, arguments: ARGS }),
    });
    expect(cards).toEqual([{ botId: "b1", threadId: "t1", principalId: "ana@example.com", instanceId: "claude" }]);
    expect(payload.ok).toBe(false);
    expect(payload.signIn).toBe(true);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
    for (const trace of lines<Trace>(traceFile)) expect(alive(trace.pid)).toBe(false);
  }, 40_000);

  it("answers needs sign-in without starting Claude when the person has no sign-in", async () => {
    reset("obey");
    const result = await host.call({ principalId: "ben@example.com", account: claudeAccount("claude"), connector: MAIL, tool: TOOL, arguments: ARGS, engine: "grokAgent" });
    expect(result).toMatchObject({ isError: true, needsSignIn: true });
    expect(lines<Trace>(traceFile)).toHaveLength(0);
  });
});
