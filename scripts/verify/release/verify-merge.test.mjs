import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { areaTests, sanitizeGitEnv, stampPathFor } from "./verify-merge.mjs";

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
