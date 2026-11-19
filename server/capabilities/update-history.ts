// The history of updates (#4504, M-20261119-040): one line per person, per
// plugin (or skill, connector) and per version reached. A plugin installed in
// four of the person's bots is one line, not four. It is what the item's own
// page reads ("Updated on ... from X to Y"); an update done by itself raises
// no banner. A small file in the data folder, written atomically.
import { existsSync, readFileSync } from "node:fs";

import { writeFileAtomic } from "../atomic.ts";

export interface UpdateHistoryEntry {
  kind: "plugin" | "skill" | "connector";
  name: string;
  at: number;
  from?: string;
  to?: string;
}

/** The most lines kept for one item of one person. */
export const HISTORY_PER_ITEM = 5;

export interface UpdateHistoryStore {
  read(personId: string): UpdateHistoryEntry[];
  /** Keep one line per person, item and version reached. True when it was new. */
  record(personId: string, entry: UpdateHistoryEntry): boolean;
}

const sameItem = (a: UpdateHistoryEntry, b: UpdateHistoryEntry) => a.kind === b.kind && a.name === b.name;

function clean(raw: unknown): UpdateHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: UpdateHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const { kind, name, at, from, to } = row as Record<string, unknown>;
    if ((kind !== "plugin" && kind !== "skill" && kind !== "connector") || typeof name !== "string" || typeof at !== "number") continue;
    out.push({ kind, name, at, ...(typeof from === "string" ? { from } : {}), ...(typeof to === "string" ? { to } : {}) });
  }
  return out;
}

export class MemoryUpdateHistory implements UpdateHistoryStore {
  protected readonly people = new Map<string, UpdateHistoryEntry[]>();

  read(personId: string): UpdateHistoryEntry[] {
    return [...(this.people.get(personId) ?? [])].sort((a, b) => b.at - a.at);
  }

  record(personId: string, entry: UpdateHistoryEntry): boolean {
    const rows = this.people.get(personId) ?? [];
    if (rows.some((row) => sameItem(row, entry) && (row.to ?? "") === (entry.to ?? ""))) return false;
    const mine = [entry, ...rows.filter((row) => sameItem(row, entry))].sort((a, b) => b.at - a.at).slice(0, HISTORY_PER_ITEM);
    this.people.set(personId, [...rows.filter((row) => !sameItem(row, entry)), ...mine]);
    this.changed();
    return true;
  }

  protected changed(): void {}
}

export class FileUpdateHistory extends MemoryUpdateHistory {
  private readonly path: string;

  constructor(path: string) {
    super();
    this.path = path;
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { people?: Record<string, unknown> };
        for (const [person, rows] of Object.entries(parsed.people ?? {})) this.people.set(person, clean(rows));
      }
    } catch {
      // an unreadable file starts a fresh history: nothing else depends on it
    }
  }

  protected override changed(): void {
    try {
      writeFileAtomic(this.path, JSON.stringify({ version: 1, people: Object.fromEntries(this.people) }), { mode: 0o600 });
    } catch {
      // the history is a convenience; an update never fails for it
    }
  }
}
