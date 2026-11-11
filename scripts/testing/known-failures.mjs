// The known-failures list (known-failures.json): the tests that fail on main
// today. A CI run is green when every failure it sees is in that list, and the
// list can only shrink. A failure that is not listed and is seen in two runs
// opens one `regression` issue per test, named after the pull request that
// scripts/stability/bisect.mjs finds. Nothing here blocks a merge: it runs
// after the merge, in ci.yml. docs/ci.md, "Known failures".
//
//   extract       one test job: vitest's JSON report to this job's results
//   report        all test jobs: the verdict, the summary, the shrunk list
//   check-shrink  the list at a git revision against the working copy
//   open-issues   the failures seen twice: bisect, then one issue each
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The test name of a failure that belongs to the whole file (it did not load, or a hook failed). */
export const WHOLE_FILE = "(whole file)";
export const LIST_PATH = "scripts/testing/known-failures.json";
const DEFAULT_LIST = join(dirname(fileURLToPath(import.meta.url)), "known-failures.json");
const REGRESSION_LABEL = "regression";

/** @typedef {{ file: string, test: string }} Identity */
/** @typedef {Identity & { state: "pass" | "fail" }} Result */
/** @typedef {Identity & { owner: string, reason: string, since: string }} Entry */
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
 * unhandled error, a crashed worker) is a failure of its own.
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
      results.push({ file: path, test: [...(assertion.ancestorTitles ?? []), assertion.title].join(" > "), state });
    }
    const fileFailed = file.status === "failed" && failedTests === 0;
    results.push({ file: path, test: WHOLE_FILE, state: fileFailed ? "fail" : "pass" });
  }
  if (Number(exitCode) !== 0 && !results.some((result) => result.state === "fail")) {
    results.push({ file: "(vitest run)", test: `exited with code ${exitCode} and no failing test`, state: "fail" });
  }
  return results;
}

/** A test that failed in any job is failing; one that only passed is fixed.
 * @param {Entry[]} list @param {Result[]} results */
export function classify(list, results) {
  const failing = new Map();
  const passing = new Set();
  for (const result of results) {
    const key = identityKey(result);
    if (result.state === "fail") failing.set(key, strip(result));
    else passing.add(key);
  }
  const listed = new Set(list.map(identityKey));
  return {
    newFailures: [...failing.entries()].filter(([key]) => !listed.has(key)).map(([, identity]) => identity),
    listedFailing: list.filter((entry) => failing.has(identityKey(entry))),
    fixed: list.filter((entry) => passing.has(identityKey(entry)) && !failing.has(identityKey(entry))),
  };
}

/** The runners of a run that covers every platform (scripts/ci-scope.mjs). */
export const EVERY_PLATFORM = ["macos-latest", "ubuntu-latest", "windows-latest"];

/** Whether a run's vitest jobs ran on every platform. A push to main runs
 * Linux only, so a listed test that fails only on Windows or macOS passes
 * there: only a run on every platform may drop an entry.
 * @param {string[] | null | undefined} platforms */
export const coversEveryPlatform = (platforms) => EVERY_PLATFORM.every((os) => (platforms ?? []).includes(os));

/** The list without the entries that passed. @param {List} list @param {Entry[]} fixed @returns {List} */
export function shrink(list, fixed) {
  const gone = new Set(fixed.map(identityKey));
  return { ...list, tests: list.tests.filter((entry) => !gone.has(identityKey(entry))) };
}

/** The first fill: every failure of one run, once. @param {List} list @param {Identity[]} failures */
export function seedList(list, failures, { runUrl, since }) {
  const seen = new Map();
  for (const failure of failures) seen.set(identityKey(failure), failure);
  return {
    ...list,
    seeded: runUrl,
    tests: [...seen.values()].map(({ file, test }) => ({ file, test, owner: "unassigned", reason: `Failing when the list was first filled by ${runUrl}.`, since })),
  };
}

/** Errors when `head` holds an entry `base` did not. The one exception is the
 * first fill: a base never seeded, a head that carries `seeded`.
 * @param {List | null} base @param {List | null} head */
export function onlyShrinks(base, head) {
  if (!head) return [`${LIST_PATH} was removed`];
  if (!base) return [];
  if (!base.seeded && head.seeded) return [];
  const known = new Set(base.tests.map(identityKey));
  return head.tests.filter((entry) => !known.has(identityKey(entry))).map((entry) => `${identityKey(entry)} was added to ${LIST_PATH}; the list can only shrink`);
}

/** Sightings of unlisted failures across main's runs. A failure is due for an
 * issue the second time it is seen, on a second commit: another run on the
 * same commit does not add to the count. A test that passes is forgotten only
 * by a run on every platform (`platforms`, as for shrink): a push runs Linux
 * only, and a test that fails only on Windows or macOS passes there. On fewer
 * platforms, and for a test that did not run, the count stays. `good` is the
 * commit of the run before the first sighting, where bisect starts. */
export function updateSightings(previous, { newFailures, results, sha, platforms }) {
  const tests = { ...previous?.tests };
  if (coversEveryPlatform(platforms)) {
    for (const result of results) {
      if (result.state === "pass" && !results.some((other) => other.state === "fail" && identityKey(other) === identityKey(result))) delete tests[identityKey(result)];
    }
  }
  for (const failure of newFailures) {
    const key = identityKey(failure);
    const known = tests[key];
    tests[key] = known
      ? { ...known, count: known.count + (known.lastSha === sha ? 0 : 1), lastSha: sha }
      : { file: failure.file, test: failure.test, count: 1, firstSha: sha, lastSha: sha, good: previous?.lastSha ?? null, issue: null };
  }
  const due = Object.values(tests).filter((entry) => entry.count >= 2 && !entry.issue && newFailures.some((failure) => identityKey(failure) === identityKey(entry)));
  return { sightings: { lastSha: sha, tests }, due };
}

/** The hidden line that ties an issue to its test, so a test never gets two. */
export const regressionMarker = (identity) => `<!-- known-failures: ${identityKey(identity).replace(/--/g, "- -")} -->`;

async function github(fetchImpl, apiUrl, token, method, path, body) {
  const response = await fetchImpl(`${apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** The time all bisects of one run may take together. ci.yml gives the
 * known-failures job 45 minutes; the rest of the job needs about ten, and the
 * sightings must still be uploaded after the issues are opened. */
export const BISECT_BUDGET_MS = 25 * 60_000;

/** One issue per due failure, labelled `regression`; an open issue that
 * already carries the test's marker is reused. `bisect(entry, { deadline })`
 * returns what scripts/stability/bisect.mjs found, or null. Bisect runs the
 * whole file, so it runs once per file for all of that file's tests. Once
 * `budgetMs` is spent, the remaining issues still open, without the pull
 * request, each with the command that finds it. */
export async function openRegressionIssues(due, { repo, token, fetch: fetchImpl = fetch, runUrl, apiUrl = "https://api.github.com", bisect, budgetMs = BISECT_BUDGET_MS, now = Date.now }) {
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
  const open = [];
  for (let page = 1; page <= 10; page += 1) {
    const { status, json } = await github(fetchImpl, apiUrl, token, "GET", `/repos/${repo}/issues?labels=${REGRESSION_LABEL}&state=open&per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json)) throw new Error(`HTTP ${status} listing the open regression issues`);
    open.push(...json);
    if (json.length < 100) break;
  }
  await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/labels`, { name: REGRESSION_LABEL, color: "b60205", description: "A test that passed on main fails after a merge" });
  const opened = [];
  for (const entry of due) {
    const marker = regressionMarker(entry);
    const existing = open.find((issue) => String(issue.body ?? "").includes(marker));
    if (existing) {
      opened.push({ key: identityKey(entry), issue: existing.number, created: false });
      continue;
    }
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
      marker,
    ].join("\n");
    const { status, json } = await github(fetchImpl, apiUrl, token, "POST", `/repos/${repo}/issues`, { title: `Regression: ${identityKey(entry)}${culprit}`, body, labels: [REGRESSION_LABEL] });
    if (status !== 201 || typeof json?.number !== "number") throw new Error(`HTTP ${status} opening the issue for ${identityKey(entry)}`);
    opened.push({ key: identityKey(entry), issue: json.number, created: true });
  }
  return opened;
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

function report(options) {
  const list = loadKnownFailures(options.list || DEFAULT_LIST);
  const dir = String(options.results);
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((name) => name.endsWith(".json")) : [];
  const results = files.flatMap((name) => readJson(join(dir, name), { results: [] }).results ?? []);
  const expected = Number(options.expect);
  const missing = Number.isFinite(expected) && files.length < expected ? `${files.length} of ${expected} test jobs sent results` : null;
  const seed = options.seed === true || options.seed === "true";
  const { newFailures, listedFailing, fixed: passed } = classify(list.tests, results);
  // Only a run on every platform shrinks the list; on fewer, a listed test
  // that passed may still fail on a platform this run did not cover.
  const platforms = readPlatforms(options.platforms);
  const complete = coversEveryPlatform(platforms);
  const fixed = complete ? passed : [];
  const out = String(options.out);
  const next = seed ? seedList(list, [...newFailures, ...listedFailing], { runUrl: options["run-url"] ?? "a manual run", since: new Date().toISOString().slice(0, 10) }) : shrink(list, fixed);
  writeJson(join(out, "known-failures.json"), next);
  writeJson(join(out, "new-failures.json"), newFailures);
  writeJson(join(out, "results.json"), results);

  const lines = ["### Known failures", ""];
  if (missing) lines.push(`**${missing}**: a job crashed or timed out before writing its results, so this run is red.`, "");
  if (seed) lines.push(`Seed mode: ${next.tests.length} failing test(s) written to the \`known-failures\` artifact. Commit that file as \`${LIST_PATH}\`.`, "");
  else if (newFailures.length) {
    lines.push(`${newFailures.length} failure(s) not in \`${LIST_PATH}\`: this run is red. Seen twice on main, each opens a \`regression\` issue.`, "", "| Test |", "|---|");
    for (const failure of newFailures) lines.push(`| \`${cell(failure.file)}\` > ${cell(failure.test)} |`);
    lines.push("");
  } else lines.push("Every failure of this run is in the list.", "");
  if (!seed && listedFailing.length) lines.push(`${listedFailing.length} listed test(s) still fail.`, "");
  if (!seed && fixed.length) {
    lines.push(`${fixed.length} listed test(s) passed and leave the list. The \`known-failures\` artifact holds the shrunk file; commit it as \`${LIST_PATH}\`:`, "");
    for (const entry of fixed) lines.push(`- \`${cell(entry.file)}\` > ${cell(entry.test)}`);
    lines.push("");
  }
  if (!seed && !complete && passed.length) {
    lines.push(`${passed.length} listed test(s) passed on ${platforms.length ? platforms.join(", ") : "the platforms of this run"} only; they stay in the list until a run on every platform (the nightly schedule or a manual dispatch) passes them.`, "");
  }
  const summary = lines.join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (!seed) for (const failure of newFailures) console.log(`::error file=${escapeProperty(failure.file)},title=${escapeProperty("Failure not in the known-failures list")}::${escapeData(failure.test)}`);
  for (const entry of fixed) console.log(`::notice file=${escapeProperty(entry.file)},title=${escapeProperty("Known failure passed")}::${escapeData(`${entry.test} passed; it leaves ${LIST_PATH}.`)}`);
  console.log(summary);
  return missing || (!seed && newFailures.length) ? 1 : 0;
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
  const { sightings, due } = updateSightings(previous, { newFailures, results, sha: String(options.sha), platforms: readPlatforms(options.platforms) });
  // Written first, so a failed issue call still keeps this run's sightings.
  writeJson(String(options.out), sightings);
  const { bisect } = await import("../stability/bisect.mjs");
  const opened = await openRegressionIssues(due, {
    repo: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    runUrl: options["run-url"],
    bisect: (entry, { deadline }) => {
      try {
        return bisect({ repo: process.cwd(), file: entry.file, good: entry.good ?? `${entry.firstSha}~20`, bad: entry.firstSha, deadline });
      } catch (error) {
        return { verdict: "error", detail: String(error) };
      }
    },
  });
  for (const { key, issue, created } of opened) {
    sightings.tests[key].issue = issue;
    console.log(`${created ? "Opened" : "Already open"}: #${issue} ${key}`);
  }
  writeJson(String(options.out), sightings);
  console.log(`${Object.keys(sightings.tests).length} unlisted failure(s) tracked, ${opened.filter((item) => item.created).length} issue(s) opened.`);
  return 0;
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
