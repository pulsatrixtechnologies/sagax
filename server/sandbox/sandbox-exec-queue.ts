// The commands of one person's server environment, in the order they came
// (#3440, 2026-11-10).
//
// Every bot of a person shares one environment, and the environment runs a
// few commands at once (sandboxd-core MAX_CONCURRENT_EXECS): the next one was
// refused at once ("too many commands are running in this environment").
// With about fifteen bots of one person in turns, the bots' own commands,
// even `echo ok`, were refused turn after turn while the environment itself
// was idle.
//
// Now the server holds a person's commands in line instead: each command
// waits for a free place and runs, in the order it came. The plugin copy's
// commands wait in the same line as the bots' own: a turn (or a bot's
// tools/call) waits for its copy, so the copy is that bot's own work and
// must not wait behind the others. It never starves them either: the copy
// of one person runs at most two commands at once (syncPluginsForTurn.ts
// PLUGIN_SYNC_EXEC_SLOTS), so the other places stay with the bots' commands.
// Nothing is refused for being many: a command that could not get a place
// within its call's time says so plainly, and nothing ran.

/** Commands one environment runs at once (sandboxd-core MAX_CONCURRENT_EXECS). */
export const SANDBOX_EXEC_SLOTS = 4;

interface Line {
  active: number;
  waiting: Array<() => void>;
}

export interface SandboxExecQueueOptions {
  slots?: number;
}

export class SandboxExecQueue {
  private readonly lines = new Map<string, Line>();
  private readonly slots: number;

  constructor(options: SandboxExecQueueOptions = {}) {
    this.slots = options.slots ?? SANDBOX_EXEC_SLOTS;
  }

  /** Commands running and waiting now for this key. */
  load(key: string): { active: number; waiting: number } {
    const line = this.lines.get(key);
    return { active: line?.active ?? 0, waiting: line?.waiting.length ?? 0 };
  }

  /** Waits for a place for `key`, then resolves with its release. Rejects
   * with `onGiveUp()` when no place came within `waitMs` (nothing ran). */
  acquire(key: string, waitMs: number, onGiveUp: (load: { active: number; waiting: number }) => Error): Promise<() => void> {
    let line = this.lines.get(key);
    if (!line) { line = { active: 0, waiting: [] }; this.lines.set(key, line); }
    const owned = line;
    return new Promise<() => void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const start = () => {
        if (timer) clearTimeout(timer);
        owned.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          owned.active -= 1;
          this.pump(key, owned);
        });
      };
      owned.waiting.push(start);
      this.pump(key, owned);
      if (!owned.waiting.includes(start)) return;
      timer = setTimeout(() => {
        const index = owned.waiting.indexOf(start);
        if (index < 0) return;
        owned.waiting.splice(index, 1);
        const load = { active: owned.active, waiting: owned.waiting.length };
        this.pump(key, owned);
        reject(onGiveUp(load));
      }, Math.max(0, waitMs));
      timer.unref?.();
    });
  }

  /** Starts what can start, in the order it came. */
  private pump(key: string, line: Line): void {
    while (line.active < this.slots && line.waiting.length) line.waiting.shift()!();
    if (line.active === 0 && line.waiting.length === 0 && this.lines.get(key) === line) this.lines.delete(key);
  }
}
