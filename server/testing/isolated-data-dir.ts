// A test server's data folder is a fresh temporary folder, never a person's
// real one (2026-11-18: a bot named perf-test-061 sat on the owner's real
// account). Every verification launch goes through this check.
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const REAL_FOLDERS = [".sagax", ".openmausbot", ".opengrokbot"];

function canonical(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
}

/** Throws unless `dataDir` is under the system's temporary folder (or
 * /tmp) and outside every real data folder of `home`. */
export function assertIsolatedDataDir(dataDir: string, home = homedir(), temps: readonly string[] = [tmpdir(), "/tmp"]): void {
  const dir = canonical(dataDir);
  for (const folder of REAL_FOLDERS) {
    if (inside(dir, canonical(join(home, folder)))) throw new Error(`refusing to run a test server on the real data folder ${join("~", folder)}`);
  }
  const real = process.env.SAGAX_REAL_DATA_DIR?.trim();
  if (real && inside(dir, canonical(real))) throw new Error("refusing to run a test server on the real data folder");
  if (!temps.some((temp) => inside(dir, canonical(temp)))) throw new Error("a test server's data folder must be a fresh temporary folder");
}
