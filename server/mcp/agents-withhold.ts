// #2189: the part of the agents tool priority (agents-tool-priority.ts) that
// needs no agents catalog: what a gate withholds and logs. Kept apart so the
// gate (mcp-gate.ts), a process the engine starts for every mount, does not
// load the whole agents catalog before it can answer (#3623).

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
