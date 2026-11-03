// route_message (server/busy-routing.ts) is shown only in a person's 1:1
// turn (SAGAX_ROUTE_MESSAGES), so every other catalog is unchanged.
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { isReadOnlyAgentTool } from "../tools/agent-tool-policy.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })).map((tool) => tool.name);

describe("agents catalog: route_message (sends while the bot works)", () => {
  it("is offered only in a person's 1:1 turn, never to an external runtime, and is not a read", () => {
    expect(names({})).not.toContain("route_message");
    expect(names({ SAGAX_ROUTE_MESSAGES: "0" })).not.toContain("route_message");
    expect(names({ SAGAX_ROUTE_MESSAGES: "1" })).toContain("route_message");
    expect(names({ SAGAX_ROUTE_MESSAGES: "1", SAGAX_EXTERNAL_RUNTIME: "1" })).not.toContain("route_message");
    expect(isReadOnlyAgentTool("route_message")).toBe(false);
  });
});
