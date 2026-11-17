// A tool's name in words, never its raw id (2026-11-03).
import { describe, expect, it } from "vitest";

import { gatewayToolId, humanizeToolIds, toolDisplayName } from "./tool-display-name.ts";

describe("toolDisplayName", () => {
  it("reads a gateway tool, with or without its gateway part", () => {
    expect(gatewayToolId("user-Outlook-get_5fmail_5fmessage___12")).toBe("gateway__user-Outlook-get_5fmail_5fmessage___12");
    expect(gatewayToolId("cursor__user-Teams-list_5fchats___10")).toBe("cursor__user-Teams-list_5fchats___10");
    expect(gatewayToolId("mcp__outlook__get_message")).toBeUndefined();
    expect(toolDisplayName("user-Outlook-get_5fmail_5fmessage___12")).toMatch(/^Get mail message · Outlook/);
  });

  it("reads an MCP id as its own part, with the declared product", () => {
    expect(toolDisplayName("mcp__outlook__get_message")).toBe("Get message");
    expect(toolDisplayName("mcp__sagax-environment__read_file")).toBe("Read file");
    expect(toolDisplayName("mcp__gw__cw_psa_find_schedule_entries", "ConnectWise PSA")).toBe("Cw psa find schedule entries · ConnectWise PSA");
  });
});

describe("humanizeToolIds", () => {
  it("replaces every raw tool id in a routine problem line", () => {
    const text = humanizeToolIds("mcp__outlook__get_message failed 2 times and never succeeded after: Graph 404\nmcp__sagax-environment__read_file failed 3 times");
    expect(text).toBe("Get message failed 2 times and never succeeded after: Graph 404\nRead file failed 3 times");
    expect(text).not.toContain("__");
    expect(humanizeToolIds("user-Outlook-get_5fmail_5fmessage___12 failed 2 times")).toMatch(/^Get mail message · Outlook.* failed 2 times$/);
  });

  it("a missing tool keeps its connection: the name is the whole fact (#4432)", () => {
    // Read as "Tool not found: Flow", the miss looked like a call to a tool
    // named `Flow`; the call named one connection's `flow`.
    const line = humanizeToolIds("mcp__perspicax__flow failed 2 times and never succeeded after: Tool not found: perspicax__flow");
    expect(line).toBe("Flow failed 2 times and never succeeded after: Tool not found: Flow · perspicax");
    expect(humanizeToolIds("Unknown tool: mcp__sagax-environment__read_file")).toBe("Unknown tool: Read file · sagax-environment");
    // the connection in words; a gateway id names its connector, not the server
    expect(humanizeToolIds("Tool not found: my_cw_psa__flow")).toBe("Tool not found: Flow · my cw psa");
    expect(humanizeToolIds("Tool not found: some_server__cw_psa__query")).toBe("Tool not found: Query · cw psa");
    // only the engine's own answer, at its place: a tool's sentence is left as words
    expect(humanizeToolIds("the crm said tool not found: crm__api_search")).toBe("the crm said tool not found: Api search");
    expect(line).not.toContain("__");
  });

  it("leaves ordinary words alone", () => {
    const plain = "Wren's work failed: the ticket was closed (see /workspace/notes_2.md)";
    expect(humanizeToolIds(plain)).toBe(plain);
  });
});

describe("labels never throw (2026-11-04 black screen)", () => {
  it("survives a missing tool name or a gateway id without a tool part", () => {
    expect(typeof toolDisplayName(undefined)).toBe("string");
    expect(typeof toolDisplayName("")).toBe("string");
    expect(() => toolDisplayName("user-Outlook-___12")).not.toThrow();
    expect(() => toolDisplayName("___12")).not.toThrow();
    expect(humanizeToolIds(undefined)).toBe("");
  });
});
