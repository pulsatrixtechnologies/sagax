import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv, type CatalogProfile } from "../drivers/agents-catalog.ts";
import { builtinAgentToolName, HOST_LEVEL_AGENT_TOOLS, MEMBER_OWN_SCOPE_AGENT_TOOLS, memberOwnScopeTool, ownBotReadAct } from "./member-tool-scope.ts";
import { describeApproval } from "../../shared/approval-describe.ts";
import { memberBotAdminApproval } from "../engines/engine-access.ts";

const everything: CatalogProfile = {
  externalRuntime: false, coordinating: false, ownThreadCreation: true, skillAuthoring: true, sharedComputers: true,
  voiceNotes: true, cloudHome: false, memoryEnabled: true, groupMemory: true, chief: true, claims: true, botId: "bot-1",
};

// These Agent API entries run only for a person's AI client. A bot caller is
// refused by the server and uses its native setup/routine tools below.
const PERSON_CLIENT_TOOLS = new Set(["update_agent_model", "update_agent_settings", "update_routine", "create_routine", "delete_routine"]);

/** Every tool the agents catalog can show, across the profiles that change it. */
function catalogNames(): string[] {
  const names = new Set<string>();
  // every switch that adds a tool (2026-10-28: several were missing, so their
  // tools were never checked and waited for an admin unclassified)
  const widest: CatalogProfile = {
    ...everything, meetings: true, singleStream: true, routeMessages: true, githubConnect: true, createBots: true,
    agentApi: true, perspicax: true, phoneTools: ["location"], webSearch: true, vaultHttp: true,
  };
  for (const profile of [
    everything,
    widest,
    { ...widest, coordinating: true },
    { ...everything, externalRuntime: true },
    { ...widest, voiceCall: true },
  ]) {
    for (const tool of availableTools(profile)) names.add(tool.name);
  }
  // the Watcher's own card tool is shown to that one bot only
  names.add("create_options_card");
  return [...names].sort();
}

describe("member tool scope on an organization server", () => {
  it("classifies every agents tool exactly once: the member's own scope or the admin gate", () => {
    const invalid = catalogNames().flatMap((name) => {
      if (PERSON_CLIENT_TOOLS.has(name)) return [];
      const own = Object.hasOwn(MEMBER_OWN_SCOPE_AGENT_TOOLS, name);
      const host = HOST_LEVEL_AGENT_TOOLS.has(name);
      return own !== host ? [] : [{ name, own, host }];
    });
    expect(invalid, "Every agents tool must be classified exactly once").toEqual([]);
  });

  it("keeps person-client writes separate from the bot's native own-environment operations", () => {
    for (const name of PERSON_CLIENT_TOOLS) {
      expect(memberOwnScopeTool(`agents__${name}`), name).toBeNull();
      expect(HOST_LEVEL_AGENT_TOOLS.has(name), name).toBe(false);
    }
    const native = availableTools(everything).map((tool) => tool.name);
    for (const name of ["propose_team_setup", "propose_routine_action", "manage_settings", "act"]) {
      expect(native, name).toContain(name);
      expect(memberOwnScopeTool(`agents__${name}`), name).toBe("own-setup");
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
    // 2026-10-26: a pairing code for the member's own device
    expect(memberOwnScopeTool("mcp__agents__manage_pairing")).toBe("own-setup");
    expect(HOST_LEVEL_AGENT_TOOLS.has("manage_pairing")).toBe(false);
    // #1269: act and manage_settings run as the person, with their own rights
    expect(memberOwnScopeTool("agents__act")).toBe("own-setup");
    expect(memberOwnScopeTool("mcp__agents__act")).toBe("own-setup");
    expect(memberOwnScopeTool("agents__manage_settings")).toBe("own-setup");
    expect(HOST_LEVEL_AGENT_TOOLS.has("act")).toBe(false);
  });

  it("lets the member's own tasks, search, key, phone, GitHub, agents, cloud agents and OpenAPI operations run without an admin", () => {
    for (const name of ["task_list", "make_video", "sagax_web_search", "vault_http_request", "phone_tool", "connect_github", "send_prompt", "create_agent", "delete_agent",
      "launch_cloud_agent", "cloud_agent_follow_up", "cancel_cloud_agent", "archive_cloud_agent", "openapi_getnote"]) {
      expect(memberOwnScopeTool(`mcp__agents__${name}`), name).not.toBeNull();
    }
    expect(memberOwnScopeTool("agents__openapi_")).toBeNull();
    expect(memberOwnScopeTool("notes__openapi_getnote")).toBeNull();
  });

  // #2199: choose_page_target only picks a surface in the member's own chat;
  // it must never wait for an organization admin as a host-level command.
  it.each([
    ["choose_page_target", "conversation"],
    ["ask_choice", "conversation"],
    ["propose_page", "conversation"],
    ["save_artifact", "conversation"],
    ["claude_artifact", "conversation"],
    ["create_options_card", "conversation"],
    ["wait_until", "own-work"],
    ["cancel_wait", "own-work"],
    ["propose_rule", "own-setup"],
    ["place_call", "conversation"],
    ["send_dtmf", "conversation"],
    ["transfer", "conversation"],
    ["hang_up", "conversation"],
  ] as const)("keeps %s at the member's own level without trusting another server's spelling", (tool, family) => {
    const name = `mcp__agents__${tool}`;
    const scope = { workspaceRoot: "/member/task-workspaces/bot-1" };
    expect(memberOwnScopeTool(name)).toBe(family);
    expect(memberBotAdminApproval({ ...scope, tool: name })).toBe(false);
    // An arbitrary MCP server cannot borrow the built-in tool's exemption,
    // even when its mount name is agents. Nor can a command borrow it.
    expect(memberOwnScopeTool(`notes__${tool}`)).toBeNull();
    expect(memberBotAdminApproval({ ...scope, tool: `notes__${tool}` })).toBe(true);
    expect(memberBotAdminApproval({ ...scope, tool: name, foreignMcpServers: ["agents"] })).toBe(true);
    expect(memberBotAdminApproval({ ...scope, tool: name, command: "echo changed" })).toBe(true);
  });

  it("keeps the host-level agents tools, other servers and look-alikes behind the admin gate", () => {
    for (const name of [
      "notes__act", "notes__manage_pairing", "agents__add_mcp_server", "agents__attach_file", "agents__vm_exec", "agents__shared_computer", "agents__api_reload", "agents__review_write",
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

  it("treats a read with no effect of the member's own bot as not an admin act (#1269)", () => {
    const scope = { ownsBot: (id: string) => id === "bot-1", callerBotId: "bot-1" };
    const read = { method: "GET", path: "/api/bots/bot-1/export.zip" };
    expect(ownBotReadAct("agents__act", read, scope)).toBe(true);
    expect(ownBotReadAct("mcp__agents__act", JSON.stringify(read), scope)).toBe(true);
    expect(describeApproval("agents__act", JSON.stringify(read)).risk).toBe("read");
    expect(ownBotReadAct("agents__act", { method: "get", path: "/api/bots/bot-1/" }, scope)).toBe(true);
    expect(ownBotReadAct("agents__act", { method: "POST", path: "/api/bots/bot-1" }, scope)).toBe(false);
    expect(ownBotReadAct("agents__act", { method: "GET", path: "/api/bots/bot-2" }, scope)).toBe(false);
    expect(ownBotReadAct("agents__act", { method: "GET", path: "/api/bots/bot-1%2fsecret" }, scope)).toBe(false);
    expect(ownBotReadAct("agents__act", { ui: "showTeamMap" }, scope)).toBe(false);
    expect(ownBotReadAct("agents__act", read, undefined)).toBe(false);
    expect(ownBotReadAct("agents__manage_settings", { action: "get" }, scope)).toBe(false);
  });
});
