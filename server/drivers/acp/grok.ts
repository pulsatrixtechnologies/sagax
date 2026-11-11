// Grok Build harness support — the official `grok` CLI over ACP stdio
// (`grok … agent stdio`), on the grok.com subscription login
// (~/.grok/auth.json), NOT the xAI API key (that driver is drivers/grok.ts).
// The generic protocol runtime lives in acp/core.ts; this file is only the
// per-harness quirks. Verified against grok 1.0.0.
import { GROK_PROMPT_BYTE_LIMIT } from "./prompt-fit.ts";
import type { ChildProcess } from "node:child_process";
import { spawnChild } from "../../process/spawn-helper.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { ModelCatalog, ProviderErrorCode, TurnAccessInput } from "../../contracts.ts";
import { harnessHome } from "../../env-path.ts";
import { DATA_DIR } from "../../config.ts";
import { isolateGrokMcp } from "./grok-mcp-isolation.ts";
import { resolveCli } from "../../procs.ts";
import { engineStartGate } from "../../engines/engine-start-gate.ts";
import type { DeviceSignIn } from "../device-auth.ts";
import { decodeInjectId, hostApiKey, localHost, mergeLocalInject } from "../local-inject.ts";
import { createAcpDriver, type AccountErrorCode, type AcpQuestionRequest, type AcpSupport } from "./core.ts";
import { parseModelEffortFacts } from "../../../shared/model-capabilities.ts";
import type { EffortLevel } from "../../../shared/wire.ts";
import { grokHostToolArgs, grokOrgAgentProfile } from "../host-tools.ts";
import { grokReadOnlyAllowRules } from "./grok-read-only-tools.ts";
import { gateReadOnlyTools, grokApprovalGateEnabled } from "./grok-approval-gate.ts";
import { knownGrokTools, knownGrokToolsSection, recordGrokToolUse, useToolName } from "./grok-tool-usage.ts";
import { grokCatalogFor, grokCatalogSection, grokMcpAlreadySettled, noteGrokAccountReach, rememberGrokCatalog, rememberGrokMcpSettled, forgetGrokMcpSettled } from "./grok-tool-catalog.ts";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors.ts";
import { turnReachFor } from "../../turns/turn-reach.ts";
import { turnActiveProfileFor } from "../../turns/turn-active-profile.ts";
import { grokGatewayOnTurn } from "../../connectors/turn-plan.ts";
import { narrowsNativeTools } from "../../../shared/tool-scope.ts";
import { grokToolScopeProfile, grokInheritedProfile } from "./grok-tool-scope.ts";
import { turnTrace } from "../../turns/turn-trace.ts";
import { grokMcpServerWaiting, grokMcpWaitClock } from "./grok-mcp-wait-parts.ts";
export { grokToolScopeProfile, grokInheritedProfile, allowsRegisteredTool } from "./grok-tool-scope.ts";
import {
  MAX_QUESTIONS, parseProtocolAskQuestions, pickedOptionLabels, questionAnswersById, repeatsQuestionText,
} from "../../../shared/ask-question.ts";

/** Fallback only, for when the engine cannot be asked (not installed, or no
 * answer). Grok 1.0.46 and 1.0.50 signed in to grok.com offer exactly these
 * four (`grok models`, ~/.grok/models_cache.json, verified 2026-10-08). Their
 * reasoning levels and defaults are what grok 1.0.52 answered in
 * `initialize` on 2026-10-13 (scripts/testing/fixtures/model-picker). */
export const STATIC_GROK_MODELS: ModelCatalog = {
  default: "grok-4.7",
  options: [
    { id: "grok-4.7", label: "Grok 4.7", contextWindow: 500_000, effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" },
    { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast", effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" },
    { id: "grok-4.6", label: "Grok 4.6", effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" },
    { id: "grok-4.5", label: "Grok 4.5", effortLevels: ["low", "medium", "high"], defaultEffort: "high" },
  ],
};

/** Every level any Grok model takes (the driver's capability). Each model's
 * own list rides its catalog row, and a pick or a turn is held to it
 * (shared/model-capabilities.ts): grok-4.5 refuses xhigh. */
export const GROK_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const satisfies readonly EffortLevel[];

/** Appended to the stable system half of every Grok turn (acp/core.ts
 * stableSystemHint): skip a search round for tools already discovered. */
/** SAGAX_GROK_STALL_RETRY_MS: ms of total silence after a prompt before
 * Sagax cancels and asks once more (0 turns it off). Unset, the wait follows
 * the conversation's size (grokAdaptiveStallMs). */
export function grokStallRetryMs(
  context?: { contextTokens: number | null; promptChars: number },
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SAGAX_GROK_STALL_RETRY_MS;
  if (raw !== undefined && raw.trim() !== "") {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return grokAdaptiveStallMs(context);
}

/** Grok's own system prompt and tool definitions, in tokens, that ride every
 * request beside Sagax's text (measured on the production server: a bare "pong" on a
 * new session reports ~12.5-14.7k input tokens). */
const GROK_BASE_CONTEXT_TOKENS = 13_000;
export const GROK_STALL_MIN_MS = 10_000;
export const GROK_STALL_MAX_MS = 30_000;

/** How long a silent prompt is given before the stall guard asks again.
 * Measured on the production server (179 prompts, 2026-10-11): a healthy first
 * streamed update came at p50 2.4 s / p90 7.8 s; uncached prefills of
 * 94-173k tokens took 8.7-19.8 s; the provider stalls (no update at all)
 * ran 27-90 s, some on contexts under 20k tokens. A flat 20 s wait made a
 * stalled short conversation wait 20 s; here a short one waits 10 s and a
 * long one up to 30 s (10 s plus 0.12 s per 1k tokens beyond 20k). */
export function grokAdaptiveStallMs(context?: { contextTokens: number | null; promptChars: number }): number {
  const tokens = (context?.contextTokens ?? GROK_BASE_CONTEXT_TOKENS) + Math.ceil((context?.promptChars ?? 0) / 4);
  const ms = GROK_STALL_MIN_MS + Math.max(0, tokens - 20_000) * 0.12;
  return Math.round(Math.min(GROK_STALL_MAX_MS, Math.max(GROK_STALL_MIN_MS, ms)));
}

/** Grok sends no ACP usage_update. Each model round ends with
 * `_x.ai/session_notification` response_completed, whose usage counts the
 * round's whole prompt: input_tokens (uncached) + cache_read_input_tokens.
 * That is the conversation's size in the window right now. */
export function grokRoundContextUsage(msg: any): number | undefined {
  if (msg?.method !== "_x.ai/session_notification") return undefined;
  const update = msg.params?.update;
  if (update?.sessionUpdate !== "response_completed") return undefined;
  const usage = update.usage ?? {};
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const cached = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
  return input + cached > 0 ? input + cached : undefined;
}

/** Prod 2026-11-02 (routine "Overdue invoices report"): Grok's use_tool also
 * takes `file` and `tool_input_file`, read from the disk of the Grok process
 * on the Sagax server. A bot's files live in its own environment
 * (sagax-environment write_file / run_command, /workspace), which that
 * process cannot see, so every file form failed "Cannot read complete MCP
 * source file: ... No such file or directory" before any MCP call was sent.
 * Only the inline form can work here. */
const GROK_INLINE_ARGUMENTS_HINT_TEXT =
  " Always call use_tool with tool_name and inline tool_input, even for large arguments." +
  " Never use its file or tool_input_file forms: they read the Sagax server's disk, not your environment," +
  " so a file you wrote with write_file or a command is never found there.";

/** #2604, prod 2026-11-06/07: five routines of one bot called search_tool
 * through use_tool (tool_name "search_tool") 3 to 4 times per run, each
 * refused by Grok ("search_tool is a native tool, not an MCP integration
 * tool"), and the runs ended completed with that line in their problems.
 * search_tool and use_tool are Grok's own tools, never use_tool targets. */
const GROK_NATIVE_TOOLS_HINT_TEXT =
  " search_tool and use_tool are your own tools: call search_tool directly as its own tool call, never as use_tool's tool_name" +
  " (use_tool only takes an MCP tool named <server>__<tool>)." +
  // QA 0.8.67 G8: routine runs still sent use_tool "search_tool"; a routine's
  // text or a skill saying "search for the tool" is no reason to wrap it.
  " This holds in routines too, whatever a routine or skill text says: search_tool is never wrapped in use_tool, and when use_tool answers that a name \"is a native tool\", call that tool directly by its own name next, never use_tool again." +
  " When a tool call fails with an error that says how to call it instead, follow that error on the next call; never repeat the same failing call.";

export const GROK_TOOL_REUSE_HINT =
  "\n\nTool calls: each search_tool call costs a full extra round trip. When search_tool already showed you a tool earlier in this conversation," +
  " call it again directly with use_tool (same tool_name, arguments per the schema you saw) instead of searching again. Use search_tool only for a tool you have not seen yet," +
  " and when one search returns several tools you need, call them without searching again." +
  GROK_INLINE_ARGUMENTS_HINT_TEXT +
  GROK_NATIVE_TOOLS_HINT_TEXT;

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

/** Grok's own home: `$GROK_HOME`, else `~/.grok`. Its grok.com sign-in,
 * config and catalog all live here. */
export function grokHome(env: Record<string, string | undefined> = process.env): string {
  return env.GROK_HOME || harnessHome("grok", env);
}

/** Env for the xAI account's cloud connectors (hosted and managed MCP).
 * Loaded on the person's own sign-in only (harness-connectors.ts
 * grokCloudConnectorsForTurn), on an organization turn and, since
 * 2026-10-30, on a solo server too. A tool selection stays off: that turn
 * refuses any MCP server it did not list.
 *
 * Every grok.com connector call is a use_tool call to a server Sagax did not
 * mount, and Grok asks before a use_tool call in `default` and
 * `acceptEdits` (measured on grok 1.0.70, solo, 2026-10-30: an Outlook
 * read asked in both; in `auto` Grok's own classifier ran it unasked). So a
 * turn that loads them never runs in Grok's `auto` or `bypassPermissions`
 * (grokPermissionMode): each ask reaches Sagax, which answers it at the
 * bot's level (connector-ask.ts, index.ts request.opened): a read passes, a
 * write shows its card unless an Always allow rule covers it or the level
 * is Full access.
 *
 * 2026-10-28: the grok.com connectors a person connects (Outlook, Microsoft
 * Teams, Gmail, Google Drive, SharePoint...) are served through xAI's
 * managed MCP gateway (`managed_gateway:` connectors, Grok's
 * `managed_mcps.gateway_tools_enabled`). Forcing the gateway tools off on
 * every turn left a person's own Grok turn without the very connectors
 * Capabilities lists ("no Teams connector on the Grok account"). They now
 * follow the managed configs: on for the person's own sign-in on an
 * organization turn without a tool selection, off everywhere else. A
 * gateway call is a use_tool call to a server Sagax did not mount, so it
 * keeps its card below Full access, like any engine connector.
 *
 * 2026-10-30: the gateway variable alone no longer brings anything. Grok
 * fetches the managed MCP configs (`managed_mcps.enabled`, a pinned user
 * setting that xAI now leaves unset) only when GROK_MANAGED_MCPS_ENABLED is
 * true; unset, `_x.ai/mcp/list` holds no `managed_gateway:` server at all and
 * a person whose Outlook and Teams are active on grok.com got "Grok sees no
 * connector". Measured on grok 1.0.46 (organization server, team account)
 * and 1.0.70 (personal account): unset, no gateway; true, the gateway. So
 * the on path sets both. */
export function grokCloudConnectorEnv(toolScope: unknown, ownAccount?: boolean): {
  GROK_MANAGED_MCPS_ENABLED: "true" | "false";
  GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "true" | "false";
} {
  // Review of #943 (point 5): only on the person's own xAI sign-in
  // (connectors/turn-plan.ts grokCloudConnectorsForTurn), never on an account
  // that pays for someone else's turn.
  if (toolScope !== undefined || ownAccount !== true) {
    return { GROK_MANAGED_MCPS_ENABLED: "false", GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "false" };
  }
  // set, never left to an environment variable the server inherited nor to
  // grok's own default (off since 2026-10-30, see above)
  return { GROK_MANAGED_MCPS_ENABLED: "true", GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "true" };
}

/** Whether a turn loads the xAI account's cloud connectors: the person's own
 * sign-in (turn.grokCloudConnectors) and no tool selection, the same reading
 * as grokCloudConnectorEnv. */
export function grokLoadsAccountConnectors(turn: { grokCloudConnectors?: boolean; toolScope?: unknown }): boolean {
  return turn.grokCloudConnectors === true && turn.toolScope === undefined;
}

/** Grok's `--permission-mode` for a turn.
 *
 * Without the account's connectors: a gated Auto or Full turn runs in
 * `default` (grok-approval-gate.ts, #1982) so every Sagax MCP ask reaches
 * request.opened; ungated Full (`fullAuto`) bypasses; Auto runs Grok's
 * own `auto`, Edits `acceptEdits`, Ask `default`.
 *
 * With them (2026-10-30, the operator: "Oui, avec carte, si le allow always
 * est respecté, et si je suis en bypass que ça ne le demande pas."): Grok
 * must ask before every connector call so Sagax decides it, at every level.
 * Grok's `auto` runs a connector call on its classifier's word and
 * `bypassPermissions` runs it unasked, so neither is used: Edits keeps
 * `acceptEdits` (file edits only; a use_tool call still asks), every other
 * level runs `default`. Sagax then answers each ask at the bot's level
 * (index.ts request.opened): Full access and an Always allow rule with no
 * card, a read with no card, a write with its card. A turn that carries no
 * level (an embedder's) keeps the legacy instance flag. */
export function grokPermissionMode(input: { fullAuto: boolean; gated: boolean; approvalMode?: string; accountConnectors: boolean }): string {
  if (input.accountConnectors && input.approvalMode !== undefined) return input.approvalMode === "edits" ? "acceptEdits" : "default";
  // #1982: gated before fullAuto — Full under the gate stays in default so
  // MCP asks reach Sagax (reads pass; writes follow the level with a card).
  if (input.gated) return "default";
  if (input.fullAuto) return "bypassPermissions";
  return input.approvalMode === "auto" ? "auto" : input.approvalMode === "edits" ? "acceptEdits" : "default";
}

/** The volatile catalog section for this Grok turn: known tools, the live
 * `_x.ai/mcp/list` catalog, reach pins, and connectable cloud connectors.
 * Passes the turn's active Perspicax profile so duplicate Sagax agent tools
 * across gateway connectors stay on that connector (#2258). */
export function grokTurnCatalogSection(input: {
  botId?: string;
  serverNames: string[];
  sessionId?: string;
  threadId?: string;
  accountConnectors?: boolean;
}): { id: string; text: string } | null {
  const known = knownGrokTools(input.botId, input.serverNames);
  const catalog = grokCatalogFor(input.sessionId);
  // computed by the server with the speaker and payer (turn-reach.ts)
  const reach = turnReachFor(input.threadId) ?? { lines: [], tools: [] };
  // the xAI cloud connectors an own-account org turn can connect (#966),
  // so a card connector not yet connected on grok.com is actionable
  // #3351: only when this turn's plan loads the gateway (no tool selection,
  // an engine that withholds host tools on an organization server), the
  // same plan the one connector list reads
  const gateway = input.accountConnectors === true && (input.threadId ? grokGatewayOnTurn(input.threadId) !== false : true);
  const connectable = grokConnectableConnectors(gateway);
  // routine act-as / profile_use / identity on the live Perspicax connection
  const activeProfile = turnActiveProfileFor(input.threadId, input.botId);
  if (!catalog && !reach.tools.length && !reach.lines.length && !connectable.length) return knownGrokToolsSection(known);
  return grokCatalogSection({
    catalog,
    known,
    pinned: reach.tools,
    lines: reach.lines,
    connectable,
    ...(activeProfile ? { activeProfile } : {}),
  });
}

/** The xAI cloud connectors this turn could reach through use_tool, named
 * for the capability summary (grok-tool-catalog.ts) so a connector on the
 * Connect-apps card that the person never connected on grok.com is surfaced
 * as connectable (a one-step open_connector_setup) instead of a dead end.
 * Only an own-account turn loads managed MCP at all
 * (grokCloudConnectorsForTurn -> turn.grokCloudConnectors); on any other
 * turn there is nothing to connect here, so the list is empty. The summary
 * drops any of these the live catalog already carries. */
export function grokConnectableConnectors(accountConnectors: boolean): { id: string; label: string }[] {
  if (!accountConnectors) return [];
  return GROK_CLOUD_CONNECTORS.map((connector) => ({ id: connector.id, label: connector.name }));
}

/** The grok.com sign-in a turn runs on is stored. */
export function grokSignedIn(env: Record<string, string | undefined>): boolean {
  return existsSync(join(grokHome(env), "auth.json"));
}

function grokLoginFailure(output: string): string {
  if (/(unexpected argument|unrecognized (argument|option)|unknown option).*device-(auth|code)/i.test(output)) {
    return "This server's Grok is too old to sign in with a code. Update Grok on the server, then try again.";
  }
  if (/device-code login is not available/i.test(output)) {
    return "This Grok account can't sign in with a code. Use an xAI API key instead.";
  }
  if (/expired/i.test(output)) return "The Grok sign-in code expired. Start sign-in again for a new code.";
  if (/denied|rejected/i.test(output)) return "Grok sign-in was declined in the browser. Start sign-in again to try once more.";
  return "Grok sign-in did not finish. Check the server's connection, then try again.";
}

/** Grok Build's half of the in-app sign-in (device-auth.ts): `grok login
 * --device-auth` on the grok.com subscription. Grok has no status command,
 * so nothing is checked first, and a stored login that a failed turn just
 * refused is signed in again; the sign-in is confirmed the way a turn checks
 * it. Checked against grok 1.0.25 and 1.0.41: `login --help` and the
 * device-code text in their binaries. */
export const GROK_DEVICE_SIGN_IN: DeviceSignIn = {
  provider: "grok",
  product: "Grok",
  account: "Grok",
  homeEnv: "GROK_HOME",
  homeDir: ".grok",
  loginArgs: ["login", "--device-auth"],
  install: "Install it with xAI's installer (https://x.ai/cli), then try again.",
  failure: grokLoginFailure,
  signedIn: grokSignedIn,
};

type GrokCloudModel = ModelCatalog["options"][number];

/** The account catalog Grok itself caches (`models_cache.json`, written from
 * cli-chat-proxy.grok.com/v1/models). Null when absent or unreadable. */
export function readGrokModelsCache(env: Record<string, string | undefined> = process.env): GrokCloudModel[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(grokHome(env), "models_cache.json"), "utf8"));
  } catch {
    return null;
  }
  const models = (raw as { models?: unknown } | null)?.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return null;
  const out: GrokCloudModel[] = [];
  for (const [id, entry] of Object.entries(models as Record<string, unknown>)) {
    const info = (entry as { info?: { name?: unknown; hidden?: unknown; context_window?: unknown; reasoning_efforts?: unknown; reasoning_effort?: unknown; supports_reasoning_effort?: unknown } } | null)?.info;
    if (!SLUG.test(id) || info?.hidden === true) continue;
    const contextWindow = typeof info?.context_window === "number" && info.context_window > 0 ? info.context_window : undefined;
    out.push({
      id, label: typeof info?.name === "string" && info.name.trim() ? info.name.trim() : id, ...(contextWindow ? { contextWindow } : {}),
      ...grokEffortFacts(info?.reasoning_efforts, info?.reasoning_effort, info?.supports_reasoning_effort),
    });
  }
  return out.length ? settleGrokEfforts(out) : null;
}

/** A Grok model's reasoning levels as Grok lists them (initialize `_meta`,
 * or the cached catalog's `info`): `[{ id, value, label, default }]`, the
 * one marked default first, else the model's current `reasoningEffort`. */
function grokEffortFacts(levels: unknown, current: unknown, supported: unknown): Pick<GrokCloudModel, "effortLevels" | "defaultEffort"> {
  const facts = parseModelEffortFacts(levels, current, supported);
  return { ...(facts.effortLevels ? { effortLevels: [...facts.effortLevels] } : {}), ...(facts.defaultEffort ? { defaultEffort: facts.defaultEffort } : {}) };
}

/** A Grok that reports levels for some models reports them for every model
 * that has any (grok 1.0.52): the others, local config blocks, take none.
 * An older Grok that reports none leaves every model to the driver's list. */
function settleGrokEfforts(models: GrokCloudModel[]): GrokCloudModel[] {
  if (!models.some((model) => model.effortLevels)) return models;
  return models.map((model) => (model.effortLevels ? model : { ...model, effortLevels: [] }));
}

/** What the engine answers in ACP `initialize` (`_meta.modelState`): every
 * model it would run, cloud and config blocks alike. */
export function grokModelsFromInitialize(init: unknown): GrokCloudModel[] | null {
  const available = (init as { _meta?: { modelState?: { availableModels?: unknown } } } | null)?._meta?.modelState?.availableModels;
  if (!Array.isArray(available)) return null;
  const out: GrokCloudModel[] = [];
  for (const entry of available as Array<{ modelId?: unknown; name?: unknown; _meta?: { totalContextTokens?: unknown; reasoningEfforts?: unknown; reasoningEffort?: unknown; supportsReasoningEffort?: unknown } }>) {
    if (typeof entry?.modelId !== "string" || !SLUG.test(entry.modelId)) continue;
    const window = entry._meta?.totalContextTokens;
    out.push({
      id: entry.modelId,
      label: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : entry.modelId,
      ...(typeof window === "number" && window > 0 ? { contextWindow: window } : {}),
      ...grokEffortFacts(entry._meta?.reasoningEfforts, entry._meta?.reasoningEffort, entry._meta?.supportsReasoningEffort),
    });
  }
  return out.length ? settleGrokEfforts(out) : null;
}

const LIVE_MODELS_TTL_MS = 30_000;
const LIVE_MODELS_TIMEOUT_MS = 5_000;
const liveModels = new Map<string, { at: number; models: GrokCloudModel[] | null }>();

/** Test hook. */
export function resetGrokLiveModels(): void {
  liveModels.clear();
}

/** Ask the installed CLI which models it offers: spawn `grok agent stdio`,
 * read `initialize`, stop it. No session, no prompt. Cached briefly so a
 * picker opened twice in a row asks once. Null when the CLI cannot answer. */
export async function probeGrokModels(
  cli: string,
  env: Record<string, string | undefined>,
  now: () => number = Date.now,
): Promise<GrokCloudModel[] | null> {
  const key = `${cli}\0${grokHome(env)}`;
  const cached = liveModels.get(key);
  if (cached && now() - cached.at < LIVE_MODELS_TTL_MS) return cached.models;
  // A Grok agent process: one engine start slot during boot.
  const models = await engineStartGate.run("probe", `${cli} agent (models)`, () => new Promise<GrokCloudModel[] | null>((done) => {
    let settled = false;
    let child: ChildProcess;
    const finish = (value: GrokCloudModel[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill(); } catch { /* already gone */ }
      done(value);
    };
    const timer = setTimeout(() => finish(null), LIVE_MODELS_TIMEOUT_MS);
    try {
      // SAGAX_GROK_MODEL_PROBE marks this child for the test fake; Grok ignores it.
      // resolved as the driver does: on Windows a .cmd shim or a node script cannot be spawned bare
      const resolved = resolveCli(cli, ["agent", "--no-leader", "stdio"], env as NodeJS.ProcessEnv);
      child = spawnChild(resolved.command, resolved.args, {
        env: { ...env, SAGAX_GROK_MODEL_PROBE: "1" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message?.id === 1) finish(message.error ? null : grokModelsFromInitialize(message.result));
        } catch { /* not a protocol line */ }
      }
    });
    child.stdin?.on("error", () => finish(null));
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } })}\n`);
  }));
  // A failed probe is not cached: the next picker open asks again.
  if (models) liveModels.set(key, { at: now(), models });
  return models;
}

/** How long a reach probe waits for Grok's managed gateway to settle. */
const REACH_PROBE_TIMEOUT_MS = 45_000;

/** What a Grok sign-in brings through grok.com, read without a turn
 * (2026-10-29): a standalone `grok agent stdio` on that sign-in's home with
 * the managed gateway on (grokCloudConnectorEnv's own-account setting),
 * initialize, authenticate on the cached token, session/new with no MCP
 * server of Sagax's, then `_x.ai/mcp/list` until it settles
 * (grokMcpSettled). Resolves to the list's result (noteGrokAccountReach
 * reads it), or null. No prompt is sent; the process is killed after.
 * Measured on grok 1.0.70: about one second for 488 gateway tools. */
export async function probeGrokReach(cli: string, env: Record<string, string | undefined>): Promise<unknown> {
  // both variables, as an own-account turn sets them (grokCloudConnectorEnv):
  // the gateway one alone brings no managed server since 2026-10-30
  const probeEnv: Record<string, string | undefined> = { ...env, GROK_AGENT: "grok-build", ...grokCloudConnectorEnv(undefined, true), SAGAX_GROK_REACH_PROBE: "1" };
  delete probeEnv.XAI_API_KEY;
  const home = grokHome(probeEnv);
  if (!existsSync(join(home, "auth.json"))) return null;
  return engineStartGate.run("probe", `${cli} agent (reach)`, () => new Promise<unknown>((done) => {
    let settled = false;
    let child: ChildProcess;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill(); } catch { /* already gone */ }
      done(value);
    };
    const timer = setTimeout(() => finish(null), REACH_PROBE_TIMEOUT_MS);
    try {
      const resolved = resolveCli(cli, ["agent", "--no-leader", "stdio"], probeEnv as NodeJS.ProcessEnv);
      child = spawnChild(resolved.command, resolved.args, { env: probeEnv as NodeJS.ProcessEnv, cwd: dirname(home), stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    } catch {
      finish(null);
      return;
    }
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));
    let nextId = 0;
    const pending = new Map<number, (message: { result?: unknown; error?: unknown }) => void>();
    const send = (method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }> => new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: { id?: unknown; method?: unknown; result?: unknown; error?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (typeof message.id === "number" && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        } else if (typeof message.method === "string" && message.id !== undefined) {
          // a request from the agent (a permission, a file): nothing is granted
          child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
        }
      }
    });
    child.stdin?.on("error", () => finish(null));
    void (async () => {
      const init = await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const methods = (init.result as { authMethods?: Array<{ id?: string }> } | undefined)?.authMethods ?? [];
      const methodId = ["cached_token", "grok.com"].find((id) => methods.some((method) => method.id === id));
      if (init.error || !methodId) return finish(null);
      const auth = await send("authenticate", { methodId });
      if (auth.error) return finish(null);
      const created = await send("session/new", { cwd: dirname(home), mcpServers: [] });
      const sessionId = (created.result as { sessionId?: unknown } | undefined)?.sessionId;
      if (created.error || typeof sessionId !== "string") return finish(null);
      let last: unknown = null;
      for (;;) {
        if (settled) return;
        const reply = await send("_x.ai/mcp/list", { sessionId, cache: true });
        if (reply.error) return finish(last);
        last = (reply.result as { result?: unknown } | undefined)?.result ?? null;
        if (grokMcpSettled(last)) return finish(last);
        await delay(150);
      }
    })().catch(() => finish(null));
  }));
}


function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

/** The models Grok offers, then local slugs from ~/.grok/config.toml.
 *  `engine` is the CLI's own answer (initialize); without it, the account
 *  catalog Grok cached; without that, the static list. Config blocks are
 *  marked custom whichever source listed them. */
export function readGrokModelCatalog(
  env: Record<string, string | undefined> = process.env,
  engine?: GrokCloudModel[] | null,
): ModelCatalog {
  const path = join(grokHome(env), "config.toml");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  const declared = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped.startsWith("[model.") || !stripped.endsWith("]")) continue;
    let inner = stripped.slice("[model.".length, -1);
    if (inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1);
    declared.add(inner);
  }
  const cloud = engine?.filter((model) => !declared.has(model.id)) ?? [];
  const offered = cloud.length ? cloud : readGrokModelsCache(env) ?? STATIC_GROK_MODELS.options;
  if (!text && offered === STATIC_GROK_MODELS.options) return STATIC_GROK_MODELS;

  const options: ModelCatalog["options"] = offered.map((o) => ({ ...o }));
  const seen = new Set(options.map((o) => o.id));
  let configuredDefault: string | null = null;
  let current: { slug: string; name?: string } | null = null;
  let inModels = false;

  const flush = () => {
    if (!current || !SLUG.test(current.slug) || seen.has(current.slug)) {
      current = null;
      return;
    }
    seen.add(current.slug);
    options.push({ id: current.slug, label: current.name || current.slug, custom: true });
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped === "[models]") {
      flush();
      inModels = true;
      continue;
    }
    if (stripped.startsWith("[model.") && stripped.endsWith("]")) {
      flush();
      inModels = false;
      let inner = stripped.slice("[model.".length, -1);
      if (inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1);
      current = { slug: inner };
      continue;
    }
    if (stripped.startsWith("[")) {
      flush();
      inModels = false;
      continue;
    }
    if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) continue;
    const eq = stripped.indexOf("=");
    const key = stripped.slice(0, eq).trim();
    const value = unquote(stripped.slice(eq + 1));
    if (current && key === "name" && value) current.name = value;
    if (!current && inModels && key === "default") configuredDefault = value;
  }
  flush();

  const fallbackDefault = seen.has(STATIC_GROK_MODELS.default) ? STATIC_GROK_MODELS.default : options[0]?.id ?? STATIC_GROK_MODELS.default;
  return {
    default: configuredDefault && seen.has(configuredDefault) ? configuredDefault : fallbackDefault,
    options,
  };
}

/** Grok's remote settings can run a "launch campaign" that makes every new
 * session start on the launched model (settings.campaigns:
 * [{id:"grok-4.7-launch", models:{default:"grok-4.7"}}]) until the TUI user
 * dismisses it. It outranks `-m` and the ACP profile's model: verified with
 * grok 1.0.46 and 1.0.50 signed in to grok.com, in a fresh GROK_HOME,
 * session/new asked for grok-4.5 (or a local slug) and ran grok-4.7. A fresh
 * home is exactly what an organization person gets, so every pick ran
 * grok-4.7 there. Grok reads the dismissed ids on each session/new, so
 * writing them before the session opens is enough. Returns the ids added. */
export function dismissGrokModelCampaigns(env: Record<string, string | undefined>): string[] {
  const home = grokHome(env);
  let campaigns: unknown;
  try {
    const cache = JSON.parse(readFileSync(join(home, "settings_cache.json"), "utf8")) as { payload?: unknown };
    const payload = typeof cache.payload === "string" ? JSON.parse(cache.payload) : cache.payload;
    campaigns = (payload as { settings?: { campaigns?: unknown } } | null)?.settings?.campaigns;
  } catch {
    return [];
  }
  if (!Array.isArray(campaigns)) return [];
  const ids = campaigns
    .filter((entry) => typeof entry?.id === "string" && entry.id.length <= 200 && entry.models && typeof entry.models === "object")
    .map((entry) => entry.id as string);
  if (!ids.length) return [];
  const statePath = join(home, "campaigns_state.json");
  let state: { dismissed_ids?: unknown; [key: string]: unknown } = {};
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) state = parsed;
  } catch {
    state = {};
  }
  const dismissed = Array.isArray(state.dismissed_ids) ? state.dismissed_ids.filter((id): id is string => typeof id === "string") : [];
  const added = ids.filter((id) => !dismissed.includes(id));
  if (!added.length) return [];
  try {
    writeFileSync(statePath, JSON.stringify({ ...state, dismissed_ids: [...dismissed, ...added] }));
  } catch {
    return [];
  }
  return added;
}

function suggestGrokSlug(host: string, model: string, taken: Set<string>): string {
  let base = `${host}-${model}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!base || !/^[a-z]/.test(base)) base = `m-${base || "model"}`;
  let slug = base;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function quoteToml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Write a [model.slug] block so `grok -m` can reach the injected host. */
export function ensureGrokInjectSlug(
  modelId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const inject = decodeInjectId(modelId);
  if (!inject) return modelId;
  const host = localHost(inject.host);
  if (!host) return modelId;

  const path = join(grokHome(env), "config.toml");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }

  const taken = new Set<string>(STATIC_GROK_MODELS.options.map((option) => option.id));
  let current: { slug: string; model?: string; baseUrl?: string } | null = null;
  const flush = () => {
    if (!current) return;
    taken.add(current.slug);
    if (current.model === inject.model && current.baseUrl === host.baseUrl) {
      found = current.slug;
    }
    current = null;
  };
  let found: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped.startsWith("[model.") && stripped.endsWith("]")) {
      flush();
      let inner = stripped.slice("[model.".length, -1);
      if (inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1);
      current = { slug: inner };
      continue;
    }
    if (stripped.startsWith("[")) {
      flush();
      continue;
    }
    if (!current || !stripped.includes("=")) continue;
    const eq = stripped.indexOf("=");
    const key = stripped.slice(0, eq).trim();
    const value = unquote(stripped.slice(eq + 1));
    if (key === "model") current.model = value;
    if (key === "base_url") current.baseUrl = value;
  }
  flush();
  if (found) return found;

  const slug = suggestGrokSlug(inject.host, inject.model, taken);
  const heading = /[^a-z0-9_-]/i.test(slug) ? `[model."${slug}"]` : `[model.${slug}]`;
  const block = [
    heading,
    `model = ${quoteToml(inject.model)}`,
    `base_url = ${quoteToml(host.baseUrl)}`,
    `name = ${quoteToml(`${inject.model} (${host.label})`)}`,
    `api_backend = "chat_completions"`,
    `api_key = ${quoteToml(hostApiKey(host, env))}`,
    "",
  ].join("\n");
  const next = text && !text.endsWith("\n") ? `${text}\n\n${block}` : `${text}${text ? "\n" : ""}${block}`;
  writeFileSync(path, next);
  return slug;
}

/** Grok 1.0.25 and later 1.x consume native image blocks but advertise image:false.
 * Verified with the real CLI and a loopback model: scripts/verify/dev/verify-grok-images.ts.
 * Keep unknown/older runtimes on the normal capability negotiation path. */
export function grokAcceptsUnadvertisedImages(init: unknown): boolean {
  const meta = (init as { _meta?: { grokShell?: unknown; agentVersion?: unknown } } | null)?._meta;
  if (meta?.grokShell !== true || typeof meta.agentVersion !== "string") return false;
  // Any 1.x release from 1.0.25 on (grok 1.0.62 on 2026-10-19). A 2.x stays
  // unknown until scripts/verify/dev/verify-grok-images.ts checks it; so does a
  // pre-release suffix.
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(meta.agentVersion);
  if (!version) return false;
  const [major, minor, patch] = version.slice(1).map(Number) as [number, number, number];
  return major === 1 && (minor > 0 || patch >= 25);
}

/** Organization server: one turn's credentials (SendTurnInput.access). */
export function grokApplyAccess(
  env: Record<string, string | undefined>,
  access: TurnAccessInput,
  instanceEnvironment: Record<string, string> | undefined,
): void {
  if (access.engineHome) {
    // GROK_HOME wins over $HOME/.grok. Set it inside the person's directory
    // so a server-level GROK_HOME cannot serve this turn. The login file
    // stays at <home>/.grok/auth.json (device-login credentialFile).
    const grokHome = join(access.engineHome, ".grok");
    mkdirSync(grokHome, { recursive: true, mode: 0o700 });
    try {
      chmodSync(access.engineHome, 0o700);
      chmodSync(grokHome, 0o700);
    } catch {
      /* filesystems without modes */
    }
    env.HOME = access.engineHome;
    env.GROK_HOME = grokHome;
  }
  delete env.XAI_API_KEY;
  if (access.via === "subscription") return;
  const key = access.via === "org-key" ? instanceEnvironment?.XAI_API_KEY : access.environment?.XAI_API_KEY;
  if (key) env.XAI_API_KEY = key;
}

/** The subscription's cached token when the CLI has one; else current CLI's
 * `grok.com` method for an already-signed-in session; else the key the turn
 * was given (organization server only). */
export function grokPickAuthMethod(methods: Array<{ id?: string }>, env?: Record<string, string | undefined>): string | null {
  const subscription = ["cached_token", "grok.com"].find((id) => methods.some((m) => m.id === id));
  if (subscription) return subscription;
  return env?.XAI_API_KEY?.trim() ? "xai.api_key" : null;
}

/** Turns whose session profile names the model, so set_model is never sent. */
function grokPinsModelInProfile(turn: { withholdHostTools?: boolean; toolScope?: unknown }): boolean {
  return turn.withholdHostTools === true || narrowsNativeTools(turn.toolScope);
}

/** Grok Build reports an account refusal from xAI as a JSON-RPC internal
 * error whose data carries the HTTP status and xAI's words. Recorded on the
 * production organization server, grok 1.0.50, 2026-10-08:
 * `{code: -32603, message: "Internal error", data: {message: "API error
 * (status 402 Payment Required): Grok Build usage balance exhausted",
 * http_status: 402}}`. Without this the turn ended as a bare rpc_error. */
export function classifyGrokError(error: unknown): ProviderErrorCode | undefined {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const data = value.data && typeof value.data === "object" && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : {};
  const status = typeof data.http_status === "number" ? data.http_status : undefined;
  const text = [value.message, data.message, data.details].filter((part) => typeof part === "string").join(" ");
  if (status === 402 || /\b402\b|payment required|(?:usage |credit )?balance (?:is )?(?:exhausted|used up|depleted)|out of credits?|insufficient (?:funds|balance|credits?)/iu.test(text)) {
    return "insufficient_funds";
  }
  if (status === 401 || /\b401\b|unauthori[sz]ed|invalid api key|authentication (?:failed|required)/iu.test(text)) return "invalid_credentials";
  if (status === 403 && /\bsubscription\b/iu.test(text)) return "inactive_subscription";
  if (/\bquota\b|usage limit|(?:hourly|daily|weekly|monthly) limit/iu.test(text)) return "quota_or_region_restriction";
  return undefined;
}

/** Plain words for a Grok account failure: what refused, and what to do. */
export function describeGrokAccountError(code: AccountErrorCode, model?: string): string {
  const which = model ? ` (model ${model})` : "";
  switch (code) {
    case "insufficient_funds":
      return `Grok refused this turn${which}: the usage balance of the Grok account it runs on is used up (xAI answered 402 Payment Required). Add credit to that Grok account at grok.com, or choose another model for this bot.`;
    case "invalid_credentials":
      return `Grok refused this turn${which}: the Grok sign-in or xAI key it runs on was rejected. Reconnect Grok in Settings → Model providers and accounts, or replace the xAI key.`;
    case "inactive_subscription":
      return `Grok refused this turn${which}: the Grok account it runs on has no active subscription. Reconnect Grok in Settings → Model providers and accounts, renew it at grok.com, or choose another model for this bot.`;
    case "quota_or_region_restriction":
      return `Grok refused this turn${which}: the Grok account it runs on reached its usage limit. Wait for it to reset, or choose another model for this bot.`;
    case "model_access_disabled":
      return `Grok refused this turn${which}: the Grok account it runs on has this model turned off. Choose another model for this bot.`;
  }
}

/** Grok's `ask_user_question` tool blocks its turn on this extension request
 * (xai-org/grok-build: xai-grok-shell/src/session/acp_session_impl/spawn.rs,
 * xai-grok-tools/.../ask_user_question/types.rs). The tool is on by default
 * and needs no client capability. ACP's Rust SDK adds the extension prefix
 * `_` on the wire, as with `_x.ai/mcp/list`; the bare name is accepted too.
 * Answers are keyed by the question text Grok sent, one label per pick; the
 * person's own words ride as "Other" with the text in annotations[].notes. */
export const GROK_ASK_USER_QUESTION: AcpQuestionRequest = {
  cancelled: { outcome: "cancelled" },
  parse(params) {
    const raw = (params as { questions?: unknown } | null)?.questions;
    // Refused whole: answering only the first ones would read the rest as accepted.
    if (!Array.isArray(raw) || raw.length > MAX_QUESTIONS) return null;
    // The entry index is the protocol id, so each card question maps back
    // to the exact text Grok keys its answers by. Grok serializes the flag
    // as `multiSelect`; its model-facing name `multi_select` is read too.
    const parsed = parseProtocolAskQuestions(raw.map((entry, index) =>
      entry && typeof entry === "object"
        ? { ...entry, id: String(index), multiSelect: entry.multiSelect === true || entry.multi_select === true }
        : entry));
    if (!parsed || repeatsQuestionText(parsed)) return null;
    return {
      questions: parsed.map(({ question }) => question),
      answered(message) {
        const byId = questionAnswersById(message, parsed);
        // Null prototype: a question text such as __proto__ is a real key.
        const answers: Record<string, string[]> = Object.create(null);
        const annotations: Record<string, { notes: string }> = Object.create(null);
        for (const { id, question } of parsed) {
          const reply = byId[id];
          if (reply === undefined) continue;
          const text = (raw[Number(id)] as { question: string }).question;
          const { labels, other } = pickedOptionLabels(reply, question);
          answers[text] = other === undefined ? labels : [...labels, "Other"];
          if (other !== undefined) annotations[text] = { notes: other };
        }
        if (!Object.keys(answers).length) return null;
        return { outcome: "accepted", answers, ...(Object.keys(annotations).length ? { annotations } : {}) };
      },
    };
  },
};

const support: AcpSupport = {
  driverKind: "grokAgent",
  questionRequests: {
    "_x.ai/ask_user_question": GROK_ASK_USER_QUESTION,
    "x.ai/ask_user_question": GROK_ASK_USER_QUESTION,
  },
  displayName: "Grok",
  images: true,
  acceptsUnadvertisedImages: grokAcceptsUnadvertisedImages,
  models: STATIC_GROK_MODELS,
  // The engine's own answer (initialize), refreshed when the picker opens
  // and cached briefly; Grok's cached account catalog, then the static list,
  // only when the CLI cannot answer. A CLI that is not signed in lists only
  // its bundled fallback (grok 1.0.50: grok-4.6 and grok-4.5), not what the
  // account offers, so it is not asked.
  resolveModels: async (env, config) => mergeLocalInject(readGrokModelCatalog(
    env,
    existsSync(join(grokHome(env), "auth.json")) ? await probeGrokModels(config.cli, env) : null,
  ), env),
  // Grok's accepted levels vary by model and the CLI validates lazily: a
  // rejected level only logs and falls back. The union is offered here and
  // each model's own list (its catalog row) holds a pick and a turn to it.
  effortLevels: GROK_EFFORT_LEVELS,
  // A voice call warms the process when it is accepted (initialize,
  // authenticate, session/load with no prompt): the first spoken turn is a
  // bare session/prompt (docs/voice-mode-xai.md, "Latency").
  warmSession: true,
  // Organization servers only spawn this driver when a turn sets
  // withholdHostTools. spawnArgs and the ACP profile below do the withholding.
  withholdsHostTools: true,
  defaultCli: "grok",
  nativeSource: "grok.acp",
  classifyError: classifyGrokError,
  describeAccountError: describeGrokAccountError,
  loginNote: "Grok is not signed in to your grok.com account. Sign in to Grok in Settings → Model providers and accounts",

  // No Windows one-liner: the installer is a POSIX shell script, and offering
  // `curl … | bash` there would be advice that cannot run. Windows falls back
  // to docsUrl, which is honest rather than broken.
  install: {
    command: {
      darwin: "curl -fsSL https://x.ai/cli/install.sh | bash",
      linux: "curl -fsSL https://x.ai/cli/install.sh | bash",
    },
    docsUrl: "https://x.ai/cli",
    // The terminal route, for people who prefer it; the app's own sign-in
    // is the device code below, which needs no terminal.
    signInCommand: "grok login",
  },
  deviceSignIn: GROK_DEVICE_SIGN_IN,

  // Write the [model.slug] block with the instance HOME/GROK_HOME, then pass
  // the slug on argv. spawnArgs must not call ensureGrokInjectSlug itself —
  // that helper defaults to process.env and would miss the instance override.
  resolveTurnModel: (model, env) => (model ? ensureGrokInjectSlug(model, env) : model),

  // --permission-mode is a global grok flag. -m and --reasoning-effort are
  // agent flags: Grok 1.0.6 only applies them when they sit AFTER `agent`
  // and BEFORE `stdio` (`grok agent -m slug stdio`). Putting -m first is
  // accepted as a TUI option and then ignored, so ACP session/new keeps
  // [models].default (currently grok-4.7) and oMLX never sees a request.
  // Auto selects Grok's native classifier; if its feature gate is disabled,
  // residual requests still ask. Never replace it with bypassPermissions.
  // Verified: grok 1.0.3 --help and xai-org/grok-build@37949780,
  // crates/codegen/xai-grok-pager-bin/src/main.rs:1259-1273.
  // Approval gate (grok-approval-gate.ts), on unless the bot opts out: an
  // Auto or Full turn (#1982) runs Grok in `default` mode, with no per-call
  // classifier wait, and Sagax holds every MCP call that is not reviewed
  // read-only for a card (Full-approves unless a rule holds).
  // #2747: the MCP servers of the person's own Grok, Claude, Cursor or
  // project config never reach a bot (grok-mcp-isolation.ts, applyTurnEnv),
  // so every MCP server of the turn is one Sagax mounts and the gate holds.
  approvalGate: (_config, turn) => (turn.approvalMode === "auto" || turn.approvalMode === "full") && grokApprovalGateEnabled(turn.botId),
  approvalReadOnly: (server, botId) => gateReadOnlyTools(server, botId),
  // a use_tool target the session's own catalog lists on a managed gateway
  // server: the person's own grok.com connector (grok-tool-catalog.ts)
  accountConnectorTool: (sessionId, tool) => (grokCatalogFor(sessionId) ?? []).some((server) => server.gateway === true && server.tools.includes(tool)),

  spawnArgs: (config, turn, launch) => {
    const withhold = turn.withholdHostTools === true;
    // #1982: Full under the gate stays gated (do not drop it for fullAuto).
    const gated = launch?.approvalGate === true;
    const accountConnectors = grokLoadsAccountConnectors(turn);
    const mode = grokPermissionMode({ fullAuto: config.fullAuto, gated, approvalMode: turn.approvalMode, accountConnectors });
    return [
      // Global flags. `--deny` does not strip the agent-stdio tool list;
      // the session profile does. `--no-leader` is after `agent`: a shared
      // leader ignores the profile, the host tools and the isolated env.
      ...grokHostToolArgs(withhold),
      "--permission-mode",
      mode,
      // An Auto turn Grok does not gate: reviewed read-only Sagax tools skip
      // Grok's classifier, or its ask when the account's connectors keep the
      // turn in `default` (grok-read-only-tools.ts). Ask and Edits keep every
      // card as before.
      ...(!config.fullAuto && !gated && turn.approvalMode === "auto"
        ? grokReadOnlyAllowRules(turn.integrations).flatMap((rule) => ["--allow", rule])
        : []),
      "agent",
      // Always: a shared leader keeps the env of the process that spawned it,
      // so a bot turn attached to the person's leader would see the
      // account's MCP servers and skip this turn's isolated GROK_HOME and
      // connector switches (#2747). Sagax keeps its own warm stdio process
      // per session, so no speed is lost.
      "--no-leader",
      ...(turn.model ? ["-m", turn.model] : []),
      // long form on purpose: `--effort` is documented as an alias, and an
      // alias is the part a CLI is free to rename
      ...(turn.effort ? ["--reasoning-effort", turn.effort] : []),
      "stdio",
    ];
  },

  toolScopeSessionParams: (turn, init, hasMcp, { config, env, cwd }) => {
    // These turns pin the model in the profile and never send set_model, so
    // a launch campaign would silently replace every pick (see
    // dismissGrokModelCampaigns). Runs right before session/new and load.
    if (turn.model) dismissGrokModelCampaigns(env);
    if (turn.withholdHostTools === true) {
      // Name-only profile, not the 1.0.41 toolConfig registry. A selected
      // model is pinned here so configureSession does not call set_model,
      // which can rebuild the harness and restore the default tools.
      const profile = grokOrgAgentProfile(turn.toolScope, hasMcp);
      return { _meta: { agentProfile: turn.model ? { ...profile, model: ensureGrokInjectSlug(turn.model, env) } : profile } };
    }
    if (!narrowsNativeTools(turn.toolScope)) return {};
    const profile = grokToolScopeProfile(turn.toolScope, init, grokInheritedProfile(config.cli, env, cwd), hasMcp);
    // Establish on the selected model. Changing harnesses after session/new
    // can discard an ACP profile and restore the model's default tools.
    if (turn.model) profile.model = ensureGrokInjectSlug(turn.model, env);
    return { _meta: { agentProfile: profile } };
  },
  toolScopeCacheKey: ({ config, env, cwd }) => JSON.stringify(grokInheritedProfile(config.cli, env, cwd) ?? null),

  // Grok 1.0.46 session/load restores the stored session's model, whatever
  // -m and the profile's model say (verified: a session made on grok-4.7,
  // loaded by `agent -m grok-4.6` with a grok-4.6 profile, reports grok-4.7;
  // session/new on that process reports grok-4.6). Where the profile pins
  // the model, switching in place is not safe (see configureSession), so a
  // model change opens a fresh session that carries the thread's history.
  acceptsLoadedSession: ({ turn, currentModelId }) =>
    !(turn.model && currentModelId && currentModelId !== turn.model && grokPinsModelInProfile(turn)),

  // -m on argv is necessary but not sufficient: session/new still starts on
  // [models].default. Pin the slug over the wire, same as Hermes/Droid.
  async configureSession({ request, sessionId, turn, currentModelId, sessionModels, notice, reused, mcpServerNames, noteToolWait }) {
    if (turn.toolScope !== undefined) {
      // #3623: each poll also times the servers for the latency line (toolsBy)
      const clock = grokMcpWaitClock(mcpServerNames ?? [], Date.now(), turn.threadId);
      const deadline = Date.now() + 10_000;
      let limitHit = false;
      for (;;) {
        const reply = await request("_x.ai/mcp/list", { sessionId, cache: true }, 10_000);
        const catalog = reply?.result;
        if (!Array.isArray(catalog?.servers)) break;
        clock.note(catalog);
        // The person's own native Grok MCP connections outside the bot's
        // selection never block a turn (2026-11-06: a dispatch run was
        // refused on this). Wait for the catalog, bounded, then send.
        if (catalog.sessionMcpResolved === true) {
          rememberGrokCatalog(sessionId, catalog);
          break;
        }
        if (Date.now() >= deadline) { limitHit = true; break; }
        await delay(50);
      }
      noteToolWait?.(clock.result(Date.now(), limitHit));
    } else {
      // 2026-10-16 (hotfix 0.5.10): without a tool selection the prompt
      // left while Grok still handshook its MCP servers; Grok then told the
      // model "MCP servers currently connecting, do not use them yet" and
      // the bot answered that ConnectWise was not reachable. Wait, bounded
      // and best effort, until Grok resolved its servers and none is still
      // pending; on a timeout or an unreadable list the prompt goes anyway.
      // What the person's own xAI account brought (its grok.com connectors),
      // kept by their sign-in folder: only on a turn that loads the gateway
      // (grokCloudConnectorEnv), where an empty gateway means none.
      // A later turn on the same live session that already settled skips the
      // poll. A session/new or session/load (reused false) forgets the flag
      // so a reconnect still waits once.
      const reachHome = turn.grokCloudConnectors === true && turn.withholdHostTools === true ? turn.access?.engineHome : undefined;
      if (reused !== true) forgetGrokMcpSettled(sessionId);
      if (reused === true && grokMcpAlreadySettled(sessionId)) {
        /* MCP mounts of this live session already settled on an earlier turn */
      } else {
        const clock = grokMcpWaitClock(mcpServerNames ?? [], Date.now(), turn.threadId);
        const settled = await waitForGrokMcpSettled(request, sessionId, GROK_MCP_SETTLE_MS, (catalog) => {
          clock.note(catalog);
          rememberGrokCatalog(sessionId, catalog);
          noteGrokAccountReach(reachHome, catalog);
        }, () => clock.stalled());
        if (settled) rememberGrokMcpSettled(sessionId);
        noteToolWait?.(clock.result(Date.now(), !settled));
      }
    }
    // the latency line's setupBy tools part ends here (turn-latency.ts)
    turnTrace(turn.threadId, "acp-mcp-settled");
    if (!turn.model) return;
    if (grokPinsModelInProfile(turn)) {
      // The session profile already names the model (toolScopeSessionParams).
      // set_model can rebuild the harness and drop that profile, restoring
      // Grok's default tools (the host shell on an organization server), so
      // it is never sent here. A resumed session on another model was not
      // adopted (acceptsLoadedSession): this one was just opened on the pick.
      if (!currentModelId) {
        // An organization turn keeps the profile rather than rebuilding host
        // tools; a narrowed native selection needs the runtime's word.
        if (narrowsNativeTools(turn.toolScope)) {
          throw new Error("Grok did not report its model, so it could not confirm the selected model. No prompt was sent.");
        }
        return;
      }
      if (currentModelId !== turn.model) {
        // A fresh session that still runs another model. Say so once per
        // conversation and send the prompt on the model Grok runs. Only an
        // id missing from the session's own list is one Grok does not
        // offer; a local slug Sagax declared (ensureGrokInjectSlug) is in
        // that list. An offered id replaced anyway is Grok overriding the
        // pick (a launch campaign that could not be dismissed).
        const offered = sessionModels.some((model) => model.modelId === turn.model);
        notice?.(offered
          ? `Grok ran this conversation on ${currentModelId} instead of ${turn.model}.`
          : `Grok does not offer ${turn.model}, so this conversation uses ${currentModelId}. Choose another model for this bot to stop seeing this.`);
        return { model: currentModelId };
      }
      return;
    }
    // Already on the pick (warmOnly configured it, or session/new started on
    // it): skip the round trip so a reused first turn stays a bare prompt
    // (#2055).
    if (currentModelId === turn.model) return;
    try {
      await request("session/set_model", { sessionId, modelId: turn.model });
    } catch (e) {
      throw new Error(
        `Grok rejected model "${turn.model}" via session/set_model: ${(e as Error).message}. ` +
          `Check that grok is current (1.0.6+ supports it) and that this slug exists in ~/.grok/config.toml.`,
      );
    }
  },

  // The CLI owns its own grok.com login; a leaked API key silently flips
  // billing from the subscription to pay-as-you-go.
  transformEnv: (env) => {
    delete env.XAI_API_KEY;
  },
  applyTurnEnv: (env, { toolScope, withholdHostTools, accountConnectors }) => {
    // #2747: the bot's CLI gets only the MCP servers Sagax mounts on
    // session/new, never the person's own connectors (config.toml, project
    // .grok and .mcp.json, ~/.claude.json, ~/.cursor/mcp.json, plugins).
    // Runs after resolveTurnModel wrote the model slug into the real home.
    isolateGrokMcp(env, grokHome(env), join(DATA_DIR, "engines", "grok-isolated"));
    // Cloud connectors of the signed-in xAI account reach this bot, the
    // managed configs and the gateway connectors (Outlook, Teams, Gmail...)
    // alike. A tool selection or someone else's account still turns them off
    // (grokCloudConnectorEnv).
    const cloud = grokCloudConnectorEnv(toolScope, accountConnectors === true);
    env.GROK_MANAGED_MCPS_ENABLED = cloud.GROK_MANAGED_MCPS_ENABLED;
    env.GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED = cloud.GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED;
    if (withholdHostTools === true || (toolScope !== undefined && narrowsNativeTools(toolScope))) {
      if (env.GROK_AGENT && env.GROK_AGENT !== "grok-build") {
        throw new Error(withholdHostTools === true
          ? "Grok's existing agent profile cannot be used on an organization server. Use the default Grok account."
          : "Grok's existing agent profile cannot be safely intersected with tool selection. Use a separate default Grok account.");
      }
      // A model's agent_type otherwise takes priority over ACP profiles.
      env.GROK_AGENT = "grok-build";
    }
  },

  // Organization server: the payer's own HOME (their `grok login
  // --device-auth`, or an empty one for a key, so the server's cached token,
  // which outranks a key, never serves them) and, for a key, that key.
  applyAccess: grokApplyAccess,

  // Bind the grok.com subscription login. The only key path is the payer's
  // own xAI key on an organization server (applyAccess): grok accepts it
  // through the unadvertised `xai.api_key` method (verified against grok
  // 1.0.46). In solo mode transformEnv removed every key, so an
  // unauthenticated CLI stays a user action, not something to paper over.
  pickAuthMethod: grokPickAuthMethod,
  authFailure: "fail",
  isAuthenticated: (env) => grokSignedIn(env) || Boolean(env.XAI_API_KEY?.trim()),

  // `--append-system-prompt`/`--rules` are accepted by the CLI but do NOT
  // reach the agent-stdio system prompt (verified against 1.0.0), so the
  // persona is prepended codex-style.
  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
  // Grok moves a prompt of about 100 KB to a file on the server (prompt-fit.ts)
  promptByteLimit: GROK_PROMPT_BYTE_LIMIT,

  // Grok reaches every Sagax MCP tool through search_tool then use_tool, and
  // each of those is a full model round trip carrying the whole context.
  // Measured on the production server (2026-10-11): a one-tool turn took three
  // rounds (search_tool, use_tool, answer), ~3.5 s each. A tool already found
  // in this conversation needs no second search.
  stableSystemHint: GROK_TOOL_REUSE_HINT,
  // Grok skips `cw_psa_query` (second `__`) and other names it cannot
  // qualify; the gate registers them under aliases (mcp-tool-names.ts).
  mcpToolNames: "grok",

  // The tools this bot already used successfully, named once per
  // conversation (and again only when the set changes), so a first use in a
  // new conversation skips the search_tool round too.
  // With Grok's own catalog of this session (read in configureSession,
  // grok-tool-catalog.ts), the section names every ready tool instead, plus
  // what a feature opened for this conversation (turn-reach.ts): a question
  // about connectors needs no call, and a listed tool no search.
  volatileSection: ({ botId, serverNames, sessionId, threadId, accountConnectors }) =>
    grokTurnCatalogSection({ botId, serverNames, sessionId, threadId, accountConnectors }),
  onToolCompleted: ({ botId, rawInput }) => recordGrokToolUse(botId, useToolName(rawInput)),

  // grok.com sometimes takes 30-90 s to its first token. Normal silent
  // stretches before the first streamed byte stayed under 9 s (a reasoning
  // round, production server 2026-10-11), so 20 s of nothing at all is a stall.
  stallRetryMs: grokStallRetryMs,
  roundContextUsage: grokRoundContextUsage,
};


/** How long a turn without a tool selection waits for Grok's MCP servers. */
export const GROK_MCP_SETTLE_MS = 20_000;

/** Whether Grok's `_x.ai/mcp/list` answer says every MCP server finished
 * connecting: the session resolved its servers and none is still pending. */
export function grokMcpSettled(catalog: unknown): boolean {
  const value = catalog as { sessionMcpResolved?: unknown; servers?: unknown } | null | undefined;
  if (!value || value.sessionMcpResolved !== true || !Array.isArray(value.servers)) return false;
  return !value.servers.some(grokMcpServerWaiting);
}

/** Best effort: polls `_x.ai/mcp/list` until grokMcpSettled or `budgetMs`
 * runs out. Never throws: a Grok that cannot answer still gets its prompt. */
export async function waitForGrokMcpSettled(
  request: (method: string, params: unknown, timeoutMs: number) => Promise<{ result?: unknown } | undefined>,
  sessionId: string,
  budgetMs: number,
  /** the last catalog read, settled or not (grok-tool-catalog.ts) */
  onCatalog?: (catalog: unknown) => void,
  /** true when waiting longer cannot help (grokMcpWaitClock's stalled) */
  stalled?: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    try {
      const reply = await request("_x.ai/mcp/list", { sessionId, cache: true }, Math.min(10_000, left));
      if (onCatalog && reply?.result) {
        try { onCatalog(reply.result); } catch { /* bookkeeping only */ }
      }
      if (grokMcpSettled(reply?.result)) return true;
    } catch {
      return false;
    }
    if (stalled?.()) return false;
    await delay(100);
  }
}

export const GrokAgentDriver = createAcpDriver(support);
/** The size Grok's requests are kept under (prompt-fit.ts). */
export const grokPromptByteLimit = (): number | undefined => support.promptByteLimit;
/** Tests only: the driver's configureSession. */
export const grokConfigureSessionForTest = (...args: Parameters<NonNullable<AcpSupport["configureSession"]>>) => support.configureSession!(...args);
