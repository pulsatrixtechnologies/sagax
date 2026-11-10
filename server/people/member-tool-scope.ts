// Which built-in Sagax tools a member's bot runs on an organization server
// without an organization admin (2026-10-08).
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

import { grantStaysInOwnEnvironment } from "../../shared/grant-reach.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../tools/agent-tool-policy.ts";
import { isOpenApiTool } from "../mcp/openapi-tools.ts";
import { policyFor } from "../tools/tool-policy.ts";

/** Why an agents tool stays inside the member's own scope. */
export type MemberToolFamily =
  /** reads of the bot's own team, threads, routines, skills, sessions */
  | "read"
  /** talking to the bot's own teammates, rooms and threads, or to its person */
  | "conversation"
  /** the bot's own memory and its room's shared memory */
  | "memory"
  /** the bot's own setup: proposals its person confirms, its skills, its rooms */
  | "own-setup"
  /** the bot's own work for its person, nothing outward (its task list) */
  | "own-work"
  /** 2026-10-28: acts with the person's own key, account, device or
   * computer. Their own card at their own approval level, never an admin's;
   * Sagax never answers it by itself (sagax-internal-tools.ts), and the
   * person's Deny and Ask first rules apply as to any tool. */
  | "own-account";

const READ = Object.fromEntries([...READ_ONLY_AGENT_TOOL_NAMES, "list_room_targets"].map((name) => [name, "read" as const]));

/** The agents tools a member's bot runs under its own approval level. */
export const MEMBER_OWN_SCOPE_AGENT_TOOLS: Readonly<Record<string, MemberToolFamily>> = Object.freeze({
  ...READ,
  ask_bot: "conversation",
  send_to_bot: "conversation",
  delegate_bot: "conversation",
  // the member's own bot on another engine the member may use, for the member
  run_with_engine: "conversation",
  coordinate_bots: "conversation",
  assignment_status: "read",
  send_status: "read",
  post_to_room: "conversation",
  message_person: "conversation",
  react_to_message: "conversation",
  send_meme: "conversation",
  remove_reaction: "conversation",
  start_thread: "conversation",
  route_message: "conversation",
  // #2389: whether this turn's reply alerts the bot's own person
  set_reply_notify: "conversation",
  close_thread: "conversation",
  retry_thread: "conversation",
  create_options_card: "conversation",
  ask_choice: "conversation",
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
  remote_support_hosts: "read", remote_support_host_code: "conversation", remote_support_host_revoke: "conversation",
  // chat widgets (agents-widget-tools.ts): a card in the member's own conversation
  check_widget: "read",
  show_widget: "conversation",
  update_widget: "conversation",
  // live HTML apps (agents-app-tools.ts): a card in the member's own conversation
  show_html: "conversation",
  update_html: "conversation",
  // artifacts (agents-artifact-tools.ts): the bot's own saved widgets; a
  // source runs alone only when it needs no approval (artifact-refresh.ts)
  save_artifact: "conversation",
  update_artifact: "conversation",
  list_artifacts: "read",
  delete_artifact: "conversation",
  // claude.ai artifacts through the speaking person's own Claude account (#2018)
  claude_artifact: "conversation",
  // a page proposal: a card in the member's own conversation; publishing is theirs
  propose_page: "conversation",
  // #2199 / #2048: pick which surface hosts a new page or artifact; stays in
  // the member's own conversation (same family as ask_choice / propose_page)
  choose_page_target: "conversation",
  // the annotations of the member's own page, answered in their own conversation
  page_comments: "conversation",
  // a phone call: a card in the member's own conversation, through their own Twilio profile
  place_phone_call: "conversation",
  phone_call_owner: "conversation",
  phone_line_contact: "conversation",
  // Live controls and the compatibility alias use that same person's
  // profile; call lookup also binds bot and thread (d352e1751).
  place_call: "conversation",
  send_dtmf: "conversation",
  transfer: "conversation",
  hang_up: "conversation",
  send_voice_note: "conversation",
  end_call: "conversation",
  request_credential: "conversation",
  request_login: "conversation",
  request_sign_in: "conversation",
  // a sign-in card in the member's own conversation, for their own engine account
  open_connector_setup: "conversation",
  // #3347: the speaker's own connectors (the turn's connector principal), a read
  connectors: "conversation",
  // #3348: one call of the speaker's own connector; its held request is
  // decided by the speaker's own settings, so the wrapper never asks
  call_connector: "conversation",
  // claims (perspicax-claims.ts): a lease in Perspicax held by this bot for
  // its person, through the turn's own Perspicax token; claim_list is a read
  claim: "conversation",
  claim_renew: "conversation",
  claim_release: "conversation",
  memory_update: "memory",
  memory_log: "memory",
  group_memory_update: "memory",
  // the bot's own RULES.md and docs/ (server/workspace/workspace-files.ts)
  rules_update: "memory",
  docs_update: "memory",
  create_bot: "own-setup",
  create_room: "own-setup",
  manage_room: "own-setup",
  select_computer: "own-setup",
  skill_manage: "own-setup",
  propose_routine: "own-setup",
  propose_routine_action: "own-setup",
  // #2700: the bot's own event subscriptions (owner-checked route)
  event_subscriptions: "own-setup",
  propose_profile: "own-setup",
  propose_model: "own-setup",
  // Personal review rules only; the route keeps person and org Ask/Deny
  // checks (4ec8a5749, MCP own scope registered in b17ff95a5).
  propose_rule: "own-setup",
  // #3431: the member's own choice card and About me (owner's own turn only)
  propose_proactive: "own-setup",
  propose_team_memory: "own-setup",
  propose_team_setup: "own-setup",
  propose_bot_deletion: "own-setup",
  import_plugin_team: "own-setup",
  archive_bot: "own-setup",
  // every setting as the member (server/settings-actions.ts): the member's
  // own rights decide on the route the screen calls, a card otherwise
  sagax_settings: "own-setup",
  // #1269: act runs as the signed-in person (server/bots/bot-act.ts). #1098
  // (2026-10-28): a read or a write that stays in the member's own
  // environment is their own card (ownAct); a call on someone else's bot or
  // on a route that reaches past that environment (shared/grant-reach.ts
  // ORG_REACH_AREAS) stays an admin card (memberBotAdminApproval).
  act: "own-setup",
  manage_settings: "own-setup",
  // the member's own cards, at their request (server/approvals/primary-approvals.ts)
  sagax_approvals: "own-setup",
  // 2026-10-26: a pairing code for the member's own device; the route binds
  // the code to the person the turn speaks for, never anyone else, and a
  // turn no person speaks in never calls it (mcp-permissions.ts service)
  manage_pairing: "own-setup",
  // The in-chat terminal (2026-10-15): the list is what THIS person may
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
  // asks unless it only reads (server/remote-support/remote-session-exec.ts)
  remote_session_snapshot: "read",
  remote_session_exec: "conversation",
  // the speaker's own host as the bot's computer; its access rule applies (#2726)
  host_computer: "conversation",
  // join_meeting only stages a consent card; the person approves each join
  join_meeting: "conversation",
  // 2026-10-28: the tools below reached the catalog without a class, so a
  // member's call waited for an admin. Each acts only for the person the
  // turn speaks for, through a route that checks it.
  // the bot's own task list (agents-call-tasks.ts)
  task_list: "own-work",
  // The capability's bot and chat own these waits; the route rejects an
  // attempt to cancel another chat's wait (4286c5568, b17ff95a5).
  wait_until: "own-work",
  cancel_wait: "own-work",
  // points at the engine's own video tools; runs nothing (agents-video.ts)
  make_image: "own-work",
  make_video: "own-work",
  // a search with the person's own provider and key (server/web-search/)
  sagax_web_search: "read",
  // #2613: the skill catalogs the person sees, and ClawHub (read only)
  skills_find: "read",
  // an API key of the person, sent where they allowed (credential-http.ts)
  vault_http_request: "own-account",
  // the person's own iPhone, which asks for its own consent (phone-tools.ts)
  phone_tool: "own-account",
  // the speaker's own GitHub account (device flow)
  connect_github: "own-account",
  // the agent-to-agent API: its own guard and owner checks (agent-api.ts)
  send_prompt: "own-account",
  create_agent: "own-account",
  delete_agent: "own-account",
  // cloud coding agents on the speaker's own provider credentials, listed
  // and changed for that person only (routes/cloud-agents-internal.ts)
  launch_cloud_agent: "own-account",
  cloud_agent_follow_up: "own-account",
  cancel_cloud_agent: "own-account",
  archive_cloud_agent: "own-account",
  // a message to another person in the owner's name (#2118): the person's own
  // card at their own approval level, never answered by Sagax for them
  message_user: "own-account",
});

/** The agents tools that keep the admin gate when they would touch the
 * shared server, and why:
 *   api_reload, review_write
 *                   Perspicax admin tools (always)
 *   add_mcp_server  the server's shared list
 *   attach_file     a path outside the bot's own folders
 *   vm_exec         a Local VM the server shares or pools
 *   shared_computer a computer that is not the speaking owner's
 * 2026-10-28: the same four, when the call stays in the member's own
 * environment (their own server list, the bot's own folders or Local VM,
 * their own computers), are the owner's card at their own level
 * (engine-access.ts memberOwnHostToolCall). They never answer themselves. */
export const HOST_LEVEL_AGENT_TOOLS: ReadonlySet<string> = new Set([
  "api_reload", "review_write", "add_mcp_server", "attach_file", "vm_exec", "shared_computer",
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

/** What the model reads when it called a Sagax tool that does not exist
 * (#1426): nothing ran, nobody is asked, and for an image it uses the
 * engine's own image tool when the turn has one. Pure. */
export function unknownAgentToolRefusal(tool: string): string {
  const image = /image|imagine|picture|photo|draw|paint/i.test(tool);
  return `Sagax has no tool named "${tool}": nothing ran and no approval was asked. Use only the tools listed for this turn.`
    + (image ? " To make or edit an image, call make_image { prompt } directly: it edits the image attached to the person's message by default. Do not search for an image skill." : "");
}

/** The family of an agents tool a member's bot may run without an admin,
 * or null: host-level, unknown, or not an agents tool at all. */
export function memberOwnScopeTool(name: string | undefined): MemberToolFamily | null {
  const tool = builtinAgentToolName(name);
  if (!tool || HOST_LEVEL_AGENT_TOOLS.has(tool)) return null;
  // The person's own OpenAPI operations (docs/openapi-connector.md): named by
  // that person's document, served to their 1:1 turns only; a write follows
  // their approval level. The one name pattern here, the catalog's own test.
  if (isOpenApiTool(tool)) return "own-account";
  return Object.hasOwn(MEMBER_OWN_SCOPE_AGENT_TOOLS, tool) ? MEMBER_OWN_SCOPE_AGENT_TOOLS[tool]! : null;
}

const ACT_ROUTE_KEYS = new Set(["method", "path", "query", "body"]);
const BOT_ID = /^[\w-]{1,80}$/;

function actRecord(input: unknown): Record<string, unknown> | null {
  let raw = input;
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return null;
    try { raw = JSON.parse(text); } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** `/api/bots/<id>` of a bot `ownsBot` accepts, nothing else. `..`, an
 * encoding, a query in the path or another bot fail closed. */
function ownBotApiPath(path: string, ownsBot: (id: string) => boolean): boolean {
  let clean = path;
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  if (!clean.startsWith("/api/bots/")) return false;
  if (clean.includes("//") || clean.includes("\\") || clean.includes("%") || clean.includes("?") || clean.includes("#")) return false;
  const rest = clean.slice("/api/bots/".length);
  const segments = rest.split("/");
  if (!rest || segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  const id = segments[0]!;
  return BOT_ID.test(id) && ownsBot(id);
}

/** #1269: `act` that only reads the member's own bot. GET or HEAD, no body,
 * on `/api/bots/<that bot>` (the same read the approval card badges
 * Read-only). A plugin `list` of that bot is the same call. A write, a
 * body, another bot, or a call we cannot prove, is not: those stay an
 * admin card. `ownsBot` is absent when the caller did not say which bots
 * are the member's, and then nothing passes. An omitted plugin `botId` is
 * the calling bot (`callerBotId`). */
export function ownBotReadAct(name: string | undefined, input: unknown, scope: { ownsBot?: (id: string) => boolean; callerBotId?: string } | undefined): boolean {
  if (builtinAgentToolName(name) !== "act" || !scope?.ownsBot) return false;
  const ownsBot = scope.ownsBot;
  const record = actRecord(input);
  if (!record) return false;
  if (record.plugins !== undefined && record.method === undefined && record.path === undefined && record.ui === undefined) {
    if (Object.keys(record).some((key) => key !== "plugins")) return false;
    const plugins = record.plugins;
    if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return false;
    const plugin = plugins as Record<string, unknown>;
    if (plugin.action !== "list") return false;
    if (Object.keys(plugin).some((key) => key !== "action" && key !== "botId")) return false;
    const id = plugin.botId === undefined ? scope.callerBotId : plugin.botId;
    return typeof id === "string" && BOT_ID.test(id) && ownsBot(id);
  }
  if (Object.keys(record).some((key) => !ACT_ROUTE_KEYS.has(key))) return false;
  if (typeof record.method !== "string" || typeof record.path !== "string") return false;
  const method = record.method.trim().toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (record.body !== undefined && record.body !== null) return false;
  if (record.query !== undefined && (typeof record.query !== "object" || record.query === null || Array.isArray(record.query))) return false;
  return ownBotApiPath(record.path, ownsBot);
}

/** The area of an act route (shared/grant-reach.ts): the reviewed policy
 * row's, else the first segment after `/api/`. */
function actRouteAreas(method: string, path: string): string[] {
  const policy = policyFor(method, path);
  // not a route of its own: the second segment of any /api/ path
  const segment = path.startsWith("/api/") ? (path.slice("/api/".length).split("/")[0] ?? "") : "";
  return [policy.scope.split(":")[0] ?? "", segment];
}

function ownBotIdsOnly(input: unknown, ownsBot: (id: string) => boolean): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input === undefined;
  const botId = (input as Record<string, unknown>).botId;
  return botId === undefined || (typeof botId === "string" && BOT_ID.test(botId) && ownsBot(botId));
}

/** #1098 (2026-10-28): `act` (read or write) that stays in the member's own
 * environment, so its engine card is the member's own, never an admin's.
 * act runs as the signed-in person (server/bots/bot-act.ts): the route refuses
 * what that person may not do, and a write still waits for their own Allow
 * (botActRequest) unless their level runs it. What stays an admin card:
 *   - a route whose area reaches past the person's environment
 *     (ORG_REACH_AREAS: the organization, its people, the shared server,
 *     billing, grants), or an unprovable path (`..`, an encoding, a query);
 *   - `/api/bots/<id>` of a bot that is not theirs;
 *   - a plugin action or a screen action on a bot that is not theirs.
 * `ownsBot` absent: nothing passes. */
export function ownAct(name: string | undefined, input: unknown, scope: { ownsBot?: (id: string) => boolean; callerBotId?: string } | undefined): boolean {
  if (builtinAgentToolName(name) !== "act" || !scope?.ownsBot) return false;
  if (ownBotReadAct(name, input, scope)) return true;
  const ownsBot = scope.ownsBot;
  const record = actRecord(input);
  if (!record) return false;
  if (record.plugins !== undefined) {
    if (Object.keys(record).some((key) => key !== "plugins")) return false;
    const plugin = record.plugins;
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) return false;
    const id = (plugin as Record<string, unknown>).botId === undefined ? scope.callerBotId : (plugin as Record<string, unknown>).botId;
    return typeof id === "string" && BOT_ID.test(id) && ownsBot(id);
  }
  if (record.ui !== undefined) {
    if (Object.keys(record).some((key) => key !== "ui" && key !== "input")) return false;
    return typeof record.ui === "string" && ownBotIdsOnly(record.input, ownsBot);
  }
  if (Object.keys(record).some((key) => !ACT_ROUTE_KEYS.has(key))) return false;
  if (typeof record.method !== "string" || typeof record.path !== "string") return false;
  const method = record.method.trim().toUpperCase();
  let path = record.path;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (!path.startsWith("/api/") || /\/\/|\\|%|\?|#/.test(path)) return false;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return false;
  if (path.startsWith("/api/bots/") && !ownBotApiPath(path, ownsBot)) return false;
  return actRouteAreas(method, path).every((area) => area && grantStaysInOwnEnvironment(`${area}:write`));
}
