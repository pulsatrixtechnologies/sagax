// #2045: bot/group membership links a team by its stable section id
// (`sec_<uuid>`), while `section` stays the displayed name. Legacy rows that
// only carry the name still match until migration stamps the id.

export const SECTION_ID_RE =
  /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = (section?: string | null): string => section?.trim() || "";

export function isSectionId(value?: string | null): boolean {
  return Boolean(value && SECTION_ID_RE.test(value.trim()));
}

export type SectionLink = {
  section?: string | null | undefined;
  sectionId?: string | null | undefined;
};

/** Prefer the stable id; fall back to the display name for unmigrated rows. */
export function sameTeamLink(
  record: SectionLink,
  target: { name?: string | null; id?: string | null },
): boolean {
  const id = target.id?.trim();
  if (id) {
    if (record.sectionId?.trim() === id) return true;
    // Keep reading old data: a row that stored the id in `section` itself.
    if (isSectionId(record.section) && key(record.section) === id) return true;
    // Id known and the record has a different id: not a match, even if names agree.
    if (record.sectionId?.trim()) return false;
  }
  const name = key(target.name);
  if (!name) return !key(record.section) && !record.sectionId?.trim();
  return key(record.section) === name;
}

/** Stamp missing sectionId values from (name, owner) → id. Returns how many moved. */
export function migrateSectionLinks<T extends SectionLink>(
  rows: readonly T[],
  ownerOf: (row: T) => string,
  resolve: (name: string, ownerPrincipalId: string) => string | null,
): { next: T[]; moved: number } {
  let moved = 0;
  const next = rows.map((row) => {
    const existing = row.sectionId?.trim();
    if (existing && isSectionId(existing)) return row;
    const name = key(row.section);
    if (!name || isSectionId(name)) {
      if (isSectionId(name) && !existing) {
        moved += 1;
        return { ...row, sectionId: name };
      }
      return row;
    }
    const owner = ownerOf(row).trim().toLowerCase();
    if (!owner) return row;
    const id = resolve(name, owner);
    if (!id) return row;
    moved += 1;
    return { ...row, sectionId: id };
  });
  return { next, moved };
}

/** Rewrite managedSections that still hold display names onto section ids. */
export function migrateManagedSectionIds(
  managed: readonly string[] | undefined,
  ownerPrincipalId: string,
  resolve: (name: string, ownerPrincipalId: string) => string | null,
): string[] | undefined {
  if (!managed?.length) return managed as string[] | undefined;
  let changed = false;
  const next = managed.map((entry) => {
    const name = key(entry);
    if (!name || isSectionId(name)) return name || entry;
    const id = resolve(name, ownerPrincipalId);
    if (!id) return entry;
    changed = true;
    return id;
  });
  return changed ? [...new Set(next.filter(Boolean))] : [...managed];
}

/** Whether a Primary Bot's managed list reaches this team (id first, name fallback).
 * When `resolveName` is provided, a display-name grant matches only the id
 * it resolves to for that Primary Bot's owner (#2045). Without a resolver,
 * name grants still match by display name for solo / unmigrated rows. */
export function managesTeam(
  managed: readonly string[] | undefined,
  target: { name?: string | null; id?: string | null },
  resolveName?: (name: string) => string | null,
): boolean {
  if (!Array.isArray(managed) || !managed.length) return false;
  const id = target.id?.trim();
  const name = key(target.name);
  return managed.some((entry) => {
    if (typeof entry !== "string") return false;
    const value = key(entry);
    // An empty grant still reaches the unsectioned (General) team.
    if (!value) return !name && !id;
    if (id && value === id) return true;
    if (isSectionId(value)) return false;
    if (resolveName) {
      const resolved = resolveName(value);
      if (id) return resolved === id;
      return Boolean(name && value === name && (!resolved || !id));
    }
    if (name && value === name) return true;
    return false;
  });
}
