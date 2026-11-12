// Run by hand, once (#4037): closes the open `regression` issues whose tests
// pass in a named green run of CI on main, with that run as evidence, and
// leaves the others. The rail (known-failures.mjs open-issues) closes them by
// itself from then on; this clears the ones it opened, one per test, before
// it did.
//
//   node scripts/testing/close-green-regressions.mjs --run <run id> [--repo <owner/name>] [--close]
//
// Without --close it only lists what it would close (a dry run). It decides
// as the rail does, with the same function (planRegressionUpdates, #4052):
// an issue's tests are the markers in its body and the sightings tied to it
// (the run's `known-failures-sightings` artifact), each read against the
// run's test results (the `vitest-results-*` artifacts). A test seen failing
// on some runners must pass on each of them; with no runner on record, the
// run must cover every platform. A test absent from the run or failed in it
// keeps its issue, and so does a regression issue with no test of the rail
// (the Swift package tests). For an offline check, --results <dir>,
// --issues <file> (the JSON of `gh issue list --json number,title,body`) and
// --sightings <file> replace the downloads.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { greenEvidence, loadResults, planRegressionUpdates } from "./known-failures.mjs";

const REASONS = {
  "not-green": "a test of it did not run in this run, or not on each runner it failed on",
  fail: "a test of it failed in this run",
  other: "it names no test of the rail",
};

/** Which issues the run closes and which stay, with the reason: the rail's
 * own decision (planRegressionUpdates). The run's platforms are the runners
 * its results came from.
 * @param {{ number: number, title: string, body?: string }[]} issues
 * @param {{ file: string, test: string, state: string, os?: string }[]} results
 * @param {{ sightings?: { tests?: Record<string, { failedOn?: string[], issue?: number | null }> } | null }} [options] */
export function planClosures(issues, results, { sightings = null } = {}) {
  const platforms = [...new Set(results.map((result) => result.os).filter(Boolean))].sort();
  const close = [];
  const keep = [];
  for (const plan of planRegressionUpdates(issues, { results, platforms, sightings })) {
    if (plan.close) close.push({ number: plan.number, title: plan.title });
    else keep.push({ number: plan.number, title: plan.title, reason: REASONS[plan.reason] });
  }
  return { close, keep };
}

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].replace(/^--/, "");
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) out[name] = true;
    else out[name] = argv[(i += 1)];
  }
  return out;
}

/** The run's sightings (its `known-failures-sightings` artifact): the
 * runners each test failed on and the issue it is tied to. A run without
 * them gives null: an issue then closes only from a run on every platform. */
function downloadSightings(runGh, run, repoArgs) {
  const dir = mkdtempSync(join(tmpdir(), "green-sightings-"));
  try {
    runGh(["run", "download", run, ...repoArgs, "--name", "known-failures-sightings", "--dir", dir]);
    const file = join(dir, "sightings.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });

export function main(argv, { run: runGh = gh, log = console.log } = {}) {
  const options = flags(argv);
  if (typeof options.run !== "string" || !/^\d+$/.test(options.run)) {
    log("usage: close-green-regressions.mjs --run <run id> [--repo <owner/name>] [--close]");
    return 2;
  }
  const repoArgs = typeof options.repo === "string" ? ["--repo", options.repo] : [];
  const view = typeof options.results === "string" ? {} : JSON.parse(runGh(["run", "view", options.run, ...repoArgs, "--json", "headSha,url,conclusion,headBranch"]));
  let results;
  if (typeof options.results === "string") results = loadResults(options.results).results;
  else {
    const dir = mkdtempSync(join(tmpdir(), "green-run-"));
    try {
      runGh(["run", "download", options.run, ...repoArgs, "--pattern", "vitest-results-*", "--dir", dir]);
      results = loadResults(dir).results;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const sightings = typeof options.sightings === "string" ? JSON.parse(readFileSync(options.sightings, "utf8")) : typeof options.results === "string" ? null : downloadSightings(runGh, options.run, repoArgs);
  const issues = typeof options.issues === "string"
    ? JSON.parse(readFileSync(options.issues, "utf8"))
    : JSON.parse(runGh(["issue", "list", ...repoArgs, "--label", "regression", "--state", "open", "--limit", "5000", "--json", "number,title,body"]));
  const runUrl = view.url ?? (typeof options.repo === "string" ? `https://github.com/${options.repo}/actions/runs/${options.run}` : `run ${options.run}`);
  log(`Run ${options.run}${view.headBranch ? ` on ${view.headBranch}` : ""}${view.conclusion ? `, ${view.conclusion}` : ""}: ${results.length} test result(s), ${issues.length} open regression issue(s), ${sightings ? `${Object.keys(sightings.tests ?? {}).length} sighting(s)` : "no sightings"}.`);
  const { close, keep } = planClosures(issues, results, { sightings });
  const doClose = options.close === true;
  for (const issue of close) {
    log(`${doClose ? "Closing" : "Would close"} #${issue.number} ${issue.title}`);
    if (doClose) runGh(["issue", "close", String(issue.number), ...repoArgs, "--reason", "completed", "--comment", greenEvidence({ runUrl, sha: view.headSha })]);
  }
  for (const [reason, items] of Map.groupBy(keep, (issue) => issue.reason)) log(`Kept ${items.length}: ${reason}.`);
  log(`${close.length} issue(s) ${doClose ? "closed" : "to close (dry run; add --close to close them)"}, ${keep.length} kept.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
