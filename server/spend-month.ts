// Month-to-date spend from the usage ledger, shared by the workspace cap
// (server/spend.ts) and the personal cap (server/personal-spend-cap.ts).
import { readUsage, usageRowKey } from "./usage-ledger.ts";

const CACHE_MS = 15_000;
// Every turn start asks; reading the month file each time would be silly.
// A read keeps the keys of the rows it summed, so a booked row can be told
// apart from the same row read back later.
const cache = new Map<string, { at: number; month: string; fileUsd: number; keys: Set<string> }>();
// Booked turns whose ledger row may not be on disk yet: dataDir → row key →
// cost. The append is asynchronous, and a turn that ran longer than CACHE_MS
// would otherwise be re-read out of the month before its own row landed.
const unwritten = new Map<string, Map<string, { month: string; costUsd: number }>>();

function monthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

const costOf = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** Reported and estimated cost this month so far: the ledger file (read at
 * most every CACHE_MS) plus turns booked since whose rows have not landed. */
export function monthToDateSpend(dataDir: string, now = new Date()): number {
  const month = monthOf(now);
  let read = cache.get(dataDir);
  if (!read || read.month !== month || now.getTime() - read.at >= CACHE_MS) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = readUsage(dataDir, { from, to: now });
    read = { at: now.getTime(), month, fileUsd: rows.reduce((sum, row) => sum + costOf(row.costUsd), 0), keys: new Set(rows.map(usageRowKey)) };
    cache.set(dataDir, read);
  }
  let pending = 0;
  for (const [key, entry] of unwritten.get(dataDir) ?? []) {
    if (entry.month === month && !read.keys.has(key)) pending += entry.costUsd;
  }
  return read.fileUsd + pending;
}

/** Called as a turn is booked, with the ledger's write for its row
 * (appendUsage's promise). The cost counts from memory at once; when the
 * row lands it moves into the cached read, and a re-read that already sees
 * the row never counts it twice. A write that failed stops counting, as
 * the ledger has no row for it. */
export function noteSpend(
  dataDir: string,
  row: { at: string; threadId: string; botId: string; costUsd: number | null | undefined },
  written: Promise<boolean>,
): void {
  const costUsd = costOf(row.costUsd);
  if (!costUsd) return;
  const key = usageRowKey(row);
  const month = row.at.slice(0, 7);
  const entries = unwritten.get(dataDir) ?? new Map<string, { month: string; costUsd: number }>();
  unwritten.set(dataDir, entries);
  entries.set(key, { month, costUsd });
  void written.then((landed) => {
    entries.delete(key);
    if (entries.size === 0 && unwritten.get(dataDir) === entries) unwritten.delete(dataDir);
    const read = cache.get(dataDir);
    if (landed && read && read.month === month && !read.keys.has(key)) {
      read.fileUsd += costUsd;
      read.keys.add(key);
    }
  });
}

export function resetSpendCacheForTests(): void {
  cache.clear();
  unwritten.clear();
}
