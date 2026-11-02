import { describe, expect, it } from "vitest";
import { agentToolAnnotations, isReadOnlyAgentTool, READ_ONLY_AGENT_TOOL_NAMES } from "./agent-tool-policy.ts";

describe("built-in agent tool read policy", () => {
  it("includes only the reviewed local reads", () => {
    expect([...READ_ONLY_AGENT_TOOL_NAMES]).toEqual([
      "list_bots",
      "list_team_setup",
      "list_shared_computers",
      "list_rooms",
      "list_threads",
      "check_delegation",
      "wait_delegation",
      "session_search",
      "session_read",
      "recall_topic",
      "tool_result_read",
      "list_routines",
      "list_waits",
      "skills_list",
      "workspace_read",
      "workspace_search",
      "sagax_help",
      "list_agents",
      "find_agents",
      "get_agent",
      "await_turn",
      "read_transcript",
      "read_transcript_page",
      "read_latest_page",
      "read_latest_page_with_threads",
      "read_transcript_cold",
      "list_cloud_agents",
      "get_cloud_agent",
      "find_cloud_agent_by_pr",
      "cloud_agent_transcript",
      "list_cloud_agent_artifacts",
      "claim_list",
      "list_artifacts",
    ]);
    for (const name of READ_ONLY_AGENT_TOOL_NAMES) {
      expect(isReadOnlyAgentTool(name)).toBe(true);
      expect(agentToolAnnotations(name)).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it.each([
    "shared_computer", "ask_bot", "delegate_bot", "start_thread", "close_thread", "post_to_room",
    // These post into the chat: never read-only.
    "attach_file", "show_widget", "update_widget",
    "create_bot", "request_credential", "memory_update", "propose_routine",
    "propose_routine_action", "propose_profile", "skill_manage",
    "propose_team_setup", "propose_bot_deletion",
    "list_secrets", "read_credentials", "list_bots_and_delete", "unknown", "",
    "mcp__agents__list_bots", "agents.list_bots", "LIST_BOTS", " list_bots",
  ])("does not infer read access for %s", (name) => {
    expect(isReadOnlyAgentTool(name)).toBe(false);
    expect(agentToolAnnotations(name)).toBeUndefined();
  });
});
