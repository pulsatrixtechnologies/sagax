// The writes behind the soul sort (server/bots/soul-sort.ts, #5019): the
// functions the bot's own rules_update, docs_update and memory_update call,
// as they are, so a sorted rule is journaled, scrubbed and budgeted exactly
// like a rule the bot or the person adds by hand.
import { parseMemoryEntries } from "../memory/memory-entries.ts";
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
      // the first set (RULES.md), then each other set that is on, in order,
      // when the one before is full: rules_update's own write each time
      const first = updateRules(botId, { action: "append", text }, { actor, via: VIA });
      if (first.ok) return { ok: true, path: first.path };
      if (first.code !== "over-budget") return { ok: false, error: first.error };
      let refusal = first.error;
      for (const set of listRuleSets(botId).slice(1).filter((candidate) => candidate.enabled)) {
        const done = updateRules(botId, { action: "append", text, set: set.id }, { actor, via: VIA });
        if (done.ok) return { ok: true, path: done.path };
        refusal = done.error;
        if (done.code !== "over-budget") break;
      }
      return { ok: false, error: refusal };
    },
    currentRules(botId) {
      // only the sets that load: a rule found in a set that is off is not
      // in force, so it is filed again rather than taken out of the soul
      const sets = listRuleSets(botId);
      const files = sets.length ? sets.filter((set) => set.enabled).map((set) => set.file) : [RULES_PATH];
      return files.map((file) => read(botId, file) ?? "").join("\n");
    },
    readDoc: read,
    writeDoc(botId, update, actor) {
      const done = updateDoc(botId, update, { actor, via: VIA });
      return done.ok ? { ok: true } : { ok: false, error: done.error };
    },
    memoryLines(botId) {
      // each live entry's fact without its date, and the lines written by
      // hand; a struck-through fact is not remembered, so it is filed again
      const text = read(botId, MEMORY_INDEX) ?? "";
      const lines = text.split("\n");
      const entries = parseMemoryEntries(text);
      const dated = new Set(entries.map((entry) => entry.line));
      return [
        ...entries.filter((entry) => !entry.struck).map((entry) => entry.body),
        ...lines.filter((_, index) => !dated.has(index)),
      ];
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
