import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-runner-labels.mjs", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./testing/runner-guard-fixtures/${name}`, import.meta.url));
const guard = (dir) => spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

describe("check-runner-labels", () => {
  it.each(["hosted", "hosted-matrix", "hosted-matrix-include"])("passes %s", (name) => {
    const r = guard(fixture(name));
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toMatch(/every job uses a GitHub-hosted runner/);
  });

  it.each([
    ["self-hosted", /uses a self-hosted label/],
    ["matrix-self-hosted", /uses a self-hosted label/],
    ["unknown-runner", /not a GitHub-hosted label/],
    ["foo-latest", /not a GitHub-hosted label/],
  ])("fails %s", (name, expected) => {
    const r = guard(fixture(name));
    expect(r.status, r.stderr + r.stdout).toBe(1);
    expect(r.stderr).toMatch(expected);
  });

  it("desktop-install-smoke.yml matrix.runner values are hosted", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-guard-desktop-install-"));
    try {
      copyFileSync(
        fileURLToPath(new URL("../.github/workflows/desktop-install-smoke.yml", import.meta.url)),
        join(dir, "desktop-install-smoke.yml"),
      );
      const r = guard(dir);
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(r.stdout).toMatch(/every job uses a GitHub-hosted runner/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repository workflows use only GitHub-hosted runners", () => {
    const r = guard(fileURLToPath(new URL("../.github/workflows", import.meta.url)));
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toMatch(/every job uses a GitHub-hosted runner/);
  });

  it("reads a CRLF workflow the same as LF", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-guard-crlf-"));
    try {
      writeFileSync(
        join(dir, "w.yml"),
        "on: pull_request\r\njobs:\r\n  a:\r\n    runs-on: windows-latest\r\n    steps: [{run: \"true\"}]\r\n",
      );
      const hosted = guard(dir);
      expect(hosted.status, hosted.stderr + hosted.stdout).toBe(0);
      writeFileSync(
        join(dir, "w.yml"),
        "on: pull_request\r\njobs:\r\n  a:\r\n    runs-on: self-hosted\r\n    steps: [{run: \"true\"}]\r\n",
      );
      const banned = guard(dir);
      expect(banned.status, banned.stderr + banned.stdout).toBe(1);
      expect(banned.stderr).toMatch(/uses a self-hosted label/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
