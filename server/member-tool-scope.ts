// Which built-in Sagax tools a member's bot runs on an organization server
// without an organization admin (JC, 2026-10-08).
//
// The admin gate (memberBotAdminApproval in ./engine-access.ts) exists
// because every bot shares one container, one user and one HOME: a shell
// command, a file outside the bot's own workspace or a new local MCP server
// is as good as a command on the server. The built-in agents tools below do
// not touch the host: each one is served by a Sagax route that already
// checks who the bot is, who it speaks for and what it may reach (its own
// bots, threads, rooms, routines, memory and skills, and the bots shared
// with its person). Gating them behind an admin blocked a member's bot from
// answering "which bots do you see". They now follow the member's own
// approval level for their own bot, as any owner's tool does.
//
// The rule is a reviewed list, never a prefix or a name pattern: a tool
// added to the agents catalog is host-level (admin gate) until it is
// classified here. member-tool-scope.test.ts fails on an unclassified tool.

import { READ_ONLY_AGENT_TOOL_NAMES } from "./agent-tool-policy.ts";

/** Why an agents tool stays inside the member's own scope. */
export type MemberToolFamily =
  /** reads of the bot's own team, threads, routines, skills, sessions */
  | "read"
  /** talking to the bot's own teammates, rooms and threads, or to its person */
  | "conversation"
  /** the bot's own memory and its room's shared memory */
  | "memory"
  /** the bot's own setup: proposals its person confirms, its skills, its rooms */
  | "own-setup";

const READ = Object.fromEntries([...READ_ONLY_AGENT_TOOL_NAMES, "list_room_targets"].map((name) => [name, "read" as const]));

/** The agents tools a member's bot runs under its own approval level. */
export const MEMBER_OWN_SCOPE_AGENT_TOOLS: Readonly<Record<string, MemberToolFamily>> = Object.freeze({
  ...READ,
  ask_bot: "conversation",
  send_to_bot: "conversation",
  delegate_bot: "conversation",
  coordinate_bots: "conversation",
  post_to_room: "conversation",
  react_to_message: "conversation",
  remove_reaction: "conversation",
  start_thread: "conversation",
  route_message: "conversation",
  close_thread: "conversation",
  retry_thread: "conversation",
  create_options_card: "conversation",
  // the person's own rights decide through act; a nudge is rate limited
  run_routine: "conversation",
  answer_approval: "conversation",
  nudge_person: "conversation",
  // Perspicax gateway tools (PERSPICAX_TOOLS): Perspicax applies the person's
  // grants; the admin ones (api_reload, review_write) are host level below
  memory_recall: "read", memory_search: "read", memory_feedback: "read",
  memory_write: "memory", memory_propose: "memory", memory_forget: "memory",
  api_list: "read", api_search: "read", api_describe: "read", api_lookup: "read",
  api_plan: "read", api_result_query: "read", identity: "read", flow: "read",
  api_upload: "conversation", flow_action: "conversation",
  remote_support_open: "conversation", remote_support_status: "conversation", remote_support_close: "conversation",
  // chat widgets (agents-widget-tools.ts): a card in the member's own conversation
  check_widget: "read",
  show_widget: "conversation",
  update_widget: "conversation",
  // artifacts (agents-artifact-tools.ts): the bot's own saved widgets; a
  // source runs alone only when it needs no approval (artifact-refresh.ts)
  save_artifact: "conversation",
  update_artifact: "conversation",
  list_artifacts: "read",
  delete_artifact: "conversation",
  // a page proposal: a card in the member's own conversation; publishing is theirs
  propose_page: "conversation",
  // a phone call: a card in the member's own conversation, through their own Twilio profile
  place_phone_call: "conversation",
  send_voice_note: "conversation",
  end_call: "conversation",
  request_credential: "conversation",
  request_login: "conversation",
  // a sign-in card in the member's own conversation, for their own engine account
  open_connector_setup: "conversation",
  // claims (perspicax-claims.ts): a lease in Perspicax held by this bot for
  // its person, through the turn's own Perspicax token; claim_list is a read
  claim: "conversation",
  claim_renew: "conversation",
  claim_release: "conversation",
  memory_update: "memory",
  memory_log: "memory",
  group_memory_update: "memory",
  // the bot's own RULES.md and docs/ (server/workspace-files.ts)
  rules_update: "memory",
  docs_update: "memory",
  create_bot: "own-setup",
  create_room: "own-setup",
  manage_room: "own-setup",
  select_computer: "own-setup",
  skill_manage: "own-setup",
  propose_routine: "own-setup",
  propose_routine_action: "own-setup",
  propose_profile: "own-setup",
  propose_model: "own-setup",
  propose_team_memory: "own-setup",
  propose_team_setup: "own-setup",
  propose_bot_deletion: "own-setup",
  archive_bot: "own-setup",
  // every setting as the member (server/settings-actions.ts): the member's
  // own rights decide on the route the screen calls, a card otherwise
  sagax_settings: "own-setup",
  // the member's own cards, at their request (server/primary-approvals.ts)
  sagax_approvals: "own-setup",
  // The in-chat terminal (2026-10-15, JC): the list is what THIS person may
  // open (their own environments; the server's hosts for an admin only), and
  // the offer only stages a card the person approves; the server checks the
  // person's rights again when they open it (terminal-resources/registry.ts).
  list_terminal_resources: "read",
  offer_shell_terminal: "conversation",
  publish_remote_session: "conversation",
  // a usage card (server/resource-usage/): read-only, on a computer this
  // person already reaches; the target's own rights are checked
  resource_usage: "conversation",
  // the speaker's own Tailcat session: a fixed read, and one command that
  // asks unless it only reads (server/remote-session-exec.ts)
  remote_session_snapshot: "read",
  remote_session_exec: "conversation",
  // join_meeting only stages a consent card; the person approves each join
  join_meeting: "conversation",
});

/** The agents tools that keep the admin gate, and why:
 *   act             any /api route or a plugin install, as the bot
 *   add_mcp_server  starts a local program on the server
 *   attach_file     reads any path on the server into the chat
 *   vm_exec         a shell command
 *   shared_computer files, a terminal or the screen of a shared desktop
 *   launch_cloud_agent, cloud_agent_follow_up, cancel_cloud_agent,
 *   archive_cloud_agent
 *                   a cloud coding agent run on a provider account */
export const HOST_LEVEL_AGENT_TOOLS: ReadonlySet<string> = new Set([
  "act", "manage_pairing", "manage_settings", "api_reload", "review_write", "add_mcp_server", "attach_file", "vm_exec", "shared_computer",
  "launch_cloud_agent", "cloud_agent_follow_up", "cancel_cloud_agent", "archive_cloud_agent",
]);

/** The agents tool a provider's tool name names, or null. Accepts the
 * spellings the engines report for Sagax's own `agents` MCP server:
 * `mcp__agents__list_bots` (Claude), `agents__list_bots` (ACP titles, the
 * OpenAI-compatible chat engines), `agents.list_bots` and `agents:list_bots`.
 * The name must be exact: no spaces, no other server. */
export function builtinAgentToolName(name: string | undefined): string | null {
  const match = /^(?:mcp(?:__|[.:]))?agents(?:__|[.:/])([a-z][a-z0-9_]{0,63})$/.exec(name ?? "");
  return match ? match[1]! : null;
}

/** The family of an agents tool a member's bot may run without an admin,
 * or null: host-level, unknown, or not an agents tool at all. */
export function memberOwnScopeTool(name: string | undefined): MemberToolFamily | null {
  const tool = builtinAgentToolName(name);
  if (!tool || HOST_LEVEL_AGENT_TOOLS.has(tool)) return null;
  return Object.hasOwn(MEMBER_OWN_SCOPE_AGENT_TOOLS, tool) ? MEMBER_OWN_SCOPE_AGENT_TOOLS[tool]! : null;
}
