// OpenTelemetry tracer (#2609): OTLP/HTTP JSON encoding, batching, the
// bounded queue, the local span files, and no export without an endpoint.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTracer, encodeOtlp, localSpanLine, SPAN_BATCH_MAX, SPAN_QUEUE_MAX, spansFileFor, tracesUrl, type SpanRecord, type TelemetryFetch } from "./otel.ts";

const span = (n: number, extra: Partial<SpanRecord> = {}): SpanRecord => ({
  traceId: "a".repeat(32),
  spanId: n.toString(16).padStart(16, "0"),
  name: `execute_tool t${n}`,
  kind: 1,
  startMs: Date.UTC(2026, 10, 7, 12, 0, 0) + n,
  endMs: Date.UTC(2026, 10, 7, 12, 0, 1) + n,
  attributes: { "gen_ai.operation.name": "execute_tool", "gen_ai.usage.input_tokens": 12, "sagax.cost.usd": 0.25, "sagax.subagent": true },
  status: 1,
  ...extra,
});

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("encodeOtlp", () => {
  it("writes OTLP/HTTP JSON: nanosecond strings, typed attribute values, parent and status", () => {
    const body = encodeOtlp([span(1, { parentSpanId: "b".repeat(16), status: 2, statusMessage: "boom" })], { "service.name": "sagax" }) as any;
    const out = body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(body.resourceSpans[0].resource.attributes).toEqual([{ key: "service.name", value: { stringValue: "sagax" } }]);
    expect(out.startTimeUnixNano).toBe(`${Date.UTC(2026, 10, 7, 12) + 1}000000`);
    expect(out.parentSpanId).toBe("b".repeat(16));
    expect(out.status).toEqual({ code: 2, message: "boom" });
    const attrs = Object.fromEntries(out.attributes.map((a: any) => [a.key, a.value]));
    expect(attrs["gen_ai.usage.input_tokens"]).toEqual({ intValue: "12" });
    expect(attrs["sagax.cost.usd"]).toEqual({ doubleValue: 0.25 });
    expect(attrs["sagax.subagent"]).toEqual({ boolValue: true });
  });

  it("appends /v1/traces once", () => {
    expect(tracesUrl("https://otel.example.test:4318/")).toBe("https://otel.example.test:4318/v1/traces");
    expect(tracesUrl("https://otel.example.test/v1/traces")).toBe("https://otel.example.test/v1/traces");
  });
});

describe("createTracer", () => {
  it("queues nothing for OTLP and never calls the network while no endpoint is set", async () => {
    let calls = 0;
    const tracer = createTracer({ dataDir: null, target: () => null, fetch: async () => { calls += 1; return { ok: true, status: 200 }; }, manual: true });
    for (let i = 0; i < 10; i += 1) tracer.emit(span(i));
    await tracer.flush();
    expect(calls).toBe(0);
    expect(tracer.stats()).toEqual({ queued: 0, dropped: 0, exported: 0, failed: 0 });
  });

  it("posts batches of at most 512 with the configured headers and service name", async () => {
    const posts: { url: string; headers: Record<string, string>; body: any }[] = [];
    const fetch: TelemetryFetch = async (url, init) => { posts.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
    const tracer = createTracer({ dataDir: null, target: () => ({ endpoint: "https://otel.example.test", headers: { authorization: "Bearer x" }, serviceName: "acme-sagax" }), fetch, manual: true });
    for (let i = 0; i < SPAN_BATCH_MAX + 3; i += 1) tracer.emit(span(i));
    await tracer.flush();
    expect(posts.map((post) => post.body.resourceSpans[0].scopeSpans[0].spans.length)).toEqual([SPAN_BATCH_MAX, 3]);
    expect(posts[0]!.url).toBe("https://otel.example.test/v1/traces");
    expect(posts[0]!.headers.authorization).toBe("Bearer x");
    expect(posts[0]!.body.resourceSpans[0].resource.attributes[0]).toEqual({ key: "service.name", value: { stringValue: "acme-sagax" } });
    expect(tracer.stats().exported).toBe(SPAN_BATCH_MAX + 3);
  });

  it("drops the oldest span when the queue is full, and a refused batch is dropped, reported once", async () => {
    const errors: unknown[] = [];
    const tracer = createTracer({ dataDir: null, target: () => ({ endpoint: "http://127.0.0.1:1" }), fetch: async () => ({ ok: false, status: 503 }), onError: (error) => errors.push(error), manual: true });
    for (let i = 0; i < SPAN_QUEUE_MAX + 5; i += 1) tracer.emit(span(i));
    expect(tracer.stats().dropped).toBe(5);
    await tracer.flush();
    await tracer.flush();
    expect(tracer.stats().failed).toBe(2 * SPAN_BATCH_MAX);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("503");
  });

  it("emit never awaits: a hung collector does not block", async () => {
    const tracer = createTracer({ dataDir: null, target: () => ({ endpoint: "https://otel.example.test" }), fetch: () => new Promise(() => undefined), manual: true });
    tracer.emit(span(1));
    void tracer.flush();
    tracer.emit(span(2));
    expect(tracer.stats().queued).toBe(1);
  });

  it("writes every span to the local monthly file, mode 0600, with no endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-otel-"));
    dirs.push(dir);
    const tracer = createTracer({ dataDir: dir, target: () => null, manual: true });
    tracer.emit(span(1, { attributes: { "sagax.tool.kind": "mcp" } }));
    tracer.emit(span(2));
    await tracer.flush();
    const file = spansFileFor(dir, new Date(Date.UTC(2026, 10, 7)));
    expect(file.endsWith(join("usage", "spans-2026-11.jsonl"))).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ s: span(1).spanId, n: "execute_tool t1", at: { "sagax.tool.kind": "mcp" } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(localSpanLine(span(3)).endsWith("\n")).toBe(true);
  });
});
