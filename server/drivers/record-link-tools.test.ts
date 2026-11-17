// #4507: every tool of the app's catalog, in every profile, is classified
// once: its words leave the app (record addresses reduced to their label)
// or it keeps its words exactly. A new tool in neither list fails here, so
// none ships unclassified; at run time an unlisted tool is stripped.
import { describe, expect, it } from "vitest";

import { WORDS_KEEP_TOOLS, WORDS_LEAVE_TOOLS, appToolWordsLeave, fileContentArguments, harnessToolWordsLeave } from "../../shared/record-link-tools.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

const ON = {
  SAGAX_BOT_ID: "bot-a", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_AGENT_API: "1", SAGAX_CLAIMS: "1", SAGAX_PERSPICAX_TOOLS: "1",
  SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1", SAGAX_MEETINGS: "1",
  SAGAX_ROUTE_MESSAGES: "1", SAGAX_SINGLE_STREAM: "1", SAGAX_GROUP_MEMORY: "1", SAGAX_MEMORY_ENABLED: "1",
  SAGAX_PHONE_TOOLS: "location,status,sms,call", SAGAX_WEB_SEARCH: "1", SAGAX_VAULT_HTTP: "1", SAGAX_GITHUB_CONNECT: "1",
  SAGAX_ROOM_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1", SAGAX_VOICE_CALL: "1", SAGAX_PROACTIVE_ASK: "1", SAGAX_MEME_REPLIES: "1",
} as const;
const PROFILES: NodeJS.ProcessEnv[] = [
  ON,
  { ...ON, SAGAX_CHIEF_OF_STAFF: "0" },
  { ...ON, SAGAX_GROUP_TURN: "1" },
  { ...ON, SAGAX_PEER_HOP: "1" },
  { ...ON, SAGAX_EXTERNAL_RUNTIME: "1" },
  { ...ON, SAGAX_ROOM_TURN: "0", SAGAX_MEMORY_ENABLED: "0" },
  { SAGAX_BOT_ID: "bot-a" },
];

function catalogNames(): string[] {
  const names = new Set<string>();
  for (const env of PROFILES) for (const tool of availableTools(catalogProfileFromEnv(env))) names.add(tool.name);
  return [...names].sort();
}

describe("record links: every catalog tool is classified", () => {
  it("names every tool of every profile in exactly one list", () => {
    const names = catalogNames();
    expect(names.length).toBeGreaterThan(100);
    const neither = names.filter((name) => !WORDS_LEAVE_TOOLS.has(name) && !WORDS_KEEP_TOOLS.has(name));
    expect(neither, "classify these in shared/record-link-tools.ts").toEqual([]);
    expect([...WORDS_LEAVE_TOOLS].filter((name) => WORDS_KEEP_TOOLS.has(name))).toEqual([]);
  });

  it("strips the tools that send words out, and an unknown tool by default", () => {
    for (const name of ["call_connector", "vault_http_request", "launch_cloud_agent", "cloud_agent_follow_up", "phone_tool",
      "make_image", "make_video", "sagax_web_search", "post_to_room", "ask_bot", "send_prompt", "send_to_bot", "a_tool_added_tomorrow"]) {
      expect(appToolWordsLeave(name, {}), name).toBe(true);
    }
    for (const name of ["save_artifact", "skill_manage", "memory_update", "workspace_read", "vm_exec", "docs_update"]) {
      expect(appToolWordsLeave(name, {}), name).toBe(false);
    }
  });

  it("keeps a connector's file content, through call_connector and in the harness", () => {
    const files = [
      { path: "src/a.ts", content: 'const PREFIX = "sagax://record/";', message: "x" },
      { owner: "o", repo: "r", branch: "main", files: [{ path: "a.ts", content: "x" }], message: "push" },
      { file_path: "/w/a.ts", old_string: "a", new_string: "b" },
      { path: "a.diff", patch: "@@" },
    ];
    for (const input of files) {
      expect(fileContentArguments(input)).toBe(true);
      expect(appToolWordsLeave("call_connector", { connector: "code_host", tool: "create_or_update_file", arguments: input })).toBe(false);
      expect(harnessToolWordsLeave("mcp__code_host__create_or_update_file", input)).toBe(false);
    }
    for (const input of [{ to: "ada@desk.example", body: "x" }, { channel: "c1", text: "x" }, { path: "/inbox", query: "x" }]) {
      expect(fileContentArguments(input)).toBe(false);
      expect(appToolWordsLeave("call_connector", { connector: "mail", tool: "send", arguments: input })).toBe(true);
      expect(harnessToolWordsLeave("mcp__mail__send", input)).toBe(true);
    }
  });

  it("reads the same rule for the CLI: its own tools keep, the agents bridge follows the catalog lists", () => {
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "Read", "Grep"]) expect(harnessToolWordsLeave(tool, {}), tool).toBe(false);
    for (const tool of ["WebFetch", "WebSearch", "SomeNewCliTool"]) expect(harnessToolWordsLeave(tool, {}), tool).toBe(true);
    expect(harnessToolWordsLeave("mcp__agents__send_to_bot", {})).toBe(true);
    expect(harnessToolWordsLeave("mcp__agents__skill_manage", {})).toBe(false);
    expect(harnessToolWordsLeave("mcp__computer__computer_write", { path: "/a", content: "x" })).toBe(false);
    expect(harnessToolWordsLeave("mcp__perspicax_quasar__nimbus_desk_write", {})).toBe(true);
  });
});
