import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  coversEveryPlatform,
  EVERY_PLATFORM,
  extractResults,
  failingSwiftTests,
  filesRunOn,
  jobsWithoutRunner,
  identityKey,
  listedGuardTests,
  onlyShrinks,
  openRegressionIssues,
  openSwiftRegressionIssue,
  regressionMarker,
  seedList,
  shrink,
  SWIFT_IDENTITY,
  swiftOutcome,
  updateSightings,
  WHOLE_FILE,
} from "./known-failures.mjs";

const script = fileURLToPath(new URL("./known-failures.mjs", import.meta.url));
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
/** A job's steps as ci.yml reads them from the Actions API: one step ran. */
const RAN = [{ status: "completed", conclusion: "success" }];

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

describe("filesRunOn and jobsWithoutRunner (#3672)", () => {
  it("names the files that ran on every platform, a row without a runner counting for each", () => {
    const results = [
      { file: "a.test.ts", test: WHOLE_FILE, state: "pass" as const, os: "ubuntu-latest" },
      { file: "a.test.ts", test: WHOLE_FILE, state: "pass" as const, os: "macos-latest" },
      { file: "b.test.ts", test: WHOLE_FILE, state: "pass" as const, os: "ubuntu-latest" },
      { file: "c.test.ts", test: WHOLE_FILE, state: "pass" as const },
    ];
    expect([...filesRunOn(results, ["macos-latest", "ubuntu-latest"])].sort()).toEqual(["a.test.ts", "c.test.ts"]);
  });

  it("lists the vitest jobs with no step and no results, and only those", () => {
    const jobs = [
      { name: "vitest (macos-latest, shard 4/20)", conclusion: "cancelled", steps: [] },
      { name: "vitest (macos-latest, shard 3/20)", conclusion: "success", steps: RAN },
      { name: "vitest (windows-latest, shard 1/20)", conclusion: "cancelled", steps: RAN },
      { name: "vitest (macos-latest, shard 9/20)", conclusion: "skipped", steps: [] },
      { name: "vitest (macos-latest, shard 8/20)", conclusion: "cancelled", steps: [] },
      // listed steps that never started: the release gate's neverStarted rule
      { name: "vitest (macos-latest, shard 11/20)", conclusion: "failure", steps: [{ status: "queued", conclusion: null }] },
      { name: "Swift tests + iOS build", conclusion: "cancelled", steps: [] },
    ];
    expect(jobsWithoutRunner(jobs, ["macos-latest-3"])).toEqual([{ os: "macos-latest", shard: 4 }, { os: "macos-latest", shard: 8 }, { os: "macos-latest", shard: 11 }]);
    expect(jobsWithoutRunner(jobs, ["macos-latest-4", "macos-latest-8", "macos-latest-11"])).toEqual([]);
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
    expect(updateSightings(prev, { newFailures: [failure], results: [{ ...failure, state: "fail" }], sha: "s3", openIssues: new Set([12]) }).due).toEqual([]);
  });

  it("counts a test again once its issue is closed, and opens a new one when it is seen twice more (#3672)", () => {
    // Main's runs of 2026-11-11: the peer inbox test kept failing while its
    // sighting still named issue #3650, closed by its fix. A failure after
    // the fix would never have opened an issue again.
    const failure = { file: "a.test.ts", test: "x" };
    const fail = [{ ...failure, state: "fail" as const }];
    const prev = { lastSha: "s7", tests: { [identityKey(failure)]: { ...failure, count: 7, firstSha: "s1", lastSha: "s7", good: "s0", issue: 3650 } } };
    const after = updateSightings(prev, { newFailures: [failure], results: fail, sha: "s8", openIssues: new Set() });
    expect(after.due).toEqual([]);
    expect(after.sightings.tests[identityKey(failure)]).toEqual({ ...failure, count: 1, firstSha: "s8", lastSha: "s8", good: "s7", issue: null });
    const again = updateSightings(after.sightings, { newFailures: [failure], results: fail, sha: "s9", openIssues: new Set() });
    expect(again.due).toEqual([{ ...failure, count: 2, firstSha: "s8", lastSha: "s9", good: "s7", issue: null }]);
  });

  it("keeps a sighting whose file did not run on every platform of a nightly run (#3672)", () => {
    const failure = { file: "a.test.ts", test: "mac only" };
    const first = updateSightings(null, { newFailures: [failure], results: [{ ...failure, state: "fail", os: "macos-latest" }], sha: "n1", platforms: EVERY_PLATFORM });
    const pass = (os: string) => ({ ...failure, state: "pass" as const, os });
    const noMacRunner = updateSightings(first.sightings, { newFailures: [], results: [pass("ubuntu-latest"), pass("windows-latest")], sha: "n2", platforms: EVERY_PLATFORM });
    expect(noMacRunner.sightings.tests[identityKey(failure)].count).toBe(1);
    const everywhere = updateSightings(noMacRunner.sightings, { newFailures: [], results: EVERY_PLATFORM.map(pass), sha: "n3", platforms: EVERY_PLATFORM });
    expect(everywhere.sightings.tests).toEqual({});
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

describe("the Swift package tests on main (#3678)", () => {
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/swift-test/${name}.txt`, import.meta.url), "utf8");
  const step = (name: string, conclusion: string | null) => ({ name, status: "completed", conclusion });
  const job = (name: string, conclusion: string, steps: unknown[]) => ({ name, conclusion, steps });

  it("reads the Swift step of the job after a merge and of the nightly's ios job", () => {
    const ranRed = [step("Set up job", "success"), step("Swift package tests", "failure"), step("Upload the Swift test log", "success")];
    expect(swiftOutcome([job("Swift package tests", "failure", ranRed)])).toEqual({ state: "fail", job: "Swift package tests" });
    expect(swiftOutcome([job("Swift tests + iOS build", "failure", ranRed)])).toEqual({ state: "fail", job: "Swift tests + iOS build" });
    // the nightly's simulator build failed after green Swift tests: not a Swift failure
    const swiftGreen = [step("Set up job", "success"), step("Swift package tests", "success"), step("Build the simulator app", "failure")];
    expect(swiftOutcome([job("Swift tests + iOS build", "failure", swiftGreen)])).toEqual({ state: "pass", job: "Swift tests + iOS build" });
    // a timeout cancels the step: a failure
    expect(swiftOutcome([job("Swift package tests", "failure", [step("Set up job", "success"), step("Swift package tests", "cancelled")])])!.state).toBe("fail");
  });

  it("tells a runner that never came, a job stopped before the tests and a run without Swift from a failure", () => {
    expect(swiftOutcome([job("Swift package tests", "failure", [])])).toEqual({ state: "no-runner", job: "Swift package tests" });
    expect(swiftOutcome([job("Swift package tests", "failure", [step("Set up job", "success"), step("Run actions/checkout", "failure"), step("Swift package tests", "skipped")])])!.state).toBe("not-run");
    expect(swiftOutcome([job("Swift package tests", "skipped", []), job("Swift tests + iOS build", "skipped", [])])).toBeNull();
    expect(swiftOutcome([job("vitest (ubuntu-latest, shard 1/20)", "failure", RAN)])).toBeNull();
    expect(swiftOutcome(undefined)).toBeNull();
  });

  it("names the failing test cases of a recorded swift test log, with the assertion, paths cut to the repository", () => {
    expect(failingSwiftTests(fixture("test-failure"))).toEqual({
      tests: ["CompanionCoreTests.AccountAvatarTests.testAnOrganizationSessionNamesThePersonsVersionedAvatar"],
      errors: ["ios/Tests/CompanionCoreTests/AccountAvatarTests.swift:70: error: -[CompanionCoreTests.AccountAvatarTests testAnOrganizationSessionNamesThePersonsVersionedAvatar] : XCTAssertEqual failed: (\"Alex Martin\") is not equal to (\"Not The Name\")"],
    });
  });

  it("names no test and keeps the compiler's errors when the package did not build", () => {
    const { tests, errors } = failingSwiftTests(fixture("build-failure"));
    expect(tests).toEqual([]);
    expect(errors).toContain("ios/Tests/CompanionCoreTests/AccountAvatarTests.swift:70:27: error: cannot convert value of type 'String' to specified type 'Int'");
    expect(errors).toContain("error: Build failed");
    expect(errors.join("\n")).not.toContain(String.fromCharCode(27));
  });

  it("reads swift-testing's failures too", () => {
    const log = "✔ Test passes() passed after 0.001 seconds.\n✘ Test decodesTheTurn() recorded an issue at DecodingTests.swift:3:5: Expectation failed\n✘ Test decodesTheTurn() failed after 0.002 seconds with 1 issue.\n";
    expect(failingSwiftTests(log).tests).toEqual(["decodesTheTurn()"]);
  });

  function fakeGitHub(openIssues: { number: number; body: string }[]) {
    const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
    const fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
      if (method === "GET") return new Response(JSON.stringify(openIssues), { status: 200 });
      if (path.endsWith("/labels")) return new Response("{}", { status: 422 });
      return new Response(JSON.stringify({ number: 88 }), { status: 201 });
    };
    return { calls, fetch };
  }
  const failure = { job: "Swift package tests", tests: ["CompanionCoreTests.AccountAvatarTests.testX"], errors: ["ios/Tests/A.swift:1: error: boom"] };

  it("opens one regression issue at the first failure, naming the commit, the job, the tests and the run", async () => {
    const github = fakeGitHub([]);
    const result = await openSwiftRegressionIssue(failure, { repo: "o/r", token: "t", fetch: github.fetch, runUrl: "https://example.test/run/3", sha: "abc123", apiUrl: "https://api.example.test" });
    expect(result).toEqual({ issue: 88, created: true });
    const create = github.calls.find((call) => call.method === "POST" && call.path === "/repos/o/r/issues")!;
    expect(create.body?.labels).toEqual(["regression"]);
    expect(create.body?.title).toBe("Regression: Swift package tests (swift test --package-path ios)");
    const body = String(create.body?.body);
    for (const text of ["abc123", "\"Swift package tests\"", "`CompanionCoreTests.AccountAvatarTests.testX`", "ios/Tests/A.swift:1: error: boom", "https://example.test/run/3", "first failure on main", regressionMarker(SWIFT_IDENTITY)]) {
      expect(body).toContain(text);
    }
  });

  it("comments on the open issue instead of opening a second one", async () => {
    const github = fakeGitHub([{ number: 12, body: `old ${regressionMarker(SWIFT_IDENTITY)}` }]);
    const result = await openSwiftRegressionIssue({ ...failure, tests: [], errors: [] }, { repo: "o/r", token: "t", fetch: github.fetch, runUrl: "u", sha: "def456", apiUrl: "https://api.example.test" });
    expect(result).toEqual({ issue: 12, created: false });
    expect(github.calls.filter((call) => call.method === "POST" && call.path === "/repos/o/r/issues")).toEqual([]);
    const comment = github.calls.find((call) => call.path === "/repos/o/r/issues/12/comments")!;
    expect(String(comment.body?.body)).toContain("def456");
    expect(String(comment.body?.body)).toContain("the package did not build");
  });

  /** open-issues against a local GitHub; the command runs asynchronously so it can answer. */
  async function openIssuesCli(jobs: unknown[], log: string | null) {
    const dir = tempDir();
    writeFileSync(join(dir, "results.json"), "[]");
    writeFileSync(join(dir, "new.json"), "[]");
    writeFileSync(join(dir, "jobs.jsonl"), jobs.map((item) => JSON.stringify(item)).join("\n"));
    if (log !== null) writeFileSync(join(dir, "swift-test.txt"), log);
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    const server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => {
        if (request.method === "GET") { response.end("[]"); return; }
        posts.push({ path: request.url!, body: JSON.parse(text || "{}") });
        response.statusCode = 201;
        response.end(JSON.stringify({ number: 99 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const env = { ...process.env, GITHUB_STEP_SUMMARY: "", GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", GITHUB_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(process.execPath, [script, "open-issues", "--results", join(dir, "results.json"), "--new-failures", join(dir, "new.json"), "--sha", "s9",
          "--run-url", "https://example.test/run/9", "--out", join(dir, "sightings.json"), "--jobs", join(dir, "jobs.jsonl"), "--swift-log", join(dir, "swift-test.txt")],
        { env, encoding: "utf8", timeout: 20_000 }, (error, out, err) => (error ? reject(new Error(`${error.message}\n${err}`)) : resolve(out)));
      });
      return { stdout, posts };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("opens the issue from the command line with the tests of the uploaded log", async () => {
    const red = [{ name: "Swift package tests", conclusion: "failure", steps: [step("Set up job", "success"), step("Swift package tests", "failure")] }];
    const { stdout, posts } = await openIssuesCli(red, fixture("test-failure"));
    expect(stdout).toContain("Opened #99 for the red Swift package tests.");
    const issue = posts.find((post) => post.path === "/repos/o/r/issues")!;
    expect(String(issue.body.body)).toContain("CompanionCoreTests.AccountAvatarTests.testAnOrganizationSessionNamesThePersonsVersionedAvatar");
    expect(String(issue.body.body)).toContain("s9");
    expect(String(issue.body.body)).toContain("https://example.test/run/9");
  });

  it("opens nothing for a Swift job that got no runner, or that passed", async () => {
    for (const jobs of [[{ name: "Swift package tests", conclusion: "failure", steps: [] }], [{ name: "Swift package tests", conclusion: "success", steps: [step("Swift package tests", "success")] }]]) {
      const { stdout, posts } = await openIssuesCli(jobs, null);
      expect(posts.filter((post) => post.path.endsWith("/issues") || post.path.endsWith("/comments"))).toEqual([]);
      if (jobs[0]!.conclusion === "failure") expect(stdout).toContain("got no runner");
    }
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
    for (const os of EVERY_PLATFORM) {
      shardResults(join(dir, "results"), `${os}-1`, [
        { file: "a.test.ts", test: "listed", state: "fail" },
        { file: "a.test.ts", test: "fixed", state: "pass" },
        { file: "a.test.ts", test: "planted", state: "fail" },
      ]);
    }
    const out = join(dir, "out");
    const result = run(["report", "--results", join(dir, "results"), "--expect", "3", "--list", list, "--platforms", JSON.stringify(EVERY_PLATFORM), "--out", out]);
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

  it("tells a test job that got no runner from a crash, and keeps the listed tests it did not run (#3672)", () => {
    // The nightly run of 2026-11-11: six macOS shards never got a runner. Its
    // check called that a crash, and listed tests of those shards that passed
    // on Linux and Windows left the list without running on macOS.
    const dir = tempDir();
    const list = join(dir, "list.json");
    writeFileSync(list, JSON.stringify({ $comment: "c", seeded: "s", tests: [entry("one.test.ts", "passes everywhere"), entry("two.test.ts", "passes where it ran")] }));
    for (const os of EVERY_PLATFORM) shardResults(join(dir, "results"), `${os}-1`, [{ file: "one.test.ts", test: "passes everywhere", state: "pass" }, { file: "one.test.ts", test: WHOLE_FILE, state: "pass" }]);
    for (const os of ["ubuntu-latest", "windows-latest"]) shardResults(join(dir, "results"), `${os}-2`, [{ file: "two.test.ts", test: "passes where it ran", state: "pass" }]);
    const jobs = join(dir, "jobs.jsonl");
    writeFileSync(jobs, [
      { name: "vitest (macos-latest, shard 1/2)", conclusion: "success", steps: RAN },
      { name: "vitest (macos-latest, shard 2/2)", conclusion: "cancelled", steps: [] },
      { name: "vitest (ubuntu-latest, shard 2/2)", conclusion: "success", steps: RAN },
      { name: "known failures", conclusion: null, steps: RAN },
    ].map((job) => JSON.stringify(job)).join("\n"));
    const args = ["report", "--results", join(dir, "results"), "--expect", "6", "--list", list, "--platforms", JSON.stringify(EVERY_PLATFORM)];
    const nightly = run([...args, "--jobs", jobs, "--out", join(dir, "out")]);
    expect(nightly.status, nightly.stdout).toBe(0);
    expect(nightly.stdout).toContain("5 of 6 test jobs sent results.");
    expect(nightly.stdout).toContain("1 test job(s) of macos-latest got no runner (shard 2): GitHub never gave them a machine, so their tests did not run on macos-latest. This is not a test failure");
    expect(nightly.stdout).not.toContain("crashed");
    expect(nightly.stdout).toContain("1 listed test(s) passed but did not run on every platform");
    expect(JSON.parse(readFileSync(join(dir, "out", "known-failures.json"), "utf8")).tests.map((test: { test: string }) => test.test)).toEqual(["passes where it ran"]);
    // Without the run's job list, a missing job still reads as a crash: red.
    const crash = run([...args, "--out", join(dir, "crash")]);
    expect(crash.status).toBe(1);
    expect(crash.stdout).toContain("1 test job(s) crashed or timed out before writing their results, so this run is red.");
    // A job that ran and sent nothing is a crash even with the job list.
    writeFileSync(jobs, JSON.stringify({ name: "vitest (macos-latest, shard 2/2)", conclusion: "failure", steps: RAN }));
    expect(run([...args, "--jobs", jobs, "--out", join(dir, "ran")]).status).toBe(1);
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

  it("still writes this run's sightings when the open issues cannot be listed (#3672)", () => {
    const dir = tempDir();
    const failure = { file: "a.test.ts", test: "red", os: "ubuntu" };
    writeFileSync(join(dir, "results.json"), JSON.stringify([{ ...failure, state: "fail" }]));
    writeFileSync(join(dir, "new.json"), JSON.stringify([failure]));
    const out = join(dir, "sightings.json");
    const result = run(
      ["open-issues", "--results", join(dir, "results.json"), "--new-failures", join(dir, "new.json"), "--sha", "s1", "--out", out],
      { GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", GITHUB_API_URL: "http://127.0.0.1:1" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Open regression issues not listed");
    expect(Object.keys(JSON.parse(readFileSync(out, "utf8")).tests)).toEqual([identityKey(failure)]);
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
