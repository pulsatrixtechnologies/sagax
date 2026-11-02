/** MCP mount helpers for Codex app-server argv and env. */
import { createHash } from "node:crypto";
import type { McpServerSpec, StdioMcpSpec } from "../../contracts.ts";
import { USER_SANDBOX_MCP_NAME } from "../../user-sandbox-routing.ts";
import { AUTO_COMPUTER_MCP_NAME } from "../../auto-computer.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../../../shared/bot-workplace.ts";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";

/** A TOML inline table for a `-c key=value` override; JSON string quoting
 * is valid TOML basic-string quoting. */
export function tomlInlineTable(entries: Record<string, string>): string {
  return `{ ${Object.entries(entries).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(", ")} }`;
}

const renamedMcpServers = new Set<string>();
/** Logged once per name: the rename is deliberate, not a lost server. */
export function noteRenamedMcpServer(name: string, mountName: string): void {
  if (renamedMcpServers.has(name)) return;
  renamedMcpServers.add(name);
  console.error(`codex: MCP server ${JSON.stringify(name)} is also declared in Codex's own config.toml — mounted as ${JSON.stringify(mountName)} for this bot so the two do not merge`);
}

/** Sagax's own workplace proxies (server environment, desktop bridge,
 * computer_select, Pulsatrix Flow's compute) reach a driver through
 * integrations.custom, and each one
 * carries its own capability under the same variable names
 * (SAGAX_SANDBOX_TOKEN, SAGAX_TOOL_SERVER, ...). Codex runs every MCP server
 * from one app-server environment, so those names would collide, and the
 * reserved-name guard below refuses them outright. Such a server instead gets
 * its variables under a prefix of its own, forwarded by name only, and the
 * proxy restores the plain names at start (user-sandbox-proxy.ts). Only the
 * prefix and ELECTRON_RUN_AS_NODE (needed before the process starts, never
 * a secret) travel as values in argv. */
const SAGAX_WORKPLACE_PROXIES = new Set([USER_SANDBOX_MCP_NAME, AUTO_COMPUTER_MCP_NAME, DESKTOP_BRIDGE_MCP_NAME]);
/** Read by user-sandbox-proxy.ts (PROXY_ENV_PREFIX_VARIABLE there; the proxy
 * is a standalone script, so the name is spelled in both places). */
export const PROXY_ENV_PREFIX_VARIABLE = "SAGAX_PROXY_ENV_PREFIX";

export function isSagaxWorkplaceProxy(name: string, server: McpServerSpec): boolean {
  // A person's own MCP server command relayed to their server environment
  // (server/sandbox-stdio-mcp.ts) is the same proxy under the person's name.
  return !("url" in server) && (SAGAX_WORKPLACE_PROXIES.has(name) || server.env?.SAGAX_TOOL_SERVER === "sagax-stdio");
}

/** Perspicax profiles are harness-created mounts in integrations.custom,
 * not third-party commands. A name or environment marker alone proves nothing. */
export function isSagaxPerspicaxBridge(server: McpServerSpec): boolean {
  return !("url" in server) && server.command === process.execPath
    && server.args.length === 1 && server.args[0] === SPAWNED_PROXIES.perspicax
    && Boolean(server.env.SAGAX_PERSPICAX_PROFILE) && Boolean(server.env.SAGAX_PERSPICAX_TOKEN);
}

/** Codex has one parent environment for every mount. Keep each direct
 * profile's capability and identity under its final mount's own prefix;
 * the bridge restores them before reading its connection settings. */
export function isolatedPerspicaxBridge(name: string, server: StdioMcpSpec): { server: StdioMcpSpec; literal: Record<string, string> } {
  const stem = `SAGAX_MCP_ENV_${createHash("sha256").update(name).digest("hex").toUpperCase()}__`;
  const env: Record<string, string> = {};
  const literal: Record<string, string> = { [PROXY_ENV_PREFIX_VARIABLE]: stem };
  for (const [key, value] of Object.entries(server.env)) {
    if (key === "ELECTRON_RUN_AS_NODE") literal[key] = value;
    else env[`${stem}${key}`] = value;
  }
  return { server: { ...server, env }, literal };
}

export function mountSagaxWorkplaceProxy(
  appServerArgs: string[],
  env: Record<string, string | undefined>,
  name: string,
  server: StdioMcpSpec,
  /** Collects every variable name this mount writes into `env`. */
  written: Set<string> = new Set(),
): void {
  const prefix = `mcp_servers.${name}`;
  const stem = `SAGAX_MCP_ENV_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}__`;
  const forwarded: string[] = [];
  const literal: Record<string, string> = { [PROXY_ENV_PREFIX_VARIABLE]: stem };
  for (const [key, value] of Object.entries(server.env)) {
    if (key === "ELECTRON_RUN_AS_NODE") { literal[key] = value; continue; }
    env[`${stem}${key}`] = value;
    written.add(`${stem}${key}`);
    forwarded.push(`${stem}${key}`);
  }
  appServerArgs.push(
    "-c", `${prefix}.command=${JSON.stringify(server.command)}`,
    "-c", `${prefix}.args=${JSON.stringify(server.args)}`,
    "-c", `${prefix}.env=${tomlInlineTable(literal)}`,
    "-c", `${prefix}.env_vars=${JSON.stringify(forwarded)}`,
  );
}

/** Codex's default for one MCP server's tools (codex-rs #17843): "auto"
 * runs without asking only tools the server marks read-only, "approve" runs
 * every tool without asking, "prompt" asks for each call. */
export type McpApprovalMode = "approve" | "auto" | "prompt";

/** Every mount is a command Codex starts: URL servers arrive here already
 * behind Sagax's remote proxy (see scopedServer in sendTurn). */
export function mountMcpServer(
  appServerArgs: string[],
  env: Record<string, string | undefined>,
  name: string,
  server: StdioMcpSpec,
  approval: McpApprovalMode = "auto",
  /** Settings that are not secret, written into the mount's own `env`
   * table: its process gets them, the shell Codex runs commands in does not. */
  literalEnv: Record<string, string> = {},
  /** Collects every variable name this mount writes into `env`. */
  written: Set<string> = new Set(),
): void {
  const prefix = `mcp_servers.${name}`;
  Object.assign(env, server.env);
  for (const name of Object.keys(server.env)) written.add(name);
  appServerArgs.push(
    "-c", `${prefix}.command=${JSON.stringify(server.command)}`,
    "-c", `${prefix}.args=${JSON.stringify(server.args)}`,
    // Values stay in the child environment; argv contains names only so
    // credentials never appear in process listings or diagnostics.
    "-c", `${prefix}.env_vars=${JSON.stringify(Object.keys(server.env))}`,
  );
  if (Object.keys(literalEnv).length) appServerArgs.push("-c", `${prefix}.env=${tomlInlineTable(literalEnv)}`);
  // Harness-owned servers are pre-quieted; a user-configured server keeps
  // codex's on-request policy so its tool calls become approval cards.
  if (approval !== "prompt") appServerArgs.push("-c", `${prefix}.default_tools_approval_mode="${approval}"`);
}
