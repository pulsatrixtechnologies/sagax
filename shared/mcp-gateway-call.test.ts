import { describe, expect, it } from "vitest";
import { readMcpGatewayCall, readUseToolCall } from "./mcp-gateway-call";

describe("readMcpGatewayCall", () => {
  it("names the server and tool a pi-mcp-adapter call ran, with the tool's own arguments", () => {
    expect(readMcpGatewayCall("mcp", { server: "pulsatrix-psa", tool: "cw_psa__query", args: { resource: "service.tickets" } })).toEqual({
      kind: "tool", server: "pulsatrix-psa", tool: "cw_psa__query", id: "mcp__pulsatrix-psa__cw_psa__query", args: { resource: "service.tickets" },
    });
    // stored as text, arguments as JSON text
    expect(readMcpGatewayCall("mcp", JSON.stringify({ tool: "pulsatrix-psa_api_search", args: "{\"query\": \"schedule today\"}" }))).toMatchObject({
      kind: "tool", id: "mcp__pulsatrix-psa__api_search", args: { query: "schedule today" },
    });
  });

  it("splits a prefixed tool on a known server first", () => {
    expect(readMcpGatewayCall("mcp", { tool: "my_crm_find_contacts" }, ["my_crm"])).toMatchObject({ server: "my_crm", tool: "find_contacts" });
  });

  it("reads the gateway's housekeeping, and leaves every other tool alone", () => {
    expect(readMcpGatewayCall("mcp", { server: "pulsatrix-psa" })).toEqual({ kind: "admin", action: "status", server: "pulsatrix-psa" });
    expect(readMcpGatewayCall("mcp", { action: "auth-start", server: "pulsatrix-psa" })).toMatchObject({ action: "connect" });
    expect(readMcpGatewayCall("mcp", { connect: "pulsatrix-psa" })).toMatchObject({ action: "connect", server: "pulsatrix-psa" });
    expect(readMcpGatewayCall("mcp", { search: "tickets" })).toMatchObject({ action: "search", query: "tickets" });
    expect(readMcpGatewayCall("mcp", undefined)).toEqual({ kind: "admin", action: "status", server: undefined });
    expect(readMcpGatewayCall("Bash", { tool: "x_y" })).toBeUndefined();
    expect(readMcpGatewayCall("mcpScript", { tool: "x_y" })).toBeUndefined();
  });
});

describe("readUseToolCall", () => {
  it("reads Grok's use_tool as the MCP tool it runs", () => {
    expect(readUseToolCall({ variant: "UseTool", tool_name: "perspicax__cw_psa__query", tool_input: { resource: "service.tickets" } })).toEqual({
      id: "mcp__perspicax__cw_psa__query", args: { resource: "service.tickets" },
    });
    expect(readUseToolCall({ variant: "UseTool" })).toBeUndefined();
    expect(readUseToolCall({ command: "ls" })).toBeUndefined();
  });

  it("reads the first tool_call of grok 1.0.62, which carries no variant, by its title or meta", () => {
    // measured 2026-10-22: tool_call rawInput is { tool_name, tool_input };
    // only the later tool_call_update adds variant "UseTool"
    const raw = { tool_name: "perspicax__api_list", tool_input: {} };
    expect(readUseToolCall(raw)).toBeUndefined();
    expect(readUseToolCall(raw, { title: "use_tool" })).toEqual({ id: "mcp__perspicax__api_list", args: {} });
    expect(readUseToolCall(raw, { meta: { "x.ai/tool": { kind: "use_tool", name: "use_tool" } } })).toEqual({ id: "mcp__perspicax__api_list", args: {} });
    expect(readUseToolCall(raw, { title: "Use Tool" })).toEqual({ id: "mcp__perspicax__api_list", args: {} });
    // another tool that happens to take a tool_name stays itself
    expect(readUseToolCall(raw, { title: "run_terminal_command" })).toBeUndefined();
  });
});
