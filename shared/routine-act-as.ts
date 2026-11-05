/** 2026-11-05 (visible roles, batch 4): a routine's "Au nom de" role, the
 * Perspicax role its runs act as (shared/perspicax-roles.ts). A slug of a
 * role the run-as person holds, or "" for "Moi" (their own default
 * surface). Absent: not chosen yet; the run starts on the default surface
 * and the editor saves the minimal covering role on the next save. Runs
 * snapshot it (RoutineRun.actAs). */

/** Role slugs are Perspicax profile slugs: bounded, no spaces. */
const ROLE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export const ROUTINE_ACT_AS_INVALID = "actAs is a role slug the run-as person holds (at most 120 characters), \"\" for their own access, or null to clear it.";

/** null or omitted: no choice (undefined). "" is an explicit "Moi". */
export function parseRoutineActAs(value: unknown): { ok: true; actAs?: string } | { ok: false; error: string } {
  if (value == null) return { ok: true };
  if (typeof value !== "string") return { ok: false, error: ROUTINE_ACT_AS_INVALID };
  const slug = value.trim();
  if (!slug) return { ok: true, actAs: "" };
  if (!ROLE_SLUG.test(slug)) return { ok: false, error: ROUTINE_ACT_AS_INVALID };
  return { ok: true, actAs: slug };
}

/** A persisted value that no longer reads is dropped (not chosen). */
export function loadRoutineActAs(value: unknown): string | undefined {
  const parsed = parseRoutineActAs(value);
  return parsed.ok ? parsed.actAs : undefined;
}
