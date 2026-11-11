// One tailcat call at a time per tunnel key (#3430). Each `tailcat ssh` or
// `tailcat cp` is its own WireGuard endpoint with the session's client key;
// a second one started while the first still runs sends the host a new
// handshake for the same peer, and the host drops the first one's connection
// (ssh 255). A session shared by every bot of the person (#3393) therefore
// runs their calls one after the other, in arrival order.
//
// - When a call's turn comes, `live()` is asked again: a session that closed,
//   ended or was replaced while the call waited gets `closed`, never a send.
// - A call waits at most `waitMaxMs` for its turn, then gets `busy`, never a
//   send: running it again is safe. A call may bring a shorter wait of its
//   own (the tunnel probe, #3505), never a longer one.
// - `end(key)` (the session closes): every waiting call gets `closed` at
//   once, the running one is stopped (its runner kills it), and the promise
//   resolves when the slot is free.
// The command's own time limit starts when its turn comes.
import type { CommandResult, RunCommand } from "./remote-session-probe.ts";

/** How long a call waits for its turn on a busy tunnel. Well under the
 * bot's tool timeout (10 min, server/drivers/pi-mcp-extension.ts): 90 s of
 * wait, the longest command (2 min) and the kill grace (7 s) make 3.6 min.
 * The worst case of a whole host_computer call, with its probes and its one
 * second try, is counted from these constants by `hostExecWorstCaseMs`
 * (server/remote-support/host-computer-router.ts, #3505). */
export const TUNNEL_QUEUE_WAIT_MAX_MS = 90_000;
/** How long a tunnel probe (one ping, #3492) waits for its turn (#3505). A
 * few seconds, never the 90 s of a command: a tunnel that stays busy is in
 * use, so the session lives and the ping is not needed. */
export const TUNNEL_PROBE_WAIT_MAX_MS = 5_000;
/** The time a tunnel probe's ping (`tailcat ping --timeout=8s`) is given
 * once its turn came, with room to start. */
export const TUNNEL_PROBE_TIME_MS = 12_000;
/** The time a closing session's own stop command is given. */
export const SESSION_STOP_TIME_MS = 8_000;

/** The call was never sent: `closed` (the session closed, ended or was
 * replaced before its turn) or `busy` (other calls held the tunnel longer
 * than `TUNNEL_QUEUE_WAIT_MAX_MS`). */
export interface TunnelRefusal { notSent: "closed" | "busy" }

export const isTunnelRefusal = (value: unknown): value is TunnelRefusal =>
  Boolean(value && typeof value === "object" && "notSent" in value);

interface Waiter {
  go(): void;
  refuse(why: TunnelRefusal["notSent"]): void;
}

interface Lane {
  busy: boolean;
  waiting: Waiter[];
  abort: AbortController | null;
  /** Resolves when the running call has given its slot back. */
  running: Promise<void> | null;
}

export function createTunnelQueue(deps: { run: RunCommand; waitMaxMs?: number }) {
  const waitMaxMs = deps.waitMaxMs ?? TUNNEL_QUEUE_WAIT_MAX_MS;
  const lanes = new Map<string, Lane>();

  const laneOf = (key: string): Lane => {
    let lane = lanes.get(key);
    if (!lane) {
      lane = { busy: false, waiting: [], abort: null, running: null };
      lanes.set(key, lane);
    }
    return lane;
  };

  /** Give the slot to the next waiter, or free the lane. */
  const release = (key: string, lane: Lane) => {
    const next = lane.waiting.shift();
    if (next) { next.go(); return; }
    lane.busy = false;
    if (lanes.get(key) === lane) lanes.delete(key);
  };

  const turn = (lane: Lane, waitMs: number): Promise<"go" | TunnelRefusal["notSent"]> => {
    if (!lane.busy) {
      lane.busy = true;
      return Promise.resolve("go");
    }
    return new Promise((resolve) => {
      let done = false;
      const waiter: Waiter = {
        go: () => { if (done) return; done = true; clearTimeout(timer); resolve("go"); },
        refuse: (why) => { if (done) return; done = true; clearTimeout(timer); resolve(why); },
      };
      const timer = setTimeout(() => {
        const at = lane.waiting.indexOf(waiter);
        if (at >= 0) lane.waiting.splice(at, 1);
        waiter.refuse("busy");
      }, waitMs);
      timer.unref?.();
      lane.waiting.push(waiter);
    });
  };

  /** Run `argv` on the tunnel `key` once its turn comes and `live()` still
   * holds. A refusal means the call was never sent. `ownWaitMs`: a shorter
   * wait for its turn than the queue's. */
  async function submit(key: string, argv: string[], timeoutMs: number, live: () => boolean = () => true, ownWaitMs?: number): Promise<CommandResult | TunnelRefusal> {
    const lane = laneOf(key);
    const got = await turn(lane, ownWaitMs === undefined ? waitMaxMs : Math.min(waitMaxMs, Math.max(0, ownWaitMs)));
    if (got !== "go") return { notSent: got };
    let freed: () => void = () => undefined;
    lane.running = new Promise<void>((resolve) => { freed = resolve; });
    try {
      if (!live()) return { notSent: "closed" };
      const abort = new AbortController();
      lane.abort = abort;
      return await deps.run(argv, timeoutMs, { signal: abort.signal });
    } finally {
      lane.abort = null;
      lane.running = null;
      freed();
      release(key, lane);
    }
  }

  /** The session of that tunnel closed: refuse every waiting call, stop the
   * running one, and resolve once its slot is free. */
  async function end(key: string): Promise<void> {
    const lane = lanes.get(key);
    if (!lane) return;
    for (const waiter of lane.waiting.splice(0)) waiter.refuse("closed");
    lane.abort?.abort();
    await lane.running;
  }

  return { submit, end };
}
