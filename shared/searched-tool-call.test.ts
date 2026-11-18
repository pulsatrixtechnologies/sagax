// #4527 lot A: one id per tool, whatever name the engine gave the call.
import { describe, expect, it } from "vitest";

import { mcpCallToolId, searchedCallToolServer, searchedServerCall, stepToolId, toolIdOf, toolIdParts } from "./searched-tool-call.ts";

describe("toolIdOf", () => {
  it("reads every engine's spelling of a Sagax tool as one id", () => {
    for (const name of ["mcp__agents__ask_bot", "agents__ask_bot", "agents.ask_bot", "agents:ask_bot", "agents/ask_bot", "mcp:agents:ask_bot", "agents_ask_bot"]) {
      expect(toolIdOf(name), name).toBe("agents/ask_bot");
    }
  });

  it("reads a connector's tool from Claude Code, Pi's gateway, Grok's use_tool and the ACP engines", () => {
    expect(toolIdOf("mcp__crm__get_ticket")).toBe("crm/get_ticket");
    expect(toolIdOf("crm__get_ticket")).toBe("crm/get_ticket");
    expect(toolIdOf("mcp__claude_ai_Gmail__search_threads")).toBe("claude_ai_Gmail/search_threads");
  });

  it("reads a renamed Sagax tool as its current name", () => {
    expect(toolIdOf("agents__propose_team_memory")).toBe("agents/save_team_memory");
    expect(toolIdOf("agents_propose_team_memory")).toBe("agents/save_team_memory");
  });

  it("counts no built-in tool, command line or finding tool", () => {
    for (const name of ["Bash", "edit", "web_search", "bin/test", "ls -la /tmp", "mcp__crm__search_tools", "mcp__agents__call_tool", "agents_use_tool",
      "agents__find_tool", "tool_search", "crm__describe_tool", "", "mcp__"]) {
      expect(toolIdOf(name), name).toBeNull();
    }
    expect(toolIdOf(undefined)).toBeNull();
  });
});

describe("the id an engine writes on the step", () => {
  it("reads Codex's call by server and tool, a call_tool's target and a family's action as the tool they run", () => {
    expect(mcpCallToolId("agents", "ask_bot", { bot: "x" })).toBe("agents/ask_bot");
    expect(mcpCallToolId("whop", "payments_list", { company_id: "biz_1" })).toBe("whop/payments_list");
    expect(mcpCallToolId("agents", "cloud_agents", { tool: "list_cloud_agents" })).toBe("agents/list_cloud_agents");
    expect(mcpCallToolId("agents", "use_tool", { name: "propose_page", arguments: {} })).toBe("agents/propose_page");
    expect(mcpCallToolId("agents", "find_tool", { query: "x" })).toBeNull();
    expect(mcpCallToolId("agents", "use_tool", { name: "search_tools" })).toBeNull();
  });

  it("prefers the id on the step, else the title", () => {
    expect(stepToolId({ title: "ask_bot", tool: "agents/ask_bot" })).toBe("agents/ask_bot");
    expect(stepToolId({ title: "crm_get_ticket", tool: "crm/get_ticket" })).toBe("crm/get_ticket");
    expect(stepToolId({ title: "mcp__crm__get_ticket" })).toBe("crm/get_ticket");
    expect(stepToolId({ title: "ask_bot" })).toBeNull();
    expect(toolIdParts("crm/get_ticket")).toEqual({ server: "crm", tool: "get_ticket" });
    expect(toolIdParts("crm")).toBeNull();
  });
});

// #4527 lot D: a connector whose gate leaves tools out is read like agents.
describe("a searched server's call_tool, any server", () => {
  const searched = new Set(["agents", "crm", "crm_v2"]);
  it("names the server in every engine's spelling", () => {
    for (const title of ["mcp__crm__call_tool", "crm__call_tool", "crm_call_tool"]) expect(searchedCallToolServer(title, searched)).toBe("crm");
    expect(searchedCallToolServer("crm_v2_call_tool", searched)).toBe("crm_v2");
    expect(searchedCallToolServer("agents_call_tool", searched)).toBe("agents");
    expect(searchedCallToolServer("mail__call_tool", searched)).toBeNull();
    expect(searchedCallToolServer("crm__list_deals", searched)).toBeNull();
    expect(searchedCallToolServer("crm__call_tool", new Set())).toBeNull();
  });

  it("reads it as the tool it runs, with that tool's arguments; one naming nothing runs nothing", () => {
    expect(searchedServerCall("crm__call_tool", { name: "old_report", arguments: { id: 1 } }, searched))
      .toEqual({ mcpTool: "crm__old_report", id: "crm/old_report", input: { id: 1 } });
    expect(searchedServerCall("agents_call_tool", { name: "list_rooms", arguments: {} }, searched)).toMatchObject({ mcpTool: "agents__list_rooms" });
    expect(searchedServerCall("crm__call_tool", { arguments: {} }, searched)).toBeNull();
    expect(searchedServerCall("crm__call_tool", { name: "search_tools" }, searched)).toBeNull();
    expect(searchedServerCall("mail__call_tool", { name: "send" }, searched)).toBeNull();
  });
});
