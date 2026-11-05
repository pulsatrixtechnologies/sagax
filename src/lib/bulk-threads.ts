// Archive all threads / Delete all threads (the maintainer, 2026-11-04): the single-thread
// archive and delete paths (the store's updateTask / deleteTask and their
// room twins), run for every thread of a bot or a room with a bounded number
// in flight. There is no bulk route on the server; each thread goes through
// the same request a single Archive or Delete sends.
//
// Which threads: the ones the sidebar lists for that owner. A thread at work
// is left alone, as its own menu greys Archive and Delete out while it works.
// Pinned threads are included: a single Archive or Delete takes a pinned
// thread too. Archive all skips threads already archived.

export const BULK_THREAD_CONCURRENCY = 4;

export type BulkThreadKind = "archive" | "delete";

export interface BulkThreadCandidate {
  threadId: string;
  busy?: boolean;
  activity?: string;
  archivedAt?: number | null;
  routineRunId?: string;
}

/** The threads Archive all or Delete all acts on. */
export function bulkThreadTargets<T extends BulkThreadCandidate>(tasks: readonly T[], kind: BulkThreadKind): T[] {
  return tasks.filter((task) => !task.routineRunId && !task.busy && task.activity !== "working"
    && (kind === "delete" || typeof task.archivedAt !== "number"));
}

/** Runs `run` on every item, at most `limit` at a time; resolves with how
 * many succeeded once all have settled. */
export async function runBounded<T>(items: readonly T[], limit: number, run: (item: T) => Promise<boolean>): Promise<number> {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        if (await run(item)) done += 1;
      } catch {
        // one failed thread does not stop the others; the store shows its error
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return done;
}

/** A store action with an onSettled callback, as a promise of its outcome. */
export function settled(send: (onSettled: (ok: boolean) => void) => void): Promise<boolean> {
  return new Promise((resolve) => send(resolve));
}
