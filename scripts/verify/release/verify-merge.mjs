#!/usr/bin/env node
// The local gate before a merge: `pnpm verify:merge`. A few minutes, not the
// 20-minute suite (that one runs once, at the version cut). Nothing runs in
// CI for a private PR, so this is the only barrier between a branch and main.
//
//   pnpm verify:merge                 what the diff against origin/main needs
//   pnpm verify:merge --base main     another base
//   pnpm verify:merge --list          print the plan, run nothing
//   pnpm verify:merge --ios           force the iOS stage
//
// Stages, in order:
//   1. light checks, always: lint, typecheck, locale catalogs, source terms,
//      skin contrast, unused files (about 30 s together)
//   2. guard tests, always: the ratchets, goldens and source scans that break
//      main silently when another PR lands (about 30 s)
//   3. the tests of the diff: every changed test file, the tests beside a
//      changed source (same folder, same stem: foo.test.ts, foo.*.test.ts,
//      foo.e2e.test.ts), the tests beside a changed route's module, and the
//      tests of an area the diff touches (AREA_TESTS: the connector matrix
//      and the hosts' launch contract for the connector paths)
//   4. iOS, only when ios/ or shared/ changed: `swift test` and the Debug
//      build of the Sagax scheme for the generic simulator (no device boots,
//      no window)
//
// Exit 1 on the first stage that fails; the summary names it. SAGAX_SKIP_HOOKS=1
// skips the pre-push hook that runs this, never the gate itself.
//
// The result goes on the branch's pull request when there is one (a comment
// "verify:merge" kept up to date, through `gh`): OK or the failed stage, with
// the commit it ran on. A PR whose head commit has no OK comment was pushed
// around the gate (`--no-verify`), and that shows. Nothing on GitHub blocks
// a merge: no CI runs on a private PR. `--no-report` keeps it local.
//
// On OK, writes a stamp under the common git dir (`sagax-verify-merge/ok-<sha>`)
// so the pre-push hook can skip a re-run for the same HEAD. Strips every GIT_*
// from the process env before any stage so a leaked hook GIT_DIR cannot make a
// test commit into the branch being pushed (issue #1705).
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existingGuardTests } from "./guard-tests.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const STAMP_FOLDER = "sagax-verify-merge";

/** Strip every GIT_* key so a hook's GIT_DIR (worktree) cannot leak into
 * tests that run git commit / init. Same idea as server/checkpoints gitEnv. */
export function sanitizeGitEnv(env = process.env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

/** Absolute stamp path for a HEAD sha under the common git dir, or null. */
export function stampPathFor(commonDir, sha, root = ROOT) {
  if (!commonDir || !sha || /[^0-9a-f]/.test(sha)) return null;
  const common = commonDir.startsWith("/") ? commonDir : join(root, commonDir);
  return join(common, STAMP_FOLDER, `ok-${sha}`);
}

/** Tests that hold a whole area: they run when the diff touches any of its
 * paths (a folder ending with "/", or a file). #3354: the connector matrix
 * (every engine row by every provider, on fakes) and the hosts' launch
 * contract, for any change to the paths a connector call crosses. */
export const AREA_TESTS = [
  {
    paths: ["server/connectors/", "server/drivers/", "server/turns/", "server/approvals/", "server/runtime-events/", "server/harness/", "shared/engine-connectors.ts"],
    tests: ["server/connectors/connector-matrix.e2e.test.ts", "server/connectors/launch-profile.contract.test.ts"],
  },
];

/** The area tests a set of changed files needs. */
export function areaTests(changed, areas = AREA_TESTS) {
  const out = new Set();
  for (const area of areas) {
    if (changed.some((file) => area.paths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path)))) {
      for (const test of area.tests) out.add(test);
    }
  }
  return [...out].sort();
}

const LIGHT_CHECKS = [
  ["lint", ["pnpm", "lint"]],
  ["typecheck", ["pnpm", "typecheck"]],
  ["locale catalogs", ["pnpm", "i18n:check"]],
  ["source terms", ["pnpm", "check:terms"]],
  ["skin contrast", ["pnpm", "check:contrast"]],
  ["unused files", ["pnpm", "check:unused"]],
];

function parseArgs(argv) {
  const options = { base: "origin/main", list: false, ios: false, report: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") options.base = argv[++i];
    else if (arg === "--list") options.list = true;
    else if (arg === "--ios") options.ios = true;
    else if (arg === "--no-report") options.report = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function writeOkStamp() {
  let common;
  let sha;
  try {
    common = git(["rev-parse", "--git-common-dir"]);
    sha = git(["rev-parse", "HEAD"]);
  } catch {
    return;
  }
  const path = stampPathFor(common, sha);
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `ok ${new Date().toISOString()}\n`);
  console.log(`verify:merge: stamped OK for ${sha.slice(0, 7)} (${path})`);
}

/** Files changed since the merge base with `base`: committed, staged,
 * unstaged and untracked. */
function changedFiles(base) {
  let since = "HEAD";
  try { since = git(["merge-base", "HEAD", base]); } catch { /* no such base: the working tree alone */ }
  const lines = new Set();
  for (const text of [git(["diff", "--name-only", since]), git(["ls-files", "--others", "--exclude-standard"])]) {
    for (const line of text.split("\n")) if (line.trim()) lines.add(line.trim());
  }
  return [...lines].sort();
}

const isElectronTest = (file) => file.endsWith(".node-test.mjs");
const isTest = (file) => /\.(test|e2e\.test)\.[cm]?[jt]sx?$/.test(file) || isElectronTest(file);
const isVitestFile = (file) => /^(evals|server|electron|src|shared|companion|scripts)\//.test(file) && /\.test\.(ts|mjs)$/.test(file) && !isElectronTest(file);

/** The tests beside a changed source: same folder, same stem. */
function siblingTests(file) {
  const dir = join(ROOT, dirname(file));
  if (!existsSync(dir)) return [];
  const stem = basename(file).replace(/\.(tsx?|mjs|js)$/, "");
  return readdirSync(dir)
    .filter((name) => (name.startsWith(`${stem}.`) && /\.test\.(ts|mjs)$/.test(name)) || name === `${stem}.node-test.mjs`)
    .map((name) => relative(ROOT, join(dir, name)).split("\\").join("/"));
}

function plan(options) {
  const changed = changedFiles(options.base);
  const tests = new Set();
  const electronTests = new Set();
  for (const file of changed) {
    if (!existsSync(join(ROOT, file))) continue;
    const candidates = isTest(file) ? [file] : siblingTests(file);
    for (const test of candidates) {
      if (isElectronTest(test)) electronTests.add(test);
      else if (isVitestFile(test)) tests.add(test);
    }
  }
  for (const test of areaTests(changed)) if (existsSync(join(ROOT, test))) tests.add(test);
  const ios = options.ios || changed.some((file) => file.startsWith("ios/") || file.startsWith("shared/"));
  return { changed, tests: [...tests].sort(), electronTests: [...electronTests].sort(), ios };
}

function run(label, command, { cwd = ROOT } = {}) {
  const started = Date.now();
  process.stdout.write(`\n== ${label}\n`);
  const result = spawnSync(command[0], command.slice(1), { cwd, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const ok = result.status === 0;
  process.stdout.write(`${ok ? "ok" : "FAILED"}: ${label} (${seconds}s)\n`);
  return { label, ok, seconds };
}

const REPORT_MARK = "<!-- verify:merge -->";

/** The open pull request of the current branch, through `gh`, or null. */
function pullRequest() {
  const result = spawnSync("gh", ["pr", "view", "--json", "number,headRefOid,url"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

/** Writes the result on the branch's pull request: one comment, updated in
 * place. Never fails the gate: no gh, no PR or no network only prints why. */
function report(outcome) {
  const pr = pullRequest();
  if (!pr) { console.log("verify:merge: no open pull request for this branch, nothing to report"); return; }
  const head = git(["rev-parse", "--short", "HEAD"]);
  const when = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const body = `${REPORT_MARK}\n**verify:merge ${outcome.ok ? "OK" : "FAILED"}** on ${head} (${when}, ${outcome.seconds}s)`
    + (outcome.ok ? `\n\n${outcome.stages.map((r) => `${r.label} ${r.seconds}s`).join(" · ")}` : `\n\nFailed at **${outcome.failed}**; the stages before it passed.`)
    + "\n\nA head commit with no OK here was pushed around the local gate (`pnpm verify:merge`).";
  const api = (method, path, data) => spawnSync("gh", ["api", "-X", method, path, ...(data ? ["-f", `body=${data}`] : [])], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const repo = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout?.trim();
  if (!repo) { console.log("verify:merge: gh cannot name the repository, nothing reported"); return; }
  const listed = api("GET", `repos/${repo}/issues/${pr.number}/comments?per_page=100`);
  let existing = null;
  try { existing = (JSON.parse(listed.stdout || "[]")).find((c) => typeof c.body === "string" && c.body.startsWith(REPORT_MARK)) ?? null; } catch { existing = null; }
  const written = existing
    ? api("PATCH", `repos/${repo}/issues/comments/${existing.id}`, body)
    : api("POST", `repos/${repo}/issues/${pr.number}/comments`, body);
  console.log(written.status === 0 ? `verify:merge: result on ${pr.url}` : `verify:merge: could not write on ${pr.url} (${(written.stderr || "").trim().split("\n")[0]})`);
}

function main() {
  // Before any git call or child process: a pre-push hook exports GIT_DIR and
  // friends; leaving them set lets a test commit into the branch being pushed.
  sanitizeGitEnv(process.env);
  const options = parseArgs(process.argv.slice(2));
  const { changed, tests, electronTests, ios } = plan(options);
  const guards = existingGuardTests(ROOT);
  const diffTests = tests.filter((file) => !guards.includes(file));
  console.log(`verify:merge against ${options.base}: ${changed.length} changed file(s)`);
  console.log(`  light checks: ${LIGHT_CHECKS.map(([label]) => label).join(", ")}`);
  console.log(`  guard tests: ${guards.length}`);
  console.log(`  tests of the diff: ${diffTests.length ? diffTests.join(", ") : "none"}`);
  if (electronTests.length) console.log(`  electron tests: ${electronTests.join(", ")}`);
  console.log(`  iOS: ${ios ? "swift test + simulator build" : "skipped (no ios/ or shared/ change)"}`);
  if (options.list) return;

  const started = Date.now();
  const results = [];
  const stop = (result) => {
    results.push(result);
    if (!result.ok) {
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`\nverify:merge FAILED at "${result.label}" after ${seconds}s`);
      if (options.report) report({ ok: false, failed: result.label, seconds, stages: results });
      process.exit(1);
    }
  };
  for (const [label, command] of LIGHT_CHECKS) stop(run(label, command));
  // a source scan (data-keys, dialogs-close) reads the whole tree: under
  // load (the full suite beside it) 20 s is not enough, 60 s is
  const vitest = [process.execPath, VITEST, "run", "--reporter=dot", "--testTimeout=60000"];
  stop(run(`guard tests (${guards.length} files)`, [...vitest, ...guards]));
  if (diffTests.length) stop(run(`tests of the diff (${diffTests.length} files)`, [...vitest, ...diffTests]));
  for (const test of electronTests) stop(run(`electron ${test}`, [process.execPath, "--test", test]));
  if (ios) {
    const iosDir = join(ROOT, "ios");
    stop(run("swift test (CompanionCore)", ["swift", "test"], { cwd: iosDir }));
    if (spawnSync("xcodegen", ["--version"], { stdio: "ignore" }).status === 0 && spawnSync("xcodebuild", ["-version"], { stdio: "ignore" }).status === 0) {
      stop(run("xcodegen generate", ["xcodegen", "generate"], { cwd: iosDir }));
      stop(run("iOS build (Sagax scheme, generic simulator)", ["xcodebuild", "-project", "Sagax.xcodeproj", "-scheme", "Sagax", "-sdk", "iphonesimulator",
        "-destination", "generic/platform=iOS Simulator", "-quiet", "CODE_SIGNING_ALLOWED=NO", "build"], { cwd: iosDir }));
    } else {
      console.log("\n== iOS build: skipped, xcodegen or xcodebuild is not installed (swift test ran)");
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nverify:merge OK in ${seconds}s: ${results.map((r) => `${r.label} ${r.seconds}s`).join("; ")}`);
  writeOkStamp();
  if (options.report) report({ ok: true, seconds, stages: results });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
