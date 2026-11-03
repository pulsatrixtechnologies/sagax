// A tool's name in words, never its raw id (2026-11-03).
import { describe, expect, it } from "vitest";

import { gatewayToolId, toolDisplayName } from "./tool-display-name.ts";

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
