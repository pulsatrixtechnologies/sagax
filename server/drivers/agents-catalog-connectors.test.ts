// connectors (#3347, connectors across engines L4): one tool in every turn a
// person's connectors can serve (direct, room, peer hop, routine, chief,
// creator), a read, and no relay to another engine.
import { describe, expect, it } from "vitest";
import { agentToolAnnotations, isReadOnlyAgentTool } from "../tools/agent-tool-policy.ts";
import { MEMBER_OWN_SCOPE_AGENT_TOOLS } from "../people/member-tool-scope.ts";
import { GROK_AGENT_SHORTCUTS } from "./acp/grok-tool-catalog.ts";
import { availableTools, catalogProfileFromEnv, DEFERRED_AGENT_TOOL_NAMES, knownAgentToolName } from "./agents-catalog.ts";
import { CONNECTORS_TOOL_NAME } from "./agents-call-connectors.ts";

type Env = Record<string, string>;
const PROFILES: Record<string, Env> = {
  direct: { SAGAX_ROOM_TURN: "1" },
  directSolo: {},
  room: { SAGAX_GROUP_TURN: "1", SAGAX_ROOM_TURN: "1" },
  peerHop: { SAGAX_PEER_HOP: "1" },
  roomPeerHop: { SAGAX_GROUP_TURN: "1", SAGAX_ROOM_TURN: "1", SAGAX_PEER_HOP: "1" },
  chief: { SAGAX_ROOM_TURN: "1", SAGAX_CHIEF_OF_STAFF: "1" },
  creator: { SAGAX_ROOM_TURN: "1", SAGAX_CREATE_BOTS: "1" },
  organization: { SAGAX_ROOM_TURN: "1", SAGAX_PERSPICAX_TOOLS: "1", SAGAX_AGENT_API: "1" },
};

const tool = (env: Env) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", ...env })).find((entry) => entry.name === CONNECTORS_TOOL_NAME);

describe("the connectors tool", () => {
  for (const [label, env] of Object.entries(PROFILES)) {
    it(`is offered in the ${label} profile`, () => {
      expect(tool(env)).toBeDefined();
    });
  }

  it("takes no person: only connector and query", () => {
    const def = tool(PROFILES.direct)!;
    const schema = def.inputSchema as { properties: Record<string, unknown>; additionalProperties: boolean; required?: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual(["connector", "query"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required ?? []).toEqual([]);
  });

  it("is a read, scoped to the member's own conversation, one ToolSearch step away like open_connector_setup", () => {
    expect(isReadOnlyAgentTool(CONNECTORS_TOOL_NAME)).toBe(true);
    expect(agentToolAnnotations(CONNECTORS_TOOL_NAME)?.readOnlyHint).toBe(true);
    expect(MEMBER_OWN_SCOPE_AGENT_TOOLS[CONNECTORS_TOOL_NAME]).toBe("conversation");
    expect(DEFERRED_AGENT_TOOL_NAMES.has(CONNECTORS_TOOL_NAME)).toBe(DEFERRED_AGENT_TOOL_NAMES.has("open_connector_setup"));
    expect(knownAgentToolName(CONNECTORS_TOOL_NAME)).toBe(true);
  });

  it("is named for Grok with its arguments", () => {
    expect(GROK_AGENT_SHORTCUTS.find((entry) => entry.tool === CONNECTORS_TOOL_NAME)?.args).toBe("{}");
  });

  it("never steers to another engine", () => {
    expect(JSON.stringify(tool(PROFILES.direct))).not.toContain("run_with_engine");
    expect(CONNECTORS_TOOL_NAME).not.toContain("__");
  });
});
