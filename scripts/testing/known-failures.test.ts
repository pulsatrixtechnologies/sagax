import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  coversEveryPlatform,
  EVERY_PLATFORM,
  extractResults,
  identityKey,
  listedGuardTests,
  onlyShrinks,
  openRegressionIssues,
  regressionMarker,
  seedList,
  shrink,
  updateSightings,
  WHOLE_FILE,
} from "./known-failures.mjs";

const script = new URL("./known-failures.mjs", import.meta.url).pathname;
const listPath = new URL("./known-failures.json", import.meta.url);
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "known-failures-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const root = "/repo";
/** A vitest JSON report in the shape `--reporter=json` writes. */
const report = (files: { name: string; status: string; message?: string; tests: [string[], string, string][] }[]) => ({
  testResults: files.map((file) => ({
    name: `${root}/${file.name}`,
    status: file.status,
    message: file.message ?? "",
    assertionResults: file.tests.map(([ancestorTitles, title, status]) => ({ ancestorTitles, title, status, fullName: [...ancestorTitles, title].join(" ") })),
  })),
});
const entry = (file: string, test: string) => ({ file, test, owner: "unassigned", reason: "r", since: "2026-11-10" });

describe("the known-failures list", () => {
  it("is committed in the shape of the flaky-test list, and starts empty until the first run on GitHub fills it", () => {
    const list = JSON.parse(readFileSync(listPath, "utf8"));
    expect(typeof list.$comment).toBe("string");
    expect(Array.isArray(list.tests)).toBe(true);
    for (const test of list.tests) expect(Object.keys(test).sort()).toEqual(["file", "owner", "reason", "since", "test"]);
  });

  it("names no guard test: a guard test is fixed on every platform, never listed (#3558)", () => {
    expect(listedGuardTests(JSON.parse(readFileSync(listPath, "utf8")))).toEqual([]);
  });

  it("refuses a list that names a file of the guard tests list, whatever the test", () => {
    const list = { tests: [entry("server/a.test.ts", "breaks"), entry("scripts/testing/agents-md.guard.test.ts", WHOLE_FILE)] };
    expect(listedGuardTests(list)).toEqual([
      "scripts/testing/agents-md.guard.test.ts > (whole file) is a guard test: fix it, never list it in scripts/testing/known-failures.json",
    ]);
    expect(listedGuardTests(list, ["server/a.test.ts"])).toHaveLength(1);
  });
});

describe("extractResults", () => {
  it("names each test by its file relative to the root and its describe blocks joined with ' > '", () => {
    const results = extractResults(report([
      { name: "server/a.test.ts", status: "failed", tests: [[["outer", "inner"], "breaks", "failed"], [[], "works", "passed"], [[], "later", "skipped"]] },
    ]), root, 1);
    expect(results).toEqual([
      { file: "server/a.test.ts", test: "outer > inner > breaks", state: "fail" },
      { file: "server/a.test.ts", test: "works", state: "pass" },
      { file: "server/a.test.ts", test: WHOLE_FILE, state: "pass" },
    ]);
  });

  it("counts a file that failed to load as one failure of the whole file", () => {
    const results = extractResults(report([{ name: "server/b.test.ts", status: "failed", message: "SyntaxError", tests: [] }]), root, 1);
    expect(results).toEqual([{ file: "server/b.test.ts", test: WHOLE_FILE, state: "fail" }]);
  });

  it("turns a non-zero vitest exit with no failing test into a failure, so an unhandled error is never green", () => {
    const results = extractResults(report([{ name: "server/c.test.ts", status: "passed", tests: [[[], "ok", "passed"]] }]), root, 1);
    expect(results.filter((result) => result.state === "fail")).toEqual([{ file: "(vitest run)", test: "exited with code 1 and no failing test", state: "fail" }]);
    expect(extractResults(report([{ name: "server/c.test.ts", status: "passed", tests: [[[], "ok", "passed"]] }]), root, 0).every((result) => result.state === "pass")).toBe(true);
  });
});

describe("classify and shrink", () => {
  const list = [entry("a.test.ts", "listed and still failing"), entry("a.test.ts", "listed and fixed"), entry("b.test.ts", "listed, not run")];
  const results = [
    { file: "a.test.ts", test: "listed and still failing", state: "fail" },
    { file: "a.test.ts", test: "listed and fixed", state: "pass" },
    { file: "a.test.ts", test: "new failure", state: "fail" },
    { file: "a.test.ts", test: "new failure", state: "fail" },
  ];

  it("is green only when every failure is in the list", () => {
    const verdict = classify(list, results);
    expect(verdict.newFailures).toEqual([{ file: "a.test.ts", test: "new failure" }]);
    expect(verdict.listedFailing.map(identityKey)).toEqual([identityKey(list[0]!)]);
    expect(verdict.fixed.map(identityKey)).toEqual([identityKey(list[1]!)]);
    expect(classify(list, results.slice(0, 2)).newFailures).toEqual([]);
  });

  it("drops a listed test that passed and keeps one that did not run", () => {
    const { fixed } = classify(list, results);
    expect(shrink({ $comment: "c", tests: list }, fixed).tests.map((test: { test: string }) => test.test)).toEqual(["listed and still failing", "listed, not run"]);
  });

  it("lets a test fail on one platform and pass on another without leaving the list", () => {
    const both = [{ file: "a.test.ts", test: "listed and fixed", state: "pass" }, { file: "a.test.ts", test: "listed and fixed", state: "fail" }];
    expect(classify(list, both).fixed).toEqual([]);
  });
});

describe("onlyShrinks", () => {
  const base = { $comment: "c", seeded: "run 1", tests: [entry("a.test.ts", "one"), entry("a.test.ts", "two")] };

  it("accepts a list that lost entries and refuses one that gained an entry", () => {
    expect(onlyShrinks(base, { ...base, tests: [base.tests[0]] })).toEqual([]);
    expect(onlyShrinks(base, { ...base, tests: [...base.tests, entry("b.test.ts", "added by hand")] })).toEqual([
      "b.test.ts > added by hand was added to scripts/testing/known-failures.json; the list can only shrink",
    ]);
  });

  it("allows the one first fill from a run, recognised by its seeded field", () => {
    const unseeded = { $comment: "c", tests: [] };
    expect(onlyShrinks(unseeded, base)).toEqual([]);
    expect(onlyShrinks(unseeded, { $comment: "c", tests: [entry("a.test.ts", "one")] })).toHaveLength(1);
    expect(onlyShrinks(base, { ...base, seeded: "run 2", tests: [...base.tests, entry("c.test.ts", "again")] })).toHaveLength(1);
  });

  it("refuses a list file that was removed", () => {
    expect(onlyShrinks(base, null)).toEqual(["scripts/testing/known-failures.json was removed"]);
  });
});

describe("seedList", () => {
  it("lists every failure once, with the run that saw it", () => {
    const seeded = seedList({ $comment: "c", tests: [] }, [{ file: "a.test.ts", test: "x" }, { file: "a.test.ts", test: "x" }], { runUrl: "https://example.test/run/1", since: "2026-11-10" });
    expect(seeded.seeded).toBe("https://example.test/run/1");
    expect(seeded.tests).toEqual([{ file: "a.test.ts", test: "x", owner: "unassigned", reason: "Failing when the list was first filled by https://example.test/run/1.", since: "2026-11-10" }]);
  });
});

describe("updateSightings", () => {
  it("makes a new failure due for an issue the second time it is seen, and forgets it once it passes", () => {
    const failure = { file: "a.test.ts", test: "x" };
    const first = updateSightings(null, { newFailures: [failure], results: [{ ...failure, state: "fail" }], sha: "s1" });
    expect(first.due).toEqual([]);
    expect(first.sightings.lastSha).toBe("s1");
    const second = updateSightings(first.sightings, { newFailures: [failure], results: [{ ...failure, state: "fail" }], sha: "s2" });
    expect(second.due).toEqual([{ file: "a.test.ts", test: "x", count: 2, firstSha: "s1", lastSha: "s2", good: null, issue: null }]);
    const notRun = updateSightings(second.sightings, { newFailures: [], results: [], sha: "s3" });
    expect(notRun.sightings.tests[identityKey(failure)].count).toBe(2);
    const passed = updateSightings(notRun.sightings, { newFailures: [], results: [{ ...failure, state: "pass" }], sha: "s4", platforms: EVERY_PLATFORM });
    expect(passed.sightings.tests).toEqual({});
  });

  it("keeps a sighting through a Linux-only push that passes it; only a run on every platform forgets it", () => {
    const failure = { file: "a.test.ts", test: "windows only" };
    const fail = [{ ...failure, state: "fail" as const }];
    const pass = [{ ...failure, state: "pass" as const }];
    const nightly = updateSightings(null, { newFailures: [failure], results: fail, sha: "n1", platforms: EVERY_PLATFORM });
    expect(nightly.sightings.tests[identityKey(failure)].count).toBe(1);
    const push = updateSightings(nightly.sightings, { newFailures: [], results: pass, sha: "p1", platforms: ["ubuntu-latest"] });
    expect(push.sightings.tests[identityKey(failure)].count).toBe(1);
    const noPlatforms = updateSightings(push.sightings, { newFailures: [], results: pass, sha: "p2" });
    expect(noPlatforms.sightings.tests[identityKey(failure)].count).toBe(1);
    const nextNightly = updateSightings(noPlatforms.sightings, { newFailures: [failure], results: fail, sha: "n2", platforms: EVERY_PLATFORM });
    expect(nextNightly.due).toEqual([{ ...failure, count: 2, firstSha: "n1", lastSha: "n2", good: null, issue: null }]);
    const fixed = updateSightings(nightly.sightings, { newFailures: [], results: pass, sha: "n3", platforms: EVERY_PLATFORM });
    expect(fixed.sightings.tests).toEqual({});
  });

  it("does not count a second run on the same commit as a second sighting", () => {
    const failure = { file: "a.test.ts", test: "x" };
    const fail = [{ ...failure, state: "fail" as const }];
    const first = updateSightings(null, { newFailures: [failure], results: fail, sha: "s1", platforms: ["ubuntu-latest"] });
    const again = updateSightings(first.sightings, { newFailures: [failure], results: fail, sha: "s1", platforms: EVERY_PLATFORM });
    expect(again.sightings.tests[identityKey(failure)].count).toBe(1);
    expect(again.due).toEqual([]);
  });

  it("remembers the commit of the run before the first sighting as the last good one", () => {
    const before = updateSightings(null, { newFailures: [], results: [], sha: "good" });
    const failure = { file: "a.test.ts", test: "x" };
    const seen = updateSightings(before.sightings, { newFailures: [failure], results: [{ ...failure, state: "fail" }], sha: "bad" });
    expect(seen.sightings.tests[identityKey(failure)].good).toBe("good");
  });

  it("never makes a test due again once its issue is open", () => {
    const failure = { file: "a.test.ts", test: "x" };
    const prev = { lastSha: "s2", tests: { [identityKey(failure)]: { ...failure, count: 2, firstSha: "s1", lastSha: "s2", good: null, issue: 12 } } };
    expect(updateSightings(prev, { newFailures: [failure], results: [{ ...failure, state: "fail" }], sha: "s3" }).due).toEqual([]);
  });
});

describe("openRegressionIssues", () => {
  const due = [{ file: "a.test.ts", test: "x", count: 2, firstSha: "s1", lastSha: "s2", good: "s0", issue: null }];

  function fakeGitHub(openIssues: { number: number; body: string }[]) {
    const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
    const fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
      if (method === "GET") return new Response(JSON.stringify(openIssues), { status: 200 });
      if (path.endsWith("/labels")) return new Response("{}", { status: 422 });
      return new Response(JSON.stringify({ number: 77 }), { status: 201 });
    };
    return { calls, fetch };
  }

  it("opens one issue per test with the label regression, naming the pull request the bisect found", async () => {
    const github = fakeGitHub([]);
    const opened = await openRegressionIssues(due, {
      repo: "owner/repo", token: "t", fetch: github.fetch, runUrl: "https://example.test/run/2", apiUrl: "https://api.example.test",
      bisect: () => ({ verdict: "found", sha: "abc1234", subject: "feat: change (#42)", pullRequest: 42, runs: 3 }),
    });
    expect(opened).toEqual([{ key: identityKey(due[0]!), issue: 77, created: true }]);
    const create = github.calls.find((call) => call.method === "POST" && call.path === "/repos/owner/repo/issues");
    expect(create?.body?.labels).toEqual(["regression"]);
    expect(create?.body?.title).toBe("Regression: a.test.ts > x (broken by #42)");
    expect(String(create?.body?.body)).toContain(regressionMarker(due[0]!));
    expect(String(create?.body?.body)).toContain("https://example.test/run/2");
  });

  it("bisects a file once for all of its due tests, however many broke in one merge", async () => {
    const github = fakeGitHub([]);
    const many = ["x", "y", "z"].map((test) => ({ ...due[0]!, test }));
    const files: string[] = [];
    const opened = await openRegressionIssues([...many, { ...due[0]!, file: "b.test.ts" }], {
      repo: "owner/repo", token: "t", fetch: github.fetch, runUrl: "u", apiUrl: "https://api.example.test",
      bisect: (entry: { file: string }) => {
        files.push(entry.file);
        return { verdict: "found", sha: "abc1234", subject: "feat: change (#42)", pullRequest: 42, runs: 3 };
      },
    });
    expect(files).toEqual(["a.test.ts", "b.test.ts"]);
    expect(opened).toHaveLength(4);
    const titles = github.calls.filter((call) => call.method === "POST" && call.path.endsWith("/issues")).map((call) => call.body?.title);
    expect(titles.slice(0, 3)).toEqual(["x", "y", "z"].map((test) => `Regression: a.test.ts > ${test} (broken by #42)`));
  });

  it("still opens every issue once the bisect budget is spent, without naming a pull request", async () => {
    const github = fakeGitHub([]);
    let clock = 0;
    const deadlines: number[] = [];
    const opened = await openRegressionIssues([due[0]!, { ...due[0]!, file: "b.test.ts" }], {
      repo: "owner/repo", token: "t", fetch: github.fetch, runUrl: "u", apiUrl: "https://api.example.test",
      budgetMs: 60_000, now: () => clock,
      bisect: (_entry: unknown, { deadline }: { deadline: number }) => {
        deadlines.push(deadline);
        clock += 61_000; // this bisect used the whole budget
        return { verdict: "out-of-time", runs: 2, detail: "the time ran out." };
      },
    });
    expect(deadlines).toEqual([60_000]);
    expect(opened.map((item) => item.created)).toEqual([true, true]);
    const bodies = github.calls.filter((call) => call.method === "POST" && call.path.endsWith("/issues")).map((call) => call.body!);
    expect(bodies.map((body) => body.title)).toEqual(["Regression: a.test.ts > x", "Regression: b.test.ts > x"]);
    expect(String(bodies[1]!.body)).toContain("Bisect could not name a merge (out-of-time)");
    expect(String(bodies[1]!.body)).toContain("node scripts/stability/bisect.mjs --file b.test.ts");
  });

  it("does not open a second issue for a test that already has one", async () => {
    const github = fakeGitHub([{ number: 5, body: `text ${regressionMarker(due[0]!)}` }]);
    const opened = await openRegressionIssues(due, { repo: "owner/repo", token: "t", fetch: github.fetch, runUrl: "u", apiUrl: "https://api.example.test", bisect: () => null });
    expect(opened).toEqual([{ key: identityKey(due[0]!), issue: 5, created: false }]);
    expect(github.calls.filter((call) => call.method === "POST" && call.path.endsWith("/issues"))).toEqual([]);
  });
});

describe("the command line", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env }, timeout: 20_000 });

  function shardResults(dir: string, name: string, results: unknown[]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ results }));
  }

  it("fails a run with an unlisted failure, names it, and writes the shrunk list", () => {
    const dir = tempDir();
    const list = join(dir, "list.json");
    writeFileSync(list, JSON.stringify({ $comment: "c", seeded: "s", tests: [entry("a.test.ts", "listed"), entry("a.test.ts", "fixed")] }));
    shardResults(join(dir, "results"), "linux-1", [
      { file: "a.test.ts", test: "listed", state: "fail" },
      { file: "a.test.ts", test: "fixed", state: "pass" },
      { file: "a.test.ts", test: "planted", state: "fail" },
    ]);
    const out = join(dir, "out");
    const result = run(["report", "--results", join(dir, "results"), "--expect", "1", "--list", list, "--platforms", JSON.stringify(EVERY_PLATFORM), "--out", out]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain("::error file=a.test.ts,title=Failure not in the known-failures list::planted");
    expect(JSON.parse(readFileSync(join(out, "known-failures.json"), "utf8")).tests.map((test: { test: string }) => test.test)).toEqual(["listed"]);
    expect(JSON.parse(readFileSync(join(out, "new-failures.json"), "utf8"))).toEqual([{ file: "a.test.ts", test: "planted" }]);
  });

  it("keeps a listed test that passed in a run on Linux only, since it may still fail on Windows or macOS", () => {
    const dir = tempDir();
    const list = join(dir, "list.json");
    const tests = [entry("a.test.ts", "fails on windows only"), entry("a.test.ts", "still failing")];
    writeFileSync(list, JSON.stringify({ $comment: "c", seeded: "s", tests }));
    shardResults(join(dir, "results"), "ubuntu-latest-1", [
      { file: "a.test.ts", test: "fails on windows only", state: "pass" },
      { file: "a.test.ts", test: "still failing", state: "fail" },
    ]);
    const out = join(dir, "out");
    const result = run(["report", "--results", join(dir, "results"), "--expect", "1", "--list", list, "--platforms", '["ubuntu-latest"]', "--out", out]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "known-failures.json"), "utf8")).tests.map((test: { test: string }) => test.test)).toEqual(["fails on windows only", "still failing"]);
    expect(result.stdout).not.toContain("Known failure passed");
    expect(result.stdout).toContain("1 listed test(s) passed on ubuntu-latest only; they stay in the list");
    // The nightly run on every platform then sees it fail on Windows: still listed, still green.
    shardResults(join(dir, "results"), "windows-latest-1", [{ file: "a.test.ts", test: "fails on windows only", state: "fail" }]);
    const nightly = run(["report", "--results", join(dir, "results"), "--expect", "2", "--list", join(out, "known-failures.json"), "--platforms", JSON.stringify(EVERY_PLATFORM), "--out", join(dir, "nightly")]);
    expect(nightly.status, nightly.stdout).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "nightly", "new-failures.json"), "utf8"))).toEqual([]);
  });

  it("shrinks only for a run that covered every platform", () => {
    expect(coversEveryPlatform(["ubuntu-latest"])).toBe(false);
    expect(coversEveryPlatform(["ubuntu-latest", "windows-latest"])).toBe(false);
    expect(coversEveryPlatform(undefined)).toBe(false);
    expect(coversEveryPlatform(["windows-latest", "ubuntu-latest", "macos-latest"])).toBe(true);
  });

  it("is green when every failure is listed, and red when a shard sent no results", () => {
    const dir = tempDir();
    const list = join(dir, "list.json");
    writeFileSync(list, JSON.stringify({ $comment: "c", seeded: "s", tests: [entry("a.test.ts", "listed")] }));
    shardResults(join(dir, "results"), "linux-1", [{ file: "a.test.ts", test: "listed", state: "fail" }]);
    expect(run(["report", "--results", join(dir, "results"), "--expect", "1", "--list", list, "--out", join(dir, "o1")]).status).toBe(0);
    const missing = run(["report", "--results", join(dir, "results"), "--expect", "2", "--list", list, "--out", join(dir, "o2")]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("1 of 2 test jobs sent results");
  });

  it("fills the list from a run in seed mode and stays green", () => {
    const dir = tempDir();
    const list = join(dir, "list.json");
    writeFileSync(list, JSON.stringify({ $comment: "c", tests: [] }));
    shardResults(join(dir, "results"), "linux-1", [{ file: "a.test.ts", test: "red today", state: "fail" }]);
    const result = run(["report", "--results", join(dir, "results"), "--expect", "1", "--list", list, "--out", join(dir, "out"), "--seed", "--run-url", "https://example.test/run/9"]);
    expect(result.status, result.stderr).toBe(0);
    const seeded = JSON.parse(readFileSync(join(dir, "out", "known-failures.json"), "utf8"));
    expect(seeded.seeded).toBe("https://example.test/run/9");
    expect(seeded.tests.map((test: { test: string }) => test.test)).toEqual(["red today"]);
  });

  it("extracts a shard's results from a vitest JSON report", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "report.json"), JSON.stringify(report([{ name: "server/a.test.ts", status: "failed", tests: [[["d"], "t", "failed"]] }])));
    const result = run(["extract", "--report", join(dir, "report.json"), "--root", root, "--exit", "1", "--out", join(dir, "shard.json")]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "shard.json"), "utf8")).results).toContainEqual({ file: "server/a.test.ts", test: "d > t", state: "fail" });
  });

  it("checks against a git revision that the list only shrank", () => {
    const repo = tempDir();
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "ci@example.test");
    git("config", "user.name", "ci");
    mkdirSync(join(repo, "scripts", "testing"), { recursive: true });
    const file = join(repo, "scripts", "testing", "known-failures.json");
    writeFileSync(file, JSON.stringify({ $comment: "c", seeded: "s", tests: [entry("a.test.ts", "one")] }));
    git("add", ".");
    git("commit", "-qm", "base");
    writeFileSync(file, JSON.stringify({ $comment: "c", seeded: "s", tests: [entry("a.test.ts", "one"), entry("a.test.ts", "two")] }));
    const grown = spawnSync(process.execPath, [script, "check-shrink", "--base", "HEAD"], { cwd: repo, encoding: "utf8" });
    expect(grown.status).toBe(1);
    expect(grown.stdout).toContain("a.test.ts > two was added");
    writeFileSync(file, JSON.stringify({ $comment: "c", seeded: "s", tests: [] }));
    expect(spawnSync(process.execPath, [script, "check-shrink", "--base", "HEAD"], { cwd: repo, encoding: "utf8" }).status).toBe(0);
  });
});
