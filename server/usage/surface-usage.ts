// Lot S1 (2026-11-17): the usage of a person's surface bot (server/temporary-
// agents.ts) as anyone but that person reads it. The person reads every row
// of it in their own usage (GET /api/me/usage...). Anyone else (an
// organization admin's ledger, the console, traces, stats, the CSV) reads
// one row per person, calendar month (dated the 1st, as the ledger's files
// and the spend cap), engine and model, read over the whole month whatever
// range is asked (surfaceLedger): no conversation id, no bot, no day or
// time, no list of sends, and none of its tool calls. Nothing is capped.
import type { UsageRow } from "./usage-ledger.ts";

/** The bot label a folded row carries. */
export const SURFACE_USAGE_LABEL = "Chat";

/** `rows` as `viewerPrincipalId` reads them (null: nobody's own, an
 * organization view): the surface rows of another person folded. */
export function foldSurfaceUsage(rows: readonly UsageRow[], viewerPrincipalId: string | null): UsageRow[] {
  const viewer = viewerPrincipalId?.trim().toLowerCase() || null;
  const out: UsageRow[] = [];
  const folded = new Map<string, UsageRow>();
  for (const row of rows) {
    const owner = row.ownerPrincipalId?.trim().toLowerCase() ?? "";
    if (row.surface !== true || (viewer !== null && owner === viewer)) {
      out.push(row);
      continue;
    }
    const month = row.at.slice(0, 7);
    const key = [month, owner, row.instanceId, row.model, row.access ?? "", row.payerPrincipalId ?? ""].join("|");
    const into = folded.get(key);
    if (!into) {
      const first: UsageRow = {
        at: `${month}-01T00:00:00.000Z`, botId: "", botName: SURFACE_USAGE_LABEL, threadId: "",
        instanceId: row.instanceId, driverKind: row.driverKind, model: row.model,
        input: row.input, output: row.output, ...(row.cachedInput !== undefined ? { cachedInput: row.cachedInput } : {}),
        costUsd: row.costUsd, ...(row.costSource ? { costSource: row.costSource } : {}),
        trigger: owner ? { kind: "user", principalId: owner } : { kind: "owner" },
        ...(owner ? { ownerPrincipalId: owner } : {}),
        ...(row.access ? { access: row.access } : {}),
        ...(row.payerPrincipalId ? { payerPrincipalId: row.payerPrincipalId } : {}),
        surface: true,
      };
      folded.set(key, first);
      out.push(first);
      continue;
    }
    into.input += row.input;
    into.output += row.output;
    if (row.cachedInput !== undefined) into.cachedInput = (into.cachedInput ?? 0) + row.cachedInput;
    if (row.costUsd !== null) {
      into.costUsd = (into.costUsd ?? 0) + row.costUsd;
      if (row.costSource === "estimated") into.costSource = "estimated";
      else into.costSource ??= "reported";
    }
  }
  return out;
}

/** The conversations whose rows `foldSurfaceUsage` folds for this viewer:
 * their tool calls stay out of that viewer's stats. */
export function foldedSurfaceThreads(rows: readonly UsageRow[], viewerPrincipalId: string | null): Set<string> {
  const viewer = viewerPrincipalId?.trim().toLowerCase() || null;
  const out = new Set<string>();
  for (const row of rows) {
    if (row.surface === true && row.threadId && !(viewer !== null && (row.ownerPrincipalId?.trim().toLowerCase() ?? "") === viewer)) out.add(row.threadId);
  }
  return out;
}

/** The calendar months (UTC, as the ledger's files) a range touches, whole:
 * from the 1st of its first month to the last instant of its last. */
export function wholeMonths(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const from = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
  const to = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth() + 1, 1) - 1);
  return { from, to };
}

/** The ledger as `viewerPrincipalId` reads it over `range`: their own rows
 * and every other bot's as read, and another person's surface rows read over
 * the whole months the range touches, then folded, so no range (one day, a
 * week) ever gives less than a month of a chat's spend. */
export function surfaceLedger(
  rows: readonly UsageRow[],
  range: { from: Date; to: Date },
  viewerPrincipalId: string | null,
  read: (range: { from: Date; to: Date }) => UsageRow[],
): UsageRow[] {
  const viewer = viewerPrincipalId?.trim().toLowerCase() || null;
  const others = (row: UsageRow) => row.surface === true && !(viewer !== null && (row.ownerPrincipalId?.trim().toLowerCase() ?? "") === viewer);
  const months = wholeMonths(range);
  const kept = rows.filter((row) => !others(row));
  const widened = months.from.getTime() === range.from.getTime() && months.to.getTime() === range.to.getTime()
    ? rows.filter(others)
    : read(months).filter(others);
  return foldSurfaceUsage([...kept, ...widened], viewer);
}
