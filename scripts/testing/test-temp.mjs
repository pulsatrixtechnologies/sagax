// Every test run owns one temp root, including temp files of child processes.
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_TEMP_PREFIX = "sagax-test-run-";
const OWNER = ".sagax-test-owner.json";
const LEGACY_PREFIXES = ["omb-test-home-", "omb-bridge-home-", "sagax-mac-apps-", "pp-test-", "engine-logins-"];
const ENV_KEYS = ["TMPDIR", "TMP", "TEMP"];
// macOS before 27 refuses a Unix socket path over 103 bytes (`sun_path`). A
// fixture's server gets a home inside the run's root as its TMPDIR, and the
// permission broker binds `<TMPDIR>/omb-perm-<16 hex>.sock` there: the root,
// the longest fixture home (42) and that name (30) must fit together.
const SOCKET_PATH_MAX = 103;
const FIXTURE_ROOM = 1 + 42 + 1 + 30;
const SHORT_PARENT = "/tmp";

/** Where a run's root goes: the caller's temp folder, or `/tmp` when a
 * socket under a fixture home there would be too long for macOS (its own
 * per-user temp folder is 49 bytes before the run's root starts). */
export function testTempParent(root = tmpdir()) {
  if (process.platform === "win32") return root;
  const longest = Buffer.byteLength(root) + 1 + TEST_TEMP_PREFIX.length + 6 + FIXTURE_ROOM;
  return longest <= SOCKET_PATH_MAX || !existsSync(SHORT_PARENT) ? root : SHORT_PARENT;
}

export function pruneTestTemps(root, now = Date.now(), maxAgeMs = 6 * 60 * 60_000) {
  if (root !== undefined) return pruneTestTempsIn(root, now, maxAgeMs);
  return [...new Set([tmpdir(), testTempParent()])].reduce((removed, each) => removed + pruneTestTempsIn(each, now, maxAgeMs), 0);
}

function pruneTestTempsIn(root, now, maxAgeMs) {
  let removed = 0;
  for (const name of readdirSync(root)) {
    if (!name.startsWith(TEST_TEMP_PREFIX) && !LEGACY_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const path = join(root, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || now - stat.mtimeMs < maxAgeMs) continue;
      if (process.getuid && stat.uid !== process.getuid()) continue;
      if (name.startsWith(TEST_TEMP_PREFIX)) {
        const owner = JSON.parse(readFileSync(join(path, OWNER), "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid < 1) continue;
        try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== "ESRCH") continue; }
      }
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      removed++;
    } catch { /* Another run may already have removed it, or still own a handle. */ }
  }
  return removed;
}

export function createTestTempRoot(root = testTempParent()) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const path = mkdtempSync(join(root, TEST_TEMP_PREFIX));
  writeFileSync(join(path, OWNER), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  for (const key of ENV_KEYS) process.env[key] = path;
  return {
    path,
    cleanup() {
      for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      if (existsSync(path)) rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}
