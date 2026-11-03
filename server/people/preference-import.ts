// Preferences of primary bots (shared/preference-import.ts). One file,
// mode 0600. Not the agent import, and not MEMORY.md.
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "../atomic.ts";
import {
  applyPreferenceImport, parsePreferenceLines, previewPreferenceImport,
  type PreferenceItem, type PreferencePreviewLine,
} from "../../shared/preference-import.ts";

interface BotPreferences {
  botId: string;
  items: PreferenceItem[];
}

export interface PreferenceStore {
  items(botId: string): PreferenceItem[];
  preview(botId: string, text: string): PreferencePreviewLine[];
  /** `accept` is the line ids the person agreed to on the card. */
  apply(botId: string, text: string, accept: readonly string[]): { items: PreferenceItem[]; preview: PreferencePreviewLine[] };
}

function isItem(value: unknown): value is PreferenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PreferenceItem>;
  return typeof item.id === "string" && typeof item.key === "string" && typeof item.text === "string";
}

export function createPreferenceStore(options: { file: string }): PreferenceStore {
  const byBot = new Map<string, PreferenceItem[]>();
  try {
    const parsed = JSON.parse(readFileSync(options.file, "utf8")) as { bots?: unknown };
    for (const entry of Array.isArray(parsed.bots) ? parsed.bots : []) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Partial<BotPreferences>;
      if (typeof row.botId !== "string" || !Array.isArray(row.items)) continue;
      byBot.set(row.botId, row.items.filter(isItem));
    }
  } catch {
    // no file yet
  }
  const save = () => {
    const bots = Array.from(byBot, ([botId, items]) => ({ botId, items }));
    writeFileAtomic(options.file, JSON.stringify({ version: 1, bots }), { mode: 0o600 });
  };
  return {
    items(botId) {
      return (byBot.get(botId) ?? []).map((item) => ({ ...item }));
    },
    preview(botId, text) {
      return previewPreferenceImport(this.items(botId), parsePreferenceLines(text));
    },
    apply(botId, text, accept) {
      const preview = this.preview(botId, text);
      const items = applyPreferenceImport(this.items(botId), preview, new Set(accept));
      byBot.set(botId, items);
      save();
      return { items, preview };
    },
  };
}
