// Port de OpenMausBot #3132 (réécrit pour Sagax) : a conversation nobody
// read or wrote for a while gives its parsed transcript back to the heap.
// SQLite (messages.db) stays the source of truth; the next read reloads it.
import type { ThreadRows } from "./message-db.ts";
import type { Message } from "./store.ts";

/** Messages form a tree (forks appear when a message is edited); the
 * visible conversation is the path from the root to activeLeafId. */
export interface ThreadState {
  messages: Message[];
  activeLeafId: string | null;
}

export const THREAD_IDLE_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 60_000;

export class ThreadCache {
  private entries = new Map<string, { state: ThreadState; usedAt: number }>();
  private sweptAt: number;
  private readonly busyThreadIds: () => ReadonlySet<string>;
  private readonly now: () => number;

  /** `busyThreadIds` names the conversations with a turn running: they stay
   * however long ago they were last read. */
  constructor(busyThreadIds: () => ReadonlySet<string>, now: () => number = Date.now) {
    this.busyThreadIds = busyThreadIds;
    this.now = now;
    this.sweptAt = now();
  }

  get(threadId: string): ThreadState | undefined {
    const now = this.now();
    this.sweep(now);
    const entry = this.entries.get(threadId);
    if (entry) entry.usedAt = now;
    return entry?.state;
  }

  /** Cache a full set of rows: legacy rows (no parentId) chain onto the row
   * before them, and the active leaf defaults to the newest message. */
  load(threadId: string, rows: ThreadRows): ThreadState {
    const { messages } = rows;
    let prev: string | null = null;
    for (const m of messages) {
      if (m.parentId === undefined) m.parentId = prev;
      prev = m.id;
    }
    const state = { messages, activeLeafId: rows.activeLeafId || (messages.at(-1)?.id ?? null) };
    this.entries.set(threadId, { state, usedAt: this.now() });
    return state;
  }

  delete(threadId: string): void {
    this.entries.delete(threadId);
  }

  get size(): number {
    return this.entries.size;
  }

  /** At most once a minute: drop the idle entries no running turn holds. */
  private sweep(now: number): void {
    if (now - this.sweptAt < SWEEP_EVERY_MS) return;
    this.sweptAt = now;
    let busy: ReadonlySet<string> | undefined;
    for (const [threadId, entry] of this.entries) {
      if (now - entry.usedAt < THREAD_IDLE_MS) continue;
      busy ??= this.busyThreadIds();
      if (!busy.has(threadId)) this.entries.delete(threadId);
    }
  }
}
