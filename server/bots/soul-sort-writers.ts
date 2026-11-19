// The writes behind the soul sort (server/bots/soul-sort.ts, #5019): the
// functions the bot's own rules_update, docs_update and memory_update call,
// as they are, so a sorted rule is journaled, scrubbed and budgeted exactly
// like a rule the bot or the person adds by hand.
import { MEMORY_INDEX, RULES_PATH, readMemoryDoc, workspaceDocPaths } from "../memory/memory-store.ts";
import { RULE_MAX_CHARS, listRuleSets } from "../rules/rule-sets.ts";
import { updateDoc, updateRules } from "../workspace/workspace-tools.ts";
import { updateMemory } from "../workspace/workspace.ts";
import type { SoulSortWriters } from "./soul-sort.ts";

const VIA = "soul";

export function soulSortWriters(options: { memoryOn(botId: string): boolean }): SoulSortWriters {
  const read = (botId: string, path: string): string | null => {
    try {
      const doc = readMemoryDoc(botId, path);
      return doc.exists ? doc.text : null;
    } catch {
      return null;
    }
  };
  return {
    appendRule(botId, text, actor) {
      const done = updateRules(botId, { action: "append", text }, { actor, via: VIA });
      return done.ok ? { ok: true } : { ok: false, error: done.error };
    },
    currentRules(botId) {
      const files = listRuleSets(botId).map((set) => set.file);
      return (files.length ? files : [RULES_PATH]).map((file) => read(botId, file) ?? "").join("\n");
    },
    readDoc: read,
    writeDoc(botId, update, actor) {
      const done = updateDoc(botId, update, { actor, via: VIA });
      return done.ok ? { ok: true } : { ok: false, error: done.error };
    },
    memoryText(botId) {
      return read(botId, MEMORY_INDEX) ?? "";
    },
    appendMemory(botId, text) {
      const done = updateMemory(botId, { action: "append", text }, { source: "soul" });
      return done.ok ? { ok: true } : { ok: false, error: done.error };
    },
    memoryOn: options.memoryOn,
  };
}

/** #5019: what get_agent answers beside the soul, so an AI client changes
 * the right file: each rule set's text as it is on disk (old_text for a
 * replace or a remove comes from it), the per-rule limit, and the docs. */
export function botFilesForProfile(botId: string): {
  rules: Array<{ set: string; path: string; enabled: boolean; text: string }>;
  rule_max_chars: number;
  docs: string[];
} {
  const read = (path: string) => {
    try {
      return readMemoryDoc(botId, path).text;
    } catch {
      return "";
    }
  };
  let sets: ReturnType<typeof listRuleSets> = [];
  try {
    sets = listRuleSets(botId);
  } catch {
    sets = [];
  }
  let docs: string[] = [];
  try {
    docs = workspaceDocPaths(botId).filter((path) => path.startsWith("docs/"));
  } catch {
    docs = [];
  }
  return {
    rules: sets.map((set) => ({ set: set.name ?? "Rules", path: set.file, enabled: set.enabled, text: read(set.file) })),
    rule_max_chars: RULE_MAX_CHARS,
    docs,
  };
}
