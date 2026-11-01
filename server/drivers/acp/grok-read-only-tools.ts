// Read-only Sagax tools that skip Grok's auto-mode safety check.
//
// In `--permission-mode auto`, Grok runs its own classifier before every MCP
// tool call. Measured on the production server (2026-10-11): 4-7 s (up to 17 s)
// between Grok choosing a tool and the tool running, for tools that answer in
// under 0.5 s. A local A/B on grok 1.0.50 showed the same call taking 8.2-11.7 s
// in auto mode and 4.8-5.2 s with a matching `--allow MCPTool(...)` rule,
// because allow rules are checked before the classifier ("How a tool call is
// authorized", Grok docs 22-permissions-and-safety.md).
//
// Only tools that are reviewed as read-only get a rule, by exact name, on
// servers Sagax itself spawns:
// - the built-in agents server: READ_ONLY_AGENT_TOOL_NAMES, the same reviewed
//   catalog that sets their MCP readOnlyHint annotations;
// - Perspicax bridges (the harness-held proxy, identified by its exact
//   script path): the explicit list below;
// Third-party servers, names, prefixes and annotations never grant a rule.
// Everything else (writes, actions, sends, approvals, commands, unknown
// tools) keeps the classifier and its cards unchanged.
import type { McpServerSpec } from "../../contracts.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../../agent-tool-policy.ts";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";

/** Permission vocabulary only: schemas and computation are served by the
 * active signed Flow pack in Perspicax. No local compute server. */
export const PERSPICAX_FLOW_COMPUTE_TOOLS = [
  "flow_free_slots", "flow_time_block", "flow_overlaps", "flow_stats",
  "flow_age_buckets", "flow_group_units", "flow_filter", "flow_member_load",
] as const;

/** Perspicax connector tools reviewed as read-only (2026-10-11). Never
 * add cw_psa__write/action, memory_write/forget/promote, memory_save/remove/
 * suggestions, sagax_send/approve/
 * nudge, flow_action, or anything whose effect depends on input. */
export const PERSPICAX_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "memory_recall",
  "memory_search",
  // The simplified memory model (Perspicax docs/design/memory-v2.md): its
  // schema is query, place, tags and limit; it reads and never writes.
  "memory_find",
  "api_search",
  "api_describe",
  "api_result_query",
  "cw_psa__query",
  "sagax_bots",
  "sagax_thread",
  "work_search",
  "work_check",
  // Pulsatrix Flow's read surface: its schema admits only command
  // "catalog" or "describe" (additionalProperties false). Running an action
  // is flow_action, which always asks.
  "flow",
  ...PERSPICAX_FLOW_COMPUTE_TOOLS,
]);

/** A server name that is safe inside a rule: no glob or rule syntax. */
const SAFE_SERVER = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

type Integrations = { agents?: unknown; custom?: Record<string, McpServerSpec> } | undefined;

/** Whether a custom server is the harness's own Perspicax bridge. */
export function isPerspicaxBridge(server: McpServerSpec | undefined, bridgePath: string = SPAWNED_PROXIES.perspicax): boolean {
  if (!server || "url" in server) return false;
  const spec = server as { command?: unknown; args?: unknown; env?: Record<string, unknown> };
  return Array.isArray(spec.args) && spec.args[0] === bridgePath
    && typeof spec.env?.SAGAX_PERSPICAX_PROFILE === "string" && spec.env.SAGAX_PERSPICAX_PROFILE !== "";
}

/** Grok's admissible alias of a reviewed tool name (`_` runs -> `_`). */
function grokAlias(tool: string): string {
  return tool.replace(/_{2,}/g, "_");
}

/** The `--allow` rules for this turn's read-only tools, sorted and unique. */
export function grokReadOnlyAllowRules(integrations: Integrations, bridgePath?: string): string[] {
  const names = new Set<string>();
  if (integrations?.agents) {
    for (const tool of READ_ONLY_AGENT_TOOL_NAMES) names.add(`agents__${tool}`);
  }
  for (const [server, spec] of Object.entries(integrations?.custom ?? {})) {
    // a custom entry cannot stand in for the built-in agents server
    if (server === "agents" || !SAFE_SERVER.test(server)) continue;
    if (!isPerspicaxBridge(spec, bridgePath)) continue;
    for (const tool of PERSPICAX_READ_ONLY_TOOLS) {
      names.add(`${server}__${tool}`);
      // Grok cannot name a tool with a second `__`; Sagax's MCP gate
      // registers it under its alias with `_` runs collapsed (cw_psa__query
      // -> cw_psa_query, mcp-tool-names.ts), so the reviewed tool keeps its
      // rule under that name. The Perspicax catalog has no tool of its own
      // named like an alias.
      if (tool.includes("__")) names.add(`${server}__${grokAlias(tool)}`);
    }
  }
  return [...names].sort().map((name) => `MCPTool(${name})`);
}
