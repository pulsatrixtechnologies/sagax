/** Reviewed local reads exposed by the built-in agents MCP integration.
 * This exact catalog supplies MCP tool metadata only; names, prefixes, or
 * third-party annotations alone must never grant read access.
 * Session recall keeps its own-bot scope and may record a deduplicated access
 * disclosure in a room; it does not edit recalled messages or launch work.
 */
export const READ_ONLY_AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_bots",
  "list_team_setup",
  "list_shared_computers",
  "list_rooms",
  "list_threads",
  "check_delegation",
  "wait_delegation",
  "session_search",
  "session_read",
  "recall_topic",
  "tool_result_read",
  "list_routines",
  "list_waits",
  "skills_list",
  "workspace_read",
  "workspace_search",
  // sagax_help (server/self-knowledge/self-knowledge.ts): the built-in knowledge base.
  "sagax_help",
  // The agent-to-agent API's reads (server/agent-api.ts AGENT_TOOL_POLICY).
  "list_agents",
  "find_agents",
    "get_agent",
  "await_turn",
  "read_transcript",
  "read_transcript_page",
  "read_latest_page",
  "read_latest_page_with_threads",
  "read_transcript_cold",
  "read_transcript_attachment",
  "list_agent_models",
  "list_cloud_agents",
  "get_cloud_agent",
  "find_cloud_agent_by_pr",
  "cloud_agent_transcript",
  "list_cloud_agent_artifacts",
  // Claims (server/perspicax/perspicax-claims.ts): listing the live leases changes no
  // live lease (Perspicax only frees the expired ones as it lists).
  "claim_list",
  // Grok bridge (#2193): listing leases changes none.
  "bridge_list_leases",
  // Artifacts (server/artifacts/artifacts.ts): the bot's own saved widgets, settings only.
  "list_artifacts",
  // Connectors (server/routes/internal-connectors.ts, #3347): the speaker's own
  // connectors and their tools, as the registry holds them.
  "connectors",
]);

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const);

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOL_NAMES.has(name);
}

export function agentToolAnnotations(name: string): typeof READ_ONLY_ANNOTATIONS | undefined {
  return isReadOnlyAgentTool(name) ? READ_ONLY_ANNOTATIONS : undefined;
}
