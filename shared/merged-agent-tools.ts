// Sagax's own agents tools, listed by family (server/drivers/agents-merged.ts):
// where an engine is shown the whole catalog on every turn, the tools of one
// family are listed as one tool whose `tool` argument is the name of the tool to run,
// with that tool's own arguments beside it. The JSON sent on every turn is
// smaller, and nothing is lost: each action keeps its own description.
//
// A family call is read everywhere as the tool it runs (shared/searched-tool-call.ts
// readBridgeCall): the approval card and its rules, Always allow, the MCP guard,
// the misuse guardrails and the activity row see exactly the call a direct one
// would show them. The family tool itself is never pre-allowed.

/** Family tool name → the agents tools it lists, in this order. A family is
 * listed only where at least two of its tools are offered. */
export const MERGED_AGENT_TOOLS: Readonly<Record<string, readonly string[]>> = {
  cloud_agents: [
    "launch_cloud_agent", "cloud_agent_follow_up", "find_cloud_agent_by_pr", "list_cloud_agents", "get_cloud_agent",
    "cloud_agent_transcript", "list_cloud_agent_artifacts", "archive_cloud_agent", "cancel_cloud_agent",
  ],
  artifacts: ["save_artifact", "update_artifact", "list_artifacts", "delete_artifact"],
  // #1989: list_routines and run_routine stay listed by their own names and
  // always load (agents-catalog DEFERRED), so a bot that owns a routine can
  // check it without ToolSearch finding a merged family under another name.
  routines: ["propose_routine", "propose_routine_action"],
  conversation_history: ["session_search", "session_read"],
  workspace_files: ["workspace_read", "workspace_search"],
  rooms: ["create_room", "list_rooms", "post_to_room"],
  team_setup: ["propose_team_setup", "list_team_setup"],
  computer_sharing: ["shared_computer", "list_shared_computers"],
  terminals: ["offer_shell_terminal", "list_terminal_resources"],
  skills: ["skills_list", "skill_manage"],
};

/** One short line per family, before its actions. */
export const MERGED_AGENT_TOOL_INTROS: Readonly<Record<string, string>> = {
  cloud_agents: "Cloud coding agents on external providers.",
  artifacts: "The person's artifacts (saved widgets).",
  routines: "Routines: propose and change. Use list_routines and run_routine by name to list or run.",
  conversation_history: "Earlier conversations: search and read.",
  workspace_files: "The bot's workspace files: read and search.",
  rooms: "Rooms: create, list and post.",
  team_setup: "The team setup: propose and list.",
  computer_sharing: "Computers lent to this server.",
  terminals: "Shell terminals for the person.",
  skills: "Skills: list and manage.",
};

const FAMILY_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(MERGED_AGENT_TOOLS).flatMap(([family, tools]) => tools.map((tool) => [tool, family] as const)),
);

export const MERGED_ACTION = "tool";

/** The family a tool is listed in, if any. */
export function mergedFamilyOf(tool: string): string | undefined {
  return FAMILY_OF.get(tool);
}

export function isMergedAgentTool(name: string): boolean {
  return Object.hasOwn(MERGED_AGENT_TOOLS, name);
}

export function mergedRefusedText(family: string): string {
  return `${family} needs tool, the name of one of its tools (${(MERGED_AGENT_TOOLS[family] ?? []).join(", ")}), with that tool's own arguments beside it.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A family call (bare name), as the tool it runs and that tool's own
 * arguments; `refused` when it names no tool of the family. Null for any
 * other tool. */
export function readMergedCall(tool: string, input: unknown):
  | { kind: "call"; tool: string; arguments: Record<string, unknown> }
  | { kind: "refused"; reason: string }
  | null {
  if (!isMergedAgentTool(tool)) return null;
  const action = isRecord(input) && typeof input[MERGED_ACTION] === "string" ? input[MERGED_ACTION].trim() : "";
  if (!action || !MERGED_AGENT_TOOLS[tool]!.includes(action)) return { kind: "refused", reason: mergedRefusedText(tool) };
  const { [MERGED_ACTION]: _action, ...rest } = input as Record<string, unknown>;
  return { kind: "call", tool: action, arguments: rest };
}
