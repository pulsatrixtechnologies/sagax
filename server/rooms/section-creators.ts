// Who created each section, for the owner check of an organization start
// (#2045 isolation) and the owner of a legacy name without a record.
//
// #3545: this used to read the whole activity log since the beginning, in
// one synchronous pass, at every start. The creators now live beside the
// section records (SectionChannels.creatorOf / creatorsOfName): noted as a
// section is created, and filled once from the log for the sections created
// before. After that fill a start reads no activity row for them.
import { readAdminActivityRange, scanAdminActivityRange, type AdminActionRow } from "../activity/admin-activity.ts";
import type { SectionChannels, SectionCreation } from "./section-channels.ts";

const SECTION_CREATE = "section.create";
const onlyCreations = (action: string) => action === SECTION_CREATE;
const everything = () => ({ from: new Date(0), to: new Date() });

/** The creation an audit row records, or null for any other row. */
export function sectionCreationOf(row: Pick<AdminActionRow, "action" | "target" | "actor">): SectionCreation | null {
  if (row.action !== SECTION_CREATE || row.target?.kind !== "section") return null;
  const actor = (row.actor as { principalId?: unknown } | undefined)?.principalId;
  if (typeof actor !== "string" || !actor.trim()) return null;
  return {
    principalId: actor,
    ...(row.target.id ? { id: row.target.id } : {}),
    ...(row.target.name ? { name: row.target.name } : {}),
  };
}

const creationsOf = (rows: readonly AdminActionRow[]) => rows.flatMap((row) => {
  const creation = sectionCreationOf(row);
  return creation ? [creation] : [];
});

/**
 * At a start: fill the creators once. Nothing is read when they are already
 * filled. `needNow`: the start weighs the evidence before it goes on (the
 * owner check has not run yet, or a section name has no record), so the fill
 * reads the log now, opening only the creation rows; otherwise it reads in
 * slices that give the event loop back and the returned promise settles
 * when done. A read that fails leaves the creators unfilled (the next start
 * tries again) and is logged.
 */
export function prepareSectionCreators(channels: SectionChannels, dataDir: string, needNow: boolean): Promise<void> | null {
  if (channels.creatorsFilled()) return null;
  const failed = (error: unknown) => console.warn(`sections: could not read who created each section (${error instanceof Error ? error.message : String(error)})`);
  if (needNow) {
    try {
      channels.fillCreators(creationsOf(readAdminActivityRange(dataDir, everything(), { action: onlyCreations })));
    } catch (error) {
      failed(error);
    }
    return null;
  }
  return scanAdminActivityRange(dataDir, everything(), { action: onlyCreations })
    .then((rows) => channels.fillCreators(creationsOf(rows)))
    .catch(failed);
}
