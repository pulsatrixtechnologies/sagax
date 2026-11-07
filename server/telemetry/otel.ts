// OpenTelemetry traces (#2609): a dependency-free tracer for the server's own
// spans (bot turns, model calls, tool and MCP calls, sub-agents, routines).
//
// Two exporters, both off the hot path:
//  - OTLP/HTTP JSON (POST `<endpoint>/v1/traces`), only while an endpoint is
//    configured in Settings (server/telemetry/settings-store.ts). Batches of
//    at most 512 spans, every 5 s, timer unref'd, a short timeout; a failed
//    export is dropped and reported once per minute, never retried in a loop.
//  - Local JSONL, always on: `<data>/usage/spans-YYYY-MM.jsonl` (mode 0600),
//    beside the usage ledger, so the usage statistics (server/telemetry/
//    usage-stats.ts) count tool, MCP and sub-agent calls without a collector.
//
// emit() only pushes onto a bounded in-memory queue: a full queue drops the
// oldest span, so a dead collector can never grow memory or block a turn.
import { randomBytes } from "node:crypto";
import { appendFile, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;

/** OTLP SpanKind: 1 internal, 2 server, 3 client. */
export type SpanKind = 1 | 2 | 3;
/** OTLP StatusCode: 0 unset, 1 ok, 2 error. */
export type SpanStatusCode = 0 | 1 | 2;

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  /** Epoch milliseconds. */
  startMs: number;
  endMs: number;
  attributes: SpanAttributes;
  status: SpanStatusCode;
  statusMessage?: string;
}

export interface OtlpTarget {
  /** Collector base URL; `/v1/traces` is appended unless already there. */
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
}

export const SPAN_QUEUE_MAX = 2048;
export const SPAN_BATCH_MAX = 512;
export const SPAN_FLUSH_MS = 5_000;
export const OTLP_TIMEOUT_MS = 5_000;
export const DEFAULT_SERVICE_NAME = "sagax";

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** `<endpoint>/v1/traces`, the OTLP/HTTP traces path. */
export function tracesUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
}

function nanos(ms: number): string {
  // Integer milliseconds as a nanosecond string: exact, no float rounding.
  return `${Math.max(0, Math.trunc(ms))}000000`;
}

function anyValue(value: SpanAttributeValue): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

/** The OTLP/HTTP JSON body for one batch (ExportTraceServiceRequest). */
export function encodeOtlp(spans: readonly SpanRecord[], resource: SpanAttributes): Record<string, unknown> {
  return {
    resourceSpans: [{
      resource: { attributes: Object.entries(resource).map(([key, value]) => ({ key, value: anyValue(value) })) },
      scopeSpans: [{
        scope: { name: "sagax", version: "1" },
        spans: spans.map((span) => ({
          traceId: span.traceId,
          spanId: span.spanId,
          ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
          name: span.name,
          kind: span.kind,
          startTimeUnixNano: nanos(span.startMs),
          endTimeUnixNano: nanos(Math.max(span.endMs, span.startMs)),
          attributes: Object.entries(span.attributes).map(([key, value]) => ({ key, value: anyValue(value) })),
          status: { code: span.status, ...(span.statusMessage ? { message: span.statusMessage } : {}) },
        })),
      }],
    }],
  };
}

/** One compact JSONL line of the local exporter. */
export function localSpanLine(span: SpanRecord): string {
  return `${JSON.stringify({
    t: span.traceId,
    s: span.spanId,
    ...(span.parentSpanId ? { p: span.parentSpanId } : {}),
    n: span.name,
    k: span.kind,
    a: span.startMs,
    b: span.endMs,
    st: span.status,
    at: span.attributes,
  })}\n`;
}

export function spansFileFor(dataDir: string, at: Date): string {
  return join(dataDir, "usage", `spans-${at.toISOString().slice(0, 7)}.jsonl`);
}

export type TelemetryFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface TracerOptions {
  /** Where the local exporter writes; null turns it off (tests). */
  dataDir: string | null;
  /** The OTLP target, read at each flush so a saved setting applies at once. */
  target(): OtlpTarget | null;
  fetch?: TelemetryFetch;
  onError?(error: unknown): void;
  /** Extra resource attributes (service.version...). */
  resource?: SpanAttributes;
  flushMs?: number;
  /** Tests: no timer, flush() by hand. */
  manual?: boolean;
}

export interface Tracer {
  emit(span: SpanRecord): void;
  /** Send what is queued now (both exporters). */
  flush(): Promise<void>;
  /** One test span to the configured or given target; throws on failure. */
  test(target: OtlpTarget): Promise<void>;
  stats(): { queued: number; dropped: number; exported: number; failed: number };
  stop(): void;
}

export function createTracer(options: TracerOptions): Tracer {
  const otlpQueue: SpanRecord[] = [];
  const localQueue: SpanRecord[] = [];
  let dropped = 0;
  let exported = 0;
  let failed = 0;
  let lastErrorAt = 0;
  let localChain: Promise<void> = Promise.resolve();
  let sending = false;
  const doFetch: TelemetryFetch = options.fetch ?? ((url, init) => fetch(url, init));

  const report = (error: unknown) => {
    const now = Date.now();
    if (now - lastErrorAt < 60_000) return;
    lastErrorAt = now;
    options.onError?.(error);
  };

  const push = (queue: SpanRecord[], span: SpanRecord) => {
    if (queue.length >= SPAN_QUEUE_MAX) {
      queue.shift();
      dropped += 1;
    }
    queue.push(span);
  };

  const resourceFor = (target: OtlpTarget): SpanAttributes => ({
    "service.name": target.serviceName?.trim() || DEFAULT_SERVICE_NAME,
    "telemetry.sdk.name": "sagax",
    "telemetry.sdk.language": "nodejs",
    ...options.resource,
  });

  const post = async (target: OtlpTarget, batch: readonly SpanRecord[]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OTLP_TIMEOUT_MS);
    timer.unref?.();
    try {
      const res = await doFetch(tracesUrl(target.endpoint), {
        method: "POST",
        headers: { "content-type": "application/json", ...target.headers },
        body: JSON.stringify(encodeOtlp(batch, resourceFor(target))),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OTLP collector answered HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  };

  const flushOtlp = async () => {
    if (sending || !otlpQueue.length) return;
    const target = options.target();
    if (!target) {
      otlpQueue.length = 0;
      return;
    }
    sending = true;
    try {
      while (otlpQueue.length) {
        const batch = otlpQueue.splice(0, SPAN_BATCH_MAX);
        try {
          await post(target, batch);
          exported += batch.length;
        } catch (error) {
          failed += batch.length;
          report(error);
          break;
        }
      }
    } finally {
      sending = false;
    }
  };

  const flushLocal = () => {
    if (!options.dataDir || !localQueue.length) return localChain;
    const dataDir = options.dataDir;
    const batch = localQueue.splice(0, localQueue.length);
    localChain = localChain.then(async () => {
      // Group by month: a batch that straddles midnight on the 1st splits.
      const byFile = new Map<string, string>();
      for (const span of batch) {
        const file = spansFileFor(dataDir, new Date(span.startMs));
        byFile.set(file, (byFile.get(file) ?? "") + localSpanLine(span));
      }
      await mkdir(join(dataDir, "usage"), { recursive: true, mode: 0o700 });
      for (const [file, text] of byFile) {
        await appendFile(file, text, { mode: 0o600 });
        await chmod(file, 0o600).catch(() => undefined);
      }
    }).catch(report);
    return localChain;
  };

  const flush = async () => {
    await Promise.all([flushOtlp(), flushLocal()]);
  };

  const timer = options.manual ? null : setInterval(() => { void flush(); }, options.flushMs ?? SPAN_FLUSH_MS);
  timer?.unref?.();

  return {
    emit(span) {
      if (options.dataDir) push(localQueue, span);
      // Only queue for OTLP while an endpoint is set: nothing piles up otherwise.
      if (options.target()) push(otlpQueue, span);
    },
    flush,
    async test(target) {
      const now = Date.now();
      await post(target, [{
        traceId: newTraceId(),
        spanId: newSpanId(),
        name: "sagax.telemetry.test",
        kind: 1,
        startMs: now,
        endMs: now,
        attributes: { "sagax.test": true },
        status: 1,
      }]);
    },
    stats: () => ({ queued: otlpQueue.length + localQueue.length, dropped, exported, failed }),
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
