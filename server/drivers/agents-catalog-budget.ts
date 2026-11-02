// Catalog budget strategy for Sagax agents tools (#1703).
//
// Default listing: the full catalog. Grok, Codex and Pi discover tools by
// name from tools/list (#1314); hiding one without a discovery tool would
// make it unreachable.
//
// Lazy paths already in production (keep every tool reachable):
//   - Claude: deferred rare tools (SAGAX_DEFER_RARE_TOOLS, tool search)
//   - Claude compact: find_tool / use_tool (#1374) and compact core (#1276)
//   - Codex / Claude: merged family tools (SAGAX_MERGED_TOOLS)
//   - Chat MCP aggregate: 128-tool deferral (tool_search / tool_call)
//
// Growth path (#1703): grouped lazy loading via SAGAX_CATALOG_GROUPS=1.
// The model is shown the chat-turn core plus list_tool_groups,
// load_tool_group and use_tool. Every other catalog tool stays findable by
// group and callable through use_tool (same checks and approvals as a
// direct listing). Prefer this when a profile approaches the soft ceiling,
// rather than shortening descriptions again.
//
// Measured provider limits (2026-11-01):
//   - Tool count: 128 (Grok, OpenAI-compat, Groq, Mistral, Cerebras, MiniMax;
//     same bound as server/drivers/chat-mcp-tools.ts DEFAULT_TOOL_LIMIT)
//   - Per-server MCP catalog bytes: 1 MiB (CATALOG_BYTES there)
//   - Agents soft ceiling: 150_000 UTF-8 bytes for a tools/list result.
//     Deliberate raise above the ~97 KB baselines that forced description
//     cuts in #1655, #1649 and #1689. Still far under 1 MiB.
import { COMPACT_CORE_AGENT_TOOL_NAMES } from "./agents-catalog.ts";
import { isOpenApiTool } from "../openapi-tools.ts";
import { BRIDGE_USE_TOOL } from "../../shared/searched-tool-call.ts";

/** Most tools a chat-completions provider takes in one request. */
export const AGENTS_CATALOG_TOOL_COUNT_LIMIT = 128;

/** Soft UTF-8 byte ceiling for an agents tools/list result (#1703). */
export const AGENTS_CATALOG_BYTES_SOFT_CEILING = 150_000;

/** Accidental-growth ratchet around BUDGET_BASELINE (agents-catalog-wire). */
export const AGENTS_CATALOG_BUDGET_TOLERANCE = 0.02;

export interface CatalogMargin {
  profile: string;
  bytes: number;
  tools: number;
  baseline: number;
  /** Bytes left before baseline * (1 + tolerance). */
  headroomToBaselineCap: number;
  /** Bytes left before the soft ceiling. */
  headroomToSoftCeiling: number;
  /** Tool slots left before the provider count limit. */
  headroomToToolLimit: number;
}

export function catalogMargin(input: {
  profile: string;
  bytes: number;
  tools: number;
  baseline: number;
  softCeiling?: number;
  toolLimit?: number;
  tolerance?: number;
}): CatalogMargin {
  const softCeiling = input.softCeiling ?? AGENTS_CATALOG_BYTES_SOFT_CEILING;
  const toolLimit = input.toolLimit ?? AGENTS_CATALOG_TOOL_COUNT_LIMIT;
  const tolerance = input.tolerance ?? AGENTS_CATALOG_BUDGET_TOLERANCE;
  const baselineCap = Math.floor(input.baseline * (1 + tolerance));
  return {
    profile: input.profile,
    bytes: input.bytes,
    tools: input.tools,
    baseline: input.baseline,
    headroomToBaselineCap: baselineCap - input.bytes,
    headroomToSoftCeiling: softCeiling - input.bytes,
    headroomToToolLimit: toolLimit - input.tools,
  };
}

export function formatCatalogMargin(row: CatalogMargin): string {
  return [
    row.profile,
    `bytes=${row.bytes}`,
    `tools=${row.tools}`,
    `baseline=${row.baseline}`,
    `headroom_baseline_cap=${row.headroomToBaselineCap}`,
    `headroom_soft_ceiling=${row.headroomToSoftCeiling}`,
    `headroom_tool_limit=${row.headroomToToolLimit}`,
  ].join(" ");
}

/** One named group of rare or secondary agents tools. */
export interface AgentToolGroup {
  id: string;
  title: string;
  /** Tool names that belong in this group when offered on the turn. */
  tools: readonly string[];
}

/**
 * Groups for lazy catalog loading (#1703). Every deferred or secondary tool
 * of the agents catalog sits in exactly one group. Core chat-turn tools stay
 * listed whole and are not grouped.
 */
export const AGENT_TOOL_GROUPS: readonly AgentToolGroup[] = [
  {
    id: "routines",
    title: "Routines and schedules",
    tools: ["propose_routine", "propose_routine_action", "list_routines", "run_routine", "wait_until", "list_waits", "cancel_wait"],
  },
  {
    id: "team",
    title: "Team, bots, rooms and profile",
    tools: [
      "propose_team_setup", "list_team_setup", "propose_profile", "propose_model", "propose_rule",
      "propose_bot_deletion", "archive_bot", "create_bot", "create_room", "manage_room",
      "propose_team_memory", "nudge_person", "retry_thread", "start_thread",
    ],
  },
  {
    id: "pages",
    title: "Published pages and live HTML",
    tools: ["propose_page", "page_comments", "show_html", "update_html"],
  },
  {
    id: "cloud_agents",
    title: "Cloud coding agents",
    tools: [
      "launch_cloud_agent", "list_cloud_agents", "get_cloud_agent", "cancel_cloud_agent",
      "archive_cloud_agent", "cloud_agent_follow_up", "cloud_agent_transcript",
      "find_cloud_agent_by_pr", "list_cloud_agent_artifacts",
    ],
  },
  {
    id: "artifacts",
    title: "Artifacts the bot keeps",
    tools: ["save_artifact", "update_artifact", "delete_artifact", "list_artifacts"],
  },
  {
    id: "settings",
    title: "Settings, help, skills and connectors",
    tools: [
      "manage_settings", "sagax_settings", "manage_pairing", "sagax_approvals", "sagax_help",
      "open_connector_setup", "add_mcp_server", "skill_manage", "skills_list",
      "rules_update", "docs_update", "resource_usage", "offer_shell_terminal",
      "list_terminal_resources", "request_login",
    ],
  },
  {
    id: "transcripts",
    title: "Transcripts, workspace and threads",
    tools: [
      "read_transcript", "read_transcript_cold", "read_transcript_page",
      "read_latest_page", "read_latest_page_with_threads",
      "workspace_read", "workspace_search", "session_read", "close_thread", "list_threads",
      "recall_topic",
    ],
  },
  {
    id: "computers",
    title: "Shared computers and remote sessions",
    tools: [
      "shared_computer", "list_shared_computers", "vm_exec",
      "publish_remote_session", "remote_session_snapshot", "remote_session_exec",
    ],
  },
  {
    id: "agent_api",
    title: "Agent-to-agent API",
    tools: [
      "find_agents", "get_agent", "list_agents", "send_prompt", "await_turn",
      "create_agent", "delete_agent", "run_with_engine",
    ],
  },
  {
    id: "phone",
    title: "Phone, meetings and outbound calls",
    tools: ["phone_tool", "place_phone_call", "join_meeting", "end_call"],
  },
  {
    id: "rooms",
    title: "Posts into rooms from a direct chat",
    tools: ["list_rooms", "post_to_room"],
  },
  {
    id: "extras",
    title: "Cards, tasks, voice notes, video and shapes",
    tools: [
      "ask_choice", "create_options_card", "task_list", "send_voice_note",
      "make_video", "generate_shape_avatar", "remove_reaction",
      "connect_github", "sagax_web_search", "vault_http_request",
      "group_memory_update",
    ],
  },
  {
    id: "perspicax",
    title: "Perspicax gateway, memory, flow and remote support",
    tools: [
      "memory_recall", "memory_search", "memory_write", "memory_propose", "memory_forget",
      "memory_feedback", "api_list", "api_search", "api_describe", "api_result_query",
      "api_lookup", "api_plan", "api_upload", "api_reload", "identity",
      "flow", "flow_action", "remote_support_open", "remote_support_status",
      "remote_support_close", "review_write",
      "claim", "claim_list", "claim_release", "claim_renew",
    ],
  },
];

const GROUP_BY_TOOL = new Map<string, string>();
for (const group of AGENT_TOOL_GROUPS) {
  for (const name of group.tools) {
    if (GROUP_BY_TOOL.has(name)) throw new Error(`agents catalog group: ${name} is in more than one group`);
    GROUP_BY_TOOL.set(name, group.id);
  }
}

/** Group id for a tool name, if it is grouped (core tools return undefined). */
export function agentToolGroupOf(name: string): string | undefined {
  if (GROUP_BY_TOOL.has(name)) return GROUP_BY_TOOL.get(name);
  if (isOpenApiTool(name)) return "openapi";
  return undefined;
}

export const LIST_TOOL_GROUPS = "list_tool_groups";
export const LOAD_TOOL_GROUP = "load_tool_group";

const GROUP_META_TOOLS: ReadonlySet<string> = new Set([LIST_TOOL_GROUPS, LOAD_TOOL_GROUP, BRIDGE_USE_TOOL]);

export function catalogGroupsOn(env: Record<string, string | undefined>): boolean {
  return env.SAGAX_CATALOG_GROUPS === "1";
}

export function catalogGroupDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  const ids = [...AGENT_TOOL_GROUPS.map((group) => group.id), "openapi"];
  return [
    {
      name: LIST_TOOL_GROUPS,
      description:
        "List the Sagax tool groups that are not listed by name on this turn. Each group has an id, a title and the tool names it holds. Call load_tool_group with one id to get each tool's description and arguments, then call use_tool with one name.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: LOAD_TOOL_GROUP,
      description:
        "Load one Sagax tool group by id from list_tool_groups. Returns each tool's name, description and arguments (inputSchema). Then call use_tool with one name and arguments that follow that schema.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: `A group id from list_tool_groups (for example ${ids.slice(0, 4).join(", ")}, openapi when the person pasted an OpenAPI document).` },
        },
        required: ["id"],
      },
    },
    {
      name: BRIDGE_USE_TOOL,
      description:
        "Call one Sagax catalog tool by the name load_tool_group (or find_tool) returned, with that tool's arguments as described.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
        required: ["name"],
      },
    },
  ];
}

export interface CatalogGroupTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

/** Tools listed whole under SAGAX_CATALOG_GROUPS=1: the chat-turn core, plus
 * any name the caller pins. Everything else is behind the group tools. */
export function catalogGroupListed(
  name: string,
  pinned: ReadonlySet<string> = new Set(),
): boolean {
  if (GROUP_META_TOOLS.has(name) || pinned.has(name)) return true;
  return COMPACT_CORE_AGENT_TOOL_NAMES.has(name);
}

/** Replace the full listing with core tools plus group discovery tools. */
export function applyCatalogGroups<T extends CatalogGroupTool>(
  tools: readonly T[],
  env: Record<string, string | undefined>,
  pinned: ReadonlySet<string> = new Set(),
): readonly CatalogGroupTool[] {
  if (!catalogGroupsOn(env)) return tools;
  const listed = tools
    .filter((tool) => catalogGroupListed(tool.name, pinned))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...listed, ...catalogGroupDefinitions()];
}

export function listOfferedToolGroups(tools: readonly CatalogGroupTool[]): {
  groups: Array<{ id: string; title: string; tools: string[] }>;
} {
  const offered = new Set(tools.map((tool) => tool.name));
  const groups = AGENT_TOOL_GROUPS
    .map((group) => ({
      id: group.id,
      title: group.title,
      tools: group.tools.filter((name) => offered.has(name)),
    }))
    .filter((group) => group.tools.length > 0);
  const openapi = tools.filter((tool) => isOpenApiTool(tool.name)).map((tool) => tool.name).sort();
  if (openapi.length) {
    groups.push({ id: "openapi", title: "The person's own OpenAPI operations", tools: openapi });
  }
  return { groups };
}

function toolsOfGroup(tools: readonly CatalogGroupTool[], id: string): CatalogGroupTool[] | { error: string } {
  if (id === "openapi") {
    const loaded = tools.filter((tool) => isOpenApiTool(tool.name));
    if (!loaded.length) return { error: "Tool group openapi has no tools on this turn." };
    return loaded;
  }
  const group = AGENT_TOOL_GROUPS.find((entry) => entry.id === id);
  if (!group) {
    const known = [...AGENT_TOOL_GROUPS.map((entry) => entry.id), "openapi"].join(", ");
    return { error: `Unknown tool group: ${id}. Known ids: ${known}.` };
  }
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const loaded = group.tools
    .map((name) => byName.get(name))
    .filter((tool): tool is CatalogGroupTool => Boolean(tool));
  if (!loaded.length) return { error: `Tool group ${id} has no tools on this turn.` };
  return loaded;
}

export function loadOfferedToolGroup(
  tools: readonly CatalogGroupTool[],
  id: string,
): { id: string; title: string; tools: Array<{ name: string; description: string; inputSchema: unknown; annotations?: unknown }> } | { error: string } {
  const loaded = toolsOfGroup(tools, id);
  if ("error" in loaded) return loaded;
  const title = id === "openapi"
    ? "The person's own OpenAPI operations"
    : AGENT_TOOL_GROUPS.find((entry) => entry.id === id)!.title;
  return {
    id,
    title,
    tools: loaded.map((tool) => ({
      name: tool.name,
      description: (tool.description ?? "").replace(/\s+/g, " ").trim(),
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
    })),
  };
}

/** What the agents proxy does with one tools/call when groups mode is on. */
export function routeGroupCall(
  tools: readonly CatalogGroupTool[],
  name: string,
  args: unknown,
):
  | { kind: "answer"; text: string; isError: boolean }
  | { kind: "call"; name: string; arguments: unknown }
  | { kind: "pass" } {
  if (name === LIST_TOOL_GROUPS) {
    return { kind: "answer", text: JSON.stringify(listOfferedToolGroups(tools)), isError: false };
  }
  if (name === LOAD_TOOL_GROUP) {
    const record = args && typeof args === "object" && !Array.isArray(args) ? args as { id?: unknown } : {};
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const loaded = loadOfferedToolGroup(tools, id);
    if ("error" in loaded) return { kind: "answer", text: loaded.error, isError: true };
    return { kind: "answer", text: JSON.stringify(loaded), isError: false };
  }
  return { kind: "pass" };
}

/** Every non-core tool offered on a turn must sit in a group, so groups mode
 * cannot hide one without a discovery path. */
export function ungroupedOfferedTools(tools: readonly { name: string }[]): string[] {
  return tools
    .map((tool) => tool.name)
    .filter((name) => !COMPACT_CORE_AGENT_TOOL_NAMES.has(name) && !GROUP_META_TOOLS.has(name) && !agentToolGroupOf(name))
    .sort();
}
