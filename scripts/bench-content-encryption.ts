// Content encryption at rest: before/after micro-benchmark (docs/content-encryption.md).
//
//   node --experimental-strip-types scripts/bench-content-encryption.ts
//
// Runs the same synthetic workload twice, each in a child process with its
// own temporary data directory (removed after): encryption off (today's
// plain rows) and on (sealed rows, blind index). Synthetic text only, no
// real data, no network. Reports medians; run on an idle machine.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7) as "on" | "off" | undefined;

if (!mode) {
  const self = fileURLToPath(import.meta.url);
  const run = (which: "on" | "off" | "migrate") => JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", self, `--mode=${which}`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop()!) as Record<string, number>;
  const off = run("off");
  const on = run("on");
  const migrate = run("migrate" as "on");
  const rows = Object.keys(off).map((key) => ({ measure: key, off: off[key], on: on[key], delta: `${(((on[key]! - off[key]!) / off[key]!) * 100).toFixed(0)}%` }));
  console.table(rows);
  console.log("migration", migrate);
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, off, on, migrate }));
  process.exit(0);
}

const directory = mkdtempSync(join(tmpdir(), "sagax-content-bench-"));
process.env.SAGAX_DATA_DIR = directory;
process.env.SAGAX_MCP_OAUTH_KEY = "ab".repeat(32); // synthetic vault key, this process only
const db = await import("../server/messages/message-db.ts");
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]!;

// pseudo-random prose: realistic word and trigram variety, reproducible
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const vocabulary = Array.from({ length: 4000 }, (_, i) => {
  let word = "";
  const length = 3 + Math.floor(rand() * 8);
  for (let c = 0; c < length; c++) word += String.fromCharCode(97 + Math.floor(rand() * 26));
  return i % 50 === 0 ? `${word}é` : word;
});
const prose = (words: number) => Array.from({ length: words }, () => vocabulary[Math.floor(rand() * vocabulary.length)]).join(" ");

try {
  const migrateOnly = mode === ("migrate" as string);
  db.configureContentEncryption({ mode: migrateOnly ? "off" : mode, autoMigrate: false, resolveOwner: (threadId) => ({ owner: threadId.startsWith("p") ? `person-${threadId.slice(1, 3)}` : "@workspace", confidential: false }) });
  // seed: 10 threads x 1,000 messages (about 1 KB each) + the 5,000-message thread
  const seedStart = performance.now();
  for (let thread = 0; thread < 10; thread++) {
    db.importThread(`p${String(thread).padStart(2, "0")}`, Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, at: thread * 10_000 + i, role: i % 2 ? "bot" as const : "user" as const, kind: "text" as const, text: prose(150) })), "s999");
  }
  db.importThread("long", Array.from({ length: 5000 }, (_, i) => ({ id: `l${i}`, at: 200_000 + i, role: "bot" as const, kind: "text" as const, text: prose(150) })), "l4999");
  db.flushContentIndex();
  const seedMs = performance.now() - seedStart;

  if (migrateOnly) {
    db.closeMessageDb();
    db.configureContentEncryption({ mode: "on", autoMigrate: false, resolveOwner: () => ({ owner: "@workspace", confidential: false }) });
    const steps: number[] = [];
    const start = performance.now();
    for (;;) {
      const at = performance.now();
      const { done } = db.runContentMigration(4); // the server's slice (MIGRATION_SLICE_MS)
      steps.push(performance.now() - at);
      if (done) break;
    }
    const total = performance.now() - start;
    const status = db.contentEncryptionStatus();
    // what the next start does once, before it serves: plain index rebuilt, VACUUM
    const startupVacuumMs = db.vacuumAfterSealing() ?? 0;
    // and back to plain
    db.configureContentEncryption({ mode: "off", autoMigrate: false });
    const backSteps: number[] = [];
    const backStart = performance.now();
    for (;;) {
      const at = performance.now();
      const { done } = db.runContentMigration(4); // the server's slice (MIGRATION_SLICE_MS)
      backSteps.push(performance.now() - at);
      if (done) break;
    }
    console.log(JSON.stringify({
      rows: status.sealedRows, sealAllMs: Math.round(total), startupVacuumMs: Math.round(startupVacuumMs), steps: steps.length, stepP50Ms: +median(steps).toFixed(2), stepP95Ms: +p95(steps).toFixed(2),
      maxStepMs: +Math.max(...steps).toFixed(1), openAllMs: Math.round(performance.now() - backStart), backStepP95Ms: +p95(backSteps).toFixed(2), backMaxStepMs: +Math.max(...backSteps).toFixed(1),
    }));
  } else {
    const text = prose(150);
    // append 10,000 messages (appendMessage: row + branch head, one transaction)
    const appends: number[] = [];
    const appendStart = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const at = performance.now();
      db.appendMessage(`p0${i % 10}`, { id: `a${i}`, at: 500_000 + i, role: "bot", kind: "text", text });
      appends.push(performance.now() - at);
    }
    const appendTotal = performance.now() - appendStart;
    const flushAt = performance.now();
    db.flushContentIndex();
    const flushMs = performance.now() - flushAt;
    // streamed patches: 200 updates of one growing message
    const patches: number[] = [];
    let growing = "";
    for (let i = 0; i < 200; i++) {
      growing += `${prose(10)} `;
      const at = performance.now();
      db.updateMessage("p00", { id: "a0", at: 500_000, role: "bot", kind: "text", text: growing });
      patches.push(performance.now() - at);
    }
    db.flushContentIndex();
    // read a 5,000-message thread from disk (cold handle each time)
    const reads: number[] = [];
    const tails: number[] = [];
    for (let i = 0; i < 7; i++) {
      db.closeMessageDb();
      let at = performance.now();
      const thread = db.readThread("long", join(directory, "none.json"));
      reads.push(performance.now() - at);
      if (thread.messages.length !== 5000) throw new Error(`read ${thread.messages.length}`);
      at = performance.now();
      db.readThreadTail("long", join(directory, "none.json"), 100);
      tails.push(performance.now() - at);
    }
    // search over 25,000 rows: a word present, an absent one, a 2-character needle
    const present = vocabulary[17]!;
    const search = (query: string) => {
      const runs: number[] = [];
      for (let i = 0; i < 7; i++) {
        const at = performance.now();
        db.searchMessages(query, 40);
        runs.push(performance.now() - at);
      }
      return median(runs);
    };
    const workerRuns: number[] = [];
    await db.searchMessagesAsync("warm worker");
    for (let i = 0; i < 7; i++) {
      const at = performance.now();
      await db.searchMessagesAsync(`${present} ${vocabulary[18]}`, 40);
      workerRuns.push(performance.now() - at);
    }
    const recalls: number[] = [];
    const threads = Array.from({ length: 10 }, (_, i) => `p0${i}`);
    for (let i = 0; i < 7; i++) {
      const at = performance.now();
      db.recallMessages(`${vocabulary[40]} ${vocabulary[41]}`, threads, 12, undefined, "any");
      recalls.push(performance.now() - at);
    }
    await db.closeMessageSearch();
    console.log(JSON.stringify({
      seed15kMs: Math.round(seedMs),
      append10kTotalMs: Math.round(appendTotal),
      appendP50Ms: +median(appends).toFixed(3),
      appendP95Ms: +p95(appends).toFixed(3),
      indexFlush10kMs: Math.round(flushMs),
      patchP50Ms: +median(patches).toFixed(3),
      read5kThreadMs: +median(reads).toFixed(1),
      readTail100Ms: +median(tails).toFixed(2),
      searchPresentMs: +search(present).toFixed(1),
      searchAbsentMs: +search("zzqqxv").toFixed(1),
      searchTwoCharsMs: +search("qz").toFixed(1),
      searchWorkerMs: +median(workerRuns).toFixed(1),
      recallAnyMs: +median(recalls).toFixed(2),
    }));
  }
} finally {
  db.closeMessageDb();
  rmSync(directory, { recursive: true, force: true });
}
