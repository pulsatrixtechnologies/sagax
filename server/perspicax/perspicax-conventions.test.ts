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
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/one held role that may read it: if the person already allowed it .*, identity_switch to it for that one call/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/Sagax asks with a card/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A read still refused, a declined card or a refused write is a block/);
  });
  // QA c2 D3/S8/D7 (#2670): the Flow entry skill says "catalog --index
  // before any answer or action, including a clarifying question" and "Let
  // me read the ticket first ... Catalog first"; bots followed it over
  // #2577 (23 to 37 steps before a one-record read). And after Sagax's
  // 403 re-read under another role, the person was never told which role
  // read the record.
  it("puts a direct read and a clarifying question before any Flow catalog, and names the role that read a record (#2670)", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/wins over the Flow skills' "catalog first"/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/clarifying question and a single-record read come before any `catalog`/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/catalog is read once a routine or a multi-step procedure actually starts/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/say so to the person in one line, by the role's name, never an id/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("Lu avec le rôle");
  });
});
