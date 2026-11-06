// Events to Perspicax in batches (at most 256 events and 1 MiB each), masked
// on the way in. A failed POST keeps the queue and retries with a backoff; a
// 401 stops the relay for good (the token is dead) and is reported to the
// runner through `onUnauthorized`.
import { Masker } from "./mask.ts";
import {
  MAX_BATCH_BYTES,
  RunnerHttpError,
  MAX_EVENTS_PER_BATCH,
  MAX_TERMINAL_BYTES,
  RunnerUnauthorized,
  type ControlClient,
  type RunnerEvent,
} from "./protocol.ts";

/** Above this many queued events the oldest terminal output is dropped
 * first, so a long silence from Perspicax cannot exhaust the Pod's memory. */
const MAX_QUEUED_EVENTS = 20_000;
const KEEP = new Set<RunnerEvent["kind"]>(["state", "approval", "diff", "verify", "stats", "commits", "session"]);

export function truncateUtf8(text: string, maxBytes: number, marker = "\n[... tronqué]"): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let cut = Buffer.from(text).subarray(0, budget).toString("utf8");
  // A cut inside a multi-byte character leaves a replacement char.
  cut = cut.replace(/�$/, "");
  return cut + marker;
}

/** Terminal text split in events of at most 16 KiB each. */
export function terminalEvents(text: string): RunnerEvent[] {
  const out: RunnerEvent[] = [];
  let rest = text;
  while (rest.length) {
    let piece = rest;
    if (Buffer.byteLength(piece) > MAX_TERMINAL_BYTES) {
      piece = Buffer.from(rest).subarray(0, MAX_TERMINAL_BYTES).toString("utf8").replace(/�$/, "");
      if (!piece) piece = rest.slice(0, 1);
    }
    out.push({ kind: "terminal", data: { text: piece } });
    rest = rest.slice(piece.length);
  }
  return out;
}

export interface RelayOptions {
  client: ControlClient;
  masker: Masker;
  /** Delay before a non-urgent batch leaves. */
  flushDelayMs?: number;
  onUnauthorized?: () => void;
  onError?: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class EventRelay {
  private queue: Array<{ event: RunnerEvent; bytes: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private dead = false;
  private readonly flushDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  dropped = 0;

  private readonly options: RelayOptions;

  constructor(options: RelayOptions) {
    this.options = options;
    this.flushDelayMs = options.flushDelayMs ?? 250;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get stopped(): boolean {
    return this.dead;
  }

  /** Queue an event (masked now). `urgent` flushes without the delay. */
  emit(event: RunnerEvent, urgent = false): void {
    if (this.dead) return;
    const masked = this.options.masker.maskDeep(event);
    // The mask can be longer than the value: cut terminal text again after.
    if (masked.kind === "terminal" && Buffer.byteLength(masked.data.text) > MAX_TERMINAL_BYTES) {
      for (const piece of terminalEvents(masked.data.text)) this.emit(piece, urgent);
      return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(masked));
    if (bytes > MAX_BATCH_BYTES - 64) {
      this.queue.push({ event: { kind: "warning", data: { text: `Un événement ${event.kind} trop volumineux (${bytes} octets) a été omis.` } }, bytes: 200 });
    } else {
      this.queue.push({ event: masked, bytes });
    }
    this.trim();
    if (urgent) void this.flush().catch(() => {});
    else this.schedule();
  }

  private trim(): void {
    while (this.queue.length > MAX_QUEUED_EVENTS) {
      // Terminal output first, then other chatter; never a state, an
      // approval, a diff or a verify result.
      let index = this.queue.findIndex((item) => item.event.kind === "terminal");
      if (index < 0) index = this.queue.findIndex((item) => !KEEP.has(item.event.kind));
      if (index < 0) break;
      this.queue.splice(index, 1);
      this.dropped++;
    }
  }

  private schedule(): void {
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => {});
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  /** Send everything queued; resolves once the queue is empty (or the relay
   * is dead). Concurrent calls share one loop. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.flushing) return this.flushing.then(() => (this.queue.length && !this.dead ? this.flush() : undefined));
    this.flushing = this.drain().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private nextBatch(): RunnerEvent[] {
    const batch: RunnerEvent[] = [];
    let bytes = 16; // {"events":[]}
    for (const item of this.queue) {
      if (batch.length >= MAX_EVENTS_PER_BATCH || bytes + item.bytes + 1 > MAX_BATCH_BYTES) break;
      batch.push(item.event);
      bytes += item.bytes + 1;
    }
    return batch;
  }

  private async drain(): Promise<void> {
    let failures = 0;
    while (this.queue.length && !this.dead) {
      const batch = this.nextBatch();
      try {
        await this.options.client.postEvents(batch);
        this.queue.splice(0, batch.length);
        failures = 0;
      } catch (error) {
        if (error instanceof RunnerUnauthorized) {
          this.dead = true;
          this.queue = [];
          this.options.onUnauthorized?.();
          return;
        }
        this.options.onError?.(error);
        // Perspicax refused this batch for what it holds (4xx): retrying it
        // would block every later event. Drop it and go on.
        if (error instanceof RunnerHttpError && error.status >= 400 && error.status < 500) {
          this.queue.splice(0, batch.length);
          this.dropped += batch.length;
          continue;
        }
        failures++;
        await this.sleep(Math.min(30_000, 500 * 2 ** Math.min(failures, 6)));
      }
    }
  }

  /** Stop for good without sending (401, or the end). */
  kill(): void {
    this.dead = true;
    this.queue = [];
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
