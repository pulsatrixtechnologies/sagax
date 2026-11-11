// How long one process start stops the event loop of a grown server (#3680).
//
// Run it on Linux, in the server's own image (process creation on macOS is a
// different call and costs nothing here):
//
//   docker run --rm -m 6g -v "$PWD:/w:ro" -w /w --entrypoint node <server image> \
//     scripts/bench-spawn-stall.ts [bufferMB=1000] [heapMB=400] [busy=0]
//
// It grows this process like a production server (touched buffers in pieces
// of varying sizes, about 3,000 mappings, a heap of small objects), then
// starts /bin/true through spawnChild (server/process/spawn-helper.ts) as
// spawnCli does: once with the server's own spawn, once through the helper.
// For each it prints the synchronous part of the call and the longest stop of
// a 5 ms beat around it, and it exits 1 when one start through the helper
// stops the loop 50 ms or more.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { setPriority } from "node:os";
import { spawnChild, startSpawnHelper, stopSpawnHelper } from "../server/process/spawn-helper.ts";

const options = Object.fromEntries(process.argv.slice(2).map((pair) => pair.split("=")));
const bufferMB = Number(options.bufferMB ?? 1000);
const heapMB = Number(options.heapMB ?? 400);
const busyCount = Number(options.busy ?? 0);
const runs = Number(options.runs ?? 20);
const LIMIT_MS = 50;

const keep: Array<Buffer | null> = [];
let left = bufferMB * 1048576;
for (let i = 1; left > 0; i++) {
  const size = Math.min(left, (128 + (i % 7) * 96) * 1024);
  keep.push(Buffer.allocUnsafeSlow(size).fill(i & 255));
  left -= size;
  if (i % 5 === 0) keep[keep.length - 3] = null;
}
const heap: object[] = [];
for (let i = 0, n = Math.floor((heapMB * 1048576) / 80); i < n; i++) heap.push({ a: i, b: `x${i % 1000}`, c: [i] });

const busy: ChildProcess[] = [];
for (let i = 0; i < busyCount; i++) {
  const child = spawn("sh", ["-c", "while :; do :; done"], { stdio: "ignore" });
  if (options.busyNice && child.pid) setPriority(child.pid, Number(options.busyNice));
  busy.push(child);
}

let last = performance.now();
let longest = 0;
const beat = setInterval(() => {
  const now = performance.now();
  longest = Math.max(longest, now - last - 5);
  last = now;
}, 5);

async function measure(): Promise<{ syncP50: number; syncMax: number; stopP50: number; stopMax: number }> {
  const sync: number[] = [];
  const stops: number[] = [];
  for (let run = 0; run < runs; run++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    longest = 0;
    last = performance.now();
    const started = process.hrtime.bigint();
    const child = spawnChild("/bin/true", [], { stdio: ["pipe", "pipe", "pipe"], detached: true, env: process.env });
    sync.push(Number(process.hrtime.bigint() - started) / 1e6);
    child.stdout?.resume();
    child.stderr?.resume();
    await new Promise((resolve) => child.once("close", resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    stops.push(longest);
  }
  const at = (values: number[], share: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]! * 10) / 10;
  };
  return { syncP50: at(sync, 0.5), syncMax: at(sync, 1), stopP50: at(stops, 0.5), stopMax: at(stops, 1) };
}

const shape = {
  rssMB: Math.round(process.memoryUsage().rss / 1048576),
  mappings: readFileSync("/proc/self/maps", "utf8").split("\n").length - 1,
  busy: busyCount,
};
const direct = await measure();
startSpawnHelper({ log: (line) => console.log(line) });
const helper = await measure();
stopSpawnHelper();
clearInterval(beat);
for (const child of busy) child.kill("SIGKILL");
console.log(JSON.stringify({ ...shape, direct, helper }));
void keep;
void heap;
process.exit(helper.stopMax >= LIMIT_MS ? 1 : 0);
