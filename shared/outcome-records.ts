// Stored outcomes of a bot (#4098, lot outcomes-records). An outcome groups
// one or more routines under a named result. Read shape lives in
// shared/outcomes.ts (OutcomeRecord); this file holds the name rules, the
// limits and the load of what routines.json keeps beside folders.
import type { OutcomeRecord } from "./outcomes.ts";

export type { OutcomeRecord };

/** Characters kept in an outcome's name or note. */
export const OUTCOME_NAME_MAX = 120;
export const OUTCOME_NOTE_MAX = 400;
/** Outcomes one bot may keep. */
export const OUTCOMES_PER_BOT = 100;

/** A name or note as stored: control characters dropped, spaces collapsed,
 * trimmed, at most `max` characters. Empty means absent. */
export function cleanOutcomeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, max).join("").trim() || undefined;
}

export function cleanOutcomeName(value: unknown): string | undefined {
  return cleanOutcomeText(value, OUTCOME_NAME_MAX);
}

export function cleanOutcomeNote(value: unknown): string | undefined {
  return cleanOutcomeText(value, OUTCOME_NOTE_MAX);
}

/** An outcome id as stored: non-empty, no control characters, at most 64. */
export function cleanOutcomeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  if (!cleaned || cleaned.length > 64) return undefined;
  return cleaned;
}

/** Load each bot's outcome list from routines.json; anything unreadable is dropped. */
export function loadOutcomeRecords(value: unknown): Map<string, OutcomeRecord[]> {
  const out = new Map<string, OutcomeRecord[]>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [botId, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!botId || !Array.isArray(rows)) continue;
    const seen = new Set<string>();
    const clean: OutcomeRecord[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const id = cleanOutcomeId((row as { id?: unknown }).id);
      const name = cleanOutcomeName((row as { name?: unknown }).name);
      const createdAt = (row as { createdAt?: unknown }).createdAt;
      const updatedAt = (row as { updatedAt?: unknown }).updatedAt;
      if (!id || !name || seen.has(id)) continue;
      if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) continue;
      if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt < 0) continue;
      seen.add(id);
      const note = cleanOutcomeNote((row as { note?: unknown }).note);
      clean.push({ id, name, ...(note ? { note } : {}), createdAt, updatedAt });
      if (clean.length >= OUTCOMES_PER_BOT) break;
    }
    if (clean.length) out.set(botId, clean);
  }
  return out;
}

/** A bot's outcomes in the person's order: its saved list first, then any
 * outcome id a routine still names that the list does not (an older file),
 * each as a synthetic record named by that id so the tab can still group. */
export function orderedOutcomeRecords(
  saved: readonly OutcomeRecord[],
  routines: readonly { outcome?: string }[],
  now = Date.now(),
): OutcomeRecord[] {
  const out: OutcomeRecord[] = [];
  const seen = new Set<string>();
  for (const record of saved) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  for (const routine of routines) {
    const id = cleanOutcomeId(routine.outcome);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: id, createdAt: now, updatedAt: now });
  }
  return out.slice(0, OUTCOMES_PER_BOT);
}
