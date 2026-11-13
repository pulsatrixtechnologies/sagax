// Run by hand (#4037, #4102): closes the open `regression` issues whose tests
// pass in a named run of CI on main, with that run as evidence, and those
// whose test no longer exists on main, with the commit that removed it, and
// leaves the others. The rail (known-failures.mjs open-issues) closes them by
// itself from then on; this clears the ones it opened, one per test, before
// it did.
//
//   node scripts/testing/close-green-regressions.mjs --run <run id> [--repo <owner/name>] [--ref <git ref>] [--close]
//
// Without --close it only lists what it would close (a dry run). It decides
// as the rail does, with the same function (planRegressionUpdates, #4052):
// an issue's tests are the markers in its body and the sightings tied to it
// (the run's `known-failures-sightings` artifact), each read against the
// run's test results (the `vitest-results-*` artifacts). A test seen failing
// on some runners must pass on each of them; with no runner on record, the
// run must cover every platform. A sighting recorded before the sightings
// kept their runners gets them back from the runs of main at its commits
// (recoverFailedOn, #4102). The Swift package tests' issue reads the run's
// Swift step. A test that is not in the run although its file ran, and whose
// name is nowhere in the tree at --ref (origin/main by default), or whose
// file is gone there, no longer exists: its issue closes with the commit that
// removed or renamed it. A test that failed keeps its issue, and so does a
// regression issue with no test of the rail. For an offline check,
// --results <dir>, --issues <file> (the JSON of `gh issue list --json
// number,title,body`), --sightings <file> and --jobs <file> (one job of the
// Actions API per line) replace the downloads.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  closingEvidence,
  identityKey,
  indexRun,
  issueMarkers,
  loadResults,
  markerTest,
  planRegressionUpdates,
  recoverFailedOn,
  regressionMarker,
  SWIFT_IDENTITY,
  swiftOutcome,
} from "./known-failures.mjs";

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
 * @param {{ sightings?: { tests?: Record<string, { failedOn?: string[], issue?: number | null }> } | null, swift?: string | null, gone?: Map<string, string> }} [options] */
export function planClosures(issues, results, { sightings = null, swift = null, gone = new Map() } = {}) {
  const platforms = [...new Set(results.map((result) => result.os).filter(Boolean))].sort();
  const close = [];
  const keep = [];
  for (const plan of planRegressionUpdates(issues, { results, platforms, sightings, swift, gone })) {
    if (plan.close) close.push({ number: plan.number, title: plan.title, gone: plan.gone ?? [], tests: plan.ticked });
    else keep.push({ number: plan.number, title: plan.title, reason: REASONS[plan.reason] });
  }
  return { close, keep };
}

/** The pieces of a test's name to look for in the tree: the name, then the
 * parts of a generated name (`${key} = ${value}`), longest first. */
const namePieces = (test) => {
  const leaf = test.split(" > ").at(-1) ?? test;
  return [...new Set([leaf, ...leaf.split(/\s+=\s+|:\s+/).sort((a, b) => b.length - a.length)])].filter((piece) => piece.trim().length >= 8);
};

/** The tests of the open issues that no longer exist on main, each with the
 * commit that removed or renamed it (#4102). A test that ran in the run is
 * not gone. Its file gone at `ref`: the commit that last touched the path.
 * Its file ran but not the test: gone when a piece of its name is nowhere in
 * the tree at `ref` and the history names the commit that took it out. The
 * pseudo entries ('(whole file)', '(vitest run)') and the Swift package tests
 * exist while their file does.
 * @returns {Map<string, string>} marker to commit */
export function goneTests(issues, results, { sightings, ref, git }) {
  const ran = indexRun(results);
  const ranMarkers = new Set([...ran.values()].map((item) => regressionMarker(item)));
  const ranFiles = new Set(results.map((result) => result.file));
  const swift = regressionMarker(SWIFT_IDENTITY);
  const gone = new Map();
  const tryGit = (args) => {
    try { return git(args).trim(); } catch { return null; }
  };
  for (const issue of issues) {
    for (const marker of issueMarkers(issue, sightings)) {
      if (ranMarkers.has(marker) || marker === swift || gone.has(marker)) continue;
      const { file, test } = markerTest(marker);
      if (file.startsWith("(")) continue;
      if (tryGit(["cat-file", "-e", `${ref}:${file}`]) === null) {
        const commit = tryGit(["log", "-1", "--format=%H", ref, "--", file]);
        if (commit) gone.set(marker, commit);
        continue;
      }
      if (!ranFiles.has(file) || test.startsWith("(")) continue;
      for (const piece of namePieces(test)) {
        // `git grep` exits 1 when nothing matches: the piece is gone.
        if (tryGit(["grep", "-F", "-q", "-e", piece, ref]) !== null) continue;
        const commit = tryGit(["log", "-1", "--format=%H", `-S${piece}`, ref]);
        if (commit) {
          gone.set(marker, commit);
          break;
        }
      }
    }
  }
  return gone;
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

const jsonLines = (text) => String(text ?? "").split("\n").filter((line) => line.trim()).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});

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

/** A run's results (its `vitest-results-*` artifacts), downloaded. */
function downloadResults(runGh, run, repoArgs) {
  const dir = mkdtempSync(join(tmpdir(), "green-run-"));
  try {
    runGh(["run", "download", run, ...repoArgs, "--pattern", "vitest-results-*", "--dir", dir]);
    return loadResults(dir).results;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A run's jobs, as the rail reads them ({ name, conclusion, steps }). */
const runJobs = (runGh, run, repo) => jsonLines(runGh(["api", "--paginate", `repos/${repo}/actions/runs/${run}/jobs?per_page=100`, "--jq", ".jobs[] | {name, conclusion, steps: [.steps[]? | {name, status, conclusion}]}"]));

/** The CI runs of main at a commit, for recoverFailedOn: the platforms of
 * their vitest jobs, and for a run on several, the runners each test failed
 * on from its results. */
function runsAtCommit(runGh, repo, repoArgs) {
  const cache = new Map();
  return (sha) => {
    if (cache.has(sha)) return cache.get(sha);
    let runs = [];
    try {
      const listed = JSON.parse(runGh(["run", "list", ...repoArgs, "--workflow", "CI", "--commit", sha, "--json", "databaseId", "--limit", "20"]));
      runs = listed.map(({ databaseId }) => {
        const run = String(databaseId);
        const platforms = [...new Set(runJobs(runGh, run, repo).flatMap((job) => {
          const match = /^vitest \((.+), shard \d+\/\d+\)$/.exec(String(job.name));
          return match && job.conclusion !== "skipped" ? [match[1]] : [];
        }))];
        if (platforms.length < 2) return { platforms, failing: null };
        let failing = null;
        try {
          failing = new Map();
          for (const result of downloadResults(runGh, run, repoArgs)) {
            if (result.state === "fail") failing.set(identityKey(result), [...(failing.get(identityKey(result)) ?? []), result.os]);
          }
        } catch { failing = null; }
        return { platforms, failing };
      });
    } catch { runs = []; }
    cache.set(sha, runs);
    return runs;
  };
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
const gitCli = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

export function main(argv, { run: runGh = gh, git = gitCli, log = console.log } = {}) {
  const options = flags(argv);
  if (typeof options.run !== "string" || !/^\d+$/.test(options.run)) {
    log("usage: close-green-regressions.mjs --run <run id> [--repo <owner/name>] [--ref <git ref>] [--close]");
    return 2;
  }
  const offline = typeof options.results === "string";
  const repoArgs = typeof options.repo === "string" ? ["--repo", options.repo] : [];
  const repo = typeof options.repo === "string" ? options.repo : "{owner}/{repo}";
  const ref = typeof options.ref === "string" ? options.ref : "origin/main";
  const view = offline ? {} : JSON.parse(runGh(["run", "view", options.run, ...repoArgs, "--json", "headSha,url,conclusion,headBranch"]));
  const results = offline ? loadResults(options.results).results : downloadResults(runGh, options.run, repoArgs);
  const downloaded = typeof options.sightings === "string" ? JSON.parse(readFileSync(options.sightings, "utf8")) : offline ? null : downloadSightings(runGh, options.run, repoArgs);
  const jobs = typeof options.jobs === "string" ? jsonLines(readFileSync(options.jobs, "utf8")) : offline ? [] : runJobs(runGh, options.run, repo);
  const swift = swiftOutcome(jobs)?.state ?? null;
  const issues = typeof options.issues === "string"
    ? JSON.parse(readFileSync(options.issues, "utf8"))
    : JSON.parse(runGh(["issue", "list", ...repoArgs, "--label", "regression", "--state", "open", "--limit", "5000", "--json", "number,title,body"]));
  // Only the sightings of the open issues need their runners back.
  const open = new Set(issues.map((issue) => issue.number));
  const tiedToOpen = Object.fromEntries(Object.entries(downloaded?.tests ?? {}).filter(([, entry]) => open.has(entry?.issue)));
  const sightings = offline || !downloaded ? downloaded : { ...downloaded, tests: { ...downloaded.tests, ...recoverFailedOn({ tests: tiedToOpen }, runsAtCommit(runGh, repo, repoArgs)).tests } };
  const gone = goneTests(issues, results, { sightings, ref, git });
  const runUrl = view.url ?? (typeof options.repo === "string" ? `https://github.com/${options.repo}/actions/runs/${options.run}` : `run ${options.run}`);
  log(`Run ${options.run}${view.headBranch ? ` on ${view.headBranch}` : ""}${view.conclusion ? `, ${view.conclusion}` : ""}: ${results.length} test result(s), ${issues.length} open regression issue(s), ${sightings ? `${Object.keys(sightings.tests ?? {}).length} sighting(s)` : "no sightings"}${swift ? `, Swift package tests ${swift}` : ""}.`);
  const { close, keep } = planClosures(issues, results, { sightings, swift, gone });
  const doClose = options.close === true;
  for (const issue of close) {
    log(`${doClose ? "Closing" : "Would close"} #${issue.number} ${issue.title}${issue.gone.length ? " (test no longer exists)" : ""}`);
    if (doClose) runGh(["issue", "close", String(issue.number), ...repoArgs, "--reason", "completed", "--comment", closingEvidence({ runUrl, sha: view.headSha, gone: issue.gone, tests: issue.tests })]);
  }
  for (const [reason, items] of Map.groupBy(keep, (issue) => issue.reason)) log(`Kept ${items.length}: ${reason}.`);
  const removed = close.filter((issue) => issue.gone.length).length;
  log(`${close.length} issue(s) ${doClose ? "closed" : "to close (dry run; add --close to close them)"} (${close.length - removed} passing, ${removed} test no longer exists), ${keep.length} kept.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
