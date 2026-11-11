import { describe, expect, it } from "vitest";
import { DRIVER_KIND as CLAUDE_KIND } from "../drivers/claude/config.ts";
import { readFileSync } from "node:fs";
import { CLAUDE_DRIVER_KIND, connectorConventionsPrompt, GATEWAY_FINDER_TOOLS, GROK_DRIVER_KIND, hasPerspicaxConventions, PERSPICAX_CONVENTIONS_PROMPT, perspicaxGatewayServer, perspicaxToolIdsPrompt } from "./perspicax-conventions.ts";
import { PERSPICAX_TOOL_NAMES } from "../drivers/agents-tools/perspicax.ts";
import { withholdForConnector } from "../mcp/agents-tool-priority.ts";

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
    // QA 0.8.69 (#3062): a read never raises a card; Sagax tries the roles itself
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("Sagax itself tries each other held role that may read it, in turn, before answering: a read never needs an approval card");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/Sagax asks with a card|declined card/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A read refused under every held role is a block: report the API member and role that refused it/);
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
  it("says api_result_query has no split, so a routine never calls an undefined function (QA 0.8.66 F5, QA 0.8.67 G8)", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/There is no split, regex, lower, upper, trim, replace or date function/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/functions are length, sum/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("count_by and sum_by");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/split\(s, sep\)/);
  });
  // #2912: the QA 0.8.66 ConnectWise rules of #2905, corrected and moved here.
  it("points a 403 to identity_switch without arguments, never to the record finder identity", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A read refused with 403 under a limited role \(Dispatch Agent included\): when Sagax's note names a held role, follow it/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("When no Sagax note came with the 403, `identity_switch` without arguments lists the roles you hold");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/\(identity, then identity_switch/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/`identity`[^_]/);
  });
  it("forbids the admin wall in the negative form, so an inverted rule fails", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/Never answer "it needs an admin", "our rules forbid that role" or "it cannot be changed": name the exact missing permission instead/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("before that");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/(?<!Never answer )(?<!Never answer "[^"]*", )"it needs an admin"/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("name the exact missing permission");
  });
  // Review of #2912: the relay's STOP note (readStop) means no held role is
  // left; the 403 point must not send the bot back to identity_switch then,
  // and a refused write stays a block, as the Roles point says.
  it("stops at a Sagax STOP note for that read, and leaves a refused write's role search to Sagax", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A Sagax note starting with STOP means no held role is left for that read or the person chose to stay in that role: no `identity_switch` for that read, name the API member and role that refused it and the exact missing permission at once/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("A write 403: Sagax tries a held role that writes it (rule or card)");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/if it names none, `identity_switch`/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("is not the end while a held role is untried");
  });
  // #3694: the old lock taught a bot to stop switching roles after any 403
  it("teaches a refused write as one call's STOP and a guard refusal as a call to fix (#3694)", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("its STOP blocks that call only, never `identity_switch`");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("A guard or policy refusal (`flow_guard`, unknown resource) is no permission problem: fix the call");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toMatch(/no other role, name the exact missing permission|or a refused write is a block|A refused write follows the Roles point above/);
  });
  it("counts tickets on the board's id and never per board from a page cut by limit", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("owner/id=<member id>, board/id=<board id>, closedFlag=false");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("a board name is never a filter");
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("board/name");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/A count per board is one call per board read for its own `total`, or an aggregate over every matching ticket, never grouped from a result cut by `limit`/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("group by board from that one result");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("15 au total, voici les 10 premiers");
  });
  // Review of #2912: ConnectWise reached through a claude.ai connector, with
  // no Perspicax mount, still gets the conventions, once.
  it("brings the conventions to a turn that reaches ConnectWise through a claude.ai connector", () => {
    const rows = [{ name: "claude.ai Microsoft 365", status: "connected" }, { name: "claude.ai Pulsatrix Perspicax", status: "connected" }];
    const text = connectorConventionsPrompt(rows, false);
    expect(text).toContain("\"claude.ai Pulsatrix Perspicax\" reaches ConnectWise");
    expect(text).not.toContain("Microsoft 365");
    expect(hasPerspicaxConventions(text)).toBe(true);
    expect(text).toContain("board/id=<board id>");
    expect(connectorConventionsPrompt(rows, true)).toBe("");
    expect(connectorConventionsPrompt([{ name: "claude.ai ConnectWise PSA", status: "needs_auth" }], false)).toBe("");
    expect(connectorConventionsPrompt([{ name: "claude.ai Gmail", status: "connected" }], false)).toBe("");
    expect(connectorConventionsPrompt(undefined, false)).toBe("");
    expect(hasPerspicaxConventions("")).toBe(false);
  });

  // QA 0.8.67 G1, G2, G3, G6 (#2960).
  it("lets the bot switch back and forth and take a named role as the person's GO", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).not.toContain("Switch at most once");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("switches go back and forth in a turn, one per call when needed");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("When the person names a role to use");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("never refuse before trying it");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("a STOP holds for its own turn only");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("Sagax itself tries each other held role that may read it, in turn");
  });

  it("never gives a count read under one role as complete", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("A list read under one role covers only the boards that role sees");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("never present the count as complete");
  });

  it("reads a week's time in one time.entries call with the server's total", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("one time.entries read filtered on member/id=<member id>");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("Ticket or project titles are optional");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("A 403 on project or service tickets never blocks the hours");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("on a 403 for a title Sagax already tried the other held roles: on its STOP, skip the titles")
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("Sagax reads the first cross-board list of a turn under every held role and keeps the one that sees the most boards");
  });
});

// QA 0.8.67 G8: "No such tool available: Api search" in a routine run.
describe("perspicaxToolIdsPrompt", () => {
  it("matches the driver kinds the drivers really carry", () => {
    expect(CLAUDE_DRIVER_KIND).toBe(CLAUDE_KIND);
    expect(readFileSync(new URL("../drivers/acp/grok.ts", import.meta.url), "utf8")).toContain(`driverKind: "${GROK_DRIVER_KIND}"`);
    expect(perspicaxToolIdsPrompt("perspicax", "claude")).toContain("exact id your tool list shows");
  });
  it("names Claude Code's exact mcp__ ids and rules out titles", () => {
    const text = perspicaxToolIdsPrompt("perspicax", CLAUDE_KIND);
    expect(text).toContain("`mcp__perspicax__api_search`");
    expect(text).toContain("never a display title such as \"Api search\"");
  });
  it("names Grok's use_tool ids and keeps search_tool native", () => {
    const text = perspicaxToolIdsPrompt("perspicax", "grokAgent");
    expect(text).toContain("tool_name `<server>__<tool>`");
    expect(text).toContain("`perspicax__api_search`");
    expect(text).toContain("search_tool is a native tool: call it directly, never through use_tool");
    expect(text).toContain("`perspicax__search_tools`");
    expect(text).not.toContain("mcp__");
  });
  it("other engines are told to use the id from their tool list", () => {
    const text = perspicaxToolIdsPrompt("perspicax", "codex");
    expect(text).toContain("exact id your tool list shows");
    expect(text).not.toContain("mcp__perspicax__");
  });
});

// QA pass 3 (#3019): the bot called mcp__perspicax__api_search (withheld on
// the account mount, #2189), then a guessed search_tools, before
// mcp__agents__api_search. The prompt names the server that lists each tool.
describe("tool ids name the server that really lists each tool (#3019)", () => {
  it("the finding tools are the agents server's gateway tools, withheld on the account mount", () => {
    for (const tool of GATEWAY_FINDER_TOOLS) expect(PERSPICAX_TOOL_NAMES.has(tool)).toBe(true);
    const withheld = withholdForConnector("perspicax", [...PERSPICAX_TOOL_NAMES]);
    for (const tool of GATEWAY_FINDER_TOOLS) expect(withheld).toContain(tool);
    expect(withheld).not.toContain("identity_switch");
    expect(perspicaxGatewayServer("perspicax", true)).toBe("agents");
    expect(perspicaxGatewayServer("perspicax", false)).toBeUndefined();
    expect(perspicaxGatewayServer("solo", true)).toBeUndefined();
  });
  it("Claude Code: api_search on agents, the profile's tools on the mount", () => {
    const text = perspicaxToolIdsPrompt("perspicax", CLAUDE_KIND, "agents");
    expect(text).toContain("`mcp__agents__api_search`");
    expect(text).toContain("`mcp__agents__api_result_query`");
    expect(text).toContain("`mcp__perspicax__cw_psa_query`");
    expect(text).toContain("`mcp__perspicax__identity_switch`");
    expect(text).not.toContain("mcp__perspicax__api_search");
    expect(text).not.toContain("mcp__perspicax__api_result_query");
    expect(text).toContain("`perspicax` does not list them");
    expect(text).toContain("never a server prefix your tool list does not show");
    expect(text).not.toMatch(/[–—]/);
  });
  it("Grok: use_tool ids on the right server", () => {
    const text = perspicaxToolIdsPrompt("perspicax", "grokAgent", "agents");
    expect(text).toContain("`agents__api_search`");
    expect(text).toContain("`perspicax__cw_psa_query`");
    expect(text).not.toContain("`perspicax__api_search`");
    expect(text).toContain("only when that server lists it");
  });
  it("without a gateway server, the mount lists its own finders as before", () => {
    expect(perspicaxToolIdsPrompt("perspicax", CLAUDE_KIND, undefined)).toContain("`mcp__perspicax__api_search`");
    expect(perspicaxToolIdsPrompt("perspicax", CLAUDE_KIND, "perspicax")).not.toContain("mcp__agents__");
  });
  it("discovery: api_search first, no guessed id, search_tools only where listed, objects stay objects", () => {
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("never guess a tool id");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toMatch(/the first call is `api_search`/);
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("Only when a server lists `search_tools`");
    expect(PERSPICAX_CONVENTIONS_PROMPT).toContain("stays a JSON object, never a string");
  });
});
