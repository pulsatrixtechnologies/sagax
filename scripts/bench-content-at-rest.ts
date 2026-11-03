// Content encryption at rest for files and logs: before/after benchmark
// (docs/content-encryption.md, "Files and logs").
//
//   node --experimental-strip-types scripts/bench-content-at-rest.ts [--before <checkout>]
//
// Runs one synthetic workload in child processes, each with its own
// temporary data folder (removed after): bot memory (write, read, prompt
// load, search, opening for a turn), attachments of 100 KB to 20 MB (upload,
// download, a byte range, opening for a turn), event logs (append, the
// inspector's tail read) and the migration (throughput and the longest
// event-loop stall while it runs). `--before` names a checkout without this
// change (a worktree of main with its node_modules): its column is "before".
// Synthetic text only, no real data, no network. Medians; run on an idle host.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const self = fileURLToPath(import.meta.url);
const here = resolve(dirname(self), "..");
const child = arg("--child") as "off" | "on" | "migrate" | undefined;

if (!child) {
  const before = arg("--before");
  const run = (which: "off" | "on" | "migrate", repo = here) => JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", self, "--child", which, "--repo", repo], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").pop()!) as Record<string, number | null>;
  const columns: Record<string, Record<string, number | null>> = {};
  if (before) columns.before = run("off", resolve(before));
  columns.off = run("off");
  columns.on = run("on");
  const keys = Object.keys(columns.on!);
  console.table(keys.map((key) => Object.fromEntries([["measure", key], ...Object.entries(columns).map(([name, values]) => [name, values[key] ?? "n/a"])])));
  const migration = run("migrate");
  console.log("migration", migration);
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, ...columns, migration }));
  process.exit(0);
}

const repo = resolve(arg("--repo") ?? here);
const directory = mkdtempSync(join(tmpdir(), "sagax-at-rest-bench-"));
process.env.SAGAX_DATA_DIR = directory;
process.env.SAGAX_MCP_OAUTH_KEY = "ab".repeat(32); // synthetic vault key, this process only
const load = <T>(path: string) => import(pathToFileURL(join(repo, path)).href) as Promise<T>;
type Any = Record<string, (...args: never[]) => unknown> & Record<string, unknown>;
const db = await load<Any>("server/message-db.ts");
const workspace = await load<Any>("server/workspace.ts");
const attachments = await load<Any>("server/attachments.ts");
const messageFile = await load<Any>("server/message-file.ts");
const native = await load<Any>("server/drivers/native.ts");
const threadEvents = await load<Any>("server/threads/thread-events.ts");
const config = await load<Any>("server/config.ts");
let atRest: Any | null = null;
try { atRest = await load<Any>("server/content-at-rest.ts"); } catch { atRest = null; }

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (value: number, digits = 2) => +value.toFixed(digits);
const time = async (runs: number, work: (i: number) => unknown) => {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const at = performance.now();
    await work(i);
    out.push(performance.now() - at);
  }
  return median(out);
};
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const vocabulary = Array.from({ length: 3000 }, () => Array.from({ length: 3 + Math.floor(rand() * 8) }, () => String.fromCharCode(97 + Math.floor(rand() * 26))).join(""));
const prose = (bytes: number) => {
  let out = "";
  while (out.length < bytes) out += `${vocabulary[Math.floor(rand() * vocabulary.length)]} `;
  return out.slice(0, bytes);
};
async function* chunksOf(buffer: Buffer, size = 64 * 1024) {
  for (let offset = 0; offset < buffer.length; offset += size) yield buffer.subarray(offset, offset + size);
}
const call = <T>(module: Any, name: string, ...args: unknown[]) => (module[name] as (...a: unknown[]) => T)(...args);

const mode = child === "migrate" ? "off" : child;
call(db, "configureContentEncryption", { mode, autoMigrate: false, resolveOwner: () => ({ owner: "@workspace", confidential: false }) });
if (atRest) call(atRest, "setAtRestGrace", 0);
/** What the server's background migration does between the writes and the reads. */
const settle = async () => {
  if (!atRest || mode !== "on") return;
  for (let i = 0; i < 10; i++) {
    const pass = await call<Promise<Record<string, number>>>(atRest, "runAtRestMigration", { sliceMs: Infinity });
    for (let j = 0; j < 100 && !call<{ done: boolean }>(db, "runContentMigration", Infinity).done; j++);
    if (!pass.sealed && !pass.resealed && !pass.logs) break;
  }
};

const SIZES = [100 * 1024, 1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024];
const label = (bytes: number) => (bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024}MB` : `${bytes / 1024}KB`);

try {
  if (child === "migrate") {
    if (!atRest) { console.log(JSON.stringify({ migration: null })); process.exit(0); }
    // seed in the clear: 20 bots x 30 memory files, 40 attachments of 1 MB, 20 threads x 2,000 log lines
    for (let bot = 0; bot < 20; bot++) {
      call(workspace, "writeMemoryFile", `b${bot}`, prose(8_000));
      for (let topic = 0; topic < 29; topic++) call(workspace, "writeMemoryTopic", `b${bot}`, `t${topic}.md`, prose(4_000));
    }
    for (let i = 0; i < 40; i++) await call<Promise<unknown>>(attachments, "saveFile", chunksOf(Buffer.from(prose(1024 * 1024))), `f${i}.txt`, "text/plain");
    const nativeDir = config.NATIVE_DIR as string;
    mkdirSync(nativeDir, { recursive: true });
    for (let thread = 0; thread < 20; thread++) {
      const lines = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ at: new Date(1_800_000_000_000 + i).toISOString(), dir: "out", source: "bench", msg: { text: prose(300) } }));
      writeFileSync(join(nativeDir, `t${thread}.ndjson`), `${lines.join("\n")}\n`);
    }
    const megabytes = 20 * 30 * 6_000 / 1024 / 1024 + 40 + 20 * 2000 * 360 / 1024 / 1024;
    call(db, "configureContentEncryption", { mode: "on", autoMigrate: false, resolveOwner: () => ({ owner: "@workspace", confidential: false }) });
    call(atRest, "setAtRestGrace", 0);
    const delay = monitorEventLoopDelay({ resolution: 1 });
    delay.enable();
    // a timer that should fire every millisecond: the longest gap is the longest stall
    let last = performance.now();
    let longest = 0;
    const tick = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 1);
    const started = performance.now();
    const pass = await call<Promise<Record<string, number>>>(atRest, "runAtRestMigration", {});
    const sealMs = performance.now() - started;
    clearInterval(tick);
    delay.disable();
    call(db, "configureContentEncryption", { mode: "off", autoMigrate: false, resolveOwner: () => ({ owner: "@workspace", confidential: false }) });
    const backStart = performance.now();
    const back = await call<Promise<Record<string, number>>>(atRest, "runAtRestMigration", {});
    const openMs = performance.now() - backStart;
    console.log(JSON.stringify({
      files: pass.sealed, logs: pass.logs, megabytes: round(megabytes, 1), sealAllMs: Math.round(sealMs), sealMBps: round(megabytes / (sealMs / 1000), 1),
      loopDelayP99Ms: round(delay.percentile(99) / 1e6, 1), loopDelayMaxMs: round(delay.max / 1e6, 1), longestTimerGapMs: round(longest, 1),
      openedBack: back.opened, openBackLogs: back.logs, openAllMs: Math.round(openMs),
    }));
    process.exit(0);
  }

  const out: Record<string, number | null> = {};

  // ---- memory: 30 files for one bot
  const text = prose(8_000);
  out.memoryWriteMs = round(await time(40, (i) => call(workspace, "writeMemoryFile", "bot1", `${text}${i}`)), 3);
  for (let topic = 0; topic < 29; topic++) call(workspace, "writeMemoryTopic", "bot1", `t${topic}.md`, prose(4_000));
  await settle();
  out.memoryReadMs = round(await time(200, () => call(workspace, "readMemoryFile", "bot1")), 3);
  out.memoryPromptLoadMs = round(await time(200, () => call(workspace, "memorySystemPrompt", "bot1", {})), 3);
  out.memorySearchMs = round(await time(40, () => call(workspace, "searchMemoryFiles", "bot1", `${vocabulary[5]} ${vocabulary[6]}`)), 3);
  if (atRest && "holdBotMemoryPlain" in workspace) {
    // what a turn waits for (the call; the opening runs beside it), and how
    // long the opening itself takes in the background
    const path: number[] = [];
    const background: number[] = [];
    for (let i = 0; i < 7; i++) {
      await settle();
      const at = performance.now();
      const opening = call<Promise<void>>(workspace, "holdBotMemoryPlain", "bot1", `turn:x${i}`);
      path.push(performance.now() - at);
      await opening;
      background.push(performance.now() - at);
      call(atRest, "releasePlain", `turn:x${i}`);
    }
    out.memoryTurnPathMs = round(median(path), 3);
    out.memoryOpenedBesideMs = round(median(background), 2);
  } else {
    out.memoryTurnPathMs = null;
    out.memoryOpenedBesideMs = null;
  }

  // ---- attachments
  const root = attachments.ATTACHMENTS_DIR as string;
  for (const size of SIZES) {
    const body = Buffer.from(prose(size));
    const paths: string[] = [];
    out[`upload${label(size)}Ms`] = round(await time(5, async () => {
      const saved = await call<Promise<{ path: string }>>(attachments, "saveFile", chunksOf(body), "file.txt", "text/plain");
      paths.push(saved.path);
    }), 2);
    await settle();
    const target = paths[0]!;
    out[`download${label(size)}Ms`] = round(await time(5, async () => {
      const file = await call<Promise<{ handle: { createReadStream(o: object): AsyncIterable<Buffer> }; bytes: number; stream?: () => AsyncIterable<Buffer> }>>(messageFile, "openMessageFile", target, [root]);
      const stream = file.stream ? file.stream() : file.handle.createReadStream({ start: 0, end: file.bytes - 1, autoClose: true });
      let total = 0;
      for await (const chunk of stream) total += chunk.length;
      if (total !== size) throw new Error(`read ${total} of ${size}`);
    }), 2);
    if (size === SIZES.at(-1)) {
      // a player's 64 KB range from the middle (the audio route)
      out.range64KBof20MBMs = round(await time(20, async () => {
        const file = await call<Promise<{ handle: { createReadStream(o: object): AsyncIterable<Buffer> }; bytes: number; stream?: (o: object) => AsyncIterable<Buffer> }>>(messageFile, "openMessageFile", target, [root]);
        const start = Math.floor(size / 2);
        const stream = file.stream ? file.stream({ start, end: start + 65535 }) : file.handle.createReadStream({ start, end: start + 65535, autoClose: true });
        for await (const _chunk of stream) { /* drain */ }
      }), 3);
      if (atRest) {
        const path: number[] = [];
        const background: number[] = [];
        for (let i = 0; i < 3; i++) {
          await settle();
          const at = performance.now();
          const opening = call<Promise<void>>(atRest, "holdPlain", `turn:a${i}`, [target]);
          path.push(performance.now() - at);
          await opening;
          background.push(performance.now() - at);
          call(atRest, "releasePlain", `turn:a${i}`);
        }
        out.attachment20MBTurnPathMs = round(median(path), 3);
        out.attachment20MBOpenedBesideMs = round(median(background), 1);
      } else {
        out.attachment20MBTurnPathMs = null;
        out.attachment20MBOpenedBesideMs = null;
      }
    }
    for (const path of paths) rmSync(path, { force: true });
  }

  // ---- event logs, written as the server writes them: the native tee one
  // message at a time (appendFileSync, a line sealed on its own), the bus
  // a batch per append (here 4 events, sealed as one block); every line is
  // on disk when its append returns. Read live (small blocks), then after the
  // migration gathered them (the log quiet).
  await load<Any>("server/harness/bus.ts");
  const activity = await load<Any>("server/activity.ts");
  const nativeDir = config.NATIVE_DIR as string;
  const eventsDir = config.EVENTS_DIR as string;
  mkdirSync(nativeDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  const payload = { type: "session/update", params: { text: prose(300) } };
  const appendStart = performance.now();
  for (let i = 0; i < 5_000; i++) call(native, "appendNative", "thread1", { dir: i % 2 ? "in" : "out", source: "bench", msg: payload });
  out.nativeAppendPerLineUs = round(((performance.now() - appendStart) / 5_000) * 1000, 1);
  const eventsFile = join(eventsDir, "thread1.ndjson");
  const { appendFileSync } = await import("node:fs");
  const batch: Array<{ record: Record<string, unknown>; line: string }> = [];
  let busMs = 0;
  for (let i = 0; i < 20_000; i++) {
    const tool = i % 10 === 0;
    const record = tool
      ? { eventId: `e${i}`, provider: "bench", providerInstanceId: "p", threadId: "thread1", createdAt: new Date(1_800_000_000_000 + i).toISOString(), turnId: `t${Math.floor(i / 100)}`, type: i % 20 === 0 ? "item.started" : "item.completed", itemType: "tool", itemId: `i${Math.floor(i / 20)}`, title: "Bash", ok: true }
      : { eventId: `e${i}`, provider: "bench", providerInstanceId: "p", threadId: "thread1", createdAt: new Date(1_800_000_000_000 + i).toISOString(), turnId: `t${Math.floor(i / 100)}`, type: "content.delta", streamKind: "assistant_text", itemId: `m${i}`, delta: prose(200) };
    batch.push({ record, line: JSON.stringify(record) });
    if (batch.length === 4) {
      const at = performance.now();
      const lines = atRest && "sealLogLines" in atRest ? call<string[]>(atRest, "sealLogLines", eventsFile, batch.map((item) => item.record), batch.map((item) => item.line), undefined, { remember: true }) : batch.map((item) => item.line);
      appendFileSync(eventsFile, `${lines.join("\n")}\n`, { mode: 0o600 });
      busMs += performance.now() - at;
      batch.length = 0;
    }
  }
  out.busAppendPerEventUs = round((busMs / 20_000) * 1000, 1);
  const inspector = (limit: number) => call(threadEvents, "readThreadEvents", { eventsDir, nativeDir, threadId: "thread1", limit });
  const busAppend = (count: number, base: number) => {
    const items = Array.from({ length: count }, (_, k) => {
      const record = { eventId: `w${base}-${k}`, provider: "bench", providerInstanceId: "p", threadId: "thread1", createdAt: new Date(1_900_000_000_000 + base * 10 + k).toISOString(), turnId: "tw", type: "content.delta", streamKind: "assistant_text", itemId: `w${base}-${k}`, delta: prose(200) };
      return { record, line: JSON.stringify(record) };
    });
    const lines = atRest && "sealLogLines" in atRest ? call<string[]>(atRest, "sealLogLines", eventsFile, items.map((item) => item.record), items.map((item) => item.line), undefined, { remember: true }) : items.map((item) => item.line);
    const data = `${lines.join("\n")}\n`;
    appendFileSync(eventsFile, data, { mode: 0o600 });
    if (atRest && "logAppended" in atRest) call(atRest, "logAppended", eventsFile, items.map((item) => item.line), data);
  };
  // a view that polls a log being written: a few lines appended between two reads
  for (const limit of [300, 2000]) {
    inspector(limit);
    const reads: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (let k = 0; k < 8; k++) call(native, "appendNative", "thread1", { dir: "out", source: "bench", msg: payload });
      busAppend(4, limit * 100 + i);
      const at = performance.now();
      inspector(limit);
      reads.push(performance.now() - at);
    }
    out[`inspector${limit}WhileWritingMs`] = round(median(reads), 3);
  }
  out.inspector300LiveMs = round(await time(20, () => inspector(300)), 3);
  out.inspector2000LiveMs = round(await time(20, () => inspector(2000)), 3);
  out.activityToolRunsLiveMs = round(await time(20, () => call(activity, "readToolRuns", eventsDir, "thread1")), 2);
  await settle();
  // the first read after the migration gathered the log: nothing of it opened yet
  const cold = performance.now();
  inspector(2000);
  out.inspector2000FirstReadMs = round(performance.now() - cold, 2);
  out.inspector300Ms = round(await time(20, () => inspector(300)), 3);
  out.inspector2000Ms = round(await time(20, () => inspector(2000)), 3);
  out.activityToolRunsMs = round(await time(20, () => call(activity, "readToolRuns", eventsDir, "thread1")), 2);
  console.log(JSON.stringify(out));
} finally {
  call(db, "closeMessageDb");
  rmSync(directory, { recursive: true, force: true });
}
