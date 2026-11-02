// Claude driver — upstream ClaudeDriver skeleton over agentcal's
// drivers/claude.js runtime (stream-json both directions, prompt over
// stdin, completion from a real `result` event — verified against
// claude 2.1.211 by agentcal). Per-turn CLI process; the conversation
// continues across turns via --resume <sessionId> (the resumeCursor).
//
// Integrations become MCP servers on the CLI:
//   - every computer (this Mac, a Local VM, a VPS, or a Boat cloud
//     computer through server/harness-mcp-proxy.ts computer) as the one
//     stdio `computer` server in turn.integrations.localComputer
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, unlinkSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DATA_DIR, stripWorkspaceCredentialEnv } from "../config.ts";
import { claudeProtectedDenyRules } from "../engine-protected-paths.ts";
import { augmentedPath } from "../env-path.ts";
import { brokerSocketPath, execCli } from "../procs.ts";
import { rebuiltSessionNotice } from "../resume-recovery.ts";
import { contextRenewedNotice } from "../context-renewal.ts";
import { ClaudeLoginController } from "./claude-login-auth.ts";

import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
} from "../contracts.ts";
import { newId } from "../contracts.ts";
import { askInputDetail, askInputSummary } from "../tool-summary.ts";
import { claudeAuthFailure } from "./claude-auth-recovery.ts";
import { claudeSignInExpired } from "./claude-errors.ts";
import { parseVersionTriple, versionAtLeast } from "./acp/core.ts";
import {
  applyClaudeInject,
  decodeInjectId,
  mergeLocalInject,
  probeLocalInjects,
  resolveInjectId,
} from "./local-inject.ts";
import { permissionCommand, permissionPaths, withAbsolutePaths } from "./permission-command.ts";
import { extractMcpImages } from "../mcp-tool-images.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import {
  ASK_USER_QUESTION_TOOL,
  ASK_USER_TOOL,
  askQuestionSummary,
  parseAskQuestions,
  parseChoices,
  questionChoices,
  type AskQuestion,
} from "../../shared/ask-question.ts";
import { CLAUDE_UNUSED_COMMANDS } from "./host-tools.ts";

export {
  claudeApiErrorMessage,
  claudeContextFull,
  claudeLimitFields,
  claudeLimitMessage,
  claudeLimitRefusal,
  claudeResultError,
  claudeUsageLimit,
  resultRepeatsReply,
  type ClaudeLimit,
} from "./claude/limits.ts";
export {
  COMPACTED_VOLATILE,
  UNDELIVERED_VOLATILE,
  withVolatileNote,
  withReminder,
  volatileTurnMessage,
  claudeUserMessage,
  diagnosticClaudeUserMessage,
} from "./claude/messages.ts";
export {
  claudeCostSnapshot,
  restoredCostBase,
  turnCostFromRunningTotal,
  type ClaudeCostSnapshot,
} from "./claude/cost.ts";
import {
  DRIVER_KIND,
  STATIC_CLAUDE_MODELS,
  decodeConfig,
  resolveClaudeConfigDir,
  type ClaudeCliVersion,
  type ClaudeConfig,
} from "./claude/config.ts";
export {
  DRIVER_KIND,
  NO_ANTHROPIC_KEY,
  STATIC_CLAUDE_MODELS,
  decodeConfig,
  resolveClaudeConfigDir,
  type ClaudeCliVersion,
  type ClaudeConfig,
} from "./claude/config.ts";
export {
  STEERED_CONTINUATION_GRACE_MS,
  STEERED_CONTINUATION_SILENCE_MS,
  type ClaudeSession,
  type NativeTurnResult,
} from "./claude/session-types.ts";
import { createClaudeInstance } from "./claude/create-instance.ts";
import { sumNativeTurnResults as sumNativeTurnResultsFromSession } from "./claude/session-types.ts";
import { claudeVersionTooOld as claudeVersionTooOldFromLimits } from "./claude/limits.ts";
import { claudeUserMessage } from "./claude/messages.ts";
import { unwrapAgentsBridge } from "../../shared/searched-tool-call.ts";

/** Whether `claude` has been signed in.
 *
 * Credential storage is deliberately not inspected here. Claude Code uses the
 * macOS Keychain for OAuth, a JSON file on some platforms, and may gain other
 * backends over time. Presence checks also accept stale credentials. The CLI's
 * own machine-readable auth command is the source of truth for every backend.
 */
function claudeAuthStatus(
  cli: string,
  env: NodeJS.ProcessEnv,
  run: typeof execCli = execCli,
): Promise<{ authenticated: boolean; account?: ProviderSnapshot["account"] }> {
  return new Promise((resolve) => {
    run(cli, ["auth", "status", "--json"], { timeout: 8000, maxBuffer: 65_536, env }, (_error, stdout) => {
      try {
        const status: unknown = JSON.parse(stdout);
        if (!status || typeof status !== "object" || !("loggedIn" in status) || status.loggedIn !== true) {
          return resolve({ authenticated: false });
        }
        // Only display identity fields, never the CLI's full auth response.
        const identity = status as { email?: unknown; orgName?: unknown; authMethod?: unknown };
        const boundedText = (value: unknown, max: number): string | undefined =>
          typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value)
            ? value.trim() : undefined;
        const candidateEmail = boundedText(identity.email, 254);
        const email = candidateEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail) ? candidateEmail : undefined;
        const organization = boundedText(identity.orgName, 160);
        // An API key is a workspace decision, not a person: say so instead
        // of showing an empty identity.
        const account = {
          ...(email ? { email } : {}),
          ...(organization ? { organization } : {}),
          ...(identity.authMethod === "api_key" ? { method: "api-key" as const } : {}),
        };
        resolve({ authenticated: true, ...(Object.keys(account).length ? { account } : {}) });
      } catch {
        resolve({ authenticated: false });
      }
    });
  });
}

export async function claudeSignedIn(
  cli: string,
  env: NodeJS.ProcessEnv,
  run: typeof execCli = execCli,
): Promise<boolean> {
  return (await claudeAuthStatus(cli, env, run)).authenticated;
}

/** Parent-session credentials/routing that a named account must not inherit.
 * Shared with terminal sign-in instructions so login and turns select alike. */
export const CLAUDE_ACCOUNT_ENV_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

/** The system prompt of a one-shot helper call (memory capture, safety
 * review, busy routing, compaction summary): each prompt carries its own
 * instructions, so the CLI's coding-agent prompt is not needed. */
export const ONE_SHOT_SYSTEM_PROMPT = "Answer the request in the user message exactly as it instructs. You have no tools: reply with text only.";

/** Flags that make a one-shot helper call what its comment always said it
 * was: no built-in tool, no MCP server (none from the user's config and no
 * claude.ai connector), no user or project settings and no CLAUDE.md, and a
 * one-line system prompt. Without them `claude -p` loads the whole agent
 * (about 30,000 tokens of tools and prompt before the request, 115,000 on a
 * machine with connectors) for a call that reads one prompt (2026-10-19
 * bench: memory capture 114,760 cache-write tokens and 12.3 s before, about
 * 600 tokens after). An older or unknown CLI keeps the plain call. */
export function oneShotIsolationArgs(version: ClaudeCliVersion | null): string[] {
  if (!version || !claudeCliSupports(version, "--tools") || !claudeCliSupports(version, "--setting-sources") || !claudeCliSupports(version, "--strict-mcp-config")) return [];
  return ["--tools", "", "--strict-mcp-config", "--setting-sources", "", "--system-prompt", ONE_SHOT_SYSTEM_PROMPT];
}

/** What Approve for me pre-allows on Claude Code instead of the CLI's auto
 * classifier (2026-10-19): tools that only read or that never leave the
 * turn. Reads of files need no rule (the CLI never asks for Read, Glob or
 * Grep in the launch folder). No git rule: git runs commands a repository's
 * config names (core.fsmonitor, diff.external, a pager) and writes with
 * --output. No Skill: a skill's `allowed-tools` would grant tools with no
 * card, and acceptEdits may edit a skill. No ls or wc: they reach paths
 * outside the folder. Task's subagents keep this list and the broker.
 * Everything else, an MCP write first, asks on a card. */
export const CLAUDE_AUTO_ALLOWED_TOOLS: readonly string[] = [
  "WebSearch", "TodoWrite", "ToolSearch", "Task", "Bash(pwd)",
];

export function claudeAutoAllowedTools(): string[] {
  return [...CLAUDE_AUTO_ALLOWED_TOOLS];
}

/** Whether a stream frame is the CLI reporting that it has no login.
 *
 * The CLI flags its own api-error frames (`error`, `is_api_error_message`);
 * a model reply never carries them. Requiring that flag first is what keeps
 * an answer that merely discusses being logged out from being read as a
 * failure — the text classifier runs only once the CLI has already called
 * the frame an error, and covers CLI builds that flag the frame without
 * naming the reason.
 */
export { claudeAuthFailure };

export const claudeVersionTooOld = claudeVersionTooOldFromLimits;

/** The CLI stopping a turn because its context is full: the compaction
 * breaker (2.1.312: an api-error frame with `api_error`
 * "autocompact_thrashing", "Autocompact is thrashing: the context refilled
 * to the limit within 3 turns of the previous compact, 3 times in a row…",
 * then a result whose terminal reason is "rapid_refill_breaker"), or the
 * API refusing a prompt past the window ("prompt is too long"). Gated on
 * the CLI's error flag, like a sign-in failure: a reply that only talks
 * about context is a reply. */
/** The CLI environment shared by auth probes and real turns.
 *
 * Subscription users can be billed pay-as-you-go if an inherited API key
 * leaks through, and a nested CLI must not inherit this session's identity.
 * Keeping the probe and turn environments identical prevents setup from
 * claiming an API-key login that the turn itself would deliberately remove.
 */
function claudeEnvironment(
  model?: string | null,
  source: NodeJS.ProcessEnv = process.env,
  configDir?: string,
  instanceEnvironment: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { BASH_MAX_TIMEOUT_MS: "600000", ...source, PATH: augmentedPath(), NPM_CONFIG_LOGLEVEL: "error" };
  if (configDir?.trim()) {
    env.CLAUDE_CONFIG_DIR = resolveClaudeConfigDir(configDir, env);
    for (const key of CLAUDE_ACCOUNT_ENV_KEYS) {
      // Explicit custom endpoint settings still work; subscription OAuth
      // always belongs to this account's CLI-managed login, never its parent.
      if (key.startsWith("CLAUDE_CODE_OAUTH_") || key.endsWith("_FILE_DESCRIPTOR") || !Object.hasOwn(instanceEnvironment, key)) {
        delete env[key];
      }
    }
  } else if (env.CLAUDE_CONFIG_DIR) {
    env.CLAUDE_CONFIG_DIR = resolveClaudeConfigDir(undefined, env);
  }
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // The harness process may hold workspace credentials (xai/box/voice keys,
  // env-injected at boot); none of them are this CLI's to see.
  stripWorkspaceCredentialEnv(env);
  const applied = applyClaudeInject(env, model);
  // A key set on purpose for this workspace (Settings → API keys, carried
  // in the instance environment) stays. One riding along in the parent's
  // env never does: it would flip a subscription login to pay-as-you-go.
  if (!applied.injected && !instanceEnvironment.ANTHROPIC_API_KEY) delete env.ANTHROPIC_API_KEY;
  return env;
}

/** Escape hatch back to the pre-isolation launch, where a bot inherited this
 * machine's Claude Code setup: its MCP servers and connectors, skills,
 * agents, hooks and personal CLAUDE.md. Set it only to recover a bot that
 * genuinely depended on a user- or local-scope MCP server; the supported way
 * to give a bot a server is the app's own `mcpServers` config or the bot
 * project's `.mcp.json`. */
function inheritsUserConfig(env: NodeJS.ProcessEnv): boolean {
  return env.SAGAX_CLAUDE_INHERIT_USER_CONFIG === "1";
}

/** The Engines-page warning while the escape hatch is set. The flag is a
 * footgun: it is invisible once exported, and what it costs — every Claude
 * bot re-reading this machine's own servers, skills, hooks and CLAUDE.md on
 * every model call — shows up only on the bill. Naming it where the person
 * looks when something is off is the whole point. */
export function claudeInheritWarning(env: NodeJS.ProcessEnv): ProviderSnapshot["warning"] | undefined {
  if (!inheritsUserConfig(env)) return undefined;
  return {
    title: "Bots inherit this machine's Claude Code setup",
    message:
      "SAGAX_CLAUDE_INHERIT_USER_CONFIG=1 is set on the Sagax process, so every Claude bot also loads this " +
      "computer's own MCP servers, connectors, skills, hooks and personal CLAUDE.md on every turn — often thousands " +
      "of extra tokens per model call, and tools nobody gave the bot. Unless a bot genuinely needs a server from " +
      "your user-scope Claude config, remove the variable and restart; add the server under Settings → MCP servers " +
      "or the bot project's .mcp.json instead.",
  };
}

/** Retain the selected CLI account's authentication without importing its
 * hooks, permissions, MCP servers or personal instructions. Explicit OMB
 * connections/local endpoints own their entire routing + credential pair. */
export function readClaudeAuthSettings(
  env: NodeJS.ProcessEnv,
  instanceEnvironment: NodeJS.ProcessEnv = {},
): { env?: Record<string, string>; apiKeyHelper?: string } {
  if (CLAUDE_ACCOUNT_ENV_KEYS.some((key) => instanceEnvironment[key])) return {};
  try {
    const settings = JSON.parse(readFileSync(join(resolveClaudeConfigDir(undefined, env), "settings.json"), "utf8"));
    const authEnv: Record<string, string> = {};
    for (const key of CLAUDE_ACCOUNT_ENV_KEYS) {
      if (!key.endsWith("_FILE_DESCRIPTOR") && typeof settings?.env?.[key] === "string") {
        authEnv[key] = settings.env[key];
      }
    }
    return {
      ...(Object.keys(authEnv).length ? { env: authEnv } : {}),
      ...(typeof settings?.apiKeyHelper === "string" && settings.apiKeyHelper.trim()
        ? { apiKeyHelper: settings.apiKeyHelper } : {}),
    };
  } catch {
    return {};
  }
}

/** MCP servers the bot's own project declares in `<cwd>/.mcp.json`.
 *
 * The CLI would find this file itself, but the harness launches it with
 * --strict-mcp-config, which makes the harness's config the only source.
 * The project file IS part of the bot's definition (its cwd is chosen per
 * bot), so it is forwarded verbatim — including `type: "http"`/`"sse"`
 * entries the harness never mounts itself, because the CLI, not this code,
 * is what has to understand them. A malformed file is ignored rather than
 * failing the turn: an unreadable project config must not brick a bot. */
function projectMcpServers(cwd: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8"));
  } catch {
    return {};
  }
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return {};
  const out: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers as Record<string, unknown>)) {
    if (server && typeof server === "object" && !Array.isArray(server)) out[name] = server;
  }
  return out;
}

/** The CLI compacts its own session when it approaches a window. Left alone
 * that window is the model's, so a Sonnet 5 session runs to something near a
 * million tokens before anything happens — and every model call until then
 * re-reads the whole thing. The measured food-ordering thread sat at 330k
 * tokens per call and looked perfectly healthy to the CLI.
 *
 * So the harness picks the window instead. This delegates the actual
 * compaction to the CLI, which owns the session and already has a summarizer
 * for it; the harness only decides when it is worth paying for.
 *
 * SAGAX_CLAUDE_AUTOCOMPACT takes a token count, "auto" to hand the decision
 * back to the CLI, or "off" to pass nothing at all. The CLI rejects a window
 * outside 100k-1M as a hard argument error, so a configured value is clamped
 * rather than passed through: a mistyped setting must not fail every turn. */
export function autoCompactWindow(env: NodeJS.ProcessEnv): string | null {
  const raw = (env.SAGAX_CLAUDE_AUTOCOMPACT ?? "").trim().toLowerCase();
  if (raw === "off") return null;
  if (raw === "auto") return "auto";
  const parsed = raw ? Number(raw) : DEFAULT_AUTOCOMPACT_TOKENS;
  if (!Number.isFinite(parsed) || parsed <= 0) return String(DEFAULT_AUTOCOMPACT_TOKENS);
  return String(Math.min(1_000_000, Math.max(100_000, Math.floor(parsed))));
}

/** Generous for real work, and still a third of where a 1M-window session
 * would otherwise get to. With bot tool results gated (mcp-gate.ts) most
 * threads never reach it; this is the backstop for the ones that do. */
const DEFAULT_AUTOCOMPACT_TOKENS = 200_000;

/** The Claude CLI version that first accepted each flag the harness passes
 * for context control. An unknown flag is a hard argument error, so passing
 * one to an older CLI would fail every turn rather than degrade; each flag
 * is therefore only passed to a CLI known to accept it.
 *
 * Verified against the published binaries, not the changelog (which never
 * records `--autocompact`): `--strict-mcp-config` is present in 1.0.60 and
 * absent from 1.0.0; `--setting-sources` first appears in 1.0.122 (1.0.120
 * lacks it); `--autocompact` first appears in 2.1.122 (2.1.121 lacks it). */
export const CLAUDE_FLAG_FLOORS = {
  "--strict-mcp-config": [1, 0, 60],
  // Prompt-cache keep-warm pings (claude-keepwarm.ts) only. Not bisected:
  // both are in every 2.1 build checked. A CLI that lacks one rejects the
  // ping as an argument error, which ends the keep-warm window, nothing else.
  "--fork-session": [2, 1, 0],
  "--no-session-persistence": [2, 1, 0],
  "--setting-sources": [1, 0, 122],
  "--autocompact": [2, 1, 122],
  // 2.1.267 is the first CLI that accepts it; below that the recorded prompt
  // simply is not refreshed, which is the pre-existing behaviour.
  "--system-prompt-snapshot": [2, 1, 267],
  // A guest's turn on a Cloud home (GUEST_CLAUDE_TOOLS): 2.1.248 takes
  // --restricted, 2.1.257 honours blockReadsOutsideWorkingDirectories.
  "--restricted": [2, 1, 257],
  // A bot's Claude Code plugins (server/bot-plugins.ts).
  "--plugin-dir": [2, 0, 0],
  // A one-shot helper with no built-in tool (oneShotIsolationArgs). Placed
  // conservatively: an older CLI keeps the plain one-shot it always had.
  "--tools": [2, 1, 0],
  // Claude in Chrome off (2026-10-28): placed conservatively after the
  // integration's 2.0 releases; an older CLI never had it to turn off.
  "--no-chrome": [2, 1, 0],
} as const satisfies Record<string, ClaudeCliVersion>;

/** The only built-in tools a guest's turn on a Cloud home gets
 * (SendTurnInput.guestConfined): no Bash, PowerShell or WebFetch, so nothing
 * runs a command, and with --restricted plus the settings below every read
 * outside its own folder is refused outright, never asked. Probed against
 * Claude Code 2.1.284 in `default` mode: without this, a built-in list of
 * "read-only" Bash commands runs unasked, and `xargs head` reads any file. */
/** A refusal of a confined turn, and why it is confined (SendTurnInput.confinedWhy). */
const withWhy = (refusal: string, why: string | undefined) => why ? `${refusal} ${why}` : refusal;

export const GUEST_CLAUDE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "WebSearch"] as const;
/** Tools a guest's session must never report in its init frame. */
const GUEST_FORBIDDEN_TOOLS = new Set(["Bash", "PowerShell", "WebFetch", "BashOutput", "KillShell", "KillBash", "NotebookEdit", "Task", "Agent"]);
/** The permission block a guest's session runs under, as a second layer. */
export const GUEST_CLAUDE_PERMISSIONS = {
  blockReadsOutsideWorkingDirectories: true,
  deny: ["Bash", "PowerShell", "WebFetch", "Read(//proc/**)"],
} as const;

/** A Claude Code permission rule: a tool name, then an optional pattern in
 * parentheses (`Bash(git status)`, `mcp__ogb`). Control characters never pass. */
const CLAUDE_RULE = /^[A-Za-z_][\w-]*(\([^\p{Cc}]+\))?$/u;

/** The instance's standing allow rules (SAGAX_CLAUDE_ALLOW: a JSON list, or one
 * rule per line), set by the operator on the server. They ride in the private
 * --settings file, the one source --setting-sources project still reads besides
 * the bot's folder, so every bot of the instance gets them; a guest's confined
 * turn never does. A malformed value grants nothing. */
/** Deny rules applied to every non-guest Claude turn: the protected folders. */
export function remoteSupportDenyRules(): string[] {
  return claudeProtectedDenyRules();
}

export function instanceClaudeAllowRules(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SAGAX_CLAUDE_ALLOW?.trim();
  if (!raw) return [];
  let rules: unknown;
  if (raw.startsWith("[")) {
    try {
      rules = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== "string")) return [];
  } else {
    rules = raw.split(/\r?\n/);
  }
  return [...new Set((rules as string[]).map((rule) => rule.trim()).filter((rule) => CLAUDE_RULE.test(rule)))];
}

/** The newest floor above: a CLI at or past it accepts everything the
 * harness sends. Below it the engine still works, minus the flags the CLI
 * predates, and the Engines page suggests an update. */
export const CLAUDE_CONTEXT_CONTROL_MIN_VERSION: ClaudeCliVersion = CLAUDE_FLAG_FLOORS["--system-prompt-snapshot"];

/** The first CLI this driver has seen echo a stdin user message, with the
 * uuid it was sent with, as a model call takes it in (`--replay-user-messages`,
 * checked on 2.1.282): a steer written during a tool call is echoed right
 * after that tool's result, one written during the turn's last model call
 * only after the turn's `result`, as its own turn starts. That tells a folded
 * steer from one that runs next. Below it, every steer holds its turn's
 * result for the grace. */
export { CLAUDE_REPLAY_FLOOR } from "./claude/config.ts";

/** `claude --version` prints "2.1.232 (Claude Code)"; the first dotted triple
 * is the version. Null when nothing parses, e.g. a wrapper that prints its
 * own banner first — see claudeCliSupports for how that is treated. */
export function parseClaudeCliVersion(stdout: string | null | undefined): ClaudeCliVersion | null {
  return parseVersionTriple(stdout ?? "");
}

/** Whether a CLI reporting `version` accepts `flag`. A version that could
 * not be parsed counts as current: every CLI that predates a floor prints a
 * plain "x.y.z (Claude Code)", so an unreadable version is far more likely
 * a newer wrapper than an old build, and withholding the flags from a modern
 * CLI would silently re-open the context leak this file exists to close. */
export function claudeCliSupports(version: ClaudeCliVersion | null, flag: keyof typeof CLAUDE_FLAG_FLOORS): boolean {
  return version === null || versionAtLeast(version, CLAUDE_FLAG_FLOORS[flag]);
}

/** The Engines-page notice for a CLI older than the newest floor. The engine
 * keeps working without the flags its CLI predates. */
export function claudeCliUpdate(version: string | null, cli: string): ProviderSnapshot["update"] | undefined {
  const parsed = parseClaudeCliVersion(version);
  if (!parsed || versionAtLeast(parsed, CLAUDE_CONTEXT_CONTROL_MIN_VERSION)) return undefined;
  const floor = CLAUDE_CONTEXT_CONTROL_MIN_VERSION.join(".");
  const missing = (Object.keys(CLAUDE_FLAG_FLOORS) as (keyof typeof CLAUDE_FLAG_FLOORS)[])
    .filter((flag) => !claudeCliSupports(parsed, flag));
  const effects = [
    ...(missing.includes("--autocompact") ? ["no compaction window picked by Sagax"] : []),
    ...(missing.includes("--setting-sources") ? ["bots still see this machine's own Claude Code setup"] : []),
    ...(missing.includes("--system-prompt-snapshot") ? ["resumed turns cannot refresh stale system prompts"] : []),
  ];
  return {
    title: "Update Claude Code for context controls",
    message:
      `Claude Code ${parsed.join(".")} predates ${floor}, so bots run without ${missing.join(", ")}: ` +
      `${effects.join("; ")}. Update it, then refresh Engines.`,
    command: cli === "claude" ? "claude update" : `${cli} update`,
  };
}

const CLAUDE_MODEL_ID = /^[a-z0-9][a-z0-9._:/-]*$/i;
/** Official Anthropic model ids, e.g. claude-sonnet-5-5 (no host:: inject prefix). */
const OFFICIAL_CLAUDE_ID = /^claude-[a-z0-9.-]+$/;

/** Rewrite a leftover API slug (`orcarouter/Qwen…`) to `host::model` when a
 *  local host is serving it, so the turn injects instead of asking for /login.
 *  Official cloud ids and already-encoded inject ids skip the probe. */
async function resolveClaudeTurnModel(
  model: string | null | undefined,
  env: Record<string, string | undefined>,
): Promise<string | null | undefined> {
  if (!model || decodeInjectId(model) || STATIC_CLAUDE_MODELS.options.some((option) => option.id === model)) {
    return model;
  }
  return resolveInjectId(model, await probeLocalInjects(env)) ?? model;
}

function extrasFromUnknown(value: unknown): Array<{ id: string; label: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return CLAUDE_MODEL_ID.test(item) ? [{ id: item, label: item }] : [];
    }
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; model?: unknown; slug?: unknown; name?: unknown; displayName?: unknown; label?: unknown };
    const id = [row.id, row.model, row.slug].find((candidate): candidate is string => typeof candidate === "string");
    if (!id || !CLAUDE_MODEL_ID.test(id)) return [];
    const label = [row.name, row.displayName, row.label].find((candidate): candidate is string => typeof candidate === "string");
    return [{ id, label: label || id }];
  });
}

/** Extra ids from ~/.claude/settings.json. Official extraModels stay untagged.
 *  `model` is Claude Code's last-used slug, not a catalog — listing it as
 *  Custom put a non-inject id in the picker and the turn then had no
 *  ANTHROPIC_API_KEY ("Not logged in · Please run /login"). Live injects
 *  come from mergeLocalInject. */
export function readClaudeModelCatalog(env: Record<string, string | undefined> = process.env) {
  // A missing or unreadable settings.json is not fatal: an instance whose
  // environment sets ANTHROPIC_MODEL (a Claude Code install pointed at an
  // Anthropic-compatible host) still lists that model as Custom.
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(readFileSync(join(resolveClaudeConfigDir(undefined, env), "settings.json"), "utf8")) as Record<string, unknown>;
  } catch {
    settings = {};
  }

  const extras = [
    ...extrasFromUnknown(settings.availableModels).map((extra) => ({ ...extra, custom: true })),
    ...extrasFromUnknown(settings.customModels).map((extra) => ({ ...extra, custom: true })),
    ...extrasFromUnknown(settings.extraModels).map((extra) => ({ ...extra, custom: !OFFICIAL_CLAUDE_ID.test(extra.id) })),
  ];
  const nestedEnv = settings.env && typeof settings.env === "object" ? (settings.env as Record<string, unknown>) : {};
  const envModel = nestedEnv.ANTHROPIC_MODEL ?? env.ANTHROPIC_MODEL;
  if (typeof envModel === "string") extras.push(...extrasFromUnknown([envModel]).map((extra) => ({ ...extra, custom: true })));

  const options = STATIC_CLAUDE_MODELS.options.map((option) => ({ ...option }));
  const seen = new Set(options.map((option) => option.id));
  for (const extra of extras) {
    if (seen.has(extra.id)) continue;
    seen.add(extra.id);
    // Only extraModels adds official cloud rows. An explicit endpoint model
    // override stays custom even when its id also appears in that list.
    options.push(extra.custom || extra.id === envModel
      ? { id: extra.id, label: extra.label, custom: true }
      : { id: extra.id, label: extra.label });
  }
  return { default: STATIC_CLAUDE_MODELS.default, options };
}

// ── permission broker (ported from agentcal drivers/claude.js) ─────────
// A headless run that hits a permission acceptEdits doesn't cover should
// neither stall silently NOR get blanket-denied — it should ask the user.
// The broker is a net server on a per-turn socket; the proxy (spawned by
// the claude CLI) forwards asks over it and waits. Unanswered permission
// asks deny after timeoutMs with a keep-moving note; unanswered questions
// answer with "use your best judgment" — guidance, never a block.
interface Ask {
  id: string;
  kind: "permission" | "question";
  tool: string;
  input: Record<string, unknown>;
  at: number;
}
type AskBehavior = "allow" | "deny" | "answer";
type AskResolutionSource = "user" | "timeout" | "system";

const DENY_TIMEOUT_NOTE =
  "Sagax: nobody answered this permission request in time. Skip this action and finish what you can without it.";
const QUESTION_TIMEOUT_NOTE = "Sagax: nobody answered in time. Use your best judgment and continue.";
const DUPLICATE_ASK_ID_NOTE = "Sagax: duplicate ask id — skipping this request.";

/** The system-source reply for an ask that outlives the turn — used both to
 * drain in-flight `pending` asks on close() and to answer one that arrives
 * on an already-closed broker (see the `closed` branch below). */
function systemEndedReply(kind: Ask["kind"]): { behavior: AskBehavior; message: string } {
  return kind === "question"
    ? { behavior: "answer", message: "Sagax: the turn is ending — wrap up." }
    : { behavior: "deny", message: "Sagax: the turn ended" };
}

/** The structured questions behind an ask, when it is one. Claude's own
 * AskUserQuestion carries them, and so does a multiSelect ask_user;
 * everything else answers null and keeps the plain summary/choices card. */
function askQuestions(ask: Ask): AskQuestion[] | null {
  return ask.tool === ASK_USER_QUESTION_TOOL || ask.tool === ASK_USER_TOOL ? parseAskQuestions(ask.input) : null;
}

/** One human-readable line for an ask — what the card subtitle shows. */
function askSummary(ask: Ask): string {
  const questions = askQuestions(ask);
  if (questions) return askQuestionSummary(questions);
  return askInputSummary(ask.input) ?? ask.tool ?? "tool";
}

export const sumNativeTurnResults = sumNativeTurnResultsFromSession;

export { commsTokenFile } from "./spawn-contract.ts";

/** Where the hook helper reads this thread's current turn token. Stable per
 * thread (so the CLI's environment can name it once) and private. */
export function hookTokenFile(threadId: string, botId?: string): string {
  const digest = createHash("sha256").update(`${botId ?? ""}\0${threadId}`).digest("hex").slice(0, 24);
  return join(DATA_DIR, "hook-tokens", `${digest}.token`);
}

/** The `hooks` block for the private --settings file: one command for each
 * event the harness observes. Claude Code runs it with the event JSON on
 * stdin and applies any hookSpecificOutput it prints. The command string is
 * a shell line, so both paths are quoted (this repo's own path has a space). */
export function claudeHookSettings(helperPath: string): Record<string, unknown> {
  // JSON quoting is not shell quoting: $(), backticks and $names still
  // expand inside double quotes on POSIX. Windows paths come through env
  // variables so their backslashes are not JSON-escaped into the command.
  const command = process.platform === "win32"
    ? '"%SAGAX_HOOK_NODE%" "%SAGAX_HOOK_HELPER%"'
    : [process.execPath, helperPath].map(path => `'${path.replace(/'/g, "'\\''")}'`).join(" ");
  const hook = { type: "command", command, timeout: 5 };
  const entry = [{ matcher: "", hooks: [hook] }];
  // Claude Code waits for a synchronous helper (a Node start plus a loopback
  // POST, ~180 ms) before its next step. Only the events whose answer the
  // engine needs stay synchronous (perf parity, rounds 4 and 5):
  // - no Stop hook: the harness did nothing with it;
  // - PostToolUse and PreCompact only record (full result spill, log line):
  //   they run in the background (`async`), the model continues meanwhile.
  //   A tool is followed by at least one more generation, so the spill lands
  //   while the turn is live; one that lands after a stop is refused and that
  //   turn's digest reads "preview" instead of "full";
  // - PostToolUseFailure answers a shell timeout hint: synchronous, rare;
  // - SessionStart only matters after a compaction (it re-sends digests):
  //   matched on `compact`, so a fresh or resumed session never waits on it.
  const background = [{ matcher: "", hooks: [{ ...hook, async: true }] }];
  return {
    PostToolUse: background,
    PostToolUseFailure: entry,
    PreCompact: background,
    SessionStart: [{ matcher: "compact", hooks: [hook] }],
  };
}

export function permissionSocketPath(threadId: string, botId?: string) {
  // A readable prefix alone is not unique: ids that agree on their first
  // characters ("t-perm-dup-1", "t-perm-dup-2") would share a socket. POSIX
  // hides that — a new broker's listen replaces the socket FILE, so the name
  // always points at the fresh server — but Windows named pipes live in a
  // global namespace that is never unlinked, and a reused name races the
  // previous broker's async teardown. Half the tag is a digest of the FULL
  // id so distinct threads get distinct sockets; the tag stays at 8 chars
  // total because the POSIX path already brushes the 104-byte sun_path
  // limit under deep tmp home dirs.
  //
  // botId is folded into the digest too (#1017): the driver's session/broker
  // maps are a single process-wide table keyed on threadId alone, so a
  // delegated child turn whose threadId ever coincides with its still-open
  // parent's (or any other bot's) would otherwise collide on the exact same
  // socket. Namespacing by bot makes that collision structurally impossible
  // regardless of how two turns end up sharing a threadId.
  const key = botId ? `${botId}\0${threadId}` : threadId;
  const prefix = threadId.replace(/[^\w-]/g, "").slice(0, 4);
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 4);
  return brokerSocketPath(DATA_DIR, `${prefix}${digest}`);
}

/** Paths the broker may bind, tried in order. Windows named pipes are never
 * unlinkable, and a hung CLI child from an earlier server process can hold a
 * name for minutes, so fresh suffixes let the new broker bind immediately.
 * POSIX gets a short temp fallback because macOS rejects Unix socket paths
 * longer than its small `sun_path` limit; a deep test HOME or long username
 * can otherwise make every approval silently unavailable. The proxy learns
 * the actual bound path from its argv, so either fallback is transparent. */
export function brokerSocketCandidates(threadId: string, botId?: string): string[] {
  const base = permissionSocketPath(threadId, botId);
  if (process.platform !== "win32") {
    const scope = createHash("sha256")
      .update(`${DATA_DIR}\0${process.pid}\0${botId ?? ""}\0${threadId}`)
      .digest("hex")
      .slice(0, 16);
    return [base, join(tmpdir(), `omb-perm-${scope}.sock`)];
  }
  return [
    base,
    `${base}-${randomBytes(3).toString("hex")}`,
    `${base}-${randomBytes(3).toString("hex")}`,
  ];
}

export async function createPermissionBroker(opts: {
  /** Candidate bind paths, tried in order; the first that listens wins. */
  socketPaths: string[];
  onAsk: (ask: Ask) => void;
  onResolve: (resolved: Ask & { behavior: AskBehavior; source: AskResolutionSource }) => void;
  isActive?: () => boolean;
  timeoutMs?: number;
}) {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const pending = new Map<
    string,
    { ask: Ask; finish: (behavior: AskBehavior, message: string | undefined, source: AskResolutionSource, always?: boolean) => void }
  >();
  // server.close() only stops accepting NEW connections — it does not touch
  // a connection that's already open. A still-alive child's MCP proxy can
  // keep sending asks on such a connection after the turn has ended, and
  // this handler stays fully wired to it. Without this flag those asks would
  // become new `pending` entries and `request.opened` cards for a turn the
  // driver already forgot (`active.delete(threadId)` already ran), which can
  // never be answered — the "zombie card" in issue #211.
  let closed = false;
  let boundPath = opts.socketPaths[0] ?? "";
  const connectionHandler = (conn: import("node:net").Socket) => {
    conn.on("error", () => {});
    // An ask carries the whole tool input (a Write's file content), so one
    // line spans many reads. Decode as a stream so no character is split.
    conn.setEncoding("utf8");
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.t !== "ask") continue;
        const askId = String(msg.id ?? newId());
        const kind = msg.kind === "question" ? ("question" as const) : ("permission" as const);
        if (closed) {
          // Closure is terminal and takes precedence over every active-turn
          // rule, including duplicate-id rejection. Never register a pending
          // entry or notify onAsk, but always answer an existing connection:
          // permission-proxy.ts only resolves on an explicit answer (or a
          // connection error/close), so a silent drop would hang the tool.
          try {
            conn.write(JSON.stringify({ t: "answer", id: askId, ...systemEndedReply(kind) }) + "\n");
          } catch {}
          continue;
        }
        // A retained Claude process keeps its proxy connection between
        // turns. Late/background asks must still fail closed without opening
        // a card for a turn that has already settled.
        if (opts.isActive && !opts.isActive()) {
          try {
            conn.write(JSON.stringify({ t: "answer", id: askId, ...systemEndedReply(kind) }) + "\n");
          } catch {}
          continue;
        }
        // `pending` is server-scoped, not per-connection: two asks with the
        // same id — a buggy/adversarial client, never a legitimate retry
        // (permission-proxy mints a fresh randomUUID per ask) — would
        // otherwise let the second `pending.set` silently overwrite the
        // first, orphaning it as an unanswerable card once the first
        // resolves and deletes the shared key. Reject before either ask
        // becomes visible to onAsk.
        if (pending.has(askId)) {
          // askId is client-controlled; JSON.stringify escapes newlines and
          // control characters so it can't corrupt the log line or terminal.
          console.error(`permission broker on ${boundPath}: duplicate ask id ${JSON.stringify(askId)} — denying`);
          try {
            conn.write(JSON.stringify({ t: "answer", id: askId, behavior: "deny", message: DUPLICATE_ASK_ID_NOTE }) + "\n");
          } catch {}
          continue;
        }
        // #1374: an agents use_tool is asked about as the tool it runs, here
        // too, whatever the proxy sent; one that runs nothing is refused.
        const bridged = kind === "permission" && typeof msg.tool === "string" ? unwrapAgentsBridge(msg.tool, msg.input) : null;
        if (bridged?.refused) {
          try {
            conn.write(JSON.stringify({ t: "answer", id: askId, behavior: "deny", message: bridged.refused }) + "\n");
          } catch {}
          continue;
        }
        const ask: Ask = { id: askId, kind, tool: bridged?.unwrapped ? bridged.name : msg.tool ?? "tool", input: bridged?.unwrapped ? bridged.input : msg.input ?? {}, at: Date.now() };
        const finish = (behavior: AskBehavior, message: string | undefined, source: AskResolutionSource, always?: boolean) => {
          if (!pending.delete(askId)) return;
          clearTimeout(timer);
          try {
            // `always` rides to the proxy, which hands the CLI's own suggested
            // permission rules back as updatedPermissions: Claude remembers
            // the allow for the session, the harness remembers nothing.
            // `source` travels with the answer too: a proxy that cannot tell
            // the human's words from a timeout note would file the timeout
            // note as the human's words.
            conn.write(
              JSON.stringify({ t: "answer", id: askId, behavior, message, source, ...(always ? { always: true } : {}) }) + "\n",
            );
          } catch {}
          opts.onResolve({ ...ask, behavior, source });
        };
        const timer = setTimeout(
          () =>
            kind === "question"
              ? finish("answer", QUESTION_TIMEOUT_NOTE, "timeout")
              : finish("deny", DENY_TIMEOUT_NOTE, "timeout"),
          timeoutMs,
        );
        timer.unref?.();
        pending.set(askId, { ask, finish });
        opts.onAsk(ask);
      }
    });
  };
  // Bind the first candidate that will take a listener. A broker that
  // never came up used to be silent — every approval then timed out into a
  // deny nobody could explain. Keep the turn fail-closed on total failure,
  // but leave an actionable diagnostic either way.
  let server: ReturnType<typeof createNetServer> | null = null;
  for (const [index, candidate] of opts.socketPaths.entries()) {
    const attempt = createNetServer(connectionHandler);
    try {
      unlinkSync(candidate);
    } catch {}
    let outcome = await new Promise<"listening" | (Error & { code?: string })>((resolve) => {
      attempt.once("listening", () => resolve("listening"));
      // SAFETY: net 'error' events carry syscall errors; the optional
      // `code` is only read defensively below.
      attempt.once("error", (error) => resolve(error as Error & { code?: string }));
      attempt.listen(candidate);
    });
    // A fallback under the shared OS temp root must not be connectable by
    // another local account. DATA_DIR is private already, but applying the
    // same mode to every POSIX socket keeps the rule simple and fail-closed.
    if (outcome === "listening" && process.platform !== "win32") {
      try {
        chmodSync(candidate, 0o600);
      } catch (error) {
        try {
          attempt.close();
        } catch {}
        try {
          unlinkSync(candidate);
        } catch {}
        outcome = error as Error & { code?: string };
      }
    }
    if (outcome === "listening") {
      if (index > 0) {
        console.error(`permission broker: ${opts.socketPaths[0]} is still held — bound fallback ${candidate}`);
      }
      boundPath = candidate;
      server = attempt;
      attempt.on("error", (error) => {
        console.error(`permission broker error on ${candidate}: ${error.message}`);
      });
      break;
    }
    try {
      attempt.close();
    } catch {}
    if (index === opts.socketPaths.length - 1) {
      console.error(`permission broker unavailable on ${candidate}: ${outcome.message}`);
      break;
    }
  }
  // Never hand the proxy an occupied candidate when every bind failed. That
  // could connect it to a stale (or unrelated) listener instead of this
  // broker, defeating the fail-closed boundary.
  if (!server) throw new Error("claude: permission broker could not bind a local socket");
  const drain = () => {
    for (const p of Array.from(pending.values())) {
      const { behavior, message } = systemEndedReply(p.ask.kind);
      p.finish(behavior, message, "system");
    }
  };
  return {
    answer(askId: string, behavior: AskBehavior, message?: string, always?: boolean): boolean {
      const p = pending.get(askId);
      if (!p) return false;
      if (p.ask.kind === "question" ? behavior !== "answer" : behavior === "answer") return false;
      p.finish(behavior, message, "user", always && behavior === "allow");
      return true;
    },
    pause() {
      drain();
    },
    close() {
      closed = true;
      drain();
      try {
        server?.close();
      } catch {}
      try {
        unlinkSync(boundPath);
      } catch {}
    },
    /** Where the broker actually listens — argv for the proxy child must
     * use this, not the deterministic base, when a fallback was bound. */
    socketPath: boundPath,
  };
}

/** A turn's own cost from the CLI's total_cost_usd, which is not a per-turn
 * figure: it is "cumulative across turns in streaming-input sessions — each
 * result carries the running total so far" (2.1.282), and a retained process
 * runs turn after turn. So a turn costs the growth since the total its
 * process reported for the turn before — or, for a process's first turn,
 * since the total the CLI restored on --resume (see restoredCostBase). With
 * no known start (null) the turn keeps its whole figure. A total that went
 * down is not the same count, so it is taken whole too rather than booked as
 * a negative cost. Rounding to 1e-10 USD removes only the float noise of the
 * subtraction. */
/** Solo login success. Not a field of `DriverCreateInput`: every driver shares that type. */
let onSoloClaudeLinked: (() => void) | undefined;

export function setSoloClaudeLinkedHandler(handler: (() => void) | undefined): void {
  onSoloClaudeLinked = handler;
}

export const ClaudeDriver: ProviderDriver<ClaudeConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Claude", supportsMultipleInstances: true },
  // npm on all three: the one recipe that is genuinely cross-platform. The
  // native installers differ per OS and would need verifying separately.
  install: {
    command: {
      darwin: "npm install -g @anthropic-ai/claude-code",
      linux: "npm install -g @anthropic-ai/claude-code",
      win32: "npm install -g @anthropic-ai/claude-code",
    },
    needsNode: true,
    docsUrl: "https://claude.com/claude-code",
    signInCommand: "claude",
  },
  models: STATIC_CLAUDE_MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<ClaudeConfig>): Promise<ProviderInstance> {
    return createClaudeInstance(input, {
      claudeEnvironment,
      inheritsUserConfig,
      mergeLocalInject,
      readClaudeModelCatalog,
      CLAUDE_UNUSED_COMMANDS,
      createPermissionBroker,
      claudeCliSupports,
      parseClaudeCliVersion,
      resolveClaudeTurnModel,
      applyClaudeInject,
      autoCompactWindow,
      GUEST_CLAUDE_TOOLS,
      GUEST_CLAUDE_PERMISSIONS,
      GUEST_FORBIDDEN_TOOLS,
      withWhy,
      permissionSocketPath,
      brokerSocketCandidates,
      claudeHookSettings,
      hookTokenFile,
      readClaudeAuthSettings,
      instanceClaudeAllowRules,
      remoteSupportDenyRules,
      projectMcpServers,
      agentsAllowedTools,
      CLAUDE_ACCOUNT_ENV_KEYS,
      claudeAutoAllowedTools,
      askQuestions,
      askSummary,
      parseChoices,
      questionChoices,
      permissionCommand,
      permissionPaths,
      withAbsolutePaths,
      askInputDetail,
      rebuiltSessionNotice,
      contextRenewedNotice,
      extractMcpImages,
      claudeSignInExpired,
      claudeUserMessage,
      ClaudeLoginController,
      claudeCliUpdate,
      claudeInheritWarning,
      claudeAuthStatus,
      oneShotIsolationArgs,
      get onSoloClaudeLinked() { return onSoloClaudeLinked; },
    });
  },
};

/** What a turn pre-allows of the agents MCP. Everything, except the one tool
 * that acts on a person's own computer (shared_computer: files, terminal,
 * screen control through their desktop app): that one goes through the
 * permission prompt like the host's own computer tools, so the bot's
 * approval mode decides and the person sees each action. */
export function agentsAllowedTools(env: Record<string, string> | undefined): string[] {
  const profile = catalogProfileFromEnv(env ?? {});
  // A write to the person's own API is not pre-allowed. Ask (and the other
  // levels that prompt) shows a card. A GET stays with the rest of the agents
  // server. The blanket mcp__agents grant would skip that card.
  const writes = new Set((profile.openapiTools ?? []).filter((operation) => operation.method !== "get").map((operation) => `openapi_${operation.name}`));
  if (!profile.sharedComputers && writes.size === 0) return ["mcp__agents"];
  return availableTools(profile).map((tool) => tool.name).filter((name) => name !== "shared_computer" && !writes.has(name)).map((name) => `mcp__agents__${name}`);
}
