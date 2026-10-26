// Turning a bot's own MCP server into a gated one.
//
// Shared by every driver that mounts external MCP servers, so the rule about
// what a tool may put into a model's context is written once. The gate itself
// is mcp-gate.ts; the policy it applies is mcp-trim.ts.
import { join } from "node:path";
import { parseToolScope, type ToolScope } from "../shared/tool-scope.ts";

import { DATA_DIR } from "./config.ts";
import { DEFAULT_RESULT_BUDGET } from "./mcp-trim.ts";
import { REMOTE_MCP_CONFIG_ENV, remoteMcpSpec } from "./mcp-http.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

/** Characters of a single tool result allowed into context, or 0 to mount
 * bot servers directly as before. `SAGAX_MCP_RESULT_BUDGET=0` is the escape
 * hatch for a bot that genuinely needs whole payloads in the conversation. */
export function resultBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SAGAX_MCP_RESULT_BUDGET;
  if (raw === undefined || raw === "") return DEFAULT_RESULT_BUDGET;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_RESULT_BUDGET;
}

/** The budget for one bot-owned server: its own `resultBudget` (from the
 * MCP server editor; 0 = never trim), else the app-wide one above. A tool
 * that returns big structured documents needs more than the default; a
 * shopping search needs less. */
export function serverResultBudget(
  name: string,
  perServer: Readonly<Record<string, number>> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const own = perServer && Object.hasOwn(perServer, name) ? perServer[name] : undefined;
  if (typeof own === "number" && Number.isFinite(own) && own >= 0) return Math.floor(own);
  return resultBudget(env);
}

/** Whether `name` has a positive result limit of its own. Only then is an
 * unselected URL server gated: without one it keeps its native transport,
 * as it always has (gateServer's `gateRemote`). */
export function hasOwnResultBudget(name: string, perServer: Readonly<Record<string, number>> | undefined): boolean {
  const own = perServer && Object.hasOwn(perServer, name) ? perServer[name] : undefined;
  return typeof own === "number" && Number.isFinite(own) && own >= 1;
}

/** How a driver gates one MCP server of a turn. A server the person added
 * (`owned`) gets its own result limit (MCP server editor, Result size
 * limit), else the app-wide one; a URL server keeps its native connection
 * unless its own limit was set, which must then hold, so it is gated even
 * unselected. Anything else is left alone. */
export function customServerGate(
  name: string,
  owned: boolean,
  perServer: Readonly<Record<string, number>> | undefined,
  env?: NodeJS.ProcessEnv,
): { budget: number; gateRemote: boolean } {
  return {
    budget: owned ? serverResultBudget(name, perServer, env) : 0,
    gateRemote: owned && hasOwnResultBudget(name, perServer),
  };
}

/** Where a thread's oversized results are kept so the bot can read them back.
 * Under the app's data directory, not the user's project folder: these are
 * the harness's spill, and it sweeps them after a day. */
export function spillDir(threadId: string): string {
  return join(DATA_DIR, "tool-results", threadId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || "thread");
}

/** Where each gate writes its connector's tool-name report (advertised vs
 * registered, renames, failures), read by GET /api/mcp/tool-names. */
export function toolNameReportDir(): string {
  return join(DATA_DIR, "mcp-tool-names");
}

export interface StdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

/** What the remote proxy needs from the environment to reach the internet
 * the way the person's other tools do: their proxy and its certificates.
 * Some engines start MCP children with a bare environment (Codex keeps a
 * handful of names), so these travel in the proxy's own descriptor. */
const NETWORK_ENV = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"];
const PROXY_ENV = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

/** Never sent through a proxy: Node's env-proxy mode, unlike curl, does
 * not exempt this computer on its own, and a URL server on loopback (a
 * local tool, a test) is unreachable through a corporate proxy. Node
 * matches an IPv6 host in its bracketed form, so https://[::1] is exempt
 * only through "[::1]"; the bare "::1" is kept for tools that read it so. */
const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"];

/** The proxy's network settings for a server at `url`.
 *
 * Node's fetch ignores the proxy variables unless NODE_USE_ENV_PROXY is set,
 * and that switch is on only for an https:// server. On Node 24 (CI, the
 * Cloud image, Electron 43) a plain http:// request through an env proxy
 * hangs: it never reaches the proxy and ignores its own AbortSignal, so an
 * http:// server would never answer. An https:// request goes through the
 * proxy's CONNECT tunnel and works. For an http:// server the switch is
 * turned off ("0") whenever a proxy, or the switch itself, could otherwise
 * reach the child, since a gate or an engine may hand it this process's
 * environment; the proxy then sends that request to HTTP_PROXY itself
 * (plainHttpProxyFetch in mcp-http.ts), loopback and NO_PROXY excepted. */
function networkEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>, url: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of NETWORK_ENV) if (source[name]) env[name] = source[name];
  if (new URL(url).protocol !== "https:") {
    if (source.NODE_USE_ENV_PROXY || PROXY_ENV.some((name) => env[name])) env.NODE_USE_ENV_PROXY = "0";
  } else if (PROXY_ENV.some((name) => env[name])) {
    env.NODE_USE_ENV_PROXY = source.NODE_USE_ENV_PROXY || "1";
    // One list under both spellings, since either may be the one read.
    const bypass = [env.no_proxy, env.NO_PROXY].flatMap((list) => (list ?? "").split(",")).map((entry) => entry.trim()).filter(Boolean);
    const merged = [...new Set([...bypass, ...LOOPBACK])].join(",");
    env.NO_PROXY = merged;
    env.no_proxy = merged;
  }
  return env;
}

export interface StdioServerOptions {
  /** node flags the harness spawns its own helpers with */
  nodeEnv?: Record<string, string>;
  execPath?: string;
  /** where the proxy's network settings come from (default: this process) */
  sourceEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** For an engine that cannot search tools itself: a URL server with a big
   * catalog answers with search_tools, describe_tool and call_tool instead
   * (mcp-directory.ts). `name` is the server's configured name, the one tool
   * selections use; `toolScope` narrows what the directory can find and run.
   * A command server is mounted as it is. */
  directory?: { name: string; toolScope?: ToolScope };
  /** Engines that share one child environment (Codex): the proxy's settings
   * go in this private record, named SAGAX_REMOTE_MCP_CONFIG_<64 hex>, and
   * only the name reaches argv. */
  configEnvName?: string;
}

/** Use the existing remote client when an engine requires a stdio descriptor. */
export function mcpStdioServer(server: unknown, options: StdioServerOptions = {}): StdioServer | null {
  if (!server || typeof server !== "object" || Array.isArray(server)) return null;
  const spec = server as StdioServer;
  if (typeof spec.command === "string" && spec.command) return spec;
  const remote = remoteMcpSpec(server);
  if (!remote) return null;
  if (options.configEnvName !== undefined && !REMOTE_MCP_CONFIG_ENV.test(options.configEnvName)) {
    throw new Error("Invalid private MCP proxy configuration.");
  }
  let directory: string | undefined;
  if (options.directory) {
    // The proxy refuses to start on settings it cannot read; refuse here
    // first, where the caller can still say why.
    const scope = parseToolScope(options.directory.toolScope);
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(options.directory.name) || !scope.ok) throw new Error("Invalid MCP tool search configuration.");
    directory = JSON.stringify({ name: options.directory.name, ...(scope.scope ? { toolScope: scope.scope } : {}) });
  }
  const settings = {
    SAGAX_REMOTE_MCP_SERVER: JSON.stringify(remote),
    ...(directory ? { SAGAX_REMOTE_MCP_DIRECTORY: directory } : {}),
  };
  return {
    command: options.execPath ?? process.execPath,
    args: [SPAWNED_PROXIES.mcpRemote, ...(options.configEnvName ? ["--config-env", options.configEnvName] : [])],
    env: {
      ...options.nodeEnv,
      ...networkEnv(options.sourceEnv ?? process.env, remote.url),
      ...(options.configEnvName ? { [options.configEnvName]: JSON.stringify(settings) } : settings),
    },
  };
}

/** The gated form of one bot-owned server, or null to mount it unchanged.
 *
 * An explicit selection also wraps remote servers in the stdio facade.
 * Unrestricted remote servers keep their existing native transport.
 *
 * The upstream spec travels in the gate's `env`, which means it travels inside
 * the same 0600 MCP config file the driver already writes for exactly this
 * reason: a server's credentials must never reach argv, where `ps` shows them
 * to every process on the machine. */
export function gateServer(input: {
  name: string;
  server: unknown;
  threadId: string;
  budget: number;
  toolScope?: ToolScope;
  /** node flags the harness spawns its own helpers with */
  nodeEnv?: Record<string, string>;
  execPath?: string;
  /** Private per-mount configuration for engines that share one child env. */
  configEnvName?: string;
  /** The engine cannot search tools itself: a URL server's big catalog is
   * searched instead of listed (mcpStdioServer's `directory`), and the gate
   * checks call_tool against the tool it runs. */
  directory?: boolean;
  /** where a remote proxy's network settings come from (default: this process) */
  sourceEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** The engine skips tool names it cannot qualify (Grok: a second `__`, a
   * dot, a key over 256): register every tool under an admissible alias and
   * map calls back (mcp-tool-names.ts). Mounts the gate even without a
   * budget or a selection. */
  toolNames?: "grok";
  /** Sagax gates this server's calls itself (mcp-gate-approval.ts): every
   * call not in readOnly waits for an approval card. Mounts the gate always;
   * never returns null, so an approval-gated server can never run ungated. */
  approval?: { socket: string; token: string; readOnly: readonly string[] };
  /** Gate a URL server even without a selection: the person set a result
   * limit for this server (hasOwnResultBudget), so it must hold. */
  gateRemote?: boolean;
}): { command: string; args: string[]; env: Record<string, string> } | null {
  const { name, server, budget } = input;
  const parsed = parseToolScope(input.toolScope);
  if (!parsed.ok) throw new Error(parsed.error);
  const scoped = parsed.scope !== undefined;
  const aliased = input.toolNames === "grok";
  const approval = input.approval;
  if (approval && (!approval.socket || !approval.token)) throw new Error("An approval gate needs its socket and token.");
  if (budget <= 0 && !scoped && !aliased && !approval) return null;
  if (!scoped && !aliased && !approval && input.gateRemote !== true && remoteMcpSpec(server)) return null;
  // The directory is the remote proxy's; it sits inside the gate, which
  // knows to look through call_tool at the tool underneath.
  const directory = input.directory === true && remoteMcpSpec(server) !== undefined;
  const spec = mcpStdioServer(server, {
    nodeEnv: input.nodeEnv,
    execPath: input.execPath,
    sourceEnv: input.sourceEnv,
    ...(directory ? { directory: { name, ...(scoped ? { toolScope: parsed.scope } : {}) } } : {}),
  });
  if (!spec) {
    if (scoped) throw new Error("Tool selection requires a supported MCP server.");
    if (approval) throw new Error("Approval gating requires a supported MCP server.");
    return null;
  }
  const env = {
    SAGAX_GATE_NAME: name,
    SAGAX_GATE_UPSTREAM: JSON.stringify({ command: spec.command, args: spec.args ?? [], env: spec.env ?? {} }),
    SAGAX_GATE_SPILL_DIR: spillDir(input.threadId),
    SAGAX_GATE_BUDGET: String(budget),
    ...(scoped ? { SAGAX_GATE_TOOL_SCOPE: JSON.stringify(parsed.scope) } : {}),
    ...(directory ? { SAGAX_GATE_DIRECTORY: "1" } : {}),
    ...(aliased ? { SAGAX_GATE_TOOL_NAMES: "grok", SAGAX_GATE_REPORT_DIR: toolNameReportDir() } : {}),
    ...(approval ? {
      SAGAX_GATE_APPROVAL_SOCKET: approval.socket,
      SAGAX_GATE_APPROVAL_TOKEN: approval.token,
      SAGAX_GATE_READ_ONLY: JSON.stringify([...new Set(approval.readOnly)].sort()),
    } : {}),
    SAGAX_GATE_MISUSE_MODE: process.env.SAGAX_MISUSE_GUARDRAILS?.trim() || "shadow",
  };
  if (input.configEnvName && (!scoped || !/^SAGAX_GATE_CONFIG_[a-f0-9]{64}$/.test(input.configEnvName))) {
    throw new Error("Invalid private MCP gate configuration.");
  }
  return {
    command: input.execPath ?? process.execPath,
    args: [SPAWNED_PROXIES.mcpGate, ...(input.configEnvName ? ["--config-env", input.configEnvName] : [])],
    env: {
      ...input.nodeEnv,
      ...(input.configEnvName ? { [input.configEnvName]: JSON.stringify(env) } : env),
    },
  };
}
