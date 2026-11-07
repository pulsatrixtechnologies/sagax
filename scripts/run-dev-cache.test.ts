// The coding run image's cache scripts (deploy/run-dev): px-cache-init points
// every build cache at the cache disk (or the workspace fallback) and execs
// the run; px-cache-gc frees the disk in order, only above its threshold.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const INIT = join(ROOT, "deploy/run-dev/px-cache-init");
const GC = join(ROOT, "deploy/run-dev/px-cache-gc");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "px-cache-"));
  dirs.push(dir);
  return dir;
}

function file(path: string, kb: number, daysOld = 0): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.alloc(kb * 1024, 1));
  const at = Date.now() / 1000 - daysOld * 86_400;
  utimesSync(path, at, at);
}

function envOf(output: string): Record<string, string> {
  return Object.fromEntries(output.split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

describe("px-cache-init", () => {
  it("points cargo, sccache, rustup and pnpm at the cache disk, one target per environment", () => {
    const root = scratch();
    const seed = join(root, "seed");
    mkdirSync(join(seed, "toolchains/1.99.1-x86_64-unknown-linux-gnu"), { recursive: true });
    writeFileSync(join(seed, "settings.toml"), "default_toolchain = \"1.99.1\"\n");
    const out = execFileSync("sh", [INIT, "env"], {
      env: { PATH: process.env.PATH!, HOME: join(root, "home"), PX_CACHE_DIR: join(root, "cache"), PX_ENV_ID: "envabc123", PX_RUSTUP_SEED: seed, PX_CACHE_GC: "0" },
      encoding: "utf8",
    });
    const env = envOf(out);
    const cache = join(root, "cache");
    expect(env.CARGO_TARGET_DIR).toBe(join(cache, "target/envabc123"));
    expect(env.CARGO_HOME).toBe(join(cache, "cargo-home"));
    expect(env.SCCACHE_DIR).toBe(join(cache, "sccache"));
    expect(env.PNPM_STORE_DIR).toBe(join(cache, "pnpm-store"));
    expect(env.SCCACHE_CACHE_SIZE).toMatch(/^\d+G$/);
    expect(existsSync(join(cache, "target/envabc123/.px-used"))).toBe(true);
    expect(existsSync(join(cache, "rustup/toolchains/1.99.1-x86_64-unknown-linux-gnu"))).toBe(true);
    expect(readFileSync(join(cache, "rustup/settings.toml"), "utf8")).toContain("1.99.1");
  });

  it("falls back to the workspace without a cache disk and refuses an odd environment id", () => {
    const root = scratch();
    const out = execFileSync("sh", [INIT, "env"], {
      env: { PATH: process.env.PATH!, HOME: join(root, "home"), PX_ENV_ID: "../escape", PX_RUSTUP_SEED: join(root, "none"), PX_CACHE_GC: "0" },
      encoding: "utf8",
    });
    const env = envOf(out);
    expect(env.PX_CACHE_DIR).toBe(join(root, "home/.px-cache"));
    expect(env.CARGO_TARGET_DIR).toBe(join(root, "home/.px-cache/target/default"));
  });
});

describe("px-cache-gc", () => {
  function gc(cache: string, capacityKb: number, current = ""): string {
    return execFileSync("sh", [GC, "--once"], {
      env: { PATH: process.env.PATH!, PX_CACHE_DIR: cache, PX_CACHE_GC_CAPACITY_KB: String(capacityKb), CARGO_TARGET_DIR: current },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  it("does nothing under the threshold", () => {
    const cache = scratch();
    file(join(cache, "target/enva/debug/incremental/x-1/s-old/f"), 100, 10);
    gc(cache, 1000);
    expect(existsSync(join(cache, "target/enva/debug/incremental/x-1/s-old/f"))).toBe(true);
  });

  it("frees old incremental sessions first and stops once under the low mark", () => {
    const cache = scratch();
    file(join(cache, "target/enva/debug/incremental/x-1/s-old/f"), 500, 10);
    file(join(cache, "target/enva/debug/deps/libkeep.rlib"), 300);
    const tenDaysAgo = Date.now() / 1000 - 10 * 86_400;
    utimesSync(join(cache, "target/enva/debug/incremental/x-1/s-old"), tenDaysAgo, tenDaysAgo);
    gc(cache, 1000);
    expect(existsSync(join(cache, "target/enva/debug/incremental/x-1/s-old"))).toBe(false);
    expect(existsSync(join(cache, "target/enva/debug/deps/libkeep.rlib"))).toBe(true);
  });

  it("empties the other environments' targets, least recently used first, before the current one", () => {
    const cache = scratch();
    for (const [env, age] of [["envold", 3], ["envmid", 2], ["envnow", 0]] as const) {
      file(join(cache, `target/${env}/debug/deps/lib.rlib`), 300);
      file(join(cache, `target/${env}/.px-used`), 0, age);
    }
    file(join(cache, "sccache/blob"), 100);
    gc(cache, 1200, join(cache, "target/envnow"));
    expect(existsSync(join(cache, "target/envold"))).toBe(false);
    expect(existsSync(join(cache, "target/envmid/debug/deps/lib.rlib"))).toBe(true);
    expect(existsSync(join(cache, "target/envnow/debug/deps/lib.rlib"))).toBe(true);
    expect(existsSync(join(cache, "sccache/blob"))).toBe(true);
  });

  it("refuses to run without a cache directory", () => {
    expect(() => execFileSync("sh", [GC, "--once"], { env: { PATH: process.env.PATH! }, stdio: "pipe" })).toThrow();
  });
});
