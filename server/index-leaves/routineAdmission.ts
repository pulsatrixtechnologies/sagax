// @ts-nocheck
/** routineAdmission (#1388). Pure move from server/index.ts. */
import { ROUTINE_UNREACHABLE_RETRIED, ROUTINE_UNREACHABLE_RETRY_MS, ROUTINE_UNREACHABLE_SKIPPED } from "../routines/routines.ts";
export type Host = Record<string, any>;

export function createRoutineAdmission(getHost: () => Host): any {
async function routineAdmission(run: RoutineRun, _routine: Routine | undefined) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return { ok: true };
  const principalId = host.effectiveRunAs(run);
  const person = principalId ? host.principals.byId(principalId) : null;
  if (!principalId || !person || person.subject?.iss !== host.IDENTITY.issuer) {
    return { ok: false, error: "This routine runs as someone who is not in this organization", suspend: "no_right" };
  }
  const name = person.name || person.login || "its person";
  if (person.disabledAt !== undefined) return { ok: false, error: "The person this routine runs as was signed out by Perspicax", suspend: "person_out" };
  if (person.consoleDisabled) return { ok: false, error: "The person this routine runs as is disabled on this server by an administrator" };
  if (!host.principalMayRunRoutine(principalId, run)) return { ok: false, error: `${name} can no longer run this bot's routines`, suspend: "no_right" };
  if (!host.routineConsents) return { ok: false, error: "Perspicax is unreachable; this run is skipped" };
  const prepared = await host.routineConsents.prepare(principalId);
  if (prepared.ok) return { ok: true };
  // Fix 2: a rate limit keeps the run queued (server/routines/routines.ts retries it).
  if (prepared.error === "rate_limited") return { ok: false, error: "Perspicax is rate limiting this server; this run is retried", retryAfterMs: prepared.retryAfterMs };
  if (prepared.error === "missing" || prepared.error === "ended") return { ok: false, error: `Perspicax did not issue ${name}'s routine access yet; this run is skipped and the next one tries again` };
  // 2026-11-02: unreachable is most often a short roll of the connector:
  // the run waits and tries again in its window instead of skipping now.
  return { ok: false, error: ROUTINE_UNREACHABLE_RETRIED, retryAfterMs: ROUTINE_UNREACHABLE_RETRY_MS, skipped: ROUTINE_UNREACHABLE_SKIPPED };

}
  return routineAdmission;
}
