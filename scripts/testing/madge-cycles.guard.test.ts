// Circular import ratchet (#1381).
//
// Command per root (shared, src, server):
//   pnpm dlx madge --circular --extensions ts,tsx --exclude '^\.\./' <root>
//
// `--exclude '^\.\./'` keeps each scan inside its tree: madge otherwise
// follows relative imports into sibling packages and reports their cycles
// under the wrong root (and scripts/ when scanning server).
//
// MAX is the post-fix count. A new cycle fails. When a cycle is removed,
// lower the matching number in the same PR (strict equality).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hostTimeout } from "../../server/testing/host-timeout.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Cycles left inside each tree after #1381. Lower when one goes away. */
const MAX = {
  shared: 0,
  src: 4,
  server: 23,
} as const;

function circularCount(root: keyof typeof MAX): number {
  const result = spawnSync(
    "pnpm",
    ["dlx", "madge", "--circular", "--extensions", "ts,tsx", "--exclude", "^\\.\\./", root],
    // A minimal environment: the runner's pnpm/node settings break the madge CLI.
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp" } },
  );
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (out.includes("No circular dependency found")) return 0;
  const match = out.match(/Found (\d+) circular dependenc/);
  if (!match) {
    throw new Error(`madge on ${root} did not report a cycle count (status ${result.status}):\n${out.slice(-2000)}`);
  }
  return Number(match[1]);
}

describe("madge circular dependencies", () => {
  it("shared stays at its ceiling", { timeout: hostTimeout(120_000) }, () => {
    expect(circularCount("shared")).toBe(MAX.shared);
  });

  it("src stays at its ceiling", { timeout: hostTimeout(180_000) }, () => {
    expect(circularCount("src")).toBe(MAX.src);
  });

  it("server stays at its ceiling", { timeout: hostTimeout(180_000) }, () => {
    expect(circularCount("server")).toBe(MAX.server);
  });
});
