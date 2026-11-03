// How much a folder holds and how much room its disk has left, for the
// phone's Bot Computer screen. Bounded: a huge folder answers null rather
// than keeping the request open.
import { lstat, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";

/** Total bytes of the regular files under `root` (links not followed), or
 * null when it does not exist or holds more than `maxEntries` entries or
 * takes longer than `budgetMs`. */
export async function folderBytes(root: string, options: { maxEntries?: number; budgetMs?: number } = {}): Promise<number | null> {
  const maxEntries = options.maxEntries ?? 50_000;
  const deadline = Date.now() + (options.budgetMs ?? 2_000);
  let total = 0;
  let seen = 0;
  const pending = [root];
  try {
    if (!(await lstat(root)).isDirectory()) return null;
    while (pending.length) {
      const dir = pending.pop()!;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (++seen > maxEntries || Date.now() > deadline) return null;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) total += (await lstat(path)).size;
      }
    }
    return total;
  } catch {
    return null;
  }
}

/** Free and total bytes of the disk holding `path`, or nulls. */
export async function diskSpace(path: string): Promise<{ freeBytes: number | null; totalBytes: number | null }> {
  try {
    const stats = await statfs(path);
    return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}
