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
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { isArtifactConsentRefusal } from "../../shared/claude-chat-blocks.ts";
import { oneShotIsolationArgs, type ClaudeCliVersion } from "../drivers/claude.ts";
import { claudeAccountEmail } from "../drivers/claude/helpers.ts";
import { killCliTree, spawnCli } from "../procs.ts";

export const CLAUDE_ARTIFACT_TOOLS = ["Artifact", "ArtifactData", "ArtifactComments"] as const;
export type ClaudeArtifactTool = typeof CLAUDE_ARTIFACT_TOOLS[number];

export const CLAUDE_ARTIFACT_MODEL = "haiku";
export const CLAUDE_ARTIFACT_TIMEOUT_MS = 90_000;
const STDOUT_CAP = 4_000_000;

const SYSTEM_PROMPT = "Make exactly the tool calls the user message names, in that order, with exactly the inputs it gives, then stop. Load a deferred tool with ToolSearch first when needed. Reply with nothing else.";

export interface ClaudeArtifactAccount {
  cli: string;
  env: NodeJS.ProcessEnv;
}

export type ClaudeArtifactRunResult =
  | { ok: true; result: unknown; text: string }
  | { ok: false; error: string }
  | { ok: false; blocked: "other_account"; account?: string };

type Child = ChildProcessByStdio<Writable, Readable, Readable>;
export type ClaudeArtifactSpawn = (cli: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd: string }) => Child;

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

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")
    .filter(Boolean)
    .join("\n");
}

/** The result of the one `tool` call in a stream-json transcript. */
export function parseClaudeArtifactStream(stdout: string, tool: ClaudeArtifactTool, accountEmail?: string, action?: string): ClaudeArtifactRunResult {
  let callId: string | undefined;
  let finalText = "";
  let finalError = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = frame.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content as Array<Record<string, unknown>> : [];
    if (frame.type === "assistant" && !callId) {
      const use = content.find((block) => block?.type === "tool_use" && block.name === tool && typeof block.id === "string"
        && (action === undefined || ((block.input as { action?: unknown } | undefined)?.action ?? "publish") === action));
      if (use) callId = use.id as string;
    } else if (frame.type === "user" && callId) {
      const result = content.find((block) => block?.type === "tool_result" && block.tool_use_id === callId);
      if (!result) continue;
      const text = blockText(result.content);
      if (isArtifactConsentRefusal(text) || DONT_ASK_DENIAL.test(text.trim())) return { ok: false, blocked: "other_account", ...(accountEmail ? { account: accountEmail } : {}) };
      if (result.is_error === true) return { ok: false, error: text.trim().slice(0, 2_000) || `${tool} failed` };
      const structured = frame.tool_use_result ?? frame.toolUseResult;
      return { ok: true, result: structured === undefined ? text : structured, text };
    } else if (frame.type === "result") {
      finalText = typeof frame.result === "string" ? frame.result : "";
      finalError = frame.is_error === true;
    }
  }
  if (isArtifactConsentRefusal(finalText)) return { ok: false, blocked: "other_account", ...(accountEmail ? { account: accountEmail } : {}) };
  const reason = finalText.trim().slice(0, 2_000);
  return { ok: false, error: reason ? (finalError ? reason : `${tool} was not called: ${reason}`) : `${tool} was not called` };
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
    const spawnChild: ClaudeArtifactSpawn = options.spawn
      ?? ((cli, argv, opts) => spawnCli(cli, argv, { stdio: ["pipe", "pipe", "pipe"], env: opts.env, cwd: opts.cwd }));
    const kill = options.kill ?? ((child: Child) => killCliTree(child));
    const stdout = await new Promise<{ out: string; error?: string }>((resolve) => {
      let child: Child;
      try {
        child = spawnChild(options.account.cli, args, { env, cwd: staging });
      } catch (error) {
        resolve({ out: "", error: error instanceof Error ? error.message : String(error) });
        return;
      }
      let out = "";
      let errTail = "";
      let settled = false;
      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ out, ...(error ? { error } : {}) });
      };
      const timer = setTimeout(() => {
        kill(child);
        finish(`${options.tool} timed out`);
      }, options.timeoutMs ?? CLAUDE_ARTIFACT_TIMEOUT_MS);
      timer.unref?.();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
        if (out.length > STDOUT_CAP) {
          kill(child);
          finish(`${options.tool} output too large`);
        }
      });
      child.stderr.on("data", (chunk: string) => { errTail = (errTail + chunk).slice(-2_000); });
      child.on("error", (error) => finish(error.message));
      child.on("close", (code) => finish(code && !out.trim() ? (errTail.trim() || `claude exited with ${code}`) : undefined));
      child.stdin.on("error", () => {});
      child.stdin.end(claudeArtifactPrompt(options.tool, input));
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
