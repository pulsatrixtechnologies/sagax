import { describe, expect, it } from "vitest";
import { PERSPICAX_CONVENTIONS_PROMPT } from "./perspicax-conventions.ts";

describe("Perspicax tool conventions (#1209)", () => {
  it("names each convention", () => {
    for (const word of ["`search_tools`", "`call_tool`", "`identity_switch`", "`memory_find`", "`set`", "`action`", "`parent`", "`id`", "`expect`", "_dry_run", "ids and flags", "without an offset", "api_result_query", "aggregate"]) {
      expect(PERSPICAX_CONVENTIONS_PROMPT).toContain(word);
    }
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/api_search.*vendor API operations only/);
  });
  it("brings its own separation and no dash", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT.startsWith("\n\n")).toBe(true);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/[–—]/);
  });
});
