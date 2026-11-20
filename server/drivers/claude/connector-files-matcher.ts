// #5140 (M-20261120-008): which tools the connector-files hook entry
// (claudeHookSettings, server/drivers/claude.ts) waits on: those whose
// binary results the engine saves on this server for a connector it holds
// itself. A Claude Code hook matcher is a pattern here, not a list of names.

/** Claude Code's own tool that reads an MCP resource: it saves a blob too. */
const READ_RESOURCE_TOOL = "ReadMcpResource(?:Tool)?$";

/** The account's claude.ai connectors (`mcp__claude_ai_<Name>__<tool>`)
 * and the engine's resource reads. */
export const CLAUDE_AI_TOOLS_MATCHER = `^(?:mcp__claude_ai_|${READ_RESOURCE_TOOL})`;

/** The same for a turn that also loads the engine's own MCP
 * configuration (the person's Claude Code servers, or a turn that is not
 * isolated): every MCP tool but those of the servers Sagax mounted itself
 * (`mounted`, the turn's --mcp-config names), which reach the engine
 * through Sagax and never leave a file of their own (#5138). */
export function engineConnectorToolsMatcher(mounted: readonly string[]): string {
  const names = [...new Set(mounted.map((name) => name.replace(/[^A-Za-z0-9_-]/g, "_")))].filter(Boolean);
  return names.length ? `^(?:mcp__(?!(?:${names.join("|")})__)|${READ_RESOURCE_TOOL})` : `^(?:mcp__|${READ_RESOURCE_TOOL})`;
}
