import { AsyncLocalStorage } from "node:async_hooks";

/** #3062: one gate per Perspicax MCP session. Ordinary calls on the session
 * share it and run side by side. A role switch made by Sagax itself (switch,
 * the call sent under the other role, the role put back) holds it alone: it
 * waits for the calls in flight, and every call that comes in meanwhile waits
 * until the original role is back, so no call of the turn is ever sent under
 * a role it did not ask for.
 *
 * Re-entry: code that already holds the gate (a call that reopens its
 * session, the identity traffic of the switch itself) passes through instead
 * of waiting on itself. A hold taken while sharing is a bug in the caller: it
 * would wait forever on itself, so it throws instead. */
interface Hold {
  gate: IdentityGate;
  mode: "shared" | "exclusive";
  released: boolean;
}

const holds = new AsyncLocalStorage<Hold[]>();

export class IdentityGate {
  private inFlight = 0;
  private drained: Array<() => void> = [];
  /** Exclusive holds, one after the other: the tail of that chain. */
  private tail: Promise<void> = Promise.resolve();
  /** Exclusive holds queued or running; while any, new shared calls wait. */
  private exclusiveCount = 0;
  private exclusiveDone: Promise<void> = Promise.resolve();

  private held(): Hold | undefined {
    return holds.getStore()?.find((hold) => hold.gate === this && !hold.released);
  }

  private run<T>(mode: Hold["mode"], fn: () => Promise<T>): { hold: Hold; result: Promise<T> } {
    const hold: Hold = { gate: this, mode, released: false };
    const result = holds.run([...(holds.getStore() ?? []), hold], fn);
    return { hold, result };
  }

  /** An ordinary call on the session. */
  async shared<T>(fn: () => Promise<T>): Promise<T> {
    if (this.held()) return fn();
    while (this.exclusiveCount > 0) await this.exclusiveDone;
    this.inFlight++;
    const { hold, result } = this.run("shared", fn);
    try {
      return await result;
    } finally {
      hold.released = true;
      if (--this.inFlight === 0) for (const wake of this.drained.splice(0)) wake();
    }
  }

  /** A role switch and everything until the role is back. */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.held();
    if (current?.mode === "exclusive") return fn();
    if (current) throw new Error("identity gate: a role switch cannot start inside a call on the same session");
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const before = this.tail;
    this.tail = before.then(() => done);
    this.exclusiveCount++;
    this.exclusiveDone = this.tail;
    await before;
    if (this.inFlight > 0) await new Promise<void>((resolve) => this.drained.push(resolve));
    const { hold, result } = this.run("exclusive", fn);
    try {
      return await result;
    } finally {
      hold.released = true;
      this.exclusiveCount--;
      finish();
    }
  }
}
