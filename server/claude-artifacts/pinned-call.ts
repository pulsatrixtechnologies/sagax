/**
 * One pinned `claude -p` call (#2018, shared with the Claude connector host
 * of #3352): the process is started with the prompt on stdin, its
 * stream-json output is collected under a size cap and a time limit, and the
 * result of the one tool call the prompt names is read from the stream, not
 * from the model's words.
 *
 * The artifact runner (runner.ts) and the connector host
 * (server/connectors/hosts/claude-host.ts) each pick their own flags; this
 * module only runs the process and reads the frames.
 */
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { killCliTree, spawnCli } from "../procs.ts";

export type PinnedClaudeChild = ChildProcessByStdio<Writable, Readable, Readable>;
export type PinnedClaudeSpawn = (cli: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd: string }) => PinnedClaudeChild;

const STDOUT_CAP = 4_000_000;

export interface PinnedClaudeCallOptions {
  cli: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** written to stdin, which is then closed */
  prompt: string;
  timeoutMs: number;
  /** names the call in a timeout or size error ("<label> timed out") */
  label: string;
  spawn?: PinnedClaudeSpawn;
  kill?: (child: PinnedClaudeChild) => unknown;
  /** the child once started, until it closes (a host stops it at shutdown) */
  onChild?: (child: PinnedClaudeChild, running: boolean) => void;
}

/** Run the process to its end. Never throws. */
export function runPinnedClaudeCall(options: PinnedClaudeCallOptions): Promise<{ out: string; error?: string }> {
  const spawnChild: PinnedClaudeSpawn = options.spawn
    ?? ((cli, argv, opts) => spawnCli(cli, argv, { stdio: ["pipe", "pipe", "pipe"], env: opts.env, cwd: opts.cwd }));
  const kill = options.kill ?? ((child: PinnedClaudeChild) => killCliTree(child));
  return new Promise((resolve) => {
    let child: PinnedClaudeChild;
    try {
      child = spawnChild(options.cli, options.args, { env: options.env, cwd: options.cwd });
    } catch (error) {
      resolve({ out: "", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    options.onChild?.(child, true);
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
      finish(`${options.label} timed out`);
    }, options.timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.length > STDOUT_CAP) {
        kill(child);
        finish(`${options.label} output too large`);
      }
    });
    child.stderr.on("data", (chunk: string) => { errTail = (errTail + chunk).slice(-2_000); });
    child.on("error", (error) => finish(error.message));
    child.on("close", (code) => {
      options.onChild?.(child, false);
      finish(code && !out.trim() ? (errTail.trim() || `claude exited with ${code}`) : undefined);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.prompt);
  });
}

/** The text of a tool result's content (a string or text blocks). */
export function pinnedBlockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")
    .filter(Boolean)
    .join("\n");
}

export type PinnedToolUse = Record<string, unknown> & { type: "tool_use"; id: string; name: string; input?: unknown };

export interface PinnedToolCallReading {
  /** the init frame's servers (`mcp_servers`), as the CLI listed them */
  servers: Array<{ name?: unknown; status?: unknown }>;
  /** the first tool use the matcher took */
  use?: PinnedToolUse;
  /** its result, when the stream holds one */
  result?: { text: string; isError: boolean; structured?: unknown };
  /** the closing result frame, when it came before the tool's result or there was none */
  finalText: string;
  finalError: boolean;
  /** what the CLI refused to run (`permission_denials` of the result frame) */
  denials: Array<{ tool_name?: unknown; tool_input?: unknown }>;
}

/** Read one tool call from a stream-json transcript: the first tool use the
 * matcher takes, and its result. */
export function readPinnedToolCall(stdout: string, matches: (use: PinnedToolUse) => boolean): PinnedToolCallReading {
  const reading: PinnedToolCallReading = { servers: [], finalText: "", finalError: false, denials: [] };
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
    if (frame.type === "system" && frame.subtype === "init" && Array.isArray(frame.mcp_servers)) {
      reading.servers = frame.mcp_servers as PinnedToolCallReading["servers"];
    } else if (frame.type === "assistant" && !reading.use) {
      const use = content.find((block) => block?.type === "tool_use" && typeof block.name === "string" && typeof block.id === "string"
        && matches(block as PinnedToolUse));
      if (use) reading.use = use as PinnedToolUse;
    } else if (frame.type === "user" && reading.use) {
      const result = content.find((block) => block?.type === "tool_result" && block.tool_use_id === reading.use!.id);
      if (!result) continue;
      const structured = frame.tool_use_result ?? frame.toolUseResult;
      reading.result = { text: pinnedBlockText(result.content), isError: result.is_error === true, ...(structured === undefined ? {} : { structured }) };
      return reading;
    } else if (frame.type === "result") {
      reading.finalText = typeof frame.result === "string" ? frame.result : "";
      reading.finalError = frame.is_error === true;
      if (Array.isArray(frame.permission_denials)) reading.denials = frame.permission_denials as PinnedToolCallReading["denials"];
    }
  }
  return reading;
}
