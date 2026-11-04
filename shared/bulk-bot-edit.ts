// Changing several bots at once (the sidebar's selection, the iPhone's home
// selection, the Primary Bot's sagax_settings with several targets). Pure
// rules, shared by the desktop (src/lib/bulk-bot-edit.ts) and mirrored by
// CompanionCore/BulkBotEdit.swift:
//
// - every field is "do not change" until it is touched; only touched fields
//   are sent, bot by bot, through the same routes as the bot's own editor
//   (PATCH /api/bots/:id and the grants routes), so each change is
//   journaled as an individual edit and refused for the reasons it would be;
// - a list (Shared with, the MCP servers of Access) is
//   changed by Add, Remove or Replace with;
// - a value the bots share is shown as it is; when they differ the field
//   reads "Mixed values" with each bot's value in the tooltip;
// - the bots' values before the change are kept so the last bulk change can
//   be undone (another bulk change, journaled the same way).

export type BulkListMode = "add" | "remove" | "replace";

export interface BulkListEdit {
  mode: BulkListMode;
  items: string[];
}

/** The list a bot ends with. Add keeps the bot's order and appends what it
 * lacks; Remove drops the items; Replace is exactly the items (deduplicated). */
export function applyListEdit(current: readonly string[], edit: BulkListEdit): string[] {
  const items = [...new Set(edit.items)];
  if (edit.mode === "replace") return items;
  if (edit.mode === "remove") {
    const gone = new Set(items);
    return current.filter((item) => !gone.has(item));
  }
  const have = new Set(current);
  return [...current, ...items.filter((item) => !have.has(item))];
}

/** Whether a list edit changes this bot's list at all. */
export function listEditChanges(current: readonly string[], edit: BulkListEdit): boolean {
  const next = applyListEdit(current, edit);
  return next.length !== current.length || next.some((item, index) => item !== current[index]);
}

/** The items every bot has: what Replace starts from. */
export function commonListItems(lists: ReadonlyArray<readonly string[]>): string[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return first!.filter((item) => rest.every((list) => list.includes(item)));
}

/** A JSON text that does not depend on key order (undefined and null are
 * the same: "not set"). */
export function stableValueKey(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValueKey(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type CommonValue<T> =
  | { mixed: false; value: T | undefined }
  | { mixed: true; values: Array<{ botId: string; value: T | undefined }> };

/** One value when every bot has it, else each bot's own. */
export function commonValue<T>(rows: ReadonlyArray<{ botId: string; value: T | undefined }>): CommonValue<T> {
  if (rows.length === 0) return { mixed: false, value: undefined };
  const first = stableValueKey(rows[0]!.value);
  if (rows.every((row) => stableValueKey(row.value) === first)) return { mixed: false, value: rows[0]!.value };
  return { mixed: true, values: rows.map((row) => ({ botId: row.botId, value: row.value })) };
}

/** Confirmations that ride with a patch (a warning the person accepted);
 * never a field to compare, show or undo. */
export const BULK_CONSENT_KEYS = ["confirmFullAccess", "acknowledgeLocalAuto", "acknowledgePeerScope", "applyToAllThreads", "threadId", "stepUp"] as const;

const CONSENT = new Set<string>(BULK_CONSENT_KEYS);

/** The fields a patch changes (its consent flags left out). */
export function patchFields(patch: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(patch).filter((key) => !CONSENT.has(key) && patch[key] !== undefined);
}

/** A field this bot already has at the patch's value is not sent again. */
export function patchForBot(bot: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let changes = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (CONSENT.has(key)) { out[key] = value; continue; }
    if (stableValueKey(bot[key]) === stableValueKey(value)) continue;
    out[key] = value;
    changes = true;
  }
  return changes ? out : {};
}

/** A bulk change is the bot's own edit, as Edit bot makes it: a new model
 * names the bot's thread (the one the person sees), so the server sets the
 * bot's model and that thread follows it. Without it a bot with several
 * threads refuses the change (requirePinnedClientThread, #1674). A threadId
 * left from the dialog's draft bot never rides along. */
export function botLevelPatch(patch: Readonly<Record<string, unknown>>, threadId: string | undefined): Record<string, unknown> {
  const { threadId: _draftThread, ...rest } = patch;
  const out: Record<string, unknown> = { ...rest };
  if (out.modelSelection !== undefined && out.modelSelection !== null && threadId) out.threadId = threadId;
  return out;
}

/** What puts the patched fields back: each field's value before (a field
 * that was not set goes back to null, "not set"). */
export function revertPatch(before: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of patchFields(patch)) out[key] = before[key] === undefined ? null : before[key];
  return out;
}

export type GrantLevel = "use" | "run" | "edit" | "manage";

export interface BulkGrant {
  target: string;
  level: GrantLevel;
}

/** Shared with: the grants to put (PUT) and to take away (DELETE) for one
 * bot. Add and Replace give each person or team the level chosen for it (one
 * already there at another level moves to it); Remove takes them away,
 * whatever their level. */
export function grantSteps(current: readonly BulkGrant[], mode: BulkListMode, wanted: readonly BulkGrant[]): { put: BulkGrant[]; remove: string[] } {
  const byTarget = new Map(current.map((grant) => [grant.target, grant.level]));
  const unique = [...new Map(wanted.map((grant) => [grant.target, grant])).values()];
  if (mode === "remove") return { put: [], remove: unique.map((grant) => grant.target).filter((target) => byTarget.has(target)) };
  const put = unique.filter((grant) => byTarget.get(grant.target) !== grant.level).map(({ target, level }) => ({ target, level }));
  const keep = new Set(unique.map((grant) => grant.target));
  const remove = mode === "replace" ? current.map((grant) => grant.target).filter((target) => !keep.has(target)) : [];
  return { put, remove };
}

/** What puts a bot's grants back as they were. */
export function grantRevertSteps(before: readonly BulkGrant[], after: readonly BulkGrant[]): { put: BulkGrant[]; remove: string[] } {
  const was = new Map(before.map((grant) => [grant.target, grant.level]));
  const now = new Map(after.map((grant) => [grant.target, grant.level]));
  return {
    put: before.filter((grant) => now.get(grant.target) !== grant.level),
    remove: after.map((grant) => grant.target).filter((target) => !was.has(target)),
  };
}

/** The MCP servers a bot mounts after a list edit. A bot without its own
 * list mounts every enabled server; the edit starts from that set. */
export function mcpServersAfter(current: readonly string[] | null | undefined, enabled: readonly string[], edit: BulkListEdit): string[] {
  return applyListEdit(current ?? enabled, edit);
}

/** One bot's outcome. `skipped`: nothing to change for it. */
export interface BulkBotOutcome {
  botId: string;
  ok: boolean;
  skipped?: boolean;
  /** Why the bot refused, in the server's words (an engine not available,
   * a right missing...). */
  reasons?: string[];
}

export function bulkOutcomeCounts(outcomes: readonly BulkBotOutcome[]): { ok: number; failed: number; skipped: number } {
  return {
    ok: outcomes.filter((row) => row.ok && !row.skipped).length,
    failed: outcomes.filter((row) => !row.ok).length,
    skipped: outcomes.filter((row) => row.ok && row.skipped).length,
  };
}

/** Several bot ids in one sagax_settings target ("a,b,c"), or null for one. */
export function splitBulkTargets(target: unknown): string[] | null {
  if (typeof target !== "string" || !target.includes(",")) return null;
  const ids = [...new Set(target.split(",").map((id) => id.trim()).filter(Boolean))];
  return ids.length > 1 ? ids : null;
}

/** The most bots one sagax_settings call changes. */
export const BULK_TARGETS_MAX = 25;
