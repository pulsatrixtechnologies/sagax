// Organization servers withhold the engines' own shell, file and fetch tools
// (the machine is the Sagax server): the exact CLI flags and the Codex
// requests declined.
import { describe, expect, it } from "vitest";

import { CLAUDE_HOST_TOOLS, CLAUDE_ORG_TOOLS, CLAUDE_UNUSED_COMMANDS, CLAUDE_UNUSED_TOOLS, CODEX_WITHHELD_APPROVAL, GROK_IMAGE_TOOLS, GROK_MCP_TOOLS, GROK_VIDEO_TOOLS, OPENCODE_HOST_PERMISSIONS, PI_HOST_TOOLS, claudeDisallowedTools, claudeOrgTools, codexHostToolArgs, codexHostToolRequest, grokHostToolArgs, grokOrgAgentProfile, opencodeOrgPermission, piHostToolArgs } from "./host-tools.ts";

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

describe("Claude Code organization allowlist", () => {
  it.each(["Artifact", "ArtifactData", "ArtifactComments"])("keeps selected account-backed %s tools on organization turns (#1990)", (tool) => {
    expect(claudeOrgTools([tool], true)).toBe(tool);
    expect(claudeDisallowedTools(undefined, true, true)).not.toContain(tool);
    expect(claudeDisallowedTools([tool], true, true)).toContain(tool);
  });
  it("names the allowlist on an organization server and nothing on a solo one", () => {
    expect(claudeOrgTools(undefined, true)).toBe(CLAUDE_ORG_TOOLS.join(","));
    expect(claudeOrgTools(undefined, false)).toBeNull();
    expect(claudeOrgTools(["Bash", "Read"], false)).toBeNull();
  });

  it("keeps only the allowlisted names of a selection", () => {
    expect(claudeOrgTools(["Bash", "WebSearch", "Agent", "SomeFutureTool"], true)).toBe("WebSearch,Agent");
    expect(claudeOrgTools([], true)).toBe("");
  });

  it("keeps the tools a withheld turn had under the deny list, and no host tool", () => {
    for (const tool of ["Task", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "SendMessage", "Skill", "ToolSearch", "WebSearch"]) expect(CLAUDE_ORG_TOOLS).toContain(tool);
    for (const tool of CLAUDE_ORG_TOOLS) {
      expect(CLAUDE_HOST_TOOLS).not.toContain(tool);
      expect(CLAUDE_UNUSED_TOOLS).not.toContain(tool);
    }
  });
});

describe("OpenCode organization allowlist", () => {
  it("denies every tool, then lets the todo list and the turn's MCP servers back in", () => {
    const ask = JSON.parse(opencodeOrgPermission(false, ["agents", "my server"]));
    expect(Object.keys(ask)[0]).toBe("*");
    expect(ask["*"]).toBe("deny");
    expect(ask).toMatchObject({ todowrite: "allow", todoread: "allow", doom_loop: "ask", "agents_*": "ask", "my_server_*": "ask" });
    for (const key of OPENCODE_HOST_PERMISSIONS) expect(ask[key]).toBe("deny");
    const full = JSON.parse(opencodeOrgPermission(true, ["agents"]));
    expect(full).toMatchObject({ "*": "deny", "agents_*": "allow", doom_loop: "allow" });
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
  it("keeps the MCP tools, video and images in the ACP profile, and not the shell", () => {
    const profile = grokOrgAgentProfile(undefined, true);
    expect(profile.injectDefaultTools).toBe(false);
    expect(profile.tools).toEqual([...GROK_MCP_TOOLS, ...GROK_VIDEO_TOOLS, ...GROK_IMAGE_TOOLS]);
    for (const name of ["run_terminal_command", "read_file", "write", "grep", "web_search", "web_fetch", "spawn_subagent", "bash"]) {
      expect(profile.disallowedTools).toContain(name);
      expect(profile.tools).not.toContain(name);
    }
    // #1426: a member's bot makes images with the Grok account its turn runs on
    for (const name of [...GROK_VIDEO_TOOLS, ...GROK_IMAGE_TOOLS]) {
      expect(profile.tools).toContain(name);
      expect(profile.disallowedTools).not.toContain(name);
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
