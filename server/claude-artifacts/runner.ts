/**
 * One claude.ai artifact call (Artifact, ArtifactData or ArtifactComments)
 * run as a short `claude -p` in the person's own Claude config dir (#2018).
 *
 * The caller resolves the person's account first (claudeAccountForPrincipal
 * in server/index.ts): this module never picks an account itself, so a call
 * only ever reads or publishes through the account it is handed.
 *
 * The CLI gets the three artifact tools, ToolSearch (ArtifactData and
 * ArtifactComments are deferred) and Read scoped to a private staging folder
 * that holds the page to publish. Isolation follows oneShotIsolationArgs: no
 * MCP server, no settings, no CLAUDE.md, a one-line system prompt.
 */
import { copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isArtifactConsentRefusal } from "../../shared/claude-chat-blocks.ts";
import { oneShotIsolationArgs, type ClaudeCliVersion } from "../drivers/claude.ts";
import { claudeAccountEmail } from "../drivers/claude/helpers.ts";
import { readPinnedToolCall, runPinnedClaudeCall, type PinnedClaudeChild, type PinnedClaudeSpawn } from "./pinned-call.ts";

export const CLAUDE_ARTIFACT_TOOLS = ["Artifact", "ArtifactData", "ArtifactComments"] as const;
export type ClaudeArtifactTool = typeof CLAUDE_ARTIFACT_TOOLS[number];

export const CLAUDE_ARTIFACT_MODEL = "haiku";
export const CLAUDE_ARTIFACT_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = "Make exactly the tool calls the user message names, in that order, with exactly the inputs it gives, then stop. Load a deferred tool with ToolSearch first when needed. Reply with nothing else.";

export interface ClaudeArtifactAccount {
  cli: string;
  env: NodeJS.ProcessEnv;
}

export type ClaudeArtifactRunResult =
  | { ok: true; result: unknown; text: string }
  | { ok: false; error: string }
  | { ok: false; blocked: "other_account"; account?: string };

type Child = PinnedClaudeChild;
export type ClaudeArtifactSpawn = PinnedClaudeSpawn;

export interface RunClaudeArtifactOptions {
  account: ClaudeArtifactAccount;
  tool: ClaudeArtifactTool;
  input: Record<string, unknown>;
  /** a page to publish: written into the staging folder, becomes input.file_path */
  html?: string;
  /** an already-checked absolute path: copied into the staging folder, becomes input.file_path */
  file?: string;
  version?: ClaudeCliVersion | null;
  timeoutMs?: number;
  model?: string;
  spawn?: ClaudeArtifactSpawn;
  kill?: (child: Child) => unknown;
  /** where the private staging folder is made (tests) */
  stagingRoot?: string;
}

/** The argv of one call, staging folder known. */
export function claudeArtifactArgs(stagingDir: string, version: ClaudeCliVersion | null = null, model = CLAUDE_ARTIFACT_MODEL): string[] {
  // The artifact tools exist only on a CLI recent enough for every isolation
  // flag: with no version known, isolate anyway.
  const known = oneShotIsolationArgs(version);
  const isolation = known.length ? [...known] : ["--strict-mcp-config", "--setting-sources", ""];
  const tools = "Artifact,ArtifactData,ArtifactComments,ToolSearch,Read";
  const toolsAt = isolation.indexOf("--tools");
  if (toolsAt >= 0) isolation.splice(toolsAt, 2);
  const promptAt = isolation.indexOf("--system-prompt");
  if (promptAt >= 0) isolation.splice(promptAt, 2);
  // Claude permission rules: `//abs/path` is an absolute path.
  const readRule = `Read(/${stagingDir.replace(/\/+$/, "")}/**)`;
  return [
    "-p", "--model", model,
    "--output-format", "stream-json", "--verbose",
    "--tools", tools,
    "--allowedTools", `Artifact,ArtifactData,ArtifactComments,ToolSearch,${readRule}`,
    "--permission-mode", "dontAsk",
    ...isolation,
    "--system-prompt", SYSTEM_PROMPT,
  ];
}

export function claudeArtifactEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    CLAUDE_CODE_ARTIFACT: "1",
    CLAUDE_CODE_ARTIFACT_TOOLSET: "1",
    ENABLE_TOOL_SEARCH: "true",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
}

export function claudeArtifactPrompt(tool: ClaudeArtifactTool, input: Record<string, unknown>): string {
  // claude.ai refuses to update an artifact this CLI process has not read, and
  // every call is a fresh process: read it first, in the same process.
  if (isUpdatePublish(tool, input)) {
    return `Call the tool Artifact with ${JSON.stringify({ action: "read", url: input.url })} first, then call the tool Artifact exactly once with this input JSON, then stop:\n${JSON.stringify(input)}`;
  }
  return `Call the tool ${tool} exactly once with this input JSON, then stop:\n${JSON.stringify(input)}`;
}

function isUpdatePublish(tool: ClaudeArtifactTool, input: Record<string, unknown>): boolean {
  return tool === "Artifact" && (input.action === undefined || input.action === "publish") && typeof input.url === "string" && input.asset !== true;
}

/** In dontAsk mode with every artifact tool allowed, the only denial left is
 * the tool's own ask: an artifact of another claude.ai account. */
const DONT_ASK_DENIAL = /^Permission to use Artifact(Data|Comments)? has been denied because Claude Code is running in don't ask mode/;

/** The result of the one `tool` call in a stream-json transcript. */
export function parseClaudeArtifactStream(stdout: string, tool: ClaudeArtifactTool, accountEmail?: string, action?: string): ClaudeArtifactRunResult {
  const reading = readPinnedToolCall(stdout, (use) => use.name === tool
    && (action === undefined || ((use.input as { action?: unknown } | undefined)?.action ?? "publish") === action));
  if (reading.result) {
    const { text, isError, structured } = reading.result;
    if (isArtifactConsentRefusal(text) || DONT_ASK_DENIAL.test(text.trim())) return { ok: false, blocked: "other_account", ...(accountEmail ? { account: accountEmail } : {}) };
    if (isError) return { ok: false, error: text.trim().slice(0, 2_000) || `${tool} failed` };
    return { ok: true, result: structured === undefined ? text : structured, text };
  }
  const finalText = reading.finalText;
  if (isArtifactConsentRefusal(finalText)) return { ok: false, blocked: "other_account", ...(accountEmail ? { account: accountEmail } : {}) };
  const reason = finalText.trim().slice(0, 2_000);
  return { ok: false, error: reason ? (reading.finalError ? reason : `${tool} was not called: ${reason}`) : `${tool} was not called` };
}

/** Run one artifact call. Never throws. */
export async function runClaudeArtifact(options: RunClaudeArtifactOptions): Promise<ClaudeArtifactRunResult> {
  let staging: string;
  try {
    staging = realpathSync(mkdtempSync(join(options.stagingRoot ?? tmpdir(), "sagax-claude-artifact-")));
  } catch (error) {
    return { ok: false, error: `staging folder: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const input: Record<string, unknown> = { ...options.input };
    if (options.html !== undefined) {
      const target = join(staging, "page.html");
      writeFileSync(target, options.html, { mode: 0o600 });
      input.file_path = target;
    } else if (options.file) {
      const target = join(staging, basename(options.file) || "page.html");
      copyFileSync(options.file, target);
      input.file_path = target;
    }
    const env = claudeArtifactEnv(options.account.env);
    const email = claudeAccountEmail(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
    const args = claudeArtifactArgs(staging, options.version ?? null, options.model);
    const stdout = await runPinnedClaudeCall({
      cli: options.account.cli,
      args,
      env,
      cwd: staging,
      prompt: claudeArtifactPrompt(options.tool, input),
      timeoutMs: options.timeoutMs ?? CLAUDE_ARTIFACT_TIMEOUT_MS,
      label: options.tool,
      ...(options.spawn ? { spawn: options.spawn } : {}),
      ...(options.kill ? { kill: options.kill } : {}),
    });
    const parsed = parseClaudeArtifactStream(stdout.out, options.tool, email, isUpdatePublish(options.tool, input) ? "publish" : undefined);
    if (stdout.error && !parsed.ok && "error" in parsed) return { ok: false, error: stdout.error };
    return parsed;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try { rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
