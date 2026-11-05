import { describe, expect, it } from "vitest";
import { citedPaths, missingCitedPaths } from "./routine-cited-paths.ts";

describe("cited paths of a routine's instructions (#1996)", () => {
  it("finds absolute and home paths once each, with their line, never a URL or prose", () => {
    const text = [
      "Read /Users/osprey/reports/daily.md and `~/notes/wren.txt`.",
      "Open https://example.test/api/v1/items, then call /api and do it 24/7 and/or later.",
      "Again /Users/osprey/reports/daily.md, then write (/tmp/wren/out.json).",
    ].join("\n");
    expect(citedPaths(text)).toEqual([
      { path: "/Users/osprey/reports/daily.md", line: 1 },
      { path: "~/notes/wren.txt", line: 1 },
      { path: "/tmp/wren/out.json", line: 3 },
    ]);
  });

  it("reports only the missing ones, a ~/ path resolved under home, as warnings", () => {
    const present = new Set(["/Users/osprey/reports/daily.md", "/home/wren/notes/wren.txt"]);
    const warnings = missingCitedPaths("See /Users/osprey/reports/daily.md\n~/notes/wren.txt and /srv/missing/file.csv", (p) => present.has(p), "/home/wren");
    expect(warnings).toEqual([{ code: "path_missing", path: "/srv/missing/file.csv", line: 2, message: expect.stringContaining("The run still starts") }]);
  });

  it("a failing exists check counts as missing, never throws", () => {
    expect(missingCitedPaths("/a/b", () => { throw new Error("denied"); })).toHaveLength(1);
  });
});
