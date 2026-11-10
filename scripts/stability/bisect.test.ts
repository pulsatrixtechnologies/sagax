import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bisect, mergesBetween, pullRequestOf } from "./bisect.mjs";

const script = new URL("./bisect.mjs", import.meta.url).pathname;
const repos: string[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

/** A small main history: each commit is a squash merge named "(#n)", and
 * check.test.mjs passes until the merge of #3 breaks it. */
function fixtureHistory() {
  const repo = mkdtempSync(join(tmpdir(), "bisect-fixture-"));
  repos.push(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.test");
  git("config", "user.name", "ci");
  const commit = (subject: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
    git("add", ".");
    git("commit", "-qm", subject);
    return git("rev-parse", "HEAD");
  };
  const good = commit("Add the checked module (#1)", { "value.txt": "ok\n", "check.test.mjs": "import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync('value.txt', 'utf8').trim() === 'ok' ? 0 : 1);\n" });
  commit("docs: explain it (#2)", { "README.md": "notes\n" });
  const broken = commit("feat: change the value (#3)", { "value.txt": "changed\n" });
  commit("chore: unrelated (#4)", { "other.txt": "x\n" });
  const bad = commit("fix: something else (#5)", { "other.txt": "y\n" });
  return { repo, good, broken, bad };
}

const runner = "node {file}";

describe("pullRequestOf", () => {
  it("reads the pull request of a squash merge or a merge commit", () => {
    expect(pullRequestOf("feat: thing (#3482)")).toBe(3482);
    expect(pullRequestOf("Merge pull request #12 from fork/branch")).toBe(12);
    expect(pullRequestOf("a direct commit")).toBeNull();
  });
});

describe("bisect over a fixture history", () => {
  it("lists main's merges between the good and the bad commit, oldest first", () => {
    const { repo, good, bad } = fixtureHistory();
    expect(mergesBetween(repo, good, bad).map((merge) => merge.subject)).toEqual([
      "docs: explain it (#2)", "feat: change the value (#3)", "chore: unrelated (#4)", "fix: something else (#5)",
    ]);
  });

  it("runs only the failing file and names the pull request that broke it", () => {
    const { repo, good, broken, bad } = fixtureHistory();
    const found = bisect({ repo, file: "check.test.mjs", good, bad, run: runner });
    expect(found).toMatchObject({ verdict: "found", sha: broken, subject: "feat: change the value (#3)", pullRequest: 3 });
    // The two ends, then halving four merges: two more runs.
    expect(found.runs).toBe(4);
    // Its scratch checkout is gone, and the repository's own checkout is untouched.
    expect(found.worktree && existsSync(found.worktree)).toBe(false);
    expect(execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(bad);
    expect(execFileSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf8" }).trim().split("\n")).toHaveLength(1);
  });

  it("says so when the good end already fails or the bad end passes", () => {
    const { repo, good, broken, bad } = fixtureHistory();
    expect(bisect({ repo, file: "check.test.mjs", good: broken, bad, run: runner }).verdict).toBe("good-fails");
    expect(bisect({ repo, file: "check.test.mjs", good, bad: good, run: runner }).verdict).toBe("no-merges");
    const passing = fixtureHistory();
    expect(bisect({ repo: passing.repo, file: "check.test.mjs", good: passing.good, bad: execFileSync("git", ["-C", passing.repo, "rev-parse", "HEAD~3"], { encoding: "utf8" }).trim(), run: runner }).verdict).toBe("bad-passes");
  });

  it("stops at its deadline with no merge named, and still removes its scratch checkout", () => {
    const { repo, good, bad } = fixtureHistory();
    // The clock passes the deadline after the two ends ran.
    let calls = 0;
    const now = () => (calls++ < 2 ? 0 : 10_000);
    const found = bisect({ repo, file: "check.test.mjs", good, bad, run: runner, deadline: 5_000, now });
    expect(found).toMatchObject({ verdict: "out-of-time", runs: 2 });
    expect(found.worktree && existsSync(found.worktree)).toBe(false);
    expect(bisect({ repo, file: "check.test.mjs", good, bad, run: runner, deadline: 0, now: () => 1 })).toMatchObject({ verdict: "out-of-time", runs: 0 });
  });

  it("prints the pull request from the command line", () => {
    const { repo, good, bad } = fixtureHistory();
    const result = spawnSync(process.execPath, [script, "--repo", repo, "--file", "check.test.mjs", "--good", good, "--bad", bad, "--run", runner], { encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("pull request #3");
  });
});
