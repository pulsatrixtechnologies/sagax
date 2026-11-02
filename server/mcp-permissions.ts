// Granular permissions for the Sagax MCP tools: one permission per action,
// named resource:verb, scoped self < team < org, deny by default, one audit
// record per call (allowed and denied). Spec: docs/mcp/permissions.md; the
// capability inventory: docs/mcp/coverage.md.
//
// Pure data and functions: no environment, no I/O except the audit hook the
// caller hands in. The agents proxy (server/drivers/agents-proxy.ts) wraps
// its tool dispatch with guardToolCall.

export const MCP_SCOPES = ["self", "team", "org"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_ROLES = ["viewer", "member", "operator", "admin", "service"] as const;
export type McpRole = (typeof MCP_ROLES)[number];

/** read: changes nothing. own: the caller's own work. dispatch: puts other
 * bots, people or routines to work. admin: settings, pairing, credentials,
 * anything lasting for the organization. claim: holds on shared work. */
export type PermissionTier = "read" | "own" | "dispatch" | "claim" | "admin";

export interface McpPermission {
  /** resource:verb, e.g. memory:save. Stable: retire, never rename. */
  key: string;
  tier: PermissionTier;
  /** The MCP tool that carries it today; null while the capability is a gap. */
  tool: string | null;
  /** Where the capability lives (see docs/mcp/coverage.md). */
  source: "sagax" | "perspicax";
  /** Other names of the same capability: a Perspicax tool that a Sagax tool
   * already stands for (sagax_send is send_to_bot), or a name a Perspicax
   * build behind a switch serves (memory v2, Perspicax #326). */
  aliases?: readonly string[];
  /** A per-profile Perspicax tool (`<profile>__query`, ...): `tool` is then a
   * display name and the call is matched by profileToolCall. */
  profileKind?: ProfileToolKind;
}

const p = (key: string, tier: PermissionTier, tool: string | null, source: "sagax" | "perspicax" = "sagax", aliases?: readonly string[]): McpPermission =>
  ({ key, tier, tool, source, ...(aliases?.length ? { aliases } : {}) });
const profileTool = (key: string, tier: PermissionTier, kind: ProfileToolKind, tool: string): McpPermission => ({ key, tier, tool, source: "perspicax", profileKind: kind });

/** The kinds of per-profile tool Perspicax 1.8.28 serves (connector-core
 * tools/compact.rs and tools/name.rs): `<profile>__query` reads a resource,
 * `<profile>__write` creates, updates or deletes one (`<profile>__<resource>_write`
 * when the profile is not compacted), `<profile>__action` runs an action,
 * `<profile>__read_action` runs a read-only one, and any other
 * `<profile>__<operation>` is one operation's own tool. */
export type ProfileToolKind = "query" | "write" | "action" | "read_action" | "operation";

export const MCP_PERMISSIONS: readonly McpPermission[] = [
  // Reads
  p("bots:list", "read", "list_bots", "sagax", ["sagax_bots"]),
  p("rooms:list", "read", "list_rooms"),
  p("rooms:targets", "read", "list_room_targets"),
  p("threads:list", "read", "list_threads"),
  p("teamsetup:list", "read", "list_team_setup"),
  p("computers:list", "read", "list_shared_computers"),
  p("terminal:list", "read", "list_terminal_resources"),
  p("resources:usage", "read", "resource_usage"),
  // a sign-in card for the speaker's own connector (shared/connector-setup.ts)
  p("connectors:setup", "read", "open_connector_setup"),
  p("delegation:check", "read", "check_delegation"),
  p("delegation:wait", "read", "wait_delegation"),
  p("sessions:search", "read", "session_search"),
  p("sessions:read", "read", "session_read"),
  p("topics:recall", "read", "recall_topic"),
  p("toolresult:read", "read", "tool_result_read"),
  p("routines:list", "read", "list_routines"),
  p("skills:list", "read", "skills_list"),
  p("workspace:read", "read", "workspace_read"),
  p("workspace:search", "read", "workspace_search"),
  p("agents:list", "read", "list_agents"),
  p("agents:find", "read", "find_agents"),
  p("agents:get", "read", "get_agent"),
  p("agents:await", "read", "await_turn"),
  p("transcript:read", "read", "read_transcript", "sagax", ["sagax_thread"]),
  p("transcript:page", "read", "read_transcript_page"),
  p("transcript:latest", "read", "read_latest_page"),
  p("transcript:latest.threads", "read", "read_latest_page_with_threads"),
  p("transcript:cold", "read", "read_transcript_cold"),
  p("cloudagents:list", "read", "list_cloud_agents"),
  p("cloudagents:get", "read", "get_cloud_agent"),
  p("cloudagents:find", "read", "find_cloud_agent_by_pr"),
  p("cloudagents:transcript", "read", "cloud_agent_transcript"),
  p("cloudagents:artifacts", "read", "list_cloud_agent_artifacts"),
  // Own work
  p("memory:save", "own", "memory_update"),
  p("memory:log", "own", "memory_log"),
  p("groupmemory:save", "own", "group_memory_update"),
  p("files:attach", "own", "attach_file"),
  p("widgets:check", "read", "check_widget"),
  p("help:read", "read", "sagax_help"),
  // the person's own search provider, with their key (server/web-search/)
  p("web:search", "read", "sagax_web_search"),
  p("widgets:show", "own", "show_widget"),
  p("widgets:update", "own", "update_widget"),
  p("apps:show", "own", "show_html"),
  p("apps:update", "own", "update_html"),
  p("artifacts:save", "own", "save_artifact"),
  p("artifacts:update", "own", "update_artifact"),
  p("artifacts:list", "read", "list_artifacts"),
  p("artifacts:delete", "own", "delete_artifact"),
  p("pages:propose", "own", "propose_page"),
  p("pages:comments", "own", "page_comments"),
  p("phone:call", "own", "place_phone_call"),
  p("cards:options", "own", "create_options_card"),
  p("cards:ask", "own", "ask_choice"),
  p("rooms:react", "own", "react_to_message"),
  p("rooms:unreact", "own", "remove_reaction"),
  p("rooms:post", "own", "post_to_room"),
  p("threads:close", "own", "close_thread"),
  p("voice:note", "own", "send_voice_note"),
  p("voice:end", "own", "end_call"),
  p("skills:manage", "own", "skill_manage"),
  p("profile:propose", "own", "propose_profile"),
  p("model:propose", "own", "propose_model"),
  p("routines:propose", "own", "propose_routine"),
  p("routines:propose.action", "own", "propose_routine_action"),
  // "tell me when" waits (server/waits.ts): plain checks for the speaker, no AI
  p("waits:set", "own", "wait_until"),
  p("waits:list", "read", "list_waits"),
  p("waits:cancel", "own", "cancel_wait"),
  // Shape mascot from a short description (catalog generate_shape_avatar).
  p("shapes:generate", "own", "generate_shape_avatar"),
  p("terminal:offer", "own", "offer_shell_terminal"),
  p("remote:publish", "own", "publish_remote_session"),
  // the person's own connected Tailcat session (owner and bot checked by the service)
  p("remote:snapshot", "own", "remote_session_snapshot"),
  p("remote:exec", "own", "remote_session_exec"),
  p("meetings:join", "own", "join_meeting"),
  // 2026-10-19 (member admin audit, docs/member-admin-audit.md): the
  // person's own data or destinations, never an admin's.
  p("teamsetup:propose", "own", "propose_team_setup"),
  p("rules:update", "own", "rules_update"),
  // a Confirm card to add, change or remove one of the speaker's own review rules (server/rule-requests.ts)
  p("rules:propose", "own", "propose_rule"),
  p("docs:update", "own", "docs_update"),
  p("credentials:login", "own", "request_login"),
  // an API call with a vault key Sagax adds itself (server/credential-http.ts)
  p("credentials:http", "own", "vault_http_request"),
  // the person's own OpenAPI operations (openapi_<operation>, server/openapi-tools.ts)
  p("openapi:call", "own", "openapi_*"),
  // Generates paid media in the person's conversation, on their own key
  // or the organization's existing explicit media grant.
  p("video:make", "own", "make_video"),
  // the person's task list for this bot (server/drivers/agents-task-tools.ts)
  p("tasks:update", "own", "task_list"),
  // 2026-10-28: both reached the catalog without a permission, so enforce
  // refused them to everyone as unknown tools. The person's own iPhone (the
  // phone asks for its own consent, server/phone-tools.ts) and the speaker's
  // own GitHub account (device flow).
  p("phone:tool", "own", "phone_tool"),
  p("github:connect", "own", "connect_github"),
  p("computers:select", "own", "select_computer"),
  p("pairing:manage", "own", "manage_pairing"),
  // Dispatch
  p("bots:ask", "dispatch", "ask_bot"),
  p("bots:delegate", "dispatch", "delegate_bot"),
  // a part of the bot's own work on another engine it may use (server/run-with-engine.ts)
  p("engines:relay", "dispatch", "run_with_engine"),
  p("bots:send", "dispatch", "send_to_bot", "sagax", ["sagax_send"]),
  p("bots:coordinate", "dispatch", "coordinate_bots"),
  p("agents:send", "dispatch", "send_prompt"),
  p("threads:start", "dispatch", "start_thread"),
  p("threads:route", "own", "route_message"),
  p("threads:retry", "dispatch", "retry_thread"),
  p("cloudagents:launch", "dispatch", "launch_cloud_agent"),
  p("cloudagents:followup", "dispatch", "cloud_agent_follow_up"),
  p("cloudagents:cancel", "dispatch", "cancel_cloud_agent"),
  p("cloudagents:archive", "dispatch", "archive_cloud_agent"),
  // Admin
  p("bots:create", "admin", "create_bot"),
  p("bots:delete.propose", "admin", "propose_bot_deletion"),
  p("bots:archive", "admin", "archive_bot"),
  p("agents:create", "admin", "create_agent"),
  p("agents:delete", "admin", "delete_agent"),
  p("rooms:create", "admin", "create_room"),
  p("rooms:manage", "admin", "manage_room"),
  p("teammemory:propose", "admin", "propose_team_memory"),
  p("mcp:add", "admin", "add_mcp_server"),
  p("credentials:request", "admin", "request_credential"),
  p("computers:use", "admin", "shared_computer"),
  p("vm:exec", "admin", "vm_exec"),
  // #1269: act runs as the signed-in person with their own rights
  // (server/bot-act.ts); a routine or a webhook never calls it (service below)
  p("actions:invoke", "own", "act"),
  // Claims (Sagax #497, Perspicax #327): the native claim tools.
  p("claims:acquire", "claim", "claim"),
  p("claims:renew", "claim", "claim_renew"),
  p("claims:release", "claim", "claim_release"),
  p("claims:list", "read", "claim_list"),
  // Perspicax memory tools, as 1.8.28 serves them (connector mcp/memory_tools.rs).
  // The aliases are the memory v2 names of the draft behind a switch (#326).
  p("memory:search", "read", "memory_search", "perspicax", ["memory_find"]),
  p("memory:recall", "read", "memory_recall", "perspicax"),
  p("memory:write", "own", "memory_write", "perspicax", ["memory_save"]),
  p("memory:forget", "own", "memory_forget", "perspicax", ["memory_remove"]),
  p("memory:feedback", "own", "memory_feedback", "perspicax"),
  p("memory:promote", "admin", "memory_promote", "perspicax"),
  p("memory:propose", "own", "memory_propose", "perspicax", ["memory_suggestions"]),
  p("memory:review", "admin", "memory_review", "perspicax"),
  p("memory:files", "own", "memory", "perspicax"),
  p("work:search", "read", "work_search", "perspicax"),
  p("work:check", "read", "work_check", "perspicax"),
  p("work:open", "read", "work_open", "perspicax"),
  p("people:ask", "dispatch", "ask_person", "perspicax"),
  p("approvals:answer", "dispatch", "answer_approval", "sagax", ["sagax_approve"]),
  p("routines:run", "dispatch", "run_routine", "sagax", ["sagax_routine_run"]),
  // 2026-11-01 (#1891): person AI client updates own routines via member PATCH
  // (Perspicax sagax_routine_update). Bots keep propose_routine_action (Ask/Auto).
  p("routines:update", "own", "update_routine", "sagax", ["sagax_routine_update"]),
  p("people:nudge", "dispatch", "nudge_person", "sagax", ["sagax_nudge"]),
  // Perspicax meta-tools (connector mcp/meta_tools.rs CORE_META_NAMES).
  p("api:list", "read", "api_list", "perspicax"),
  p("api:search", "read", "api_search", "perspicax"),
  p("api:describe", "read", "api_describe", "perspicax"),
  p("api:lookup", "read", "api_lookup", "perspicax"),
  p("api:plan", "read", "api_plan", "perspicax"),
  p("api:resultquery", "read", "api_result_query", "perspicax"),
  p("api:upload", "own", "api_upload", "perspicax"),
  p("api:reload", "admin", "api_reload", "perspicax"),
  p("identity:search", "read", "identity", "perspicax"),
  p("flow:read", "read", "flow", "perspicax"),
  p("flow:action", "dispatch", "flow_action", "perspicax"),
  p("review:write", "admin", "review_write", "perspicax"),
  // Remote support (Perspicax 1.8.43, connector mcp/remote_support_tools.rs):
  // Perspicax serves them only to a person holding its permission. Opening
  // one reaches an end user, as a dispatch does; status and close stay on
  // the caller's own session.
  p("remotesupport:open", "dispatch", "remote_support_open", "perspicax"),
  p("remotesupport:status", "own", "remote_support_status", "perspicax"),
  p("remotesupport:close", "own", "remote_support_close", "perspicax"),
  // Per-profile Perspicax tools, matched by name (profileToolCall). An
  // operation's own tool is not known to be a read, so it needs dispatch.
  profileTool("api:query", "read", "query", "<profile>__query"),
  profileTool("api:write", "dispatch", "write", "<profile>__write"),
  profileTool("api:action", "dispatch", "action", "<profile>__action"),
  profileTool("api:action.read", "read", "read_action", "<profile>__read_action"),
  profileTool("api:operation", "dispatch", "operation", "<profile>__<operation>"),
  // act on /api/config as the person: their own rights decide (#1269)
  p("settings:manage", "own", "manage_settings"),
  // every setting as the person (server/settings-actions.ts): the person's
  // own rights decide on the route, like act
  p("settings:change", "own", "sagax_settings"),
  // a Primary Bot answers its person's cards at their request
  // (server/primary-approvals.ts): the click's own checks decide
  p("approvals:primary", "own", "sagax_approvals"),
];

/** 2026-10-27 (#1098): a tool a person's external MCP server serves that
 * Sagax does not list (the Perspicax relay: list_pending_approvals, a newer
 * remote support tool). That server authorizes it for the person itself;
 * Sagax's catalog only names its own tools (decide `external`). Not a
 * capability of the registry, so not in MCP_PERMISSIONS. */
export const EXTERNAL_MCP_PERMISSION: McpPermission = { key: "mcp:external", tier: "own", tool: null, source: "perspicax" };

const BY_TOOL = new Map<string, McpPermission>(MCP_PERMISSIONS.filter((x) => x.tool && !x.profileKind).flatMap((x) => [x.tool as string, ...(x.aliases ?? [])].map((name) => [name, x] as const)));
const BY_KEY = new Map<string, McpPermission>(MCP_PERMISSIONS.map((x) => [x.key, x]));
const BY_PROFILE_KIND = new Map<ProfileToolKind, McpPermission>(MCP_PERMISSIONS.filter((x) => x.profileKind).map((x) => [x.profileKind as ProfileToolKind, x]));

/** A per-profile Perspicax tool name, split: `cw_psa__query` is profile
 * cw_psa, kind query. The `-` spelling (`cw_psa-query`, Perspicax
 * tool_name_separator) is read too. Null for any other name: a Sagax tool or a
 * meta-tool never carries `__` or `-`. */
export function profileToolCall(tool: string): { profile: string; kind: ProfileToolKind; name: string } | null {
  const m = /^([a-z0-9][a-z0-9_]*?)(?:__|-)([A-Za-z0-9][A-Za-z0-9_]*)$/.exec(tool);
  if (!m) return null;
  const [, profile, name] = m as unknown as [string, string, string];
  const kind: ProfileToolKind = name === "query" || name === "write" || name === "action" || name === "read_action"
    ? name
    : name.endsWith("_write") ? "write" : "operation";
  return { profile, kind, name };
}

/** The permission of a tool: by name (or alias), else by the per-profile pattern. */
const OPENAPI_TOOL = /^openapi_[a-z][a-z0-9_]{0,48}$/;

export const permissionForTool = (tool: string): McpPermission | undefined => {
  const named = BY_TOOL.get(tool);
  if (named) return named;
  if (OPENAPI_TOOL.test(tool)) return BY_KEY.get("openapi:call");
  const profile = profileToolCall(tool);
  return profile ? BY_PROFILE_KIND.get(profile.kind) : undefined;
};
export const permissionByKey = (key: string): McpPermission | undefined => BY_KEY.get(key);

type TierScopes = Partial<Record<PermissionTier, McpScope>>;

const rank = (scope: McpScope) => MCP_SCOPES.indexOf(scope);

/** The widest scope each role holds per tier. A missing tier is denied. */
// 2026-10-27 (#1098): a read changes nothing, and the tool's own source
// (the Sagax route, Perspicax's memory tiers) shows only what the person may
// already read, so a read reaches the org scope for every role.
export const ROLE_TIER_SCOPES: Record<McpRole, TierScopes> = {
  viewer: { read: "org" },
  member: { read: "org", own: "self", dispatch: "self", claim: "self" },
  operator: { read: "org", own: "team", dispatch: "team", claim: "team" },
  admin: { read: "org", own: "org", dispatch: "org", claim: "org", admin: "org" },
  service: { read: "org", own: "self", dispatch: "self", claim: "self" },
};

/** 2026-10-27 (#1098): a role that holds at least what another holds. An
 * operator (a Perspicax manager) is a member first: whatever a member may do
 * in their own environment, an operator may too (decide takes the wider). */
export const ROLE_INHERITS: Partial<Record<McpRole, McpRole>> = { operator: "member" };

/** Per-role exceptions, applied before the tier rule. A key set to null is
 * denied; a scope replaces the tier's. */
export const ROLE_OVERRIDES: Partial<Record<McpRole, Record<string, McpScope | null>>> = {
  // A member may start a bot of their own, nothing wider.
  // 2026-10-26: archiving one of their own bots, and Perspicax's
  // temporary agents they create and archive for themselves, are their own
  // work too. Someone else's bot reaches the team scope (scopeForCall) and
  // stays refused.
  // 2026-10-27 (#1098): their own Local VM (vm_exec names no other
  // machine), act (the route checks the person's own rights) and a team
  // memory proposal (a card a team member confirms) are their own work too.
  member: {
    "bots:create": "self", "bots:delete.propose": "self", "bots:archive": "self", "rooms:create": "self", "rooms:manage": "self",
    "agents:create": "self", "agents:delete": "self",
    "vm:exec": "self", "actions:invoke": "self", "teammemory:propose": "self",
    // 2026-10-28: a secure entry card for the person's own key, and the
    // person's own lent computers (the route lists the speaker's only)
    "credentials:request": "self", "computers:use": "self",
    // 2026-10-28: add_mcp_server adds to the person's own servers on an
    // organization server (Settings > Connections), never the shared list
    "mcp:add": "self",
  },
  // Automation never creates bots, widens access or runs host commands.
  // 2026-10-19: no person speaks in a service turn (a routine, a webhook):
  // pairing a device or asking a person for a login needs that person, a
  // team setup could create bots under Full access, and a bot's rules and
  // docs are lasting instructions untrusted text must not write.
  service: {
    "vm:exec": null, "actions:invoke": null, "settings:manage": null, "pairing:manage": null, "credentials:login": null,
    "teamsetup:propose": null, "rules:update": null, "docs:update": null,
  },
};

export interface McpPrincipal {
  id: string;
  role: string;
  /** Teams the principal acts for; "team" scope is judged against these. */
  teamIds?: readonly string[];
}

export interface McpDecision {
  allowed: boolean;
  /** The permission key, or the tool name when none is registered. */
  permission: string;
  requiredScope: McpScope;
  grantedScope: McpScope | null;
  reason: "ok" | "unknown_tool" | "unknown_role" | "not_granted" | "scope_too_narrow" | "resource_denied";
}

/** The scope a role holds for a permission: its own override or tier rule,
 * widened by the role it inherits (ROLE_INHERITS). A null override of the
 * role itself stays a denial. */
function grantedScope(role: McpRole, perm: McpPermission): McpScope | null {
  const overrides = ROLE_OVERRIDES[role];
  if (overrides && perm.key in overrides && overrides[perm.key] === null) return null;
  const own = (overrides && perm.key in overrides ? overrides[perm.key] : ROLE_TIER_SCOPES[role][perm.tier]) ?? null;
  const parent = ROLE_INHERITS[role];
  const inherited = parent ? grantedScope(parent, perm) : null;
  if (!own) return inherited;
  if (!inherited) return own;
  return rank(inherited) > rank(own) ? inherited : own;
}

/** `external`: the call goes to a person's external MCP server (the
 * Perspicax relay), so a tool Sagax does not list is judged as mcp:external,
 * not refused as unknown. */
export function decide(principal: McpPrincipal, tool: string, target: McpScope = "self", options?: { external?: boolean }): McpDecision {
  const perm = permissionForTool(tool) ?? (options?.external ? EXTERNAL_MCP_PERMISSION : undefined);
  if (!perm) return { allowed: false, permission: tool, requiredScope: target, grantedScope: null, reason: "unknown_tool" };
  if (!(MCP_ROLES as readonly string[]).includes(principal.role)) {
    return { allowed: false, permission: perm.key, requiredScope: target, grantedScope: null, reason: "unknown_role" };
  }
  const granted = grantedScope(principal.role as McpRole, perm);
  if (!granted) return { allowed: false, permission: perm.key, requiredScope: target, grantedScope: null, reason: "not_granted" };
  if (rank(target) > rank(granted)) return { allowed: false, permission: perm.key, requiredScope: target, grantedScope: granted, reason: "scope_too_narrow" };
  return { allowed: true, permission: perm.key, requiredScope: target, grantedScope: granted, reason: "ok" };
}

/** 2026-10-26 (a person's bots and rooms are theirs): who owns a bot or
 * a room the call names, for the principal the call acts for. A bot or a
 * room this principal owns is the call's own scope ("self"); an unknown
 * owner is someone else's. */
export interface ScopeOwners {
  /** The person the call acts for (McpPrincipal.id). */
  principalId: string;
  botOwner?(botId: string): string | undefined;
  roomOwner?(roomId: string): string | undefined;
  /** 2026-10-27 (#1098): a bot this person created after the list was
   * handed over (a warm proxy keeps its spawn environment): theirs. */
  learnBot?(botId: string): void;
  /** 2026-10-28: a bot someone else owns and shares with this person at
   * `run` or above. Asking or delegating to it (DISPATCH_TO_SHARED_TOOLS)
   * is the person's own work; nothing else about it is (archiving it,
   * changing it, posting in its rooms stay the team scope). */
  runBot?(botId: string): boolean;
}

/** 2026-10-28: the tools that hand work to a bot shared with the person at
 * `run`: the sharing level is exactly that right. */
export const DISPATCH_TO_SHARED_TOOLS: ReadonlySet<string> = new Set(["ask_bot", "delegate_bot"]);

/** The scope a call reaches, read from its arguments. Anything naming a bot
 * other than the caller, a room or a team is team, unless `owners` says
 * that bot or room is the acting person's own (then self); an explicit org
 * scope or an all-organization flag is org. Otherwise self. Conservative on
 * purpose: a wider guess only ever needs a wider grant. */
export function scopeForCall(args: Record<string, unknown> | undefined, ownBotId: string, owners?: ScopeOwners, tool?: string): McpScope {
  if (!args) return "self";
  if (args.scope === "org" || args.all === true || args.organization === true) return "org";
  if (args.scope === "team") return "team";
  const person = owners?.principalId.trim().toLowerCase() ?? "";
  const mine = (owner: string | undefined) => Boolean(person) && typeof owner === "string" && owner.trim().toLowerCase() === person;
  // 2026-10-28: ask_bot or delegate_bot to a bot shared with the person at run
  const runnable = (botId: string) => tool !== undefined && DISPATCH_TO_SHARED_TOOLS.has(tool) && owners?.runBot?.(botId) === true;
  for (const key of ["bot_id", "for_bot_id", "agent_id", "to_bot_id", "target_bot_id"]) {
    const value = args[key];
    if (typeof value === "string" && value && value !== ownBotId && !mine(owners?.botOwner?.(value)) && !runnable(value)) return "team";
  }
  for (const key of ["room_id", "group_id", "team_id", "section"]) {
    const value = args[key];
    if (typeof value !== "string" || !value) continue;
    // 2026-10-28: group_id is a room id too (post_to_room, coordinate_bots,
    // nudge_person take it from list_rooms): the person's own room is theirs
    if ((key === "room_id" || key === "group_id") && mine(owners?.roomOwner?.(value))) continue;
    return "team";
  }
  return "self";
}

/** The acting person's own bots and rooms, as the harness hands them to the
 * agents proxy (SAGAX_MCP_OWN_BOTS, SAGAX_MCP_OWN_ROOMS, comma separated):
 * a resolver for scopeForCall. Nothing listed: nothing is the person's. */
export function scopeOwnersFromEnv(env: NodeJS.ProcessEnv, principalId: string): ScopeOwners {
  const list = (value: string | undefined) => new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const bots = list(env.SAGAX_MCP_OWN_BOTS);
  const rooms = list(env.SAGAX_MCP_OWN_ROOMS);
  const runBots = list(env.SAGAX_MCP_RUN_BOTS);
  return {
    principalId,
    botOwner: (botId) => (bots.has(botId) ? principalId : undefined),
    roomOwner: (roomId) => (rooms.has(roomId) ? principalId : undefined),
    learnBot: (botId) => { if (botId.trim()) bots.add(botId.trim()); },
    runBot: (botId) => runBots.has(botId),
  };
}

/** The id create_bot reports (`Created @name in Section [id: <id>].`),
 * learned as one of the acting person's bots (ScopeOwners.learnBot). */
export function learnCreatedBot(owners: ScopeOwners | undefined, resultText: string): void {
  const id = /\[id: ([\w.:-]{1,128})\]/.exec(resultText)?.[1];
  if (id) owners?.learnBot?.(id);
}

const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** What the Perspicax catalog knows: api (profile) id to its resource names. */
export type ApiCatalog = ReadonlyMap<string, ReadonlySet<string>>;

/** The per-resource key of a per-profile Perspicax call, from its name and
 * arguments: `<profile>:<resource>.<verb>`.
 *   - `cw_psa__query` { resource: "tickets" }               cw_psa:tickets.read
 *   - `cw_psa__write` { resource: "tickets", action: "update" } cw_psa:tickets.update
 *   - `cw_psa__tickets_write` { action: "delete" }            cw_psa:tickets.delete
 *   - `cw_psa__action` { action: "merge" }                    cw_psa:merge.run
 *   - `cw_psa__read_action` { action: "usage" }               cw_psa:usage.read
 *   - `cw_psa__find_tickets`                                  cw_psa:find_tickets.run
 * Null for any other tool, or when a segment is missing or not a plain slug.
 * With a catalog, a profile it does not list, or a query or write on a
 * resource it does not list, gives null, so a made up name can never match a
 * grant or a deny. */
export function resourceKeyForCall(tool: string, args: Record<string, unknown> | undefined, catalog?: ApiCatalog): string | null {
  const call = profileToolCall(tool);
  if (!call) return null;
  const clean = (v: unknown) => (typeof v === "string" && SEGMENT.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
  const a = args ?? {};
  const profile = clean(call.profile);
  let resource: string | null;
  let verb: string | null;
  switch (call.kind) {
    case "query": resource = clean(a.resource); verb = "read"; break;
    case "write": resource = call.name === "write" ? clean(a.resource) : clean(call.name.slice(0, -"_write".length)); verb = clean(a.action); break;
    case "action": resource = clean(a.action); verb = "run"; break;
    case "read_action": resource = clean(a.action); verb = "read"; break;
    default: resource = clean(call.name); verb = "run";
  }
  if (!profile || !resource || !verb) return null;
  if (catalog) {
    const known = catalog.get(profile);
    if (!known || ((call.kind === "query" || call.kind === "write") && !known.has(resource))) return null;
  }
  return `${profile}:${resource}.${verb}`;
}

/** Deny rules for resource keys: exact (`cw:ticket.update`), `cw:ticket.*`
 * or `cw:*`. Read from SAGAX_MCP_DENY, comma separated. */
export function resourceDenied(key: string, rules: readonly string[]): boolean {
  return rules.some((rule) => {
    if (rule === key) return true;
    if (rule.endsWith(".*")) return key.startsWith(rule.slice(0, -1));
    if (rule.endsWith(":*")) return key.startsWith(rule.slice(0, -1));
    return false;
  });
}

export const deniedResourcesFromEnv = (env: NodeJS.ProcessEnv): string[] => (env.SAGAX_MCP_DENY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export type McpPermissionMode = "off" | "shadow" | "enforce";

/** off skips the check, shadow audits a denial and lets the call through,
 * enforce refuses it. Unset or unreadable is shadow. */
export function permissionModeFromEnv(env: NodeJS.ProcessEnv): McpPermissionMode {
  const value = (env.SAGAX_MCP_PERMISSIONS ?? "").trim().toLowerCase();
  return value === "off" || value === "enforce" ? value : "shadow";
}

export function principalFromEnv(env: NodeJS.ProcessEnv): McpPrincipal {
  return {
    id: env.SAGAX_MCP_PRINCIPAL || env.SAGAX_BOT_ID || "unknown",
    role: (env.SAGAX_MCP_ROLE || "member").trim().toLowerCase(),
    teamIds: (env.SAGAX_MCP_TEAMS || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** One row per call. Never carries arguments, text or results. */
export interface McpAuditRecord {
  at: string;
  principal: string;
  role: string;
  tool: string;
  permission: string;
  scope: McpScope;
  decision: "allowed" | "denied";
  reason: McpDecision["reason"];
  /** The per-resource key for an api_* call, when one applies. */
  resource?: string;
  /** False when the denial was only recorded (shadow mode). */
  enforced: boolean;
}

export type McpAuditHook = (record: McpAuditRecord) => void;

export interface GuardOptions {
  principal: McpPrincipal;
  mode: McpPermissionMode;
  ownBotId: string;
  audit: McpAuditHook;
  /** Resource deny rules (see resourceDenied) and the catalog that vets names. */
  deniedResources?: readonly string[];
  catalog?: ApiCatalog;
  /** Who owns the bots and rooms a call names (scopeForCall). */
  owners?: ScopeOwners;
  /** The calls go to an external MCP server that authorizes its own tools
   * (the Perspicax relay): a tool Sagax does not list is mcp:external. */
  external?: boolean;
  /** Shadow mode only: the share of allowed calls audited, 0 (default) to 1.
   * Enforce audits every call; shadow audits every denial. */
  allowedSample?: number;
  random?: () => number;
  now?: () => Date;
}

export interface GuardedResult {
  text: string;
  isError?: boolean;
  passthrough?: unknown;
}

export const permissionDeniedText = (d: McpDecision): string =>
  `Permission denied: ${d.permission} (${d.reason.replace(/_/g, " ")}, needs ${d.requiredScope} scope). Ask an administrator to grant it.`;

/** Whether this decision gets an audit row. Enforce: every call (rule 3 of
 * docs/mcp/permissions.md). Shadow: every denial, and an allowed call only
 * within allowedSample: in shadow nothing is refused, so the denials are what
 * the audit is for, and one row per allowed tool call (one local POST and one
 * activity-log line each, many per turn) would bury them. */
function auditable(options: GuardOptions, allowed: boolean): boolean {
  if (!allowed || options.mode === "enforce") return true;
  const share = options.allowedSample ?? 0;
  return share > 0 && (options.random ?? Math.random)() < share;
}

/** SAGAX_MCP_AUDIT_SAMPLE: the share of allowed calls shadow mode audits
 * (0 to 1; unset, unreadable or out of range is 0). */
export function auditSampleFromEnv(env: NodeJS.ProcessEnv): number {
  const value = Number((env.SAGAX_MCP_AUDIT_SAMPLE ?? "").trim());
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0;
}

/** Wraps one tool call. The audit hook never throws into the call. */
export async function guardToolCall<R extends GuardedResult>(options: GuardOptions, tool: string, args: Record<string, unknown> | undefined, run: () => Promise<R>): Promise<R | GuardedResult> {
  if (options.mode === "off") return run();
  const scope = scopeForCall(args, options.ownBotId, options.owners, tool);
  let decision = decide(options.principal, tool, scope, { external: options.external === true });
  const resource = resourceKeyForCall(tool, args, options.catalog) ?? undefined;
  if (decision.allowed && resource && resourceDenied(resource, options.deniedResources ?? [])) {
    decision = { ...decision, allowed: false, permission: resource, reason: "resource_denied" };
  }
  const enforced = options.mode === "enforce";
  const blocked = !decision.allowed && enforced;
  try {
    if (auditable(options, decision.allowed)) options.audit({
      at: (options.now?.() ?? new Date()).toISOString(),
      principal: options.principal.id,
      role: options.principal.role,
      tool,
      permission: decision.permission,
      scope,
      decision: decision.allowed ? "allowed" : "denied",
      reason: decision.reason,
      ...(resource ? { resource } : {}),
      enforced: !decision.allowed && enforced,
    });
  } catch {
    // A broken sink must not decide the call; a denial still stands.
  }
  if (blocked) return { text: permissionDeniedText(decision), isError: true };
  return run();
}

/** The policy variables the harness hands the agents proxy, read from the
 * server's own environment, so the proxy judges with the server's mode, deny
 * rules and audit sample whatever environment the engine spawns it with. */
export function mcpPolicyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const deny = deniedResourcesFromEnv(env).join(",");
  const sample = auditSampleFromEnv(env);
  return {
    SAGAX_MCP_PERMISSIONS: permissionModeFromEnv(env),
    ...(deny ? { SAGAX_MCP_DENY: deny } : {}),
    ...(sample ? { SAGAX_MCP_AUDIT_SAMPLE: String(sample) } : {}),
  };
}

/** The identity variables the harness gives the proxy (docs/mcp/permissions.md,
 * rule 5). A turn with no person speaking (a routine, a webhook) is a
 * service; the Perspicax role maps admin to admin, manager to operator,
 * anyone else to member. Nothing here is a credential. */
export function mcpIdentityEnv(input: { botId: string; principalId?: string; perspicaxRole?: string; teamIds?: readonly string[]; ownBotIds?: readonly string[]; ownRoomIds?: readonly string[]; runBotIds?: readonly string[] }): Record<string, string> {
  const role: McpRole = !input.principalId ? "service" : input.perspicaxRole === "admin" ? "admin" : input.perspicaxRole === "manager" ? "operator" : "member";
  const ids = (list: readonly string[] | undefined) => (list ?? []).filter((id) => /^[\w.:-]{1,128}$/.test(id)).join(",");
  // the person's own bots and rooms (scopeOwnersFromEnv), only when a person speaks
  const ownBots = input.principalId ? ids(input.ownBotIds) : "";
  const ownRooms = input.principalId ? ids(input.ownRoomIds) : "";
  // 2026-10-28: bots shared with the person at run (ScopeOwners.runBot)
  const runBots = input.principalId ? ids(input.runBotIds) : "";
  return {
    SAGAX_MCP_ROLE: role,
    SAGAX_MCP_PRINCIPAL: input.principalId || input.botId,
    SAGAX_MCP_TEAMS: ids(input.teamIds),
    ...(ownBots ? { SAGAX_MCP_OWN_BOTS: ownBots } : {}),
    ...(ownRooms ? { SAGAX_MCP_OWN_ROOMS: ownRooms } : {}),
    ...(runBots ? { SAGAX_MCP_RUN_BOTS: runBots } : {}),
  };
}

/** The activity-log row of one audit record. Fields are copied one by one:
 * nothing else a proxy sends is kept. */
export function mcpAuditRow(record: McpAuditRecord, botId: string) {
  return {
    category: "security" as const,
    action: record.decision === "denied" ? (record.enforced ? "mcp.deny" : "mcp.shadow") : "mcp.call",
    target: { kind: "bot", id: botId },
    after: {
      tool: String(record.tool).slice(0, 100),
      permission: String(record.permission).slice(0, 100),
      scope: record.scope,
      role: String(record.role).slice(0, 40),
      reason: record.reason,
      enforced: record.enforced === true,
      ...(record.resource ? { resource: String(record.resource).slice(0, 160) } : {}),
    },
    at: record.at,
  };
}
