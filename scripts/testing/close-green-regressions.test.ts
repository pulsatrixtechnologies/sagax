import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, parseRegressionTitle, planClosures } from "./close-green-regressions.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A green run's results as the vitest jobs upload them, and the open issues. */
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
  ] }));
  writeFileSync(join(results, "windows-latest-1.json"), JSON.stringify({ results: [
    { file: "server/c.test.ts", test: "passes on one job only", state: "fail" },
  ] }));
  const issues = join(dir, "issues.json");
  writeFileSync(issues, JSON.stringify([
    { number: 1, title: "Regression: server/a.test.ts > outer > passes now (broken by #42)" },
    { number: 2, title: "Regression: server/a.test.ts > still fails" },
    { number: 3, title: "Regression: server/a.test.ts > not in the run" },
    { number: 4, title: "Regression: server/b.test.ts > (whole file)" },
    { number: 5, title: "Regression: server/c.test.ts > passes on one job only" },
    { number: 6, title: "Regression: Swift package tests (swift test --package-path ios)" },
    { number: 7, title: "Regression: 50 tests failing on main at abc1234" },
  ]));
  return { results, issues };
}

describe("close-green-regressions (#4037)", () => {
  it("reads the test a regression issue's title names, keeping the describe blocks of its name", () => {
    expect(parseRegressionTitle("Regression: server/a.test.ts > outer > inner (broken by #42)")).toEqual({ file: "server/a.test.ts", test: "outer > inner" });
    expect(parseRegressionTitle("Regression: server/a.test.ts > plain")).toEqual({ file: "server/a.test.ts", test: "plain" });
    expect(parseRegressionTitle("Regression: Swift package tests (swift test --package-path ios)")).toBeNull();
    expect(parseRegressionTitle("Something else")).toBeNull();
  });

  it("closes only an issue whose test ran and passed in every job, and keeps the others with the reason", () => {
    const { close, keep } = planClosures(
      [{ number: 1, title: "Regression: a.test.ts > x" }, { number: 2, title: "Regression: a.test.ts > y" }, { number: 3, title: "Regression: a.test.ts > z" }],
      [{ file: "a.test.ts", test: "x", state: "pass" }, { file: "a.test.ts", test: "y", state: "fail" }],
    );
    expect(close.map((issue) => issue.number)).toEqual([1]);
    expect(keep.map((issue) => [issue.number, issue.reason])).toEqual([[2, "its test failed in this run"], [3, "its test did not run in this run"]]);
  });

  it("lists what it would close by default and closes nothing", () => {
    const { results, issues } = fixtures();
    const calls: string[][] = [];
    const lines: string[] = [];
    const code = main(["--run", "123", "--repo", "owner/repo", "--results", results, "--issues", issues], { run: (args) => { calls.push(args); return "{}"; }, log: (line) => lines.push(line) });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(lines.filter((line) => line.startsWith("Would close"))).toEqual([
      "Would close #1 Regression: server/a.test.ts > outer > passes now (broken by #42)",
      "Would close #4 Regression: server/b.test.ts > (whole file)",
    ]);
    expect(lines.at(-1)).toBe("2 issue(s) to close (dry run; add --close to close them), 5 kept.");
  });

  it("closes them with --close, with the run as evidence", () => {
    const { results, issues } = fixtures();
    const calls: string[][] = [];
    main(["--run", "123", "--repo", "owner/repo", "--results", results, "--issues", issues, "--close"], { run: (args) => { calls.push(args); return "{}"; }, log: () => {} });
    expect(calls.map((args) => args.slice(0, 3))).toEqual([["issue", "close", "1"], ["issue", "close", "4"]]);
    expect(calls[0]).toContain("--repo");
    expect(calls[0]!.at(-1)).toContain("https://github.com/owner/repo/actions/runs/123");
  });

  it("downloads the run's results and lists the open issues through gh when no fixture is given", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args[1] === "view") return JSON.stringify({ headSha: "abc", url: "https://example.test/run/123", conclusion: "success", headBranch: "main" });
      if (args[1] === "download") {
        const dir = args[args.indexOf("--dir") + 1]!;
        writeFileSync(join(dir, "ubuntu-latest-1.json"), JSON.stringify({ results: [{ file: "server/a.test.ts", test: "x", state: "pass" }] }));
        return "";
      }
      return JSON.stringify([{ number: 1, title: "Regression: server/a.test.ts > x" }]);
    };
    const lines: string[] = [];
    main(["--run", "123", "--close"], { run, log: (line) => lines.push(line) });
    expect(calls.map((args) => args.slice(0, 2).join(" "))).toEqual(["run view", "run download", "issue list", "issue close"]);
    expect(calls[1]).toContain("vitest-results-*");
    expect(calls[3]!.at(-1)).toContain("https://example.test/run/123 (commit abc)");
    expect(lines[0]).toContain("on main, success");
  });

  it("refuses a run id that is not a number", () => {
    expect(main(["--run", "abc"], { run: () => "", log: () => {} })).toBe(2);
  });
});
