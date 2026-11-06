// @ts-nocheck
/** purgeConfidentialEngineKeys (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPurgeConfidentialEngineKeys(getHost: () => Host): any {
function purgeConfidentialEngineKeys(keys: readonly string[], why: string, options: { live?: readonly string[]; recheck?: boolean } = {}) {
  const host = getHost();
  const { DATA_DIR, readPendingPurges } = host;
  const pending = readPendingPurges(DATA_DIR);
  if (!keys.length && !pending.length) return;
  const started = Date.now();
  const homes = host.engineHomes();
  const vacuumLeft = compactPending(pending.flatMap((entry) => entry.vacuum));
  const seed = new Set([...keys, ...pending.flatMap((entry) => entry.keys)]);
  const result = purgeEngineSessions(homes, seed);
  const live = new Set(options.live ?? []);
  const kept = [...result.keys].filter((key) => !live.has(key));
  // a new purge starts its own count; retries alone add to the earlier one
  const attempts = keys.length ? 1 : Math.max(0, ...pending.map((entry) => entry.attempts)) + 1;
  const vacuum = [...new Set([...vacuumLeft, ...result.vacuum])];
  const unfinished = result.failed.length > 0 || vacuum.length > 0;
  const next = (unfinished && attempts <= ENGINE_PURGE_ATTEMPTS) || options.recheck
    ? [{ keys: kept, vacuum, attempts: unfinished ? attempts : 0 }] : [];
  if (unfinished && attempts > ENGINE_PURGE_ATTEMPTS) console.warn(`confidential thread: engine transcripts could not all be purged after ${ENGINE_PURGE_ATTEMPTS} attempts; ${result.failed.length + vacuum.length} file(s) left (operator level)`);
  if (result.incomplete) console.warn("confidential thread: the engine homes hold more entries than a purge walks; some were not seen");
  try { writePendingPurges(DATA_DIR, next); } catch { /* retried from the roster at the next start */ }
  if (result.removed || result.rewritten || result.rows || unfinished || pending.length) {
    console.log(`confidential thread (${why}): engine transcripts purged, ${describePurge(result)}${pending.length ? `, ${pending.length} earlier purge(s) retried` : ""} in ${Date.now() - started} ms`);
  }

}
  return purgeConfidentialEngineKeys;
}
