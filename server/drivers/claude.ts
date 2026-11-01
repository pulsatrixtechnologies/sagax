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
import { adoptLegacyAutoMemory, legacyClaudeAutoMemoryDir } from "../compact-prompt.ts";
import { CLAUDE_UNUSED_COMMANDS, claudeDisallowedTools, claudeOrgTools } from "./host-tools.ts";
import { readAtRestSync } from "../content-at-rest.ts";
import { AUTO_COMPUTER_MCP_NAME } from "../auto-computer.ts";
import { cleanCommandVariables, commandVariablesDigest } from "../credential-command-env.ts";
import { isPerspicaxBridge, PERSPICAX_FLOW_COMPUTE_TOOLS } from "./acp/grok-read-only-tools.ts";
import { networkProxyEnvironment } from "./network-proxy.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, dirname, isAbsolute, normalize } from "node:path";
import { LOGIN_MARKER } from "../principal-engine-logins.ts";

import { DATA_DIR, stripWorkspaceCredentialEnv } from "../config.ts";
import { claudeProtectedDenyRules } from "../engine-protected-paths.ts";
import { openStartupModelCatalog, writeStartupModelCache } from "../startup-model-catalog.ts";
import { writeFileAtomic, writeFileAtomicIfChanged } from "../atomic.ts";
import { augmentedPath } from "../env-path.ts";
import { brokerSocketPath, cliVersionReader, describeSpawnFailure, execCli, killCliTree, spawnCli } from "../procs.ts";
import { classifyResumeFailure, mayReplay, rebuiltSessionNotice, recoveryPromptFor } from "../resume-recovery.ts";
import { contextFullMessage, contextRenewedNotice, isContextFullText, pushRenewalStep, renewalPrompt, type RenewalStep } from "../context-renewal.ts";
import { hostTimeZone } from "../bot-settings.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { ClaudeLoginController } from "./claude-login-auth.ts";

import type {
  DriverCreateInput,
  HarnessCommandScope,
  ModelCatalog,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  SteerOutcome,
  TextGenerationOptions,
} from "../contracts.ts";
import { customServerGate, gateQueryTools, gateServer } from "../mcp-gate-config.ts";
import { canUseMcpServer } from "../../shared/tool-scope.ts";
import { assertToolScopeSupported } from "../../shared/tool-scope-support.ts";
import { newEventId, newId, type EffortLevel, type TurnAccessInput } from "../contracts.ts";
import { askInputDetail, askInputSummary, commandSummary, cwToolResult, toolDetailPreview } from "../tool-summary.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../shared/phone-tools.ts";
import { filesField, writtenFilesFromToolInput } from "../thread-files.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS, USAGE_LIMIT } from "./retry.ts";
import { engineFailureMessage, type EngineFailureKind } from "./engine-errors.ts";
import { claudeAuthFailure, claudeAuthRecovery } from "./claude-auth-recovery.ts";
import { claudeSignInExpired } from "./claude-errors.ts";
import {
  claudeSubscriptionHomeKey,
  ensureClaudeSubscriptionFresh,
  onClaudeSubscriptionRenew,
} from "../claude-subscription-refresh.ts";
import { sessionIdlePolicy } from "./session-idle.ts";
import { contractChanges, PERSPICAX_TOKEN_ENV, switchesCover, turnFiles, turnSwitches, warmCommsEnv, warmPerspicaxEnv, withoutTurnTokens } from "./spawn-contract.ts";
import { parseVersionTriple, versionAtLeast } from "./acp/core.ts";
import { searchedToolCall, unwrapAgentsBridge } from "../../shared/searched-tool-call.ts";

/** The tools of a searched agents catalog that only find a tool and run
 * nothing (mcp-directory.ts, catalog-bridge.ts). call_tool and use_tool are
 * never pre-allowed: they reach the permission proxy, which reads them as
 * the tool they run and lets that one through unasked only when the turn
 * pre-allows it by its own name (#1374). */
const COMPACT_DIRECTORY_TOOLS = ["search_tools", "describe_tool", "find_tool"] as const;
import {
  applyClaudeInject,
  decodeInjectId,
  mergeLocalInject,
  probeLocalInjects,
  resolveInjectId,
} from "./local-inject.ts";
import { appendNative } from "./native.ts";
import { probeClaudeCommands } from "./harness-command-probe.ts";
import { normalizeClaudeCommands, type HarnessCommand } from "../../shared/harness-commands.ts";
import { permissionCommand, permissionLaunchCwd, permissionPaths, withAbsolutePaths } from "./permission-command.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { harnessMcpHttpSpec, loopbackNoProxy } from "../harness-mcp-http.ts";
import { extractMcpImages } from "../mcp-tool-images.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { promptHalves, sectionFingerprints, volatileSectionsUpdate } from "./prompt-split.ts";
import {
  ASK_USER_QUESTION_TOOL,
  ASK_USER_TOOL,
  askQuestionSummary,
  parseAskQuestions,
  parseChoices,
  questionChoices,
  type AskQuestion,
} from "../../shared/ask-question.ts";
import {
  ARTIFACT_HTML_MAX,
  formatArtifactFence,
  isArtifactTool,
  parseArtifactPublish,
} from "../../shared/claude-chat-blocks.ts";

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

/** Resolve the CLI's config location without changing HOME or Keychain. */
export function resolveClaudeConfigDir(configDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configured = configDir?.trim() || env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const expanded = configured === "~" ? home : configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
  if (!isAbsolute(expanded) || /[\p{Cc}\p{Cf}]/u.test(expanded)) {
    throw new Error("claude: configDir must be an absolute path or start with ~/");
  }
  return normalize(expanded);
}

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

/** How long a control request on the CLI's stdin waits for its answer. */
const CONTROL_REQUEST_TIMEOUT_MS = 5_000;

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

/** A model newer than the installed Claude Code: the API refuses it and the
 * CLI relays that as an api-error frame ("Claude Code 2.1.268 does not
 * support this model; version 2.1.280 or newer is required. Run 'claude
 * update'…"). It names no model, so it covers every model it happens for.
 * Like a signed-out turn, it is fixed by changing the install, not by a
 * retry, so the UI offers to run the update. */
export function claudeVersionTooOld(
  frame: { error?: unknown; is_api_error_message?: unknown },
  text: string,
): boolean {
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return /\bClaude Code v?\d+(?:\.\d+)+ does not support this model\b/i.test(text);
}

/** The CLI stopping a turn because its context is full: the compaction
 * breaker (2.1.312: an api-error frame with `api_error`
 * "autocompact_thrashing", "Autocompact is thrashing: the context refilled
 * to the limit within 3 turns of the previous compact, 3 times in a row…",
 * then a result whose terminal reason is "rapid_refill_breaker"), or the
 * API refusing a prompt past the window ("prompt is too long"). Gated on
 * the CLI's error flag, like a sign-in failure: a reply that only talks
 * about context is a reply. */
export function claudeContextFull(
  frame: { error?: unknown; is_api_error_message?: unknown; api_error?: unknown; terminal_reason?: unknown },
  text: string,
): boolean {
  if (frame.api_error === "autocompact_thrashing" || frame.terminal_reason === "rapid_refill_breaker") return true;
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return isContextFullText(text);
}

/** The usage window that refuses a Claude account's requests. */
export interface ClaudeLimit {
  /** the CLI's rateLimitType: five_hour, seven_day, seven_day_opus,
   * seven_day_sonnet, seven_day_overage_included or overage (2.1.295); null
   * when it names none */
  window: string | null;
  /** when that window reopens, in epoch seconds; null when unsaid */
  resetsAt: number | null;
  /** The plan still had room: this model runs on extra usage and its
   * credits are used up, so `resetsAt` is the billing period's reset and
   * other models on the same account keep working. */
  credits?: true;
}

/** The window a CLI's `rate_limit_info` says refuses this account, or null
 * while its requests go through. The CLI reads it from the API's headers on
 * every response and reports it in a `rate_limit_event` — "allowed",
 * "allowed_warning" near a limit, "rejected" past it (2.1.272, 2.1.295) —
 * and, from 2.1.295, on the refused call's api-error frame too
 * (`api_error_params`). A rejected window with extra usage in use still runs
 * the turn on usage credits, so only a refusal without them counts. */
export function claudeLimitRefusal(info: unknown): ClaudeLimit | null {
  if (!info || typeof info !== "object") return null;
  const { status, rateLimitType, resetsAt, isUsingOverage, errorCode, overageDisabledReason } = info as Record<string, unknown>;
  if (status !== "rejected" || isUsingOverage === true) return null;
  return {
    window: typeof rateLimitType === "string" ? rateLimitType : null,
    resetsAt: typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : null,
    ...(errorCode === "credits_required" || overageDisabledReason === "out_of_credits" ? { credits: true as const } : {}),
  };
}

/** The CLI's api-error frame for a call its account's usage limit refused:
 * its own code says so (`api_error: "usage_limit_reached"`, 2.1.295), or its
 * words do ("You've hit your weekly limit · resets …"), or a
 * `rate_limit_event` had already refused the account (`refused`). A refused
 * account runs nothing until the window reopens, so that is the failure to
 * report whatever else the same call said: 2.1.272 answered an account at
 * its weekly limit with "does not support this model" and an update offer,
 * and the person updated, to the same refusal. Gated on the CLI's error
 * flag, like a sign-in failure. */
export function claudeUsageLimit(
  frame: { error?: unknown; is_api_error_message?: unknown; api_error?: unknown },
  text: string,
  refused = false,
): boolean {
  if (frame.is_api_error_message !== true && typeof frame.error !== "string") return false;
  return refused || frame.api_error === "usage_limit_reached" || USAGE_LIMIT.test(text);
}

/** Each window as Settings → Usage names it ("5-hour", "Weekly"); any other
 * is the account's usage limit. */
const CLAUDE_LIMIT_NAMES: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit",
};

/** A weekly window for one model family (seven_day_opus, seven_day_sonnet…),
 * not the overage windows. */
const modelWindow = (window: string | null | undefined): boolean => /^seven_day_(?!overage)[a-z]+$/.test(window ?? "");

/** What a refused turn's runtime.error says about the engine. Only a window
 * every model shares holds the whole engine until it resets; a credits
 * refusal or one model's weekly window is `limitScope: "model"`, which
 * leaves the engine free for its other models
 * (server/limit-failover-host.ts). A credits refusal's reset is the billing
 * period's, no countdown to wait for, so it carries no `limitResetsAt`. */
export function claudeLimitFields(limit: ClaudeLimit | null | undefined, now = Date.now()): { limitResetsAt?: number; limitScope?: "model" } {
  if (!limit) return {};
  if (limit.credits) return { limitScope: "model" };
  const resetsAt = limit.resetsAt ? limit.resetsAt * 1_000 : undefined;
  return {
    ...(resetsAt && resetsAt > now ? { limitResetsAt: resetsAt } : {}),
    ...(modelWindow(limit.window) ? { limitScope: "model" as const } : {}),
  };
}

/** One plain line for a turn its account's usage limit refused: which limit,
 * when it reopens, and what runs before then — a model's own weekly limit
 * leaves the account's other models running. Nothing to install, sign in to
 * or retry. The reset is written in this machine's zone, named as the turn
 * clock names it; with no reset to write, the CLI's own words (`said`) are
 * quoted, as they may carry one. */
export function claudeLimitMessage(limit: ClaudeLimit | null, said?: string, now = Date.now(), timeZone = hostTimeZone()): string {
  if (limit?.credits) {
    return "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up. " +
      "Your plan's own usage is not affected: switch this bot to a model your plan includes, or add extra usage in your Claude account.";
  }
  const name = limit?.window && Object.hasOwn(CLAUDE_LIMIT_NAMES, limit.window) ? CLAUDE_LIMIT_NAMES[limit.window] : "usage limit";
  const meanwhile = modelWindow(limit?.window) ? "choose another model for this bot" : "switch this bot to another engine or Claude account";
  if (limit?.resetsAt && limit.resetsAt * 1000 > now) {
    let resets: string;
    try {
      resets = `${new Date(limit.resetsAt * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} (${timeZone})`;
    } catch {
      resets = `${new Date(limit.resetsAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    }
    return `This Claude account has reached its ${name}, which resets ${resets}. Until then, ${meanwhile}.`;
  }
  const words = said?.trim().replace(/[.\s]+$/, "");
  return `This Claude account has reached its ${name}${words ? ` (Claude says: "${words}")` : ""}. For now, ${meanwhile}.`;
}

/** What an error `result` says failed its turn: its `errors` (2.1.295:
 * "No conversation found with session ID: …"), else its text, else its
 * kind. */
export function claudeResultError(frame: { errors?: unknown; result?: unknown; subtype?: unknown; terminal_reason?: unknown; api_error_status?: unknown }, reply?: string): string {
  const errors = Array.isArray(frame.errors) ? frame.errors.filter((error): error is string => typeof error === "string" && error.trim() !== "") : [];
  if (errors.length) return errors.join("; ");
  // The result's text is the turn's own reply, not what failed it: never its cause.
  if (typeof frame.result === "string" && frame.result.trim() && !resultRepeatsReply(frame, reply)) return claudeApiErrorMessage(frame, frame.result);
  return `Claude ended the turn with an error (${String((frame.subtype !== "success" && frame.subtype) || frame.terminal_reason || "unknown")}).`;
}

/** Whether an error `result` only repeats the reply the turn already gave
 * (`reply`: the turn's latest text, its last 2 000 characters): no `errors`
 * of its own, and its text is that reply. The reply then stands. */
export function resultRepeatsReply(frame: { errors?: unknown; result?: unknown }, reply: string | undefined): boolean {
  if (Array.isArray(frame.errors) && frame.errors.some((error) => typeof error === "string" && error.trim() !== "")) return false;
  const said = reply?.trim();
  const result = typeof frame.result === "string" ? frame.result.trim() : "";
  return Boolean(said && result && (result === said || result.endsWith(said)));
}

/** Claude Code 2.1.295's api-error kinds (the assistant frame's `error`) that say the cause outright. */
const CLAUDE_ERROR_KINDS: Record<string, EngineFailureKind> = {
  billing_error: "credits",
  overloaded: "overloaded",
  server_error: "server",
  rate_limit: "rate_limit",
};

/** An api-error frame or error result in plain words. Claude Code sends the frame as a synthetic message whose
 * stop_reason is "stop_sequence", with `error` (billing_error, overloaded, server_error, rate_limit, invalid_request,
 * model_not_found, unknown...) and its text ("API Error: 529 ...", "Credit balance is too low"); the result repeats the
 * text with `api_error_status`. Each is one plain row, never a reply: a kind or status Sagax words is named, anything
 * else keeps Claude's own words. */
export function claudeApiErrorMessage(frame: { error?: unknown; api_error_status?: unknown }, text: string): string {
  const said = text.trim();
  const kind = typeof frame.error === "string" && Object.hasOwn(CLAUDE_ERROR_KINDS, frame.error) ? CLAUDE_ERROR_KINDS[frame.error] : null;
  const status = typeof frame.api_error_status === "number" ? frame.api_error_status : undefined;
  return engineFailureMessage("Claude", said, { kind, status }) ?? said;
}

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

export type ClaudeCliVersion = readonly [number, number, number];

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
export const CLAUDE_REPLAY_FLOOR: ClaudeCliVersion = [2, 1, 282];

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

const DRIVER_KIND = "claudeAgent";

const NO_ANTHROPIC_KEY = "No Anthropic API key — open Settings → API keys.";

export interface ClaudeConfig {
  cli: string;
  /** Separate CLI-managed login/settings. Empty uses the normal CLI account. */
  configDir?: string;
  /** Company routing is supplied by the private desktop parent, never local discovery. */
  managed?: boolean;
  /** Operator-provided hosted catalog; absent for ordinary desktop accounts. */
  managedModels?: string[];
  permissionMode: "acceptEdits" | "auto" | "bypassPermissions";
  /** Available Claude built-ins. An empty list passes `--tools ""`. */
  tools?: string[];
  /** Claude tool patterns to deny after the available set is selected. */
  disallowedTools?: string[];
  /** Runs only on the workspace Anthropic key (the `claudeApi` instance):
   * unavailable without one, never on a personal login. */
  requireApiKey?: boolean;
}

// model catalog ported from upstream packages/contracts/src/model.ts. The
// effort levels are what Claude Code 2.1.296 answered in its stream-json
// `initialize` (`models[].supportedEffortLevels`, 2026-10-13): every 5.x model
// takes low to max, Haiku 4.5 takes none (no `supportsEffort`).
const CLAUDE_5_EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
export const STATIC_CLAUDE_MODELS: ModelCatalog = {
  default: "claude-sonnet-5",
  options: [
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-fable-5", label: "Claude Fable 5", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 1_000_000, effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-opus-5", label: "Claude Opus 5", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", contextWindow: 1_000_000, effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", contextWindow: 1_000_000, effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", effortLevels: [] },
  ],
};

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

// Resolved from the server root, never relative to this file: bundling inlines
// this module into an entry one directory up, so a `".."` here would climb too
// far. See server/proxy-paths.ts.
const PERM_PROXY_PATH = SPAWNED_PROXIES.permission;
const DWEB_PROXY_PATH = SPAWNED_PROXIES.dweb;
const HOOK_HELPER_PATH = SPAWNED_PROXIES.hook;
// in the packaged app process.execPath is the Electron binary — this env
// makes it behave as plain node for the spawned MCP proxies (harmless in dev)
const NODE_ENV_FLAG = { ELECTRON_RUN_AS_NODE: "1" };

function removePrivateTempDir(filePath: string | null | undefined): boolean {
  if (!filePath) return true;
  try {
    rmSync(dirname(filePath), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    return true;
  } catch {
    return false;
  }
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

/** One native `result` frame's verdict and figures. A logical turn can span
 * more than one: a user message steered in after the turn's last model call
 * runs as the CLI's next native turn (see STEERED_CONTINUATION_GRACE_MS). */
export interface NativeTurnResult {
  ok: boolean;
  stopReason: string | null;
  cost: number | null;
  usage?: { input: number; output: number; cachedInput?: number };
}

/** A logical turn made of several native turns: any failed half fails it,
 * the last stop reason stands, per-turn token usage adds up, and the cost is
 * the latest figure — the CLI reports total_cost_usd as the process's running
 * total ("cumulative across turns in streaming-input sessions … read the
 * latest result rather than summing", 2.1.282), so adding would double-bill.
 * A figure missing on one side leaves the other side's alone. */
export function sumNativeTurnResults(earlier: NativeTurnResult | null, latest: NativeTurnResult): NativeTurnResult {
  if (!earlier) return latest;
  const usage = earlier.usage && latest.usage
    ? {
        input: earlier.usage.input + latest.usage.input,
        output: earlier.usage.output + latest.usage.output,
        ...(earlier.usage.cachedInput !== undefined || latest.usage.cachedInput !== undefined
          ? { cachedInput: (earlier.usage.cachedInput ?? 0) + (latest.usage.cachedInput ?? 0) }
          : {}),
      }
    : latest.usage ?? earlier.usage;
  return {
    ok: earlier.ok && latest.ok,
    stopReason: latest.stopReason ?? earlier.stopReason,
    cost: latest.cost ?? earlier.cost,
    ...(usage ? { usage } : {}),
  };
}

/** How long after a native `result` the CLI gets to announce, with `init`,
 * the turn it starts for a user message steered in after this turn's last
 * model call. The message is already buffered on its stdin, so this takes
 * milliseconds (about 60 ms on 2.1.282). If nothing comes, the message was
 * folded into one of this turn's model calls after all, and the held result
 * is the turn's: every result with a steer outstanding waits this long. */
export const STEERED_CONTINUATION_GRACE_MS = 2_000;

/** How long a steered continuation may stay silent after its `init` before
 * the driver stops waiting and closes the turn on the held result. 2.1.282
 * follows `init` with a `status` frame within milliseconds and every CLI
 * streams once the model answers; a continuation that never speaks would
 * otherwise keep the turn — and its internal tool pass — open until the
 * stall watchdog. */
export const STEERED_CONTINUATION_SILENCE_MS = 30_000;

/** Tests scale each steer timer on its own, the way FAKE_CLAUDE_RETRY_SCALE
 * scales the retry backoff — a test that shortens the silence bound must not
 * also shorten the grace `init` has to arrive in. Production runs at 1. */
const fakeTimerScale = (name: string) => Number(process.env[name] ?? "1") || 1;
const steerGraceScale = () => fakeTimerScale("FAKE_CLAUDE_STEER_GRACE_SCALE");
const steerSilenceScale = () => fakeTimerScale("FAKE_CLAUDE_STEER_SILENCE_SCALE");

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

function decodeToolList(value: unknown, field: "tools" | "disallowedTools"): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`claude: ${field} must be an array of non-empty strings`);
  const decoded: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`claude: ${field} must be an array of non-empty strings`);
    }
    const normalized = entry.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    decoded.push(normalized);
  }
  return decoded;
}

function decodeConfig(raw: unknown): ClaudeConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const mode = o.permissionMode;
  if (mode !== undefined && mode !== "acceptEdits" && mode !== "auto" && mode !== "bypassPermissions") {
    throw new Error(`claude: invalid permissionMode ${JSON.stringify(mode)}`);
  }
  const tools = decodeToolList(o.tools, "tools");
  const disallowedTools = decodeToolList(o.disallowedTools, "disallowedTools");
  if (o.configDir !== undefined && typeof o.configDir !== "string") throw new Error("claude: configDir must be a string");
  const configDir = typeof o.configDir === "string" ? o.configDir.trim() : undefined;
  if (configDir) resolveClaudeConfigDir(configDir);
  if (o.managedModels !== undefined && (o.managed !== true || !Array.isArray(o.managedModels) || !o.managedModels.length || o.managedModels.some(model => typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(model)))) throw new Error("Invalid hosted Claude models.");
  return {
    cli: typeof o.cli === "string" ? o.cli : "claude",
    ...(configDir ? { configDir } : {}),
    ...(o.managed === true ? { managed: true } : {}),
    ...(o.managedModels ? { managedModels: o.managedModels as string[] } : {}),
    permissionMode: (mode as ClaudeConfig["permissionMode"]) ?? "acceptEdits",
    ...(tools !== undefined ? { tools } : {}),
    ...(disallowedTools !== undefined ? { disallowedTools } : {}),
    ...(o.requireApiKey === true ? { requireApiKey: true } : {}),
  };
}

function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text" && b.text)
      .map((b) => b.text)
      .join("");
  }
  return "";
}

/** Small HTML/SVG the Artifact tool wrote. Host paths never reach the
 * transcript; the bytes ride a sibling ```widget fence. Anything else
 * (missing file, huge file, non-HTML) is skipped. */
function readArtifactHtml(filePath: string): string | undefined {
  if (!isAbsolute(filePath) || filePath.includes("\0")) return undefined;
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm") && !lower.endsWith(".svg")) return undefined;
  try {
    const html = readFileSync(filePath, "utf8");
    if (html.length === 0 || html.length > ARTIFACT_HTML_MAX) return undefined;
    return html;
  } catch {
    return undefined;
  }
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
export function turnCostFromRunningTotal(total: number | null, previous: number | null): number | null {
  if (total === null) return null;
  if (previous === null || total < previous) return total;
  return Number((total - previous).toFixed(10));
}

/** One running cost state, read from a `result`: total_cost_usd and, per
 * model, the [input, cache read, cache write, output] tokens of modelUsage.
 * Both count the whole session so far, including anything --resume restored. */
export interface ClaudeCostSnapshot {
  total: number;
  models: Record<string, [number, number, number, number]>;
}

export function claudeCostSnapshot(total: unknown, modelUsage: unknown): ClaudeCostSnapshot | null {
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const models: ClaudeCostSnapshot["models"] = {};
  if (modelUsage && typeof modelUsage === "object" && !Array.isArray(modelUsage)) {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const u = raw as Record<string, unknown>;
      models[model] = [count(u.inputTokens), count(u.cacheReadInputTokens), count(u.cacheCreationInputTokens), count(u.outputTokens)];
    }
  }
  return { total, models };
}

/** The running total a resumed session already carried before this
 * process's first turn. On --resume the CLI (2.1.282) restores the session's
 * cost from an earlier state — not always the latest one this driver saw —
 * so that turn's total_cost_usd and modelUsage include the earlier turns.
 * The restored state is the earlier state that sits inside the new counts
 * and leaves exactly this turn's own usage: in one model (usage leaves out
 * side calls such as a Haiku title) or summed over all models (a turn split
 * between two); nothing restored is 0. When no state fits exactly — the CLI
 * saved work that never reported a result, like an interrupted turn — the
 * latest state inside the new counts stands, so that work is booked once,
 * with this turn. Either way the latest state wins, not the highest total:
 * a resume that went back to an older state leaves later, lower totals. */
export function restoredCostBase(
  earlier: readonly ClaudeCostSnapshot[],
  current: ClaudeCostSnapshot,
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number },
): number {
  const turn = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output];
  const nothing: ClaudeCostSnapshot = { total: 0, models: {} };
  let exact: number | null = null;
  let inside = 0;
  // oldest first: the session's states in the order they were recorded
  for (const state of [nothing, ...earlier]) {
    const within = Object.entries(state.models).every(([model, counts]) =>
      counts.every((n, i) => n <= (current.models[model]?.[i] ?? 0)));
    if (!within) continue;
    inside = state.total;
    const growth = Object.entries(current.models).map(([model, counts]) =>
      counts.map((n, i) => n - (state.models[model]?.[i] ?? 0)));
    const isTurn = (counts: number[]) => counts.every((n, i) => n === turn[i]);
    const summed = turn.map((_, i) => growth.reduce((sum, counts) => sum + counts[i]!, 0));
    if (growth.some(isTurn) || isTurn(summed)) exact = state.total;
  }
  return exact ?? inside;
}

/** Each Claude session's latest cost states, so the first turn after a
 * --resume can tell what the CLI restored — after an app restart too. Small
 * by design: a few states for the most recent sessions. */
const COST_HISTORY_FILE = join(DATA_DIR, "claude-cost-history.json");
const COST_HISTORY_SESSIONS = 100;
const COST_HISTORY_STATES = 8;

function isCostSnapshot(value: unknown): value is ClaudeCostSnapshot {
  if (!value || typeof value !== "object") return false;
  const { total, models } = value as { total?: unknown; models?: unknown };
  return typeof total === "number" && !!models && typeof models === "object" &&
    Object.values(models).every((counts) => Array.isArray(counts) && counts.length === 4 && counts.every((n) => typeof n === "number"));
}

function readCostHistory(): Record<string, ClaudeCostSnapshot[]> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(COST_HISTORY_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, states]) => [id, Array.isArray(states) ? states.filter(isCostSnapshot) : []]));
  } catch {
    return {};
  }
}

function recordCostState(sessionId: string, state: ClaudeCostSnapshot): void {
  const history = readCostHistory();
  const states = [...(history[sessionId] ?? []), state].slice(-COST_HISTORY_STATES);
  // most recent session last, so the oldest ones are dropped first
  delete history[sessionId];
  history[sessionId] = states;
  const ids = Object.keys(history);
  for (const id of ids.slice(0, Math.max(0, ids.length - COST_HISTORY_SESSIONS))) delete history[id];
  // Written after every turn, so not fsynced: what a power cut could lose is
  // the same thing a failed write already gives up (below).
  try {
    writeFileAtomic(COST_HISTORY_FILE, JSON.stringify(history), { mode: 0o600, durable: false });
  } catch {
    // a lost state only means a later resume keeps its whole figure
  }
}

type ClaudeImage = NonNullable<SendTurnInput["images"]>[number];
type ClaudeUserContent =
  | { type: "image"; source: { type: "base64"; media_type: ClaudeImage["mime"]; data: string } }
  | { type: "text"; text: string };
type ClaudeUserMessage = {
  type: "user";
  /** echoed back with --replay-user-messages; set on steers */
  uuid?: string;
  message: { role: "user"; content: string | ClaudeUserContent[] };
};

/** Claude's stream-json input accepts the same image source blocks as the
 * Anthropic Messages API. Keep the old string form for text-only turns so a
 * CLI update cannot disturb the overwhelmingly common path. */
/** A value no real volatile half can equal: after the CLI compacts its
 * session, the next turn's volatile half always counts as changed. */
const COMPACTED_VOLATILE = "\u0000compacted";
/** A process launched with the stable half only whose first message has not
 * gone out yet (a warm process): its next turn carries the whole volatile
 * half, in the launch wording. */
const UNDELIVERED_VOLATILE = "\u0000undelivered";

/** How a mid-session change to the volatile half of the system prompt
 * reaches a model whose process was launched with the old copy. The CLI's
 * own out-of-band convention inside a user turn, and it costs one short
 * append rather than a relaunch that re-uploads the whole prompt cache. */
function withVolatileNote(text: string, volatile: string, launch = false): string {
  const body = !volatile.trim()
    ? "The notes that were in your instructions when this session started have been cleared."
    : launch
      ? `This part of your instructions changes from turn to turn, so it arrives here instead of in the system prompt. It replaces any earlier copy:\n\n${volatile.trim()}`
      : `This part of your instructions changed since this session started. It replaces the earlier copy:\n\n${volatile.trim()}`;
  return withReminder(text, body);
}

function withReminder(text: string, body: string): string {
  const note = `<system-reminder>\n${body}\n</system-reminder>`;
  return text ? `${note}\n\n${text}` : note;
}

/** The user message for a turn sent to a conversation that holds the
 * volatile half `held` (with those section fingerprints): the bare words
 * when nothing changed, only the changed sections when they can say it,
 * else the whole half. */
function volatileTurnMessage(
  turn: Pick<SendTurnInput, "text" | "images" | "systemVolatile" | "systemVolatileSections" | "mentionTurn" | "harnessCommand">,
  held: string,
  heldSections: Record<string, string> | undefined,
): ClaudeUserMessage {
  // An engine slash command reaches the CLI verbatim: a note in front of
  // it would make it an ordinary message (server/harness-commands.ts). The
  // caller leaves the held copy as it was, so the next turn carries the note.
  if (turn.harnessCommand) return claudeUserMessage(turn.text, turn.images);
  const volatile = turn.systemVolatile ?? "";
  const notHeld = held === COMPACTED_VOLATILE || held === UNDELIVERED_VOLATILE;
  const unchanged = volatile === held || (notHeld && !volatile.trim());
  if (unchanged && !turn.mentionTurn) return claudeUserMessage(turn.text, turn.images);
  // Only the sections that changed ride (2026-10-19 perf parity, point 4):
  // one recent-work line moving no longer re-sends the whole memory
  // notebook into the session every turn.
  const sectionsNote = volatileSectionsUpdate(turn.systemVolatileSections, notHeld ? undefined : heldSections, Boolean(turn.mentionTurn));
  if (sectionsNote === null) return claudeUserMessage(withVolatileNote(turn.text, volatile, held === UNDELIVERED_VOLATILE), turn.images);
  return claudeUserMessage(sectionsNote ? withReminder(turn.text, sectionsNote) : turn.text, turn.images);
}

function claudeUserMessage(
  text: string,
  images: readonly ClaudeImage[] | undefined,
): ClaudeUserMessage {
  if (!images?.length) return { type: "user", message: { role: "user", content: text } };
  const content: ClaudeUserContent[] = images.map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mime,
      data: readAtRestSync(image.path).toString("base64"),
    },
  }));
  if (text) content.push({ type: "text", text });
  return { type: "user", message: { role: "user", content } };
}

/** Native traces are routinely attached to bug reports. Preserve the image
 * block's shape and size for debugging, but never persist its base64 bytes. */
function diagnosticClaudeUserMessage(message: ClaudeUserMessage): ClaudeUserMessage {
  if (!Array.isArray(message.message.content)) return message;
  return {
    ...message,
    message: {
      ...message.message,
      content: message.message.content.map((block) =>
        block.type === "image"
          ? {
              ...block,
              source: {
                ...block.source,
                data: `[image data: ${block.source.data.length} base64 chars]`,
              },
            }
          : block,
      ),
    },
  };
}

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
    const { instanceId, config } = input;
    const environment = (model?: string | null, access?: TurnAccessInput) => {
      // Slice 4: an owner's key rides as instance environment for this one
      // turn (so claudeEnvironment keeps it); a person's own subscription
      // runs from their login directory with no key at all.
      const instanceEnvironment = access?.environment ? { ...input.environment, ...access.environment } : input.environment;
      const configDir = access?.via === "subscription" && access.claudeConfigDir ? access.claudeConfigDir : config.configDir;
      const env = claudeEnvironment(config.managed ? undefined : model, { ...process.env, ...instanceEnvironment }, configDir, instanceEnvironment);
      if (access?.via === "subscription") {
        delete env.ANTHROPIC_API_KEY;
        delete env.ANTHROPIC_AUTH_TOKEN;
      }
      return env;
    };
    const catalogEnv = environment();
    // Say it once where a headless or source run reads its logs; the Engines
    // page carries the same warning for the desktop (claudeInheritWarning).
    if (inheritsUserConfig(catalogEnv)) {
      console.error(`claude (${instanceId}): SAGAX_CLAUDE_INHERIT_USER_CONFIG=1 — bots inherit this machine's Claude Code MCP servers, skills, hooks and CLAUDE.md on every turn; remove it unless a bot needs a user-scope server`);
    }
    let models = config.managedModels ? { default: config.managedModels[0], options: config.managedModels.map(id => ({ id, label: id })) } : STATIC_CLAUDE_MODELS;
    const refreshModels = async () => {
      if (config.managed) return;
      try {
        const resolved = await mergeLocalInject(readClaudeModelCatalog(catalogEnv), catalogEnv);
        if (resolved.options.length) models = resolved;
      } catch {
        // Keep the last usable catalog when settings.json is unreadable.
      }
      try { writeStartupModelCache(instanceId, models); } catch { /* derived cache */ }
    };
    // A later start serves the saved list and refreshes behind listen.
    // The first run still waits so the seeded default model does not change.
    const startupModelRefresh = config.managed ? null : (await openStartupModelCatalog({
      instanceId,
      use: (catalog) => { models = catalog; },
      current: () => models,
      refresh: refreshModels,
    }))?.pending ?? null;

    // The installed CLI's version as snapshot() last read it, so a flag the
    // CLI does not know is never passed to it (CLAUDE_FLAG_FLOORS). The
    // harness snapshots every instance whenever it describes them — app
    // load, the Engines page, and right after `claude update`, which is
    // exactly when the answer changes — so a turn normally finds it filled.
    // A turn that finds it empty reads the version itself first: the
    // snapshot-refresh flag every turn passes is newer than the other context
    // controls, and an unknown flag would reject the turn. If that read
    // fails, most flags assume a current CLI; the snapshot flag needs a
    // confirmed version and autocompact a confirmed help listing.
    let cliVersion: ClaudeCliVersion | null = null;
    let cliVersionChecked = false;
    // Whether `claude --help` lists --autocompact, read once per CLI version
    // by snapshot(). The flag is not in every build above its version floor
    // (2.1.129 rejects it), so the listing wins over the floor; null until
    // probed, or when the probe fails.
    let cliHasAutocompact: boolean | null = null;
    let cliHelpVersion: string | null = null;
    const versionOf = cliVersionReader(config.cli);
    const readCliVersion = (env: NodeJS.ProcessEnv) => new Promise<ReturnType<typeof versionOf>>((resolve) => {
      execCli(config.cli, ["--version"], { timeout: 8000, env }, (err, stdout) => resolve(versionOf(err, stdout)));
    });
    // The --help read while it runs: snapshots that overlap (the server's
    // read at start and the app's first one) share it.
    let helpRead: { version: string; done: Promise<void> } | null = null;
    const readCliHelp = (version: string, env: NodeJS.ProcessEnv): Promise<void> => {
      if (helpRead?.version === version) return helpRead.done;
      const read = {
        version,
        done: new Promise<string | null>((resolve) => {
          execCli(config.cli, ["--help"], { timeout: 8000, env }, (err, stdout) => resolve(err ? null : stdout));
        }).then((help) => {
          cliHasAutocompact = help === null ? null : /^\s*--autocompact\b/m.test(help);
          cliHelpVersion = version;
          if (helpRead === read) helpRead = null;
        }),
      };
      helpRead = read;
      return read.done;
    };
    const listeners = new Set<RuntimeEventListener>();
    // The slash commands each bot's latest live session reported in `init`,
    // per bot and account (a person's subscription may add their own
    // claude.ai connectors' prompts, never shown to anyone else).
    const liveCommands = new Map<string, { names: string[]; terminal: string[] }>();
    const liveCommandsKey = (botId: string, identity: string | undefined) => `${botId}\u0000${identity ?? ""}`;
    /** The engine's slash commands for a bot's turns: a short process with
     * the turn's folder, isolation and account (the speaker's own
     * subscription on an organization server) answers `initialize` (no
     * model call), then what the bot's live session reported is layered in. */
    const listCommands = async (scope: HarnessCommandScope): Promise<HarnessCommand[]> => {
      const access = scope.access?.via === "subscription" ? scope.access : undefined;
      const env = environment(undefined, access);
      const args: string[] = [];
      if (!inheritsUserConfig(env)) {
        // a turn keeping its claude.ai connectors drops --strict-mcp-config too
        const strict = !scope.mcpFromUserConfig && !scope.claudeAiConnectors;
        if (strict && claudeCliSupports(cliVersion, "--strict-mcp-config")) args.push("--strict-mcp-config");
        if (claudeCliSupports(cliVersion, "--setting-sources")) args.push("--setting-sources", "project");
        if (!scope.mcpFromUserConfig && !scope.claudeAiConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
      }
      if (claudeCliSupports(cliVersion, "--plugin-dir")) for (const dir of scope.pluginDirs ?? []) args.push("--plugin-dir", dir);
      const listed = (await probeClaudeCommands({ cli: config.cli, args, env, cwd: scope.cwd ?? homedir() }))
        .filter((command) => !CLAUDE_UNUSED_COMMANDS.has(command.name));
      const live = scope.botId ? liveCommands.get(liveCommandsKey(scope.botId, access?.identity)) : undefined;
      if (!live) return listed;
      const known = new Set(listed.map((command) => command.name));
      const merged = [...listed, ...normalizeClaudeCommands(live.names.filter((name) => !known.has(name) && !CLAUDE_UNUSED_COMMANDS.has(name)))];
      const terminal = new Set(live.terminal);
      return merged.map((command) => terminal.has(command.name) ? { ...command, unavailable: "interactive" as const } : command);
    };
    // one active turn per thread; a second send while busy is a caller bug
    const active = new Map<string, { stop: () => void; turnId: string; broker?: Awaited<ReturnType<typeof createPermissionBroker>> }>();

    // One live CLI process per thread, kept across turns. Under
    // --input-format stream-json the CLI settles a turn with `result` while
    // stdin stays open, takes the next user message on the same stdin as a
    // new turn, and folds a message that arrives MID-turn into the running
    // one before its next model call (verified against 2.1.221 — that fold
    // is what "steer" is). So a session is spawned once, reused while its
    // spawn contract (args, MCP config, cwd, model) is unchanged, closed
    // after SESSION_IDLE_MS of quiet, and resumed by --resume when needed.
    interface Session {
      child: ReturnType<typeof spawnCli>;
      broker?: Awaited<ReturnType<typeof createPermissionBroker>>;
      mcpConfigPath: string | null;
      systemPromptPath: string | null;
      /** the spawn contract — a different one means a fresh process */
      argsKey: string;
      /** the same contract as an object, to name what changed on a relaunch */
      contract?: unknown;
      /** the turn files its agents server reads (removed with the process) */
      turnFiles?: string[];
      /** the agents switches it was launched with (spawn-contract.ts TURN_SWITCH_ENV) */
      switches?: Record<string, boolean>;
      /** the MCP servers it was launched with (names), for the relaunch log */
      mcpNames?: string[];
      /** #1276: the servers whose catalog is searched (call_tool reads as its target) */
      searchedMounts: ReadonlySet<string>;
      /** the volatile half of the system prompt this process was launched
       * with (see SendTurnInput.systemVolatile). A later turn whose volatile
       * text differs delivers the difference in-turn rather than relaunching. */
      volatile: string;
      /** fingerprints of the volatile sections the process holds, by id
       * (prompt-split.ts sectionFingerprints), so a later turn sends only
       * the sections that changed. Undefined after a compaction or when the
       * harness sent no sections: the next change then sends the whole half. */
      volatileSections?: Record<string, string>;
      /** the CLI's session id from `init`, what --resume takes later */
      sessionId: string | null;
      /** the CLI emitted its `init` frame — it accepted the session and
       * began the turn. The acceptance boundary for --resume: before it,
       * nothing was submitted and the turn has caused nothing. */
      sawInit: boolean;
      /** The last turn ended in failure: the CLI may have refused its
       * message before keeping it, so what the conversation holds of the
       * volatile half is not known (heldVolatile). */
      lastTurnFailed?: boolean;
      /** Set while this process was started for a call warm and no user
       * turn owns it yet. Init is recorded; every other event is dropped
       * until a real turn attaches. */
      idleWarm?: boolean;
      /** The warm that owns this idle process. A replaced call's abort
       * closes the process only while this token still matches. */
      warmToken?: string;
      /** Model from init, so a real turn can publish session.started when
       * init arrived during the warm and the CLI does not re-announce it. */
      sessionModel?: string | null;
      /** the permission mode `init` says the session actually runs in. The
       * CLI takes `--permission-mode auto` for any model and starts in
       * "default" without a word when auto mode is unavailable (Haiku 4.5,
       * Sonnet 4.5, an org that disabled it), so the flag we passed is not
       * the truth — this is. null until init, or on a CLI that omits it. */
      nativePermissionMode: string | null;
      /** #1373: control requests sent on stdin (set_permission_mode), by
       * request_id, until the CLI's control_response settles them. */
      controlWaiters?: Map<string, (ok: boolean) => void>;
      /** launched with --replay-user-messages (see CLAUDE_REPLAY_FLOOR) */
      replaysUserMessages: boolean;
      /** tool_use id → name, so an Artifact result can become a page card */
      toolNames: Map<string, string>;
      /** the running turn, or null between turns */
      turn: {
        turnId: string;
        input: SendTurnInput;
        retryAbort: AbortController;
        settled: boolean;
        sawStreamDelta: boolean;
        /** written to a process kept warm from an earlier turn, which has
         * not announced this turn with its `init` yet. A process that ends
         * before that never took the prompt (see the close handler). */
        awaitingInit?: boolean;
        authFailed?: boolean;
        /** Words of a deferred authentication_failed (#1768), emitted only
         * when the shared-refresh race retry cannot restore the sign-in. */
        authFailureText?: string;
        authFailureDeferred?: boolean;
        updateRequired?: boolean;
        /** the window the latest `rate_limit_event` says refuses this
         * account (claudeLimitRefusal), null while requests go through */
        limit?: ClaudeLimit | null;
        /** the turn failed on its account's usage limit, and said so */
        limitReached?: boolean;
        /** what failed this turn is already in front of the person: a
         * sign-in, update or usage-limit error, or the CLI's own api-error
         * text. An error `result` says nothing more. */
        explained?: boolean;
        stopRequested?: boolean;
        /** Steered messages, by the uuid this driver sent them with, that no
         * model call has taken in yet as far as the driver can tell. With
         * --replay-user-messages the CLI echoes each one as a call takes it
         * in; without it, nothing the CLI prints says whether a steer was
         * folded in or runs next, so each one counts until a result holds on
         * it. A `result` with any left is held (see the `result` handling). */
        pendingSteers: Set<string>;
        /** Native results already produced by this logical turn, held while
         * a steered continuation is expected; summed into `turn.completed`. */
        deferred: NativeTurnResult | null;
        /** Armed after a held result: the CLI announces the continuation with
         * `init` within milliseconds, or never — then the held result stands. */
        continuationGrace: ReturnType<typeof setTimeout> | null;
        /** (Re)starts that grace; set with it. A steer that lands while it
         * runs restarts it, so each queued message gets the whole grace. */
        armGrace?: () => void;
        /** Armed by the continuation's `init`: a frame of any other kind must
         * follow within STEERED_CONTINUATION_SILENCE_MS, or the held result stands. */
        continuationSilence: ReturnType<typeof setTimeout> | null;
        /** The CLI stopped the turn because its context is full (compaction
         * thrashing, a prompt past the window): its close goes on in a fresh
         * session instead of failing (server/context-renewal.ts). */
        contextFull?: boolean;
        /** The CLI's running cost total on the result that said so. */
        contextFullTotal?: number;
        /** The tool calls this turn made, for that fresh session's note. */
        steps?: RenewalStep[];
        /** The turn's latest reply text, for the same note. */
        lastText?: string;
      } | null;
      idleTimer: ReturnType<typeof setTimeout> | null;
      closing: boolean;
      stderr: string;
      /** The CLI's running total that the next turn's cost is measured from
       * (see turnCostFromRunningTotal): what --resume restored until the
       * first turn settles, then the last settled turn's total_cost_usd.
       * undefined until the first result; null when the start is unknown. */
      costTotal: number | null | undefined;
      /** Root close can precede a failed group stop; retry its finalization. */
      finishClose?: () => Promise<void>;
      /** resolves once the process's close has been handled: a turn it was
       * running has settled and left `active` (unless its tree could not be
       * confirmed stopped) */
      closed: Promise<void>;
    }
    const sessions = new Map<string, Session>();
    /** What a closed process's conversation holds of the volatile half, by
     * thread: a relaunch that resumes that same session sends only what
     * changed since, like a live one (port of OpenMausBot #3164). Absent
     * (server restart, crash, unsettled turn, evicted entry): the whole
     * half rides. Bounded like the neighboring session caches. */
    const heldVolatile = new Map<string, { sessionId: string; volatile: string; sections?: Record<string, string> }>();
    /** Where each session's file was written (the config dir of its launch),
     * for sessionBytes. After a restart the default config dir is searched. */
    const sessionConfigDirs = new Map<string, string>();
    const sessionFiles = new Map<string, string>();
    /** A session whose file was not found, and when to look again: a miss
     * scans every projects/ folder, so it is not repeated on every turn. */
    const sessionMisses = new Map<string, number>();
    /** Size of a saved session's file (<config>/projects/<cwd>/<id>.jsonl),
     * the file a --resume parses and replays. */
    const sessionFileBytes = (sessionId: string): number | undefined => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return undefined;
      const cached = sessionFiles.get(sessionId);
      if (cached) {
        try { return statSync(cached).size; } catch { sessionFiles.delete(sessionId); }
      }
      if ((sessionMisses.get(sessionId) ?? 0) > Date.now()) return undefined;
      const dirs = new Set<string>();
      const known = sessionConfigDirs.get(sessionId);
      if (known) dirs.add(known);
      try { dirs.add(resolveClaudeConfigDir(undefined, environment())); } catch {}
      for (const dir of dirs) {
        let entries: string[];
        try { entries = readdirSync(join(dir, "projects")); } catch { continue; }
        for (const entry of entries) {
          const file = join(dir, "projects", entry, `${sessionId}.jsonl`);
          try {
            const size = statSync(file).size;
            sessionFiles.set(sessionId, file);
            if (sessionFiles.size > 500) sessionFiles.delete(sessionFiles.keys().next().value!);
            return size;
          } catch {}
        }
      }
      sessionMisses.set(sessionId, Date.now() + 10 * 60_000);
      if (sessionMisses.size > 500) sessionMisses.delete(sessionMisses.keys().next().value!);
      return undefined;
    };
    const { idleMs: SESSION_IDLE_MS } = sessionIdlePolicy("CLAUDE");

    const stopSession = (session: Session) => {
      void killCliTree(session.child).then((stopped) => {
        if (stopped) void session.finishClose?.();
      });
    };
    const closeSession = (threadId: string, why: string) => {
      const s = sessions.get(threadId);
      if (!s || s.closing) return;
      s.closing = true;
      for (const waiter of s.controlWaiters?.values() ?? []) waiter(false);
      s.controlWaiters?.clear();
      if (s.sessionId && s.sawInit && !s.lastTurnFailed && s.volatile !== UNDELIVERED_VOLATILE && (!s.turn || s.turn.settled)) {
        heldVolatile.set(threadId, { sessionId: s.sessionId, volatile: s.volatile, ...(s.volatileSections ? { sections: s.volatileSections } : {}) });
        if (heldVolatile.size > 500) heldVolatile.delete(heldVolatile.keys().next().value!);
      } else heldVolatile.delete(threadId);
      if (s.idleTimer) clearTimeout(s.idleTimer);
      // Broker ownership belongs to this session. Detach and close it now,
      // before a replacement can bind the same per-thread socket; the old
      // child's later close event must never unlink a new broker.
      const broker = s.broker;
      s.broker = undefined;
      broker?.close();
      appendNative(threadId, { dir: "out", source: "claude.session", msg: { close: why } });
      // A process that ends takes its turn files along. A replacement built
      // for this same thread already holds its values in its own env.
      for (const file of s.turnFiles ?? []) {
        try { rmSync(file, { force: true }); } catch { /* already gone */ }
      }
      // stdin EOF is the CLI's exit signal; give it a moment, then insist
      try {
        s.child.stdin.end();
      } catch {}
      const kill = setTimeout(() => {
        stopSession(s);
      }, 5_000);
      kill.unref?.();
    };
    const armIdle = (threadId: string) => {
      const s = sessions.get(threadId);
      if (!s) return;
      if (s.idleTimer) clearTimeout(s.idleTimer);
      s.idleTimer = setTimeout(() => closeSession(threadId, "idle"), SESSION_IDLE_MS);
      s.idleTimer.unref?.();
    };
    /** Park a pooled process with no user turn. A later warm of the same
     * session bumps warmToken, so this signal's abort cannot close it. */
    const holdWarm = (threadId: string, session: Session, token: string, signal?: AbortSignal) => {
      session.idleWarm = true;
      session.warmToken = token;
      session.turn = null;
      if (signal?.aborted) {
        closeSession(threadId, "call ended");
        return;
      }
      signal?.addEventListener("abort", () => {
        const live = sessions.get(threadId);
        if (live === session && !live.turn && live.warmToken === token) closeSession(threadId, "call ended");
      }, { once: true });
      armIdle(threadId);
    };
    const writeUser = (s: Session, threadId: string, promptMsg: ClaudeUserMessage): Promise<boolean> => {
      if (!s.child.stdin.writable || s.child.stdin.destroyed) return Promise.resolve(false);
      return new Promise((resolve) => {
        try {
          s.child.stdin.write(JSON.stringify(promptMsg) + "\n", (error) => {
            if (error) return resolve(false);
            appendNative(threadId, {
              dir: "out",
              source: "claude.sdk.message",
              msg: diagnosticClaudeUserMessage(promptMsg),
            });
            resolve(true);
          });
        } catch {
          resolve(false);
        }
      });
    };

    /** #1373: the level a person chose while a turn was running, by thread,
     * for that logical turn's relaunches (see sendTurn). */
    const liveApprovalModes = new Map<string, { turnId: string; mode: ApprovalMode }>();
    /** Send one control request on the CLI's stdin and wait for its answer.
     * False when the write fails, the CLI refuses, or it says nothing in time. */
    const controlRequest = (s: Session, threadId: string, request: Record<string, unknown>): Promise<boolean> => {
      if (s.closing || !s.child.stdin.writable || s.child.stdin.destroyed) return Promise.resolve(false);
      const requestId = `sagax-${newId()}`;
      const waiters = (s.controlWaiters ??= new Map<string, (ok: boolean) => void>());
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          if (waiters.delete(requestId)) resolve(false);
        }, CONTROL_REQUEST_TIMEOUT_MS);
        timer.unref?.();
        waiters.set(requestId, (ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
        const frame = { type: "control_request", request_id: requestId, request };
        try {
          s.child.stdin.write(JSON.stringify(frame) + "\n", (error) => {
            if (!error) {
              appendNative(threadId, { dir: "out", source: "claude.control", msg: frame });
              return;
            }
            clearTimeout(timer);
            if (waiters.delete(requestId)) resolve(false);
          });
        } catch {
          clearTimeout(timer);
          if (waiters.delete(requestId)) resolve(false);
        }
      });
    };
    /** #1373: Ask, Edits or Auto chosen while this thread works. The CLI was
     * launched with --permission-mode and does not re-read it, so the new
     * level goes to the running process as set_permission_mode: its next
     * tool call is decided at that level (Ask: every call reaches Sagax's
     * broker, mcp__ogb__approve). Approve for me's fixed list of tools that
     * never need a person (claudeAutoAllowedTools) stays allowed: none of
     * them changes anything. Resolves false when the CLI did not confirm, and
     * the harness then stops the turn. */
    const applyApprovalMode = async (threadId: string, mode: ApprovalMode): Promise<boolean> => {
      if (mode !== "ask" && mode !== "edits" && mode !== "auto") return false;
      const running = active.get(threadId);
      // Nothing running: the next turn launches at the level it is sent with.
      if (!running) return true;
      liveApprovalModes.set(threadId, { turnId: running.turnId, mode });
      const s = sessions.get(threadId);
      // Between two processes of the same turn: the relaunch reads the level
      // recorded above before it spawns.
      if (!s || s.closing || !s.turn || s.turn.turnId !== running.turnId) return true;
      s.turn.input = { ...s.turn.input, approvalMode: mode };
      // A guest's confined turn already runs in Ask and stays there.
      if (s.turn.input.guestConfined) return true;
      const nativeMode = mode === "ask" ? "default" : "acceptEdits";
      const ok = await controlRequest(s, threadId, { subtype: "set_permission_mode", mode: nativeMode });
      if (!ok) return false;
      s.nativePermissionMode = nativeMode;
      // The process no longer runs at the mode its argv names: never reuse
      // it for a later turn, which launches at its own level.
      s.argsKey = `${s.argsKey}#live-approval`;
      return true;
    };

    // A signed-out refusal is held until the first model activity, so a turn
    // that could not start rejects once its process has stopped (the harness
    // then recovers it on a backup engine), instead of reading as an answer.
    const authRecovery = claudeAuthRecovery((event: RuntimeEvent) => {
      for (const l of Array.from(listeners)) l(event);
    }, async (threadId) => {
      const session = sessions.get(threadId);
      if (!session || !(await killCliTree(session.child))) return false;
      await session.closed;
      return sessions.get(threadId) !== session;
    }, (threadId) => active.has(threadId));
    const emit = (event: RuntimeEvent) => authRecovery.emit(event);
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });
    // retry bookkeeping lives PER THREAD, not per sendTurn call: a relaunch
    // is a fresh sendTurn, and the attempt cap must survive across launches
    const retryState = new Map<string, { attempt: number; cancelled: boolean; rebuilt?: boolean; renewed?: boolean; authRaced?: boolean }>();
    /** Logical turns already moved to a fresh session once because the
     * context filled up: a second overflow is reported, never looped. */
    const renewedTurns = new Set<string>();
    /** Threads whose last session filled up even when fresh: the next turn
     * (Retry, or any new message) starts a fresh session from the chat
     * instead of reopening that full one. */
    const freshNextTurn = new Set<string>();
    /** Cost of the full sessions a renewed turn left behind, by turn. */
    const carriedCosts = new Map<string, number>();
    // #1768: when this person's Claude login home is renewed, retire idle
    // processes that still hold the previous token so they cannot race the
    // rotated refresh grant.
    const stopRenewWatch = onClaudeSubscriptionRenew((loginHome) => {
      for (const [threadId, live] of sessions) {
        if (live.turn || live.closing || live.child.exitCode !== null) continue;
        const dir = live.contract && typeof live.contract === "object" && live.contract !== null && "configDir" in live.contract
          ? (live.contract as { configDir?: string | null }).configDir
          : null;
        if (!dir || claudeSubscriptionHomeKey(dir) !== loginHome) continue;
        closeSession(threadId, "subscription renewed");
      }
    });

    /** #1768: keep the shared OAuth grant fresh before a subscription turn
     * uses the person's login home (and after a concurrent refresh race). */
    const refreshSubscriptionHome = async (turn: SendTurnInput, force = false) => {
      const loginDir = turn.access?.via === "subscription" ? turn.access.claudeConfigDir?.trim() : "";
      if (!loginDir) return { ok: true as const, renewed: false, expiresAt: null };
      return ensureClaudeSubscriptionFresh({
        loginDir,
        cli: config.cli,
        environment: environment(turn.model, turn.access),
        ...(force ? { force: true } : {}),
      });
    };

    const sendTurn = async (turn: SendTurnInput, logicalTurnId?: string) => {
      if (startupModelRefresh) await startupModelRefresh;
      // #1373: a relaunch of the same logical turn (transient failure,
      // rejected resume, rebuild) runs at the level the person chose during
      // the turn, never the one it started with. A new turn carries its own.
      const liveLevel = liveApprovalModes.get(turn.threadId);
      if (logicalTurnId !== undefined && liveLevel?.turnId === logicalTurnId) turn = { ...turn, approvalMode: liveLevel.mode };
      else if (logicalTurnId === undefined && turn.warmOnly !== true) liveApprovalModes.delete(turn.threadId);
      turn = { ...turn, toolScope: assertToolScopeSupported(DRIVER_KIND, turn.toolScope) };
      if (config.managedModels && (!turn.model || !config.managedModels.includes(turn.model))) throw new Error("This model is not assigned to this workspace.");
      if (config.requireApiKey && !input.environment.ANTHROPIC_API_KEY) throw new Error(NO_ANTHROPIC_KEY);
      if (config.managed && (!turn.model || turn.model.includes("::") || !config.configDir ||
          !input.environment.ANTHROPIC_API_KEY || !input.environment.ANTHROPIC_BASE_URL)) {
        throw new Error("Company model access is unavailable. Reconnect your organization; personal billing will not be used.");
      }
      const { threadId, botId } = turn;
      // An internal relaunch (transient failure, rejected resume) keeps the
      // logical turn's stop handle in `active` while it sets up, so Stop is
      // never a silent no-op between two CLI processes of the same turn.
      const relaunch = logicalTurnId !== undefined;
      // A warm must not steal a process a real turn already owns, and an
      // aborted warm must not open files or spawn. Both return before any
      // broker or temp file exists.
      if (turn.warmOnly === true && (turn.warmSignal?.aborted || (active.has(threadId) && !relaunch))) {
        return { turnId: logicalTurnId ?? newId() };
      }
      if (!relaunch) {
        // Stop is acknowledged at once and the process tree reaped after it
        // (taskkill is asynchronous on Windows); the stopped turn leaves
        // `active` only when its close is handled. A Stop that lands while
        // a turn is still starting lets the harness send the next message
        // before then. That turn waits for the stopped process to be gone,
        // never overlapping its helpers, instead of being refused.
        const stopped = sessions.get(threadId);
        if (stopped?.turn?.stopRequested && active.get(threadId)?.turnId === stopped.turn.turnId &&
            await killCliTree(stopped.child)) await stopped.closed;
        if (active.has(threadId)) throw new Error("a turn is already running on this thread");
      }
      // #1768: one shared OAuth refresh at a time for this login home, before
      // any Claude process of this person reads or rotates the grant.
      if (turn.access?.via === "subscription" && turn.access.claudeConfigDir) {
        await refreshSubscriptionHome(turn, Boolean(retryState.get(threadId)?.authRaced && relaunch));
      }
      // A bot-level mode is authoritative for this turn. In particular, an
      // old provider instance may still be configured with
      // `bypassPermissions`; Ask/Auto must restore Claude's interactive
      // broker instead of inheriting that silent bypass. Calls without a
      // per-turn mode keep the legacy adapter behavior.
      // 2026-10-19 (bot quality, cause B): Approve for me never starts the
      // CLI's own auto mode. Its classifier refused external writes in
      // silence (no card, only "add a permission rule"), even after the
      // person said yes in the chat, and the bot concluded it could not.
      // Auto is now Auto-accept edits plus a fixed list of tools that never
      // need a person (claudeAutoAllowedTools); every other call reaches
      // Sagax's broker (mcp__ogb__approve) and becomes a real card.
      const requestedMode = turn.approvalMode === undefined
        ? config.permissionMode
        : turn.approvalMode === "full" ? "bypassPermissions"
          : turn.approvalMode === "auto" ? "auto"
            : turn.approvalMode === "edits" ? "acceptEdits" : "default";
      const autoAllowlist = requestedMode === "auto";
      const permissionMode = autoAllowlist ? "acceptEdits" : requestedMode;
      const controlsHost = turn.integrations?.localComputer?.scope === "local-computer";
      if (controlsHost && permissionMode === "bypassPermissions" && turn.approvalMode !== "full") {
        throw new Error("local computer control requires the interactive approval broker");
      }
      // The thread's last session filled up even when fresh: reopening it
      // would fill up again at once. This turn starts a fresh session from
      // the chat's rebuild instead (a warm only prepares a process, so it
      // leaves the mark for the turn that follows it). true: the rebuild
      // replays the conversation; false: the turn's text was all there was.
      let renewedFromChat: boolean | null = null;
      if (!relaunch && turn.warmOnly !== true && freshNextTurn.has(threadId)) {
        freshNextTurn.delete(threadId);
        if (typeof turn.resumeCursor === "string" && !turn.sessionReset) {
          const recovery = turn.recoveryText?.trim() && turn.recoveryText.trim() !== turn.text.trim() ? turn.recoveryText : undefined;
          turn = { ...turn, resumeCursor: undefined, recoveryText: undefined, ...(recovery ? { text: recovery } : {}) };
          renewedFromChat = Boolean(recovery);
        }
      }
      // Materialize before creating a broker or process. A missing/corrupt
      // attachment must fail this call without leaving a live session behind.
      const promptMsg = claudeUserMessage(turn.text, turn.images);
      // Internal relaunches are still the turn acknowledged to the harness.
      // A new user message gets a fresh id, but retry/recovery must not orphan
      // its capability, coordination result or queued continuation ownership.
      const turnId = logicalTurnId ?? newId();
      const retryAbort = new AbortController();
      const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
      // A fresh user turn starts un-cancelled. A relaunch must keep a Stop
      // that landed while it was being scheduled.
      if (!relaunch) {
        retry.cancelled = false;
        retry.rebuilt = false;
        retry.renewed = false;
      }
      if (renewedFromChat !== null) {
        retry.rebuilt = renewedFromChat;
        retry.renewed = true;
      }
      retryState.set(threadId, retry);
      // a retry relaunches the whole CLI; the backoff is scaled down in tests
      // so a fake's transient failures don't stall real seconds
      const retryScale = Number(process.env.FAKE_CLAUDE_RETRY_SCALE ?? "1");
      const sessionId = !turn.sessionReset && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
      const newSessionId = sessionId ? null : newId();

      const args = [
        "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose", // required by stream-json output
        // token-level streaming: content_block_delta events between the
        // whole-message frames, so the bubble grows as the model writes
        "--include-partial-messages",
        "--permission-mode", permissionMode,
      ];
      // A guest's turn: no command-running tool at all, and no read outside
      // its own folder (GUEST_CLAUDE_TOOLS). It only ever runs in Ask.
      if (turn.guestConfined && permissionMode !== "default") {
        throw new Error("A guest's turn on this Cloud runs only in Ask.");
      }
      // Organization server: only the built-ins on the allowlist
      // (CLAUDE_ORG_TOOLS), so one a newer CLI adds stays off; null on a
      // solo server, where the turn keeps everything it had.
      const orgTools = claudeOrgTools(turn.guestConfined ? GUEST_CLAUDE_TOOLS : config.tools, turn.withholdHostTools === true);
      if (turn.guestConfined) args.push("--restricted", "--tools", orgTools ?? GUEST_CLAUDE_TOOLS.join(","));
      else if (orgTools !== null) args.push("--tools", orgTools);
      else if (config.tools !== undefined) args.push("--tools", config.tools.join(","));
      // And no shell, file or fetch tool on the Sagax server, as deny rules
      // (they hold for subagents and a plugin's agents too).
      const disallowedTools = claudeDisallowedTools(config.disallowedTools, turn.withholdHostTools === true, turn.guestConfined === true || config.tools !== undefined || orgTools !== null);
      if (disallowedTools.length) {
        args.push("--disallowedTools", disallowedTools.join(","));
      }
      const turnEnvironment = environment();
      if (!cliVersionChecked) {
        const probe = await readCliVersion(turnEnvironment);
        if ("version" in probe) {
          cliVersion = parseClaudeCliVersion(probe.version);
          cliVersionChecked = true;
        }
      }
      if (turn.guestConfined && !claudeCliSupports(cliVersion, "--restricted")) {
        throw new Error(withWhy("This Claude Code is too old to run this turn without a shell. Update Claude Code.", turn.confinedWhy));
      }
      // Each stdin message echoed as a model call takes it in: how a turn
      // tells a folded steer from one that runs next (CLAUDE_REPLAY_FLOOR).
      const replaysUserMessages = cliVersion === null || versionAtLeast(cliVersion, CLAUDE_REPLAY_FLOOR);
      if (replaysUserMessages) args.push("--replay-user-messages");
      // Never the Claude in Chrome extension (2026-10-28): with it on, a bot
      // asked for "the latest video of" someone drove the person's own Chrome
      // in front of them, with no banner and no Stop. Web work goes to web
      // search, fetch and the built-in browser, out of sight; the person's
      // own Chrome is reached through My Chrome or this computer, both
      // announced and stoppable (HOST_SCREEN_RULE, server/surface.ts).
      if (claudeCliSupports(cliVersion, "--no-chrome")) args.push("--no-chrome");
      const isolated = !inheritsUserConfig(turnEnvironment);
      // A guest's confined turn never gets anyone's connectors. Standing
      // allow rules (SAGAX_CLAUDE_ALLOW) may name mcp__claude_ai_ tools; deny
      // rules still win, and nothing here pre-allows them. A turn with an
      // owner's tool selection gets only the selected servers, never them.
      const keepsClaudeAiConnectors = turn.claudeAiConnectors === true && !turn.guestConfined && turn.toolScope === undefined;
      // The person's own Claude MCP servers (claudeUserMcpEnabled, on by
      // default on a solo server) ride every turn except one with a tool
      // selection: that turn gets only the selected servers (strict config),
      // since the harness gates nothing it did not mount.
      const mcpFromUserConfig = turn.mcpFromUserConfig === true && turn.toolScope === undefined;
      if (turn.toolScope !== undefined && (!isolated || cliVersion === null || !claudeCliSupports(cliVersion, "--strict-mcp-config"))) {
        throw new Error("Claude cannot confirm a restricted MCP configuration for this account. Use a current, identifiable Claude CLI before using tool selection.");
      }
      if (isolated) {
        // A bot gets the tools and instructions its owner gave it, not
        // whatever this machine's Claude Code happens to be set up with.
        // Without these the CLI silently adds, to EVERY turn of every bot:
        // the desktop's own MCP servers and claude.ai connectors (one
        // measured desktop mounted 407 extra tools, ~10k tokens), its skill
        // and agent listings, its hooks, and its personal CLAUDE.md. Every
        // model call in the session then re-reads all of it.
        // Each flag only on a CLI that accepts it: an unknown flag is an
        // argument error that would fail every turn (CLAUDE_FLAG_FLOORS).
        // The MCP half has a switch (Capabilities > Installed → "Also use my
        // Claude Code MCP servers"): with it on, the CLI loads the servers
        // and connectors from the person's own Claude Code config — the way
        // Codex reads its own config.toml — while skills, hooks and the
        // personal CLAUDE.md stay out.
        // The speaker's own claude.ai connectors (server/harness-connectors.ts)
        // need the same: --strict-mcp-config also drops them (measured on CLI
        // 2.1.287), while --setting-sources project still keeps the machine's
        // user-scope servers, skills and hooks out.
        if (!mcpFromUserConfig && !keepsClaudeAiConnectors && claudeCliSupports(cliVersion, "--strict-mcp-config")) args.push("--strict-mcp-config");
        if (claudeCliSupports(cliVersion, "--setting-sources")) args.push("--setting-sources", "project");
      }
      // The bot's plugins (server/bot-plugins.ts): skills, commands and
      // agents only, loaded for this session. A guest's confined turn gets none.
      if (!turn.guestConfined && claudeCliSupports(cliVersion, "--plugin-dir")) {
        for (const dir of turn.pluginDirs ?? []) args.push("--plugin-dir", dir);
      }
      const compactWindow = autoCompactWindow(turnEnvironment);
      if (compactWindow && cliHasAutocompact === true) {
        args.push("--autocompact", compactWindow);
      }
      // A resumed conversation can still carry an earlier assignment, place
      // or teammate list in Claude's recorded system prompt, so every turn
      // refreshes the recorded prompt, on --resume too. Gated by the version
      // floor like every other flag the CLI may predate: an unknown flag is a
      // hard argument error, not a graceful degrade.
      if (cliVersionChecked && claudeCliSupports(cliVersion, "--system-prompt-snapshot")) {
        args.push("--system-prompt-snapshot", "off");
      }
      const turnModel = config.managed ? turn.model : await resolveClaudeTurnModel(turn.model, turnEnvironment);
      const injected = config.managed ? { model: turnModel ?? null, injected: false } : applyClaudeInject({ ...turnEnvironment }, turnModel);
      if (injected.model) args.push("--model", injected.model);
      if (turn.effort) args.push("--effort", turn.effort);

      // A room prompt can contain section context, skills, memory, playbooks,
      // and browser/agent instructions. Passing that text directly on argv
      // exceeds Windows' CreateProcess command-line limit and surfaces as
      // `spawn ENAMETOOLONG`. Claude accepts the same prompt from a file, so
      // keep both the text and its potentially sensitive contents off argv.
      let systemPromptPath: string | null = null;

      // integrations → MCP servers; pre-allow their tools (a headless
      // acceptEdits run silently denies anything unlisted)
      const mcpServers: Record<string, unknown> = {};
      const allowed: string[] = [];
      // The harness's browser, cloud computer and Data servers over HTTP
      // (server/harness-mcp-http.ts) instead of a Node proxy each. A turn
      // with a tool selection keeps the stdio proxy: its gate wraps a stdio
      // upstream exactly as before.
      const harnessHttp = (spec: Parameters<typeof harnessMcpHttpSpec>[0], kind: Parameters<typeof harnessMcpHttpSpec>[1]) =>
        turn.toolScope === undefined ? harnessMcpHttpSpec(spec, kind) : null;
      if (turn.integrations?.localComputer) {
        const local = turn.integrations.localComputer;
        // The cloud computer's harness proxy is reached over HTTP directly
        // (server/harness-mcp-http.ts): no Node process per session.
        mcpServers.computer = harnessHttp(local, "computer") ?? {
          command: local.command,
          args: local.args,
          env: local.env,
        };
        // The isolated Local VM preserves the established pre-allow behavior.
        // Host tools always route through Sagax's permission broker.
        if (!controlsHost) allowed.push("mcp__computer");
      }
      // peer-agent comms (list_bots/ask_bot) — the harness builds the whole
      // spawn contract (command/args/env incl. the boot token) in
      // agentsIntegration(); pre-allowing matters doubly here, or the CLI's
      // own ListAgents look-alike shadows it and "@Bot" asks go nowhere
      if (turn.integrations?.agents) {
        // Coordination is foundational, not an optional deferred lookup.
        // Claude waits for always-loaded tools before building the prompt.
        // Rare agents tools wait for tool search (agents-catalog.ts
        // DEFERRED_AGENT_TOOL_NAMES): about 15,000 fewer prompt tokens a turn.
        // Not when the turn names its built-ins (a guest's turn, an instance
        // tool list) without ToolSearch: a deferred tool would be unreachable.
        const toolSearch = !turn.guestConfined && (config.tools === undefined || config.tools.includes("ToolSearch"));
        // #1276: a compact prompt lists the core and searches the rest
        // itself (agents-proxy.ts); Claude Code's own tool search is off.
        const agentsEnv = turn.compactPrompt
          ? { ...turn.integrations.agents.env, SAGAX_COMPACT_TOOLS: JSON.stringify({ core: turn.compactPrompt.agents.core, pinned: [...new Set(turn.compactPrompt.agents.pinned)].sort() }) }
          // The whole catalog, with each family of tools as one tool
          // (agents-merged.ts): a family call is asked about as the tool it
          // runs (permission broker, searched-tool-call.ts).
          : toolSearch ? { ...turn.integrations.agents.env, SAGAX_DEFER_RARE_TOOLS: "1", SAGAX_MERGED_TOOLS: "1" } : { ...turn.integrations.agents.env, SAGAX_MERGED_TOOLS: "1" };
        mcpServers.agents = { ...turn.integrations.agents, env: agentsEnv, alwaysLoad: true };
        // The process is kept from turn to turn: the turn's comms token and
        // depth (new every turn) ride a file the proxy reads on each call,
        // and leave the spawn contract (withoutTurnTokens below), so a
        // teammate's reply resuming this turn reuses this process.
        // Never rewritten under a turn still running on this thread's process.
        if (turn.integrations.agents.env?.SAGAX_COMMS_TOKEN && !sessions.get(threadId)?.turn) {
          mcpServers.agents = { ...turn.integrations.agents, env: warmCommsEnv(threadId, botId, agentsEnv), alwaysLoad: true };
        }
        allowed.push(...agentsAllowedTools(turn.integrations.agents.env));
        // The finding tools run nothing; call_tool and use_tool ask as the
        // tool they run (permission-proxy.ts, #1374).
        if (turn.compactPrompt && !allowed.includes("mcp__agents")) allowed.push(...COMPACT_DIRECTORY_TOOLS.map((tool) => `mcp__agents__${tool}`));
      }
      if (turn.integrations?.phone) {
        mcpServers.phone = { ...turn.integrations.phone };
        allowed.push("mcp__phone");
      }
      // Pre-allowed: the Messages tool itself posts the send card (including
      // under Full access) and refuses anything that is not this Mac.
      if (turn.integrations?.messages) {
        mcpServers.messages = { ...turn.integrations.messages };
        allowed.push("mcp__messages");
      }
      if (turn.integrations?.browser) {
        // Mounted, not pre-allowed: file: and loopback navigations stay on
        // the approval path, and the browser route refuses them outright.
        // Behind tool search, the first browser action costs a ToolSearch
        // model step. Load the tools up front when browsing is the point.
        const browser = harnessHttp(turn.integrations.browser, "browser") ?? turn.integrations.browser;
        mcpServers.browser = turn.preloadBrowserTools
          ? { ...browser, alwaysLoad: true }
          : { ...browser };
      }
      if (turn.integrations?.data) {
        // Mounted, not pre-allowed (2026-10-16 security review): each Data
        // call reaches Sagax's approval path, where the person's rules, the
        // safety review and the security keys apply, and a call that stays
        // in the bot's workspace is answered without a card.
        mcpServers.data = { ...(harnessHttp(turn.integrations.data, "data") ?? turn.integrations.data) };
      }
      // dweb network daemon (status / repo / opencode model access) via
      // server/drivers/dweb-proxy.ts — points at the configured dweb instance
      if (turn.integrations?.dweb) {
        mcpServers.dweb = {
          command: process.execPath,
          args: [DWEB_PROXY_PATH],
          env: {
            ...NODE_ENV_FLAG,
            DWEB_URL: turn.integrations.dweb.url,
          },
        };
        allowed.push("mcp__dweb");
      }
      // user-configured servers mount like any integration but are NOT
      // pre-allowed: acceptEdits silently denies unlisted tools, which
      // routes every custom tool call through the ogb permission broker
      // into an Allow/Deny card. Reserved names were filtered upstream;
      // skip any residual collision instead of clobbering a built-in.
      // A remote entry ({type, url, headers}) is already in the CLI's own
      // shape and the CLI connects to it itself; header values ride in the
      // 0600 config file like every other credential here.
      // Claude Code is the one engine that keeps its own connection: every
      // other engine reaches URL servers through Sagax's remote proxy
      // (mcp-remote-proxy.ts), whose minimal handshake strict servers
      // accept. Claude Code 2.1.292 sends only fields the MCP spec defines
      // (2025-11-25: roots, elicitation.form/url, clientInfo), none of the
      // rmcp extensions (schemaValidation) Codex and Grok link, and a strict
      // server that knows the current spec accepts it (captured Oct 8 2026
      // against testing/fake-http-mcp-server.ts `strictInitialize`). Its
      // native transport also keeps Claude Code's own MCP tool search,
      // which defers big catalogs instead of loading them up front.
      // Bot-owned servers, gated below: they are the ones that answer for a
      // machine rather than for a context window.
      const botOwned = new Set<string>();
      for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) {
        if (Object.hasOwn(mcpServers, name)) continue;
        // A Perspicax profile bridge: its turn capability rides a file (like
        // the agents comms token above), so a pre-warmed process is kept.
        // Never rewritten under a turn still running on this thread's process.
        const serverEnv = (server as { env?: Record<string, string> }).env;
        mcpServers[name] = serverEnv?.[PERSPICAX_TOKEN_ENV] && !sessions.get(threadId)?.turn
          ? { ...server, env: warmPerspicaxEnv(threadId, botId, serverEnv) }
          : { ...server };
        botOwned.add(name);
      }
      // computer_select only chooses among the computers this turn may
      // already reach (server/auto-computer.ts): no card for the choice
      // itself; every tool it routes to still rides the approval mode.
      if (mcpServers[AUTO_COMPUTER_MCP_NAME]) allowed.push(`mcp__${AUTO_COMPUTER_MCP_NAME}`);
      // Pure Flow compute now lives in the signed Perspicax pack. Keep
      // its existing read-only treatment, only on harness-owned bridges.
      for (const [name, spec] of Object.entries(turn.integrations?.custom ?? {})) {
        if (mcpServers[name] && isPerspicaxBridge(spec)) {
          allowed.push(...PERSPICAX_FLOW_COMPUTE_TOOLS.map((tool) => `mcp__${name}__${tool}`));
        }
      }
      // --strict-mcp-config (above) makes this config the CLI's only source
      // of MCP servers, so a server the bot's OWN project declares would
      // otherwise vanish with the machine's. Merge it last: a project file
      // can add servers but never shadow a harness-owned mount.
      // Never for a guest's turn: its folder is its own to write, and a
      // server declared there would run a command.
      if (isolated && turn.cwd && !turn.guestConfined) {
        for (const [name, server] of Object.entries(projectMcpServers(turn.cwd))) {
          if (Object.hasOwn(mcpServers, name)) continue;
          mcpServers[name] = server;
          botOwned.add(name);
        }
      }
      // One tool call can put more into the conversation than the whole rest
      // of the session: a single product search measured 60-140 KB of JSON,
      // and the CLI re-reads it on every later model call. The harness never
      // sees these calls — the CLI runs the server itself — so the only place
      // to stand is between the two processes. Harness-owned mounts (the
      // permission broker, computer, browser, agents, dweb) are left alone
      // here: the harness answers them itself and cuts a machine's output
      // (a command, a file) where it answers (tool-output-bound.ts).
      // Each server's own result size limit, else the app's (customServerGate).
      // #1276: in a compact prompt every server the bot owns is gated with the
      // gate's own tool search (mcp-gate-search.ts): a big catalog lists only
      // the bot's most used tools whole.
      const searchedMounts = new Set<string>(turn.compactPrompt && turn.integrations?.agents ? ["agents"] : []);
      for (const name of turn.toolScope === undefined ? botOwned : Object.keys(mcpServers)) {
        if (!canUseMcpServer(turn.toolScope, name)) { delete mcpServers[name]; continue; }
        // a server may be named like an Object property ("constructor"): own keys only
        const search = turn.compactPrompt && botOwned.has(name) ? { pinned: Object.hasOwn(turn.compactPrompt.pinned, name) ? turn.compactPrompt.pinned[name]! : [] } : undefined;
        if (search) searchedMounts.add(name);
        const gated = gateServer({ name, server: mcpServers[name], threadId, nodeEnv: NODE_ENV_FLAG, toolScope: turn.toolScope, ...(search ? { search } : {}), ...customServerGate(name, botOwned.has(name), turn.integrations?.customResultBudgets, turnEnvironment) });
        if (gated) mcpServers[name] = { ...gated, ...((mcpServers[name] as { alwaysLoad?: unknown })?.alwaysLoad === true ? { alwaysLoad: true } : {}) };
      }
      // an allowed name is mcp__<server> or mcp__<server>__<tool> (agentsAllowedTools)
      allowed.splice(0, allowed.length, ...allowed.filter((name) => Object.hasOwn(mcpServers, name.slice("mcp__".length).split("__")[0])));
      // Approve for me: the built-ins that never need a person (read-only
      // shell lines, a web search, the task list). Deny rules still win, so
      // a withheld host tool stays withheld.
      if (autoAllowlist && !turn.guestConfined) allowed.push(...claudeAutoAllowedTools());
      // Keep ask_user available even in Full access. Native bypass skips
      // permission prompts, not questions requiring a person's answer.
      let broker: Awaited<ReturnType<typeof createPermissionBroker>> | undefined;
      const socketPath = permissionSocketPath(threadId, botId);
      if (permissionMode !== "bypassPermissions") {
        args.push("--permission-prompt-tool", "mcp__ogb__approve");
      }
      const permissionEnv: Record<string, string> = {
        ...NODE_ENV_FLAG,
        ...(turn.toolScope !== undefined ? { SAGAX_PERMISSION_TOOL_SCOPE: JSON.stringify(turn.toolScope) } : {}),
        ...(searchedMounts.size ? { SAGAX_PERMISSION_SEARCHED: JSON.stringify([...searchedMounts].sort()) } : {}),
      };
      // Finding a tool runs nothing: search_tools and describe_tool of a
      // searched server never ask (call_tool asks as the tool it runs).
      for (const name of searchedMounts) {
        if (name !== "agents" && mcpServers[name]) allowed.push(`mcp__${name}__search_tools`, `mcp__${name}__describe_tool`);
      }
      mcpServers.ogb = { command: process.execPath, args: [PERM_PROXY_PATH, socketPath], env: permissionEnv, alwaysLoad: true };
      allowed.push("mcp__ogb", ...gateQueryTools(mcpServers));
      // A guest's turn pre-allows only the harness's own tools: anything
      // else (the browser can open a file: address) asks the owner first.
      if (turn.guestConfined) allowed.splice(0, allowed.length, ...allowed.filter((name) => name === "mcp__ogb" || name === "mcp__agents" || name.startsWith("mcp__agents__")));
      // #1374: what the turn pre-allows by name, so a call_tool or use_tool
      // runs unasked exactly when its target would have, and asks otherwise.
      const preallowed = allowed.filter((name) => /^mcp__[\w-]+(?:__[\w.:-]+)?$/.test(name) && name !== "mcp__ogb");
      if (preallowed.length) permissionEnv.SAGAX_PERMISSION_PREALLOWED = JSON.stringify([...new Set(preallowed)].sort());
      // The MCP config carries credentials — the boat token in the computer
      // proxy's env, the comms token in
      // the agents proxy's env. On argv every one of those is world-readable
      // through `ps` for the life of the turn, to any local process. The CLI
      // accepts a FILE for this flag, so the secrets go in a 0600 file that
      // is removed when the turn settles.
      let mcpConfigPath: string | null = null;
      if (Object.keys(mcpServers).length) {
        mcpConfigPath = join(mkdtempSync(join(tmpdir(), "omb-mcp-")), "mcp.json");
        args.push("--mcp-config", mcpConfigPath);
        args.push("--allowedTools", allowed.join(","));
      }

      const env = environment(turnModel, turn.access);
      // No claude.ai connector unless the turn asked for them: the docs say
      // --strict-mcp-config alone does not exclude them, so say it twice.
      if (isolated && !mcpFromUserConfig && !keepsClaudeAiConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
      const authSettings = isolated && !injected.injected
        ? readClaudeAuthSettings(env, input.environment) : {};
      // Harness hooks (item 0.2): one helper command for the events the
      // harness observes. The helper reads its bearer from a per-thread file
      // the harness refreshes every turn, so a long-lived CLI process never
      // presents a stale token. Registered through the same private
      // --settings file as the auth override; both are 0600 and per launch.
      const hooks = turn.integrations?.hooks;
      const hookTokenPath = hooks ? hookTokenFile(threadId, botId) : null;
      if (hooks && hookTokenPath) {
        mkdirSync(dirname(hookTokenPath), { recursive: true, mode: 0o700 });
        // The bearer is usually the same as last turn, and it only lives in
        // this process's memory, so a restart invalidates the file anyway:
        // skip identical bytes and the fsync. A rotated bearer differs from
        // what is on disk, so it is always written before the CLI launches.
        writeFileAtomicIfChanged(hookTokenPath, hooks.token, { mode: 0o600, durable: false });
        env.SAGAX_HOOK_URL = hooks.url;
        env.SAGAX_HOOK_TOKEN_FILE = hookTokenPath;
        env.SAGAX_HOOK_NODE = process.execPath;
        env.SAGAX_HOOK_HELPER = HOOK_HELPER_PATH;
        // in the packaged app process.execPath is Electron — run the helper as node
        if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
      }
      const settings: Record<string, unknown> = { ...authSettings };
      // Project-only settings still discover the personal memory through ancestor
      // directories when the bot workspace lives below HOME. Keep project memory.
      if (isolated) settings.claudeMdExcludes = [join(homedir(), ".claude", "CLAUDE.md")];
      if (hooks) settings.hooks = claudeHookSettings(HOOK_HELPER_PATH);
      if (turn.guestConfined) settings.permissions = GUEST_CLAUDE_PERMISSIONS;
      else {
        const allow = instanceClaudeAllowRules();
        // Always deny reads of the remote-support folder: on an organization
        // server the engine runs in the Sagax container, so the technician key
        // and the session addresses would otherwise be on its filesystem.
        const deny = remoteSupportDenyRules();
        if (allow.length || deny.length) settings.permissions = { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) };
      }
      // #1276: a compact prompt keeps Claude Code's auto memory in one folder
      // per bot and person, so its path (in the system prompt) is the same in
      // every conversation, and turns Claude Code's own tool search off: the
      // tools listed are exactly the ones Sagax lists, the same every time.
      if (turn.compactPrompt?.memoryDir) {
        const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
        adoptLegacyAutoMemory(turn.compactPrompt.memoryDir, legacyClaudeAutoMemoryDir(configDir, turn.cwd ?? homedir()));
        settings.autoMemoryDirectory = turn.compactPrompt.memoryDir;
      }
      if (turn.compactPrompt) env.ENABLE_TOOL_SEARCH = "false";
      // Otherwise tool search is always on where the turn can search: MCP
      // tools Sagax does not load up front (alwaysLoad) wait for ToolSearch.
      // The CLI's own default ("auto") sends every schema while they fit in
      // the model's window, which on a 1M-token model is always, and flips
      // when they stop fitting, so the cached tool list is rewritten.
      // A value the person set for the engine stays theirs.
      else if (!env.ENABLE_TOOL_SEARCH && !turn.guestConfined && (config.tools === undefined || config.tools.includes("ToolSearch"))) env.ENABLE_TOOL_SEARCH = "true";
      const authSettingsPath = mcpConfigPath && Object.keys(settings).length
        ? join(dirname(mcpConfigPath), "auth-settings.json") : null;
      if (authSettingsPath) args.push("--settings", authSettingsPath);
      // Our approvals and browser credentials expire at the user-turn
      // boundary. Native background workers cannot outlive that boundary;
      // parallel bot work must use the harness's durable delegate_bot path.
      env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
      // Command variables the person exposed to this bot (credential-command-env.ts).
      for (const [name, value] of cleanCommandVariables(turn.commandEnvironment)) env[name] = value;
      // Desktop bridge: this turn's own network traffic leaves through the
      // person's computer (never the model traffic: NO_PROXY).
      if (turn.networkProxy) Object.assign(env, networkProxyEnvironment(turn.networkProxy, env));
      // The harness's own HTTP servers are on loopback: never through a proxy.
      if (["browser", "computer", "data"].some((name) => (mcpServers[name] as { type?: unknown } | undefined)?.type === "http")) {
        Object.assign(env, loopbackNoProxy(env));
      }
      const cwd = turn.cwd ?? homedir();
      const commandCwd = permissionLaunchCwd(cwd);
      // Everything that shapes the process, minus session/turn-specific temp
      // paths. Their contents are represented directly in the key instead.
      const privateFileFlags = new Set(["--mcp-config", "--settings"]);
      const keyArgs = args.filter((a, i) => !privateFileFlags.has(a) && !privateFileFlags.has(args[i - 1] ?? ""));
      const contract = {
        args: keyArgs,
        // the volatile half is deliberately absent: it must not respawn a
        // healthy session (see Session.volatile)
        system: turn.systemStable ?? turn.system ?? null,
        // a call's turns share one process: their per-turn tokens are not
        // part of what makes a process (they ride a file, see above)
        mcpServers: withoutTurnTokens(mcpServers),
        warm: turn.keepWarm === true,
        cwd,
        model: injected.model ?? null,
        base: env.ANTHROPIC_BASE_URL ?? null,
        configDir: env.CLAUDE_CONFIG_DIR ?? null,
        // another person's computer (or none) never reuses this process
        proxy: turn.networkProxy?.url ?? null,
        // hooks on/off changes the settings file the process was launched with
        hooks: Boolean(hooks),
        // #1276: a compact prompt is another launch (memory folder, tool search)
        compact: turn.compactPrompt ? { memoryDir: turn.compactPrompt.memoryDir ?? null } : null,
        // Slice 4: another person's credentials never reuse this process.
        access: turn.access?.identity ?? null,
        // A changed command variable starts a fresh process (a digest only).
        commandEnv: commandVariablesDigest(turn.commandEnvironment),
        // Rotating an account's key/helper must not reuse the old process.
        auth: createHash("sha256").update(JSON.stringify({
          settings: authSettings,
          env: Object.fromEntries(CLAUDE_ACCOUNT_ENV_KEYS.map((key) => [key, env[key]])),
        })).digest("hex"),
      };
      const argsKey = JSON.stringify(contract);

      // Reuse the live process when it is idle, unchanged, and is the session
      // the harness wants resumed. Clearing a cursor alone does not opt out
      // of legacy reuse: an explicit rebuild must discard the idle context.
      const live = sessions.get(threadId);
      const dropUnusedMcp = () => {
        if (!mcpConfigPath) return;
        try {
          rmSync(dirname(mcpConfigPath), { recursive: true, force: true });
        } catch {}
        mcpConfigPath = null;
      };
      const switches = turnSwitches(mcpServers);
      if (!turn.sessionReset && live && !live.turn && !live.closing && live.child.exitCode === null && live.argsKey === argsKey && switchesCover(live.switches, switches) && (!sessionId || sessionId === live.sessionId)) {
        if (live.idleTimer) clearTimeout(live.idleTimer);
        // A second warm of the same call keeps the process and writes nothing.
        if (turn.warmOnly === true) {
          dropUnusedMcp();
          holdWarm(threadId, live, turnId, turn.warmSignal);
          return { turnId, reused: true };
        }
        // Attach before any await so a hangup abort cannot close a process
        // this turn now owns. Init that arrived during the warm is published
        // once here: a cancelled warm never emits, so it cannot overwrite a
        // resume cursor, and a CLI that already announced init does not have
        // to announce it again.
        const publishWarmInit = live.idleWarm === true && live.sawInit && Boolean(live.sessionId);
        live.idleWarm = false;
        live.warmToken = undefined;
        live.turn = { turnId, input: turn, retryAbort, settled: false, sawStreamDelta: false, awaitingInit: true, pendingSteers: new Set(), deferred: null, continuationGrace: null, continuationSilence: null };
        active.set(threadId, { stop: () => {
          if (live.turn) live.turn.stopRequested = true;
          closeSession(threadId, "interrupted");
          retry.cancelled = true;
          retryAbort.abort();
          stopSession(live);
        }, turnId, broker: live.broker });
        emit({ ...base(threadId, turnId), type: "turn.started" });
        if (publishWarmInit && live.sessionId) {
          emit({ ...base(threadId, turnId), type: "session.started", sessionId: live.sessionId, model: live.sessionModel ?? null });
        }
        const volatile = turn.systemVolatile ?? "";
        const message = volatileTurnMessage(turn, live.volatile, live.volatileSections);
        if (!turn.harnessCommand) {
          live.volatile = volatile;
          live.volatileSections = turn.systemVolatileSections ? sectionFingerprints(turn.systemVolatileSections) : undefined;
        }
        const running = live.turn;
        // A warm process can end between turns just as the next one is
        // written: this driver learns of an exit only when the event loop
        // gets to it (later still on Windows), so the check above can find it
        // live and the write then fail. Nothing was submitted; its close
        // resumes this same turn on a fresh process (see `awaitingInit`).
        if (!(await writeUser(live, threadId, message)) && !running?.stopRequested) closeSession(threadId, "stdin write failed");
        // the MCP config was for the first spawn; nothing to clean here
        if (mcpConfigPath) {
          try {
            rmSync(dirname(mcpConfigPath), { recursive: true, force: true });
          } catch {}
        }
        return { turnId, reused: true };
      }
      if (live) {
        // A real turn owns the process. A warm must not close it.
        if (turn.warmOnly === true && live.turn) {
          dropUnusedMcp();
          return { turnId };
        }
        // A relaunch costs the engine's whole cold start (on a call, most of
        // the pause before the answer): say which fields of the spawn
        // contract changed (names only, never values).
        if (!turn.sessionReset) {
          const why = live.argsKey !== argsKey ? `spawn contract changed (${live.contract ? contractChanges(live.contract, contract).join(", ") : "unknown"})`
            : !switchesCover(live.switches, switches) ? "the turn needs agents tools the live process was launched without"
            : live.child.exitCode !== null ? "process exited" : live.closing ? "process closing" : live.turn ? "a turn is running" : "another session";
          console.warn(`claude (${instanceId}): thread ${threadId} relaunch: ${why}`);
        }
        // A relaunch reconnects every MCP server: say which ones changed, so
        // tools that come and go between turns can be traced.
        if (!turn.sessionReset && live.mcpNames) {
          const now = Object.keys(mcpServers);
          const added = now.filter((name) => !live.mcpNames!.includes(name));
          const removed = live.mcpNames.filter((name) => !now.includes(name));
          if (added.length || removed.length) {
            console.warn(`claude (${instanceId}): thread ${threadId} relaunched; MCP servers${added.length ? ` added ${added.join(", ")}` : ""}${removed.length ? ` removed ${removed.join(", ")}` : ""}`);
          }
        }
        closeSession(threadId, turn.sessionReset ? "context reset" : "spawn contract changed");
      }

      // A new process gets the stable half only and its first message the
      // volatile half (memory, recent work, roster...): the prompt file stays
      // byte-identical while those change, so a relaunch of this thread
      // (idle close, restart, a contract change) reads the conversation from
      // the provider's cache instead of writing it again (port of
      // OpenMausBot #3164). A legacy unsplit turn keeps its whole prompt.
      const halves = promptHalves(turn);
      const launchSystem = halves.stable ?? turn.system;
      const launchVolatile = halves.stable !== null ? halves.volatile.trim() : "";
      const heldBefore = heldVolatile.get(threadId);
      heldVolatile.delete(threadId);
      const held = halves.stable !== null && heldBefore && heldBefore.sessionId === sessionId ? heldBefore : undefined;

      // Until sessions.set() below, this turn owns every launch resource.
      // Any bind, private-config or synchronous spawn failure must release
      // them here rather than leave a live listener or credential temp file.
      const cleanupUnownedLaunch = () => {
        broker?.close();
        broker = undefined;
        if (mcpConfigPath) {
          try {
            rmSync(dirname(mcpConfigPath), { recursive: true, force: true });
          } catch {}
          mcpConfigPath = null;
        }
        if (systemPromptPath) {
          removePrivateTempDir(systemPromptPath);
          systemPromptPath = null;
        }
        retryState.delete(threadId);
      };

      try {
        // Create the prompt file only for a new process. A compatible live
        // session has already consumed the same system prompt at launch.
        if (launchSystem) {
          systemPromptPath = join(mkdtempSync(join(tmpdir(), "omb-system-")), "prompt.txt");
          writeFileSync(systemPromptPath, launchSystem, { mode: 0o600 });
          args.push("--append-system-prompt-file", systemPromptPath);
        }
        // Only create a broker for a new process. A compatible retained
        // process keeps its existing proxy connection and broker across turns.
        if (socketPath) {
          // remembers which tool each pending ask came from, so the resolved
          // event can scope approvals to real desktop-control tools only
          const askTools = new Map<string, string | undefined>();
          broker = await createPermissionBroker({
            socketPaths: brokerSocketCandidates(threadId, botId),
            isActive: () => Boolean(sessions.get(threadId)?.turn),
            onAsk: (ask) => {
              const eventTurnId = sessions.get(threadId)?.turn?.turnId ?? turnId;
              askTools.set(ask.id, typeof ask.tool === "string" ? ask.tool : undefined);
              // Approve for me no longer runs the CLI's reviewer (see
              // requestedMode), so an ask never reports one.
              const questions = askQuestions(ask);
              emit({
                ...base(threadId, eventTurnId),
                type: "request.opened",
                requestId: ask.id,
                requestType: ask.kind,
                tool: ask.tool,
                summary: askSummary(ask),
                input: ask.kind === "permission" ? askInputDetail(withAbsolutePaths(ask.tool, ask.input, cwd) as typeof ask.input) : undefined,
                command: ask.kind === "permission" && ask.tool === "Bash"
                  ? permissionCommand(ask.input.command, commandCwd) : undefined,
                paths: ask.kind === "permission" ? permissionPaths(ask.tool, ask.input, cwd) : undefined,
                requiresExplicitApproval: ask.kind === "permission" && ask.tool === "Bash" && ask.input.dangerouslyDisableSandbox === true || undefined,
                // the proxy hands Claude its own suggested rules on `always`,
                // on the person's own computer too: they live in this
                // thread's process only, which another thread, bot or
                // person never reuses (see the spawn contract)
                allowSession: ask.kind === "permission" ? true : undefined,
                approvalScope:
                  typeof ask.tool === "string" && controlsHost && ask.tool.startsWith("mcp__computer")
                    ? "local-computer"
                    : undefined,
                questions: questions ?? undefined,
                // A structured ask still offers flat labels, for the phone
                // companions and any client that predates the question card.
                choices: questions ? questionChoices(questions) : parseChoices(ask.input?.choices),
              });
            },
            onResolve: (resolved) => {
              const eventTurnId = sessions.get(threadId)?.turn?.turnId ?? turnId;
              emit({
                ...base(threadId, eventTurnId),
                type: "request.resolved",
                requestId: resolved.id,
                behavior: resolved.behavior,
                source: resolved.source,
                approvalScope:
                  controlsHost && typeof askTools.get(resolved.id) === "string" && askTools.get(resolved.id)!.startsWith("mcp__computer") ? "local-computer" : undefined,
              });
              askTools.delete(resolved.id);
            },
          });
          // A fallback bind means the deterministic pipe is still held by an
          // earlier process's child. The proxy learns its path from argv, so
          // point it at the pipe we actually bound. argsKey deliberately keeps
          // the base path: the nonce is not part of the spawn contract, and a
          // retained session keeps its own broker object anyway.
          if (broker.socketPath !== socketPath && mcpConfigPath) {
            mcpServers.ogb = { command: process.execPath, args: [PERM_PROXY_PATH, broker.socketPath], env: permissionEnv, alwaysLoad: true };
          }
        }

        // Write once, only after the broker has selected its real endpoint.
        if (mcpConfigPath) {
          writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }), { mode: 0o600 });
        }
        if (authSettingsPath) {
          writeFileSync(authSettingsPath, JSON.stringify(settings), { mode: 0o600 });
        }
        if (sessionId) args.push("--resume", sessionId);
        else args.push("--session-id", newSessionId!);
        try {
          sessionConfigDirs.set(sessionId ?? newSessionId!, resolveClaudeConfigDir(undefined, env));
          if (sessionConfigDirs.size > 500) sessionConfigDirs.delete(sessionConfigDirs.keys().next().value!);
        } catch {}
      } catch (error) {
        cleanupUnownedLaunch();
        throw error;
      }

      // Stop reached the relaunch handle while this attempt was still setting
      // up (model probe, broker). Settle the logical turn as interrupted
      // instead of spawning a process nobody wants.
      if (relaunch && retry.cancelled) {
        cleanupUnownedLaunch();
        if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
        emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "interrupted", cost: null });
        return { turnId };
      }
      // The call ended while this warm was still building its config.
      if (turn.warmOnly === true && turn.warmSignal?.aborted) {
        cleanupUnownedLaunch();
        return { turnId };
      }

      let child: ReturnType<typeof spawnCli>;
      try {
        child = spawnCli(config.cli, args, {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        }, "bot");
      } catch (error) {
        cleanupUnownedLaunch();
        throw error;
      }
      let markClosed!: () => void;
      const session: Session = {
        closed: new Promise<void>((resolve) => { markClosed = resolve; }),
        child,
        broker,
        mcpConfigPath,
        systemPromptPath,
        argsKey,
        switches,
        turnFiles: turnFiles(mcpServers),
        contract,
        mcpNames: Object.keys(mcpServers),
        searchedMounts,
        // Launched with the stable half only, a warm process holds no
        // volatile half until its first real turn delivers it.
        // An engine slash command's launch message is the bare command, so
        // the process holds no newer copy than the one it resumed with.
        ...((turn.warmOnly === true || turn.harnessCommand) && held
          ? { volatile: held.volatile, ...(held.sections ? { volatileSections: held.sections } : {}) }
          : launchVolatile && (turn.warmOnly === true || turn.harnessCommand) ? { volatile: UNDELIVERED_VOLATILE }
            : { volatile: turn.systemVolatile ?? "", ...(turn.systemVolatileSections ? { volatileSections: sectionFingerprints(turn.systemVolatileSections) } : {}) }),
        sessionId: sessionId ?? newSessionId,
        sawInit: false,
        nativePermissionMode: null,
        replaysUserMessages,
        toolNames: new Map(),
        // A warm has no turn from the start, so a fast init cannot emit
        // under a phantom turn id.
        turn: turn.warmOnly === true ? null : { turnId, input: turn, retryAbort, settled: false, sawStreamDelta: false, pendingSteers: new Set(), deferred: null, continuationGrace: null, continuationSilence: null },
        idleWarm: turn.warmOnly === true,
        warmToken: turn.warmOnly === true ? turnId : undefined,
        idleTimer: null,
        closing: false,
        stderr: "",
        costTotal: undefined,
      };
      sessions.set(threadId, session);

      // settles the TURN, not the process: the CLI stays for the next
      // message until it has been quiet for SESSION_IDLE_MS
      const settle = (
        ok: boolean,
        stopReason: string | null,
        total: number | null = null,
        usage?: { input: number; output: number; cachedInput?: number },
      ) => {
        const t = session.turn;
        if (!t || t.settled) return;
        // #1768: a concurrent refresh of this person's login home can revoke
        // the token this process held. Renew once under the shared flight and
        // relaunch before treating the sign-in as gone.
        const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
        const loginDir = t.input.access?.via === "subscription" ? t.input.access.claudeConfigDir?.trim() : "";
        if (!ok && stopReason === "auth_required" && loginDir && !retry.authRaced && !retry.cancelled && !t.stopRequested) {
          t.settled = true;
          session.lastTurnFailed = true;
          session.broker?.pause();
          if (session.mcpConfigPath) {
            try { rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true }); } catch {}
            session.mcpConfigPath = null;
          }
          if (session.systemPromptPath) {
            if (removePrivateTempDir(session.systemPromptPath)) session.systemPromptPath = null;
          }
          const { turnId: racedTurnId, input: racedTurn, retryAbort } = t;
          session.turn = null;
          retry.authRaced = true;
          retryState.set(threadId, retry);
          active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId: racedTurnId });
          closeSession(threadId, "authentication race");
          void (async () => {
            const failure = t.authFailureText ?? claudeSignInExpired("authentication_failed");
            try {
              const fresh = await refreshSubscriptionHome(racedTurn, true);
              if (retry.cancelled || !fresh.ok) {
                if (active.get(threadId)?.turnId === racedTurnId) active.delete(threadId);
                retryState.delete(threadId);
                emit({ ...base(threadId, racedTurnId), type: "runtime.error", message: failure, setup: true });
                emit({ ...base(threadId, racedTurnId), type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
                return;
              }
              await sendTurn({ ...racedTurn, sessionReset: false }, racedTurnId);
            } catch (error) {
              if (active.get(threadId)?.turnId === racedTurnId) active.delete(threadId);
              retryState.delete(threadId);
              const message = error instanceof Error ? error.message : String(error);
              emit({ ...base(threadId, racedTurnId), type: "runtime.error", message: claudeSignInExpired(message), setup: true });
              emit({ ...base(threadId, racedTurnId), type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
            }
          })();
          return;
        }
        if (!ok && stopReason === "auth_required" && t.authFailureDeferred && t.authFailureText) {
          emit({ ...base(threadId, t.turnId), type: "runtime.error", message: t.authFailureText, setup: true });
        }
        t.settled = true;
        session.lastTurnFailed = !ok;
        if (t.continuationGrace) {
          clearTimeout(t.continuationGrace);
          t.continuationGrace = null;
        }
        if (t.continuationSilence) {
          clearTimeout(t.continuationSilence);
          t.continuationSilence = null;
        }
        // Resolve any ask still open for this turn, but keep the broker
        // listening for the next turn on the retained process. Between turns
        // isActive() rejects late background asks without creating cards.
        session.broker?.pause();
        // the config file holds live credentials — the CLI read it at start;
        // it must not sit on disk for the life of the session
        if (session.mcpConfigPath) {
          try {
            rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
          } catch {}
          session.mcpConfigPath = null;
        }
        if (session.systemPromptPath) {
          if (removePrivateTempDir(session.systemPromptPath)) session.systemPromptPath = null;
        }
        active.delete(threadId);
        session.turn = null;
        // A settled turn owns no retry budget. Retained CLI sessions may run
        // many later turns on this thread, and each must start fresh.
        retryState.delete(threadId);
        // Updating the executable cannot update code already loaded by this
        // pooled child. Retire it before announcing completion so an explicit
        // retry resumes on a fresh process; healthy sibling sessions stay warm.
        // An authentication failure can leave the CLI alive while it retries
        // its shared OAuth refresh: a pooled process kept around would block
        // other Claude bots refreshing their own turn. Like an incompatible
        // update, it needs a fresh process next time (port de OpenMausBot #2867).
        if (stopReason === "update_required" || stopReason === "auth_required") {
          closeSession(threadId, stopReason === "auth_required" ? "authentication required" : "update required");
        }
        // `total` is the CLI's running total for this process; the harness
        // books turn.completed.cost as this turn's own spend
        const own = turnCostFromRunningTotal(total, session.costTotal ?? null);
        if (total !== null) session.costTotal = total;
        // a turn that went on in a fresh session also spent what the full one did
        const carried = carriedCosts.get(t.turnId);
        carriedCosts.delete(t.turnId);
        renewedTurns.delete(t.turnId);
        const cost = carried === undefined ? own : Number(((own ?? 0) + carried).toFixed(10));
        emit({ ...base(threadId, t.turnId), type: "turn.completed", ok, stopReason, cost, ...(usage ? { usage } : {}) });
        if (session.child.exitCode === null && !session.closing) armIdle(threadId);
      };
      const settleResult = (result: NativeTurnResult) => settle(result.ok, result.stopReason, result.cost, result.usage);
      const currentTurnId = () => session.turn?.turnId ?? turnId;
      // The turn ran into its account's usage limit: one plain line, once, in
      // place of the CLI's words or whatever else the refused call said. It
      // settles as "quota" — never a setup failure or an update offer. The
      // refused call's own window (`api_error_params`) outranks the event's.
      const reachLimit = (frame: { api_error_params?: { rate_limit_info?: unknown } }, words: unknown) => {
        const t = session.turn;
        if (!t || t.limitReached) return;
        t.limitReached = t.explained = true;
        t.limit = claudeLimitRefusal(frame.api_error_params?.rate_limit_info) ?? t.limit;
        const said = typeof words === "string" && USAGE_LIMIT.test(words) ? words : undefined;
        emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: claudeLimitMessage(t.limit ?? null, said),
          ...claudeLimitFields(t.limit) });
      };
      // The process's first result with a cost says what --resume restored,
      // which its turns are measured from; every result is kept for a later
      // resume. A result without one (an API error) decides nothing yet.
      const noteCostState = (total: unknown, modelUsage: unknown, usage: Parameters<typeof restoredCostBase>[2]) => {
        const state = claudeCostSnapshot(total, modelUsage);
        if (!state) return;
        if (session.costTotal === undefined) {
          session.costTotal = session.sessionId
            ? restoredCostBase(readCostHistory()[session.sessionId] ?? [], state, usage)
            : null;
        }
        if (session.sessionId) recordCostState(session.sessionId, state);
      };

      const handleLine = (line: string) => {
        if (session.closing) return;
        let o: any;
        try {
          o = JSON.parse(line);
        } catch {
          return;
        }
        authRecovery.frame(threadId, o, session.costTotal);
        // A stdin message echoed back (--replay-user-messages) carries its
        // images again: keep their bytes out of the log, as when it was sent.
        appendNative(threadId, { dir: "in", source: "claude.sdk.message", msg: o?.type === "user" && o.isReplay === true && o.message ? diagnosticClaudeUserMessage(o) : o });
        // #1373: the answer to a control request this driver sent on stdin.
        if (o?.type === "control_response") {
          const response = o.response && typeof o.response === "object" ? o.response as { request_id?: unknown; subtype?: unknown } : null;
          const id = typeof response?.request_id === "string" ? response.request_id : undefined;
          const waiter = id ? session.controlWaiters?.get(id) : undefined;
          if (id && waiter) {
            session.controlWaiters!.delete(id);
            waiter(response?.subtype === "success");
          }
          return;
        }
        // A warm process has no user turn. Record init (the resume cursor is
        // published only when a real turn attaches) and drop everything else,
        // so a call warm never writes a transcript row.
        if (session.idleWarm && !session.turn) {
          if (o?.type === "system" && o.subtype === "init") {
            const tools: unknown[] = Array.isArray(o.tools) ? o.tools : [];
            if (turn.guestConfined && (o.permissionMode !== "default" || tools.some((tool) => typeof tool === "string" && GUEST_FORBIDDEN_TOOLS.has(tool)))) {
              session.closing = true;
              stopSession(session);
              return;
            }
            session.sawInit = true;
            const liveBot = turn.botId;
            if (liveBot && Array.isArray(o.slash_commands)) {
              const liveAccess = turn.access;
              liveCommands.set(liveCommandsKey(liveBot, liveAccess?.via === "subscription" ? liveAccess.identity : undefined), {
                names: o.slash_commands.filter((name: unknown): name is string => typeof name === "string"),
                terminal: Array.isArray(o.terminal_slash_commands) ? o.terminal_slash_commands.filter((name: unknown): name is string => typeof name === "string") : [],
              });
            }
            session.nativePermissionMode = typeof o.permissionMode === "string" ? o.permissionMode : null;
            if (typeof o.session_id === "string") session.sessionId = o.session_id;
            if (typeof o.model === "string") session.sessionModel = o.model;
          }
          return;
        }
        // The continuation a held result waits for has spoken: any frame
        // after its `init` — status, thinking, text, its own result. The
        // echo of its own message is not speech: it comes before the call.
        if (session.turn?.continuationSilence && !(o.type === "system" && o.subtype === "init") && !(o.type === "user" && o.isReplay === true)) {
          clearTimeout(session.turn.continuationSilence);
          session.turn.continuationSilence = null;
        }
        switch (o.type) {
          case "system":
            if (o.subtype === "init") {
              // A guest's session proves its tool set before it does anything:
              // a CLI that kept a command-running tool is stopped here.
              const tools: unknown[] = Array.isArray(o.tools) ? o.tools : [];
              if (session.turn?.input.guestConfined && (o.permissionMode !== "default" || tools.some((tool) => typeof tool === "string" && GUEST_FORBIDDEN_TOOLS.has(tool)))) {
                emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: withWhy("This Claude Code kept its shell, so it can't run this turn. Update Claude Code.", session.turn?.input.confinedWhy) });
                session.closing = true;
                stopSession(session);
                break;
              }
              session.sawInit = true;
              // What this bot's live session can run: its MCP prompts and the
              // commands only a terminal can run (listCommands merges them).
              const liveBot = session.turn?.input.botId;
              if (liveBot && Array.isArray(o.slash_commands)) {
                const liveAccess = session.turn?.input.access;
                liveCommands.set(liveCommandsKey(liveBot, liveAccess?.via === "subscription" ? liveAccess.identity : undefined), {
                  names: o.slash_commands.filter((name: unknown): name is string => typeof name === "string"),
                  terminal: Array.isArray(o.terminal_slash_commands) ? o.terminal_slash_commands.filter((name: unknown): name is string => typeof name === "string") : [],
                });
              }
              if (session.turn) session.turn.awaitingInit = false;
              session.nativePermissionMode = typeof o.permissionMode === "string" ? o.permissionMode : null;
              if (typeof o.session_id === "string") session.sessionId = o.session_id;
              // The turn the CLI starts for a steered message it could not
              // fold (see `result`): the held result now waits for this one's
              // — bounded, so a continuation that announces itself and then
              // never speaks cannot keep the turn's pass open indefinitely.
              const held = session.turn;
              if (held?.continuationGrace) {
                clearTimeout(held.continuationGrace);
                held.continuationGrace = null;
                if (held.continuationSilence) clearTimeout(held.continuationSilence);
                held.continuationSilence = setTimeout(() => {
                  if (session.turn !== held || held.settled || !held.deferred) return;
                  // A Stop or a close settles the turn in finalizeClose.
                  if (held.stopRequested || session.closing) return;
                  held.continuationSilence = null;
                  emit({
                    ...base(threadId, held.turnId),
                    type: "runtime.error",
                    message: "Claude began a steered message but went silent; the turn was closed.",
                  });
                  settleResult(held.deferred);
                }, STEERED_CONTINUATION_SILENCE_MS * steerSilenceScale());
                held.continuationSilence.unref?.();
              }
              emit({ ...base(threadId, currentTurnId()), type: "session.started", sessionId: o.session_id, model: o.model, ...(retry.rebuilt ? { rebuilt: true } : {}) });
              // the person reads what did not carry over; announced once: a
              // steered continuation's own init re-reports the same session,
              // which is no new rebuild. A session started because the last
              // one filled up says so instead.
              if (retry.renewed) emit({ ...base(threadId, currentTurnId()), type: "runtime.notice", message: contextRenewedNotice("Claude Code") });
              else if (retry.rebuilt) emit({ ...base(threadId, currentTurnId()), type: "runtime.notice", message: rebuiltSessionNotice("Claude Code") });
              retry.rebuilt = false;
              retry.renewed = false;
            } else if (o.subtype === "compact_boundary") {
              // The CLI compacted its own session. Nothing reaches the chat
              // (the harness hides compactions); what the summary may have
              // dropped is the volatile half of the prompt (memory, roster)
              // that rode an earlier turn, so the next turn delivers it again.
              session.volatile = COMPACTED_VOLATILE;
              session.volatileSections = undefined;
            } else if (o.subtype === "thinking_tokens") {
              emit({ ...base(threadId, currentTurnId()), type: "item.updated", itemType: "reasoning", tokens: o.estimated_tokens });
            }
            break;
          case "stream_event": {
            // subagent narration is dropped — N parallel Tasks would
            // interleave their prose into one bubble (upstream-verified bug)
            if (o.parent_tool_use_id) break;
            const ev = o.event ?? {};
            if (ev.type !== "content_block_delta") break;
            const d = ev.delta ?? {};
            if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
              if (session.turn) session.turn.sawStreamDelta = true;
              emit({ ...base(threadId, currentTurnId()), type: "content.delta", streamKind: "assistant_text", delta: d.text });
            } else if (d.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking) {
              emit({ ...base(threadId, currentTurnId()), type: "content.delta", streamKind: "reasoning_text", delta: d.thinking });
            }
            break;
          }
          case "assistant": {
            const msg = o.message ?? {};
            const text = firstText(msg.content);
            // An unauthenticated turn comes back as an api-error frame whose
            // only content is the CLI's own "run /login" instruction — a
            // command this app has no terminal to run, so relaying it as a
            // reply strands the user. Every other engine reports this as a
            // setup error; that is what routes them to the sign-in card.
            if (claudeAuthFailure(o, text)) {
              const authMessage = claudeSignInExpired(text);
              if (session.turn) {
                session.turn.authFailed = session.turn.explained = true;
                session.turn.authFailureText = authMessage;
                // #1768: a subscription turn may still recover through the
                // shared refresh flight; emit the setup error only when settle
                // decides the sign-in is truly gone.
                const mayRace = session.turn.input.access?.via === "subscription"
                  && Boolean(session.turn.input.access.claudeConfigDir?.trim())
                  && !retryState.get(threadId)?.authRaced;
                if (mayRace) session.turn.authFailureDeferred = true;
                else emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: authMessage, setup: true });
              } else {
                emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: authMessage, setup: true });
              }
              break;
            }
            // An account past its usage limit runs nothing until the window
            // reopens, on any model or version: that is what to report, not
            // the update the same refused call may also have asked for.
            if (claudeUsageLimit(o, text, Boolean(session.turn?.limit))) {
              reachLimit(o, text);
              break;
            }
            if (claudeVersionTooOld(o, text)) {
              if (session.turn) session.turn.updateRequired = session.turn.explained = true;
              emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: text, setup: true, claudeUpdate: true });
              break;
            }
            // The context filled up (compaction thrashing, a prompt past the
            // window): never the CLI's "/clear" advice in the chat. The turn
            // goes on in a fresh session once this process closes.
            if (claudeContextFull(o, text) && session.turn && !session.turn.settled && !o.parent_tool_use_id) {
              session.turn.contextFull = session.turn.explained = true;
              break;
            }
            // The CLI's own report of any other API error is one plain error row
            // in the real cause, never a reply: the model never produced it.
            if ((o.is_api_error_message === true || typeof o.error === "string") && text.trim()) {
              if (session.turn) session.turn.explained = true;
              if (!session.turn?.stopRequested) emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: claudeApiErrorMessage(o, text) });
              break;
            }
            if (text.trim()) {
              if (session.turn && !o.parent_tool_use_id) session.turn.lastText = text.slice(-2_000);
              // fallback delta for CLIs/paths that never streamed the block
              if (!session.turn?.sawStreamDelta) emit({ ...base(threadId, currentTurnId()), type: "content.delta", streamKind: "assistant_text", delta: text });
              if (session.turn) session.turn.sawStreamDelta = false;
              emit({ ...base(threadId, currentTurnId()), type: "item.completed", itemType: "assistant_text", text });
            }
            for (const b of Array.isArray(msg.content) ? msg.content : []) {
              if (b.type === "tool_use") {
                // #1276: a call_tool on a searched server reads as the tool it runs
                const runs = typeof b.name === "string" ? searchedToolCall(b.name, b.input, session.searchedMounts) : { name: b.name, input: b.input };
                if (typeof b.id === "string" && typeof runs.name === "string") session.toolNames.set(b.id, runs.name);
                if (session.turn && typeof b.id === "string" && typeof runs.name === "string" && !o.parent_tool_use_id) {
                  pushRenewalStep(session.turn.steps ??= [], { id: b.id, name: runs.name, summary: commandSummary(runs.input) ?? toolDetailPreview(runs.input)?.slice(0, 200) });
                }
                emit({
                  ...base(threadId, currentTurnId()),
                  type: "item.started",
                  itemType: "tool",
                  itemId: b.id,
                  title: runs.name,
                  summary: commandSummary(runs.input),
                  input: toolDetailPreview(runs.input),
                  ...filesField(writtenFilesFromToolInput(runs.name, withAbsolutePaths(runs.name, runs.input, cwd))),
                  // a sub-agent's call: nested under the Agent call that started it
                  ...(typeof o.parent_tool_use_id === "string" && o.parent_tool_use_id ? { parentItemId: o.parent_tool_use_id } : {}),
                });
              }
            }
            if (msg.usage) {
              emit({
                ...base(threadId, currentTurnId()),
                type: "thread.token-usage.updated",
                input: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0),
                output: msg.usage.output_tokens || 0,
                ...(typeof msg.usage.cache_read_input_tokens === "number"
                  ? { cachedInput: msg.usage.cache_read_input_tokens }
                  : {}),
                // one assistant message = one model call, and its prompt is
                // everything in the window: fresh text, cache reads and writes
                contextTokens: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0),
              });
            }
            break;
          }
          case "user": {
            // --replay-user-messages: a model call took this stdin message in.
            // A steer echoed before its turn's `result` was folded into it.
            if (o.isReplay === true) {
              // a steer's words were taken in: the harness counts them received
              // (the turn's own prompt is echoed too, and is not a steer)
              if (typeof o.uuid === "string" && session.turn?.pendingSteers.delete(o.uuid)) {
                emit({ ...base(threadId, currentTurnId()), type: "steer.received", steerId: o.uuid });
              }
              break;
            }
            for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
              if (b.type === "tool_result") {
                const toolName = typeof b.tool_use_id === "string" ? session.toolNames.get(b.tool_use_id) : undefined;
                const step = session.turn?.steps?.find((entry) => entry.id === b.tool_use_id);
                if (step) {
                  step.ok = !b.is_error;
                  if (!isPhoneToolCallName(toolName)) step.output = toolDetailPreview(b.content)?.slice(0, 400);
                }
                emit({
                  ...base(threadId, currentTurnId()), type: "item.completed", itemType: "tool", itemId: b.tool_use_id, ok: !b.is_error,
                  // a phone's answer reaches the model, never the event log or the chat (phone_tool)
                  output: isPhoneToolCallName(toolName) ? PHONE_TOOL_OUTPUT_NOT_KEPT : toolDetailPreview(b.content),
                  ...(b.is_error ? {} : cwToolResult(toolName, b.content)),
                });
                // photos a phone sent go to the model only, never into the chat (phone_tool)
                for (const img of isPhoneToolCallName(toolName) ? [] : extractMcpImages(b.content)) {
                  emit({ ...base(threadId, currentTurnId()), type: "item.completed", itemType: "assistant_image", data: img.data });
                }
                if (!b.is_error && isArtifactTool(toolName)) {
                  const page = parseArtifactPublish(b.content);
                  if (page) {
                    const html = page.path ? readArtifactHtml(page.path) : undefined;
                    emit({
                      ...base(threadId, currentTurnId()),
                      type: "item.completed",
                      itemType: "assistant_text",
                      text: formatArtifactFence({ ...page, path: undefined, ...(html ? { html } : {}) }),
                    });
                  }
                }
              }
            }
            break;
          }
          case "rate_limit_event":
            // the account's usage window as the API's last response left it;
            // read only when the turn fails (claudeUsageLimit, `result`)
            if (session.turn) session.turn.limit = claudeLimitRefusal(o.rate_limit_info);
            break;
          case "tool_progress":
            // Claude Code 2.1.306 sends one every 30 s while a tool runs:
            // proof the turn is alive, so the stall watchdog keeps waiting.
            emit({ ...base(threadId, currentTurnId()), type: "item.updated", itemType: "tool" });
            break;
          case "result": {
            // A synthetic background completion is not the result of the
            // submitted user turn. Settling it would revoke browser access
            // and deny approvals while that user turn is still running.
            if (o.origin?.kind === "task-notification") break;
            // A --resume the CLI refused before announcing the session: no
            // `init`, so it never took the prompt. After a long idle 2.1.295
            // answers a session it no longer has with an error result
            // ("No conversation found with session ID …") and stays up,
            // instead of exiting. End the process: its close rebuilds the
            // conversation on a fresh session, once, as for a CLI that exits
            // before `init` (classifyResumeFailure).
            if (o.is_error === true && sessionId && !session.sawInit && session.turn && !session.turn.settled) {
              closeSession(threadId, "resume refused");
              break;
            }
            // The context filled up: the api-error frame said so, or only
            // this result does. Nothing is settled or shown here; the close
            // goes on in a fresh session (finalizeClose). A Stop is no
            // failure, and a turn already renewed once is reported there.
            if (o.is_error === true && session.turn && !session.turn.settled && !session.turn.stopRequested &&
                (session.turn.contextFull || claudeContextFull(o, "") || isContextFullText([o.result, ...(Array.isArray(o.errors) ? o.errors : [])].filter((said) => typeof said === "string").join("\n")))) {
              session.turn.contextFull = session.turn.explained = true;
              if (typeof o.total_cost_usd === "number") session.turn.contextFullTotal = o.total_cost_usd;
              closeSession(threadId, "context full");
              break;
            }
            // The usage limit refused this turn even if no frame said so: the
            // result's own error code (2.1.295) or words do, or the CLI's
            // rate_limit_event did and nothing failed the turn before it.
            if (o.is_error === true && !session.turn?.authFailed && (session.turn?.limit ||
                o.api_error === "usage_limit_reached" || USAGE_LIMIT.test(String(o.result ?? "")))) reachLimit(o, o.result);
            // Any other error result nothing has explained yet is a turn that
            // failed without an api-error frame: its own words say why, so a
            // failed turn is never an empty one. A Stop is no failure.
            // An error result whose text is the reply the turn already gave
            // (Claude Code can flag a turn that answered in full): the reply
            // stands and the turn completes. The flag is a technical note for
            // the Events lens, never the reply repainted as an error.
            const replyStands = o.is_error === true && session.turn != null && !session.turn.settled && !session.turn.explained &&
              !session.turn.stopRequested && resultRepeatsReply(o, session.turn.lastText);
            if (replyStands && session.turn) {
              session.turn.explained = true;
              emit({ ...base(threadId, currentTurnId()), type: "runtime.notice",
                message: `Claude flagged the turn as an error after its reply (${String((o.subtype !== "success" && o.subtype) || o.terminal_reason || "no reason given")}); the reply stands.` });
            }
            if (o.is_error === true && session.turn && !session.turn.settled && !session.turn.explained && !session.turn.stopRequested) {
              session.turn.explained = true;
              emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: claudeResultError(o, session.turn.lastText) });
            }
            // result.usage is this turn's own figure, "per-turn in
            // streaming-input sessions" (2.1.282) even on a retained process.
            // cache reads count as input: they are billed (at the cache rate)
            // and they fill the window — but they are reported separately
            // too, so the UI can show how much of the figure was context
            // re-read rather than new text. total_cost_usd is instead the
            // process's running total; settle() books this turn's share.
            noteCostState(o.total_cost_usd, o.modelUsage, {
              input: o.usage?.input_tokens || 0,
              cacheRead: o.usage?.cache_read_input_tokens || 0,
              cacheWrite: o.usage?.cache_creation_input_tokens || 0,
              output: o.usage?.output_tokens || 0,
            });
            const native: NativeTurnResult = {
              ok: o.is_error !== true || replyStands,
              // An error result's stop_reason is its synthetic message's
              // ("stop_sequence") or none, which says nothing; its terminal
              // reason ("api_error") or kind ("error_during_execution") does.
              stopReason: session.turn?.authFailed
                ? "auth_required"
                : session.turn?.limitReached
                  ? "quota"
                  : session.turn?.updateRequired
                    ? "update_required"
                    : o.is_error === true && !replyStands
                      ? o.terminal_reason ?? (typeof o.subtype === "string" && o.subtype !== "success" ? o.subtype : null) ?? o.stop_reason ?? null
                      : o.stop_reason ?? o.terminal_reason ?? null,
              cost: o.total_cost_usd ?? null,
              ...(o.usage
                ? {
                    usage: {
                      input: (o.usage.input_tokens || 0) + (o.usage.cache_read_input_tokens || 0) + (o.usage.cache_creation_input_tokens || 0),
                      output: o.usage.output_tokens || 0,
                      ...(typeof o.usage.cache_read_input_tokens === "number"
                        ? { cachedInput: o.usage.cache_read_input_tokens }
                        : {}),
                    },
                  }
                : {}),
            };
            const t = session.turn;
            // Does another user turn follow this result without more input?
            // The CLI says so itself when it can: queued_turn_count ("greater
            // than 0 means at least one more user turn (and result) follows",
            // 2.1.282) counts its command queue. A message steered in over
            // stdin is not in that queue when the result is written — the
            // incident's result said 0 and the CLI ran the message 58 ms later
            // — so 0, like an absent field, decides nothing; the steers the
            // driver has not seen taken in do. With --replay-user-messages the
            // CLI echoes a steer as a model call takes it in, so one still
            // pending here runs next. Without it (an older CLI), nothing says
            // whether a steer was folded in or runs next (the time a tool
            // result is read proves nothing about when stdin was taken), so
            // any steer holds the result: if no `init` follows within the
            // grace, it was folded, and the held result is the turn's. A steer
            // landing while a result is held extends the hold.
            const queuedTurns = typeof o.queued_turn_count === "number" ? o.queued_turn_count : 0;
            if (t && !t.settled && (queuedTurns > 0 || t.pendingSteers.size > 0)) {
              // The CLI runs the queued message next, in this process, with
              // this turn's tools, and the harness recorded it as part of this
              // turn. A `turn.completed` now would revoke the turn's
              // capabilities under that continuation (its internal tools would
              // answer 401) and show the bot idle while it works. Hold this
              // result until the continuation's own arrives.
              // Echoed steers leave the set as their turn takes them in;
              // without the echo, this hold answers for every steer so far.
              if (!session.replaysUserMessages) t.pendingSteers.clear();
              t.deferred = sumNativeTurnResults(t.deferred, native);
              t.armGrace = () => {
                if (t.continuationGrace) clearTimeout(t.continuationGrace);
                t.continuationGrace = setTimeout(() => {
                  // No `init` came: the message was folded into the call that
                  // just finished after all (or a queued send was cancelled),
                  // and the held result is the turn's.
                  if (session.turn !== t || t.settled) return;
                  // A Stop or a close settles the turn in finalizeClose: as
                  // interrupted after a Stop, else on the held result, which
                  // the grace still being set tells it the turn owns. (taskkill
                  // is asynchronous on Windows, so the CLI can outlive a Stop
                  // by longer than this grace.)
                  if (t.stopRequested || session.closing) return;
                  t.continuationGrace = null;
                  if (t.deferred) settleResult(t.deferred);
                }, STEERED_CONTINUATION_GRACE_MS * steerGraceScale());
                t.continuationGrace.unref?.();
              };
              t.armGrace();
              appendNative(threadId, { dir: "out", source: "claude.session", msg: { hold: `result: a steered message is still queued (queued_turn_count ${o.queued_turn_count ?? "absent"})` } });
              break;
            }
            settleResult(sumNativeTurnResults(t?.deferred ?? null, native));
            break;
          }
        }
      };

      let buf = "";
      // decode as UTF-8 across chunk boundaries — a raw `buf += chunk` splits
      // multibyte characters that straddle two reads and corrupts the text
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim()) handleLine(line);
        }
      });

      child.stderr.on("data", (c) => {
        session.stderr += c;
        if (session.stderr.length > 8192) session.stderr = session.stderr.slice(-8192);
      });

      child.on("error", (e) => {
        // A warm has no turn to fail in the thread. Close the idle process.
        if (session.idleWarm && !session.turn) {
          closeSession(threadId, "spawn error");
          return;
        }
        emit({ ...base(threadId, currentTurnId()), type: "runtime.error", ...describeSpawnFailure(e, config.cli, cwd) });
        settle(false, "spawn_error");
      });

      let closeFinalized = false;
      const finalizeClose = async (code: number | null) => {
        if (closeFinalized) return;
        // The root can close while its MCP helpers are still running. Join
        // an in-flight stop (or reap its remaining group) before releasing
        // the turn so a replacement cannot overlap the old helpers.
        if (!(await killCliTree(child, 0))) {
          session.broker?.close();
          session.broker = undefined;
          emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: "Claude could not be confirmed stopped; its helper processes may still be running." });
          return;
        }
        if (closeFinalized) return;
        closeFinalized = true;
        // a turn still running when the process died is a failed turn; a
        // process that exited between turns (idle close, contract change)
        // is just a session ending
        if (session.turn?.stopRequested && !session.turn.settled) {
          settle(false, "interrupted");
        } else if (session.turn?.deferred && !session.turn.settled) {
          // The prompt was answered — a native result is held for a steered
          // continuation — and the process went away. Never relaunch: the
          // prompt already ran. Before the continuation announced itself the
          // held result is the turn's; once it had begun, its words are lost.
          const held = session.turn.deferred;
          if (session.turn.continuationGrace) {
            settleResult(held);
          } else {
            emit({
              ...base(threadId, currentTurnId()),
              type: "runtime.error",
              message: `claude exited ${code} before result${session.stderr ? `: ${session.stderr.trim().slice(-300)}` : ""}`,
            });
            settleResult({ ...held, ok: false, stopReason: "exit_before_result" });
          }
        } else if (session.turn && !session.turn.settled && session.turn.contextFull) {
          // The CLI stopped this turn because its context filled up. The
          // person never reads its "/clear" advice: the same logical turn
          // goes on in a fresh session, given the conversation (the chat's
          // rebuild, else the turn's own text) and the steps it already took.
          // Once per turn: a fresh session that fills up too is reported in
          // plain words, and the next send starts fresh (freshNextTurn).
          const { turnId, input: turn, retryAbort } = session.turn;
          const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
          if (!retry.cancelled && !renewedTurns.has(turnId)) {
            renewedTurns.add(turnId);
            const conversation = turn.recoveryText?.trim() ? turn.recoveryText : turn.text;
            const text = renewalPrompt({ base: conversation, steps: session.turn.steps ?? [], lastText: session.turn.lastText });
            // what the full session already spent stays this turn's cost
            const spent = turnCostFromRunningTotal(session.turn.contextFullTotal ?? null, session.costTotal ?? null);
            if (spent !== null) carriedCosts.set(turnId, (carriedCosts.get(turnId) ?? 0) + spent);
            session.broker?.close();
            session.broker = undefined;
            if (session.mcpConfigPath) {
              try {
                rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
              } catch {}
              session.mcpConfigPath = null;
            }
            if (session.systemPromptPath) {
              removePrivateTempDir(session.systemPromptPath);
              session.systemPromptPath = null;
            }
            if (session.idleTimer) clearTimeout(session.idleTimer);
            if (sessions.get(threadId) === session) sessions.delete(threadId);
            session.turn = null;
            // Same relaunch handle as a rejected resume: Stop stays reachable
            // while the fresh process starts.
            retry.rebuilt = Boolean(turn.recoveryText?.trim());
            retry.renewed = true;
            retryState.set(threadId, retry);
            active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId });
            void (async () => {
              try {
                await sendTurn({ ...turn, resumeCursor: undefined, sessionReset: false, recoveryText: undefined, harnessCommand: undefined, text }, turnId);
              } catch (e) {
                renewedTurns.delete(turnId);
                carriedCosts.delete(turnId);
                if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
                retryState.delete(threadId);
                emit({ ...base(threadId, turnId), type: "runtime.error", message: e instanceof Error ? e.message : String(e) });
                emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "exit_before_result", cost: null });
              }
            })();
            return;
          }
          renewedTurns.delete(turnId);
          retryState.delete(threadId);
          const total = session.turn.contextFullTotal ?? null;
          if (retry.cancelled) {
            settle(false, "interrupted", total);
          } else {
            freshNextTurn.add(threadId);
            emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: contextFullMessage("Claude") });
            settle(false, "context_full", total);
          }
        } else if (session.turn && !session.turn.settled) {
          // A retained process may be running a later user turn. Its close
          // handler must retry that request, not the process's first prompt.
          const { turnId, input: turn, retryAbort } = session.turn;
          const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
          const message = `claude exited ${code} before result${session.stderr ? `: ${session.stderr.trim().slice(-300)}` : ""}`;
          const verdict = classifyError({ exitCode: code, stderr: message });
          // A process kept warm from an earlier turn ended before it
          // announced this one: it never took the prompt. That is a session
          // ending between turns, not a failed turn, so the same turn
          // resumes the session on a fresh process at once — no retry row,
          // no retry budget spent. (A fresh process is never retained, so
          // this happens at most once per turn.)
          const endedBeforeTurn = session.turn.awaitingInit === true;
          if (
            !retry.cancelled &&
            (endedBeforeTurn || (
              code !== 0 &&
              verdict.transient &&
              !session.turn.sawStreamDelta &&
              retry.attempt < RETRY_MAX_ATTEMPTS - 1
            ))
          ) {
            // the CLI is gone but the TURN continues: keep the thread busy,
            // emit no terminal event, and relaunch after the backoff. The
            // `active` entry STAYS — it is what makes an interrupt during
            // the backoff reach this turn's stop() and cancel the retry.
            const failedBroker = session.broker;
            session.broker = undefined;
            failedBroker?.pause();
            failedBroker?.close();
            if (session.mcpConfigPath) {
              try {
                rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
              } catch {}
              session.mcpConfigPath = null;
            }
            if (session.systemPromptPath) {
              removePrivateTempDir(session.systemPromptPath);
              session.systemPromptPath = null;
            }
            sessions.delete(threadId);
            session.turn = null;
            let delayMs = 0;
            if (!endedBeforeTurn) {
              retry.attempt++;
              delayMs = computeBackoff(retry.attempt - 1);
              emit({
                ...base(threadId, turnId),
                type: "turn.retrying",
                attempt: retry.attempt,
                delayMs,
                reason: verdict.reason,
              });
            }
            void (async () => {
              const wait = interruptibleDelay(delayMs * retryScale, retryAbort.signal);
              await wait.promise;
              // an interrupt during the backoff landed here via stop(); the
              // turn settles as interrupted and no zombie relaunch happens
              if (retry.cancelled) {
                active.delete(threadId);
                retryState.delete(threadId);
                emit({
                  ...base(threadId, turnId),
                  type: "turn.completed",
                  ok: false,
                  stopReason: "interrupted",
                  cost: null,
                });
                return;
              }
              // Keep Stop reachable while the relaunch sets up: there is no
              // process yet, so this handle only records the cancellation and
              // the relaunched sendTurn honors it before spawning.
              retryState.set(threadId, retry);
              active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId });
              try {
                const cursor = session.sessionId ?? sessionId ?? undefined;
                // The reset was consumed by the initial launch. Retry the
                // new session, never the context that launch replaced.
                await sendTurn({ ...turn, sessionReset: false, resumeCursor: cursor }, turnId);
              } catch (e) {
                if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
                retryState.delete(threadId);
                emit({
                  ...base(threadId, turnId),
                  type: "runtime.error",
                  message: e instanceof Error ? e.message : String(e),
                });
                emit({
                  ...base(threadId, turnId),
                  type: "turn.completed",
                  ok: false,
                  stopReason: "exit_before_result",
                  cost: null,
                });
              }
            })();
            return;
          }
          // A --resume that the CLI never acknowledged: it exited without
          // an `init` frame, so it never read the prompt and this turn has
          // caused nothing. Without this the thread is BRICKED — the dead
          // cursor is never cleared, so every later turn resumes the same
          // missing session and fails identically, and the user has no way
          // back except switching engines. One fresh session, carrying the
          // harness's rebuild of the conversation. Exactly one: the relaunch
          // offers no cursor, so `attempted` is false there and a second
          // failure is reported like any other.
          const resumeFailure = classifyResumeFailure({
            attempted: Boolean(sessionId),
            rejected: !session.sawInit,
            promptSubmitted: session.sawInit,
            producedOutput: session.turn.sawStreamDelta,
          });
          if (mayReplay(resumeFailure) && !retry.cancelled) {
            const recovery = recoveryPromptFor({
              recoveryText: turn.recoveryText,
              currentText: turn.text,
              failure: resumeFailure,
            });
            session.broker?.close();
            session.broker = undefined;
            if (session.mcpConfigPath) {
              try {
                rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
              } catch {}
              session.mcpConfigPath = null;
            }
            if (session.systemPromptPath) {
              removePrivateTempDir(session.systemPromptPath);
              session.systemPromptPath = null;
            }
            sessions.delete(threadId);
            session.turn = null;
            // Same relaunch handle as the transient-retry path above. The new
            // session is announced as rebuilt only when it is actually given
            // the replay: with nothing to replay it gets the turn text alone.
            // That announcement, with its notice, is what the person is told;
            // this is no retry of a failure.
            retry.rebuilt = recovery.replayed;
            retryState.set(threadId, retry);
            active.set(threadId, { stop: () => { retry.cancelled = true; retryAbort.abort(); }, turnId });
            void (async () => {
              try {
                // no cursor: a fresh session, carrying the rebuild
                await sendTurn({ ...turn, resumeCursor: undefined, recoveryText: undefined, text: recovery.text }, turnId);
              } catch (e) {
                if (active.get(threadId)?.turnId === turnId) active.delete(threadId);
                retryState.delete(threadId);
                emit({
                  ...base(threadId, turnId),
                  type: "runtime.error",
                  message: e instanceof Error ? e.message : String(e),
                });
                emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "exit_before_result", cost: null });
              }
            })();
            return;
          }
          retryState.delete(threadId);
          emit({
            ...base(threadId, currentTurnId()),
            type: "runtime.error",
            message,
          });
          settle(false, "exit_before_result");
        }
        if (session.idleTimer) clearTimeout(session.idleTimer);
        session.broker?.close();
        if (session.mcpConfigPath) {
          try {
            rmSync(dirname(session.mcpConfigPath), { recursive: true, force: true });
          } catch {}
        }
        removePrivateTempDir(session.systemPromptPath);
        if (sessions.get(threadId) === session) sessions.delete(threadId);
      };
      child.on("close", (code) => {
        session.finishClose = () => finalizeClose(code);
        void session.finishClose().finally(markClosed);
      });

      const stop = () => {
        if (session.turn) session.turn.stopRequested = true;
        // taskkill is asynchronous on Windows. Retire steering and approvals
        // now, before a still-connected child can submit more work.
        closeSession(threadId, "interrupted");
        retry.cancelled = true;
        retryAbort.abort();
        stopSession(session);
      };
      // The process is up and idle. No turn.started, no user message, and
      // the thread does not look busy (hasSession reads `active`).
      if (turn.warmOnly === true) {
        holdWarm(threadId, session, turnId, turn.warmSignal);
        return { turnId };
      }
      active.set(threadId, { stop, turnId, broker });
      emit({ ...base(threadId, turnId), type: "turn.started" });

      // prompt over stdin as a stream-json message — never argv (ARG_MAX).
      // stdin stays OPEN: that is what keeps the session alive for a
      // mid-turn steer or the next turn; closeSession() ends it.
      const launchMessage = turn.harnessCommand ? promptMsg
        : held ? volatileTurnMessage(turn, held.volatile, held.sections)
          : launchVolatile ? claudeUserMessage(withVolatileNote(turn.text, launchVolatile, true), turn.images) : promptMsg;
      if (!(await writeUser(session, threadId, launchMessage))) {
        if (!session.turn?.stopRequested) settle(false, "stdin_write_failed");
        closeSession(threadId, "stdin write failed");
      }

      return { turnId };
    };

    /** A user message into the running turn: the CLI delivers it before its
     * next model call, or — when no call is left in this turn — as its next
     * native turn, which this driver keeps inside the same logical turn.
     * "refused" when nothing is running here to steer or the stdin write
     * provably failed; the caller queues those words. */
    const steer = async (threadId: string, text: string, options?: { steerId?: string }): Promise<SteerOutcome> => {
      const s = sessions.get(threadId);
      if (!s || !s.turn || s.turn.settled || s.closing || s.child.exitCode !== null) return "refused";
      const turn = s.turn;
      // Counted before the write: a `result` read while the words are still
      // on their way must hold for them too. A failed write takes it back.
      // The uuid is what the CLI's echo names when a model call takes it in.
      const id = options?.steerId && /^[\w-]{8,80}$/.test(options.steerId) ? options.steerId : randomUUID();
      turn.pendingSteers.add(id);
      if (!(await writeUser(s, threadId, { ...claudeUserMessage(text, undefined), uuid: id }))) {
        turn.pendingSteers.delete(id);
        return "refused";
      }
      // Written while a held result waits for a continuation's `init`: these
      // words get the whole grace to be announced too.
      if (!turn.settled && turn.continuationGrace) turn.armGrace?.();
      return "steered";
    };

    // Sign in from Settings: the unmodified CLI's own login, driven over pipes
    // (server/drivers/claude-login-auth.ts). Same environment as every turn.
    const login = new ClaudeLoginController({
      cli: config.cli,
      environment,
      onAuthenticated: async () => {
        await refreshModels();
        const dir = resolveClaudeConfigDir(config.configDir, environment());
        writeFileAtomic(join(dir, LOGIN_MARKER), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
        onSoloClaudeLinked?.();
      },
    });

    const snapshot = async (): Promise<ProviderSnapshot> => {
      const env = environment();
      const probe = await readCliVersion(env);
      if (!("version" in probe)) return { state: "unavailable", reason: probe.reason };
      const { version } = probe;
      cliVersion = parseClaudeCliVersion(version);
      cliVersionChecked = true;
      if (version !== cliHelpVersion) await readCliHelp(version, env);
      const update = claudeCliUpdate(version, config.cli);
      const warning = claudeInheritWarning(env);
      if (config.requireApiKey) {
        // Never falls back to a login: without the key it is not set up.
        if (!input.environment.ANTHROPIC_API_KEY) return { state: "unavailable", version, reason: NO_ANTHROPIC_KEY };
        return { state: "available", version, authenticated: true, account: { method: "api-key" }, ...(update ? { update } : {}), ...(warning ? { warning } : {}), billing: "metered" };
      }
      const auth = await claudeAuthStatus(config.cli, env);
      // claudeEnvironment strips ANTHROPIC_API_KEY, so turns run on the
      // CLI's own login (Pro/Max): the cost it reports is what the call
      // WOULD bill, not a charge
      return { state: "available", version, ...auth, ...(update ? { update } : {}), ...(warning ? { warning } : {}), billing: "subscription" };
    };

    /** One-shot Claude call with the prompt on stdin, never argv. Approval
     * summaries can contain paths, commands, or secrets, so the generic
     * `claude -p "prompt"` shape is not safe for review. No tools or MCP
     * servers are mounted in this isolated process. */
    const generateReview = (prompt: string, signal?: AbortSignal, onUsage?: TextGenerationOptions["onUsage"], noThinking = false): Promise<string> =>
      new Promise((resolve, reject) => {
        if (config.requireApiKey && !input.environment.ANTHROPIC_API_KEY) {
          reject(new Error(NO_ANTHROPIC_KEY));
          return;
        }
        const model = config.managedModels?.[0] ?? "claude-haiku-4-5";
        const env = environment(model);
        if (noThinking) env.MAX_THINKING_TOKENS = "0";
        // Isolated unless this machine's own setup must come along: the
        // inherit escape hatch, or a login kept in settings.json (an
        // apiKeyHelper, Bedrock or Vertex variables) that --setting-sources ""
        // would drop.
        const authInSettings = Object.keys(readClaudeAuthSettings(env, input.environment)).length > 0;
        const isolation = inheritsUserConfig(env) || authInSettings ? [] : oneShotIsolationArgs(cliVersion);
        let cwd: string | undefined;
        if (isolation.length) {
          env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
          // One fixed empty private folder: no project CLAUDE.md or .mcp.json
          // above it, and one projects/ entry for every one-shot call.
          cwd = join(DATA_DIR, "claude-one-shot");
          try { mkdirSync(cwd, { recursive: true, mode: 0o700 }); } catch { cwd = undefined; }
        }
        const child = spawnCli(
          config.cli,
          ["-p", "--model", model, "--output-format", onUsage ? "json" : "text", ...isolation],
          {
            stdio: ["pipe", "pipe", "pipe"],
            env,
            ...(cwd ? { cwd } : {}),
          },
        );
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (error) reject(error);
          else resolve(stdout.trim());
        };
        const onAbort = () => {
          killCliTree(child);
          finish(new Error("Claude review aborted"));
        };
        const timer = setTimeout(() => {
          killCliTree(child);
          finish(new Error("Claude review timed out"));
        }, 60_000);
        timer.unref?.();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (stdout.length > 1_000_000) {
            killCliTree(child);
            finish(new Error("Claude review output exceeded 1 MB"));
          }
        });
        child.stderr.on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-8_192);
        });
        child.on("error", (error) => finish(error));
        child.on("close", (code) => {
          if (settled) return;
          if (onUsage) {
            try {
              const result = JSON.parse(stdout);
              if (!result || result.type !== "result") throw new Error("Claude text generation returned no result");
              const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
              const cachedInput = count(result.usage?.cache_read_input_tokens);
              const inputs = [count(result.usage?.input_tokens), cachedInput, count(result.usage?.cache_creation_input_tokens)]
                .filter((value): value is number => value !== undefined);
              const models = result.modelUsage && typeof result.modelUsage === "object" && !Array.isArray(result.modelUsage)
                ? Object.keys(result.modelUsage) : [];
              onUsage({
                model: models.length === 1 ? models[0]! : models.find(candidate => candidate === model || candidate.startsWith(`${model}-`)) ?? model,
                input: inputs.length ? inputs.reduce((sum, value) => sum + value, 0) : undefined,
                output: count(result.usage?.output_tokens),
                cachedInput,
                costUsd: count(result.total_cost_usd),
              });
              if (result.is_error === true) throw new Error(typeof result.result === "string" && result.result.trim() ? result.result : stderr.trim() || "Claude text generation failed");
              if (typeof result.result !== "string") throw new Error("Claude text generation returned no text");
              stdout = result.result;
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
              return;
            }
          }
          if (code === 0) finish();
          else finish(new Error(stderr.trim() || `Claude review exited ${code}`));
        });
        if (signal?.aborted) onAbort();
        else {
          signal?.addEventListener("abort", onAbort, { once: true });
          child.stdin.end(prompt);
        }
      });

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      get models() {
        return models;
      },
      refreshModels,
      ...(startupModelRefresh ? { startupModelRefresh } : {}),
      snapshot,
      startAuthentication: () => login.start(),
      getAuthentication: (flowId) => login.get(flowId),
      completeAuthentication: (flowId, code) => login.complete(flowId, code),
      cancelAuthentication: () => login.cancel(),
      signOut: () => login.signOut(),
      adapter: {
        provider: DRIVER_KIND,
        capabilities: {
          sessionModelSwitch: "in-session",
          withholdsHostTools: true,
          // A guest's turn runs with no command-running tool and no read
          // outside its folder (guestConfined, GUEST_CLAUDE_TOOLS).
          guestTurns: "confined",
          agentsMcp: true,
        customMcp: true,
          computerMcp: true,
          phoneMcp: true,
          browserMcp: true,
          dataMcp: true,
          images: true,
          nativeImageInput: true,
          effortLevels: ["low", "medium", "high", "xhigh", "max"],
          queueing: true,
          // Only while this CLI can be told to refresh a resumed session's
          // recorded system prompt (--system-prompt-snapshot). Keeping a
          // session across an update from outside it means the harness keeps
          // its prompt too; an older CLI would answer a delegated return with
          // the instructions of the turn that started the session, where a
          // fresh session rebuilt them. Unknown version: not yet.
          get strictResume() {
            return cliVersionChecked && cliVersion !== null && claudeCliSupports(cliVersion, "--system-prompt-snapshot");
          },
          // Harness turns reassert a per-bot mode and restore the broker even
          // when an old instance was configured with bypassPermissions.
          localComputerMcp: true,
          hooks: true,
          // A call can start this process before the first utterance, with
          // stdin open and no prompt, so the first spoken turn reuses it.
          warmSession: true,
        },
        sendTurn: (turn) => authRecovery.send(turn, sendTurn),
        steer,
        interruptTurn: async (threadId) => active.get(threadId)?.stop(),
        applyApprovalMode,
        respondToRequest: async (threadId, requestId, decision) => {
          // fail-closed by construction: no broker, or an ask that already
          // timed out / settled, is `unavailable` — the caller denies
          const broker = sessions.get(threadId)?.broker ?? active.get(threadId)?.broker;
          if (!broker) return "unavailable";
          const behavior = decision.behavior === "answer" ? "answer" : decision.behavior;
          if (!broker.answer(requestId, behavior, decision.message, decision.always)) return "unavailable";
          return behavior === "allow" ? "allowed-once" : behavior === "answer" ? "answered" : "rejected";
        },
        hasSession: (threadId) => active.has(threadId),
        releaseWarmSession: (threadId) => {
          const live = sessions.get(threadId);
          // A running turn owns the process. Hangup closes only an idle one,
          // including the process kept warm between call turns.
          if (!live || live.turn || live.closing) return;
          closeSession(threadId, "call ended");
        },
        sessionBytes: (threadId, resumeCursor) => {
          if (typeof resumeCursor !== "string") return undefined;
          // A live process already holds this session: a turn writes to it,
          // nothing is loaded from disk.
          const live = sessions.get(threadId);
          if (live && !live.closing && live.child.exitCode === null && live.sessionId === resumeCursor) return undefined;
          return sessionFileBytes(resumeCursor);
        },
        stopAll: async () => {
          for (const { stop } of active.values()) stop();
          for (const threadId of Array.from(sessions.keys())) closeSession(threadId, "stopAll");
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      generateText: (prompt, options) => generateReview(prompt, options?.signal, options?.onUsage, options?.noThinking === true),
      reviewPermission: generateReview,
      listCommands,
      dispose: async () => {
        stopRenewWatch();
        try {
          await login.dispose();
        } finally {
          for (const { stop } of active.values()) stop();
          for (const threadId of Array.from(sessions.keys())) closeSession(threadId, "dispose");
          heldVolatile.clear();
          listeners.clear();
        }
      },
    };
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
