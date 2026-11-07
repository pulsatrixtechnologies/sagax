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
  // QA c1: D3 (#2577) direct reads, D4 (#2578) not served, D7 (#2581) 403 block
  it("sends a simple read straight to its tool and stops early on what is not served", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/simple read or lookup .* calls the vendor tool directly/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/No skills_list, workspace_read, sagax_help, flow_run or identity_switch before it/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/Flow .* is for a routine or a multi-step procedure only/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("n'est pas servi ici");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/a missing source is not a source with nothing in it/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/a read still refused, or a refused write, is a block/);
  });
});
