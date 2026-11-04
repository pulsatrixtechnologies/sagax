#!/usr/bin/env -S node --experimental-strip-types
// Synthetic server hot-path bench for one GOX-sized org process.
// Seeds 40 bots / 200 threads / 50k messages, then measures:
//   - SQLite query plans and timings (message-db, memory, approval-card scan)
//   - EventBus + SSE fan-out under 10 concurrent streaming turns and 20 clients
//   - event-loop lag and stringify counts (naive per-client vs coalesce+once)
// No real engine, provider, account, or user data.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay, setImmediate as yieldLoop } from "node:timers/promises";

const directory = mkdtempSync(join(tmpdir(), "sagax-hot-paths-"));
const previousDataDir = process.env.SAGAX_DATA_DIR;
process.env.SAGAX_DATA_DIR = directory;
mkdirSync(join(directory, "events"), { recursive: true });

const BOTS = 40;
const THREADS = 200;
const MESSAGES = 50_000;
const STREAMS = 10;
const SSE_CLIENTS = 20;
const TOKENS_PER_STREAM = 200;

const db = await import("../server/messages/message-db.ts");
const { EventBus } = await import("../server/harness/bus.ts");
const sseFanout = await import("../server/streams/sse-fanout.ts");
const { deliverSseFrame, encodeSseDataFrame, SseRuntimeDeltaCoalescer } = sseFanout;

type FakeClient = {
  res: { write(chunk: string): boolean; writableLength: number; once(event: "drain", listener: () => void): unknown };
  backpressured: boolean;
  close(): void;
  writes: number;
  bytes: number;
};

function fakeClient(): FakeClient {
  const client: FakeClient = {
    backpressured: false,
    writes: 0,
    bytes: 0,
    close: () => undefined,
    res: {
      writableLength: 0,
      write: (chunk: string) => {
        client.writes += 1;
        client.bytes += chunk.length;
        return true;
      },
      once: () => client.res,
    },
  };
  return client;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(3));
}

function planOf(raw: DatabaseSync, sql: string): string {
  return raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
    .map((row) => String((row as { detail: string }).detail))
    .join(" | ");
}

const text = "Synthetic history for GOX-sized server hot-path measurement. ".repeat(8);
const now = Date.now();
const perThread = Math.floor(MESSAGES / THREADS);

console.log(JSON.stringify({
  benchmark: "server-hot-paths",
  node: process.version,
  platform: platform(),
  arch: arch(),
  bots: BOTS,
  threads: THREADS,
  messages: THREADS * perThread,
  streams: STREAMS,
  sseClients: SSE_CLIENTS,
  tokensPerStream: TOKENS_PER_STREAM,
  scope: "Synthetic SQLite + EventBus + SSE fan-out only. Not model throughput.",
}));

const seedStarted = performance.now();
for (let thread = 0; thread < THREADS; thread++) {
  const botId = `bot-${thread % BOTS}`;
  const threadId = `thread-${thread}`;
  const messages = Array.from({ length: perThread }, (_, i) => ({
    id: `m-${thread}-${i}`,
    at: now + thread * perThread + i,
    role: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
    kind: "text" as const,
    text: `${text} ${botId}`,
    ...(i % 2 === 1 ? {} : { sendId: `send-${thread}-${i}` }),
  }));
  db.importThread(threadId, messages, messages.at(-1)!.id);
  if (thread % 40 === 0) await yieldLoop();
}
for (let i = 0; i < 20; i++) {
  db.insertMessage(`thread-${i}`, {
    id: `card-${i}`,
    at: now + MESSAGES + i,
    role: "bot",
    kind: "options",
    text: "",
    card: { title: "t", subtitle: "s", options: ["Allow"], requestType: "permission", requestId: `req-${i}` },
  } as any);
  db.indexMemoryFile(`bot-${i % BOTS}`, `memory/topic-${i}.md`, `# Topic ${i}\n\n${text}`, { mtimeMs: now + i, bytes: text.length + 20 });
}
const seedMs = Number((performance.now() - seedStarted).toFixed(1));

const raw = new DatabaseSync(join(directory, "messages.db"));
const plans: Record<string, string> = {};
const queryMs: Record<string, number> = {};
try {
  const queries: Array<[string, string, () => unknown]> = [
    ["latestAts", "SELECT thread_id, MAX(at) AS at FROM messages WHERE thread_id IN ('thread-0','thread-1') GROUP BY thread_id",
      () => db.latestMessageAts(Array.from({ length: 40 }, (_, i) => `thread-${i}`))],
    ["latestSaid",
      "SELECT thread_id, id, at, head FROM (SELECT m.thread_id, m.id, m.at, substr(m.text, 1, 400) AS head, ROW_NUMBER() OVER (PARTITION BY m.thread_id ORDER BY m.at DESC) AS rn FROM messages m WHERE m.kind = 'text' AND m.role = 'bot' AND m.text IS NOT NULL AND m.at >= 0 AND m.thread_id IN ('thread-0','thread-1') AND (json_extract(m.json, '$.from.botId') IS NULL OR json_extract(m.json, '$.from.botId') = 'bot-0')) WHERE rn = 1 ORDER BY at DESC LIMIT 20",
      () => db.latestSaidByBot(Array.from({ length: 40 }, (_, i) => `thread-${i}`), "bot-0", 0, 20)],
    ["openApprovals",
      "SELECT thread_id, id FROM messages WHERE json_extract(json, '$.card.requestType') = 'permission' AND json_extract(json, '$.card.requestId') IS NOT NULL AND json_extract(json, '$.card.answered') IS NULL AND COALESCE(json_extract(json, '$.card.dismissed'), 0) = 0 AND COALESCE(json_extract(json, '$.card.expired'), 0) = 0",
      () => db.openApprovalCardMessages()],
    ["followupsByThread", "SELECT rowid, id, payload FROM chat_followups WHERE thread_id = 'thread-0'",
      () => raw.prepare("SELECT rowid, id, payload FROM chat_followups WHERE thread_id = 'thread-0'").all()],
    ["memoryByBot", "SELECT path, mtime_ms, bytes FROM memory_files WHERE bot_id = 'bot-0'",
      () => db.indexedMemoryFiles("bot-0")],
    ["messagesByKey", "SELECT DISTINCT thread_id FROM messages WHERE key_id IN ('missing')",
      () => raw.prepare("SELECT DISTINCT thread_id FROM messages WHERE key_id IN ('missing')").all()],
  ];
  for (const [name, sql, run] of queries) {
    plans[name] = planOf(raw, sql);
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      const at = performance.now();
      run();
      samples.push(performance.now() - at);
    }
    queryMs[name] = percentile(samples, 0.95);
  }
} finally {
  raw.close();
}

async function measureFanout(mode: "naive" | "coalesce"): Promise<Record<string, number>> {
  let stringifyCount = 0;
  const originalStringify = JSON.stringify;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    stringifyCount += 1;
    return originalStringify(...args);
  }) as typeof JSON.stringify;

  const clients = Array.from({ length: SSE_CLIENTS }, () => fakeClient());
  const bus = new EventBus(() => undefined);
  let broadcastFrames = 0;
  let fanoutWrites = 0;

  const sendFrame = (payload: Record<string, unknown>) => {
    broadcastFrames += 1;
    const seq = broadcastFrames;
    if (mode === "naive") {
      for (const client of clients) {
        const frame = `id: bench:${seq}\ndata: ${JSON.stringify({ ...payload, seq })}\n\n`;
        deliverSseFrame(client, "runtime", frame);
        fanoutWrites += 1;
      }
      return;
    }
    const frame = encodeSseDataFrame("bench", seq, { ...payload, seq });
    for (const client of clients) {
      deliverSseFrame(client, "runtime", frame);
      fanoutWrites += 1;
    }
  };

  const coalescer = mode === "coalesce"
    ? new SseRuntimeDeltaCoalescer((payload) => sendFrame(payload))
    : null;

  bus.subscribe((event) => {
    const payload = { kind: "runtime", event };
    if (coalescer) {
      if (coalescer.offer(payload)) return;
      coalescer.flushAll();
    }
    sendFrame(payload);
  });

  const lag = monitorEventLoopDelay({ resolution: 2 });
  lag.enable();
  await delay(20);
  stringifyCount = 0;
  fanoutWrites = 0;
  broadcastFrames = 0;
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  for (let token = 0; token < TOKENS_PER_STREAM; token++) {
    for (let stream = 0; stream < STREAMS; stream++) {
      bus.publish({
        eventId: `e-${mode}-${stream}-${token}`,
        provider: "claude",
        providerInstanceId: "fixture",
        threadId: `thread-${stream}`,
        createdAt: new Date(now).toISOString(),
        type: "content.delta",
        streamKind: "assistant_text",
        delta: `w${token} `,
        turnId: `turn-${stream}`,
        itemId: `item-${stream}`,
      } as any);
    }
    if (token % 25 === 0) await yieldLoop();
  }
  for (let stream = 0; stream < STREAMS; stream++) {
    bus.publish({
      eventId: `done-${mode}-${stream}`,
      provider: "claude",
      providerInstanceId: "fixture",
      threadId: `thread-${stream}`,
      createdAt: new Date(now).toISOString(),
      type: "turn.completed",
      ok: true,
      turnId: `turn-${stream}`,
    } as any);
  }
  await bus.flush();
  coalescer?.flushAll();

  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);
  await delay(10);
  lag.disable();
  JSON.stringify = originalStringify;
  const clientWrites = clients.reduce((sum, client) => sum + client.writes, 0);
  await bus.flush();
  return {
    wallMs: Number(wallMs.toFixed(2)),
    cpuUserMs: Number((cpu.user / 1000).toFixed(2)),
    cpuSystemMs: Number((cpu.system / 1000).toFixed(2)),
    eventLoopMaxMs: Number((lag.max / 1e6).toFixed(2)),
    eventLoopP99Ms: Number((lag.percentile(99) / 1e6).toFixed(2)),
    stringifyCount,
    broadcastFrames,
    fanoutWrites,
    clientWrites,
  };
}

const naive = await measureFanout("naive");
const coalesce = await measureFanout("coalesce");

const result = {
  seedMs,
  queryPlans: plans,
  queryP95Ms: queryMs,
  streamNaive: naive,
  streamCoalesce: coalesce,
};

const outPath = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : join(directory, "hot-paths-result.json");
writeFileSync(outPath!, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
console.log(JSON.stringify({ wrote: outPath }));

await db.closeMessageSearch();
db.closeMessageDb();
if (previousDataDir === undefined) delete process.env.SAGAX_DATA_DIR;
else process.env.SAGAX_DATA_DIR = previousDataDir;
if (!process.argv.includes("--keep")) rmSync(directory, { recursive: true, force: true });
