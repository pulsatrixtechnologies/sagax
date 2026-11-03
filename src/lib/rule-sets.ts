// The persona editor's Rules section as rule sets (server/routes/bot-rules.ts,
// server/rules/rule-sets.ts): RULES.md is the first set; every other set is
// rules/<id>.md. The sets that are on load in order right after the
// Personality, each under a budget and all of them under a total.
import { ApiError, api } from "@/state/store";
import { effectiveRulesText } from "@/lib/workspace-files";

/** Mirrors server/rules/rule-sets.ts; the server's listing carries the live
 * values, these are the fallback before it answers. */
export const RULE_SET_MAX_LINES = 100;
export const RULE_SET_MAX_BYTES = 12_000;
export const RULES_TOTAL_MAX_LINES = 250;
export const RULES_TOTAL_MAX_BYTES = 24_000;
export const RULE_SETS_MAX = 20;
export const RULE_SET_NAME_MAX = 60;
export const DEFAULT_RULE_SET_ID = "rules";

export interface RuleSetWire {
  id: string;
  /** null: the default set (RULES.md), shown as "Rules" in the person's language */
  name: string | null;
  enabled: boolean;
  file: string;
  text: string;
  hash: string;
  exists: boolean;
  lines: number;
  bytes: number;
  over: boolean;
  /** on, and holding at least one rule */
  loads: boolean;
}

export interface Budget {
  maxLines: number;
  maxBytes: number;
}

export interface RulesListing {
  budgets: { set: Budget; total: Budget };
  maxSets: number;
  maxNameLength: number;
  template: string;
  sets: RuleSetWire[];
  total: { lines: number; bytes: number; over: boolean };
}

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/rules`;
const setUrl = (botId: string, id: string) => `${base(botId)}/sets/${encodeURIComponent(id)}`;

export function fetchRules(botId: string): Promise<RulesListing> {
  return api(base(botId));
}

export function createRuleSet(botId: string, name: string): Promise<RulesListing & { set: RuleSetWire }> {
  return api(`${base(botId)}/sets`, { method: "POST", body: JSON.stringify({ name }) });
}

export function updateRuleSet(botId: string, id: string, patch: { name?: string | null; enabled?: boolean }): Promise<RulesListing & { set: RuleSetWire }> {
  return api(setUrl(botId, id), { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteRuleSet(botId: string, id: string): Promise<RulesListing> {
  return api(setUrl(botId, id), { method: "DELETE" });
}

export function reorderRuleSets(botId: string, ids: string[]): Promise<RulesListing> {
  return api(`${base(botId)}/order`, { method: "PUT", body: JSON.stringify({ ids }) });
}

export type RuleSetSaveResult =
  | { ok: true; listing: RulesListing; set: RuleSetWire }
  | { ok: false; conflict: true; current: string; currentHash: string };

/** A 409 carries what is on disk now (the bot may have written), like a
 * memory save. */
export async function saveRuleSetText(botId: string, id: string, text: string, expectedHash: string | undefined): Promise<RuleSetSaveResult> {
  try {
    const result = await api<RulesListing & { set: RuleSetWire }>(`${setUrl(botId, id)}/text`, { method: "PUT", body: JSON.stringify({ text, expectedHash }) });
    return { ok: true, listing: result, set: result.set };
  } catch (error) {
    const body = error instanceof ApiError ? error.body : undefined;
    if (error instanceof ApiError && error.status === 409 && typeof body?.current === "string" && typeof body.currentHash === "string") {
      return { ok: false, conflict: true, current: body.current, currentHash: body.currentHash };
    }
    throw error;
  }
}

/** Lines and bytes of what a set's text loads (comments out). */
export function measureRules(raw: string): { lines: number; bytes: number } {
  const text = effectiveRulesText(raw);
  return { lines: text ? text.replace(/\n$/, "").split("\n").length : 0, bytes: new TextEncoder().encode(text).length };
}

/** Whether a text holds a rule: anything but comments and headings. */
export function holdsRules(raw: string): boolean {
  return effectiveRulesText(raw).split("\n").some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
}

/** What the sets that are on add up to, with the editor's unsaved drafts in
 * place of what is saved. */
export function totalWithDrafts(sets: readonly RuleSetWire[], drafts: Readonly<Record<string, string>>): { lines: number; bytes: number } {
  let lines = 0;
  let bytes = 0;
  for (const set of sets) {
    if (!set.enabled) continue;
    const raw = drafts[set.id] ?? set.text;
    if (!holdsRules(raw)) continue;
    const measure = measureRules(raw);
    lines += measure.lines;
    bytes += measure.bytes;
  }
  return { lines, bytes };
}

/** `ids` with the one at `from` moved by `delta` places, or null at an end. */
export function moved(ids: readonly string[], from: number, delta: -1 | 1): string[] | null {
  const to = from + delta;
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
