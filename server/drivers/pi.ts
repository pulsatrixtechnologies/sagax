// pi — the pi coding agent (@earendil-works/pi-coding-agent) as a native engine.
//
// pi exposes a JSON-RPC mode over stdio (`pi --mode rpc --no-session`) rather
// than ACP, so — like the Claude Code and Codex CLIs — it gets a native driver
// that speaks its own protocol and emits canonical RuntimeEvents. pi is a
// BYOK agent: credentials live in ~/.pi/agent/auth.json and are injected by
// the pi binary itself, so this driver holds no API key and needs no sign-in.
//
// Conversation continuity: the first turn sends `new_session` and remembers
// the returned `sessionFile`; later turns send `switch_session` with that
// path (the way Claude Code resumes by session id). `sessionFile` is the
// resumeCursor the harness persists per thread.
//
// Model ids in the picker are `provider/modelId` composites (e.g.
// `ollama-cloud/glm-5.2`); `set_model` splits that into pi's separate
// `{provider, modelId}` fields. Live local hosts (oMLX / Ollama / EXO /
// LM Studio / Unsloth) land as `host::model` inject ids the same way the
// other engines do: mergeLocalInject lists them in Custom, and a pick
// upserts ~/.pi/agent/models.json so pi can reach the host. The live
// catalog is probed from `get_available_models` and every entry is flagged
// `custom` because pi is a custom-only (BYOK) engine — the model picker's
// Local pane only lists `custom` options for custom-only engines.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { readAtRestSync } from "../content-at-rest.ts";
import { PROVIDER_CREDENTIAL_ENV, stripWorkspaceCredentialEnv } from "../config.ts";
import { applyEngineCommandVariables } from "../credential-command-env.ts";
import { openStartupModelCatalog, writeStartupModelCache } from "../startup-model-catalog.ts";
import { augmentedPath } from "../env-path.ts";
import { describeSpawnFailure, execCli, killCliTree, spawnCli } from "../procs.ts";
import { SEARCH_CALL_TOOL, searchedToolCall } from "../../shared/searched-tool-call.ts";
import { PERSPICAX_TOKEN_ENV, warmCommsEnv, warmPerspicaxEnv, withoutTurnTokens } from "./spawn-contract.ts";
import { engineStartGate } from "../engine-start-gate.ts";
import {
  deletePromptSplitReceipt,
  promptHalves,
  readPromptSplitReceipt,
  splitSessionPrompt,
  writePromptSplitReceipt,
} from "./prompt-split.ts";
import type { PromptSplitReceipt } from "./prompt-split.ts";
import { STABLE_END_MARKER } from "./pi-mcp-extension.ts";
import { COMPACT_VOLATILE_LAST } from "../compact-prompt.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { commandSummary, cwToolResult, toolDetailPreview } from "../tool-summary.ts";
import { filesField, writtenFilesFromToolInput } from "../thread-files.ts";

import type {
  DriverCreateInput,
  EffortLevel,
  ModelCatalog,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  SteerOutcome,
  TurnAccessInput,
  TurnImageInput,
} from "../contracts.ts";
import { NATIVE_EFFORT_LEVELS, ULTRACODE_EFFORT } from "../../shared/ultracode-effort.ts";
import { newEventId, newId } from "../contracts.ts";
import { parseAskQuestions, parseChoices, questionAnswersByQuestion } from "../../shared/ask-question.ts";
import {
  decodeInjectId,
  isLocalModelId,
  encodeInjectId,
  hostApiKey,
  localHost,
  mergeLocalInject,
} from "./local-inject.ts";
import { localModelFailureMessage, providerReason } from "./engine-errors.ts";
import { appendNative } from "./native.ts";
import { piHostToolArgs } from "./host-tools.ts";
import { canUseMcpServer, parseToolScope } from "../../shared/tool-scope.ts";
import { customServerGate, gateServer, mcpStdioServer } from "../mcp-gate-config.ts";
import { remoteMcpSpec } from "../mcp-http.ts";
import { readMcpGatewayCall } from "../../shared/mcp-gateway-call.ts";

const DRIVER_KIND = "piAgent";
const PI_ARGS = ["--mode", "rpc", "--no-session"];
const PI_MODEL_UPDATE_ARGS = ["update", "--models", "--no-approve"];
const NODE_ENV_FLAG = { ELECTRON_RUN_AS_NODE: "1" };
/** omp's RPC transport caps one frame at 1 MiB and only chunks oversized
 *  frames after the client negotiates protocol 2. Sent before the first
 *  command on every spawn: stdin order guarantees the declaration lands
 *  before the response to that command is encoded, and vanilla pi has no
 *  handshake frame to wait for, so nobody gates on a reply. */
const PI_NEGOTIATE_FRAME = { id: "negotiate", type: "negotiate_protocol", protocolVersion: 2 };

/** #1276: a pi process started after a compact turn (a local model), its
 * session already resumed, so the thread's next message skips pi's start,
 * the MCP mounts and the session load (about a second). Adopted only by a
 * turn with the same spawn contract (without the turn's tokens, which ride
 * files) on the same session; closed after PI_STANDBY_MS or when the server
 * exits. Anything else starts pi as before. */
interface PiStandby {
  child: ReturnType<typeof spawnCli>;
  key: string;
  sessionFile: string;
  dir: string;
  scopeReadyPath: string | undefined;
  onData: (chunk: string) => void;
  timer: NodeJS.Timeout;
}
const PI_STANDBY_MS = 10 * 60_000;
/** The tool lists a compact turn's pi mounted (pi-mcp-extension.ts toolCachePath). */
const PI_TOOL_CACHE = "tools.json";
/** The request that warms a local server for the bot's next conversation. */
const PI_WARM = "warm.json";
/** What the thread's last pi mounted, for the standby that follows it. */
function readPiToolCache(dir: string | null, file = PI_TOOL_CACHE): Record<string, unknown> | undefined {
  if (!dir) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
const piStandby = new Map<string, PiStandby>();
/** A standby still starting, per thread: the next turn waits for it rather
 * than start a second pi (it is further along than a fresh one). */
const piStandbyStarting = new Map<string, Promise<void>>();
/** How long a turn waits for a standby still starting. */
const PI_STANDBY_WAIT_MS = 3_000;

/** Wait (bounded) for this thread's standby still starting, if any. */
export async function settledPiStandby(threadId: string): Promise<void> {
  const starting = piStandbyStarting.get(threadId);
  if (!starting) return;
  await Promise.race([starting, new Promise<void>((resolve) => { const t = setTimeout(resolve, PI_STANDBY_WAIT_MS); t.unref?.(); })]);
}
/** Every standby pi, started or still starting: none outlives the server. */
const piStandbyChildren = new Set<ReturnType<typeof spawnCli>>();
let piStandbyExitHook = false;
function watchPiStandbyExit(): void {
  if (piStandbyExitHook) return;
  piStandbyExitHook = true;
  const closeAll = () => {
    for (const child of piStandbyChildren) { try { killCliTree(child); } catch { /* already gone */ } }
    piStandbyChildren.clear();
  };
  process.once("exit", closeAll);
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, closeAll);
}

function closePiStandby(entry: PiStandby): void {
  clearTimeout(entry.timer);
  try { entry.child.stdin.end(); } catch { /* already closed */ }
  try { killCliTree(entry.child); } catch { /* already gone */ }
  try { rmSync(entry.dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

export function dropPiStandby(threadId: string): void {
  const entry = piStandby.get(threadId);
  if (!entry) return;
  piStandby.delete(threadId);
  closePiStandby(entry);
}

/** The standby process for this turn, or undefined (then pi starts as before). */
export function takePiStandby(threadId: string, key: string, sessionFile: string): PiStandby | undefined {
  const entry = piStandby.get(threadId);
  if (!entry) return undefined;
  piStandby.delete(threadId);
  if (entry.key !== key || entry.sessionFile !== sessionFile || entry.child.exitCode !== null || entry.child.killed) {
    closePiStandby(entry);
    return undefined;
  }
  clearTimeout(entry.timer);
  piStandbyChildren.delete(entry.child);
  entry.child.stdout.off("data", entry.onData);
  entry.child.removeAllListeners("close");
  return entry;
}

function startPiStandby(input: Parameters<typeof runPiStandby>[0]): Promise<void> {
  const run = runPiStandby(input).finally(() => { if (piStandbyStarting.get(input.threadId) === run) piStandbyStarting.delete(input.threadId); });
  piStandbyStarting.set(input.threadId, run);
  return run;
}

async function runPiStandby(input: {
  threadId: string;
  key: string;
  sessionFile: string;
  cli: string;
  args: string[];
  cwd: string | undefined;
  env: Record<string, string | undefined>;
  config: Record<string, unknown>;
  toolCache: Record<string, unknown> | undefined;
  warm: Record<string, unknown> | undefined;
}): Promise<void> {
  dropPiStandby(input.threadId);
  let dir: string | null = null;
  let child: ReturnType<typeof spawnCli> | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "omb-pi-mcp-"));
    const scopeReadyPath = input.config.toolScope !== undefined ? join(dir, "scope-ready.json") : undefined;
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ ...input.config, scopeReadyPath, toolCachePath: join(dir, PI_TOOL_CACHE), toolCache: input.toolCache, warmPath: join(dir, PI_WARM), warm: input.warm }), { mode: 0o600 });
    child = spawnCli(input.cli, input.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: input.cwd,
      env: { ...input.env, SAGAX_MCP_CONFIG: join(dir, "mcp.json") },
    }, "bot");
    const started = child;
    watchPiStandbyExit();
    piStandbyChildren.add(started);
    started.once("close", () => piStandbyChildren.delete(started));
    started.stderr?.resume();
    started.stdin.on("error", () => { /* closed with the process */ });
    const chunks = new PiRpcChunks();
    let answer: (ok: boolean) => void = () => {};
    const resumed = new Promise<boolean>((resolve) => { answer = resolve; });
    const onData = piLineReader((line) => {
      const frame = decodePiFrame(line, chunks);
      if (frame?.type === "response" && frame.command === "switch_session") answer(frame.success !== false);
    });
    started.stdout.setEncoding("utf8");
    started.stdout.on("data", onData);
    started.on("close", () => answer(false));
    started.stdin.write(JSON.stringify(PI_NEGOTIATE_FRAME) + "\n");
    started.stdin.write(JSON.stringify({ type: "switch_session", sessionPath: input.sessionFile }) + "\n");
    const timeout = new Promise<boolean>((resolve) => { const t = setTimeout(() => resolve(false), 20_000); t.unref?.(); });
    if (!(await Promise.race([resumed, timeout]))) throw new Error("pi standby did not resume its session");
    const entry: PiStandby = {
      child: started, key: input.key, sessionFile: input.sessionFile, dir, scopeReadyPath, onData,
      timer: setTimeout(() => dropPiStandby(input.threadId), PI_STANDBY_MS),
    };
    entry.timer.unref?.();
    started.on("close", () => { if (piStandby.get(input.threadId) === entry) dropPiStandby(input.threadId); });
    // a turn may have taken the thread meanwhile: never keep two
    if (piStandby.has(input.threadId)) { closePiStandby(entry); return; }
    piStandby.set(input.threadId, entry);
  } catch {
    if (child) { try { killCliTree(child); } catch { /* already gone */ } }
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
}
/** #1276: a pi started ahead for the bot's next new conversation. It boots
 * with no MCP server (its config comes with that conversation), so the
 * conversation pays a session switch instead of a whole pi start. */
interface PiFresh {
  child: ReturnType<typeof spawnCli>;
  dir: string;
  sessionsRoot: string;
  onData: (chunk: string) => void;
  timer: NodeJS.Timeout;
}
const piFresh = new Map<string, PiFresh>();
const piFreshStarting = new Set<string>();

function closePiFresh(entry: PiFresh): void {
  clearTimeout(entry.timer);
  try { entry.child.stdin.end(); } catch { /* already closed */ }
  try { killCliTree(entry.child); } catch { /* already gone */ }
  try { rmSync(entry.dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** The pi started ahead for this contract, or undefined (pi starts as before). */
export function takePiFresh(key: string): PiFresh | undefined {
  const entry = piFresh.get(key);
  if (!entry) return undefined;
  piFresh.delete(key);
  if (entry.child.exitCode !== null || entry.child.killed) {
    closePiFresh(entry);
    return undefined;
  }
  clearTimeout(entry.timer);
  piStandbyChildren.delete(entry.child);
  entry.child.stdout.off("data", entry.onData);
  entry.child.removeAllListeners("close");
  return entry;
}

/** pi's own folder name for a session's cwd (session-manager getDefaultSessionDirPath). */
export function piSessionDirName(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** A new, empty pi session for this cwd, as pi writes one (header only):
 * switch_session to it gives the pi started ahead this conversation's folder. */
export function writePiSession(sessionsRoot: string, cwd: string): string {
  const dir = join(sessionsRoot, piSessionDirName(cwd));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const file = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  writeFileSync(file, JSON.stringify({ type: "session", version: 3, id, timestamp, cwd }) + "\n", { flag: "wx", mode: 0o600 });
  return file;
}

async function startPiFresh(input: { key: string; cli: string; args: string[]; cwd: string | undefined; env: Record<string, string | undefined> }): Promise<void> {
  if (piFresh.has(input.key) || piFreshStarting.has(input.key)) return;
  piFreshStarting.add(input.key);
  let dir: string | null = null;
  let child: ReturnType<typeof spawnCli> | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "omb-pi-mcp-"));
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    child = spawnCli(input.cli, input.args, { stdio: ["pipe", "pipe", "pipe"], cwd: input.cwd, env: { ...input.env, SAGAX_MCP_CONFIG: join(dir, "mcp.json") } }, "bot");
    const started = child;
    watchPiStandbyExit();
    piStandbyChildren.add(started);
    started.once("close", () => piStandbyChildren.delete(started));
    started.stderr?.resume();
    started.stdin.on("error", () => { /* closed with the process */ });
    const chunks = new PiRpcChunks();
    let answer: (file: string | null) => void = () => {};
    const ready = new Promise<string | null>((resolve) => { answer = resolve; });
    const onData = piLineReader((line) => {
      const frame = decodePiFrame(line, chunks) as { type?: string; command?: string; data?: { sessionFile?: unknown } } | null;
      if (frame?.type === "response" && frame.command === "get_state") answer(typeof frame.data?.sessionFile === "string" ? frame.data.sessionFile : null);
    });
    started.stdout.setEncoding("utf8");
    started.stdout.on("data", onData);
    started.on("close", () => answer(null));
    started.stdin.write(JSON.stringify(PI_NEGOTIATE_FRAME) + "\n");
    started.stdin.write(JSON.stringify({ type: "get_state" }) + "\n");
    const timeout = new Promise<null>((resolve) => { const t = setTimeout(() => resolve(null), 20_000); t.unref?.(); });
    const bootSession = await Promise.race([ready, timeout]);
    if (!bootSession) throw new Error("pi started ahead did not answer");
    const entry: PiFresh = {
      child: started, dir, sessionsRoot: dirname(dirname(bootSession)), onData,
      timer: setTimeout(() => { if (piFresh.get(input.key) === entry) { piFresh.delete(input.key); closePiFresh(entry); } }, PI_STANDBY_MS),
    };
    entry.timer.unref?.();
    started.on("close", () => { if (piFresh.get(input.key) === entry) { piFresh.delete(input.key); closePiFresh(entry); } });
    if (piFresh.has(input.key)) { closePiFresh(entry); return; }
    piFresh.set(input.key, entry);
  } catch {
    if (child) { try { killCliTree(child); } catch { /* already gone */ } }
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  } finally {
    piFreshStarting.delete(input.key);
  }
}

/** After this many bare turns on one pi session the full prompt rides
 * again even without a compaction event: any history rewrite the events
 * miss (an older pi, a missed line) still loses at most this many turns
 * of standing instructions instead of the rest of the session. */
const PI_PROMPT_RE_ANCHOR_TURNS = 8;
/** How long the driver keeps listening after a finished turn_end for the
 * run's terminal agent_end before settling anyway: a runtime that never
 * emits agent_end still completes, while one that does cancels the wait. */
const PI_AGENT_END_GRACE_MS = 60_000;

/** pi answered a command with success:false — an explicit refusal from a
 * live runtime, not a transport failure. Only steer branches on the
 * difference today ("refused": provably not delivered, safe to re-queue);
 * the handshake commands keep their catch-all ignore. */
class PiRpcRefusalError extends Error {}

type PiPromptImage = {
  type: "image";
  data: string;
  mimeType: TurnImageInput["mime"];
};

function readPiPromptImages(turn: SendTurnInput): PiPromptImage[] {
  return (turn.images ?? []).map((image) => ({
    type: "image",
    data: readAtRestSync(image.path).toString("base64"),
    mimeType: image.mime,
  }));
}

/** Provider-native logs are designed for bug reports. Preserve the RPC
 * shape and encoded size, but never persist a user's image bytes in them. */
function piNativeLogMessage(message: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(message.images)) return message;
  return {
    ...message,
    images: message.images.map((image) => {
      if (!image || typeof image !== "object") return image;
      const value = image as Record<string, unknown>;
      return typeof value.data === "string"
        ? { ...value, data: `[image data: ${value.data.length} base64 chars]` }
        : value;
    }),
  };
}

/** Harness effort → pi thinking level (`set_thinking_level`). The sets match
 * one-for-one except for the name of the lowest rung: the harness calls it
 * "none", pi calls it "off". Exported for the test. */
export function piThinkingLevel(effort: EffortLevel): (typeof NATIVE_EFFORT_LEVELS)[number] | "off" {
  if (effort === "none") return "off";
  if (effort === ULTRACODE_EFFORT) return "max";
  return effort;
}

/** #1276: the turn message with STABLE_END_MARKER after what every new
 * conversation of the bot shares: the stable half and the volatile sections
 * before the first per-conversation one (COMPACT_VOLATILE_LAST, which
 * compactVolatileOrder puts last). A message without that text is unchanged. */
export function markSharedPrompt(
  message: string,
  halves: { stable: string | null; volatile: string },
  sections: Array<{ id: string; text: string }> | undefined,
): string {
  if (!halves.stable) return message;
  const own = (sections ?? []).findIndex((section) => COMPACT_VOLATILE_LAST.includes(section.id));
  const shared = halves.stable + (own < 0 ? halves.volatile : sections!.slice(0, own).map((section) => section.text).join(""));
  const at = message.indexOf(shared);
  return at < 0 ? message : message.slice(0, at + shared.length) + STABLE_END_MARKER + message.slice(at + shared.length);
}

/** Mirror of the Claude driver's integration → stdio MCP mount: every entry is
 * a JSON-RPC 2.0 stdio server the pi-mcp-extension consumes. Returns null when
 * there is nothing to mount (the common case). */
/** #1276: the turn's agents comms token and Perspicax capability ride the
 * files the harness rewrites each turn (spawn-contract.ts), as for Claude
 * Code's warm process, so the spawn contract holds no per-turn token. */
export function withWarmTokens(turn: SendTurnInput, threadId: string): SendTurnInput {
  const integrations = turn.integrations;
  if (!integrations) return turn;
  const agents = integrations.agents?.env?.SAGAX_COMMS_TOKEN
    ? { ...integrations.agents, env: warmCommsEnv(threadId, turn.botId, integrations.agents.env) }
    : integrations.agents;
  const custom = integrations.custom
    ? Object.fromEntries(Object.entries(integrations.custom).map(([name, server]) => {
      const env = (server as { env?: Record<string, string> }).env;
      return [name, env?.[PERSPICAX_TOKEN_ENV] ? { ...server, env: warmPerspicaxEnv(threadId, turn.botId, env) } : server];
    }))
    : integrations.custom;
  return { ...turn, integrations: { ...integrations, ...(agents ? { agents } : {}), ...(custom ? { custom } : {}) } };
}

export function buildMcpServers(turn: SendTurnInput): Record<string, unknown> | null {
  const parsed = parseToolScope(turn.toolScope);
  if (!parsed.ok) throw new Error(parsed.error);
  const servers: Record<string, unknown> = {};
  if (turn.integrations?.localComputer) {
    const local = turn.integrations.localComputer;
    servers.computer = {
      command: local.command,
      args: local.args,
      env: local.env,
      // Host control carries scope so the extension gates every call behind
      // a permission card; isolated computers deliberately omit it.
      ...(local.scope ? { scope: local.scope } : {}),
    };
  }
  if (turn.integrations?.agents) {
    // #1276: a compact prompt (a local model) lists the heart of a chat turn
    // and the bot's own most used Sagax tools; the rest are searched.
    servers.agents = turn.compactPrompt
      ? { ...turn.integrations.agents, env: { ...turn.integrations.agents.env, SAGAX_COMPACT_TOOLS: JSON.stringify({ core: turn.compactPrompt.agents.core, pinned: [...new Set(turn.compactPrompt.agents.pinned)].sort() }) } }
      : { ...turn.integrations.agents };
  }
  if (turn.integrations?.phone) servers.phone = { ...turn.integrations.phone };
  if (turn.integrations?.messages) servers.messages = { ...turn.integrations.messages };
  if (turn.integrations?.dweb) {
    servers.dweb = {
      command: process.execPath,
      args: [SPAWNED_PROXIES.dweb],
      env: { ...NODE_ENV_FLAG, DWEB_URL: turn.integrations.dweb.url },
    };
  }
  // Browser and Data reach Sagax's approval path as on Claude (mounted, not
  // pre-allowed there): the person's rules, the safety review and the
  // security keys apply, and a Data call in the bot's own workspace is
  // answered without a card (sagax-internal-tools.ts). Engine parity
  // 2026-10-19: pi ran both with no card at every level.
  if (turn.integrations?.browser) servers.browser = { ...turn.integrations.browser, scope: "approval" };
  if (turn.integrations?.data) servers.data = { ...turn.integrations.data, scope: "approval" };
  for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) servers[name] = { ...server, scope: "custom" };
  for (const [name, server] of Object.entries(servers)) {
    if (parsed.scope !== undefined && !canUseMcpServer(parsed.scope, name)) { delete servers[name]; continue; }
    // Pi registers every tool it is given and has no tool search of its own,
    // so a URL server's big catalog is searched instead (mcp-directory.ts).
    const directory = remoteMcpSpec(server) !== undefined;
    // #1276: in a compact prompt the gate searches the bot's own big catalogs,
    // listing whole only the tools the person's bots use.
    const botOwned = name in (turn.integrations?.custom ?? {});
    // a server may be named like an Object property ("constructor"): own keys only
    const search = turn.compactPrompt && botOwned && !directory ? { pinned: Object.hasOwn(turn.compactPrompt.pinned, name) ? turn.compactPrompt.pinned[name]! : [] } : undefined;
    const gated = gateServer({ name, server, toolScope: parsed.scope, threadId: turn.threadId, nodeEnv: NODE_ENV_FLAG, directory, ...(search ? { search } : {}), ...customServerGate(name, botOwned, turn.integrations?.customResultBudgets) });
    const stdio = gated ?? mcpStdioServer(server, { nodeEnv: NODE_ENV_FLAG, ...(directory ? { directory: { name } } : {}) });
    if (!stdio) throw new Error("Pi MCP server configuration is invalid");
    const original = server as { scope?: string };
    // A searched catalog (the gate's search, the agents catalog in a compact
    // prompt) is reached through call_tool: the extension reads that call as
    // the tool it runs, for the tool scope and the card, as for a directory.
    const searched = search !== undefined || (name === "agents" && turn.compactPrompt !== undefined);
    servers[name] = { ...stdio, ...(original.scope ? { scope: original.scope } : {}), ...(directory ? { directory: true } : {}), ...(searched ? { searched: true } : {}) };
  }
  return Object.keys(servers).length ? servers : null;
}

/** The `<server>__<tool>` a gated MCP confirm names, as the other engines
 * report it (`mcpTool`), so Sagax's name-based answers (its own tools, a
 * Perspicax read or lease, the person's rules) apply on pi too. Only the
 * exact title pi-mcp-extension writes (`Allow <server>:<tool>?`) for a server
 * mounted on this turn; anything else stays an unnamed card. A convenience,
 * not a security boundary: pi's RPC does not say which extension asked, and
 * in solo the person's own extensions (code inside pi already) could write
 * the same title; an organization turn runs pi with --no-extensions. */
export function piGatedMcpTool(title: unknown, mounted: Record<string, unknown> | null): string | undefined {
  if (typeof title !== "string" || !mounted) return undefined;
  // the tool part admits every name a searched call can run (searched-tool-call.ts)
  const match = /^Allow ([A-Za-z0-9][\w-]{0,63}):([A-Za-z0-9_][\w.:-]{0,199})\?$/.exec(title);
  if (!match || !Object.hasOwn(mounted, match[1]!)) return undefined;
  return `${match[1]}__${match[2]}`;
}

/** The arguments of a named gated confirm, as Sagax's approval path reads
 * them (`input`). pi-mcp-extension writes them as JSON cut at 300
 * characters, or `Run <server>:<tool>` when there are none. A cut or
 * missing message never reads as "no arguments": it stays text that does
 * not parse, so a call judged on its arguments keeps its card. */
export function piGatedMcpInput(message: unknown, mcpTool: string): string {
  if (typeof message !== "string") return "(arguments not shown)";
  const cut = mcpTool.indexOf("__");
  const server = mcpTool.slice(0, cut);
  const tool = mcpTool.slice(cut + 2);
  if (message === `Run ${server}:${tool}`) return "{}";
  return message || "(arguments not shown)";
}

/** #1276: a gated confirm reads as the tool that really runs, as on Claude
 * Code (shared/searched-tool-call.ts): a `call_tool` on a searched server, or
 * the agents bridge's use_tool, is the tool it names with that tool's own
 * arguments, so the person's and the organization's rules and Always allow
 * apply by that tool's name. pi-mcp-extension already names the target in
 * the card of a searched server's call_tool, whatever the arguments' length;
 * a call_tool card left on a searched server (arguments that do not parse)
 * runs nothing named, so it is `refused`, as a wrapper that must not run. */
export function piSearchedCall(mcpTool: string, input: string, searched: ReadonlySet<string>): { mcpTool: string; input: string; refused?: string } {
  const cut = mcpTool.indexOf("__");
  if (cut <= 0) return { mcpTool, input };
  const server = mcpTool.slice(0, cut);
  const parsed = (() => { try { return JSON.parse(input) as unknown; } catch { return null; } })();
  const runs = searchedToolCall(`mcp__${mcpTool}`, parsed, searched);
  if (runs.refused) return { mcpTool, input, refused: runs.refused };
  if (runs.searched) return { mcpTool: runs.name.slice("mcp__".length), input: JSON.stringify(runs.input) };
  if (searched.has(server) && mcpTool.slice(cut + 2) === SEARCH_CALL_TOOL) {
    return { mcpTool, input, refused: "call_tool needs one tool name and its arguments as an object." };
  }
  return { mcpTool, input };
}

/** #1276: the servers whose catalog is searched on this turn (call_tool). */
export function piSearchedServers(mounted: Record<string, unknown> | null): ReadonlySet<string> {
  return new Set(Object.entries(mounted ?? {})
    .filter(([, server]) => { const flags = server as { searched?: unknown; directory?: unknown }; return flags?.searched === true || flags?.directory === true; })
    .map(([name]) => name));
}

/** #1276: the session a turn may resume. On an organization server pi keeps
 * each person's sessions in that person's own pi home (`engineHome`, set
 * for a key turn and a local model alike): a cursor outside its sessions
 * folder is never resumed, the turn opens a new session instead. Solo (no
 * home given) keeps the cursor as it is. */
export function piResumableSession(cursor: unknown, engineHome: string | undefined): string | null {
  if (typeof cursor !== "string" || !cursor) return null;
  if (!engineHome) return cursor;
  const sessions = resolve(engineHome, "sessions") + sep;
  return resolve(cursor).startsWith(sessions) ? cursor : null;
}

/** A pi `get_available_models` response payload, parsed at its I/O boundary. */
interface PiModelEntry {
  provider: string;
  id: string;
  name?: string;
}
interface PiModelsResponse {
  type: "response";
  command: "get_available_models";
  success: boolean;
  data?: { models?: PiModelEntry[] };
}

/** One decoded frame → catalog, or null when it is not a successful
 *  `get_available_models` response. Every option is `custom` (pi is BYOK)
 *  and id is the `provider/modelId` composite the picker and `set_model`
 *  both use. */
function piCatalogFromFrame(frame: unknown, fallbackDefault: string): ModelCatalog | null {
  const res = frame as PiModelsResponse;
  if (res?.type !== "response" || res.command !== "get_available_models" || !res.success) return null;
  const options: Array<{ id: string; label: string; custom: true; provider: string }> = [];
  for (const m of res.data?.models ?? []) {
    if (!m?.provider || !m?.id) continue;
    const id = `${m.provider}/${m.id}`;
    options.push({ id, label: m.name ?? m.id, custom: true, provider: m.provider });
  }
  return { default: fallbackDefault || (options[0]?.id ?? ""), options };
}

/** Pure parser: turn a `get_available_models` stdout blob into a catalog.
 *  Exported for the test. */
export function parsePiCatalog(stdout: string, fallbackDefault = ""): ModelCatalog {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const catalog = piCatalogFromFrame(msg, fallbackDefault);
    if (catalog) return catalog;
  }
  return { default: fallbackDefault, options: [] };
}

/** omp's RPC v2 splits any frame larger than 1 MiB into base64 `rpc_chunk`
 *  pieces: one `chunkId`/`count`/`byteLength` for the whole frame, a
 *  sequential `index`, and `data` carrying one piece. Reassembles one
 *  logical frame at a time; any inconsistency drops the partial sequence so
 *  a corrupt stream can never feed a half-built frame to the parser.
 *  Exported for the test. */
export class PiRpcChunks {
  /** omp's advertised cap on one reassembled frame. */
  static readonly MAX_BYTES = 64 * 1024 * 1024;
  /** omp's cap on one decoded piece, which also bounds the piece count. */
  static readonly MAX_PIECE_BYTES = 256 * 1024;
  static readonly MAX_COUNT = PiRpcChunks.MAX_BYTES / PiRpcChunks.MAX_PIECE_BYTES;
  private chunkId: string | null = null;
  private count = 0;
  private byteLength = 0;
  private bytes = 0;
  private parts: Buffer[] = [];

  /** Feed one `rpc_chunk`; returns the reassembled frame when the last
   *  piece arrives, or null while the sequence is incomplete or broken. */
  accept(message: Record<string, unknown>): Record<string, unknown> | null {
    const { chunkId, index, count, byteLength, data } = message;
    if (
      typeof chunkId !== "string" || chunkId.length === 0 || typeof data !== "string" ||
      // Bound the base64 before decoding it, so an oversized piece is
      // rejected without allocating its bytes.
      data.length === 0 || data.length > Math.ceil(PiRpcChunks.MAX_PIECE_BYTES / 3) * 4 ||
      !Number.isInteger(index) || !Number.isInteger(count) || !Number.isInteger(byteLength) ||
      (index as number) < 0 || (count as number) < 2 || (count as number) > PiRpcChunks.MAX_COUNT ||
      (index as number) >= (count as number) ||
      (byteLength as number) < 0 || (byteLength as number) > PiRpcChunks.MAX_BYTES
    ) {
      this.reset();
      return null;
    }
    if (chunkId !== this.chunkId) {
      // A new sequence may only start at index 0; a different chunkId
      // mid-sequence means the previous one can never complete.
      if (index !== 0) {
        this.reset();
        return null;
      }
      this.chunkId = chunkId;
      this.count = count as number;
      this.byteLength = byteLength as number;
      this.parts = [];
      this.bytes = 0;
    } else if (count !== this.count || byteLength !== this.byteLength) {
      this.reset();
      return null;
    }
    const part = Buffer.from(data, "base64");
    // Every piece must carry bytes: an empty one would let a sequence grow
    // `parts` without ever approaching `byteLength`.
    if (
      index !== this.parts.length || part.length === 0 || part.length > PiRpcChunks.MAX_PIECE_BYTES ||
      this.bytes + part.length > this.byteLength
    ) {
      this.reset();
      return null;
    }
    this.parts.push(part);
    this.bytes += part.length;
    if (this.parts.length < this.count) return null;
    const complete = this.bytes === this.byteLength;
    const text = Buffer.concat(this.parts).toString("utf8");
    this.reset();
    if (!complete) return null;
    try {
      const frame = JSON.parse(text) as unknown;
      return frame && typeof frame === "object" && !Array.isArray(frame)
        ? frame as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private reset(): void {
    this.chunkId = null;
    this.count = 0;
    this.byteLength = 0;
    this.bytes = 0;
    this.parts = [];
  }
}

/** Decode one pi stdout line: a plain JSON frame, or one piece of an
 *  `rpc_chunk` sequence (omp's protocol v2) with the reassembled frame
 *  returned once complete. Non-JSON lines, scalars and broken sequences
 *  resolve null and are skipped. Exported for the test. */
export function decodePiFrame(line: string, chunks: PiRpcChunks): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const frame = parsed as Record<string, unknown>;
  return frame.type === "rpc_chunk" ? chunks.accept(frame) : frame;
}

/** Longest stdout line a reader buffers: omp's cap on one whole frame. */
const PI_MAX_LINE = PiRpcChunks.MAX_BYTES;

/** Split a pi child's stdout into non-blank lines for `onLine`, which
 *  returns true to stop reading. A line longer than PI_MAX_LINE is dropped
 *  through its newline instead of growing the buffer without bound.
 *  Exported for the test. */
export function piLineReader(onLine: (line: string) => boolean | void): (chunk: string) => void {
  let buf = "";
  let dropping = false;
  return (chunk) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (dropping) {
        dropping = false;
        continue;
      }
      if (line.length > PI_MAX_LINE || !line.trim()) continue;
      if (onLine(line)) return;
    }
    if (buf.length > PI_MAX_LINE) {
      buf = "";
      dropping = true;
    }
  };
}

/** Split a picker id into pi's `{provider, modelId}`. Accepts both the
 *  native `provider/modelId` composite and a live-host `host::model`
 *  inject id. */
export function splitPiModel(id: string): { provider: string; modelId: string } | null {
  const inject = decodeInjectId(id);
  if (inject) return { provider: inject.host, modelId: inject.model };
  if (!id.includes("/")) return null;
  const [provider, ...rest] = id.split("/");
  if (!provider || !rest.length) return null;
  return { provider, modelId: rest.join("/") };
}

/** Prefer live `host::model` inject rows over the same model already
 *  listed as `host/model` from ~/.pi/agent/models.json, so Custom does
 *  not show duplicates. */
export function preferPiInjectRows(catalog: ModelCatalog): ModelCatalog {
  const injectIds = new Set(
    catalog.options.filter((option) => decodeInjectId(option.id)).map((option) => option.id),
  );
  if (!injectIds.size) return catalog;
  const options = catalog.options.filter((option) => {
    if (decodeInjectId(option.id)) return true;
    const slash = option.id.indexOf("/");
    if (slash <= 0) return true;
    return !injectIds.has(encodeInjectId(option.id.slice(0, slash), option.id.slice(slash + 1)));
  });
  let def = catalog.default;
  if (def && !options.some((option) => option.id === def)) {
    const slash = def.indexOf("/");
    const mapped = slash > 0 ? encodeInjectId(def.slice(0, slash), def.slice(slash + 1)) : "";
    def = injectIds.has(mapped) ? mapped : (options[0]?.id ?? "");
  }
  return { default: def, options };
}

export async function applyPiLocalCatalog(
  catalog: ModelCatalog,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelCatalog> {
  return preferPiInjectRows(await mergeLocalInject(catalog, env, fetchImpl));
}

function piAgentDir(env: Record<string, string | undefined>): string {
  // pi reads PI_CODING_AGENT_DIR first: on an organization server each
  // payer's turn runs in their own pi home (piAccessEnvironment), and a
  // local model written to the server's ~/.pi/agent never reaches it.
  const own = env.PI_CODING_AGENT_DIR?.trim();
  if (own) return own;
  return join(env.HOME || env.USERPROFILE || homedir(), ".pi", "agent");
}

/** Upsert a live local host into ~/.pi/agent/models.json so `set_model`
 *  can reach it. Existing providers and models are kept. Returns the
 *  `{provider, modelId}` pair pi's RPC expects, or null when the picker
 *  id is not a model at all. */
export function ensurePiInjectModel(
  modelId: string,
  env: Record<string, string | undefined> = process.env,
): { provider: string; modelId: string } | null {
  const split = splitPiModel(modelId);
  if (!split) return null;
  const inject = decodeInjectId(modelId);
  if (!inject) return split;
  const host = localHost(inject.host);
  if (!host) return split;

  const dir = piAgentDir(env);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "models.json");
  let root: Record<string, unknown> = { providers: {} };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>;
      } else {
        // Malformed — do not destroy the file; still return the split so
        // set_model can try.
        return split;
      }
    } catch {
      return split;
    }
  }

  const providers =
    root.providers && typeof root.providers === "object" && !Array.isArray(root.providers)
      ? { ...(root.providers as Record<string, unknown>) }
      : {};
  const previous = providers[inject.host];
  const existing: Record<string, unknown> =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {
          baseUrl: host.baseUrl,
          api: "openai-completions",
          apiKey: hostApiKey(host, env),
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
          models: [] as Array<Record<string, unknown>>,
        };
  existing.baseUrl = host.baseUrl;
  existing.api = typeof existing.api === "string" && existing.api ? existing.api : "openai-completions";
  existing.apiKey = hostApiKey(host, env);
  if (!existing.compat) {
    existing.compat = { supportsDeveloperRole: false, supportsReasoningEffort: true };
  }
  const models: Array<Record<string, unknown>> = Array.isArray(existing.models)
    ? existing.models.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
  if (!models.some((row) => row.id === inject.model)) {
    models.push({
      id: inject.model,
      name: inject.model,
      reasoning: true,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 16384,
    });
  }
  existing.models = models;
  providers[inject.host] = existing;
  root.providers = providers;
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores POSIX modes; keep the inject even if chmod is unsupported.
  }
  return split;
}

/** The pi-side default model, read from ~/.pi/agent/settings.json so the
 *  catalog's `default` matches what `pi` would actually run. Missing file →
 *  empty string, and the first option is used instead. */
function readPiDefaultModel(env: Record<string, string | undefined>): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  try {
    const s = JSON.parse(readFileSync(`${home}/.pi/agent/settings.json`, "utf8")) as {
      defaultProvider?: string;
      defaultModel?: string;
    };
    return s.defaultProvider && s.defaultModel ? `${s.defaultProvider}/${s.defaultModel}` : "";
  } catch {
    return "";
  }
}

/** Probe the live catalog by spawning `pi --mode rpc --no-session`, sending
 *  `get_available_models`, and parsing the response. A failed probe resolves
 *  with an empty catalog — the instance reports unavailable via snapshot. */
export async function fetchPiModels(
  cli: string,
  env: Record<string, string | undefined>,
): Promise<ModelCatalog> {
  return engineStartGate.run("probe", `${cli} rpc (models)`, () => readPiModels(cli, env));
}

function readPiModels(
  cli: string,
  env: Record<string, string | undefined>,
): Promise<ModelCatalog> {
  const child = spawnCli(cli, PI_ARGS, { stdio: ["pipe", "pipe", "pipe"], env });
  return new Promise((resolve) => {
    let done = false;
    const fallbackDefault = readPiDefaultModel(env);
    const finish = (catalog: ModelCatalog) => {
      if (done) return;
      done = true;
      try {
        killCliTree(child);
      } catch {
        /* already gone */
      }
      resolve(catalog);
    };
    const timer = setTimeout(() => finish({ default: "", options: [] }), 15_000);
    timer.unref?.();
    const chunks = new PiRpcChunks();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", piLineReader((line) => {
      const frame = decodePiFrame(line, chunks);
      if (frame?.command !== "get_available_models") return false;
      clearTimeout(timer);
      finish(piCatalogFromFrame(frame, fallbackDefault) ?? { default: fallbackDefault, options: [] });
      return true;
    }));
    child.on("error", () => finish({ default: "", options: [] }));
    child.on("close", () => finish({ default: "", options: [] }));
    try {
      child.stdin.write(`${JSON.stringify(PI_NEGOTIATE_FRAME)}\n`);
      child.stdin.write(JSON.stringify({ id: "catalog", type: "get_available_models" }) + "\n");
    } catch {
      finish({ default: "", options: [] });
    }
  });
}

/** Refresh pi's provider-owned catalog cache. This is deliberately called
 * only by the explicit model-picker refresh action, never during app startup.
 * Failure is non-fatal: the caller still probes the last usable cache. */
export async function updatePiModelCatalog(
  cli: string,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  return new Promise((resolve) => {
    execCli(
      cli,
      PI_MODEL_UPDATE_ARGS,
      { env, timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error) => resolve(!error),
    );
  });
}

export interface PiConfig {
  cli: string;
  /** Full-auto: never ask before an action. Host control is unavailable in
   * this mode — the same knob as Claude's `bypassPermissions` and the ACP
   * engines' `fullAuto`. */
  fullAuto: boolean;
}

function decodeConfig(raw: unknown): PiConfig {
  if (raw === null || raw === undefined) return { cli: "pi", fullAuto: false };
  if (typeof raw !== "object") throw new Error("pi config must be an object");
  const obj = raw as { cli?: unknown; fullAuto?: unknown };
  if (obj.cli !== undefined && typeof obj.cli !== "string") throw new Error("pi config `cli` must be a string");
  if (obj.fullAuto !== undefined && typeof obj.fullAuto !== "boolean") throw new Error("pi config `fullAuto` must be a boolean");
  return {
    cli: obj.cli && obj.cli.trim() ? obj.cli.trim() : "pi",
    fullAuto: obj.fullAuto === true,
  };
}

const EMPTY: ModelCatalog = { default: "", options: [] };

/** The parsed pi RPC event we branch on — only the fields this driver reads. */
interface PiEvent {
  type: string;
  // response
  command?: string;
  success?: boolean;
  data?: unknown;
  // message_update
  assistantMessageEvent?: { type?: string; delta?: string };
  // tool_execution_*
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  // turn_end / message_end
  message?: { stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number } };
  usage?: { input?: number; output?: number };
  // agent_end / agent_settled
  isTerminal?: boolean;
  willRetry?: boolean;
  // extension_ui_request
  id?: string;
  method?: string;
  options?: unknown[];
  title?: string;
}

function piEnvironment(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source, PATH: augmentedPath() };
  // pi is BYOK and reads provider keys straight from its environment: an
  // inherited key would silently flip billing onto one the user never granted
  // pi, and workspace credentials are the harness's secrets, not pi's. The
  // keys pi may use live in its own settings file, so the child inherits
  // neither list.
  stripWorkspaceCredentialEnv(env);
  for (const key of PROVIDER_CREDENTIAL_ENV) delete env[key];
  return env;
}

/** The provider keys pi reads, as engine-credentials.ts PROVIDER_KEY_ENV
 * hands them (Perspicax providers anthropic, openai, xai, google, moonshot). */
export const PI_ACCESS_KEY_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "MOONSHOT_API_KEY"] as const;

/** Organization server: one turn's credentials (SendTurnInput.access), over
 * an environment piEnvironment already stripped of every key: the payer's
 * own PI_CODING_AGENT_DIR (never the server's ~/.pi/agent/auth.json) and
 * the keys they keep in Perspicax. */
export function piAccessEnvironment(env: Record<string, string | undefined>, access: TurnAccessInput | undefined): Record<string, string | undefined> {
  if (!access) return env;
  if (access.engineHome) {
    mkdirSync(access.engineHome, { recursive: true, mode: 0o700 });
    env.PI_CODING_AGENT_DIR = access.engineHome;
  }
  for (const name of PI_ACCESS_KEY_ENV) {
    const value = access.environment?.[name];
    if (value) env[name] = value;
  }
  return env;
}

/** One turn's environment: the command variables the person exposed to
 * this bot (server/credential-command-env.ts) join the process pi runs its
 * bash tool in, never a provider key name pi would bill. pi starts for every
 * turn, so a change or a revoke holds at the next one. */
export function piTurnEnvironment(env: Record<string, string | undefined>, commandEnvironment: Record<string, string> | undefined): Record<string, string | undefined> {
  applyEngineCommandVariables(env, commandEnvironment, PI_ACCESS_KEY_ENV);
  return env;
}

/** On an organization server the server's own pi holds no key, and pi lists
 * only the models of providers it has a key for: the catalog is read with a
 * placeholder for every provider a person's key can serve, in a pi home of
 * its own, so members can pick a model their own key then pays for. The
 * placeholders never reach a turn (piEnvironment). */
export function piCatalogEnvironment(env: Record<string, string | undefined>, orgServer: boolean): Record<string, string | undefined> {
  if (!orgServer) return env;
  const next: Record<string, string | undefined> = { ...env, PI_CODING_AGENT_DIR: join(tmpdir(), "sagax-pi-catalog") };
  for (const name of PI_ACCESS_KEY_ENV) next[name] = "sagax-catalog-only";
  return next;
}

export const PiDriver: ProviderDriver<PiConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "pi", supportsMultipleInstances: true, access: "custom" },
  install: {
    command: {
      darwin: "npm install -g @earendil-works/pi-coding-agent",
      linux: "npm install -g @earendil-works/pi-coding-agent",
      win32: "npm install -g @earendil-works/pi-coding-agent",
    },
    needsNode: true,
    docsUrl: "https://pi.dev",
  },
  models: EMPTY,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<PiConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const catalogEnv = piCatalogEnvironment(piEnvironment({ ...process.env, ...input.environment }), process.env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax");
    let models = EMPTY;
    const readModels = async () => {
      let base = models;
      try {
        const resolved = await fetchPiModels(config.cli, catalogEnv);
        if (resolved.options.length) base = resolved;
      } catch {
        // Keep the last usable catalog when the probe fails.
      }
      try {
        const next = await applyPiLocalCatalog(base, catalogEnv);
        if (next.options.length) models = next;
      } catch {
        if (base.options.length) models = base;
      }
      try { writeStartupModelCache(instanceId, models); } catch { /* derived cache */ }
    };
    const refreshModels = async () => {
      await updatePiModelCatalog(config.cli, catalogEnv);
      await readModels();
    };
    // Startup stays local and fast. Only the explicit Refresh button crosses
    // pi's model-catalog network boundary. A later start serves the saved
    // list and reads the local catalog behind listen.
    const startupModelRefresh = (await openStartupModelCatalog({
      instanceId,
      use: (catalog) => { models = catalog; },
      current: () => models,
      refresh: readModels,
    }))?.pending ?? null;

    const listeners = new Set<RuntimeEventListener>();
    // one active turn per thread
    const active = new Map<string, {
      stop: () => void;
      turnId: string;
      pending: Map<string, (decision: { behavior: "allow" | "deny" | "answer"; message?: string }) => void>;
      child?: { stdin: { write: (s: string) => void } };
      steer?: (text: string, steerId?: string) => Promise<SteerOutcome>;
    }>();

    const emit = (event: RuntimeEvent) => {
      for (const l of Array.from(listeners)) l(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      providerInstanceId: instanceId,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const sendTurn = async (turn: SendTurnInput) => {
      if (startupModelRefresh) await startupModelRefresh;
      const { threadId } = turn;
      const selection = parseToolScope(turn.toolScope);
      if (!selection.ok) throw new Error(selection.error);
      const toolScope = selection.scope;
      if (active.has(threadId)) throw new Error("a turn is already running on this thread");
      // Per-bot Ask/Auto is authoritative for harness turns. Preserve the
      // legacy instance flag only for direct adapter callers that omit it.
      const fullAuto = turn.approvalMode === undefined ? config.fullAuto : false;
      // Host control always routes through the permission card; full-auto must
      // never get unapproved hands on the user's machine (same guard as the
      // Claude and ACP drivers).
      const controlsHost = turn.integrations?.localComputer?.scope === "local-computer";
      if (controlsHost && fullAuto) {
        throw new Error("local computer control requires the interactive approval broker");
      }
      const turnId = newId();
      const pending = new Map<string, (decision: { behavior: "allow" | "deny" | "answer"; message?: string }) => void>();
      // Ask fail-safe timers, tracked so settle() can cancel them outright:
      // a cleared pending map alone leaves each timer holding the ask
      // closure (send, child) alive until it fires.
      const askTimers = new Set<ReturnType<typeof setTimeout>>();
      let settled = false;
      /** the session a standby pi resumes (#1276) */
      let standbySession: string | null = null;
      // the last turn_end's outcome, replayed when the run's terminal
      // agent_end (or the grace fallback) settles the turn
      let endStopReason: string | undefined;
      let endUsage: { input?: number; output?: number } | undefined;
      let endErrorMessage: string | undefined;
      // hang insurance for runtimes with no agent_end frame at all
      let agentEndTimer: ReturnType<typeof setTimeout> | null = null;
      // pi's RPC surface accepts image content directly. Read before spawning
      // so an attachment that disappeared produces one clear dispatch error
      // instead of starting a child that can never receive its prompt.
      const images = readPiPromptImages(turn);

      // Write ~/.pi/agent/models.json before creating any credential-bearing
      // MCP temp files. If model setup fails, there is nothing sensitive to
      // clean up yet.
      if (typeof turn.model === "string" && turn.model) {
        ensurePiInjectModel(turn.model, {
          ...process.env,
          ...input.environment,
          // the payer's own pi home, the one the child reads (piAccessEnvironment)
          ...(turn.access?.engineHome ? { PI_CODING_AGENT_DIR: turn.access.engineHome } : {}),
        });
      }

      // integrations → stdio MCP servers for the pi-mcp-extension. The config
      // carries credentials (boat token, comms token), so it goes
      // into a 0600 temp file removed when the turn settles — never on argv.
      // #1276: a compact turn's per-turn tokens ride files (as Claude Code's
      // warm process does), so a standby pi with the same contract can serve it.
      const mcpServers = buildMcpServers(turn.compactPrompt ? withWarmTokens(turn, threadId) : turn);
      let mcpTempDir: string | null = null;
      let scopeReadyPath: string | undefined;
      const mcpConfig: Record<string, unknown> = { mcpServers: mcpServers ?? {}, toolScope, approvalMode: turn.approvalMode, ...(turn.compactPrompt ? { stableCwd: true, splitStable: true } : {}) };
      const mounts = Boolean(mcpServers || toolScope !== undefined);
      const standbyArgs = [
        ...(turn.compactPrompt ? PI_ARGS.filter((arg) => arg !== "--no-session") : PI_ARGS),
        ...piHostToolArgs(turn.withholdHostTools === true),
        ...(mounts ? ["-e", SPAWNED_PROXIES.piMcpExtension] : []),
      ];
      const standbyKey = JSON.stringify({
        cli: config.cli, args: standbyArgs, cwd: turn.cwd ?? null,
        config: { ...mcpConfig, mcpServers: withoutTurnTokens(mcpServers ?? {}) },
        environment: input.environment ?? null, access: turn.access ?? null, command: turn.commandEnvironment ?? null,
      });
      // #1276: only a session of this turn's own pi home is ever resumed
      const resumeCursor = piResumableSession(turn.resumeCursor, turn.access?.engineHome);
      if (turn.compactPrompt && !turn.sessionReset && resumeCursor) await settledPiStandby(threadId);
      const standby = turn.compactPrompt && !turn.sessionReset && resumeCursor
        ? takePiStandby(threadId, standbyKey, resumeCursor)
        : (dropPiStandby(threadId), undefined);
      // #1276: a new conversation takes the pi started ahead for this bot's
      // contract (everything but the folder and the MCP servers, which it
      // receives now) and switches it to a new session in this folder.
      const freshKey = JSON.stringify({
        bot: turn.botId ?? null, cli: config.cli, args: standbyArgs,
        environment: input.environment ?? null, access: turn.access ?? null, command: turn.commandEnvironment ?? null,
      });
      const ahead = !standby && turn.compactPrompt && typeof turn.resumeCursor !== "string" && turn.cwd && mounts ? takePiFresh(freshKey) : undefined;
      if (standby) {
        mcpTempDir = standby.dir;
        scopeReadyPath = standby.scopeReadyPath;
      } else if (mounts) {
        mcpTempDir = ahead ? ahead.dir : mkdtempSync(join(tmpdir(), "omb-pi-mcp-"));
        if (toolScope !== undefined) scopeReadyPath = join(mcpTempDir, "scope-ready.json");
        try {
          writeFileSync(join(mcpTempDir, "mcp.json"), JSON.stringify({ ...mcpConfig, scopeReadyPath, ...(turn.compactPrompt ? { toolCachePath: join(mcpTempDir, PI_TOOL_CACHE), warmPath: join(mcpTempDir, PI_WARM) } : {}) }), { mode: 0o600 });
        } catch (err) {
          // A failed write must not leave the temp dir behind — a partial file
          // could still hold the boat token / comms token.
          try {
            rmSync(mcpTempDir, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
          throw err;
        }
      }
      // `--no-extensions` still loads an explicit `-e`, so the Sagax MCP
      // extension stays while the person's own pi extensions do not.
      // #1276: a compact prompt (a local model) keeps pi's session, so the
      // next turn resumes it (switch_session) and extends this very prompt:
      // the local server's prefix cache serves everything but the new turn.
      // Without it each turn replays the transcript into a fresh prompt.
      const childArgs = standbyArgs;
      const spawnEnv = piTurnEnvironment(piAccessEnvironment(piEnvironment({
        ...process.env,
        ...input.environment,
        ...(mcpTempDir ? { SAGAX_MCP_CONFIG: join(mcpTempDir, "mcp.json") } : {}),
      }), turn.access), turn.commandEnvironment);

      // spawnCli can throw synchronously (unresolvable CLI); if it does, the
      // 0600 temp file with the boat token / comms token must
      // not be left on disk — settle() never runs because no child existed.
      const child = standby ? standby.child : ahead ? ahead.child : (() => {
        try {
          return spawnCli(config.cli, childArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: turn.cwd,
            env: spawnEnv,
          }, "bot");
        } catch (err) {
          if (mcpTempDir) {
            try {
              rmSync(mcpTempDir, { recursive: true, force: true });
            } catch {
              /* best effort */
            }
          }
          throw err;
        }
      })();
      // Drain diagnostics on cold turns too. An unread stderr pipe can
      // fill and stop pi before it sends its next protocol frame.
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8192);
      });
      let assistantText = "";
      // a tool's resolved name between its start and its end (gateway calls)
      const toolNames = new Map<string, string>();
      const mcpServerNames = Object.keys(mcpServers ?? {});
      const searchedServers = piSearchedServers(mcpServers);
      // set when a compaction event arrives this turn; gates the receipt
      // write below so a compacted-around delivery is never claimed
      let compactionObserved = false;
      // resolve one-shot RPC responses (new_session / switch_session / set_model)
      const responseWaiters = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
      // Steer frames correlate by a unique per-request id, not the shared
      // "steer" command name: two concurrent steers would otherwise overwrite
      // each other's waiter, and a refusal response could reject the wrong
      // caller — requeueing words pi already accepted. Every other command
      // keeps its command-name key.
      let steerSeq = 0;
      const rejectWaiters = (err: Error) => {
        for (const waiter of responseWaiters.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(err);
        }
        responseWaiters.clear();
      };
      const awaitResponse = (command: string, timeoutMs = 20_000, key = command) =>
        new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            responseWaiters.delete(key);
            reject(new Error(`pi ${command} timed out`));
          }, timeoutMs);
          timer.unref?.();
          responseWaiters.set(key, { resolve, reject, timer });
        });
      child.stdin.on("error", () => rejectWaiters(new Error("pi stdin closed")));
      const send = (obj: Record<string, unknown>) => {
        appendNative(threadId, { dir: "out", source: "pi.rpc", msg: piNativeLogMessage(obj) });
        child.stdin.write(JSON.stringify(obj) + "\n");
      };
      // Declare protocol 2 on the same stdin before the first command, so an
      // omp-style runtime chunks any oversized frame it sends back. Vanilla
      // pi refuses the unknown command; no waiter is keyed for the reply,
      // so either answer is ignored.
      if (!standby && !ahead) send(PI_NEGOTIATE_FRAME);

      /** Emit buffered assistant text as its own item, then clear it. */
      const flushAssistantText = () => {
        const text = assistantText;
        assistantText = "";
        if (!text.trim()) return;
        emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
      };

      const settle = (ok: boolean, stopReason?: string | null, usage?: { input?: number; output?: number }) => {
        if (settled) return;
        settled = true;
        // #1276: once this pi has exited (its session file then holds the
        // whole turn), start the thread's next pi, its session resumed.
        if (ok && turn.compactPrompt && standbySession && (stopReason ?? "end_turn") === "end_turn") {
          const resume = { threadId, key: standbyKey, sessionFile: standbySession, cli: config.cli, args: childArgs, cwd: turn.cwd, env: spawnEnv, config: mcpConfig, toolCache: readPiToolCache(mcpTempDir),
            // a conversation's first turn warms the bot's next one (the standby sends it)
            warm: typeof turn.resumeCursor === "string" ? undefined : readPiToolCache(mcpTempDir, PI_WARM) };
          if (child.exitCode !== null || child.signalCode !== null) void startPiStandby(resume);
          else child.once("exit", () => { void startPiStandby(resume); });
          // and a pi for the bot's next new conversation, if none waits yet
          if (mounts && turn.cwd) void startPiFresh({ key: freshKey, cli: config.cli, args: childArgs, cwd: turn.cwd, env: spawnEnv });
        }
        if (agentEndTimer) {
          clearTimeout(agentEndTimer);
          agentEndTimer = null;
        }
        // The turn is over: drop unanswered asks so their 15-minute
        // fail-safe timers are cancelled outright instead of no-oping on a
        // dead child while holding the ask closure alive.
        for (const timer of askTimers) clearTimeout(timer);
        askTimers.clear();
        pending.clear();
        flushAssistantText();
        emit({
          ...base(threadId, turnId),
          type: "turn.completed",
          ok,
          stopReason: stopReason ?? (ok ? "end_turn" : "failed"),
          ...(usage ? { usage: { input: usage.input ?? 0, output: usage.output ?? 0 } } : {}),
        });
        try {
          child.stdin.end();
        } catch {
          /* already closed */
        }
        try {
          killCliTree(child);
        } catch {
          /* already gone */
        }
        if (mcpTempDir) {
          try {
            rmSync(mcpTempDir, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
        }
        active.delete(threadId);
      };

      /** Settle from the last turn_end's recorded outcome. Errors surface
       * here, at run completion, so a failed run reports exactly once and
       * only after any scheduled maintenance events had their chance to
       * arrive. */
      const finishRun = () => {
        const sr = endStopReason;
        if (sr === "error" || sr === "failed") {
          const raw = String(endErrorMessage ?? "pi turn failed");
          // A local or computer-shared model has no usage limit: its failure
          // says what is wrong and what to do, with the server's own words.
          const local = isLocalModelId(turn.model) ? localModelFailureMessage(raw) : null;
          const said = local ? providerReason(raw.replace(/^\d{3}\s+/, "")) : null;
          emit({
            ...base(threadId, turnId),
            type: "runtime.error",
            message: (local ? `${local}${said ? ` (the local server said: "${said}")` : ""}` : raw).slice(0, 2_000),
          });
          settle(false, "failed", endUsage);
          return;
        }
        settle(true, sr === "cancelled" || sr === "aborted" ? "cancelled" : "end_turn", endUsage);
      };

      const stop = () => {
        try {
          send({ type: "abort" });
        } catch {
          /* ignore */
        }
        try {
          killCliTree(child);
        } catch {
          /* ignore */
        }
        settle(true, "cancelled");
      };

      // Mid-turn input rides pi's native steer frame — the runtime queues
      // it into the running agent without aborting the in-flight step, and
      // answers success only after session.steer() accepted it. A success:
      // false response is an explicit refusal (nothing consumed the words:
      // safe to re-queue), while a death or timeout after the frame was
      // written leaves the outcome unknowable — those are "indeterminate"
      // so the caller can never run the words twice. Each frame carries a
      // unique id that pi echoes on its response, so concurrent steers on
      // the same turn never share or overwrite a waiter.
      const steerActiveTurn = async (text: string, steerId?: string): Promise<SteerOutcome> => {
        if (settled || child.exitCode !== null || child.signalCode !== null) return "refused";
        let ack: Promise<unknown>;
        try {
          const id = `steer:${++steerSeq}`;
          ack = awaitResponse("steer", 20_000, id);
          send({ type: "steer", id, message: text });
        } catch {
          // stdin closed before the frame was written: provably undelivered.
          return "refused";
        }
        try {
          await ack;
          // pi's agent loop polls accepted steering after every step, the
          // last one included: the running turn reads it. Said so, the
          // harness never offers it again to the next turn (2026-11-01).
          if (steerId) emit({ ...base(threadId, turnId), type: "steer.received", steerId });
          return "steered";
        } catch (error) {
          return error instanceof PiRpcRefusalError ? "refused" : "indeterminate";
        }
      };
      active.set(threadId, { stop, turnId, pending, child, steer: steerActiveTurn });

      const onEvent = (evt: PiEvent) => {
        appendNative(threadId, { dir: "in", source: "pi.rpc", msg: evt });
        switch (evt.type) {
          case "response": {
            // Resolve the echoed request id first (unique per steer);
            // fall back to the command name for the handshake-style call
            // sites, whose responses carry no id.
            const key = typeof evt.id === "string" && responseWaiters.has(evt.id) ? evt.id : evt.command;
            if (key && responseWaiters.has(key)) {
              const waiter = responseWaiters.get(key)!;
              responseWaiters.delete(key);
              clearTimeout(waiter.timer);
              if (evt.success) waiter.resolve(evt.data);
              else waiter.reject(new PiRpcRefusalError(`pi ${evt.command} failed`));
            }
            return;
          }
          case "message_update": {
            const e = evt.assistantMessageEvent;
            if (!e) return;
            if (e.type === "text_delta" && typeof e.delta === "string") {
              assistantText += e.delta;
              emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: e.delta });
            } else if (e.type === "thinking_delta" && typeof e.delta === "string") {
              emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "reasoning_text", delta: e.delta });
            }
            return;
          }
          case "tool_execution_start": {
            flushAssistantText();
            // pi-mcp-adapter's single `mcp` tool: the step names the server
            // and tool it ran (shared/mcp-gateway-call.ts), never "mcp".
            const gateway = readMcpGatewayCall(typeof evt.toolName === "string" ? evt.toolName : undefined, evt.args, mcpServerNames);
            const toolName = gateway?.kind === "tool" ? gateway.id : typeof evt.toolName === "string" ? evt.toolName : undefined;
            const args = gateway?.kind === "tool" ? gateway.args : evt.args;
            if (typeof evt.toolCallId === "string" && toolName) toolNames.set(evt.toolCallId, toolName);
            emit({
              ...base(threadId, turnId),
              type: "item.started",
              itemType: "tool",
              itemId: evt.toolCallId,
              title: String(toolName ?? "tool").slice(0, 80),
              summary: commandSummary(args),
              input: toolDetailPreview(args),
              ...filesField(writtenFilesFromToolInput(toolName, args)),
            });
            return;
          }
          case "tool_execution_end": {
            const toolName = (typeof evt.toolCallId === "string" ? toolNames.get(evt.toolCallId) : undefined)
              ?? (typeof evt.toolName === "string" ? evt.toolName : undefined);
            if (typeof evt.toolCallId === "string") toolNames.delete(evt.toolCallId);
            emit({
              ...base(threadId, turnId),
              type: "item.completed",
              itemType: "tool",
              itemId: evt.toolCallId,
              ok: !evt.isError,
              output: toolDetailPreview(evt.result),
              ...(evt.isError ? {} : cwToolResult(toolName, evt.result)),
            });
            return;
          }
          case "extension_ui_request": {
            // pi floods setWidget/setStatus for TUI bookkeeping; only
            // select/confirm/input are questions that wait for an answer.
            if (evt.method === "select" || evt.method === "confirm" || evt.method === "input") {
              flushAssistantText();
              const reqId = evt.id ?? newId();
              const isSelect = evt.method === "select";
              const isQuestion = isSelect || evt.method === "input";
              const selectOptions: string[] = isSelect && Array.isArray(evt.options)
                ? evt.options.filter((option): option is string => typeof option === "string") : [];
              const summary = String(evt.title ?? (isQuestion ? "pi has a question" : "pi wants confirmation")).slice(0, 200);
              const gatedTool = isQuestion ? undefined : piGatedMcpTool(evt.title, mcpServers);
              const gatedInput = gatedTool ? piGatedMcpInput(evt.message, gatedTool) : undefined;
              const searchedCall = gatedTool && gatedInput !== undefined ? piSearchedCall(gatedTool, gatedInput, searchedServers) : undefined;
              if (searchedCall?.refused) {
                // a wrapper that runs nothing named: refused, never a card
                send({ type: "extension_ui_response", id: reqId, cancelled: true });
                return;
              }
              const mcpTool = searchedCall?.mcpTool ?? gatedTool;
              const mcpInput = searchedCall?.input ?? gatedInput;
              // A select is a question with named options; the structured
              // card renders from it while the flat choices keep older
              // clients answering. An input has nothing to pick from and
              // stays the free-text question it always was.
              const question = isSelect
                ? (parseAskQuestions({
                    questions: [{ question: summary, options: selectOptions }],
                  }) ?? [])[0]
                : undefined;
              const choices = question?.options.length ? question.options.map((option) => option.label) : undefined;
              let timer: ReturnType<typeof setTimeout> | undefined;
              // Register BEFORE emitting: the harness may auto-approve from
              // inside its synchronous request.opened listener. Emitting first
              // made respondToRequest see no pending ask, return unavailable,
              // then fall back to a human card on every "Always allow" call.
              pending.set(reqId, (decision) => {
                if (timer) {
                  clearTimeout(timer);
                  askTimers.delete(timer);
                }
                if (decision.behavior === "deny") send({ type: "extension_ui_response", id: reqId, cancelled: true });
                else if (isQuestion) {
                  // Recover the picked label from a structured card's Q:/A:
                  // reply; a flat answer or typed text passes through
                  // verbatim (questionAnswersByQuestion's single-question
                  // fallback does exactly that).
                  const value = question
                    ? questionAnswersByQuestion(decision.message ?? "", [question])[question.question] ?? decision.message ?? ""
                    : decision.message ?? "";
                  // Display labels are capped/trimmed; pi expects the
                  // original option. Never guess if two normalize alike.
                  const matched = selectOptions.filter(option => parseChoices([option], 1)?.[0] === value);
                  send(matched.length > 1
                    ? { type: "extension_ui_response", id: reqId, cancelled: true }
                    : { type: "extension_ui_response", id: reqId, value: matched[0] ?? value });
                }
                else send({ type: "extension_ui_response", id: reqId, confirmed: true });
              });
              // The ask must never hold the turn forever: cancel it after 15
              // minutes. The pending.delete guard makes this a no-op once the
              // turn settled (settle clears pending) or a person answered.
              timer = setTimeout(() => {
                if (timer) askTimers.delete(timer);
                if (!pending.delete(reqId)) return;
                send({ type: "extension_ui_response", id: reqId, cancelled: true });
                emit({
                  ...base(threadId, turnId),
                  requestId: reqId,
                  type: "request.resolved",
                  behavior: "deny",
                  source: "timeout",
                });
              }, 15 * 60_000);
              askTimers.add(timer);
              timer.unref?.();
              emit({
                ...base(threadId, turnId),
                requestId: reqId,
                type: "request.opened",
                requestType: isQuestion ? "question" : "permission",
                tool: String(evt.title ?? "pi"),
                summary,
                ...(mcpTool ? { mcpTool, input: mcpInput } : {}),
                ...(choices ? { choices } : {}),
                ...(question ? { questions: [question] } : {}),
              });
            }
            return;
          }
          case "compaction_start":
          case "compaction_end":
          case "auto_compaction_start":
          case "auto_compaction_end": {
            // pi compaction (manual or automatic) summarizes older
            // messages, which can absorb the turn that carried this
            // session's standing prompt. Both events ride the RPC surface
            // for every compaction kind, so the moment either arrives the
            // receipt is dropped and the next turn re-establishes the full
            // prompt. The rest of the compacting turn may still answer
            // without its standing instructions; that single turn is the
            // unavoidable cost of summarizing history mid-session.
            if (sessionReady && sessionFile) {
              compactionObserved = true;
              deletePromptSplitReceipt("pi", JSON.stringify([threadId, sessionFile]));
            }
            return;
          }
          case "turn_end":
          {
            // a killed child can still flush one buffered frame after the
            // turn settled (the abort path's cancelled turn_end is the
            // common one); arming the grace timer then would leak it past
            // a turn that is already complete.
            if (settled) return;
            const sr = evt.message?.stopReason;
            // toolUse means pi ran a tool and auto-continues next turn to
            // answer — the run is not over, and the next turn_end carries
            // the real outcome.
            if (sr === "toolUse" || sr === "tool_use" || sr === "tool_calls") return;
            endStopReason = sr;
            endUsage = evt.usage ?? evt.message?.usage;
            endErrorMessage = evt.message?.errorMessage;
            // agent_end, not turn_end, closes the run: pi can schedule
            // post-run maintenance (overflow-recovery compaction) after
            // the final turn_end, and only the terminal agent_end proves
            // the session is done rewriting itself. The grace timer
            // settles a runtime that never sends agent_end at all.
            if (agentEndTimer) clearTimeout(agentEndTimer);
            agentEndTimer = setTimeout(finishRun, PI_AGENT_END_GRACE_MS);
            agentEndTimer.unref?.();
            return;
          }
          case "agent_end": {
            // Two dialects mark a non-terminal agent_end: upstream pi sets
            // willRetry: true when an automatic retry follows (overflow
            // recovery runs compaction and retries as a fresh run), and the
            // omp fork sets isTerminal: false while maintenance or async
            // delivery has more work scheduled. Either marker means the
            // session may still rewrite the turn that carried this
            // session's standing prompt — keep listening so those events
            // can drop the prompt-split receipt.
            if (evt.isTerminal === false || evt.willRetry === true) return;
            if (agentEndTimer) {
              clearTimeout(agentEndTimer);
              agentEndTimer = null;
            }
            finishRun();
            return;
          }
          case "agent_settled": {
            // upstream pi's explicit fully-settled guarantee: no automatic
            // retry, compaction retry, or queued continuation remains.
            // Usually settles one frame after the final agent_end already
            // did; kept as its own terminal signal so the driver never
            // depends on which dialect the configured cli speaks.
            if (agentEndTimer) {
              clearTimeout(agentEndTimer);
              agentEndTimer = null;
            }
            finishRun();
            return;
          }
          default:
            return;
        }
      };

      const chunks = new PiRpcChunks();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", piLineReader((line) => {
        const frame = decodePiFrame(line, chunks);
        if (!frame) return;
        try {
          onEvent(frame as unknown as PiEvent);
        } catch {
          /* skip a frame the event handler can't consume */
        }
      }));
      child.on("error", (err) => {
        const fail = describeSpawnFailure(err as NodeJS.ErrnoException, config.cli, turn.cwd);
        rejectWaiters(new Error(fail.message));
        emit({ ...base(threadId, turnId), type: "runtime.error", message: fail.message, setup: fail.setup });
        settle(false);
      });
      child.on("close", () => {
        // a clean close without a terminal event is a failed turn, never a hang
        const message = `pi process exited before replying${stderr.trim() ? `: ${stderr.trim().slice(-300)}` : ""}`;
        rejectWaiters(new Error(message));
        if (!settled) emit({ ...base(threadId, turnId), type: "runtime.error", message });
        settle(false);
      });

      emit({ ...base(threadId, turnId), type: "turn.started" });

      // handshake: resume the remembered session or start a fresh one. The
      // harness persists session.started.sessionId as the resumeCursor and
      // hands it back next turn, so that id IS the resume handle — pi's
      // sessionFile, which switch_session expects as `sessionPath`.
      const sessionPath = resumeCursor;
      let sessionFile = sessionPath;
      let sessionReady = false;
      if (standby) {
        sessionReady = true;
        standbySession = sessionFile;
        emit({ ...base(threadId, turnId), type: "session.started", sessionId: sessionFile, model: turn.model ?? null });
      } else try {
        // #1276: a compact turn's pi keeps its session (no --no-session), so a
        // fresh one already started a new session: a new_session would
        // replace it, and pi reloads every extension (and its MCP servers)
        // for the new one, about half a second per new conversation.
        const fresh = !sessionPath && turn.compactPrompt;
        // the pi started ahead moves to this folder: a new session written
        // for it, then switch_session (pi reloads the extension, which reads
        // this conversation's MCP servers)
        const aheadSession = ahead && turn.cwd ? writePiSession(ahead.sessionsRoot, turn.cwd) : null;
        const command = sessionPath || aheadSession ? "switch_session" : "new_session";
        const hsPromise = fresh && !aheadSession ? Promise.resolve(undefined) : awaitResponse(command);
        if (aheadSession) send({ type: "switch_session", sessionPath: aheadSession });
        else if (!fresh) send(sessionPath ? { type: "switch_session", sessionPath } : { type: "new_session" });
        const hs = (await hsPromise) as { sessionFile?: string; sessionId?: string } | undefined;
        if (aheadSession) sessionFile = aheadSession;
        if (hs?.sessionFile) sessionFile = hs.sessionFile;
        // #1276: pi answers new_session without the file; a compact turn
        // asks for it, so the next turn resumes this session (switch_session).
        if (!sessionFile && turn.compactPrompt) {
          try {
            const statePromise = awaitResponse("get_state");
            send({ type: "get_state" });
            const state = (await statePromise) as { sessionFile?: unknown } | undefined;
            if (typeof state?.sessionFile === "string" && state.sessionFile) sessionFile = state.sessionFile;
          } catch {
            // no file: the next turn replays, as before
          }
        }
        sessionReady = true;
        standbySession = sessionFile;
        emit({
          ...base(threadId, turnId),
          type: "session.started",
          sessionId: sessionFile ?? hs?.sessionId ?? null,
          model: turn.model ?? null,
        });
      } catch {
        // without a session we can still try a bare prompt; pi --no-session
        // accepts a prompt without an explicit session. Not a pi started
        // ahead: without its switch it has another folder and no MCP servers.
        if (ahead) {
          const message = "pi could not open this conversation; send the message again";
          emit({ ...base(threadId, turnId), type: "runtime.error", message });
          settle(false);
          throw new Error(message);
        }
      }

      // pin the chosen model (composite id or host::model inject → provider + modelId)
      const chosen = typeof turn.model === "string" ? splitPiModel(turn.model) : null;
      if (chosen) {
        try {
          const modelPromise = awaitResponse("set_model");
          send({ type: "set_model", provider: chosen.provider, modelId: chosen.modelId });
          await modelPromise;
        } catch (err) {
          // A local model pi cannot reach is never replaced by pi's default
          // model: that one bills a provider the person did not pick (on
          // 2026-10-27 a computer-shared model ran on an xAI key instead, and
          // its spent credits read as a usage limit).
          if (isLocalModelId(turn.model)) {
            const reason = String((err as Error)?.message ?? err).slice(0, 300);
            const message = `pi could not switch to the local model ${chosen.modelId}, so it did not answer on another model. Check that the computer that serves it is online and shares it, then try again. (pi said: "${reason}")`;
            emit({ ...base(threadId, turnId), type: "runtime.error", message });
            settle(false);
            throw new Error(message);
          }
          /* a hosted pick keeps going on the default model */
        }
      }

      // pin reasoning effort after the model (the supported level set is
      // model-dependent); a rejection keeps the engine default
      if (turn.effort) {
        try {
          const levelPromise = awaitResponse("set_thinking_level");
          send({ type: "set_thinking_level", level: piThinkingLevel(turn.effort) });
          await levelPromise;
        } catch {
          /* keep going on the engine default */
        }
      }

      if (scopeReadyPath) {
        let ready = false;
        try {
          const receipt = JSON.parse(readFileSync(scopeReadyPath, "utf8")) as { ok?: unknown; toolScope?: unknown };
          ready = receipt.ok === true && JSON.stringify(receipt.toolScope) === JSON.stringify(toolScope);
        } catch { /* Missing or malformed readiness is never a grant. */ }
        if (!ready) {
          const message = "Pi tool selection enforcement is unavailable. Update Pi and check the Sagax extension before retrying.";
          emit({ ...base(threadId, turnId), type: "runtime.error", message });
          settle(false);
          throw new Error(message);
        }
      }

      // The stable/volatile split: the full prompt rides only the turn that
      // establishes - or re-instructs, after a soul edit - this pi session,
      // which previously re-sent the whole system prompt on every turn and
      // let it accumulate in the session file once per turn. pi compacts
      // long sessions by summarizing older messages, which can absorb the
      // turn that carried the prompt, so the driver watches pi's
      // compaction events and drops the receipt the moment one arrives,
      // and re-anchors the full prompt every PI_PROMPT_RE_ANCHOR_TURNS
      // bare turns as a backstop for anything the events miss. Receipts
      // are durable because the session file outlives both the per-turn
      // child and this process. Without a session the prompt is the
      // model's only context, so that turn keeps the full block and writes
      // no receipt.
      const halves = promptHalves(turn);
      let message: string;
      let pendingReceipt: { key: string; receipt: PromptSplitReceipt } | null = null;
      if (halves.stable !== null && sessionReady && sessionFile) {
        const receiptKey = JSON.stringify([threadId, sessionFile]);
        const composed = splitSessionPrompt(
          halves.stable,
          halves.volatile,
          readPromptSplitReceipt("pi", receiptKey),
          turn.system,
          turn.text,
          Boolean(turn.mentionTurn),
          // #1276: on a local model the full prompt goes again
          // only after a compaction pi reports, not every few turns: a periodic
          // re-anchor cost a slow turn (12 to 21 s) for a backstop.
          turn.compactPrompt ? 0 : PI_PROMPT_RE_ANCHOR_TURNS,
          turn.systemVolatileSections,
        );
        message = composed.text;
        pendingReceipt = { key: receiptKey, receipt: composed.receipt };
      } else {
        message = turn.system ? `${turn.system}\n\n${turn.text}` : turn.text;
      }
      // #1276: what every new conversation of the bot shares (the stable half
      // and the volatile sections before the per-conversation ones, which
      // compactVolatileOrder puts last) becomes its own message
      // (pi-mcp-extension.ts), where a local server keeps a cache for them.
      if (turn.compactPrompt) message = markSharedPrompt(message, halves, turn.systemVolatileSections);
      // events cannot interleave with this synchronous stretch, so any
      // compaction recorded above already invalidated what compose read
      try {
        // pi answers the prompt with an authoritative response only after
        // preflight accepts it - and rejects it outright while a
        // compaction runs - so the receipt commits only after that
        // acceptance: a rejected or compacted-around send redelivers on
        // the next turn. The wait is long enough to survive a compaction
        // queue; a dead child rejects it immediately.
        // sendTurn still resolves once the prompt is written: a child that
        // dies before replying settles the turn through the close handler,
        // whose waiter sweep can precede this registration.
        const accepted = awaitResponse("prompt", 120_000);
        send({ type: "prompt", message, ...(images.length ? { images } : {}) });
        void accepted.then(
          () => {
            if (!pendingReceipt || compactionObserved) return;
            try {
              writePromptSplitReceipt("pi", pendingReceipt.key, pendingReceipt.receipt);
            } catch {
              /* an unwritten receipt only re-delivers the full prompt next turn */
            }
          },
          (err: Error) => {
            if (settled) return;
            emit({
              ...base(threadId, turnId),
              type: "runtime.error",
              message: String(err?.message ?? err).slice(0, 2_000),
            });
            settle(false);
          },
        );
      } catch (err) {
        emit({
          ...base(threadId, turnId),
          type: "runtime.error",
          message: String((err as Error)?.message ?? err).slice(0, 2_000),
        });
        settle(false);
      }

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      // Every pi-based instance probes at start: one engine start slot each.
      const version = await engineStartGate.run("probe", `${config.cli} --version`, () => new Promise<string | null>((resolve) => {
        const child = spawnCli(config.cli, ["--version"], {
          stdio: ["ignore", "pipe", "pipe"],
          env: piEnvironment({ ...process.env, ...input.environment }),
        });
        let out = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (c: string) => (out += c));
        const timer = setTimeout(() => {
          try {
            killCliTree(child);
          } catch {
            /* ignore */
          }
          resolve(null);
        }, 8000);
        timer.unref?.();
        child.on("error", () => {
          clearTimeout(timer);
          resolve(null);
        });
        child.on("close", () => {
          clearTimeout(timer);
          resolve(out.trim() || null);
        });
      }));
      if (!version) return { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };
      // pi manages its own credentials (~/.pi/agent/auth.json); there is no
      // separate sign-in step the harness can probe, so treat it as authed.
      return { state: "available", version, authenticated: true };
    };

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
      adapter: {
        provider: DRIVER_KIND,
        capabilities: {
          // model is set per turn via set_model before prompt
          sessionModelSwitch: "in-session",
          // Integrations arrive as stdio MCP servers mounted by the
          // pi-mcp-extension (pi core has no MCP client of its own).
          agentsMcp: true,
          computerMcp: true,
          phoneMcp: true,
          customMcp: true,
          browserMcp: true,
          dataMcp: true,
          // Host control (the user's real Mac) rides the pi-native permission
          // card (`ctx.ui.confirm` → extension_ui_request) gated in the
          // extension, so it is offered exactly when the other engines offer
          // it: enabled unless the bot is in full-auto.
          localComputerMcp: true,
          // Images ride pi's native RPC prompt as base64 content blocks, so a
          // vision model can inspect them without a separate file-read tool.
          images: true,
          nativeImageInput: true,
          // Reasoning effort pins pi's thinking level per turn (none → off).
          // xhigh/max only land on models that expose them; pi rejects an
          // unsupported level and the turn keeps the engine default.
          effortLevels: NATIVE_EFFORT_LEVELS,
          // The flags are added only when the turn sets withholdHostTools,
          // which an organization server always does for this capability.
          withholdsHostTools: true,
          // pi's RPC mode takes a mid-turn steer frame the runtime queues
          // into the running agent without aborting the current step.
          queueing: true,
        },
        sendTurn,
        // #1373: this engine keeps no copy of Ask, Edits or Auto (only Full
        // is read at launch). Every other call asks Sagax, which answers at
        // the live level, so a change applies to the next tool call as is.
        applyApprovalMode: async () => true,
        interruptTurn: async (threadId) => active.get(threadId)?.stop(),
        respondToRequest: async (threadId, requestId, decision) => {
          const entry = active.get(threadId);
          const answer = entry?.pending.get(requestId);
          if (!entry || !answer) return "unavailable";
          entry.pending.delete(requestId);
          answer({ behavior: decision.behavior, message: decision.message });
          emit({
            ...base(threadId, entry.turnId),
            requestId,
            type: "request.resolved",
            behavior: decision.behavior,
            source: "user",
          });
          return decision.behavior === "allow" ? "allowed-once" : decision.behavior === "answer" ? "answered" : "rejected";
        },
        steer: async (threadId, text, options) => {
          const entry = active.get(threadId);
          return entry?.steer ? await entry.steer(text, options?.steerId) : "refused";
        },
        hasSession: (threadId) => active.has(threadId),
        stopAll: async () => {
          for (const { stop } of active.values()) stop();
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      dispose: async () => {
        for (const { stop } of active.values()) stop();
        listeners.clear();
      },
    };
  },
};
