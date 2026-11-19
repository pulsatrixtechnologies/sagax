import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { assertIsolatedDataDir } from "./isolated-data-dir.ts";

// 2026-11-18: a test server never runs on a person's real data folder.
const fresh = mkdtempSync(join(tmpdir(), "isolated-data-dir-"));
afterAll(() => rmSync(fresh, { recursive: true, force: true }));

describe("assertIsolatedDataDir", () => {
  it("accepts a fresh temporary folder", () => {
    expect(() => assertIsolatedDataDir(fresh)).not.toThrow();
  });

  it("refuses the real data folder, the legacy one and anything inside them", () => {
    expect(() => assertIsolatedDataDir(join(homedir(), ".sagax"))).toThrow(/real data folder/);
    expect(() => assertIsolatedDataDir(join(homedir(), ".openmausbot", "bots"))).toThrow(/real data folder/);
    // even a home that sits under the temporary folder
    expect(() => assertIsolatedDataDir(join(fresh, ".sagax"), fresh)).toThrow(/real data folder/);
  });

  it("refuses a folder outside the temporary folder", () => {
    expect(() => assertIsolatedDataDir(join(homedir(), "Documents", "fixture"))).toThrow(/fresh temporary folder/);
  });
});
