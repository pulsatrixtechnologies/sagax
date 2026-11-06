// #2189: one canonical bare tool name across mounted MCP servers.
//
// When the agents server and an account connector (or any other MCP server)
// both advertise the same bare tool name (send_prompt, api_search, flow_action,
// …), the agents catalog wins. The connector's copy is withheld from
// tools/list and refused on tools/call; the call is never renamed with an
// added "__". Drivers pass the agents catalog names into the gate (or filter
// the chat-completions catalog) whenever agents is mounted for the turn.
import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";

/** Bare tool names the agents server lists for this turn's env. Empty when
 * agents is not mounted. Never invents a name and never adds "__". */
export function agentsPreferredToolNames(agentsEnv: NodeJS.ProcessEnv | Record<string, string> | undefined): string[] {
  if (!agentsEnv) return [];
  return availableTools(catalogProfileFromEnv(agentsEnv))
    .map((tool) => tool.name)
    .filter((name) => typeof name === "string" && name.length > 0 && !name.includes("__"));
}

/** Names to withhold on a non-agents mount when agents is also mounted. */
export function withholdForConnector(server: string, agentsPreferred: readonly string[]): string[] {
  if (server === "agents" || agentsPreferred.length === 0) return [];
  return [...new Set(agentsPreferred)].filter((name) => name.length > 0 && !name.includes("__")).sort();
}

/** Drop tools whose bare name agents already owns. Directory tools stay so
 * search_tools can still describe the rest of the connector. */
export function filterToolsPreferringAgents<T extends { name: string }>(
  tools: readonly T[],
  withheld: ReadonlySet<string> | readonly string[],
): { tools: T[]; withheld: string[] }
{
  const deny = withheld instanceof Set ? withheld : new Set(withheld);
  if (!deny.size) return { tools: [...tools], withheld: [] };
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const tool of tools) {
    if (deny.has(tool.name)) dropped.push(tool.name);
    else kept.push(tool);
  }
  return { tools: kept, withheld: dropped.sort() };
}

/** Parse the gate's withhold list (JSON array of bare names). */
export function parseAgentsWithhold(raw: string | undefined): Set<string> {
  if (raw === undefined || raw === "") return new Set();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((name): name is string => typeof name === "string" && name.length > 0 && !name.includes("__")));
  } catch {
    return new Set();
  }
}

/** One log line per tools/call: which server resolved the bare tool name. */
export function resolvedServerLog(server: string, tool: string): string {
  return `mcp-tool: resolved ${tool} via server ${server}\n`;
}
