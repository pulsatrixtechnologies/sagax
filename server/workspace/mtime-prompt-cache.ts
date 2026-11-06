// Process-local cache of prompt fragments (#1950 follow-up on #1971).
// Keyed by namespace + bot + variant; invalidated when any watched path's
// truncated mtime and size change. Same trade as the memory journal
// baseline: a same-size edit that keeps the same mtime is missed.
import { lstatSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";

type Entry<T> = { fingerprint: string; value: T };

const caches = new Map<string, Map<string, Entry<unknown>>>();

function truncStat(stat: Stats): string {
  return `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
}

/** One path's fingerprint: `mtime:size`, or `missing` when absent. Links are
 * fingerprinted as themselves (lstat), never followed. */
export function pathFingerprint(absolute: string): string {
  try {
    return truncStat(lstatSync(absolute));
  } catch {
    return "missing";
  }
}

/** Join fingerprints for a fixed list of absolute paths, in order. */
export function pathsFingerprint(absolutes: readonly string[]): string {
  return absolutes.map((path) => `${path}=${pathFingerprint(path)}`).join("|");
}

/** Directory listing fingerprint: the directory itself plus each direct
 * child that passes `include` (default: every name). Order is sorted so a
 * rename that swaps two names still changes the string. Missing dir → `missing`. */
export function dirFingerprint(
  absolute: string,
  include: (name: string) => boolean = () => true,
): string {
  let dirStat: string;
  try {
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return `${absolute}=not-dir`;
    dirStat = truncStat(stat);
  } catch {
    return `${absolute}=missing`;
  }
  let names: string[];
  try {
    names = readdirSync(absolute).filter(include).sort();
  } catch {
    return `${absolute}=${dirStat}|unlistable`;
  }
  const parts = [`${absolute}=${dirStat}`];
  for (const name of names) {
    parts.push(`${name}=${pathFingerprint(join(absolute, name))}`);
  }
  return parts.join("|");
}

/** Return a cached value when the fingerprint matches; otherwise compute,
 * store, and return. `variant` separates option combinations (writes on/off,
 * tools mode, calendar day, …). */
export function mtimeCached<T>(
  namespace: string,
  botId: string,
  variant: string,
  fingerprint: string,
  compute: () => T,
): T {
  let bucket = caches.get(namespace);
  if (!bucket) caches.set(namespace, (bucket = new Map()));
  const key = `${botId}\0${variant}`;
  const hit = bucket.get(key) as Entry<T> | undefined;
  if (hit && hit.fingerprint === fingerprint) return hit.value;
  const value = compute();
  bucket.set(key, { fingerprint, value });
  return value;
}

/** Drop every cached fragment (tests). */
export function resetMtimePromptCache(): void {
  caches.clear();
}

/** Test seam: whether a namespace currently holds an entry for this bot/variant. */
export function mtimePromptCacheHas(namespace: string, botId: string, variant: string): boolean {
  return caches.get(namespace)?.has(`${botId}\0${variant}`) === true;
}
