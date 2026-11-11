// Visible roles (2026-11-05, all five ideas). One Perspicax account
// connection per turn acts as one role at a time: "Moi" (the person's own
// default surface: the union of held roles minus the explicit-only ones) or
// a held role picked with identity_switch / profile_use. This module is the
// one place that reads the role listing, names a role, tells a read 403
// from a write 403, maps a refused ConnectWise call to the permission an
// administrator would fix, and computes a routine role's coverage.
//
// Rules made explicit in product:
// - chat: no selection, the default surface ("Moi");
// - routine: its "Au nom de" role, else the first held role covering its
//   standing mandate; an empty mandate is read-only;
// - a switch is allowed to any role held now; a role not held is refused;
// - a read 403 under a role: Sagax tries the other held roles that may read it;
// - a write 403 (rule d7-403-switch-role): one held role that may write, by a
//   saved rule or a card, for that one call; refused, that write stops, the
//   turn's other calls and switches go on (#3694);
// - a guard or policy refusal of the connector and a dry run are not role
//   refusals (#3694);
// - a lapsed role stops the call and shows a banner;
// - writing as "Moi" in a routine that runs under a role needs the person.

/** The slug of "Moi": no act-as role, the person's own default surface. */
export const ME_ROLE = "";

/** What a held role may do (Perspicax `profile_can`). Sagax-derived flags
 * are null when Perspicax had no catalogue cached. */
export interface RoleCan {
  read: boolean;
  write: boolean;
  routines_run?: boolean | null;
  approvals_answer?: boolean | null;
  flow?: boolean | null;
  sagax?: boolean | null;
}

/** One role the person holds now, from `identity_switch` without argument. */
export interface HeldRole {
  slug: string;
  name: string;
  /** Perspicax profile id (journal `acting_as`), when the listing serves it. */
  id?: string;
  readOnly: boolean;
  explicitOnly: boolean;
  reachable: boolean;
  can?: RoleCan;
}

/** Why a step runs under its role. */
export type RoleReason =
  /** chat default: no selection ("Moi", the union minus explicit-only) */
  | "default"
  /** the routine's "Au nom de" role (or its computed default) */
  | "routine"
  /** the person picked it in the composer for this turn */
  | "person"
  /** the bot switched with identity_switch / profile_use */
  | "switch"
  /** a read was refused (403) under the previous role: one call as "Moi" */
  | "fallback"
  /** a saved "Toujours ainsi" rule of the bot's owner answered the fallback */
  | "rule";

/** The role a tool step ran under, as the thread shows it. */
export interface ToolRole {
  slug: string;
  name: string;
  reason: RoleReason;
  /** fallback / rule: the tool whose read was refused under `previous`. */
  refusedTool?: string;
  /** fallback / rule / switch: the role before this step. */
  previous?: { slug: string; name: string };
  /** the person "Moi" is: "au nom de <person>" */
  person?: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function canOf(value: unknown): RoleCan | undefined {
  if (!object(value)) return undefined;
  const flag = (key: string): boolean | null | undefined =>
    value[key] === true ? true : value[key] === false ? false : value[key] === null ? null : undefined;
  return {
    read: value.read !== false,
    write: value.write === true,
    ...(flag("routines_run") !== undefined ? { routines_run: flag("routines_run") } : {}),
    ...(flag("approvals_answer") !== undefined ? { approvals_answer: flag("approvals_answer") } : {}),
    ...(flag("flow") !== undefined ? { flow: flag("flow") } : {}),
    ...(flag("sagax") !== undefined ? { sagax: flag("sagax") } : {}),
  };
}

/** The held roles of an `identity_switch` (or `profile_use`) listing. Bounded,
 * names trimmed; a row without a slug or a name is dropped. */
export function heldRolesOf(listing: unknown): HeldRole[] {
  const profiles = object(listing) && Array.isArray(listing.profiles) ? listing.profiles : [];
  const out: HeldRole[] = [];
  for (const row of profiles.slice(0, 100)) {
    if (!object(row) || typeof row.slug !== "string" || !row.slug.trim()) continue;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 80) : row.slug.trim();
    const can = canOf(row.can);
    out.push({
      slug: row.slug.trim().slice(0, 120),
      name,
      ...(typeof row.id === "string" && row.id.trim() ? { id: row.id.trim().slice(0, 120) } : {}),
      readOnly: row.read_only === true || (can ? !can.write : false),
      explicitOnly: row.explicit_only === true,
      reachable: row.reachable !== false,
      ...(can ? { can } : {}),
    });
  }
  return out;
}

/** The role in use in a listing (`acting_as`), with the profile id read from
 * its act-as token scope (`profile:<id>`). Null on the default surface. */
export function actingAsOf(listing: unknown): { slug: string; name?: string; id?: string } | null {
  const acting = object(listing) && object(listing.acting_as) ? listing.acting_as : null;
  if (!acting || typeof acting.slug !== "string" || !acting.slug) return null;
  const token = object(acting.token) ? acting.token : {};
  const scope = typeof token.scope === "string" ? token.scope : Array.isArray(token.scope) ? token.scope.find((s) => typeof s === "string" && s.startsWith("profile:")) : undefined;
  const id = typeof scope === "string" && scope.startsWith("profile:") ? scope.slice("profile:".length) : undefined;
  return { slug: acting.slug, ...(typeof acting.name === "string" && acting.name ? { name: acting.name } : {}), ...(id ? { id } : {}) };
}

/** Chat default: every held role except the explicit-only ones. A person who
 * holds only explicit-only roles is still served them (Perspicax phase 1). */
export function chatDefaultRoles(held: readonly HeldRole[]): HeldRole[] {
  const usual = held.filter((role) => !role.explicitOnly);
  return usual.length > 0 ? usual : [...held];
}

/** The display name of a slug among the held roles; "" is "Moi" (the
 * caller supplies the word in its language). */
export function roleName(slug: string, held: readonly HeldRole[] | undefined, me: string): string {
  if (!slug) return me;
  return held?.find((role) => role.slug === slug)?.name ?? slug;
}

/** What `can` allows, as stable keys the UI words ("peut : lire, écrire …"). */
export function roleAbilities(can: RoleCan | undefined): Array<"read" | "write" | "routines_run" | "approvals_answer" | "flow" | "sagax"> {
  if (!can) return ["read"];
  const keys = ["read", "write", "routines_run", "approvals_answer", "flow", "sagax"] as const;
  return keys.filter((key) => can[key] === true);
}

// ---------------------------------------------------------------------------
// Refusals

/** A Perspicax tool error that is a refusal (HTTP class 403), never an
 * act-as lapse (`act_as_expired`, served as the read plane). */
export interface RoleRefusal {
  status: 403;
  reason?: string;
  code?: string;
  message?: string;
}

function textOf(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.filter(object).map((block) => (typeof block.text === "string" ? block.text : "")).join("\n").slice(0, 4000);
}

/** #3694: the connector's `policy_denied` reasons that mean the acting role
 * or profile lacks the right for this operation (the connector's own
 * missing-right reasons, and its read-only and explicit-only profile
 * refusals). Another `policy_denied` (a Flow guard, the data access policy,
 * a state or a limit) is not a role refusal: another role does not change it. */
const ROLE_RIGHT_REASONS: ReadonlySet<string> = new Set(["twilio_guard", "no_twilio_product", "no_connectwise", "read_only_profile", "explicit_only_profile"]);

/** #3694: whether a connector error envelope is a real permission refusal,
 * by the connector's own code and fields, never by the words of its message:
 * the vendor's own 403 (`upstream_error`, `details.status` 403) or the
 * connector's refusal of the role or profile for that operation. A guard or
 * policy refusal (`details.flow_guard`, any other `policy_denied` reason), an
 * unknown operation or resource and a validation error are not. An envelope
 * without a code keeps its `details.status`. */
function envelopeRefuses(code: string | undefined, details: Record<string, unknown>, status: unknown): boolean {
  if (details.reason === "act_as_expired" || details.flow_guard !== undefined) return false;
  if (code === "policy_denied") return typeof details.reason === "string" && ROLE_RIGHT_REASONS.has(details.reason);
  if (code === "upstream_error") return Number(details.status ?? status) === 403;
  if (code !== undefined) return false;
  return Number(details.status ?? status) === 403;
}

/** Whether a JSON-RPC tools/call body is a real permission refusal (the
 * connector's error envelope `{code, message, hint, details: {status,
 * reason}}` in the structured content or in a text block, judged by
 * `envelopeRefuses`; with no envelope at all, the vendor's own 403 named in
 * the text). Null when it is not. */
export function roleRefusalOf(body: unknown): RoleRefusal | null {
  if (!object(body)) return null;
  if (object(body.error)) {
    const data = object(body.error.data) ? body.error.data : {};
    const details = object(data.details) ? data.details : data;
    const code = typeof data.code === "string" ? data.code : undefined;
    if (envelopeRefuses(code, details, data.status)) {
      return { status: 403, ...(typeof details.reason === "string" ? { reason: details.reason } : {}), ...(code ? { code } : {}), ...(typeof body.error.message === "string" ? { message: body.error.message.slice(0, 300) } : {}) };
    }
    return null;
  }
  const result = object(body.result) ? body.result : null;
  if (!result || result.isError !== true) return null;
  let envelope: Record<string, unknown> | null = object(result.structuredContent) ? result.structuredContent : null;
  const text = textOf(result);
  if (!envelope) {
    try { const parsed: unknown = JSON.parse(text); if (object(parsed)) envelope = parsed; } catch { /* prose */ }
  }
  const nested = envelope && object(envelope.error) ? envelope.error : envelope;
  const details = nested && object(nested.details) ? nested.details : {};
  const reason = typeof details.reason === "string" ? details.reason : undefined;
  const code = nested && typeof nested.code === "string" ? nested.code : undefined;
  const message = nested && typeof nested.message === "string" ? nested.message.slice(0, 300) : text.slice(0, 300);
  if (nested && (code !== undefined || object(nested.details) || nested.status !== undefined)) {
    return envelopeRefuses(code, details, nested.status) ? { status: 403, ...(reason ? { reason } : {}), ...(code ? { code } : {}), ...(message ? { message } : {}) } : null;
  }
  // no envelope of the connector: the vendor's own 403 in its words
  if (/\b403\b|\bforbidden\b|not authori[sz]ed to|permission denied|insufficient permission/i.test(text) && !/act_as_expired/.test(text)) {
    return { status: 403, ...(message ? { message } : {}) };
  }
  return null;
}

/** A ConnectWise operation, as an administrator fixes it in a security role. */
export type CwOperation = "Inquire" | "Add" | "Edit" | "Delete";

/** The permission a refused call needs: the CW API path, its security role
 * module and function (best known), and the operation level. */
export interface CwPermission {
  /** CW REST path family, `schedule/entries`; "" when the tool is not CW. */
  path: string;
  /** Security role module, `Service Desk`; "" when unknown. */
  module: string;
  /** Security role function, `Service Tickets`; else the path. */
  func: string;
  operation: CwOperation;
}

/** CW REST path family → security role module and function. The module
 * names follow ConnectWise Manage's security role screen. */
const CW_AREAS: ReadonlyArray<[prefix: string, module: string, func: string]> = [
  ["service/tickets", "Service Desk", "Service Tickets"],
  ["service/boards", "System", "Table Setup"],
  ["schedule/holidaylists", "System", "Table Setup"],
  ["schedule/holidays", "System", "Table Setup"],
  ["schedule/entries", "Time & Expense", "Schedule Entries"],
  ["schedule", "Time & Expense", "Schedule Entries"],
  ["time/entries", "Time & Expense", "Time Entry"],
  ["time/sheets", "Time & Expense", "Timesheet Approval"],
  ["expense", "Time & Expense", "Expense Entry"],
  ["project/tickets", "Project", "Project Tickets"],
  ["project/projects", "Project", "Project Headers"],
  ["project", "Project", "Project Headers"],
  ["system/workflows", "System", "Workflow Rules"],
  ["system/members", "System", "Member Maintenance"],
  ["system/securityroles", "System", "Security Roles"],
  ["system", "System", "Table Setup"],
  ["finance/invoices", "Finance", "Invoicing"],
  ["finance/agreements", "Finance", "Agreements"],
  ["finance", "Finance", "Invoicing"],
  ["sales/activities", "Sales", "Sales Activities"],
  ["sales/opportunities", "Sales", "Opportunity"],
  ["sales", "Sales", "Opportunity"],
  ["company/contacts", "Companies", "Contacts"],
  ["company/configurations", "Companies", "Configurations"],
  ["company/companies", "Companies", "Company Maintenance"],
  ["company", "Companies", "Company Maintenance"],
  ["procurement", "Procurement", "Product Catalog"],
  ["marketing", "Marketing", "Groups"],
];

/** Named CW helper tools and the path family / operation they use. */
const CW_NAMED: Readonly<Record<string, [path: string, op: CwOperation]>> = {
  cw_psa_get_ticket: ["service/tickets", "Inquire"],
  cw_psa_find_tickets: ["service/tickets", "Inquire"],
  cw_psa_update_ticket: ["service/tickets", "Edit"],
  cw_psa_find_project_tickets: ["project/tickets", "Inquire"],
  cw_psa_find_time_entries: ["time/entries", "Inquire"],
  cw_psa_log_time: ["time/entries", "Add"],
  cw_psa_find_schedule_entries: ["schedule/entries", "Inquire"],
  cw_psa_book_schedule_entry: ["schedule/entries", "Add"],
  cw_psa_find_members: ["system/members", "Inquire"],
  cw_psa_find_companies: ["company/companies", "Inquire"],
  cw_psa_find_agreements: ["finance/agreements", "Inquire"],
  cw_psa_find_opportunities: ["sales/opportunities", "Inquire"],
};

function areaOf(path: string): { module: string; func: string } {
  const lower = path.toLowerCase().replace(/^\/+/, "");
  // #3694: a path the table names, or one under it; never a resource that
  // only starts with the same letters (a mistyped "schedule_entries")
  for (const [prefix, module, func] of CW_AREAS) if (lower === prefix || lower.startsWith(`${prefix}/`)) return { module, func };
  return { module: "", func: path };
}

function operationOf(action: unknown, read: boolean): CwOperation {
  if (read) return "Inquire";
  const text = typeof action === "string" ? action.toLowerCase() : "";
  if (/delete|remove/.test(text)) return "Delete";
  if (/create|add|post|book|log/.test(text)) return "Add";
  return "Edit";
}

/** The CW permission a call to `tool` with `args` needs. `read` is whether
 * the relay classed the call as a read. Not a CW call: path "". */
export function cwPermissionFor(tool: string, args: unknown, read: boolean): CwPermission {
  const name = tool.replace(/_{2,}/g, "_");
  const a = object(args) ? args : {};
  const named = CW_NAMED[name];
  if (named) {
    const [path, op] = named;
    return { path, ...areaOf(path), operation: read ? "Inquire" : op };
  }
  if (!name.startsWith("cw_psa")) return { path: "", module: "", func: tool, operation: read ? "Inquire" : operationOf(a.action, false) };
  // cw_psa_query / cw_psa_action / cw_psa_write: the path is an argument
  const given = [a.resource, a.path, a.endpoint, a.entity, a.collection].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  // #2960: "service.tickets" (the dotted resource the conventions name) and
  // "service/tickets" are one permission path: one key for tries, declines,
  // rules and notes
  let path = given ? given.trim().replace(/\./g, "/").replace(/^\/+/, "").replace(/\/\d+.*$/, "").replace(/\{[^}]*\}.*$/, "").replace(/\/+$/, "") : "";
  if (!path) {
    // cw_psa_<group>_<entity>_write → group/entity
    const middle = name.replace(/^cw_psa_/, "").replace(/_(write|query|action)$/, "");
    const [group, ...rest] = middle.split("_");
    if (group && rest.length) path = `${group}/${rest.join("")}`;
  }
  return { path, ...areaOf(path), operation: read ? "Inquire" : operationOf(a.action ?? a.method, false) };
}

// ---------------------------------------------------------------------------
// Routines: standing mandate coverage

/** Flow standing mandate items and the CW write each needs (Flow guide,
 * "Standing mandate items"). An item not listed is a non-CW write. */
export const MANDATE_WRITES: Readonly<Record<string, { path: string; operation: CwOperation }>> = {
  schedule_create: { path: "schedule/entries", operation: "Add" },
  schedule_move_requested: { path: "schedule/entries", operation: "Edit" },
  schedule_move_for_fixed_hour: { path: "schedule/entries", operation: "Edit" },
  assignee: { path: "schedule/entries", operation: "Add" },
  r08_reassign: { path: "schedule/entries", operation: "Add" },
  r08_phantom: { path: "schedule/entries", operation: "Add" },
  r08_distribute: { path: "schedule/entries", operation: "Add" },
  owner_duplicate_delete: { path: "schedule/entries", operation: "Delete" },
  status_change: { path: "service/tickets", operation: "Edit" },
  summary_rewrite: { path: "service/tickets", operation: "Edit" },
  summary_task_close: { path: "service/tickets", operation: "Edit" },
  owner_write: { path: "service/tickets", operation: "Edit" },
  child_classification: { path: "service/tickets", operation: "Edit" },
  classification_fill: { path: "service/tickets", operation: "Edit" },
  due_date_set: { path: "service/tickets", operation: "Edit" },
  board_move: { path: "service/tickets", operation: "Edit" },
  company_reparent: { path: "service/tickets", operation: "Edit" },
  customer_updated_clear: { path: "service/tickets", operation: "Edit" },
  close_advertising: { path: "service/tickets", operation: "Edit" },
  resolve_info_notice: { path: "service/tickets", operation: "Edit" },
  close_children: { path: "service/tickets", operation: "Edit" },
  reclose_courtesy: { path: "service/tickets", operation: "Edit" },
  client_note: { path: "service/tickets", operation: "Add" },
  invoice_status: { path: "finance/invoices", operation: "Edit" },
  project_percent_complete: { path: "project/projects", operation: "Edit" },
  activity_close: { path: "sales/activities", operation: "Edit" },
};

/** A refusal Sagax logged for a role (bot's Roles tab, routine coverage). */
export interface RoleRefusalRecord {
  role: string;
  path: string;
  operation: CwOperation;
}

const rank: Record<CwOperation, number> = { Inquire: 0, Add: 1, Edit: 2, Delete: 3 };

function refused(records: readonly RoleRefusalRecord[], role: string, path: string, operation: CwOperation): boolean {
  const p = path.toLowerCase();
  return records.some((r) => r.role === role && r.path && (p === r.path.toLowerCase() || p.startsWith(`${r.path.toLowerCase()}/`) || r.path.toLowerCase().startsWith(`${p}/`))
    && (r.operation === operation || (r.operation === "Inquire" && rank[operation] > 0)));
}

export interface RoleCoverage {
  role: string;
  /** mandate items this role can write */
  covered: string[];
  /** items it cannot, with why (read-only role or a known refusal) */
  notCovered: Array<{ item: string; why: "read_only" | "refused"; permission?: CwPermission }>;
  /** known refused reads of this role (logged 403s) */
  refusedReads: CwPermission[];
  /** green: every item covered and no known refused read */
  ok: boolean;
}

/** Coverage of a routine's standing mandate by one role ("" = Moi). An empty
 * mandate is read-only: every role covers it. */
export function roleCoverage(role: string, held: readonly HeldRole[], mandate: readonly string[], refusals: readonly RoleRefusalRecord[]): RoleCoverage {
  const info = role ? held.find((r) => r.slug === role) : undefined;
  const canWrite = role ? Boolean(info && !info.readOnly && info.can?.write !== false) : true;
  const covered: string[] = [];
  const notCovered: RoleCoverage["notCovered"] = [];
  for (const item of mandate) {
    const write = MANDATE_WRITES[item];
    if (!canWrite) { notCovered.push({ item, why: "read_only" }); continue; }
    if (write && refused(refusals, role, write.path, write.operation)) {
      notCovered.push({ item, why: "refused", permission: { path: write.path, ...areaOf(write.path), operation: write.operation } });
      continue;
    }
    covered.push(item);
  }
  const seen = new Set<string>();
  const refusedReads: CwPermission[] = [];
  for (const record of refusals) {
    if (record.role !== role || record.operation !== "Inquire" || seen.has(record.path)) continue;
    seen.add(record.path);
    refusedReads.push({ path: record.path, ...areaOf(record.path), operation: "Inquire" });
  }
  return { role, covered, notCovered, refusedReads, ok: notCovered.length === 0 && refusedReads.length === 0 };
}

/** How broad a role is: fewer abilities and a narrower surface is smaller. */
function breadth(role: HeldRole | undefined): number {
  if (!role) return 100; // Moi: the person's whole surface
  return roleAbilities(role.can).length + (role.readOnly ? 0 : 10) + (role.explicitOnly ? 20 : 0);
}

/** The smallest held role (or "" = Moi) whose coverage is complete, or the
 * one covering the most items. An empty mandate picks the smallest read
 * role. `preferred` (Flow `server_profiles`, in order) wins a tie. */
export function minimalRole(held: readonly HeldRole[], mandate: readonly string[], refusals: readonly RoleRefusalRecord[], preferred: readonly string[] = []): string {
  const candidates = [...held.filter((role) => role.reachable && !role.explicitOnly).map((role) => role.slug), ME_ROLE];
  const order = (slug: string) => { const at = preferred.indexOf(slug); return at < 0 ? preferred.length : at; };
  const scored = candidates.map((slug) => {
    const coverage = roleCoverage(slug, held, mandate, refusals);
    return { slug, full: coverage.notCovered.length === 0, covered: coverage.covered.length, breadth: breadth(held.find((r) => r.slug === slug)) };
  });
  scored.sort((a, b) => Number(b.full) - Number(a.full) || b.covered - a.covered || order(a.slug) - order(b.slug) || a.breadth - b.breadth);
  return scored[0]?.slug ?? ME_ROLE;
}

/** A routine's default role: the first role of `serverProfiles` (Flow
 * order) that is held and covers the mandate, else the minimal one. */
export function routineDefaultRole(held: readonly HeldRole[], mandate: readonly string[], serverProfiles: readonly string[], refusals: readonly RoleRefusalRecord[]): string {
  for (const slug of serverProfiles) {
    if (!held.some((role) => role.slug === slug)) continue;
    if (roleCoverage(slug, held, mandate, refusals).notCovered.length === 0) return slug;
  }
  return minimalRole(held, mandate, refusals, serverProfiles);
}

/** The standing mandate and server profiles of a Flow `describe` card. */
export function routineMandateOf(card: unknown): { mandate: string[]; serverProfiles: string[] } {
  const routine = object(card) && object(card.routine) ? card.routine : object(card) ? card : {};
  const inputs = object(routine.inputs) ? routine.inputs : {};
  const meta = object(routine.meta) ? routine.meta : {};
  const list = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 80);
  const mandate = list(inputs.standing_mandate ?? meta.standing_mandate ?? routine.standing_mandate);
  const serverProfiles = list(routine.server_profiles ?? inputs.server_profiles ?? meta.server_profiles);
  return { mandate, serverProfiles };
}

// ---------------------------------------------------------------------------
// Bot role rules ("Toujours ainsi pour ce bot")

/** A rule the bot's owner saved from an "Agit comme" card. It belongs to the
 * owner: a bot delegated to another person starts from the default. */
export interface BotRoleRule {
  id: string;
  /** the role whose refused read falls back */
  from: { slug: string; name: string };
  /** where it falls back: "" = Moi */
  to: { slug: string; name: string };
  /** CW path family of the refused read, "" = any read */
  path: string;
  /** owner principal id */
  ownerId: string;
  createdAt: number;
}

/** #2960: the comparison key of a CW permission path. "service.tickets"
 * (saved before 2026-11-08 by a dotted resource) and "service/tickets" are
 * one path, so rules and journal entries saved under either still match. */
export function permissionPathKey(path: string | undefined): string {
  return (path ?? "").trim().toLowerCase().replace(/\./g, "/").replace(/^\/+|\/+$/g, "");
}

/** The rule (if any) that answers a read refused under `from` on `path`. */
export function matchingRoleRule(rules: readonly BotRoleRule[] | undefined, ownerId: string, from: string, path: string): BotRoleRule | undefined {
  const p = permissionPathKey(path);
  return rules?.find((rule) => {
    const own = permissionPathKey(rule.path);
    return rule.ownerId === ownerId && rule.from.slug === from && (!own || p === own || p.startsWith(`${own}/`));
  });
}
