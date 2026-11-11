// CI runs the suite as several shards per platform (.github/workflows/ci.yml),
// one file at a time, so the slowest shard sets how long a run takes and
// whether it ends inside the job's cap. These pin that the configured
// sequencer splits by recorded seconds, still runs every file exactly once,
// that the shards fit their cap, and that its weights stay keyed to files
// that exist.
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseSequencer, type TestSequencerConstructor, type TestSpecification, type Vitest } from "vitest/node";
import { parse } from "yaml";
import viteConfig from "../../vite.config.ts";
import { DurationSequencer, SHARD_WEIGHTS_FILE, loadShardWeights, planShards, weightKey } from "./duration-sequencer.ts";
import { VITEST_JOB, buildWeights, parseVitestLog, slowestPerFile } from "./update-shard-weights.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const WEIGHTS = loadShardWeights(ROOT);
const FILES = globSync(viteConfig.test?.include ?? [], { cwd: ROOT, exclude: (file) => /(^|[\\/])node_modules$/.test(file) })
  .map((file) => file.split(path.sep).join("/"))
  .sort();
const specs = (files: readonly string[]) => files.map((file) => ({ moduleId: path.join(ROOT, file) }) as TestSpecification);
const keyOf = (spec: TestSpecification) => weightKey(ROOT, spec.moduleId);
// charged exactly as the sequencer charges it, unlisted e2e files included
const seconds = (file: string) => planShards([file], WEIGHTS, 1).loads[0];

const VITEST_JOB_CONFIG = parse(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")).jobs.vitest;
const CI_SHARDS: number = VITEST_JOB_CONFIG.strategy.matrix.shard.length;
// The Linux shards run after every merge and have the shortest cap.
const LINUX_CAP_MINUTES = Number(/ubuntu-latest' && (\d+)/.exec(VITEST_JOB_CONFIG["timeout-minutes"])?.[1]);
// Calibrated on a complete run of every platform (#3521): the weights take
// each file at its slowest platform, a job's wall time is about 1.1x its
// files' recorded seconds (imports, setup, transform), and checkout, install
// and the Electron download take up to two minutes before vitest starts.
// That predicts 15.7 minutes for the slowest of twenty shards; the slowest
// measured took 15.1 (Windows), and the slowest Linux one 11.8.
const WALL_PER_RECORDED_SECOND = 1.1;
const SETUP_SECONDS = 120;

function context(index: number, count: number, log: (line: string) => void = () => {}) {
  return { config: { root: ROOT, shard: { index, count } }, logger: { log } } as unknown as Vitest;
}

async function split(Sequencer: TestSequencerConstructor, files: readonly string[], count: number) {
  const shards: string[][] = [];
  for (let index = 1; index <= count; index++) {
    shards.push((await new Sequencer(context(index, count)).shard(specs(files))).map((spec) => keyOf(spec) ?? ""));
  }
  return shards;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vitest shard balance", () => {
  it("sizes the CI shards so the slowest ends well inside the Linux cap (#3521)", () => {
    // Four shards for three hours of tests: every Linux shard was cancelled
    // at its 30 minute cap with most of its files never run.
    expect(LINUX_CAP_MINUTES).toBeGreaterThan(0);
    const { loads } = planShards(FILES, WEIGHTS, CI_SHARDS);
    const minutes = (Math.max(...loads) * WALL_PER_RECORDED_SECOND + SETUP_SECONDS) / 60;
    expect(minutes, `slowest of ${CI_SHARDS} shards, from ${SHARD_WEIGHTS_FILE}`).toBeLessThanOrEqual(LINUX_CAP_MINUTES * 0.6);
  });

  it("gives no CI shard much more recorded time than the others", async () => {
    const Sequencer = viteConfig.test?.sequence?.sequencer ?? BaseSequencer;
    const loads = (await split(Sequencer, FILES, CI_SHARDS)).map((shard) => shard.reduce((sum, file) => sum + seconds(file), 0));
    const mean = loads.reduce((sum, load) => sum + load, 0) / loads.length;
    // equal file counts put three of the four slowest e2e files in one shard: ~1.4x the mean
    expect(Math.max(...loads) / mean, `recorded seconds per shard: ${loads.join(", ")}`).toBeLessThan(1.05);
  });

  it("runs every test file in exactly one shard for one to six shards", async () => {
    for (let count = 1; count <= 6; count++) {
      const shards = await split(DurationSequencer, FILES, count);
      expect(shards.flat().sort(), `${count} shards`).toEqual(FILES);
    }
  });

  it("never puts two of the slowest files in one shard while a shard is free", async () => {
    const slowest = Object.entries(WEIGHTS).sort(([, a], [, b]) => b - a).map(([file]) => file);
    for (let count = 2; count <= 6; count++) {
      const shards = await split(DurationSequencer, FILES, count);
      const owners = slowest.slice(0, count).map((file) => shards.findIndex((shard) => shard.includes(file)));
      expect(new Set(owners).size, `${count} shards: ${slowest.slice(0, count).join(", ")}`).toBe(count);
    }
  });

  it("plans the same split whatever order the files arrive in", () => {
    const shuffled = [...FILES].reverse();
    const forward = planShards(FILES, WEIGHTS, 4).shardOf;
    const backward = planShards(shuffled, WEIGHTS, 4).shardOf;
    expect(shuffled.map((file) => forward[FILES.indexOf(file)])).toEqual(backward);
  });

  it("keys Windows and POSIX paths the same way", () => {
    expect(weightKey("/repo", "/repo/server/a.e2e.test.ts", path.posix)).toBe("server/a.e2e.test.ts");
    expect(weightKey("D:/a/repo", "D:/a/repo/server/a.e2e.test.ts", path.win32)).toBe("server/a.e2e.test.ts");
    expect(weightKey("D:\\a\\repo", "d:/a/repo/server/drivers/b.test.ts", path.win32)).toBe("server/drivers/b.test.ts");
    expect(weightKey("D:/a/repo", "C:/elsewhere/c.test.ts", path.win32)).toBeNull();
    expect(weightKey("/repo", "/other/c.test.ts", path.posix)).toBeNull();
  });

  it("charges a new e2e file the median e2e time and any other new file one second", () => {
    const weights = { "server/a.e2e.test.ts": 10, "server/b.e2e.test.ts": 20, "server/c.e2e.test.ts": 90, "server/d.test.ts": 50 };
    const { loads } = planShards([...Object.keys(weights), "server/new.e2e.test.ts", "server/new.test.ts"], weights, 1);
    expect(loads).toEqual([10 + 20 + 90 + 50 + 20 + 1]);
  });

  it("weighs only test files that exist", () => {
    const stale = Object.keys(WEIGHTS).filter((file) => !FILES.includes(file));
    expect(stale, `remove these from ${SHARD_WEIGHTS_FILE} or rerun scripts/testing/update-shard-weights.mjs`).toEqual([]);
  });

  it("logs its split, and annotates a CI run whose weights match no files", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const lines: string[] = [];
    await new DurationSequencer(context(2, 4, (line) => lines.push(line))).shard(specs(FILES));
    expect(lines).toEqual([expect.stringMatching(new RegExp(`^duration-sequencer: shard 2/4 runs \\d+ of ${FILES.length} files, ~\\d+s recorded; ${Object.keys(WEIGHTS).length} of ${Object.keys(WEIGHTS).length} weighted files found$`))]);

    lines.length = 0;
    const elsewhere = FILES.map((file) => ({ moduleId: path.join(ROOT, "..", "elsewhere", file) }) as TestSpecification);
    await new DurationSequencer(context(1, 4, (line) => lines.push(line))).shard(elsewhere);
    expect(lines[1]).toMatch(/^::warning title=duration-sequencer::Only 0 of \d+ weighted test files were found/);
  });
});

describe("update-shard-weights", () => {
  it("reads each file's time from a CI log, colour codes and skipped files included", () => {
    const log = [
      "vitest (windows-latest, shard 4/4)\tUNKNOWN STEP\t2026-10-05T22:52:23.1Z  ✓ server/drivers/acp/acp.test.ts (150 tests) 41750ms",
      "2026-10-06T10:06:39.1Z  ^[[32m✓^[[39m server/a.e2e.test.ts ^[[2m(^[[22m39 tests | ^[[33m1 skipped^[[39m^[[2m)^[[22m^[[33m 316800^[[2mms^[[22m^[[39m",
      "2026-10-06T10:03:21.1Z  ↓ scripts/testing/cloud-preview.e2e.test.ts (1 test | 1 skipped)",
      "2026-10-06T10:03:22.1Z    ❯ server/b.test.ts:12:3",
      "2026-10-06T10:03:23.1Z  × server/c.test.ts (3 tests | 1 failed) 9000ms",
    ].join("\n");
    expect(Object.fromEntries(parseVitestLog(log))).toEqual({
      "server/drivers/acp/acp.test.ts": 41.75,
      "server/a.e2e.test.ts": 316.8,
      "scripts/testing/cloud-preview.e2e.test.ts": 0,
      "server/c.test.ts": 9,
    });
  });

  it("keeps each slow or e2e file's median, and drops light and deleted files", () => {
    const runs = [
      new Map([["server/slow.test.ts", 9], ["server/light.test.ts", 2], ["server/skipped.e2e.test.ts", 0], ["server/gone.test.ts", 60]]),
      new Map([["server/slow.test.ts", 30], ["server/light.test.ts", 3]]),
      new Map([["server/slow.test.ts", 12.4], ["server/light.test.ts", 1]]),
    ];
    expect(buildWeights(runs, (file: string) => file !== "server/gone.test.ts")).toEqual({
      "server/skipped.e2e.test.ts": 1,
      "server/slow.test.ts": 12,
    });
  });

  it("weighs each file at its slowest platform within one run (#3521)", () => {
    // Windows alone weighed a POSIX-only file at zero seconds, though it ran
    // for minutes on the Linux shards.
    const windows = new Map([["server/posix-only.test.ts", 0], ["server/both.test.ts", 40]]);
    const linux = new Map([["server/posix-only.test.ts", 197], ["server/both.test.ts", 30], ["server/linux.e2e.test.ts", 9]]);
    expect(Object.fromEntries(slowestPerFile([windows, linux]))).toEqual({
      "server/posix-only.test.ts": 197,
      "server/both.test.ts": 40,
      "server/linux.e2e.test.ts": 9,
    });
    expect(VITEST_JOB.test(`vitest (ubuntu-latest, shard 3/${CI_SHARDS})`)).toBe(true);
    expect(VITEST_JOB.test("vitest (macos-latest, shard 12/16)")).toBe(true);
    expect(VITEST_JOB.test("vitest (windows-latest, shard 1/4)")).toBe(true);
    expect(VITEST_JOB.test("renderer smoke (control-omb ui, Ubuntu 24.04)")).toBe(false);
  });
});
