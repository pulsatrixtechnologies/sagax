// Organization servers withhold the engines' own shell, file and fetch tools
// (the machine is the Sagax server): the exact CLI flags and the Codex
// requests declined.
import { describe, expect, it } from "vitest";

import { CLAUDE_HOST_TOOLS, CLAUDE_UNUSED_COMMANDS, CLAUDE_UNUSED_TOOLS, CODEX_WITHHELD_APPROVAL, GROK_MCP_TOOLS, PI_HOST_TOOLS, claudeDisallowedTools, codexHostToolArgs, codexHostToolRequest, grokHostToolArgs, grokOrgAgentProfile, piHostToolArgs } from "./host-tools.ts";

describe("Claude Code host tools", () => {
  it("denies shell, file and fetch built-ins, keeping configured denials", () => {
    const denied = claudeDisallowedTools(["Task"], true);
    for (const tool of ["Bash", "BashOutput", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "NotebookEdit", "WebFetch"]) expect(denied).toContain(tool);
    expect(denied).toContain("Task");
    expect(denied).not.toContain("WebSearch");
  });

  it("changes nothing on a solo server", () => {
    expect(claudeDisallowedTools(["Task"], false)).toEqual(["Task", ...CLAUDE_UNUSED_TOOLS]);
    expect(claudeDisallowedTools(undefined, false)).toEqual([...CLAUDE_UNUSED_TOOLS]);
    expect(claudeDisallowedTools(["Task"], false, true)).toEqual(["Task"]);
  });

  it("removes the built-ins a Sagax turn never uses, keeping work tools", () => {
    for (const tool of ["CronCreate", "ScheduleWakeup", "ListAgents", "PushNotification", "RemoteTrigger"]) expect(CLAUDE_UNUSED_TOOLS).toContain(tool);
    for (const tool of ["Bash", "Read", "Write", "Edit", "Task", "WebSearch", "WebFetch", "Skill", "TodoWrite", "ToolSearch", "AskUserQuestion", "Monitor", "Workflow"]) expect(CLAUDE_UNUSED_TOOLS).not.toContain(tool);
    expect([...CLAUDE_UNUSED_COMMANDS].sort()).toEqual(["loop", "schedule"]);
    expect(CLAUDE_HOST_TOOLS.every((tool) => !tool.startsWith("mcp__"))).toBe(true);
  });
});

describe("Codex host tools", () => {
  it("turns the shell off and the sandbox read-only", () => {
    const args = codexHostToolArgs(true).join(" ");
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain("features.unified_exec=false");
    expect(args).toContain('sandbox_mode="read-only"');
    expect(codexHostToolArgs(false)).toEqual([]);
    expect(CODEX_WITHHELD_APPROVAL.turn.sandboxPolicy).toEqual({ type: "readOnly" });
  });

  it("declines every command, patch and permission request, not MCP ones", () => {
    for (const method of ["execCommandApproval", "applyPatchApproval", "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"]) {
      expect(codexHostToolRequest(method)).toBe(true);
    }
    expect(codexHostToolRequest("mcpServer/elicitation/request")).toBe(false);
    expect(codexHostToolRequest("item/tool/requestUserInput")).toBe(false);
  });
});

describe("Grok host tools", () => {
  it("keeps only the MCP tools in the ACP profile, even when a scope allows a host tool", () => {
    const profile = grokOrgAgentProfile(undefined, true);
    expect(profile.injectDefaultTools).toBe(false);
    expect(profile.tools).toEqual([...GROK_MCP_TOOLS]);
    for (const name of ["run_terminal_command", "read_file", "write", "grep", "web_search", "web_fetch", "spawn_subagent", "bash"]) {
      expect(profile.disallowedTools).toContain(name);
      expect(profile.tools).not.toContain(name);
    }
    const narrowed = grokOrgAgentProfile({ allow: ["native:read_file", "native:search_tool", "native:use_tool"] }, false);
    expect(narrowed.tools).toEqual(["search_tool", "use_tool"]);
    expect(narrowed.disallowedTools).toContain("read_file");
    expect(() => grokOrgAgentProfile({ allow: ["native:read_file"] }, true)).toThrow(/search_tool/);
  });

  it("adds deny flags and does not pretend --tools or --sandbox remove tools", () => {
    expect(grokHostToolArgs(false)).toEqual([]);
    const args = grokHostToolArgs(true);
    expect(args).toContain("--no-subagents");
    expect(args).toContain("--disable-web-search");
    expect(args).toContain("--deny");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--disallowed-tools");
  });
});

describe("pi host tools", () => {
  it("drops builtins and discovered extensions only on a withheld turn", () => {
    expect(piHostToolArgs(false)).toEqual([]);
    const args = piHostToolArgs(true);
    expect(args[0]).toBe("--no-builtin-tools");
    expect(args).toContain("--no-extensions");
    expect(args[args.indexOf("--exclude-tools") + 1].split(",")).toEqual([...PI_HOST_TOOLS]);
  });
});
