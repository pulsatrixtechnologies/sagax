// A bot's versions, read from its profile history (server/profiles/profile-versions.ts):
// the rows one save writes (same time, actor and origin) are one version.
// Shared by the restore route (server/routes/bot-versions.ts) and the
// Changes page (src/components/bot-settings/HistorySection.tsx), so what the
// page offers to restore is what the server restores.

/** The parts of a history row a version needs. */
export interface VersionRow {
  id: string;
  at: number;
  actor: string;
  via: string;
  field: string;
  before?: string;
  after?: string;
  canRestore?: boolean;
}

/** What a restore may write: the profile fields the history records. */
export interface VersionRestorePatch {
  name?: string;
  title?: string;
  description?: string;
  soul?: string;
  notifications?: boolean;
  speakReplies?: boolean;
}

export type VersionRestorePlan =
  | { ok: true; patch: VersionRestorePatch; skipped: string[] }
  | { ok: false; status: number; error: string };

const ONE_LINER = 200;
const TEXT_FIELDS = new Set(["name", "title", "description"]);
const TOGGLES = new Set(["notifications", "speakReplies"]);

/** The changes recorded together with `row` (one save writes one row per
 * field, with the same time and origin). */
function sameChange(a: VersionRow, b: VersionRow): boolean {
  return a.at === b.at && a.via === b.via && a.actor === b.actor;
}

/** The fields to write so the bot is back at the version `versionId` ends
 * (rows in file order, oldest first). */
export function versionRestorePlan(rows: readonly VersionRow[], versionId: string): VersionRestorePlan {
  const index = rows.findIndex((row) => row.id === versionId);
  if (index < 0) return { ok: false, status: 404, error: "no such version" };
  const target = rows[index]!;
  let end = index;
  while (end + 1 < rows.length && sameChange(rows[end + 1]!, target)) end++;
  const later = rows.slice(end + 1);
  if (later.length === 0) return { ok: false, status: 400, error: "This is already the current version." };

  const patch: VersionRestorePatch = {};
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const row of later) {
    if (seen.has(row.field)) continue;
    seen.add(row.field);
    const value = row.before;
    if (row.field === "soul") {
      if (row.canRestore === true && typeof value === "string") patch.soul = value;
      else skipped.push(row.field);
    } else if (TEXT_FIELDS.has(row.field)) {
      // A one-liner that reached the cap may have been cut.
      if (typeof value === "string" && value.length < ONE_LINER && !/«redacted \d+ chars»/.test(value)) {
        patch[row.field as "name" | "title" | "description"] = value;
      } else skipped.push(row.field);
    } else if (TOGGLES.has(row.field)) {
      if (value === "on" || value === "off") patch[row.field as "notifications" | "speakReplies"] = value === "on";
      else skipped.push(row.field);
    } else {
      skipped.push(row.field);
    }
  }
  return { ok: true, patch, skipped };
}


export interface BotVersion<Row extends VersionRow = VersionRow> {
  /** The id of the version's first row: what a restore names. */
  id: string;
  at: number;
  actor: string;
  via: string;
  rows: Row[];
}

/** The versions, newest first, from rows in any order the server sends
 * (newest first). */
export function botVersions<Row extends VersionRow>(rows: readonly Row[]): BotVersion<Row>[] {
  const oldestFirst = [...rows].reverse();
  const versions: BotVersion<Row>[] = [];
  for (const row of oldestFirst) {
    const last = versions[versions.length - 1];
    if (last && sameChange(last.rows[0]!, row)) last.rows.push(row);
    else versions.push({ id: row.id, at: row.at, actor: row.actor, via: row.via, rows: [row] });
  }
  return versions.reverse();
}

/** For each field changed after `versionId`: its value at that version and
 * now (rows newest first, as the server sends them). */
export function versionComparison(rows: readonly VersionRow[], versionId: string): Array<{ field: string; atVersion: string; now: string }> {
  const oldestFirst = [...rows].reverse();
  const index = oldestFirst.findIndex((row) => row.id === versionId);
  if (index < 0) return [];
  let end = index;
  while (end + 1 < oldestFirst.length && sameChange(oldestFirst[end + 1]!, oldestFirst[index]!)) end++;
  const fields = new Map<string, { field: string; atVersion: string; now: string }>();
  for (const row of oldestFirst.slice(end + 1)) {
    const entry = fields.get(row.field);
    if (!entry) fields.set(row.field, { field: row.field, atVersion: row.before ?? "", now: row.after ?? "" });
    else entry.now = row.after ?? "";
  }
  return [...fields.values()].filter((entry) => entry.atVersion !== entry.now);
}
