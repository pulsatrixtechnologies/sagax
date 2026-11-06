import { describe, expect, it } from "vitest";

import {
  agentsPreferredToolNames,
  filterToolsPreferringAgents,
  parseAgentsWithhold,
  resolvedServerLog,
  withholdForConnector,
} from "./agents-tool-priority.ts";

describe("agents tool priority (#2189)", () => {
  it("lists bare agents catalog names without adding __", () => {
    const names = agentsPreferredToolNames({
      SAGAX_BOT_ID: "bot-a",
      SAGAX_AGENT_API: "1",
      SAGAX_PERSPICAX_TOOLS: "1",
    });
    expect(names).toContain("send_prompt");
    expect(names).toContain("api_search");
    expect(names).toContain("flow_action");
    expect(names.every((name) => !name.includes("__"))).toBe(true);
  });

  it("withholds overlapping names on a connector, never on agents", () => {
    expect(withholdForConnector("perspicax", ["send_prompt", "api_search", "send_prompt"])).toEqual(["api_search", "send_prompt"]);
    expect(withholdForConnector("agents", ["send_prompt"])).toEqual([]);
    expect(withholdForConnector("notes", [])).toEqual([]);
    expect(withholdForConnector("notes", ["cw_psa__query"])).toEqual([]);
  });

  it("filters a connector catalog down to names agents does not own", () => {
    const out = filterToolsPreferringAgents(
      [{ name: "send_prompt" }, { name: "cw_psa_query" }, { name: "api_search" }, { name: "search_tools" }],
      ["send_prompt", "api_search"],
    );
    expect(out.tools.map((tool) => tool.name)).toEqual(["cw_psa_query", "search_tools"]);
    expect(out.withheld).toEqual(["api_search", "send_prompt"]);
  });

  it("parses the gate withhold list and writes a resolved-server log line", () => {
    expect([...parseAgentsWithhold(JSON.stringify(["send_prompt", "api_search", "a__b"]))].sort()).toEqual(["api_search", "send_prompt"]);
    expect(parseAgentsWithhold(undefined).size).toBe(0);
    expect(parseAgentsWithhold("{")).toEqual(new Set());
    expect(resolvedServerLog("agents", "send_prompt")).toBe("mcp-tool: resolved send_prompt via server agents\n");
  });
});
