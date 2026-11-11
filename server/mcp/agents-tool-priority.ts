// #2189: one canonical bare tool name across mounted MCP servers.
//
// When the agents server and an account connector (or any other MCP server)
// both advertise the same bare tool name (send_prompt, api_search, flow_action,
// …), the agents catalog wins. The connector's copy is withheld from
// tools/list and refused on tools/call; the call is never renamed with an
// added "__". Drivers pass the agents catalog names into the gate (or filter
// the chat-completions catalog) whenever agents is mounted for the turn.
import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";

// What the gate reads lives apart from the agents catalog, so a gate process
// does not load the whole catalog to start (#3623).
export { filterToolsPreferringAgents, parseAgentsWithhold, resolvedServerLog, withholdForConnector } from "./agents-withhold.ts";

/** Bare tool names the agents server lists for this turn's env. Empty when
 * agents is not mounted. Never invents a name and never adds "__". */
export function agentsPreferredToolNames(agentsEnv: NodeJS.ProcessEnv | Record<string, string> | undefined): string[] {
  if (!agentsEnv) return [];
  return availableTools(catalogProfileFromEnv(agentsEnv))
    .map((tool) => tool.name)
    .filter((name) => typeof name === "string" && name.length > 0 && !name.includes("__"));
}
