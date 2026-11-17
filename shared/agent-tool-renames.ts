// Sagax tools that were renamed. The old name stays a hidden alias: never
// listed, still callable, so a running conversation, a saved rule or a model
// that remembers it keeps working. No name here has a double underscore.

/** Old name to current name. */
export const RENAMED_AGENT_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  // #4439: a bot saves team memory itself; nothing proposes it any more
  propose_team_memory: "save_team_memory",
});

/** The current name of an agents tool, or the name itself when it was never renamed. */
export function currentAgentToolName(name: string): string {
  return Object.hasOwn(RENAMED_AGENT_TOOLS, name) ? RENAMED_AGENT_TOOLS[name]! : name;
}

/** A tool id as a rule names it (`agents__propose_team_memory`, or a bare
 * name), with a renamed Sagax tool read as its current name, so a rule
 * saved on the old name keeps covering the tool. Other servers' tools are
 * left as they are. */
export function currentRuleToolId(id: string): string {
  const split = id.indexOf("__");
  if (split === -1) return currentAgentToolName(id);
  const server = id.slice(0, split);
  return server.toLowerCase() === "agents" ? `${server}__${currentAgentToolName(id.slice(split + 2))}` : id;
}
