import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, planClosures } from "./close-green-regressions.mjs";
import { identityKey, regressionMarker } from "./known-failures.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An issue the rail opened for one test: its title and its marker. */
const oneTest = (number: number, file: string, test: string, culprit = "") =>
  ({ number, title: `Regression: ${file} > ${test}${culprit}`, body: `text\n\n${regressionMarker({ file, test })}` });

/** A green run's results as the vitest jobs upload them, its sightings, and the open issues. */
function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), "close-green-"));
  dirs.push(dir);
  const results = join(dir, "results");
  mkdirSync(results);
  writeFileSync(join(results, "ubuntu-latest-1.json"), JSON.stringify({ results: [
    { file: "server/a.test.ts", test: "outer > passes now", state: "pass" },
    { file: "server/a.test.ts", test: "still fails", state: "fail" },
    { file: "server/b.test.ts", test: "(whole file)", state: "pass" },
    { file: "server/c.test.ts", test: "passes on one job only", state: "pass" },
    { file: "server/d.test.ts", test: "failed on windows", state: "pass" },
  ] }));
  writeFileSync(join(results, "windows-latest-1.json"), JSON.stringify({ results: [
    { file: "server/c.test.ts", test: "passes on one job only", state: "fail" },
  ] }));
  const issueList = [
    oneTest(1, "server/a.test.ts", "outer > passes now", " (broken by #42)"),
    oneTest(2, "server/a.test.ts", "still fails"),
    oneTest(3, "server/a.test.ts", "not in the run"),
    oneTest(4, "server/b.test.ts", "(whole file)"),
    oneTest(5, "server/c.test.ts", "passes on one job only"),
    oneTest(6, "server/d.test.ts", "failed on windows"),
    { number: 7, title: "Regression: Swift package tests (swift test --package-path ios)", body: "No marker of a vitest test." },
  ];
  const issues = join(dir, "issues.json");
  writeFileSync(issues, JSON.stringify(issueList));
  // Seen on Linux, except #6, seen on Windows.
  const sightings = join(dir, "sightings.json");
  const failedOn = (file: string, test: string, os = "ubuntu-latest") => [identityKey({ file, test }), { file, test, failedOn: [os] }];
  writeFileSync(sightings, JSON.stringify({ tests: Object.fromEntries([
    failedOn("server/a.test.ts", "outer > passes now"),
    failedOn("server/a.test.ts", "still fails"),
    failedOn("server/b.test.ts", "(whole file)"),
    failedOn("server/c.test.ts", "passes on one job only"),
    failedOn("server/d.test.ts", "failed on windows", "windows-latest"),
  ]) }));
  return { results, issues, sightings };
}

describe("close-green-regressions (#4037)", () => {
  it("closes only an issue whose test ran and passed in every job, and keeps the others with the reason", () => {
    const everywhere = (test: string, state: string) => ["macos-latest", "ubuntu-latest", "windows-latest"].map((os) => ({ file: "a.test.ts", test, state, os }));
    const { close, keep } = planClosures(
      [oneTest(1, "a.test.ts", "x"), oneTest(2, "a.test.ts", "y"), oneTest(3, "a.test.ts", "z"), { number: 4, title: "Something else", body: "" }],
      [...everywhere("x", "pass"), ...everywhere("y", "fail")],
    );
    expect(close.map((issue) => issue.number)).toEqual([1]);
    expect(keep.map((issue) => [issue.number, issue.reason])).toEqual([
      [2, "a test of it failed in this run"],
      [3, "a test of it did not run in this run, or not on each runner it failed on"],
      [4, "it names no test of the rail"],
    ]);
  });

  it("lists what it would close by default and closes nothing", () => {
    const { results, issues, sightings } = fixtures();
    const calls: string[][] = [];
    const lines: string[] = [];
    const code = main(["--run", "123", "--repo", "owner/repo", "--results", results, "--issues", issues, "--sightings", sightings], { run: (args) => { calls.push(args); return "{}"; }, log: (line) => lines.push(line) });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(lines.filter((line) => line.startsWith("Would close"))).toEqual([
      "Would close #1 Regression: server/a.test.ts > outer > passes now (broken by #42)",
      "Would close #4 Regression: server/b.test.ts > (whole file)",
    ]);
    expect(lines.at(-1)).toBe("2 issue(s) to close (dry run; add --close to close them), 5 kept.");
    expect(lines).toContain("Kept 1: it names no test of the rail.");
  });

  it("closes them with --close, with the run as evidence", () => {
    const { results, issues, sightings } = fixtures();
    const calls: string[][] = [];
    main(["--run", "123", "--repo", "owner/repo", "--results", results, "--issues", issues, "--sightings", sightings, "--close"], { run: (args) => { calls.push(args); return "{}"; }, log: () => {} });
    expect(calls.map((args) => args.slice(0, 3))).toEqual([["issue", "close", "1"], ["issue", "close", "4"]]);
    expect(calls[0]).toContain("--repo");
    expect(calls[0]!.at(-1)).toContain("https://github.com/owner/repo/actions/runs/123");
  });

  it("downloads the run's results and sightings and lists the open issues through gh when no fixture is given", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args[1] === "view") return JSON.stringify({ headSha: "abc", url: "https://example.test/run/123", conclusion: "success", headBranch: "main" });
      if (args[1] === "download") {
        const dir = args[args.indexOf("--dir") + 1]!;
        if (args.includes("known-failures-sightings")) writeFileSync(join(dir, "sightings.json"), JSON.stringify({ tests: { [identityKey({ file: "server/a.test.ts", test: "x" })]: { failedOn: ["ubuntu-latest"], issue: 1 } } }));
        else writeFileSync(join(dir, "ubuntu-latest-1.json"), JSON.stringify({ results: [{ file: "server/a.test.ts", test: "x", state: "pass" }] }));
        return "";
      }
      return JSON.stringify([oneTest(1, "server/a.test.ts", "x")]);
    };
    const lines: string[] = [];
    main(["--run", "123", "--close"], { run, log: (line) => lines.push(line) });
    expect(calls.map((args) => args.slice(0, 2).join(" "))).toEqual(["run view", "run download", "run download", "issue list", "issue close"]);
    expect(calls[1]).toContain("vitest-results-*");
    expect(calls[2]).toContain("known-failures-sightings");
    expect(calls[3]).toContain("number,title,body");
    expect(calls[4]!.at(-1)).toContain("https://example.test/run/123 (commit abc)");
    expect(lines[0]).toContain("on main, success");
  });

  it("closes an issue seen on one platform only from a run that covers that platform, as the rail does (#4052)", () => {
    const issues = [oneTest(1, "a.test.ts", "failed on windows"), oneTest(2, "a.test.ts", "no record")];
    const sightings = { tests: { [identityKey({ file: "a.test.ts", test: "failed on windows" })]: { file: "a.test.ts", test: "failed on windows", failedOn: ["windows-latest"], issue: 1 } } };
    const linux = [
      { file: "a.test.ts", test: "failed on windows", state: "pass", os: "ubuntu-latest" },
      { file: "a.test.ts", test: "no record", state: "pass", os: "ubuntu-latest" },
    ];
    // A Linux push passes both: neither is known green where it failed.
    expect(planClosures(issues, linux, { sightings }).close).toEqual([]);
    // The Windows job passes the first: closed; the second needs every platform.
    expect(planClosures(issues, [...linux, { file: "a.test.ts", test: "failed on windows", state: "pass", os: "windows-latest" }], { sightings }).close.map((item) => item.number)).toEqual([1]);
    const everywhere = ["macos-latest", "ubuntu-latest", "windows-latest"].map((os) => ({ file: "a.test.ts", test: "no record", state: "pass", os }));
    expect(planClosures(issues, everywhere, { sightings }).close.map((item) => item.number)).toEqual([2]);
  });

  it("refuses a run id that is not a number", () => {
    expect(main(["--run", "abc"], { run: () => "", log: () => {} })).toBe(2);
  });
});
