// Lot S1 (2026-11-17): the usage of a person's surface bot (server/temporary-
// agents.ts) as anyone but that person reads it. The person reads every row
// of it in their own usage (GET /api/me/usage...). Anyone else (an
// organization admin's ledger, the console, traces, the CSV) reads one row
// per person, day, engine and model: no conversation id, no bot, no time
// within the day, no list of sends. Nothing is capped.
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
    const day = row.at.slice(0, 10);
    const key = [day, owner, row.instanceId, row.model, row.access ?? "", row.payerPrincipalId ?? ""].join("|");
    const into = folded.get(key);
    if (!into) {
      const first: UsageRow = {
        at: `${day}T00:00:00.000Z`, botId: "", botName: SURFACE_USAGE_LABEL, threadId: "",
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
