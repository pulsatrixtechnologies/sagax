import { describe, expect, it } from "vitest";

import { AGENT_TOOL_NAMES, AGENT_TOOL_POLICY } from "../agent-api.ts";
import { isReadOnlyAgentTool } from "../agent-tool-policy.ts";
import { AGENT_API_TOOL_NAMES, availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })).map((tool) => tool.name);

describe("agents catalog: the agent-to-agent tools", () => {
  it("mounts the twelve tools in a direct turn when the harness turns them on", () => {
    const chief = names({ SAGAX_AGENT_API: "1", SAGAX_CHIEF_OF_STAFF: "1" });
    for (const tool of AGENT_TOOL_NAMES) expect(chief).toContain(tool);
    expect([...AGENT_API_TOOL_NAMES].sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("create_agent and delete_agent are a Primary Bot's only; get_agent is every bot's", () => {
    const member = names({ SAGAX_AGENT_API: "1" });
    expect(member).toContain("send_prompt");
    expect(member).toContain("get_agent");
    expect(member).not.toContain("create_agent");
    expect(member).not.toContain("delete_agent");
  });

  it("is off by default and for an external runtime; the harness alone decides rooms; old tools stay", () => {
    expect(names({})).not.toContain("list_agents");
    // a direct-coordination turn sets SAGAX_ROOM_TURN too: the tools stay
    expect(names({ SAGAX_AGENT_API: "1", SAGAX_ROOM_TURN: "1" })).toContain("send_prompt");
    expect(names({ SAGAX_AGENT_API: "0", SAGAX_ROOM_TURN: "1" })).not.toContain("send_prompt");
    expect(names({ SAGAX_AGENT_API: "1", SAGAX_EXTERNAL_RUNTIME: "1" })).not.toContain("list_agents");
    const direct = names({ SAGAX_AGENT_API: "1" });
    expect(direct).toContain("list_bots");
    expect(direct).toContain("delegate_bot");
  });

  it("annotates exactly the read tools read-only, matching the core policy", () => {
    const tools = availableTools(catalogProfileFromEnv({ SAGAX_AGENT_API: "1", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_BOT_ID: "b1" }));
    for (const name of AGENT_TOOL_NAMES) {
      const tool = tools.find((candidate) => candidate.name === name) as { annotations?: { readOnlyHint?: boolean } } | undefined;
      expect(isReadOnlyAgentTool(name), name).toBe(AGENT_TOOL_POLICY[name].readOnly);
      expect(tool?.annotations?.readOnlyHint === true, name).toBe(AGENT_TOOL_POLICY[name].readOnly);
    }
  });

  it("schemas match the core limits", () => {
    const tools = availableTools(catalogProfileFromEnv({ SAGAX_AGENT_API: "1", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_BOT_ID: "b1" }));
    const schema = (name: string) => (tools.find((tool) => tool.name === name)!.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(schema("find_agents").limit!.maximum).toBe(64);
    expect(schema("send_prompt").files!.maxItems).toBe(8);
    expect(schema("send_prompt").mode!.enum).toEqual(["fire_and_forget", "blocking", "async"]);
    expect(schema("send_prompt").on_busy!.enum).toEqual(["supersede", "reject", "queue"]);
    expect(schema("send_prompt").priority!.enum).toEqual(["now", "normal"]);
    expect(schema("send_prompt").thread_id).toMatchObject({ type: "string" });
    expect(schema("await_turn").timeout_ms!.maximum).toBe(55_000);
    expect(schema("await_turn").timeout_ms!.minimum).toBe(0);
    expect(schema("await_turn").cursor).toMatchObject({ type: "string" });
    expect(schema("find_agents").status!.enum).toEqual(["running", "idle"]);
    expect(schema("create_agent").idle_hours!.maximum).toBe(720);
  });
});
