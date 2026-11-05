import { describe, expect, it } from "vitest";

import { gatewayServerNames, GROK_CLOUD_CONNECTORS, grokGatewayToolConnector, parseGrokGatewayToolId } from "./grok-cloud-connectors.ts";

describe("Grok cloud connectors", () => {
  it("names Exchange, X and Microsoft Teams for the Connect apps list", () => {
    const names = GROK_CLOUD_CONNECTORS.map((connector) => connector.name);
    expect(names).toEqual(expect.arrayContaining(["Outlook (Exchange)", "X", "Microsoft Teams"]));
    expect(new Set(GROK_CLOUD_CONNECTORS.map((connector) => connector.id)).size).toBe(GROK_CLOUD_CONNECTORS.length);
  });
});

describe("a gateway tool id read apart (#1931)", () => {
  it("names the member's server and the tool, decoded, never `cursor` and `23`", () => {
    expect(parseGrokGatewayToolId("cursor__user-pulsatrix_5fcw-profile_5fuse___23"))
      .toEqual({ gateway: "cursor", scope: "user", server: "pulsatrix_cw", tool: "profile_use", number: "23" });
    expect(parseGrokGatewayToolId("mcp__cursor__user-Teams-list_5fchats___10")).toMatchObject({ server: "Teams", tool: "list_chats" });
    expect(parseGrokGatewayToolId("tasks__create")).toBeNull();
    expect(parseGrokGatewayToolId("cursor__user-Teams")).toBeNull();
  });

  it("keeps a server name with dashes whole", () => {
    expect(parseGrokGatewayToolId("cursor__user-pulsatrix-connectwise-psa-profile_5fuse___23"))
      .toMatchObject({ server: "pulsatrix-connectwise-psa", tool: "profile_use" });
    expect(parseGrokGatewayToolId("cursor__user-Outlook-calendar-create_5fcalendar_5fevent___21"))
      .toMatchObject({ server: "Outlook-calendar", tool: "create_calendar_event" });
    expect(grokGatewayToolConnector("cursor__user-Outlook-calendar-create_5fcalendar_5fevent___21")).toEqual({ name: "Outlook-calendar", id: "outlook" });
    expect(grokGatewayToolConnector("cursor__user-pulsatrix-connectwise-api_5flist___23")).toEqual({ name: "pulsatrix-connectwise" });
  });

  it("lets the catalog's server names settle a tool name with dashes", () => {
    const tools = ["cursor__user-acme-desk-get-ticket___7", "cursor__user-acme-desk-list-tickets___7", "cursor__user-Teams-list_5fchats___10"];
    const names = gatewayServerNames(tools);
    expect(names).toEqual(["acme-desk"]);
    expect(parseGrokGatewayToolId(tools[0]!, names)).toMatchObject({ server: "acme-desk", tool: "get-ticket" });
    expect(parseGrokGatewayToolId(tools[0]!)).toMatchObject({ server: "acme-desk-get", tool: "ticket" });
  });
});
