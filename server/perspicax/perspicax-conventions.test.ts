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
  it("says JMESPath has no split, so a routine never calls an undefined function (QA 0.8.66 F5)", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/There is no split, regex/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/functions are length, sum/);
  });
  // #2912: the QA 0.8.66 ConnectWise rules of #2905, corrected and moved here.
  it("points a 403 to identity_switch without arguments, never to the record finder identity", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A 403 under a limited role \(Dispatch Agent included\) is not the end while a held role is untried/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("`identity_switch` without arguments lists the roles you hold");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/\(identity, then identity_switch/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/`identity`[^_]/);
  });
  it("forbids the admin wall in the negative form, so an inverted rule fails", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/Never answer "it needs an admin", "our rules forbid that role" or "it cannot be changed" before that/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/(?<!Never answer )(?<!Never answer "[^"]*", )"it needs an admin"/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("name the exact missing permission");
  });
  it("counts tickets on the board's id and never per board from a page cut by limit", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("owner/id=<member id>, board/id=<board id>, closedFlag=false");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("a board name is never a filter");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("board/name");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A count per board is one call per board read for its own `total`, or an aggregate over every matching ticket, never grouped from a result cut by `limit`/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("group by board from that one result");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("15 au total, voici les 10 premiers");
  });
});
