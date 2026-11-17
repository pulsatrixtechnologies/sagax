// The real server and the fake ACP engine CLI for the turn latency tests and
// the first-text benchmark (#4215, #4394, #4456): a fixture bot's turns run
// through the whole turn path, and the server's log carries each turn's
// [turn-latency] line. No provider and no production data.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { waitForExit } from "./cleanup.ts";

export type Fixture = {
  api: (method: string, path: string, body?: unknown) => Promise<any>;
  control: (...args: string[]) => Promise<any>;
  serverLog: () => string;
  /** the server's data folder (the bots' workspaces live under it) */
  dataDir: string;
  promptPids: () => Set<number>;
  /** releases the busy fixture's held turns */
  release: () => void;
};

export async function withLatencyFixture(options: { claudeSignedOut?: boolean; busy?: boolean; coldMs?: number; toolMs?: number; connectMcp?: boolean; idleExitMs?: number; serverEnv?: Record<string, string>; engineEnv?: Record<string, string> }, check: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  let server: ChildProcess | undefined;
  const rpcFile = join(dataDir, "acp-rpc.ndjson");
  const gateFile = join(dataDir, "busy-gate");
  const control = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    return response.json() as Promise<any>;
  };
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.instances.grokfixture = {
      driver: "grokAgent", displayName: "Grok fixture",
      config: { cli: fileURLToPath(new URL("./fake-acp-cli.ts", import.meta.url)) },
      environment: { ...(options.toolMs ? {} : { FAKE_ACP_TEXT_REPLY: "4" }), FAKE_ACP_RPC_APPEND_FILE: rpcFile, ...(options.coldMs ? { FAKE_ACP_COLD_MS: String(options.coldMs) } : {}),
        // a turn that runs one tool for toolMs before its answer
        ...(options.toolMs ? { FAKE_ACP_MODE: "slow-tool", FAKE_ACP_TOOL_MS: String(options.toolMs) } : {}),
        // #4394: the engine starts and lists its tool servers as grok does
        ...(options.connectMcp ? { FAKE_ACP_MCP_CONNECT: "1" } : {}),
        // #4394: an engine that ends on its own between two turns
        ...(options.idleExitMs ? { FAKE_ACP_IDLE_EXIT_MS: String(options.idleExitMs) } : {}),
        // #4456: a fake model's own timing and prompt cache (fake-acp-cli.ts)
        ...options.engineEnv },
    };
    // a teammate's engine that holds its turn open until the gate file exists
    if (options.busy) config.instances.grokbusy = {
      driver: "grokAgent", displayName: "Busy fixture",
      config: { cli: fileURLToPath(new URL("./fake-acp-cli.ts", import.meta.url)) },
      environment: { FAKE_ACP_MODE: "echo-gated", FAKE_ACP_GATE_FILE: gateFile },
    };
    if (options.claudeSignedOut) {
      config.instances.claude.environment = { ...config.instances.claude.environment, FAKE_CLAUDE_MODE: "not-logged-in" };
      config.automaticRecovery = { enabled: true, backup: { instanceId: "grokfixture", model: "grok-4.7" } };
    }
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    // BENCH_SERVER_NODE_OPTIONS: more node options for the server alone,
    // e.g. `--cpu-prof --cpu-prof-dir=<dir>` to profile a benchmark's turns
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_ACP_REUSE_DIAG: "1", ...options.serverEnv, ...(process.env.SAGAX_TURN_TRACE === "1" ? { SAGAX_TURN_TRACE: "1" } : {}), ...(process.env.BENCH_SERVER_NODE_OPTIONS ? { NODE_OPTIONS: [options.serverEnv?.NODE_OPTIONS, process.env.BENCH_SERVER_NODE_OPTIONS].filter(Boolean).join(" ") } : {}) },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    const serverLog = () => readFileSync(logPath, "utf8");
    try {
      await check({
        api, control, serverLog, dataDir, release: () => writeFileSync(gateFile, "go"),
        promptPids: () => new Set((existsSync(rpcFile) ? readFileSync(rpcFile, "utf8") : "").split("\n").filter(Boolean)
          .map((line) => JSON.parse(line) as { pid: number; method: string })
          .filter((row) => row.method === "session/prompt").map((row) => row.pid)),
      });
    } finally {
      writeFileSync(gateFile, "go");
      if (process.env.TURN_LATENCY_DUMP) appendFileSync(process.env.TURN_LATENCY_DUMP, serverLog());
    }
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}

/** The [turn-latency] lines of one thread, in order. */
export function timingLines(log: string, threadId: string): string[] {
  return log.split("\n").filter((line) => line.includes("[turn-latency]") && line.includes(`thread=${threadId.slice(0, 8)}`));
}

