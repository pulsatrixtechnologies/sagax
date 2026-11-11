import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { areaTests, IOS_NOT_RUN_NOTE, IOS_SKIPPED_LINE, reportBody, runIosStage, sanitizeGitEnv, stampPathFor, swiftProbe } from "./verify-merge.mjs";

describe("sanitizeGitEnv", () => {
  it("strips every GIT_* key and leaves the rest", () => {
    const env = {
      PATH: "/bin",
      GIT_DIR: "/tmp/worktree.git",
      GIT_WORK_TREE: "/tmp/tree",
      GIT_COMMON_DIR: "/tmp/common.git",
      GIT_INDEX_FILE: "/tmp/index",
      GIT_AUTHOR_NAME: "Hook Leak",
      HOME: "/home/dev",
      SAGAX_SKIP_HOOKS: "",
    };
    sanitizeGitEnv(env);
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/dev", SAGAX_SKIP_HOOKS: "" });
    expect(Object.keys(env).some((key) => key.startsWith("GIT_"))).toBe(false);
  });
});

describe("stampPathFor", () => {
  // the stamp is a path of this platform: "/" on Linux and macOS, "\\" and a
  // drive letter on Windows, where git also hands an absolute common dir
  const SHA = "abc123def456abc123def456abc123def456ab";
  it("puts the OK stamp under the common git dir for a full sha", () => {
    expect(stampPathFor("/repo/.git", SHA, "/repo")).toBe(join("/repo/.git", "sagax-verify-merge", `ok-${SHA}`));
  });

  it("keeps an absolute common dir of this platform as it is", () => {
    const common = resolve("repo", ".git");
    expect(stampPathFor(common, SHA, resolve("elsewhere"))).toBe(join(common, "sagax-verify-merge", `ok-${SHA}`));
  });

  it("resolves a relative common dir against the repo root", () => {
    expect(stampPathFor(".git", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/work")).toBe(
      join("/work", ".git", "sagax-verify-merge", "ok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    );
  });

  it("refuses an empty or non-hex sha", () => {
    expect(stampPathFor("/repo/.git", "", "/repo")).toBeNull();
    expect(stampPathFor("/repo/.git", "HEAD", "/repo")).toBeNull();
    expect(stampPathFor("/repo/.git", "abc123", "/repo")).toBe(join("/repo/.git", "sagax-verify-merge", "ok-abc123"));
  });
});

describe("areaTests (#3354)", () => {
  const matrix = ["server/connectors/connector-matrix.e2e.test.ts", "server/connectors/launch-profile.contract.test.ts"];
  it("runs the connector matrix and the launch contract for any path a connector call crosses", () => {
    for (const file of ["server/connectors/hub.ts", "server/drivers/acp/grok.ts", "server/turns/start-turn-setup.ts", "server/approvals/auto-approve.ts",
      "server/runtime-events/request-opened.ts", "server/harness/bus.ts", "shared/engine-connectors.ts"]) {
      expect(areaTests([file]), file).toEqual(matrix);
    }
  });
  it("runs nothing more for a change elsewhere", () => {
    expect(areaTests(["src/App.tsx", "server/routes/bots.ts", "shared/engine-connectors.test.ts", "docs/releasing.md"])).toEqual([]);
  });
});

describe("iOS stage without Swift (#3639)", () => {
  const ok = (label) => ({ label, ok: true, seconds: "1" });
  const setup = (swiftStatus, extra = {}) => {
    const ran = [];
    const logs = [];
    const stops = [];
    const spawn = (cmd) => {
      if (cmd === "swift") return swiftStatus === "missing" ? { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }), status: null } : { status: 0 };
      return { status: extra.xcode ? 0 : 1 };
    };
    const run = (label, command) => { ran.push(command[0]); return label.startsWith("swift test") && swiftStatus === "red" ? { label, ok: false, seconds: "1" } : ok(label); };
    const stop = (result) => stops.push(result);
    return { ran, logs, stops, args: { iosDir: "/x", stop, run, spawn, log: (line) => logs.push(line) } };
  };

  it("probes swift with no shell and a bound of 120 s", () => {
    let seen;
    swiftProbe((cmd, args, options) => { seen = [cmd, args, options]; return { status: 0 }; });
    expect(seen[0]).toBe("swift");
    expect(seen[1]).toEqual(["--version"]);
    expect(seen[2].timeout).toBe(120000);
    expect(seen[2].shell).toBeUndefined();
  });

  const failing = (swift) => {
    const t = setup("green");
    t.args.spawn = (cmd) => (cmd === "swift" ? swift : { status: 1 });
    return t;
  };
  it.each([
    ["timeout", { error: Object.assign(new Error("spawnSync swift ETIMEDOUT"), { code: "ETIMEDOUT" }), status: null }, "ETIMEDOUT"],
    ["status 1", { status: 1, stderr: "xcode-select: error: no developer tools\nmore" }, "status 1: xcode-select: error: no developer tools"],
    ["EACCES", { error: Object.assign(new Error("EACCES"), { code: "EACCES" }), status: null }, "EACCES"],
  ])("fails the gate, never skips, when the probe fails by %s", (_name, swift, why) => {
    const t = failing(swift);
    const notes = runIosStage(t.args);
    expect(t.ran).toEqual([]);
    expect(t.stops.map((r) => r.ok)).toEqual([false]);
    expect(notes).toEqual([]);
    expect(t.logs[0]).toContain("the Swift probe (swift --version) failed");
    expect(t.logs[0]).toContain(why);
    expect(t.logs).not.toContain(IOS_SKIPPED_LINE);
  });

  it("runs the stage when the probe answers with status 0", () => {
    const t = setup("green");
    runIosStage(t.args);
    expect(t.ran).toEqual(["swift"]);
  });

  it("skips the whole stage with one explicit line and a note when swift is missing", () => {
    const t = setup("missing");
    const notes = runIosStage(t.args);
    expect(t.ran).toEqual([]);
    expect(t.stops).toEqual([]);
    expect(t.logs).toEqual([IOS_SKIPPED_LINE]);
    expect(IOS_SKIPPED_LINE).toBe("\n== iOS stage: skipped, swift is not installed on this host (the Swift tests were not run here; they run after the merge)");
    expect(notes).toEqual([IOS_NOT_RUN_NOTE]);
  });

  it("carries the fact in the report, OK or not", () => {
    const body = reportBody({ ok: true, seconds: "5", stages: [ok("lint")], notes: [IOS_NOT_RUN_NOTE] }, "abc1234", "2026-11-11T00:00:00Z");
    expect(body).toContain("verify:merge OK");
    expect(body).toContain("Not run: iOS stage not run on this host");
    expect(body.startsWith("<!-- verify:merge -->")).toBe(true);
  });

  it("keeps the report unchanged when nothing was skipped", () => {
    const body = reportBody({ ok: true, seconds: "5", stages: [ok("lint")] }, "abc1234", "2026-11-11T00:00:00Z");
    expect(body).not.toContain("Not run");
  });

  it("runs swift test and fails the gate when it is red", () => {
    const t = setup("red");
    runIosStage(t.args);
    expect(t.ran).toEqual(["swift"]);
    expect(t.stops.map((r) => r.ok)).toEqual([false]);
  });

  it("runs swift test and notes nothing when it is green", () => {
    const t = setup("green");
    expect(runIosStage(t.args)).toEqual([]);
    expect(t.ran).toEqual(["swift"]);
    expect(t.logs).toEqual(["\n== iOS build: skipped, xcodegen or xcodebuild is not installed (swift test ran)"]);
    const full = setup("green", { xcode: true });
    expect(runIosStage(full.args)).toEqual([]);
    expect(full.ran).toEqual(["swift", "xcodegen", "xcodebuild"]);
  });
});
