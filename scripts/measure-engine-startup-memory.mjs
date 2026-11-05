#!/usr/bin/env node
// Peak RSS of the engine startup check, the only boot path that changed
// between pulsa-v0.5.0 and pulsa-v0.5.1.
//
//   0.5.0  Promise.all: every installed CLI's `--version` at once
//          (server/engines/engines-self-check.ts at pulsa-v0.5.0)
//   0.5.1  the same probes, at most two at a time (ENGINE_PROBE_CONCURRENCY)
//   after  no spawn when the manifest already carries `reported`
//          (what the image build stored); otherwise one probe at a time
//
// The script samples VmRSS of every descendant while the probes run.
// It does not need a server, a data directory or a manifest from an image.
//
//   node --experimental-strip-types scripts/measure-engine-startup-memory.mjs --bin-dir DIR
//   node --experimental-strip-types scripts/measure-engine-startup-memory.mjs --stand-in-mb 64 --count 11
//   node scripts/measure-engine-startup-memory.mjs --boot CHECKOUT --bin-dir DIR
//
// `--bin-dir` is a directory of executables named by engines.lock.json `bin`.
// Missing binaries are skipped and named in the report. `--stand-in-mb`
// spawns `count` node processes that each hold that many MiB, so the
// concurrency difference can be checked without the real CLIs.
// `--boot CHECKOUT` starts that tree's server once, with a manifest that
// carries each binary's recorded version, and prints the peak RSS of the
// server and every child. Point it at checkouts of pulsa-v0.5.0 and
// pulsa-v0.5.1, then at this tree.
//
// Writes JSON to --out (default: the path printed on stdout). Refuses the
// all-at-once run when the sum of the individual peaks would not fit in
// the memory still available, and says so.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SAMPLE_MS = 10;
const VERSION_TIMEOUT_MS = 20_000;

function args(argv) {
  const out = {
    binDir: "",
    standInMb: 0,
    count: 11,
    out: "",
    holdMs: 400,
    boot: "",
    port: 18799,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bin-dir") out.binDir = argv[++i] ?? "";
    else if (arg === "--stand-in-mb") out.standInMb = Number(argv[++i] ?? "0");
    else if (arg === "--count") out.count = Number(argv[++i] ?? "11");
    else if (arg === "--out") out.out = argv[++i] ?? "";
    else if (arg === "--hold-ms") out.holdMs = Number(argv[++i] ?? "400");
    else if (arg === "--boot") out.boot = argv[++i] ?? "";
    else if (arg === "--port") out.port = Number(argv[++i] ?? "18799");
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.boot) {
    if (!out.binDir) throw new Error("--boot needs --bin-dir DIR");
    return out;
  }
  if (!out.binDir && !(out.standInMb > 0)) {
    throw new Error("pass --bin-dir DIR, --stand-in-mb N, or --boot CHECKOUT");
  }
  return out;
}

function memAvailableKb() {
  const text = readFileSync("/proc/meminfo", "utf8");
  const match = text.match(/^MemAvailable:\s+(\d+)/m);
  return match ? Number(match[1]) : 0;
}

function rssKb(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = text.match(/^VmRSS:\s+(\d+)/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

/** pid plus every descendant, from a single pass over /proc. */
function tree(rootPid) {
  const children = new Map();
  let names;
  try {
    names = readdirSync("/proc");
  } catch {
    return [rootPid];
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let stat;
    try {
      stat = readFileSync(`/proc/${name}/stat`, "utf8");
    } catch {
      continue;
    }
    const close = stat.lastIndexOf(")");
    if (close < 0) continue;
    const fields = stat.slice(close + 2).split(" ");
    const ppid = Number(fields[1]);
    if (!Number.isInteger(ppid)) continue;
    const list = children.get(ppid);
    if (list) list.push(Number(name));
    else children.set(ppid, [Number(name)]);
  }
  const out = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    const kids = children.get(pid);
    if (kids) for (const kid of kids) stack.push(kid);
  }
  return out;
}

function treeRssKb(rootPid) {
  let sum = 0;
  for (const pid of tree(rootPid)) sum += rssKb(pid);
  return sum;
}

/** Peak descendant RSS while `run` is in flight, in KiB. Includes this process. */
async function peakWhile(run) {
  let peak = treeRssKb(process.pid);
  let stop = false;
  const timer = setInterval(() => {
    if (stop) return;
    const sample = treeRssKb(process.pid);
    if (sample > peak) peak = sample;
  }, SAMPLE_MS);
  timer.unref?.();
  try {
    await run();
  } finally {
    stop = true;
    clearInterval(timer);
    const last = treeRssKb(process.pid);
    if (last > peak) peak = last;
  }
  return peak;
}

function spawnVersion(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, VERSION_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(1);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(0);
    });
  });
}

/** `items` mapped by `run`, at most `limit` at a time. Same shape as mapLimited. */
async function mapLimited(items, limit, run) {
  const results = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

function lockBins(binDir) {
  const lock = JSON.parse(readFileSync(join(root, "engines.lock.json"), "utf8"));
  const found = [];
  const missing = [];
  for (const engine of lock.engines) {
    const path = join(binDir, engine.bin);
    try {
      const info = statSync(path);
      if (info.isFile()) found.push({ id: engine.id, bin: engine.bin, path });
      else missing.push(engine.id);
    } catch {
      missing.push(engine.id);
    }
  }
  return { found, missing };
}

function standIns(count, mb, holdMs) {
  const script = `
    const mb = Number(process.argv[1]);
    const hold = Number(process.argv[2]);
    const chunks = [];
    for (let i = 0; i < mb; i += 1) chunks.push(Buffer.alloc(1024 * 1024, i & 255));
    setTimeout(() => { chunks.length = 0; process.exit(0); }, hold);
  `;
  return Array.from({ length: count }, (_, i) => ({
    id: `stand-in-${i}`,
    bin: "node",
    path: process.execPath,
    args: ["-e", script, String(mb), String(holdMs)],
  }));
}

function targetsFrom(options) {
  if (options.standInMb > 0) {
    return { targets: standIns(options.count, options.standInMb, options.holdMs), missing: [] };
  }
  const { found, missing } = lockBins(options.binDir);
  return {
    targets: found.map((engine) => ({ ...engine, args: ["--version"] })),
    missing,
  };
}

async function runOne(target) {
  await spawnVersion(target.path, target.args);
}

async function measureMode(name, targets, run) {
  const started = Date.now();
  const baseline = treeRssKb(process.pid);
  const peak = await peakWhile(() => run(targets));
  return {
    mode: name,
    engines: targets.length,
    baselineKb: baseline,
    peakKb: peak,
    addedKb: Math.max(0, peak - baseline),
    ms: Date.now() - started,
  };
}

async function individuals(targets) {
  const rows = [];
  for (const target of targets) {
    const baseline = treeRssKb(process.pid);
    const peak = await peakWhile(() => runOne(target));
    rows.push({
      id: target.id,
      peakKb: peak,
      addedKb: Math.max(0, peak - baseline),
    });
  }
  return rows;
}

let engineSelfCheckModule = null;
async function loadEngineSelfCheck() {
  engineSelfCheckModule ??= await import(new URL("../server/engines/engines-self-check.ts", import.meta.url).href);
  return engineSelfCheckModule;
}

/** The server's own check, with the version line the image build records.
 * A probe that runs anyway allocates so a regression shows up in the peak. */
async function fixedSelfCheck(targets) {
  const { runEngineSelfCheck } = await loadEngineSelfCheck();
  const manifest = {
    lockVersion: 1,
    engineSet: "all",
    installed: targets.map((target) => ({
      id: target.id,
      name: target.id,
      drivers: [target.id],
      kind: "npm",
      version: "0",
      bin: target.bin,
      reported: `${target.id} recorded`,
    })),
    notPreinstalled: [],
  };
  await runEngineSelfCheck(manifest, {
    find: (bin) => {
      const hit = targets.find((target) => target.bin === bin);
      return hit ? [hit.path] : [];
    },
    probe: async () => {
      const chunks = [];
      for (let i = 0; i < 256; i += 1) chunks.push(Buffer.alloc(1024 * 1024, 1));
      return `allocated ${chunks.length}`;
    },
    log: () => {},
  });
}

function mib(kb) {
  return Math.round((kb / 1024) * 10) / 10;
}

function manifestFor(binDir) {
  const { found, missing } = lockBins(binDir);
  return {
    missing,
    manifest: {
      lockVersion: 1,
      engineSet: "all",
      arch: process.arch === "arm64" ? "arm64" : "amd64",
      installed: found.map((engine) => ({
        id: engine.id,
        name: engine.id,
        drivers: [engine.id],
        kind: "npm",
        version: "0",
        bin: engine.bin,
        reported: `${engine.id} recorded-at-image-build`,
      })),
      notPreinstalled: [],
    },
  };
}

/** Peak RSS of one server start of `checkout`, including engine children. */
async function measureBoot(checkout, binDir, port) {
  const { missing, manifest } = manifestFor(binDir);
  const manifestPath = join(tmpdir(), `engines-manifest-${port}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const dataDir = join(tmpdir(), `sagax-boot-${port}`);
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["--experimental-strip-types", join(checkout, "server/index.ts")], {
    cwd: checkout,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      SAGAX_DATA_DIR: dataDir,
      SAGAX_PORT: String(port),
      SAGAX_WEBHOOK_PORT: String(port + 1),
      SAGAX_ENGINES_MANIFEST: manifestPath,
    },
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  let peak = 0;
  const started = Date.now();
  let readyAt = 0;
  while (Date.now() - started < 90_000) {
    if (child.exitCode != null) break;
    const sample = treeRssKb(child.pid);
    if (sample > peak) peak = sample;
    if (!readyAt && log.includes("self-check:") && log.includes("openmausbot server")) readyAt = Date.now();
    if (readyAt && Date.now() - readyAt > 1500) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
  const lines = log.split("\n").filter((line) => line.startsWith("[engines] "));
  return {
    checkout,
    missing,
    engines: manifest.installed.length,
    peakKb: peak,
    peakMiB: mib(peak),
    ms: Date.now() - started,
    spawnedCli: lines.some((line) => line.includes("(Claude Code)") || line.includes("codex-cli")),
    summary: lines.find((line) => line.includes("self-check:")) ?? "",
  };
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.boot) {
    const report = await measureBoot(options.boot, options.binDir, options.port);
    const outPath = options.out || join(tmpdir(), `engine-startup-boot-${Date.now()}.json`);
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`wrote ${outPath}`);
    return;
  }
  const { targets, missing } = targetsFrom(options);
  if (!targets.length) throw new Error("no engines to measure");
  const availableBefore = memAvailableKb();
  const alone = await individuals(targets);
  const sumAdded = alone.reduce((sum, row) => sum + row.addedKb, 0);
  const available = memAvailableKb();
  // Leave a gibibyte for the rest of the machine. The sum of the individual
  // peaks is the overlap ceiling of starting every CLI together.
  const allAtOnceSafe = sumAdded + 1024 * 1024 < available;

  const modes = [];
  if (allAtOnceSafe) {
    modes.push(await measureMode("0.5.0", targets, (items) => Promise.all(items.map((item) => runOne(item)))));
  } else {
    modes.push({
      mode: "0.5.0",
      engines: targets.length,
      skipped: true,
      reason: `sum of individual peaks is ${mib(sumAdded)} MiB and MemAvailable is ${mib(available)} MiB`,
      ceilingKb: sumAdded,
    });
  }
  modes.push(await measureMode("0.5.1", targets, (items) => mapLimited(items, 2, runOne)));
  // The server has already loaded this module by the time it checks engines.
  // Import first so the fixed peak is the check itself, not the first import.
  await loadEngineSelfCheck();
  modes.push(await measureMode("fixed", targets, () => fixedSelfCheck(targets)));

  const report = {
    measuredAt: new Date().toISOString(),
    hostCpus: availableParallelism(),
    memAvailableBeforeKb: availableBefore,
    memAvailableAfterIndividualsKb: available,
    missing,
    individuals: alone.map((row) => ({ ...row, addedMiB: mib(row.addedKb) })),
    sumOfIndividualPeaksMiB: mib(sumAdded),
    modes: modes.map((mode) => ({
      ...mode,
      ...(mode.peakKb != null ? { peakMiB: mib(mode.peakKb), addedMiB: mib(mode.addedKb) } : {}),
      ...(mode.ceilingKb != null ? { ceilingMiB: mib(mode.ceilingKb) } : {}),
    })),
    note: "addedMiB is the peak RSS of this process and its descendants minus the RSS just before that run. 0.5.0 is Promise.all. 0.5.1 is a pool of 2. fixed spawns nothing, which is what the server does when the manifest carries reported.",
  };
  const outPath = options.out || join(tmpdir(), `engine-startup-memory-${Date.now()}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
