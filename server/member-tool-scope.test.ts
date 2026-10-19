import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv, type CatalogProfile } from "./drivers/agents-catalog.ts";
import { builtinAgentToolName, HOST_LEVEL_AGENT_TOOLS, MEMBER_OWN_SCOPE_AGENT_TOOLS, memberOwnScopeTool } from "./member-tool-scope.ts";

const everything: CatalogProfile = {
  externalRuntime: false, skillAuthoring: true, sharedComputers: true,
  voiceNotes: true, cloudHome: false, memoryEnabled: true, groupMemory: true, chief: true, claims: true, botId: "bot-1",
};

/** Every tool the agents catalog can show, across the profiles that change it. */
function catalogNames(): string[] {
  const names = new Set<string>();
  for (const profile of [
    everything,
    { ...everything, externalRuntime: true },
    { ...everything, voiceCall: true },
  ]) {
    for (const tool of availableTools(profile)) names.add(tool.name);
  }
  // the Watcher's own card tool is shown to that one bot only
  names.add("create_options_card");
  return [...names].sort();
}

describe("member tool scope on an organization server", () => {
  it("classifies every agents tool exactly once: the member's own scope or the admin gate", () => {
    for (const name of catalogNames()) {
      const own = Object.hasOwn(MEMBER_OWN_SCOPE_AGENT_TOOLS, name);
      const host = HOST_LEVEL_AGENT_TOOLS.has(name);
      expect(own !== host, `${name} must be classified once (own ${own}, host ${host})`).toBe(true);
    }
  });

  it("lets the reads and the bot's own work run without an admin, in every engine's spelling", () => {
    for (const name of ["mcp__agents__list_bots", "agents__list_bots", "agents.list_bots", "agents:list_bots"]) {
      expect(memberOwnScopeTool(name), name).toBe("read");
    }
    expect(memberOwnScopeTool("agents__list_threads")).toBe("read");
    expect(memberOwnScopeTool("agents__session_search")).toBe("read");
    expect(memberOwnScopeTool("agents__ask_bot")).toBe("conversation");
    expect(memberOwnScopeTool("agents__memory_update")).toBe("memory");
    expect(memberOwnScopeTool("agents__propose_routine")).toBe("own-setup");
    expect(memberOwnScopeTool("agents__end_call")).toBe("conversation");
    expect(memberOwnScopeTool("agents__claim")).toBe("conversation");
    expect(memberOwnScopeTool("agents__claim_renew")).toBe("conversation");
    expect(memberOwnScopeTool("agents__claim_release")).toBe("conversation");
    expect(memberOwnScopeTool("agents__claim_list")).toBe("read");
  });

  it("keeps the host-level agents tools, other servers and look-alikes behind the admin gate", () => {
    for (const name of [
      "agents__act", "agents__add_mcp_server", "agents__attach_file", "agents__vm_exec", "agents__shared_computer",
      "agents__unknown_tool", "notes__list_bots", "mcp__computer__click", "list_bots", "other", "shell",
      "agents__list_bots ", " agents__list_bots", "agents__list_bots; rm -rf /", "AGENTS__LIST_BOTS", "",
    ]) {
      expect(memberOwnScopeTool(name), name).toBeNull();
    }
    expect(memberOwnScopeTool(undefined)).toBeNull();
    const onCall = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", SAGAX_VOICE_CALL: "1" })).map((tool) => tool.name);
    const offCall = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1" })).map((tool) => tool.name);
    const outside = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", SAGAX_EXTERNAL_RUNTIME: "1", SAGAX_VOICE_CALL: "1" })).map((tool) => tool.name);
    expect(onCall).toContain("end_call");
    expect(offCall).not.toContain("end_call");
    expect(outside).not.toContain("end_call");
    expect(builtinAgentToolName("mcp__agents__list_bots")).toBe("list_bots");
    expect(builtinAgentToolName("mcp__agentsx__list_bots")).toBeNull();
  });
});
