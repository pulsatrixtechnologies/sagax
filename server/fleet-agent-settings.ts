// Fleet agent settings helpers (#1944): accepted Edit-bot fields, engine
// instance resolution, plain refusal reasons, and routing of runtime /
// Primary Bot fields. Derived from MEMBER_BOT_FIELDS + BOT_FIELD_PERMISSIONS
// so a second hand allowlist cannot drift from the server's PATCH gates.
import { BOT_FIELD_PERMISSIONS } from "../shared/permissions.ts";
import { MEMBER_BOT_FIELDS } from "../shared/viewer-capabilities.ts";

/** PATCH /api/bots/:id/runtime-settings fields (Edit bot runtime panel). */
export const RUNTIME_SETTINGS_FIELDS = [
  "maxConcurrentThreads",
  "maxParallelPerPerson",
  "busySend",
  "automaticRecovery",
  "turnPayer",
  "turnLimits",
] as const;

export type RuntimeSettingsField = (typeof RUNTIME_SETTINGS_FIELDS)[number];

/** Ack / confirm flags the Edit bot window sends with a PATCH. */
const PATCH_ACK_FIELDS = [
  "acknowledgeLocalAuto",
  "acknowledgePeerScope",
  "confirmFullAccess",
  "applyToAllThreads",
] as const;

/** Extra keys bots-mutate handles that are not in MEMBER_BOT_FIELDS or BOT_FIELD_PERMISSIONS. */
const PATCH_EXTRA_FIELDS = ["cacheKeepWarm"] as const;

/** Fields that belong on update_agent_model, not update_agent_settings. */
const MODEL_ROUTE_FIELDS = new Set([
  "modelSelection",
  "threadId",
  "model",
  "instance_id",
  "instance",
  "engine",
  "effort",
  "auto",
]);

/** Primary Bot switch (POST/DELETE /api/bots/:id/primary). */
export const AGENT_PRIMARY_FIELD = "primary" as const;

/** #4172: the bot page's own switches outside PATCH /api/bots/:id, each a
 * map sent to the route the page calls: skills on or off (PATCH
 * /api/bots/:id/skills/:name), plugins on or off (PATCH
 * /api/bots/:id/plugins/:key), sharing with a person or group (PUT
 * /api/bots/:id/grants, DELETE /api/bots/:id/grants/:target). */
export const AGENT_SWITCH_FIELDS = ["skills", "plugins", "grants"] as const;
export type AgentSwitchField = (typeof AGENT_SWITCH_FIELDS)[number];

/** The sharing levels the bot page offers (PUT /api/bots/:id/grants). */
export const AGENT_GRANT_LEVELS = ["use", "run", "edit", "manage"] as const;

function uniqueSorted(fields: Iterable<string>): string[] {
  return [...new Set(fields)].sort();
}

/**
 * Every field update_agent_settings may accept. Derived from the server's
 * own MEMBER_BOT_FIELDS, BOT_FIELD_PERMISSIONS, runtime-settings schema and
 * Primary Bot route. modelSelection stays on update_agent_model.
 */
export const AGENT_SETTINGS_FIELDS: readonly string[] = uniqueSorted([
  ...MEMBER_BOT_FIELDS.filter((field) => field !== "modelSelection"),
  ...Object.keys(BOT_FIELD_PERMISSIONS).filter((field) => !MODEL_ROUTE_FIELDS.has(field)),
  ...RUNTIME_SETTINGS_FIELDS,
  ...PATCH_ACK_FIELDS,
  ...PATCH_EXTRA_FIELDS,
  ...AGENT_SWITCH_FIELDS,
  AGENT_PRIMARY_FIELD,
]);

export function isRuntimeSettingsField(field: string): field is RuntimeSettingsField {
  return (RUNTIME_SETTINGS_FIELDS as readonly string[]).includes(field);
}

export function isAgentSettingsField(field: string): boolean {
  return AGENT_SETTINGS_FIELDS.includes(field);
}

export interface EngineCandidate {
  instanceId: string;
  driverKind?: string | null;
  displayName?: string | null;
}

export type ResolveEngineResult =
  | { ok: true; instanceId: string }
  | { ok: false; reason: "ambiguous" | "unknown"; candidates: EngineCandidate[] };

/**
 * Exact instance id first (case-sensitive, then case-insensitive); then a
 * unique fuzzy match on kind / display name. Several matches refuse with
 * the candidate list so the wrong engine is never picked silently.
 */
export function resolveEngineInstance(
  needle: string,
  instances: readonly EngineCandidate[],
): ResolveEngineResult {
  const raw = needle.trim();
  if (!raw) return { ok: false, reason: "unknown", candidates: [] };
  const exact = instances.find((entry) => entry.instanceId === raw);
  if (exact) return { ok: true, instanceId: exact.instanceId };
  const lower = raw.toLowerCase();
  const exactCi = instances.find((entry) => entry.instanceId.toLowerCase() === lower);
  if (exactCi) return { ok: true, instanceId: exactCi.instanceId };

  const matches = instances.filter((entry) => {
    const kind = String(entry.driverKind ?? "").toLowerCase();
    const name = String(entry.displayName ?? "").toLowerCase();
    return kind === lower || kind.startsWith(lower) || name === lower || name.includes(lower);
  });
  if (matches.length === 1) return { ok: true, instanceId: matches[0]!.instanceId };
  if (matches.length > 1) return { ok: false, reason: "ambiguous", candidates: matches };
  return { ok: false, reason: "unknown", candidates: instances.slice(0, 12) };
}

export function formatEngineCandidates(candidates: readonly EngineCandidate[]): string {
  return candidates.map((entry) => {
    const label = (entry.displayName?.trim() || entry.driverKind?.trim() || "");
    return label && label !== entry.instanceId ? `${entry.instanceId} (${label})` : entry.instanceId;
  }).join(", ");
}

/**
 * Plain refusal reason for a field: no permission keys and no console paths.
 * Prefer a server sentence that is already plain; otherwise map the field
 * (or its BOT_FIELD_PERMISSIONS key) to a short sentence.
 */
export function plainFieldRefusalReason(
  field: string,
  server?: { error?: unknown; message?: unknown; permission?: unknown },
): string {
  const permission = typeof server?.permission === "string" ? server.permission : undefined;
  // permissionRefusal uses error: "forbidden" plus a message that names the key:
  // when a permission key is present, always map to a plain sentence.
  if (permission) return plainReasonForField(field, permission);
  const message = typeof server?.message === "string" ? server.message.trim() : "";
  const error = typeof server?.error === "string" ? server.error.trim() : "";
  const raw = message && message !== error ? message : (error || message);
  if (raw && isPlainRefusalText(raw)) return raw;
  return plainReasonForField(field, permission);
}

function isPlainRefusalText(text: string): boolean {
  // Dotted permission keys (bots.approvalLevel) or console / Perspicax paths.
  if (/\b[a-z]+(?:\.[a-z]+)+\b/i.test(text)) return false;
  if (/console\//i.test(text) || /\bPerspicax\b/i.test(text)) return false;
  return true;
}

function plainReasonForField(field: string, permission?: string): string {
  const key = permission ?? BOT_FIELD_PERMISSIONS[field];
  switch (key) {
    case "bots.approvalLevel":
      return "your profile does not allow changing this bot's approval level";
    case "bots.behaviour":
      return "your profile does not allow changing this bot's behaviour settings";
    case "bots.computer":
      return "your profile does not allow changing where this bot runs";
    case "bots.tools":
      return "your profile does not allow changing this bot's tools";
    case "sharing.visibility":
      return "your profile does not allow changing who can see this bot or which section it is in";
    case "folders.botWorkingFolder":
      return "your profile does not allow changing where this bot's files live";
    case "bots.create":
      if (field === "computer" || field === "browser") {
        return "your profile does not allow changing where this bot runs";
      }
      if (field === "hidden") return "your profile does not allow archiving this bot";
      if (field === "chiefOfStaff" || field === "managedSections" || field === AGENT_PRIMARY_FIELD) {
        return "your profile does not allow changing this bot's Primary Bot role";
      }
      return "your profile does not allow changing this setting";
    default:
      break;
  }
  if (field === AGENT_PRIMARY_FIELD) return "only the owner can make or clear the Primary Bot";
  if (isRuntimeSettingsField(field)) return "your profile does not allow changing this bot's runtime settings";
  return `your profile does not allow changing "${field}"`;
}

export function partitionAgentSettings(fields: Record<string, unknown>): {
  patch: Record<string, unknown>;
  runtime: Record<string, unknown>;
  primary: boolean | undefined;
  primaryInvalid?: boolean;
  /** #4172: name or key to on/off (skills, plugins), target to level or
   * null (grants). */
  switches: AgentSwitches;
  /** Each switch field whose value is not a valid map, with why. */
  switchesInvalid: Array<{ field: string; reason: string }>;
} {
  const patch: Record<string, unknown> = {};
  const runtime: Record<string, unknown> = {};
  const switches: AgentSwitches = {};
  const switchesInvalid: Array<{ field: string; reason: string }> = [];
  let primary: boolean | undefined;
  let primaryInvalid = false;
  for (const [field, value] of Object.entries(fields)) {
    if (field === AGENT_PRIMARY_FIELD) {
      if (typeof value === "boolean") primary = value;
      else primaryInvalid = true;
      continue;
    }
    if (isAgentSwitchField(field)) {
      const parsed = parseSwitchMap(field, value);
      if (typeof parsed === "string") switchesInvalid.push({ field, reason: parsed });
      else if (field === "grants") switches.grants = parsed as Record<string, AgentGrantLevel | null>;
      else switches[field] = parsed as Record<string, boolean>;
      continue;
    }
    if (isRuntimeSettingsField(field)) runtime[field] = value;
    else patch[field] = value;
  }
  return { patch, runtime, primary, ...(primaryInvalid ? { primaryInvalid: true } : {}), switches, switchesInvalid };
}

export type AgentGrantLevel = (typeof AGENT_GRANT_LEVELS)[number];
export interface AgentSwitches {
  skills?: Record<string, boolean>;
  plugins?: Record<string, boolean>;
  grants?: Record<string, AgentGrantLevel | null>;
}

export function isAgentSwitchField(field: string): field is AgentSwitchField {
  return (AGENT_SWITCH_FIELDS as readonly string[]).includes(field);
}

/** A switch map as sent, or the sentence saying what it should be. */
function parseSwitchMap(field: AgentSwitchField, value: unknown): Record<string, boolean | AgentGrantLevel | null> | string {
  const shape = field === "grants"
    ? "grants maps user:<person id> or team:<team id> to use, run, edit or manage (null stops sharing with them)"
    : `${field} maps each ${field === "skills" ? "skill name" : "plugin key"} to true (on) or false (off)`;
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${shape}.`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return `${shape}.`;
  const out: Record<string, boolean | AgentGrantLevel | null> = {};
  for (const [key, entry] of entries) {
    if (!key.trim()) return `${shape}.`;
    if (field === "grants") {
      if (entry !== null && !(AGENT_GRANT_LEVELS as readonly unknown[]).includes(entry)) return `${shape}; ${key} has ${JSON.stringify(entry)}.`;
      out[key] = entry as AgentGrantLevel | null;
    } else {
      if (typeof entry !== "boolean") return `${shape}; ${key} has ${JSON.stringify(entry)}.`;
      out[key] = entry;
    }
  }
  return out;
}
