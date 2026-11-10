// The warm host pool (#3357, connectors across engines L14; design
// docs/design/connectors-across-engines.md, part P4 and lot L14).
//
// A connector host that keeps a process (the Grok CLI, Codex's
// app-server) keeps one warm per person and account: the first call starts
// it, the next call of that same person on that same sign-in reuses it, and
// it ends once it has been idle for `idleMs`. Calls never wait for one
// another: when the warm process is busy (parallel calls of one turn, two
// bots of the same person), the call starts an extra process at once, and
// once done that process becomes the warm one if none is, or ends. A process
// is never shared between two people or two accounts: the key is the turn's
// connector principal and the account's key, never a tool argument.
//
// The pool keeps the engine rules every other engine process follows:
//   - the start limit: a launch goes through the engine start gate (the
//     boot window's probe slots), as the cold call did;
//   - the memory guard: when the server's memory reads high, a process is
//     ended as soon as its call is done instead of idling, and the idle ones
//     are ended before a new one starts;
//   - an account's processes are retired at its own sign-out, a new sign-in
//     on it, or a reset of the person's sign-ins (never on a reach probe's
//     notice, never another account's): the idle one ends at once, a busy
//     one finishes its call and ends then, never kept warm; only the
//     shutdown (`close`) ends a busy one, and nothing outlives the server.
// It decides nothing about a call: the person's approval settings already
// did, on the calling turn, before the host is asked.

/** One process a host keeps warm. */
export interface WarmProcess {
  /** False once the process is gone. */
  alive(): boolean;
  /** End the process; resolves once it is gone. Safe to call twice. */
  stop(): Promise<void>;
}

/** What a call answers, and whether its process may serve the next call
 * (false after a timeout, a protocol error or anything unclear). */
export interface PoolWork<T> {
  value: T;
  keep: boolean;
}

export interface ConnectorHostPoolOptions {
  /** How long a process waits for the next call. 0: ended after each call. */
  idleMs?: number;
  /** The start limit. Each host passes the engine start gate (its probe
   * slots); without one, a start runs as is. */
  gate?<T>(label: string, run: () => Promise<T>): Promise<T>;
  /** The memory guard: false while the server's memory reads high. */
  memoryOk?(): boolean;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

export interface ConnectorHostPoolStats {
  /** Processes alive now (busy or idle). */
  warm: number;
  busy: number;
  /** Processes started, and calls served by one already running. */
  launches: number;
  reuses: number;
}

export interface ConnectorHostPool<P extends WarmProcess> {
  /** Run `work` at once on this person's and account's warm process, or on
   * one started with `start` when none is free. */
  use<T>(key: { principalId: string; accountKey: string }, label: string, start: () => Promise<P>, work: (proc: P, warm: boolean) => Promise<PoolWork<T>>): Promise<T>;
  /** Retire this person's processes on one account (its sign-out, a new
   * sign-in on it), or on all of them when no key is given (a reset of the
   * person's sign-ins). The idle ones end now; a busy one finishes its call
   * with its real result and ends then, never kept warm. */
  stopPrincipal(principalId: string, accountKey?: string): Promise<void>;
  /** End every idle process (the memory guard). */
  stopIdle(): Promise<void>;
  /** End everything; later calls still run, each on a process of its own. */
  close(): Promise<void>;
  stats(): ConnectorHostPoolStats;
}

/** A warm process waits this long for the next call of the same person and
 * account: a conversation's next connector call is usually seconds away. */
export const CONNECTOR_HOST_IDLE_MS = 5 * 60_000;

interface Entry<P> {
  principalId: string;
  /** The warm process waiting for the next call. */
  idle?: P;
  timer?: unknown;
  /** Processes serving a call now. */
  active: Set<P>;
  /** Calls of this key in progress, starting ones included. */
  calls: number;
}

const keyOf = (principalId: string, accountKey: string) => `${principalId}\u0000${accountKey}`;

export function createConnectorHostPool<P extends WarmProcess>(options: ConnectorHostPoolOptions = {}): ConnectorHostPool<P> {
  const idleMs = Math.max(0, options.idleMs ?? CONNECTOR_HOST_IDLE_MS);
  const gate = options.gate ?? (<T>(_label: string, run: () => Promise<T>) => run());
  const memoryOk = options.memoryOk ?? (() => true);
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => {
    const timer = setTimeout(run, ms);
    (timer as { unref?: () => void }).unref?.();
    return timer;
  });
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry<P>>();
  /** Retired keys whose calls are still running: no longer served, ended
   * once their last call is done, and still ended at shutdown. */
  const retired = new Set<Entry<P>>();
  let closed = false;
  let launches = 0;
  let reuses = 0;

  const disarm = (entry: Entry<P>) => {
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.timer = undefined;
  };

  async function stopProc(proc: P): Promise<void> {
    try { await proc.stop(); } catch { /* a process that cannot stop is gone with the server */ }
  }

  /** Forget a key that holds no process any more. */
  const prune = (id: string, entry: Entry<P>) => {
    if (!entry.idle && entry.calls === 0 && entries.get(id) === entry) entries.delete(id);
  };

  async function endIdle(id: string, entry: Entry<P>): Promise<void> {
    disarm(entry);
    const proc = entry.idle;
    entry.idle = undefined;
    prune(id, entry);
    if (proc) await stopProc(proc);
  }

  /** End this key's processes, the busy ones too: shutdown only. */
  async function endAll(id: string, entry: Entry<P>): Promise<void> {
    const busy = [...entry.active];
    await Promise.all([endIdle(id, entry), ...busy.map(stopProc)]);
  }

  /** The memory guard before a start: idle processes go first. */
  async function stopIdle(): Promise<void> {
    await Promise.all([...entries].filter(([, entry]) => entry.idle).map(([id, entry]) => endIdle(id, entry)));
  }

  async function run<T>(id: string, entry: Entry<P>, label: string, start: () => Promise<P>, work: (proc: P, warm: boolean) => Promise<PoolWork<T>>): Promise<T> {
    entry.calls += 1;
    let proc: P | undefined;
    let keep = false;
    try {
      let warm = false;
      const ready = entry.idle;
      if (ready) {
        disarm(entry);
        entry.idle = undefined;
        if (ready.alive()) {
          proc = ready;
          warm = true;
          reuses += 1;
        } else {
          void stopProc(ready);
        }
      }
      if (!proc) {
        if (!memoryOk()) await stopIdle();
        proc = await gate(label, start);
        launches += 1;
      }
      entry.active.add(proc);
      const done = await work(proc, warm);
      keep = done.keep;
      return done.value;
    } finally {
      entry.calls -= 1;
      if (proc) {
        entry.active.delete(proc);
        // kept only on a key still in use (not signed out, not closed) that
        // has no warm process yet; an extra process ends after its call
        const current = entries.get(id) === entry;
        if (!keep || closed || !current || idleMs === 0 || !memoryOk() || !proc.alive() || entry.idle) {
          prune(id, entry);
          await stopProc(proc);
        } else {
          const kept = proc;
          entry.idle = kept;
          entry.timer = setTimer(() => {
            entry.timer = undefined;
            if (entry.idle === kept) void endIdle(id, entry);
          }, idleMs);
        }
      } else {
        prune(id, entry);
      }
      if (entry.calls === 0) retired.delete(entry);
    }
  }

  return {
    use(key, label, start, work) {
      const principalId = key.principalId.trim().toLowerCase();
      const id = keyOf(principalId, key.accountKey);
      let entry = entries.get(id);
      if (!entry) {
        entry = { principalId, active: new Set(), calls: 0 };
        entries.set(id, entry);
      }
      return run(id, entry, label, start, work);
    },
    async stopPrincipal(principalId, accountKey) {
      const person = principalId.trim().toLowerCase();
      const mine = [...entries].filter(([id, entry]) => entry.principalId === person && (accountKey === undefined || id === keyOf(person, accountKey)));
      // the next call starts fresh; a call in progress finishes and its
      // process ends then (the key is no longer current, so it is not kept)
      for (const [id, entry] of mine) {
        entries.delete(id);
        if (entry.calls > 0) retired.add(entry);
      }
      await Promise.all(mine.map(([id, entry]) => endIdle(id, entry)));
    },
    stopIdle,
    async close() {
      closed = true;
      const all = [...entries, ...[...retired].map((entry) => ["", entry] as const)];
      entries.clear();
      retired.clear();
      await Promise.all(all.map(([id, entry]) => endAll(id, entry)));
    },
    stats() {
      const all = [...entries.values(), ...retired];
      const busy = all.reduce((sum, entry) => sum + entry.active.size, 0);
      return {
        warm: all.reduce((sum, entry) => sum + [...entry.active].filter((proc) => proc.alive()).length + (entry.idle?.alive() ? 1 : 0), 0),
        busy,
        launches,
        reuses,
      };
    },
  };
}
