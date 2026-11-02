// Cost of one routine watch check (2026-10-26, server/routines/routine-watch.ts):
// wall time, CPU time, event-loop delay and memory of the scheduler's
// evaluator for realistic sources, on disposable fixtures only.
//
//   pnpm bench:routine-watch            # 20 checks per case
//   pnpm bench:routine-watch -- --runs 50
//
// Cases: a folder of 1 000 files (flat), a tree of 5 000 entries (the
// maxFiles bound, recursive), one file, a command (`ls -la` on 1 000 files),
// a command with 256 KB of output (the output bound), and a mocked MCP read
// tool returning 500 JSON items compared with `track`. Every case runs the
// full check: read, fingerprint, compare with the kept state, write it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const directory = mkdtempSync(join(tmpdir(), "routine-watch-bench-"));
process.env.SAGAX_DATA_DIR = join(directory, "data");
const { createRoutineWatchEvaluator, RoutineWatchStates } = await import("../server/routines/routine-watch.ts");
type Watch = import("../shared/routine-watch.ts").RoutineWatchPrecheck;

const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Math.max(1, Number(process.argv[runsArg + 1]) || 20) : 20;

const root = join(directory, "bot");
mkdirSync(join(root, "flat"), { recursive: true });
for (let i = 0; i < 1_000; i += 1) writeFileSync(join(root, "flat", `report-${String(i).padStart(4, "0")}.csv`), "a,b,c\n".repeat(20));
for (let d = 0; d < 50; d += 1) {
  const dir = join(root, "tree", `dir-${d}`, "sub");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 100; i += 1) writeFileSync(join(dir, `f-${i}.txt`), "x");
}
writeFileSync(join(root, "status.json"), JSON.stringify({ ok: true }));

const items = Array.from({ length: 500 }, (_, i) => ({ id: `item-${i}`, status: i % 7 === 0 ? "open" : "closed", priority: i % 3, title: `Item ${i} ${"t".repeat(80)}`, updated: 1_700_000_000 + i }));
let clock = 1_000_000_000;
const states = new RoutineWatchStates(join(directory, "states"));
const evaluate = createRoutineWatchEvaluator({
  place: () => ({ kind: "host", cwd: root }),
  callTool: async () => ({ isError: false, value: { items } }),
  states,
  now: () => clock,
});

const cases: Array<[string, Watch]> = [
  ["files: folder of 1000 files", { kind: "watch", source: { type: "files", path: "flat" } }],
  ["files: tree, 5000 entries (bound), recursive", { kind: "watch", source: { type: "files", path: "tree", recursive: true } }],
  ["files: one file", { kind: "watch", source: { type: "files", path: "status.json" } }],
  ["command: ls -la on 1000 files", { kind: "watch", source: { type: "command", command: "ls -la flat" } }],
  ["command: 256 KB of output (bound)", { kind: "watch", source: { type: "command", command: "yes 0123456789abcdef | head -c 400000" } }],
  ["tool (mocked MCP): 500 items, track 2 fields", { kind: "watch", source: { type: "tool", tool: "tracker__search_items" }, track: { items: "items", key: "id", fields: ["status", "priority"] } }],
];

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, runs: RUNS,
  scope: "One watch check per sample, the scheduler's own evaluator, synthetic fixtures on the local disk." }));
const rows: string[] = ["| Case | Wall p50 (ms) | Wall p95 (ms) | CPU p50 (ms) | Loop max (ms) | Heap kept (KB) | Verdict |", "|---|---:|---:|---:|---:|---:|---|"];
try {
  for (const [index, [name, watch]] of cases.entries()) {
    const routine = { id: `bench-${index}`, botId: "bench-bot" };
    // The first check sets the baseline; every sample then compares.
    clock += 10 * 60_000;
    await evaluate(routine, watch);
    const walls: number[] = [];
    const cpus: number[] = [];
    let verdict = "";
    const lag = monitorEventLoopDelay({ resolution: 1 });
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    lag.enable();
    for (let run = 0; run < RUNS; run += 1) {
      clock += 10 * 60_000;
      const cpu = process.cpuUsage();
      const start = performance.now();
      const answer = await evaluate(routine, watch);
      walls.push(performance.now() - start);
      const used = process.cpuUsage(cpu);
      cpus.push((used.user + used.system) / 1000);
      verdict = answer.wake ? "wake" : answer.reason;
    }
    lag.disable();
    // Retained after the checks (garbage collected), not allocated.
    globalThis.gc?.();
    const heapDelta = (process.memoryUsage().heapUsed - heapBefore) / 1024;
    const row = { name, wallP50: +percentile(walls, 50).toFixed(2), wallP95: +percentile(walls, 95).toFixed(2), cpuP50: +percentile(cpus, 50).toFixed(2), loopMaxMs: +(lag.max / 1e6).toFixed(2), heapDeltaKb: Math.round(heapDelta), verdict };
    console.log(JSON.stringify(row));
    rows.push(`| ${name} | ${row.wallP50} | ${row.wallP95} | ${row.cpuP50} | ${row.loopMaxMs} | ${row.heapDeltaKb} | ${verdict} |`);
  }
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`\n${rows.join("\n")}\n\nProcess RSS after all cases: ${rss} MB`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
