#!/usr/bin/env -S node --experimental-strip-types
// #5343: main-thread stall times for messages.db boot/tick scans, before
// (sync on the server's thread) and after (page-cache warm + search worker).
// Synthetic GOX-sized corpus. No engine, no personal data.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay, setImmediate as yieldLoop } from "node:timers/promises";

const THREADS = Number(process.env.BENCH_THREADS ?? 200);
const PER_THREAD = Number(process.env.BENCH_PER_THREAD ?? 250);
const TEXT = "Synthetic stall corpus for messages.db main-thread measurement. ".repeat(12);

const directory = mkdtempSync(join(tmpdir(), "sagax-server-stalls-"));
process.env.SAGAX_DATA_DIR = directory;
mkdirSync(directory, { recursive: true });

const db = await import("../server/messages/message-db.ts");

/** Longest gap between two 20 ms heartbeats while `work` runs. Matches how
 * server/process/event-loop-lag.ts names a main-thread stall. */
async function maxLoopDelayMs(work: () => Promise<void> | void): Promise<{ wallMs: number; maxDelayMs: number }> {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  histogram.reset();
  let last = performance.now();
  let maxGap = 0;
  const beat = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last - 20);
    last = now;
  }, 20);
  const started = performance.now();
  await work();
  await delay(50);
  const wallMs = performance.now() - started;
  clearInterval(beat);
  const histMax = histogram.max / 1e6;
  histogram.disable();
  return {
    wallMs: Number(wallMs.toFixed(1)),
    maxDelayMs: Number(Math.max(maxGap, histMax).toFixed(1)),
  };
}

const now = Date.now();
console.error(`seeding ${THREADS} threads × ${PER_THREAD} messages…`);
for (let thread = 0; thread < THREADS; thread++) {
  const threadId = `thread-${thread}`;
  const messages = Array.from({ length: PER_THREAD }, (_, i) => ({
    id: `m-${thread}-${i}`,
    at: now + thread * PER_THREAD + i,
    role: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
    kind: "text" as const,
    text: `${TEXT} ${threadId}`,
    ...(i % 2 === 0 ? { sendId: `send-${thread}-${i}` } : {}),
  }));
  db.importThread(threadId, messages, messages.at(-1)!.id);
  if (thread % 20 === 0) await yieldLoop();
}
await db.closeMessageSearch();

const dbPath = join(directory, "messages.db");
const sizeMb = Number((statSync(dbPath).size / (1024 * 1024)).toFixed(1));
const threadIds = Array.from({ length: THREADS }, (_, i) => `thread-${i}`);

// BEFORE: sync scans on the main thread (the pre-fix path).
const beforeLatest = await maxLoopDelayMs(() => { db.latestMessageAts(threadIds); });
const beforePerson = await maxLoopDelayMs(() => { db.latestPersonLineAts(threadIds); });
const beforeThreadIds = await maxLoopDelayMs(() => { db.messageThreadIds(); });
const beforeRefs = await maxLoopDelayMs(() => { db.threadsReferencing("Synthetic stall"); });

// AFTER: warm page cache off-thread, then the same work via the worker.
const afterWarm = await maxLoopDelayMs(() => db.warmMessagesDbPageCache());
const afterLatest = await maxLoopDelayMs(() => db.latestMessageAtsAsync(threadIds));
const afterPerson = await maxLoopDelayMs(() => db.latestPersonLineAtsAsync(threadIds));
const afterThreadIds = await maxLoopDelayMs(() => db.messageThreadIdsAsync());
const afterRefs = await maxLoopDelayMs(() => db.threadsReferencingAsync(["Synthetic stall"]));

const report = {
  benchmark: "server-stalls",
  issue: 5343,
  node: process.version,
  platform: platform(),
  arch: arch(),
  threads: THREADS,
  messages: THREADS * PER_THREAD,
  messagesDbMb: sizeMb,
  note: "maxDelayMs is the longest event-loop delay while the call ran (main-thread stall). wallMs is end-to-end time.",
  before: {
    latestMessageAts: beforeLatest,
    latestPersonLineAts: beforePerson,
    messageThreadIds: beforeThreadIds,
    threadsReferencing: beforeRefs,
  },
  after: {
    warmMessagesDbPageCache: afterWarm,
    latestMessageAtsAsync: afterLatest,
    latestPersonLineAtsAsync: afterPerson,
    messageThreadIdsAsync: afterThreadIds,
    threadsReferencingAsync: afterRefs,
  },
};

const out = process.env.BENCH_OUT ?? join(directory, "report.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await db.closeMessageSearch();
db.closeMessageDb();
rmSync(directory, { recursive: true, force: true });
