// The Claude driver's half of prompt-cache keep-warm (server/cache-keepwarm.ts):
// one tool-less request forked from a thread's live Claude Code session.
//
// Design ported from Cache Tax (MIT, Copyright (c) 2026 Karan Bansal,
// https://github.com/karanb192/claude-code-mods): after an idle stretch it
// sends ONE fork over the session's transcript with a fixed one-line prompt,
// so the provider re-reads the cached prefix (and refreshes its lifetime)
// instead of the next real message re-writing all of it.
//
// A cache hit needs the request's prefix — tools, system prompt, then the
// messages — to be byte-identical to what the session last sent. So the ping
// relaunches the CLI with the exact launch contract of the live process
// (same flags, same model and effort, same system prompt text, same MCP
// servers, same environment), plus:
//   --resume <session> --fork-session  read the session, answer in a copy;
//   --no-session-persistence           the copy is never written to disk, so
//                                      the thread's own session and its
//                                      transcript are untouched;
//   --output-format json, prompt on stdin, one result with the usage.
// Nothing the ping says reaches the harness's event bus or the chat.
//
// Tools stay declared (removing any would change the prefix) but none can
// run: a PreToolUse hook denies every call, the harness's permission proxy
// points at a socket nobody listens on (it denies), and the harness's own
// hooks (memory capture, skill review, activity) are not registered.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CacheWarmPingResult } from "../contracts.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { USAGE_LIMIT } from "./retry.ts";

/** The fixed prompt of every ping. Short, and asks for one word back. */
export const KEEP_WARM_PROMPT = "Reply with the single word: warm";
export const KEEP_WARM_TIMEOUT_MS = 120_000;

/** What a live CLI process was launched with, kept in memory only (it holds
 * the same credentials the turn already held) for the life of that process. */
export interface KeepWarmContract {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** --append-system-prompt-file's contents, or null when there was none */
  system: string | null;
  /** the MCP servers of --mcp-config, as written */
  mcpServers: Record<string, unknown> | null;
  /** the --settings object, without the harness's hooks */
  settings: Record<string, unknown> | null;
}

// Flags whose value is a per-launch file, a stream protocol choice or the
// session to run: the ping supplies its own.
const VALUE_FLAGS = new Set(["--output-format", "--input-format", "--mcp-config", "--settings", "--append-system-prompt-file", "--resume", "--session-id"]);
const BARE_FLAGS = new Set(["--verbose", "--include-partial-messages", "--replay-user-messages"]);

/** The ping's argv from the live process's launch argv. Everything that
 * shapes the request prefix is kept in order; the rest is replaced. */
export function keepWarmArgs(
  launchArgs: readonly string[],
  files: { sessionId: string; mcpConfigPath: string | null; settingsPath: string | null; systemPromptPath: string | null },
): string[] {
  const kept: string[] = [];
  for (let i = 0; i < launchArgs.length; i++) {
    const arg = launchArgs[i]!;
    if (VALUE_FLAGS.has(arg)) { i++; continue; }
    if (BARE_FLAGS.has(arg)) continue;
    kept.push(arg);
  }
  if (kept[0] !== "-p") kept.unshift("-p");
  kept.push("--output-format", "json");
  if (files.systemPromptPath) kept.push("--append-system-prompt-file", files.systemPromptPath);
  if (files.mcpConfigPath) kept.push("--mcp-config", files.mcpConfigPath);
  if (files.settingsPath) kept.push("--settings", files.settingsPath);
  kept.push("--resume", files.sessionId, "--fork-session", "--no-session-persistence");
  return kept;
}

/** The launch's MCP servers with the harness's permission proxy pointed at
 * `deadSocket`, where nobody answers: its tool list is unchanged (so is the
 * prefix) and any approval it is asked for is denied. */
export function keepWarmMcpServers(mcpServers: Record<string, unknown>, deadSocket: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...mcpServers };
  const ogb = out.ogb as { args?: unknown } | undefined;
  if (ogb && Array.isArray(ogb.args) && ogb.args.length >= 2) {
    out.ogb = { ...ogb, args: [...ogb.args.slice(0, -1), deadSocket] };
  }
  return out;
}

/** The launch's settings without the harness's hooks, plus a PreToolUse hook
 * that denies every tool call. Hooks never enter the request prefix. */
export function keepWarmSettings(settings: Record<string, unknown> | null, denyCommand: string): Record<string, unknown> {
  const { hooks: _harnessHooks, ...rest } = settings ?? {};
  return {
    ...rest,
    hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: denyCommand, timeout: 10 }] }] },
  };
}

export const KEEP_WARM_DENY_HOOK = `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Sagax keep-warm ping: no tools" } }));\n`;

const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/** Reads the CLI's `--output-format json` result into a ping result. */
export function parseKeepWarmResult(stdout: string, stderr: string, code: number | null): CacheWarmPingResult {
  let frame: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) frame = parsed as Record<string, unknown>;
  } catch {
    // not JSON: the CLI failed before it could answer (an unknown flag, a
    // session it cannot resume); its own words are in stderr
  }
  if (!frame || frame.type !== "result") {
    const said = (stderr.trim() || stdout.trim()).split("\n").pop()?.slice(0, 300) ?? "";
    return { ok: false, reason: said ? `the ping failed: ${said}` : `the ping exited ${code ?? "without a code"}` };
  }
  const text = typeof frame.result === "string" ? frame.result : "";
  if (frame.is_error === true) {
    const limit = frame.api_error === "usage_limit_reached" || USAGE_LIMIT.test(text);
    return { ok: false, reason: limit ? "the account's usage limit refused the ping" : `the ping failed: ${text.slice(0, 300) || "API error"}`, ...(limit ? { limit: true } : {}) };
  }
  const usage = (frame.usage ?? {}) as Record<string, unknown>;
  const models = frame.modelUsage && typeof frame.modelUsage === "object" && !Array.isArray(frame.modelUsage)
    ? Object.keys(frame.modelUsage) : [];
  return {
    ok: true,
    input: count(usage.input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    output: count(usage.output_tokens),
    costUsd: typeof frame.total_cost_usd === "number" && Number.isFinite(frame.total_cost_usd) ? frame.total_cost_usd : null,
    model: models[0] ?? null,
  };
}

/** Runs one ping. Never throws: a failure is a result with its reason. The
 * private files (MCP config with credentials, settings, system prompt) live
 * in a 0700 temp dir that is removed when the process ends. */
export function runKeepWarmPing(opts: {
  cli: string;
  contract: KeepWarmContract;
  sessionId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<CacheWarmPingResult> {
  const { contract } = opts;
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), "sagax-keepwarm-"));
  } catch (error) {
    return Promise.resolve({ ok: false, reason: `the ping could not start: ${(error as Error).message}` });
  }
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ } };
  let args: string[];
  const env: NodeJS.ProcessEnv = { ...contract.env };
  try {
    const denyPath = join(dir, "deny-tools.mjs");
    writeFileSync(denyPath, KEEP_WARM_DENY_HOOK, { mode: 0o600 });
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(keepWarmSettings(contract.settings, `"${process.execPath}" "${denyPath}"`)), { mode: 0o600 });
    let mcpConfigPath: string | null = null;
    if (contract.mcpServers) {
      mcpConfigPath = join(dir, "mcp.json");
      writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: keepWarmMcpServers(contract.mcpServers, join(dir, "no-broker.sock")) }), { mode: 0o600 });
    }
    let systemPromptPath: string | null = null;
    if (contract.system) {
      systemPromptPath = join(dir, "prompt.txt");
      writeFileSync(systemPromptPath, contract.system, { mode: 0o600 });
    }
    args = keepWarmArgs(contract.args, { sessionId: opts.sessionId, mcpConfigPath, settingsPath, systemPromptPath });
    // The harness's hook helper must never hear about a ping.
    for (const key of Object.keys(env)) if (key.startsWith("SAGAX_HOOK_") || key.startsWith("OMB_HOOK_")) delete env[key];
    // In the packaged app process.execPath is Electron: the deny hook runs it as node.
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  } catch (error) {
    cleanup();
    return Promise.resolve({ ok: false, reason: `the ping could not start: ${(error as Error).message}` });
  }
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(opts.cli, args, { cwd: contract.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      cleanup();
      resolve({ ok: false, reason: `the ping could not start: ${(error as Error).message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CacheWarmPingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      cleanup();
      resolve(result);
    };
    const onAbort = () => {
      void killCliTree(child);
      finish({ ok: false, reason: "the ping was interrupted" });
    };
    const timer = setTimeout(() => {
      void killCliTree(child);
      finish({ ok: false, reason: "the ping timed out" });
    }, opts.timeoutMs ?? KEEP_WARM_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) {
        void killCliTree(child);
        finish({ ok: false, reason: "the ping's output exceeded 1 MB" });
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8_192); });
    child.on("error", (error) => finish({ ok: false, reason: `the ping could not start: ${error.message}` }));
    child.on("close", (code) => finish(parseKeepWarmResult(stdout, stderr, code)));
    if (opts.signal?.aborted) onAbort();
    else {
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdin.on("error", () => { /* a CLI that exits early closes stdin */ });
      child.stdin.end(KEEP_WARM_PROMPT);
    }
  });
}
