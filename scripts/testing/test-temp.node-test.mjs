import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createTestTempRoot, pruneTestTemps, TEST_TEMP_PREFIX } from "./test-temp.mjs";

const repo = resolve(import.meta.dirname, "../..");

test("a run contains child temps and restores the caller's environment", () => {
  const before = tmpdir();
  const run = createTestTempRoot();
  try {
    assert.equal(tmpdir(), run.path);
    const child = spawnSync(process.execPath, ["-e", "require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'child-'))"], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(readdirSync(run.path).some((name) => name.startsWith("child-")));
  } finally { run.cleanup(); }
  assert.equal(tmpdir(), before);
  assert.equal(existsSync(run.path), false);
});

// macOS 15 and older refuse a Unix socket path past sun_path (104 bytes,
// listen EINVAL). A server under test binds DATA_DIR/perm-<tag>.sock, with
// DATA_DIR one mkdtemp below the run's root, so the root has to stay short:
// the per-user temp folder there is 49 characters before the run's own.
test("the run's root leaves room for a Unix socket two folders down", { skip: process.platform === "win32" && "Windows binds named pipes, not socket files" }, () => {
  const run = createTestTempRoot();
  try {
    const socket = join(run.path, "openmausbot-verify-data-XXXXXX", "perm-abcd1234.sock");
    assert.ok(Buffer.byteLength(socket) < 104, `${socket} is ${Buffer.byteLength(socket)} bytes`);
    assert.equal(tmpdir(), run.path);
  } finally { run.cleanup(); }
});

test("the sweep removes only old test directories and keeps live runs and links", () => {
  const root = mkdtempSync(join(tmpdir(), "test-temp-check-"));
  const old = new Date(Date.now() - 24 * 60 * 60_000);
  try {
    for (const name of ["omb-test-home-old", "omb-test-home-new", "personal", `${TEST_TEMP_PREFIX}active`, `${TEST_TEMP_PREFIX}abandoned`]) mkdirSync(join(root, name));
    writeFileSync(join(root, `${TEST_TEMP_PREFIX}active`, ".sagax-test-owner.json"), JSON.stringify({ pid: process.pid }));
    const exited = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    writeFileSync(join(root, `${TEST_TEMP_PREFIX}abandoned`, ".sagax-test-owner.json"), JSON.stringify({ pid: exited.pid }));
    for (const name of readdirSync(root)) if (!name.endsWith("-new")) utimesSync(join(root, name), old, old);
    symlinkSync(join(root, "personal"), join(root, "omb-test-home-link"), "junction");
    assert.equal(pruneTestTemps(root), 2);
    assert.deepEqual(readdirSync(root).sort(), ["omb-test-home-link", "omb-test-home-new", "personal", `${TEST_TEMP_PREFIX}active`].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const fail of [false, true]) test(`a sample suite removes all its temporary files on ${fail ? "failure" : "success"}`, () => {
  const root = mkdtempSync(join(tmpdir(), "test-temp-suite-"));
  const temp = join(root, "temp");
  mkdirSync(temp);
  try {
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "junction");
    writeFileSync(join(root, "vitest.config.mjs"), `export default { test: { globalSetup: ${JSON.stringify(join(repo, "server/testing/global-setup.ts"))}, include: ['sample.test.mjs'] } };`);
    writeFileSync(join(root, "sample.test.mjs"), `import { test, expect } from 'vitest'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; test('sample', () => { const dir=mkdtempSync(join(tmpdir(),'leaked-child-')); writeFileSync(join(dir,'data'),'fixture'); expect(${fail}).toBe(false); });`);
    const run = spawnSync(process.execPath, [join(repo, "node_modules/vitest/vitest.mjs"), "run"], { cwd: root, env: { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp }, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, fail ? 1 : 0, run.stdout + run.stderr);
    assert.deepEqual(readdirSync(temp), []);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
