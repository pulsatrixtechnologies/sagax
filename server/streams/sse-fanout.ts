// Per-client delivery decision for the SSE broadcast fan-out in index.ts.
// Pulled into its own file — not just its own function — because index.ts
// starts the real HTTP server as an import-time side effect (see the bottom
// of index.ts: `server.listen(...)` runs unconditionally on import), so it
// can never be imported from a plain unit test. This one function has no
// dependency on that module and can be driven directly with a fake response.

/** Shape broadcast() needs from an SSE client: a writable response, and the
 * one flag that survives across frames — whether its socket already told us
 * it can't keep up. */
export interface SseFanoutClient {
  res: {
    write(chunk: string): boolean;
    writableLength: number;
    once(event: "drain", listener: () => void): unknown;
  };
  backpressured: boolean;
  /** The client's one, idempotent way out: it leaves the fan-out and stops
   * the heartbeat before the response ends (openSseHeartbeat). */
  close(): void;
}

/** Past this many buffered bytes, the client isn't draining on any useful
 * timeframe: cut it loose rather than let Node's per-connection write buffer
 * grow without bound. Its own EventSource reconnects and replays via
 * Last-Event-ID (server/index.ts's existing replayBuffer/cursorSeq). */
// ponytail: fixed byte bound, not adaptive. Retune from real writableLength
// telemetry (see the audit's validation step) if it trips too eager or late.
export const SSE_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export type SseFanoutOutcome = "sent" | "dropped" | "disconnected";

/** One SSE data frame. Broadcast builds this once and hands the same string
 * to every client that receives the unfiltered payload. */
export function encodeSseDataFrame(streamId: string, seq: number, payload: unknown): string {
  return `id: ${streamId}:${seq}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** High-frequency kinds that must not re-check email membership on every
 * token or screen capture. Membership still runs on durable frames. */
export function sseKindSkipsMembershipRecheck(kind: string): boolean {
  return kind === "runtime" || kind === "screen";
}

type RuntimeDeltaEvent = {
  type?: unknown;
  threadId?: unknown;
  turnId?: unknown;
  itemId?: unknown;
  streamKind?: unknown;
  delta?: unknown;
  synthetic?: unknown;
  eventId?: unknown;
  provider?: unknown;
  providerInstanceId?: unknown;
};

/** Stable key for one streamed text lane (same identity the bus merges on). */
export function runtimeDeltaStreamKey(event: RuntimeDeltaEvent): string | null {
  if (event.type !== "content.delta" || typeof event.threadId !== "string") return null;
  if (typeof event.delta !== "string") return null;
  return [
    event.threadId,
    String(event.provider ?? ""),
    String(event.providerInstanceId ?? ""),
    String(event.turnId ?? ""),
    String(event.itemId ?? ""),
    String(event.streamKind ?? ""),
    event.synthetic === true ? "1" : "0",
  ].join("\0");
}

/** Merge two runtime content.delta payloads that share a stream. Returns
 * null when they cannot share one frame. Wire shape stays a content.delta
 * with concatenated text; eventId stays the first one's. */
export function mergeRuntimeDeltaEvents(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  if (current.kind !== "runtime" || next.kind !== "runtime") return null;
  const a = current.event as RuntimeDeltaEvent | undefined;
  const b = next.event as RuntimeDeltaEvent | undefined;
  if (!a || !b) return null;
  const keyA = runtimeDeltaStreamKey(a);
  const keyB = runtimeDeltaStreamKey(b);
  if (!keyA || keyA !== keyB) return null;
  return {
    ...current,
    event: { ...a, delta: `${String(a.delta)}${String(b.delta)}` },
  };
}

/** How long a broadcast may hold consecutive content.delta frames for one
 * stream before flushing one shared SSE frame to every client. */
export const SSE_DELTA_COALESCE_MS = 16;

/** Holds consecutive content.delta runtime payloads and flushes one shared
 * serialized frame per stream. Used by broadcast so 20 SSE clients do not
 * each pay a stringify, and so a token burst becomes one write per client. */
export class SseRuntimeDeltaCoalescer {
  private pending = new Map<string, { payload: Record<string, unknown>; timer: ReturnType<typeof setTimeout> }>();
  private readonly flush: (payload: Record<string, unknown>) => void;
  private readonly coalesceMs: number;

  constructor(flush: (payload: Record<string, unknown>) => void, coalesceMs = SSE_DELTA_COALESCE_MS) {
    this.flush = flush;
    this.coalesceMs = coalesceMs;
  }

  /** Queue or merge a runtime frame. Returns true when this call owns it
   * (caller must not fan it out itself). */
  offer(payload: Record<string, unknown>): boolean {
    if (payload.kind !== "runtime" || !payload.event || typeof payload.event !== "object") return false;
    const key = runtimeDeltaStreamKey(payload.event as RuntimeDeltaEvent);
    if (!key) {
      this.flushAll();
      return false;
    }
    const existing = this.pending.get(key);
    if (existing) {
      const merged = mergeRuntimeDeltaEvents(existing.payload, payload);
      if (merged) {
        existing.payload = merged;
        return true;
      }
      this.release(key);
    }
    const timer = setTimeout(() => this.release(key), this.coalesceMs);
    timer.unref?.();
    this.pending.set(key, { payload, timer });
    return true;
  }

  flushAll(): void {
    while (this.pending.size > 0) {
      const key = this.pending.keys().next().value;
      if (key === undefined) break;
      this.release(key);
    }
  }

  private release(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    clearTimeout(entry.timer);
    this.flush(entry.payload);
  }
}

/** One client's fate for one frame.
 *
 * Screen captures are replaceable: once a client is backpressured, skip them
 * until it drains, since the next capture supersedes whatever was dropped.
 * Durable events (messages, bot/group state, config, ...) are never
 * silently dropped here — they're written regardless of the backpressure
 * flag. The only way a durable event goes missing is the bound below, which
 * disconnects the client outright so its next reconnect replays what it
 * missed instead of silently losing it. */
export function deliverSseFrame(client: SseFanoutClient, kind: string, frame: string): SseFanoutOutcome {
  if (client.res.writableLength > SSE_MAX_BUFFERED_BYTES) {
    client.close();
    return "disconnected";
  }
  if (client.backpressured && kind === "screen") return "dropped";
  try {
    if (!client.res.write(frame) && !client.backpressured) {
      // write() returns false as soon as buffered bytes pass the socket's
      // 16 KB highWaterMark, which a single screen frame clears on its own —
      // so this says "hasn't drained yet", not "is a slow client". Without
      // the drain listener the flag latches on for the life of the
      // connection and screen streaming never resumes. One listener per
      // transition into backpressure, never one per frame.
      client.backpressured = true;
      client.res.once("drain", () => {
        client.backpressured = false;
      });
    }
    return "sent";
  } catch {
    return "disconnected";
  }
}

/** What the heartbeat needs from a response (a ServerResponse in practice). */
export interface SseHeartbeatStream {
  write(chunk: string): boolean;
  end(): void;
  writableEnded: boolean;
  destroyed: boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
}

const SSE_HEARTBEAT_FRAME = `: keepalive\n\ndata: ${JSON.stringify({ kind: "ping" })}\n\n`;

/** Heartbeat `res` every `everyMs` while `live()` holds; `onBeat` runs after
 * each frame written. The returned close stops the heartbeat and runs
 * `onClose` once, before the response ends; it also runs by itself when the
 * response ends, errors, or stops being live.
 *
 * Node reports a failed write (one after end(), say) as an asynchronous
 * `error` event on the response. Without a listener that event is an
 * uncaught exception and the whole server exits, so the stream listens for
 * it here, once, and treats it as the end of the stream. */
export function openSseHeartbeat(
  res: SseHeartbeatStream,
  options: { everyMs: number; live: () => boolean; onClose: () => void; onBeat?: () => void },
): () => void {
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    options.onClose();
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.end();
      } catch {
        /* already gone */
      }
    }
  };
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed || !options.live()) return close();
    try {
      res.write(SSE_HEARTBEAT_FRAME);
      options.onBeat?.();
    } catch {
      close();
    }
  }, options.everyMs);
  timer.unref?.();
  res.on("error", close);
  return close;
}
