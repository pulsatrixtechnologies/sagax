// Names the pull request that broke a test: runs only the failing test file
// on main's merges between a commit where it passed and one where it fails,
// halving the interval each time, and reads the pull request number from the
// first failing merge's subject ("title (#123)"). The repository's own
// checkout is never touched: the runs happen in a scratch worktree that is
// removed at the end, with the repository's node_modules linked in.
//
//   node scripts/stability/bisect.mjs --file server/index.test.ts --good <sha> --bad <sha>
//     [--test "<full test name>"] [--run "<command, {file} is the test file>"] [--repo <dir>] [--json]
//
// ci.yml runs it when a failure seen twice opens a `regression` issue
// (scripts/testing/known-failures.mjs). docs/ci.md, "Known failures".
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Each run of the file gets ten minutes; a hang reads as a failure. */
const RUN_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_RUN = "pnpm exec vitest run {file}";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** "feat: thing (#12)" or "Merge pull request #12 from …" → 12. */
export function pullRequestOf(subject) {
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  const merge = subject.match(/^Merge pull request #(\d+)/);
  const number = squash?.[1] ?? merge?.[1];
  return number ? Number(number) : null;
}

/** main's merges after `good` up to `bad`, oldest first (first parent only). */
export function mergesBetween(repo, good, bad) {
  const out = git(repo, ["log", "--first-parent", "--reverse", "--format=%H%x09%s", `${good}..${bad}`]);
  return out ? out.split("\n").map((line) => {
    const [sha, ...subject] = line.split("\t");
    return { sha, subject: subject.join("\t") };
  }) : [];
}

const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
const regexEscape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Thrown inside a bisect when its deadline passes. */
class OutOfTime extends Error {}

/** `deadline` (epoch milliseconds) bounds the whole bisect: no run starts
 * after it, a run still going at it is stopped, and the verdict is
 * "out-of-time" instead of a merge.
 * @returns {{ verdict: "found" | "good-fails" | "bad-passes" | "no-merges" | "out-of-time", sha?: string, subject?: string, pullRequest?: number | null, runs: number, worktree?: string, detail?: string }} */
export function bisect({ repo, file, test, good, bad, run = DEFAULT_RUN, log = () => {}, deadline = Infinity, now = Date.now }) {
  const goodSha = git(repo, ["rev-parse", `${good}^{commit}`]);
  const badSha = git(repo, ["rev-parse", `${bad}^{commit}`]);
  const merges = mergesBetween(repo, goodSha, badSha);
  if (merges.length === 0) return { verdict: "no-merges", runs: 0, detail: `no merge between ${goodSha} and ${badSha}.` };
  const command = run.replaceAll("{file}", shellQuote(file)) + (test ? ` -t ${shellQuote(`^${regexEscape(test.replaceAll(" > ", " "))}$`)}` : "");
  const worktree = join(mkdtempSync(join(tmpdir(), "bisect-")), "checkout");
  git(repo, ["worktree", "add", "--quiet", "--detach", worktree, badSha]);
  if (existsSync(join(repo, "node_modules")) && !existsSync(join(worktree, "node_modules"))) symlinkSync(join(repo, "node_modules"), join(worktree, "node_modules"));
  let runs = 0;
  const passesAt = (sha) => {
    const left = deadline - now();
    if (left <= 0) throw new OutOfTime();
    git(worktree, ["checkout", "--quiet", "--detach", sha]);
    runs += 1;
    const cut = left < RUN_TIMEOUT_MS;
    const result = spawnSync(command, { cwd: worktree, shell: true, stdio: "ignore", timeout: cut ? Math.max(1, Math.floor(left)) : RUN_TIMEOUT_MS });
    // Stopped by the deadline, not by the file: no verdict from this run.
    if (cut && result.error && now() >= deadline) throw new OutOfTime();
    const passed = result.status === 0;
    log(`${passed ? "pass" : "fail"} ${sha.slice(0, 10)}`);
    return passed;
  };
  try {
    if (passesAt(badSha)) return { verdict: "bad-passes", runs, worktree, detail: `${file} passes at ${badSha}: a flake, or it needs the full suite to fail.` };
    if (!passesAt(goodSha)) return { verdict: "good-fails", runs, worktree, detail: `${file} already fails at ${goodSha}: start from an older commit.` };
    // merges[hi] fails (the last one is bad); index lo passes (-1 is good).
    let lo = -1;
    let hi = merges.length - 1;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (passesAt(merges[mid].sha)) lo = mid;
      else hi = mid;
    }
    const culprit = merges[hi];
    return { verdict: "found", sha: culprit.sha, subject: culprit.subject, pullRequest: pullRequestOf(culprit.subject), runs, worktree };
  } catch (error) {
    if (error instanceof OutOfTime) return { verdict: "out-of-time", runs, worktree, detail: `the time for bisect ran out after ${runs} run(s) of ${file}.` };
    throw error;
  } finally {
    try { git(repo, ["worktree", "remove", "--force", worktree]); } catch { rmSync(worktree, { recursive: true, force: true }); }
    rmSync(resolve(worktree, ".."), { recursive: true, force: true });
    try { git(repo, ["worktree", "prune"]); } catch { /* nothing to prune */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  };
  const file = flag("file");
  const good = flag("good");
  const bad = flag("bad");
  if (!file || !good || !bad) {
    console.error("usage: bisect.mjs --file <test file> --good <commit> --bad <commit> [--test <name>] [--run <command>] [--repo <dir>] [--json]");
    process.exit(2);
  }
  const result = bisect({ repo: flag("repo") ?? process.cwd(), file, test: flag("test"), good, bad, run: flag("run") ?? DEFAULT_RUN, log: (line) => console.error(line) });
  if (args.includes("--json")) console.log(JSON.stringify(result));
  else if (result.verdict === "found") console.log(`First failing merge: ${result.sha.slice(0, 10)} ${result.subject}${result.pullRequest ? `, pull request #${result.pullRequest}` : ""} (${result.runs} runs of ${file}).`);
  else console.log(`No merge named (${result.verdict}): ${result.detail}`);
  process.exit(result.verdict === "found" ? 0 : 1);
}
