import { describe, expect, it } from "vitest";
import { PERSPICAX_CONVENTIONS_PROMPT } from "./perspicax-conventions.ts";

describe("Perspicax tool conventions (#1209)", () => {
  it("names each convention", () => {
    for (const word of ["`set`", "`action`", "`parent`", "`id`", "`expect`", "_dry_run", "ids and flags", "without an offset", "api_result_query", "aggregate"]) {
      expect(PERSPICAX_CONVENTIONS_PROMPT).toContain(word);
    }
  });
  it("brings its own separation and no dash", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT.startsWith("\n\n")).toBe(true);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/[–—]/);
  });
});
