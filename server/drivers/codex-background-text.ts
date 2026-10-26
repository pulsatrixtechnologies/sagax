// One tool-free `codex exec` call for the harness's background steps —
// memory capture, organize and contradiction checks (server/memory-upkeep.ts)
// and the automatic skill review (server/skill-review.ts). The Codex
// counterpart of ./acp/background-text.ts: a fresh process with no session
// saved, never a chat's app-server or thread, so a background call never
// lands in a conversation's history, and the prompt reaches only the
// provider the bot already uses.
//
// Isolation, all in argv so the same call runs on a desktop, a server and a
// Cloud home:
//   - the person's config.toml is not loaded (`--ignore-user-config`): none
//     of their MCP servers, plugins, notify program or profiles start. Codex
//     still signs in from the same CODEX_HOME, so the account is the turn's;
//   - the shell, apps, plugins, sub-agents, image tools, web search and hooks
//     are switched off, and the sandbox is read-only, so the model has no
//     tool that could act;
//   - the working folder is an empty temporary one, never the bot's;
//   - `--ephemeral`: no session file is written; the prompt goes in on
//     stdin, never argv, so it never shows in a process listing.
// It fails closed: an item that is not the model's own text or reasoning (a
// command, a file change, an MCP or web call) ends the call before its
// result is read.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelCatalog, TextGenerationOptions, TextGenerationUsage } from "../contracts.ts";
import type { killCliTree, spawnCli } from "../procs.ts";
import { decodeCodexSelection, OFFICIAL_CODEX_PROVIDER } from "./codex-catalog.ts";
import { codexToolSurfaceArgs } from "./codex-tool-surface.ts";

export const CODEX_BACKGROUND_TIMEOUT_MS = 120_000;
/** More than any capture, organize, contradiction or review answer needs. */
export const CODEX_BACKGROUND_MAX_CHARS = 200_000;
const MAX_STDOUT_BYTES = 4_000_000;

/** Background calls run on the person's own Codex plan (or their Company's
 * key), on every finished chat and every nightly tidy-up, so they use the
 * smallest model the account lists, the way Claude upkeep uses Haiku.
 * GPT-6 Luna is the catalog's "fast and affordable model for easier tasks";
 * the older Luna and GPT-5.4 Mini follow for accounts that do not list it.
 * Extracting facts and judging a skill is easy work: low effort is enough. */
export const CODEX_BACKGROUND_MODELS = ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"] as const;
export const CODEX_BACKGROUND_EFFORT = "low";
const SMALL_MODEL = /(?:^|[-.])(?:luna|mini|nano)(?:$|[-.])/i;

/** The model a background call uses: a listed small model on the official
 * provider, else the catalog's own default (a Company's first approved model,
 * or whatever the account offers). Null when the catalog lists nothing. */
export function codexBackgroundModel(catalog: ModelCatalog): string | null {
  const listed = catalog.options.filter((option) => !option.custom);
  const official = listed.filter((option) => decodeCodexSelection(option.id).modelProvider === OFFICIAL_CODEX_PROVIDER);
  for (const id of CODEX_BACKGROUND_MODELS) if (official.some((option) => option.id === id)) return id;
  const small = official.find((option) => SMALL_MODEL.test(option.id));
  if (small) return small.id;
  return catalog.default || listed[0]?.id || catalog.options[0]?.id || null;
}

/** Codex features off for a background call (codex-cli 0.160.1 `codex
 * features list`): every tool, and everything that starts or writes something
 * beside the answer. A name an older Codex does not know is ignored there. */
const BACKGROUND_FEATURES_OFF = [
  "shell_tool", "unified_exec", "shell_snapshot", "view_image", "image_generation",
  "apps", "plugins", "remote_plugin", "multi_agent", "hooks", "memories", "goals",
  "skill_mcp_dependency_install", "tool_suggest", "sleep_tool", "daemon_auto_start",
] as const;

export interface CodexBackgroundArgsInput {
  /** The model id as `-m` takes it (a bare id; a provider rides separately). */
  model: string;
  /** `-c model_provider=…` for a provider other than Codex's default. */
  modelProvider?: string | null;
  /** The account's routing, as a turn's app-server gets it: ChatGPT plan or
   * Company overrides, or a local provider's definition. */
  providerArgs: readonly string[];
  /** The empty working folder. */
  cwd: string;
}

/** `codex exec` argv for one background call. The prompt is read from stdin
 * (the trailing `-`). */
export function codexBackgroundArgs(input: CodexBackgroundArgsInput): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox", "read-only",
    "--cd", input.cwd,
    "--model", input.model,
    "-c", `model_reasoning_effort=${JSON.stringify(CODEX_BACKGROUND_EFFORT)}`,
    "-c", 'approval_policy="never"',
    "-c", 'web_search="disabled"',
    ...(input.modelProvider ? ["-c", `model_provider=${JSON.stringify(input.modelProvider)}`] : []),
    ...input.providerArgs,
    ...codexToolSurfaceArgs(),
    ...BACKGROUND_FEATURES_OFF.flatMap((feature) => ["-c", `features.${feature}=false`]),
    "-",
  ];
}

/** Item types a background answer may contain: the model's text, its
 * reasoning, a plan update, and Codex's own non-fatal notices. */
const QUIET_ITEMS = new Set(["agent_message", "reasoning", "todo_list", "error"]);

export interface CodexOneShotInput {
  spawn: typeof spawnCli;
  kill: typeof killCliTree;
  cli: string;
  env: Record<string, string | undefined>;
  prompt: string;
  model: string;
  modelProvider?: string | null;
  providerArgs: readonly string[];
  options?: TextGenerationOptions;
  timeoutMs?: number;
  /** Codex's own words for a failed call, made readable (codexUserError). */
  describeError?: (message: string) => string;
}

/** Run one background call and return the model's last message. */
export async function runCodexOneShot(input: CodexOneShotInput): Promise<string> {
  const { signal, onUsage } = input.options ?? {};
  if (signal?.aborted) throw new Error("Codex background call aborted");
  const cwd = mkdtempSync(join(tmpdir(), "omb-codex-background-"));
  try {
    return await new Promise<string>((resolve, reject) => {
      const argv = codexBackgroundArgs({ model: input.model, modelProvider: input.modelProvider, providerArgs: input.providerArgs, cwd });
      const child = input.spawn(input.cli, argv, { cwd, env: input.env, stdio: ["pipe", "pipe", "pipe"] });
      const describe = input.describeError ?? ((message: string) => message.slice(0, 400));
      let settled = false;
      let closed = false;
      let buffer = "";
      let received = 0;
      let stderr = "";
      let answer = "";
      /** turn.failed: Codex's own words for why. */
      let failure = "";
      /** A top-level error event: fatal unless the turn still completes. */
      let fatal = "";
      let usage: TextGenerationUsage | undefined;
      let completed = false;

      const finish = async (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        // The caller removes the folder only after the process is gone:
        // Windows keeps it locked until then.
        if (!closed) await input.kill(child).catch(() => undefined);
        if (!error && usage) {
          try {
            onUsage?.(usage);
          } catch {
            error = new Error("Codex background usage callback failed");
          }
        }
        if (error) reject(error);
        else if (!answer.trim()) reject(new Error("Codex background call returned no text"));
        else resolve(answer.trim());
      };
      const abort = () => void finish(new Error("Codex background call aborted"));
      const timer = setTimeout(() => void finish(new Error("Codex background call timed out")), input.timeoutMs ?? CODEX_BACKGROUND_TIMEOUT_MS);
      timer.unref?.();

      const onEvent = (event: any) => {
        const type = event?.type;
        if (type === "item.started" || type === "item.updated" || type === "item.completed") {
          const item = event.item ?? {};
          if (!QUIET_ITEMS.has(item.type)) {
            void finish(new Error(`Codex background call tried to use a tool (${String(item.type ?? "unknown")})`));
            return;
          }
          if (type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") {
            answer = item.text;
            if (answer.length > CODEX_BACKGROUND_MAX_CHARS) void finish(new Error("Codex background answer exceeded its limit"));
          }
          return;
        }
        if (type === "turn.completed") {
          completed = true;
          const reported = event.usage ?? {};
          const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
          // codex's input_tokens already includes the cached share, which
          // rides alongside (as a turn's thread/tokenUsage does).
          usage = {
            model: input.model,
            input: count(reported.input_tokens),
            output: count(reported.output_tokens),
            ...(count(reported.cached_input_tokens) !== undefined ? { cachedInput: count(reported.cached_input_tokens) } : {}),
          };
          return;
        }
        if (type === "turn.failed") {
          failure = typeof event.error?.message === "string" ? event.error.message : "the turn failed";
          return;
        }
        // A top-level error (a stream that could not reconnect, a refused
        // sign-in): Codex follows it with turn.failed or an exit.
        if (type === "error" && typeof event.message === "string") fatal ||= event.message;
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        received += chunk.length;
        if (received > MAX_STDOUT_BYTES) return void finish(new Error("Codex background output exceeded its limit"));
        buffer += chunk;
        let newline: number;
        while (!settled && (newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            // only JSON lines are events
            continue;
          }
          onEvent(event);
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8_192);
      });
      child.on("error", (error) => void finish(error instanceof Error ? error : new Error(String(error))));
      child.on("close", (code) => {
        closed = true;
        if (settled) return;
        if (buffer.trim()) {
          try { onEvent(JSON.parse(buffer)); } catch { /* not an event */ }
          buffer = "";
        }
        if (failure || (!completed && fatal)) return void finish(new Error(`Codex background call failed: ${describe(failure || fatal)}`));
        if (!completed) {
          const said = stderr.trim().split("\n").filter(Boolean).at(-1);
          return void finish(new Error(`Codex background call exited ${code ?? "on a signal"}${said ? `: ${describe(said)}` : ""}`));
        }
        void finish();
      });
      signal?.addEventListener("abort", abort, { once: true });
      child.stdin.on("error", () => { /* the close handler reports a dead child */ });
      child.stdin.end(input.prompt);
    });
  } finally {
    // On Windows the process can hold the folder a moment after it exits; a
    // cleanup failure never replaces the call's own result or error.
    try { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* left for the OS */ }
  }
}
