// Run by hand, once (#4037): closes the open `regression` issues whose test
// passes in a named green run of CI on main, with that run as evidence, and
// leaves the others. The rail (known-failures.mjs open-issues) closes them by
// itself from then on; this clears the ones it opened, one per test, before
// it did.
//
//   node scripts/testing/close-green-regressions.mjs --run <run id> [--repo <owner/name>] [--close]
//
// Without --close it only lists what it would close (a dry run). An issue is
// read by its title, "Regression: <file> > <test name>" (with or without
// " (broken by #N)"), against the run's test results (the
// `vitest-results-*` artifacts): it closes only when that test ran and passed
// in every job that ran it. A test absent from the run or failed in it keeps
// its issue, and so does any other regression issue (the Swift package tests,
// a run's issue). For an offline check, --results <dir> and --issues <file>
// (the JSON of `gh issue list --json number,title`) replace the downloads.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { greenEvidence, indexRun, loadResults, stateInRun } from "./known-failures.mjs";

/** The test a regression issue's title names, or null for a title of
 * another shape. The test name keeps its own " > " (describe blocks).
 * @returns {{ file: string, test: string } | null} */
export function parseRegressionTitle(title) {
  const match = /^Regression: (.+?) > (.+?)(?: \(broken by #\d+\))?$/.exec(String(title ?? "").trim());
  return match ? { file: match[1], test: match[2] } : null;
}

const REASONS = {
  absent: "its test did not run in this run",
  fail: "its test failed in this run",
  other: "its title does not name one test",
};

/** Which issues the run closes and which stay, with the reason.
 * @param {{ number: number, title: string }[]} issues
 * @param {{ file: string, test: string, state: string }[]} results */
export function planClosures(issues, results) {
  const index = indexRun(results);
  const close = [];
  const keep = [];
  for (const issue of issues) {
    const identity = parseRegressionTitle(issue.title);
    const state = identity ? stateInRun(index, identity) : "other";
    if (state === "pass") close.push({ number: issue.number, title: issue.title });
    else keep.push({ number: issue.number, title: issue.title, reason: REASONS[state] });
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
  const issues = typeof options.issues === "string"
    ? JSON.parse(readFileSync(options.issues, "utf8"))
    : JSON.parse(runGh(["issue", "list", ...repoArgs, "--label", "regression", "--state", "open", "--limit", "5000", "--json", "number,title"]));
  const runUrl = view.url ?? (typeof options.repo === "string" ? `https://github.com/${options.repo}/actions/runs/${options.run}` : `run ${options.run}`);
  log(`Run ${options.run}${view.headBranch ? ` on ${view.headBranch}` : ""}${view.conclusion ? `, ${view.conclusion}` : ""}: ${results.length} test result(s), ${issues.length} open regression issue(s).`);
  const { close, keep } = planClosures(issues, results);
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
