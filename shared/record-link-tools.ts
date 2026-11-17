// Which tool's words leave the app (#4507): the ONE place that decides
// whether a tool's arguments lose their record addresses
// (`[#481516](sagax://record/...)` reduced to its label, shared/record-cards.ts
// withoutRecordLinksIn). Read by the agents dispatcher
// (server/drivers/agents-call.ts) and the Claude CLI permission proxy
// (server/permission-proxy.ts); the Perspicax relay strips every console
// call on its own.
//
// Every tool of the app's catalog is named here, in one list or the other
// (server/drivers/record-link-tools.test.ts walks every profile and fails on
// a tool in neither). A tool named in neither at run time (a new one, an
// OpenAPI operation, a CLI tool this file does not know) is stripped: a
// forgotten messaging tool must not carry the address out.
import { isOutboundTool } from "./outbound.ts";

/** The app's tools whose words go to someone or something else: another
 * bot, a room, an agent, a person, an engine or a vendor, a published page,
 * a phone, an outside API. */
export const WORDS_LEAVE_TOOLS: ReadonlySet<string> = new Set([
  // another bot, a room, an agent conversation, a person
  "send_to_bot", "coordinate_bots", "post_to_room", "ask_bot", "delegate_bot", "route_message", "send_prompt",
  "message_user", "message_person", "nudge_person", "send_meme", "send_voice_note", "start_thread", "create_agent",
  "ask_choice", "act", "join_meeting",
  // an engine or a vendor outside the app
  "run_with_engine", "launch_cloud_agent", "cloud_agent_follow_up", "make_image", "make_video", "sagax_web_search",
  // an outside API, a phone, a connector, the organization console
  "vault_http_request", "phone_tool", "place_phone_call", "call_connector", "flow", "flow_action", "api_plan", "api_upload",
  // a live call: who is called, what is said, where it goes
  "place_call", "phone_call_owner", "phone_line_contact", "transfer",
  // a page read outside the chat
  "propose_page",
]);

/** The app's tools that keep their words exactly: reads, files, skills,
 * artifacts, memory, code, settings, cards answered in the app. */
export const WORDS_KEEP_TOOLS: ReadonlySet<string> = new Set([
  // reads and lists
  "api_describe", "api_list", "api_lookup", "api_reload", "api_result_query", "api_search",
  "await_turn", "check_widget", "claim_list", "cloud_agent_transcript", "connectors", "event_subscriptions",
  "find_agents", "find_cloud_agent_by_pr", "get_agent", "get_cloud_agent", "identity", "list_agent_models", "list_agents",
  "list_artifacts", "list_bots", "list_cloud_agent_artifacts", "list_cloud_agents", "list_room_targets", "list_rooms",
  "list_routines", "list_shared_computers", "list_team_setup", "list_terminal_resources", "list_threads",
  "memory_recall", "memory_search", "read_latest_page", "read_latest_page_with_threads", "read_transcript",
  "read_transcript_attachment", "read_transcript_cold", "read_transcript_page", "recall_topic", "resource_usage",
  "sagax_help", "send_status", "session_read", "session_search", "skills_find", "skills_list", "tool_result_read",
  "workspace_read", "workspace_search", "remote_session_snapshot", "remote_support_hosts", "remote_support_status",
  "assignment_status", "check_delegation", "wait_delegation", "list_waits", "cancel_wait", "wait_until", "page_comments",
  // files, artifacts, skills, memory, docs, code
  "attach_file", "save_artifact", "update_artifact", "delete_artifact", "claude_artifact", "skill_manage",
  "memory_write", "memory_update", "memory_log", "memory_forget", "memory_feedback", "memory_propose",
  "group_memory_update", "save_team_memory", "docs_update", "review_write", "vm_exec", "remote_session_exec",
  // a widget's HTML drawn in the chat is code
  "show_html", "show_widget", "update_html", "update_widget",
  // the app's own settings, cards and actions on its own things
  "add_mcp_server", "answer_approval", "archive_bot", "archive_cloud_agent", "cancel_cloud_agent", "claim",
  "claim_release", "claim_renew", "close_thread", "connect_github", "create_bot", "create_room", "create_routine",
  "delete_agent", "delete_routine", "host_computer", "import_plugin_team", "manage_pairing", "manage_room",
  "manage_settings", "offer_shell_terminal", "open_connector_setup", "propose_bot_deletion", "propose_model",
  "propose_profile", "propose_routine", "propose_routine_action", "propose_rule", "propose_team_setup",
  "publish_remote_session", "react_to_message", "remove_reaction", "remote_support_close", "remote_support_host_code",
  "remote_support_host_revoke", "remote_support_open", "request_credential", "request_login", "request_product_key",
  "request_sign_in", "retry_thread", "rules_update", "run_routine", "sagax_approvals", "sagax_settings",
  "select_computer", "set_reply_notify", "shared_computer", "task_list", "update_agent_model",
  "choose_page_target", "propose_proactive", "end_call", "hang_up", "send_dtmf",
  "update_agent_settings", "update_routine",
]);

/** The Claude CLI's own tools: files, notebooks, shell, its own agents and
 * plans keep their words; a fetch or a search of the web leaves. */
const CLI_KEEP_TOOLS: ReadonlySet<string> = new Set([
  "Bash", "BashOutput", "KillShell", "KillBash", "Edit", "MultiEdit", "Write", "NotebookEdit", "NotebookRead", "Read",
  "Glob", "Grep", "LS", "Task", "Agent", "TodoWrite", "ExitPlanMode", "Skill", "SlashCommand", "AskUserQuestion",
  "ListMcpResourcesTool", "ReadMcpResourceTool",
]);

/** Sagax's own servers in the CLI besides the agents bridge: their tools
 * are the app's own (a computer's files and shell, a browser, data); only a
 * send among them leaves. */
const SAGAX_SERVERS: ReadonlySet<string> = new Set(["ogb", "computer", "phone", "messages", "browser", "data", "dweb"]);

const PATH_KEYS = ["path", "file_path", "filePath", "filename", "file_name", "file", "notebook_path", "target_file"];
const CONTENT_KEYS = ["content", "contents", "patch", "diff", "new_string", "old_string", "edits", "source", "new_source", "code"];

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** A connector tool's input that is file content or code: a path with its
 * content (create_or_update_file, write_file, an edit or a patch), or a
 * `files` list (push_files). Those words are a file's, kept exactly. */
export function fileContentArguments(args: unknown): boolean {
  const input = record(args);
  if (!input) return false;
  if (Array.isArray(input.files) || record(input.files)) return true;
  return PATH_KEYS.some((key) => typeof input[key] === "string") && CONTENT_KEYS.some((key) => input[key] !== undefined);
}

/** Whether one call of the app's own tools (the agents catalog) loses its
 * record addresses. Unknown tools do (the safe default). call_connector
 * follows the connector rule on the input it hands on. */
export function appToolWordsLeave(name: string, args?: unknown): boolean {
  if (WORDS_KEEP_TOOLS.has(name)) return false;
  if (name === "call_connector") return connectorToolWordsLeave(record(args)?.arguments);
  return true;
}

/** Whether one call of a connector's tool (mounted in the harness, or run
 * through call_connector) loses its record addresses: yes, unless its input
 * is file content. */
export function connectorToolWordsLeave(args: unknown): boolean {
  return !fileContentArguments(args);
}

/** Whether a tool the Claude CLI runs (asked through the permission proxy)
 * loses its record addresses. */
export function harnessToolWordsLeave(tool: string, input: unknown): boolean {
  const match = /^mcp__([A-Za-z0-9][A-Za-z0-9_.-]*?)__(.+)$/.exec(tool);
  if (!match) return !CLI_KEEP_TOOLS.has(tool);
  const server = match[1]!.toLowerCase();
  const name = match[2]!;
  if (server === "agents") return appToolWordsLeave(name, input);
  // the console's tools: the relay strips every call anyway
  if (server === "perspicax" || server.startsWith("perspicax_")) return true;
  if (SAGAX_SERVERS.has(server)) return isOutboundTool(tool, input);
  return connectorToolWordsLeave(input);
}
