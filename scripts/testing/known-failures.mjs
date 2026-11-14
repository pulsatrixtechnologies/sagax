// The known-failures list (known-failures.json): the tests that fail on main
// today. A CI run is green when every failure it sees is in that list, and the
// list can only shrink. A failure that is not listed and is seen in two runs
// opens one `regression` issue per test, named after the pull request that
// scripts/stability/bisect.mjs finds; when more than a handful are due in one
// run, one issue for the run lists them all (#4037). Later runs on main tick
// the tests that pass again and close an issue whose tests all pass. Red Swift package tests on main (the
// swift-package job after a merge, the nightly's ios job) open one
// `regression` issue at the first sighting, or comment on the open one: a
// package that does not compile is not a flaky test (#3678). Nothing here
// blocks a merge: it runs after the merge, in ci.yml. docs/ci.md, "Known
// failures".
//
//   extract       one test job: vitest's JSON report to this job's results
//   report        all test jobs: the verdict, the summary, the shrunk list
//   check-shrink  the list at a git revision against the working copy
//   open-issues   the regression issues whose tests pass again: ticked or
//                 closed; the failures seen twice: bisect, then one issue
//                 each, or one for the run; and the red Swift package tests:
//                 one issue, or a comment
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { neverStarted, SWIFT_AFTER_MERGE } from "../release-ci.mjs";
import { GUARD_TESTS } from "../verify/release/guard-tests.mjs";

/** The test name of a failure that belongs to the whole file (it did not load, or a hook failed). */
export const WHOLE_FILE = "(whole file)";
/** A job's vitest run itself: it fails when vitest exits non-zero with no
 * failing test (an unhandled error, a crashed worker) and passes otherwise,
 * so its issue can turn green like any test's (#4052). */
export const VITEST_RUN = { file: "(vitest run)", test: "exited non-zero with no failing test" };
export const LIST_PATH = "scripts/testing/known-failures.json";
const DEFAULT_LIST = join(dirname(fileURLToPath(import.meta.url)), "known-failures.json");
const REGRESSION_LABEL = "regression";

/** @typedef {{ file: string, test: string }} Identity */
/** `os` is the runner of the job that saw it (report adds it from the job's results file name). */
/** `message` is the first lines of a failure's first error, for the issue. */
/** @typedef {Identity & { state: "pass" | "fail", os?: string, message?: string }} Result */
/** `platforms` are the runners the test fails on (#3569): a failure on a
 * runner it does not name is a new failure. An entry without it (a list from
 * before #3569) fails on every platform. */
/** @typedef {Identity & { platforms?: string[], owner: string, reason: string, since: string }} Entry */
/** @typedef {{ $comment?: string, seeded?: string, tests: Entry[] }} List */

/** @param {Identity} identity */
export const identityKey = ({ file, test }) => `${file} > ${test}`;
const strip = ({ file, test }) => ({ file, test });

/** @returns {List} */
export function loadKnownFailures(path = DEFAULT_LIST) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** One test job's results from vitest's JSON report (`--reporter=json`).
 * Paths become relative to `root` with forward slashes, so Windows and Linux
 * jobs name a test the same way. A non-zero exit with no failing test (an
 * unhandled error, a crashed worker) is a failure of its own (VITEST_RUN),
 * and every other job passes it.
 * @returns {Result[]} */
export function extractResults(report, root, exitCode) {
  /** @type {Result[]} */
  const results = [];
  for (const file of report?.testResults ?? []) {
    const path = relative(root, file.name).split(sep).join("/").replace(/\\/g, "/");
    let failedTests = 0;
    for (const assertion of file.assertionResults ?? []) {
      const state = assertion.status === "passed" ? "pass" : assertion.status === "failed" ? "fail" : null;
      if (!state) continue;
      if (state === "fail") failedTests += 1;
      results.push({ file: path, test: [...(assertion.ancestorTitles ?? []), assertion.title].join(" > "), state, ...failureMessage(state, assertion.failureMessages?.[0]) });
    }
    const fileFailed = file.status === "failed" && failedTests === 0;
    results.push({ file: path, test: WHOLE_FILE, state: fileFailed ? "fail" : "pass", ...failureMessage(fileFailed ? "fail" : "pass", file.message) });
  }
  const crashed = Number(exitCode) !== 0 && !results.some((result) => result.state === "fail");
  results.push(crashed ? { ...VITEST_RUN, state: "fail", message: `vitest exited with code ${exitCode}` } : { ...VITEST_RUN, state: "pass" });
  return results;
}

/** The first lines of a failure's error, short enough for an issue. */
function failureMessage(state, text) {
  if (state !== "fail") return {};
  const lines = stripVTControlCharacters(String(text ?? "")).split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const message = lines.slice(0, 3).join("\n");
  if (!message) return {};
  return { message: message.length > 300 ? `${message.slice(0, 300)}...` : message };
}

/** The runners an entry is listed for: its own, or every platform for an
 * entry from before #3569. @param {Entry} entry @returns {string[]} */
export const entryPlatforms = (entry) => (Array.isArray(entry.platforms) && entry.platforms.length ? entry.platforms : EVERY_PLATFORM);

/** Whether `entry` lists its test as failing on runner `os`: an entry from
 * before #3569, or a row without a runner, matches any. */
const listedOn = (entry, os) => !os || !Array.isArray(entry.platforms) || !entry.platforms.length || entry.platforms.includes(os);

/** A run against the list, runner by runner (#3569). A failure is listed only
 * on a runner its entry names: the same test failing on another runner is a
 * new failure. A listed test that passed on one of its runners, and failed on
 * none of them in this run, is fixed there: `fixed` holds those entries, each
 * with `passedOn`, the runners it leaves (shrink). A row without `os` stands
 * for each runner of the entry.
 * @param {Entry[]} list @param {Result[]} results */
export function classify(list, results) {
  const byKey = new Map(list.map((entry) => [identityKey(entry), entry]));
  const failedOn = new Map();
  const passedOn = new Map();
  const newFailures = new Map();
  const stillFailing = new Set();
  const add = (map, key, runners) => map.set(key, new Set([...(map.get(key) ?? []), ...runners]));
  for (const result of results) {
    const key = identityKey(result);
    const entry = byKey.get(key);
    const runners = result.os ? [result.os] : entry ? entryPlatforms(entry) : [];
    if (result.state === "fail") {
      add(failedOn, key, runners);
      if (entry && listedOn(entry, result.os)) stillFailing.add(key);
      else newFailures.set(key, strip(result));
    } else add(passedOn, key, runners);
  }
  return {
    newFailures: [...newFailures.values()],
    listedFailing: list.filter((entry) => stillFailing.has(identityKey(entry))),
    fixed: list.flatMap((entry) => {
      const key = identityKey(entry);
      const left = entryPlatforms(entry).filter((os) => passedOn.get(key)?.has(os) && !failedOn.get(key)?.has(os));
      return left.length ? [{ ...entry, passedOn: left }] : [];
    }),
  };
}

/** The runners of a run that covers every platform (scripts/ci-scope.mjs). */
export const EVERY_PLATFORM = ["macos-latest", "ubuntu-latest", "windows-latest"];

/** Whether a run's vitest jobs ran on every platform. A push to main runs
 * Linux only, so a listed test that fails only on Windows or macOS passes
 * there: only a run on every platform may drop an entry.
 * @param {string[] | null | undefined} platforms */
export const coversEveryPlatform = (platforms) => EVERY_PLATFORM.every((os) => (platforms ?? []).includes(os));

/** The files of `results` that ran on each of `platforms`: a file that ran
 * writes at least its whole-file row in every job that ran it. A test job that
 * got no runner sends no results, so its files did not run on that platform
 * (#3672). A row without `os` counts for every platform.
 * @param {Result[]} results @param {string[]} platforms @returns {Set<string>} */
export function filesRunOn(results, platforms) {
  const seen = new Map();
  for (const result of results) {
    const runners = seen.get(result.file) ?? new Set();
    for (const os of result.os ? [result.os] : platforms) runners.add(os);
    seen.set(result.file, runners);
  }
  return new Set([...seen].filter(([, runners]) => platforms.every((os) => runners.has(os))).map(([file]) => file));
}

/** The runner a results file belongs to: ci.yml names it `<os>-<shard>.json`. */
export const platformOfResults = (name) => basename(String(name)).replace(/\.json$/, "").replace(/-\d+$/, "");

/** The vitest jobs of a run that never got a runner: no step ran and they
 * sent no results (GitHub's "not acquired by Runner", #3672). `jobs` are the
 * run's jobs from the Actions API ({ name, conclusion, steps }), `sent` the
 * `<os>-<shard>` names of the results files. "No step ran" is the release
 * gate's own rule, `neverStarted` in scripts/release-ci.mjs.
 * @returns {{ os: string, shard: number }[]} */
export function jobsWithoutRunner(jobs, sent) {
  const received = new Set(sent);
  return (jobs ?? []).flatMap((job) => {
    const match = /^vitest \((.+), shard (\d+)\/\d+\)$/.exec(String(job?.name ?? ""));
    if (!match || job.conclusion === "skipped" || !neverStarted(job) || received.has(`${match[1]}-${match[2]}`)) return [];
    return [{ os: match[1], shard: Number(match[2]) }];
  }).sort((a, b) => a.os.localeCompare(b.os) || a.shard - b.shard);
}

/** The list without the runners each fixed entry passed on (classify's
 * `passedOn`, every runner of the entry when absent); an entry left with no
 * runner leaves the list. @param {List} list @param {(Entry & { passedOn?: string[] })[]} fixed @returns {List} */
export function shrink(list, fixed) {
  const passed = new Map(fixed.map((entry) => [identityKey(entry), new Set(entry.passedOn ?? entryPlatforms(entry))]));
  return {
    ...list,
    tests: list.tests.flatMap((entry) => {
      const gone = passed.get(identityKey(entry));
      if (!gone) return [entry];
      const platforms = entryPlatforms(entry).filter((os) => !gone.has(os));
      return platforms.length ? [{ ...entry, platforms }] : [];
    }),
  };
}

/** The first fill: every failure of one run, once, with the runners it
 * failed on (a row without `os` fails on every platform).
 * @param {List} list @param {(Identity & { os?: string })[]} failures */
export function seedList(list, failures, { runUrl, since }) {
  const seen = new Map();
  for (const failure of failures) {
    const key = identityKey(failure);
    const runners = seen.get(key)?.runners ?? new Set();
    for (const os of failure.os ? [failure.os] : EVERY_PLATFORM) runners.add(os);
    seen.set(key, { file: failure.file, test: failure.test, runners });
  }
  return {
    ...list,
    seeded: runUrl,
    tests: [...seen.values()].map(({ file, test, runners }) => ({ file, test, platforms: [...runners].sort(), owner: "unassigned", reason: `Failing when the list was first filled by ${runUrl}.`, since })),
  };
}

/** Errors when `head` holds an entry `base` did not. The one exception is the
 * first fill: a base never seeded, a head that carries `seeded`.
 * @param {List | null} base @param {List | null} head */
export function onlyShrinks(base, head) {
  if (!head) return [`${LIST_PATH} was removed`];
  if (!base) return [];
  if (!base.seeded && head.seeded) return [];
  const known = new Map(base.tests.map((entry) => [identityKey(entry), new Set(entryPlatforms(entry))]));
  return head.tests.flatMap((entry) => {
    const was = known.get(identityKey(entry));
    if (!was) return [`${identityKey(entry)} was added to ${LIST_PATH}; the list can only shrink`];
    // A runner added to an entry hides a failure there: growth too (#3569).
    const added = entryPlatforms(entry).filter((os) => !was.has(os));
    return added.length ? [`${identityKey(entry)} gained ${added.join(", ")} in ${LIST_PATH}; the list can only shrink`] : [];
  });
}

/** The folders whose every test keeps a guard rail (#3569): the safety
 * checks (sensitive paths, moderation) pass where their case exists and say
 * where it cannot with a skip that names the reason. */
export const GUARD_FOLDERS = ["server/safety/"];

/** Errors for each entry naming a file of the guard tests list
 * (scripts/verify/release/guard-tests.mjs, #3558) or a file under
 * GUARD_FOLDERS: a guard test keeps a rule on every platform, so it is fixed,
 * never listed.
 * @param {List} list @param {readonly string[]} guards @param {readonly string[]} folders */
export function listedGuardTests(list, guards = GUARD_TESTS, folders = GUARD_FOLDERS) {
  const guard = new Set(guards);
  const guarded = (file) => guard.has(file) || folders.some((folder) => file.startsWith(folder));
  return list.tests.filter((entry) => guarded(entry.file)).map((entry) => `${identityKey(entry)} is a guard test: fix it, never list it in ${LIST_PATH}`);
}

/** Sightings of unlisted failures across main's runs. A failure is due for an
 * issue the second time it is seen, on a second commit: another run on the
 * same commit does not add to the count. A test that passes is forgotten only
 * by a run on every platform (`platforms`, as for shrink): a push runs Linux
 * only, and a test that fails only on Windows or macOS passes there. On fewer
 * platforms, and for a test that did not run, the count stays. `good` is the
 * commit of the run before the first sighting, where bisect starts. */
export function updateSightings(previous, { newFailures, results, sha, platforms, openIssues }) {
  const tests = { ...previous?.tests };
  if (coversEveryPlatform(platforms)) {
    // A file that did not run on a platform (its job got no runner) is not
    // known to pass there: its sightings stay (#3672). The rule is isGreen's
    // with no runner on record.
    const ranEverywhere = filesRunOn(results ?? [], platforms);
    for (const item of indexRun(results, platforms).values()) {
      if (isGreen(item, { platforms, ranEverywhere })) delete tests[identityKey(item)];
    }
  }
  const failingOs = new Map();
  for (const result of results ?? []) {
    if (result.state === "fail" && result.os) failingOs.set(identityKey(result), [...(failingOs.get(identityKey(result)) ?? []), result.os]);
  }
  for (const failure of newFailures) {
    const key = identityKey(failure);
    const recorded = tests[key];
    // A sighting whose issue was closed counts again from this run: a test
    // that fails after its issue closed gets a new one when seen twice
    // more, not silence for good (#3672). `openIssues` unknown: kept as is.
    const known = recorded?.issue && openIssues && !openIssues.has(recorded.issue) ? null : recorded;
    // The runners it failed on: a later run closes its issue only when the
    // test passed on each of them (updateRegressionIssues).
    const failedOn = [...new Set([...(known?.failedOn ?? []), ...(failingOs.get(key) ?? [])])].sort();
    tests[key] = {
      ...(known
        ? { ...known, count: known.count + (known.lastSha === sha ? 0 : 1), lastSha: sha }
        : { file: failure.file, test: failure.test, count: 1, firstSha: sha, lastSha: sha, good: previous?.lastSha ?? null, issue: null }),
      ...(failedOn.length ? { failedOn } : {}),
    };
  }
  const due = Object.values(tests).filter((entry) => entry.count >= 2 && !entry.issue && newFailures.some((failure) => identityKey(failure) === identityKey(entry)));
  return { sightings: { lastSha: sha, tests }, due };
}

/** The hidden line that ties an issue to its test, so a test never gets two. */
export const regressionMarker = (identity) => markerOfKey(identityKey(identity));
const markerOfKey = (key) => `<!-- known-failures: ${key.replace(/--/g, "- -")} -->`;

/** The jobs of ci.yml that run `swift test --package-path ios`, and their step that does. */
export const SWIFT_JOBS = [SWIFT_AFTER_MERGE, "Swift tests + iOS build"];
export const SWIFT_STEP = "Swift package tests";

/** What a run's jobs (the Actions API's { name, conclusion, steps: [{ name,
 * status, conclusion }] }) say of its Swift package tests: null when no Swift
 * job ran, "no-runner" when its job never started a step (`neverStarted`, the
 * release gate's rule: GitHub's capacity, not a failure, #3672), "not-run"
 * when the job stopped before the test step, else "pass" or "fail". A step
 * that timed out or was cancelled is a failure.
 * @returns {{ state: "no-runner" | "not-run" | "pass" | "fail", job: string } | null} */
export function swiftOutcome(jobs) {
  const job = (jobs ?? []).find((item) => SWIFT_JOBS.includes(String(item?.name)) && item.conclusion !== "skipped");
  if (!job) return null;
  if (neverStarted(job)) return { state: "no-runner", job: job.name };
  const step = (job.steps ?? []).find((item) => item?.name === SWIFT_STEP);
  if (!step || step.conclusion == null || step.conclusion === "skipped") return { state: "not-run", job: job.name };
  return { state: step.conclusion === "success" ? "pass" : "fail", job: job.name };
}

/** The failing test cases of a `swift test` log (XCTest's "Test Case
 * '-[Module.Class test]' failed", swift-testing's "✘ Test name failed"), and
 * the first error lines, which name a build failure when no test case ran.
 * Paths are cut to the repository (from ios/, shared/ or src/ on).
 * @returns {{ tests: string[], errors: string[] }} */
export function failingSwiftTests(log) {
  const lines = stripVTControlCharacters(String(log ?? "")).split(/\r?\n/);
  const tests = new Set();
  const errors = [];
  for (const line of lines) {
    const xctest = /^Test Case '(?:-\[)?([^'\]]+?)\]?' failed/.exec(line);
    const testing = /^\s*✘ Test (.+?) (?:failed|recorded an issue)/.exec(line);
    if (xctest) tests.add(xctest[1].replace(" ", "."));
    else if (testing) tests.add(testing[1]);
    if (/(?:^|: )error: /.test(line) && errors.length < 20) {
      const cut = line.replace(/\/\S*?\/(?=(?:ios|shared|src)\/)/g, "");
      errors.push(cut.length > 400 ? `${cut.slice(0, 400)}...` : cut);
    }
  }
  return { tests: [...tests], errors };
}

/** How many times a GitHub call is sent before its error stands, and the
 * wait before each new try (#4315). */
const GITHUB_ATTEMPTS = 3;
const GITHUB_RETRY_MS = 1_000;

/** One GitHub API call. Each call opens its own connection (`connection:
 * close`): bisect runs synchronously between two calls and blocks the event
 * loop for a minute or more, so a kept-alive socket from the call before it
 * was closed by GitHub in the meantime, and the next request went out on it
 * and died with "other side closed" (#4315). A network error or a 5xx answer
 * is tried again, GITHUB_ATTEMPTS times in all, after a short wait. */
export async function github(fetchImpl, apiUrl, token, method, path, body, { attempts = GITHUB_ATTEMPTS, retryMs = GITHUB_RETRY_MS } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", connection: "close" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
      continue;
    }
    if (response.status >= 500 && attempt < attempts) {
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
      continue;
    }
    return { status: response.status, json: await response.json().catch(() => null) };
  }
}

/** The time all bisects of one run may take together. ci.yml gives the
 * known-failures job 45 minutes; the rest of the job needs about ten, and the
 * sightings must still be uploaded after the issues are opened. */
export const BISECT_BUDGET_MS = 25 * 60_000;

/** The open issues labelled `regression`. */
export async function listOpenRegressionIssues({ repo, token, fetch: fetchImpl = fetch, apiUrl = "https://api.github.com" }) {
  const open = [];
  for (let page = 1; page <= 10; page += 1) {
    const { status, json } = await github(fetchImpl, apiUrl, token, "GET", `/repos/${repo}/issues?labels=${REGRESSION_LABEL}&state=open&per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json)) throw new Error(`HTTP ${status} listing the open regression issues`);
    open.push(...json);
    if (json.length < 100) break;
  }
  return open;
}

/** Above this many tests due in one run, they open one issue for the run
 * instead of one each: a single cause that breaks a whole suite opened 294
 * issues in one night (#4037). */
export const GROUP_ABOVE = 5;

/** The hidden line of an issue that lists a run's failing tests. */
export const RUN_MARKER = "<!-- known-failures-run -->";

/** GitHub refuses an issue body above 65536 characters. */
const BODY_LIMIT = 60_000;

/** One issue per due failure, labelled `regression`; an open issue that
 * already carries the test's marker is reused. More than GROUP_ABOVE new ones
 * in one run open one issue for the run (openRunIssue). `bisect(entry, {
 * deadline })` returns what scripts/stability/bisect.mjs found, or null.
 * Bisect runs the whole file, so it runs once per file for all of that file's
 * tests. Once `budgetMs` is spent, the remaining issues still open, without
 * the pull request, each with the command that finds it. `results` are the
 * run's results, for the first failing assertion of each file. */
export async function openRegressionIssues(due, { repo, token, fetch: fetchImpl = fetch, runUrl, apiUrl = "https://api.github.com", bisect, budgetMs = BISECT_BUDGET_MS, now = Date.now, open: listed, results = [] }) {
  if (due.length === 0) return [];
  const deadline = now() + budgetMs;
  const byFile = new Map();
  const bisectOnce = (entry) => {
    if (entry.file.startsWith("(")) return null;
    if (byFile.has(entry.file)) return byFile.get(entry.file);
    const found = now() < deadline
      ? bisect(entry, { deadline })
      : { verdict: "out-of-time", runs: 0, detail: `the ${Math.round(budgetMs / 60_000)} minutes for bisect in this run were spent.` };
    byFile.set(entry.file, found);
    return found;
  };
  const open = listed ?? await listOpenRegressionIssues({ repo, token, fetch: fetchImpl, apiUrl });
  await ensureRegressionLabel(fetchImpl, apiUrl, token, repo);
  const opened = [];
  const fresh = [];
  for (const entry of due) {
    const marker = regressionMarker(entry);
    const existing = open.find((issue) => String(issue.body ?? "").includes(marker));
    if (existing) opened.push({ key: identityKey(entry), issue: existing.number, created: false });
    else fresh.push(entry);
  }
  if (fresh.length > GROUP_ABOVE) {
    const { title, body } = runIssueText(fresh, { runUrl, results, bisectOnce });
    const { status, json } = await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/issues`, { title, body, labels: [REGRESSION_LABEL] });
    if (status !== 201 || typeof json?.number !== "number") throw new Error(`HTTP ${status} opening the issue for ${fresh.length} failing tests`);
    return [...opened, ...fresh.map((entry) => ({ key: identityKey(entry), issue: json.number, created: true }))];
  }
  for (const entry of fresh) {
    const found = bisectOnce(entry);
    const culprit = found?.verdict === "found" && found.pullRequest ? ` (broken by #${found.pullRequest})` : "";
    const body = [
      `\`${entry.file}\` > ${entry.test}`,
      "",
      `Failed in two runs of CI on main after a merge (first seen on ${entry.firstSha}, again on ${entry.lastSha}) and is not in \`${LIST_PATH}\`.`,
      "",
      bisectLine(found, entry),
      "",
      `Run: ${runUrl}`,
      "",
      "Fix the test or the change that broke it. This issue does not block a merge.",
      "",
      regressionMarker(entry),
    ].join("\n");
    const { status, json } = await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/issues`, { title: `Regression: ${identityKey(entry)}${culprit}`, body, labels: [REGRESSION_LABEL] });
    if (status !== 201 || typeof json?.number !== "number") throw new Error(`HTTP ${status} opening the issue for ${identityKey(entry)}`);
    opened.push({ key: identityKey(entry), issue: json.number, created: true });
  }
  return opened;
}

const inline = (text) => String(text ?? "").replace(/`/g, "'").replace(/\n/g, " ");

/** The issue of a run whose many tests failed together: its commit, the
 * tests grouped by file (most failures first) as a checklist that later runs
 * tick, and the first failing assertion of each file. Bisect runs once, on
 * the file with the most failures. A file whose block does not fit under
 * GitHub's body limit keeps one line with its count; its tests stay tied to
 * this issue by the sightings, and the issue closes only once they pass too
 * (planRegressionUpdates, #4052). */
export function runIssueText(entries, { runUrl, results = [], bisectOnce = () => null }) {
  const files = [...Map.groupBy(entries, (entry) => entry.file)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const firstMessage = new Map();
  for (const result of results) {
    if (result.state === "fail" && result.message && !firstMessage.has(result.file)) firstMessage.set(result.file, result.message);
  }
  const sha = entries[0].lastSha;
  const found = bisectOnce(files[0][1][0]);
  const culprit = found?.verdict === "found" && found.pullRequest ? ` (broken by #${found.pullRequest})` : "";
  const head = [
    `${entries.length} tests in ${files.length} files failed in two runs of CI on main after a merge and are not in \`${LIST_PATH}\`. They failed together, so this one issue tracks them all instead of one issue per test.`,
    "",
    `Commit: ${sha} (first seen on ${entries[0].firstSha})`,
    `Run: ${runUrl}`,
    "",
    bisectLine(found, files[0][1][0]),
    "",
  ];
  const tail = [
    "",
    "Later runs on main tick a test that passes again and untick one that fails again; the issue closes once every test of the run passes again, listed here or not. Fix the tests or the change that broke them. This issue does not block a merge.",
    "",
    RUN_MARKER,
  ];
  const blocks = [];
  let size = [...head, ...tail].join("\n").length;
  const left = [];
  for (const [file, tests] of files) {
    const message = firstMessage.get(file);
    const block = [
      `### \`${file}\` (${tests.length})`,
      ...(message ? ["", "First failing assertion:", "", "~~~text", message.replace(/~~~/g, "~ ~ ~"), "~~~"] : []),
      "",
      ...tests.map((entry) => `- [ ] \`${inline(entry.test)}\` ${regressionMarker(entry)}`),
      "",
    ].join("\n");
    if (size + block.length > BODY_LIMIT) {
      left.push([file, tests.length]);
      continue;
    }
    size += block.length + 1;
    blocks.push(block);
  }
  // Each file left out keeps its count while the lines fit; the rest are
  // counted together. GitHub's own limit leaves room for these lines.
  const more = [];
  let rest = 0;
  for (const [file, count] of left) {
    const line = `- \`${inline(file)}\`: ${count} failing test${count === 1 ? "" : "s"} not listed (GitHub limits an issue's length); see the run.`;
    if (size + line.length + 1 > BODY_LIMIT) rest += count;
    else {
      size += line.length + 1;
      more.push(line);
    }
  }
  if (rest) more.push(`- ${rest} more failing tests in other files, not listed; see the run.`);
  if (more.length) more.push("");
  return {
    title: `Regression: ${entries.length} tests failing on main at ${String(sha).slice(0, 7)}${culprit}`,
    body: [...head, ...blocks, ...more, ...tail].join("\n"),
  };
}

/** Each test of a run, by `identityKey`: whether it failed in any job, and
 * the runners it passed on (a row with no `os` passed on every `platforms`). */
export function indexRun(results, platforms = []) {
  const index = new Map();
  for (const result of results ?? []) {
    const key = identityKey(result);
    const item = index.get(key) ?? { file: result.file, test: result.test, failed: false, passedOn: new Set() };
    if (result.state === "fail") item.failed = true;
    else if (result.state === "pass") for (const os of result.os ? [result.os] : platforms) item.passedOn.add(os);
    index.set(key, item);
  }
  return index;
}

/** The one rule for "this run passed the test" (#4052), for the rail
 * (updateSightings, planRegressionUpdates) and the close by hand
 * (close-green-regressions.mjs). `item` is indexRun's. It must have passed
 * and failed in no job. With the runners it failed on (the sighting's
 * `failedOn`), it must have passed on each of them. With none on record, the
 * run must cover every platform and its file must have run on each: a test
 * that runs on one platform only (skipped elsewhere) is green from where it
 * ran, and a push that runs Linux only closes nothing seen on Windows.
 * @param {{ file: string, failed: boolean, passedOn: Set<string> } | undefined} item
 * @param {{ failedOn?: string[], platforms?: string[], ranEverywhere: Set<string> }} context */
export function isGreen(item, { failedOn, platforms, ranEverywhere }) {
  if (!item || item.failed || item.passedOn.size === 0) return false;
  if (failedOn?.length) return failedOn.every((os) => item.passedOn.has(os));
  return coversEveryPlatform(platforms) && ranEverywhere.has(item.file);
}

/** The runners a sighting failed on, for a sighting recorded before the
 * sightings kept them (#4102): without them, isGreen asks for a run whose
 * jobs all ran its file on every platform, which a run with one cancelled
 * macOS shard never gives, so its issue never closed. `runsAt(sha)` gives the
 * CI runs of main at a commit, each `{ platforms, failing }`: `failing` maps
 * a test's identityKey to the runners it failed on in that run (its results),
 * or is null when they are not at hand; a run on one platform then names that
 * platform. A sighting that keeps its runners, or whose runs say nothing, is
 * left as it is. */
export function recoverFailedOn(sightings, runsAt) {
  if (!sightings?.tests) return sightings;
  const tests = {};
  for (const [key, entry] of Object.entries(sightings.tests)) {
    if (entry?.failedOn?.length) {
      tests[key] = entry;
      continue;
    }
    const runners = new Set();
    for (const sha of new Set([entry?.firstSha, entry?.lastSha].filter(Boolean))) {
      for (const run of runsAt(sha) ?? []) {
        if (run.failing) for (const os of run.failing.get(key) ?? []) runners.add(os);
        else if (run.platforms?.length === 1) runners.add(run.platforms[0]);
      }
    }
    tests[key] = runners.size ? { ...entry, failedOn: [...runners].sort() } : entry;
  }
  return { ...sightings, tests };
}

const CHECK_LINE = /^- \[( |x)\] .*(<!-- known-failures: .*? -->)\s*$/;
const MARKER = /<!-- known-failures: .*? -->/g;

/** The test a marker names, as written (a `--` in it reads `- -`). */
export const markerTest = (marker) => {
  const key = marker.replace(/^<!-- known-failures: /, "").replace(/ -->$/, "");
  const at = key.indexOf(" > ");
  return at < 0 ? { file: key, test: "" } : { file: key.slice(0, at), test: key.slice(at + 3) };
};

/** The markers of an open regression issue's tests: those in its body and
 * those of the sightings tied to it. */
export function issueMarkers(issue, sightings) {
  const markers = new Set([...String(issue.body ?? "").matchAll(MARKER)].map((match) => match[0]));
  for (const [key, entry] of Object.entries(sightings?.tests ?? {})) if (entry?.issue === issue.number) markers.add(markerOfKey(key));
  return markers;
}

/** What a run on main does to each open regression issue (#4037, #4052),
 * shared by the rail and the close by hand. An issue's tests are the markers
 * in its body and the sightings tied to it (`issue`), so a test a run's issue
 * could not list still counts. Each is done when it is green in this run
 * (isGreen), or when its checklist line was ticked by an earlier run and it
 * did not fail in this one. A run's issue gets its lines ticked or unticked
 * (`body`, null when unchanged). An issue closes when it has a test and every
 * test is done; `reason` says why one stays: "other" (no test of the rail),
 * "fail" (a test failed in this run) or "not-green" (a test did not run, or
 * not on each runner it failed on).
 * The Swift package tests' marker (SWIFT_IDENTITY) is done when `swift`,
 * swiftOutcome's state for this run, is "pass", and failed when it is "fail"
 * (#4102). `gone` maps the marker of a test that no longer exists on main to
 * the commit that removed or renamed it: such a test is done, and the plan
 * lists it in `gone` for the closing comment.
 * @returns {{ number: number, title?: string, body: string | null, ticked: number, close: boolean, gone?: { test: string, commit: string }[], reason?: "other" | "fail" | "not-green" }[]} */
export function planRegressionUpdates(open, { results, platforms = [], sightings, swift = null, gone = new Map() }) {
  const index = indexRun(results, platforms);
  const ranEverywhere = filesRunOn(results ?? [], platforms ?? []);
  const recorded = sightings?.tests ?? {};
  const byMarker = new Map([...index.values()].map((item) => [regressionMarker(item), item]));
  const swiftMarker = regressionMarker(SWIFT_IDENTITY);
  if (swift === "fail") byMarker.set(swiftMarker, { ...SWIFT_IDENTITY, failed: true, passedOn: new Set() });
  const failedOn = new Map(Object.entries(recorded).map(([key, entry]) => [markerOfKey(key), entry?.failedOn]));
  // One `swift test` job covers the package: its own step says pass or fail.
  const green = (marker) => marker === swiftMarker ? swift === "pass" : isGreen(byMarker.get(marker), { failedOn: failedOn.get(marker), platforms, ranEverywhere });
  const plans = [];
  for (const issue of open ?? []) {
    if (issue.pull_request) continue;
    const body = String(issue.body ?? "");
    const ticks = new Map();
    let ticked = 0;
    const next = !body.includes(RUN_MARKER) ? body : body.split("\n").map((line) => {
      const match = CHECK_LINE.exec(line);
      if (!match) return line;
      let mark = match[1];
      if (green(match[2])) mark = "x";
      else if (byMarker.get(match[2])?.failed) mark = " ";
      if (mark === "x" && match[1] !== "x") ticked += 1;
      ticks.set(match[2], mark === "x");
      return mark === match[1] ? line : line.replace(/^- \[( |x)\]/, `- [${mark}]`);
    }).join("\n");
    const markers = issueMarkers(issue, sightings);
    // A tied test the body does not list, green now, counts as passing again.
    for (const marker of markers) if (!ticks.has(marker) && body.includes(RUN_MARKER) && green(marker)) ticked += 1;
    // A test that ran in this run is judged by it; only one that did not can be gone.
    const removed = (marker) => !byMarker.has(marker) && gone.has(marker);
    const done = (marker) => green(marker) || removed(marker) || (ticks.get(marker) === true && !byMarker.get(marker)?.failed);
    const close = markers.size > 0 && [...markers].every(done);
    const reason = close ? undefined : markers.size === 0 ? "other" : [...markers].some((marker) => byMarker.get(marker)?.failed) ? "fail" : "not-green";
    const goneTests = close ? [...markers].filter(removed).map((marker) => ({ test: identityKey(markerTest(marker)), commit: gone.get(marker) })) : [];
    plans.push({ number: issue.number, title: issue.title, body: next === body ? null : next, ticked: body.includes(RUN_MARKER) ? ticked : close ? markers.size : 0, close, ...(goneTests.length ? { gone: goneTests } : {}), ...(reason ? { reason } : {}) });
  }
  return plans;
}

/** The comment that closes a regression issue, with the green run as evidence. */
export const greenEvidence = ({ runUrl, sha }) =>
  `Passes on main in ${runUrl}${sha ? ` (commit ${sha})` : ""}, so this regression issue is closed. A new failure of the test opens a new one.`;

/** The comment that closes a regression issue from a plan: the green run, and
 * each test that no longer exists with the commit that removed or renamed it. */
export function closingEvidence({ runUrl, sha, gone = [], tests = 0 }) {
  if (!gone.length) return greenEvidence({ runUrl, sha });
  const lines = gone.map((item) => `- \`${inline(item.test)}\`: removed or renamed in commit ${item.commit}`);
  const rest = tests > gone.length ? ` Its other tests pass on main in ${runUrl}${sha ? ` (commit ${sha})` : ""}.` : "";
  return [`Test no longer exists on main, so this regression issue is closed.${rest}`, "", ...lines].join("\n");
}

/** The open regression issues whose tests passed in this run on main
 * (#4037), as planRegressionUpdates decides: a run's issue gets its lines
 * ticked or unticked, and an issue closes, with the run as evidence, once
 * every test tied to it is green. A test that did not run leaves its line as
 * it is.
 * @returns {Promise<{ issue: number, ticked: number, closed: boolean }[]>} */
export async function updateRegressionIssues(open, { results, platforms, sightings, swift = null, runUrl, sha, repo, token, fetch: fetchImpl = fetch, apiUrl = "https://api.github.com" }) {
  const close = async (number) => {
    const comment = await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/issues/${number}/comments`, { body: greenEvidence({ runUrl, sha }) });
    if (comment.status !== 201) throw new Error(`HTTP ${comment.status} commenting on #${number}`);
    const closed = await github(fetchImpl, apiUrl, token, "PATCH", `/repos/${repo}/issues/${number}`, { state: "closed", state_reason: "completed" });
    if (closed.status !== 200) throw new Error(`HTTP ${closed.status} closing #${number}`);
  };
  const updates = [];
  for (const plan of planRegressionUpdates(open, { results, platforms, sightings, swift })) {
    if (plan.body !== null) {
      const { status } = await github(fetchImpl, apiUrl, token, "PATCH", `/repos/${repo}/issues/${plan.number}`, { body: plan.body });
      if (status !== 200) throw new Error(`HTTP ${status} updating #${plan.number}`);
    }
    if (plan.close) await close(plan.number);
    if (plan.body !== null || plan.close) updates.push({ issue: plan.number, ticked: plan.ticked, closed: plan.close });
  }
  return updates;
}

const ensureRegressionLabel = (fetchImpl, apiUrl, token, repo) =>
  github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/labels`, { name: REGRESSION_LABEL, color: "b60205", description: "A test that passed on main fails after a merge" });

/** The one identity of the Swift package tests' issue, for its marker. */
export const SWIFT_IDENTITY = { file: "ios/Package.swift", test: "swift test" };

/** Red Swift package tests on main: one `regression` issue at the first
 * sighting, or a comment on the open one, naming the commit, the job, the
 * failing tests and the run. `failure` is swiftOutcome's job plus
 * failingSwiftTests' result. */
export async function openSwiftRegressionIssue(failure, { repo, token, fetch: fetchImpl = fetch, runUrl, sha, apiUrl = "https://api.github.com", open: listed }) {
  const marker = regressionMarker(SWIFT_IDENTITY);
  const open = listed ?? await listOpenRegressionIssues({ repo, token, fetch: fetchImpl, apiUrl });
  const existing = open.find((issue) => String(issue.body ?? "").includes(marker));
  const shown = failure.tests.slice(0, 50).map((test) => `- \`${test}\``);
  const text = [
    `The Swift package tests (\`swift test --package-path ios\`) failed on main at ${sha}, in the job "${failure.job}".`,
    "",
    ...(failure.tests.length
      ? [`${failure.tests.length} failing test(s):`, ...shown, ...(failure.tests.length > shown.length ? [`- and ${failure.tests.length - shown.length} more`] : [])]
      : ["No test case failed: the package did not build, or the run stopped before its tests."]),
    ...(failure.errors.length ? ["", "First errors of the log:", "", "~~~text", ...failure.errors, "~~~"] : []),
    "",
    `Run: ${runUrl}`,
  ];
  if (existing) {
    const { status } = await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/issues/${existing.number}/comments`, { body: text.join("\n") });
    if (status !== 201) throw new Error(`HTTP ${status} commenting on #${existing.number} for the Swift package tests`);
    return { issue: existing.number, created: false };
  }
  await ensureRegressionLabel(fetchImpl, apiUrl, token, repo);
  const body = [
    ...text,
    "",
    "A package that does not compile is not a flaky test, so this opens at the first failure on main, not the second. Fix the test or the change that broke it. This issue does not block a merge.",
    "",
    marker,
  ].join("\n");
  const { status, json } = await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/issues`, { title: "Regression: Swift package tests (swift test --package-path ios)", body, labels: [REGRESSION_LABEL] });
  if (status !== 201 || typeof json?.number !== "number") throw new Error(`HTTP ${status} opening the issue for the Swift package tests`);
  return { issue: json.number, created: true };
}

function bisectLine(found, entry) {
  const rerun = `node scripts/stability/bisect.mjs --file ${entry.file} --good ${entry.good ?? `${entry.firstSha}~20`} --bad ${entry.firstSha}`;
  if (!found) return `Find the merge that broke it: \`${rerun}\``;
  if (found.verdict === "found") return `Bisect over main's merges: first failing merge ${found.sha} "${found.subject}"${found.pullRequest ? `, pull request #${found.pullRequest}` : ""} (${found.runs} runs of the file).`;
  return `Bisect could not name a merge (${found.verdict}): ${found.detail ?? ""} Re-run it: \`${rerun}\``;
}

// ── Command line ──────────────────────────────────────────────────────────

const cell = (text) => String(text ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
const escapeData = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].replace(/^--/, "");
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) out[name] = true;
    else out[name] = argv[(i += 1)];
  }
  return out;
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The results files of a run's test jobs under `dir` (the `vitest-results-*`
 * artifacts, `<os>-<shard>.json`), each row tagged with its runner. */
export function loadResults(dir) {
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((name) => name.endsWith(".json")) : [];
  const results = files.flatMap((name) => (readJson(join(dir, name), { results: [] }).results ?? []).map((result) => ({ ...result, os: platformOfResults(name) })));
  return { files, results };
}

function report(options) {
  const list = loadKnownFailures(options.list || DEFAULT_LIST);
  const { files, results } = loadResults(String(options.results));
  const expected = Number(options.expect);
  const missingCount = Number.isFinite(expected) && files.length < expected ? expected - files.length : 0;
  // A job that never got a runner is told apart from one that crashed: the
  // first is GitHub's capacity, not a test failure (#3672).
  const noRunner = missingCount ? jobsWithoutRunner(readJsonLines(options.jobs), files.map((name) => basename(name, ".json"))) : [];
  const crashed = Math.max(0, missingCount - noRunner.length);
  const seed = options.seed === true || options.seed === "true";
  const { newFailures, listedFailing, fixed } = classify(list.tests, results);
  // The list shrinks runner by runner (#3569): a listed test that passed on
  // one of its runners leaves that runner, whatever the run covered. A runner
  // the run did not reach (a push on Linux only, a job with no runner) sent
  // no row for it, so its runners stay.
  const out = String(options.out);
  const next = seed ? seedList(list, results.filter((result) => result.state === "fail"), { runUrl: options["run-url"] ?? "a manual run", since: new Date().toISOString().slice(0, 10) }) : shrink(list, fixed);
  const leaving = fixed.filter((entry) => entry.passedOn.length === entryPlatforms(entry).length);
  const narrowed = fixed.filter((entry) => entry.passedOn.length < entryPlatforms(entry).length);
  // The runners each new failure failed on that its entry, if any, does not name.
  const byKey = new Map(list.tests.map((entry) => [identityKey(entry), entry]));
  const newOn = new Map();
  for (const result of results) {
    const entry = byKey.get(identityKey(result));
    if (result.state !== "fail" || !result.os || (entry && listedOn(entry, result.os))) continue;
    newOn.set(identityKey(result), [...new Set([...(newOn.get(identityKey(result)) ?? []), result.os])].sort());
  }
  writeJson(join(out, "known-failures.json"), next);
  writeJson(join(out, "new-failures.json"), newFailures);
  writeJson(join(out, "results.json"), results);

  const lines = ["### Known failures", ""];
  if (missingCount) lines.push(`**${files.length} of ${expected} test jobs sent results.**`, "");
  const byPlatform = Map.groupBy(noRunner, (job) => job.os);
  for (const [os, jobs] of byPlatform) {
    lines.push(`${jobs.length} test job(s) of ${os} got no runner (shard ${jobs.map((job) => job.shard).join(", ")}): GitHub never gave them a machine, so their tests did not run on ${os}. This is not a test failure; listed tests of those shards stay in the list.`, "");
  }
  if (crashed) lines.push(`${crashed} test job(s) crashed or timed out before writing their results, so this run is red.`, "");
  if (seed) lines.push(`Seed mode: ${next.tests.length} failing test(s) written to the \`known-failures\` artifact. Commit that file as \`${LIST_PATH}\`.`, "");
  else if (newFailures.length) {
    lines.push(`${newFailures.length} failure(s) not in \`${LIST_PATH}\` for the runner they failed on: this run is red. Seen twice on main, each opens a \`regression\` issue.`, "", "| Test | Runners |", "|---|---|");
    for (const failure of newFailures) lines.push(`| \`${cell(failure.file)}\` > ${cell(failure.test)} | ${cell((newOn.get(identityKey(failure)) ?? []).join(", "))} |`);
    lines.push("");
  } else lines.push("Every failure of this run is in the list.", "");
  if (!seed && listedFailing.length) lines.push(`${listedFailing.length} listed test(s) still fail.`, "");
  if (!seed && leaving.length) {
    lines.push(`${leaving.length} listed test(s) passed on every runner they were listed for and leave the list. The \`known-failures\` artifact holds the shrunk file; commit it as \`${LIST_PATH}\`:`, "");
    for (const entry of leaving) lines.push(`- \`${cell(entry.file)}\` > ${cell(entry.test)}`);
    lines.push("");
  }
  if (!seed && narrowed.length) {
    lines.push(`${narrowed.length} listed test(s) passed on some of their runners; those runners leave their entry, and the others stay until a run there passes them:`, "");
    for (const entry of narrowed) lines.push(`- \`${cell(entry.file)}\` > ${cell(entry.test)}: passed on ${entry.passedOn.join(", ")}, still listed for ${entryPlatforms(entry).filter((os) => !entry.passedOn.includes(os)).join(", ")}`);
    lines.push("");
  }
  const summary = lines.join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (!seed) for (const failure of newFailures) console.log(`::error file=${escapeProperty(failure.file)},title=${escapeProperty("Failure not in the known-failures list")}::${escapeData(failure.test)}`);
  for (const entry of leaving) console.log(`::notice file=${escapeProperty(entry.file)},title=${escapeProperty("Known failure passed")}::${escapeData(`${entry.test} passed; it leaves ${LIST_PATH}.`)}`);
  console.log(summary);
  return crashed || (!seed && newFailures.length) ? 1 : 0;
}

/** A file of one JSON value per line (`gh api --jq` output); none when absent. */
function readJsonLines(path) {
  if (typeof path !== "string" || !existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** `--platforms` is the JSON list of runners (ci.yml's vitest_os), or a comma list. */
function readPlatforms(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch { /* a comma list */ }
  return value.split(",").map((os) => os.trim()).filter(Boolean);
}

function extract(options) {
  const report = JSON.parse(readFileSync(String(options.report), "utf8"));
  writeJson(String(options.out), { results: extractResults(report, String(options.root || process.cwd()), options.exit ?? 0) });
  return 0;
}

function checkShrink(options) {
  let base = null;
  try {
    base = JSON.parse(execFileSync("git", ["show", `${options.base}:${LIST_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch { /* the list did not exist at the base: nothing to compare */ }
  const head = existsSync(LIST_PATH) ? JSON.parse(readFileSync(LIST_PATH, "utf8")) : null;
  const errors = onlyShrinks(base, head);
  for (const error of errors) console.log(`::error file=${LIST_PATH},title=${escapeProperty("Known-failures list grew")}::${escapeData(error)}`);
  console.log(errors.length ? `${errors.length} entr${errors.length === 1 ? "y" : "ies"} added to ${LIST_PATH}.` : `${LIST_PATH} only shrank.`);
  return errors.length ? 1 : 0;
}

async function openIssues(options) {
  const results = readJson(String(options.results), []);
  const newFailures = readJson(String(options["new-failures"]), []);
  const previous = options.sightings ? readJson(String(options.sightings), null) : null;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  // A failed listing must not lose this run's sightings: the issues are then
  // unknown (kept as is) and openRegressionIssues lists again if one is due.
  let open;
  try {
    open = await listOpenRegressionIssues({ repo, token, apiUrl });
  } catch (error) {
    warn(`Open regression issues not listed (${errorText(error)}): recorded issues kept as is.`);
  }
  const openIssues = open ? new Set(open.map((issue) => issue.number)) : undefined;
  const platforms = readPlatforms(options.platforms);
  const { sightings, due } = updateSightings(previous, { newFailures, results, sha: String(options.sha), platforms, openIssues });
  // Written first, so a failed issue call still keeps this run's sightings.
  writeJson(String(options.out), sightings);
  // The regression issues whose tests pass again: ticked or closed (#4037).
  if (open) {
    try {
      // The Swift package tests' issue closes on a run whose Swift step passed (#4102).
      const swift = swiftOutcome(readJsonLines(options.jobs))?.state ?? null;
      for (const { issue, ticked, closed } of await updateRegressionIssues(open, { results, platforms, sightings, swift, runUrl: options["run-url"], sha: String(options.sha), repo, token, apiUrl })) {
        console.log(`${closed ? "Closed" : "Updated"}: #${issue}, ${ticked} test(s) passing again.`);
      }
    } catch (error) {
      warn(`The issues of tests that pass again were not all updated: ${errorText(error)}`);
    }
  }
  await reportSwift(options, { repo, token, apiUrl, open });
  const { bisect } = await import("../stability/bisect.mjs");
  let opened = [];
  try {
    opened = await openRegressionIssues(due, {
      repo,
      token,
      apiUrl,
      open,
      results,
      runUrl: options["run-url"],
      bisect: (entry, { deadline }) => {
        try {
          return bisect({ repo: process.cwd(), file: entry.file, good: entry.good ?? `${entry.firstSha}~20`, bad: entry.firstSha, deadline });
        } catch (error) {
          return { verdict: "error", detail: String(error) };
        }
      },
    });
  } catch (error) {
    // The sightings keep these tests without an issue, so the next run on
    // main opens it.
    warn(`The regression issue of ${due.length} failure(s) seen twice could not be opened; the next run on main opens it: ${errorText(error)}`);
  }
  for (const { key, issue, created } of opened) {
    sightings.tests[key].issue = issue;
    console.log(`${created ? "Opened" : "Already open"}: #${issue} ${key}`);
  }
  // Why a failure seen twice opened nothing: its issue is still open.
  for (const failure of newFailures) {
    const entry = sightings.tests[identityKey(failure)];
    if (entry?.issue && !opened.some((item) => item.key === identityKey(failure))) console.log(`Tracked by open issue #${entry.issue}: ${identityKey(failure)}`);
  }
  writeJson(String(options.out), sightings);
  console.log(`${Object.keys(sightings.tests).length} unlisted failure(s) tracked, ${new Set(opened.filter((item) => item.created).map((item) => item.issue)).size} issue(s) opened.`);
  // Only a test decides the step's result (#4315): a new failure seen twice
  // fails it, whether or not its issue could be written. A GitHub call that
  // failed (listing, updating, opening an issue) is a warning above, never
  // red by itself.
  return due.length ? 1 : 0;
}

/** A bookkeeping failure of open-issues: a warning on the run and a line in
 * its summary, never a red step by itself (#4315). */
function warn(text) {
  console.log(`::warning title=Regression issues::${escapeData(text)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n> [!WARNING]\n> Regression issues: ${inline(text)}\n`);
}

/** An error with its cause, as fetch's "fetch failed" hides the socket error. */
const errorText = (error) => `${String(error)}${error?.cause ? ` (${String(error.cause)})` : ""}`;

/** The Swift package tests of this run (`--jobs`, `--swift-log`): an issue
 * or a comment when they failed; a warning when writing it failed. */
async function reportSwift(options, { repo, token, apiUrl, open }) {
  const swift = swiftOutcome(readJsonLines(options.jobs));
  if (!swift || swift.state === "pass") return;
  if (swift.state !== "fail") {
    console.log(swift.state === "no-runner"
      ? `"${swift.job}" got no runner: the Swift package tests did not run, which is not a failure.`
      : `"${swift.job}" stopped before the Swift package tests ran: no Swift issue.`);
    return;
  }
  let log = "";
  try { log = readFileSync(String(options["swift-log"]), "utf8"); } catch { /* no log uploaded: the issue says no test case failed */ }
  try {
    const { issue, created } = await openSwiftRegressionIssue({ job: swift.job, ...failingSwiftTests(log) }, { repo, token, apiUrl, open, runUrl: options["run-url"], sha: String(options.sha) });
    console.log(`${created ? "Opened" : "Commented on"} #${issue} for the red Swift package tests.`);
  } catch (error) {
    warn(`The regression issue of the red Swift package tests could not be written: ${errorText(error)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const options = flags(rest);
  const commands = { extract, report, "check-shrink": checkShrink, "open-issues": openIssues };
  if (!commands[command]) {
    console.error(`usage: known-failures.mjs <${Object.keys(commands).join("|")}> [--flags]`);
    process.exit(2);
  }
  Promise.resolve(commands[command](options)).then((code) => process.exit(code), (error) => {
    console.error(error);
    process.exit(1);
  });
}
