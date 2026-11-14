// Fleet agent settings helpers (#1944): accepted Edit-bot fields, engine
// instance resolution, plain refusal reasons, and routing of runtime /
// Primary Bot fields. Derived from MEMBER_BOT_FIELDS + BOT_FIELD_PERMISSIONS
// so a second hand allowlist cannot drift from the server's PATCH gates.
import { BOT_FIELD_PERMISSIONS } from "../shared/permissions.ts";
import { MEMBER_BOT_FIELDS } from "../shared/viewer-capabilities.ts";
import { skillEditorApiPath } from "../src/lib/skills-ui.ts";

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

/** One request as the person, the way the bot page sends it. */
export type MemberRequestFn = (request: { method: string; path: string; body?: unknown }) => Promise<{ status: number; body: unknown }>;

/** #4172: the bot page's skill and plugin switches, each through the route
 * the page calls, as the person, one entry at a time: a skill where the page
 * switches it (skillEditorApiPath: the organization's library, the person's
 * own, or the bot's imports), a library skill not yet on the bot through the
 * page's Add to bot and a library skill on the bot turned off through its
 * Remove from bot, for this bot only (PUT /api/bots/:id/skills-library with
 * the assigned list read just before, plus or minus the name); true on a
 * library skill already on and live answers changed with no request, and one
 * turned off in the library goes to the library's own switch, a member's
 * scope refusal saying plainly who can turn it back on; a plugin through PATCH
 * /api/bots/:id/plugins/:key. The route's answer is the verdict, in its own
 * words. A name neither the bot's listing nor its library holds is refused as
 * unknown (the route would only say its path is not a member's); a skill the
 * engine loads by itself is not switched here, and says so; a plugin's bare
 * name finds its one installed key. Each entry answers `skills.<name>` or
 * `plugins.<key as sent>` in changed, or in refused with why. */
export async function applySkillAndPluginSwitches(
  perform: MemberRequestFn,
  agentId: string,
  switches: Pick<AgentSwitches, "skills" | "plugins">,
): Promise<{ changed: string[]; refused: Array<{ field: string; reason: string }> }> {
  const changed: string[] = [];
  const refused: Array<{ field: string; reason: string }> = [];
  const botPath = `/api/bots/${encodeURIComponent(agentId)}`;
  type Refusal = { error?: unknown; message?: unknown; permission?: unknown };
  const switchOne = async (field: string, request: Parameters<MemberRequestFn>[0], reasonFor?: (status: number, record: Refusal) => string | undefined) => {
    const done = await perform(request);
    if (done.status >= 200 && done.status < 300) {
      changed.push(field);
      return;
    }
    const record: Refusal = done.body && typeof done.body === "object" ? done.body as Refusal : {};
    refused.push({ field, reason: reasonFor?.(done.status, record) ?? plainFieldRefusalReason(field, record) });
  };
  const read = async (path: string): Promise<Record<string, unknown> | null> => {
    const listed = await perform({ method: "GET", path });
    return listed.status >= 200 && listed.status < 300 && listed.body && typeof listed.body === "object" ? listed.body as Record<string, unknown> : null;
  };
  const rowsOf = <T>(body: Record<string, unknown> | null, key: string): T[] | null => Array.isArray(body?.[key]) ? body![key] as T[] : null;
  const named = (names: readonly string[]) => {
    if (!names.length) return "none";
    const shown = names.slice(0, 20).join(", ");
    return names.length > 20 ? `${shown} and ${names.length - 20} more` : shown;
  };

  if (switches.skills) {
    const listed = await read(`${botPath}/skills`);
    const skills = rowsOf<{ name?: unknown; origin?: unknown; enabled?: unknown }>(listed, "skills");
    const origins = new Map((skills ?? []).map((skill) => [String(skill.name ?? ""), String(skill.origin ?? "")]));
    const live = new Set((skills ?? []).filter((skill) => skill.enabled === true).map((skill) => String(skill.name ?? "")));
    const library = new Set((rowsOf<{ name?: unknown }>(listed, "library") ?? []).map((skill) => String(skill.name ?? "")));
    // The page's Add to bot and Remove from bot: the assigned list read just
    // before, with the name added or taken out (PUT /api/bots/:id/skills-library).
    const assign = async (field: string, name: string, add: boolean) => {
      const current = (rowsOf<unknown>(await read(`${botPath}/skills`), "assignedSkills") ?? rowsOf<unknown>(listed, "assignedSkills") ?? []).map(String);
      const next = add ? [...new Set([...current, name])] : current.filter((entry) => entry !== name);
      await switchOne(field, { method: "PUT", path: `${botPath}/skills-library`, body: { skills: next } });
    };
    for (const [name, enabled] of Object.entries(switches.skills)) {
      const field = `skills.${name}`;
      if (skills && !origins.has(name) && library.has(name)) {
        // In the organization's library, not on this bot yet: on is the
        // page's Add to bot; off is already true, so it is answered changed
        // with nothing sent, like on for one already on and live.
        if (!enabled) {
          changed.push(field);
          continue;
        }
        await assign(field, name, true);
        continue;
      }
      if (skills && !origins.has(name)) {
        const offered = library.size ? `; the library also offers: ${named([...library])}` : "";
        refused.push({ field, reason: `this bot has no skill named "${name}" (its skills: ${named([...origins.keys()])}${offered})` });
        continue;
      }
      const origin = origins.get(name);
      if (origin === "native") {
        refused.push({ field, reason: `the engine loads the skill "${name}" by itself, so it is not switched here` });
        continue;
      }
      if (origin === "library" && !enabled) {
        // An organization's library skill on this bot: off is the page's
        // Remove from bot, for this bot only; the library's own switch
        // would turn it off for every bot that uses it.
        await assign(field, name, false);
        continue;
      }
      if (origin === "library" && live.has(name)) {
        // On this bot and live in the organization's library: already on,
        // nothing to send (the library's switch is not a member's route).
        changed.push(field);
        continue;
      }
      const path = skillEditorApiPath(agentId, name, origin === "library" || origin === "me" ? origin : undefined);
      // Turned off in the organization's library: its shared switch is the
      // verdict; a member's scope refusal says plainly who can turn it on.
      await switchOne(field, { method: "PATCH", path, body: { enabled } }, origin === "library"
        ? (status, record) => status === 403 && /lacks the \w+ scope/i.test(`${String(record.error ?? "")} ${String(record.message ?? "")}`)
          ? `the skill "${name}" is turned off in the organization's library, and only someone who manages the library can turn it back on`
          : undefined
        : undefined);
    }
  }
  if (switches.plugins) {
    const plugins = rowsOf<{ key?: unknown; name?: unknown }>(await read(`${botPath}/plugins`), "plugins");
    const keys = (plugins ?? []).map((plugin) => ({ key: String(plugin.key ?? ""), name: String(plugin.name ?? "") }));
    for (const [sent, enabled] of Object.entries(switches.plugins)) {
      const missing = `the plugin "${sent}" is not installed on this bot (installed: ${named(keys.map((plugin) => plugin.key))})`;
      let key: string | undefined = sent;
      if (plugins && !keys.some((plugin) => plugin.key === sent)) {
        const byName = keys.filter((plugin) => plugin.name === sent || plugin.key.toLowerCase() === sent.toLowerCase());
        key = byName.length === 1 ? byName[0]!.key : undefined;
        if (!key) {
          refused.push({
            field: `plugins.${sent}`,
            reason: byName.length > 1 ? `several plugins are named "${sent}": ${named(byName.map((plugin) => plugin.key))}; pass its full key` : missing,
          });
          continue;
        }
      }
      await switchOne(`plugins.${sent}`, { method: "PATCH", path: `${botPath}/plugins/${encodeURIComponent(key)}`, body: { enabled } });
    }
  }
  return { changed, refused };
}
