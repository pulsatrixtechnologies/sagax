import { describe, expect, it } from "vitest";
import { pluginAgentToolScope } from "./plugin-team-tools.ts";

// #2669: a plugin agent's frontmatter tools become a real per-bot selection.
describe("pluginAgentToolScope", () => {
  it("keeps every tool when the agent names none", () => {
    expect(pluginAgentToolScope([], "piAgent")).toEqual({ notes: [] });
  });

  it("narrows Pi's built-in tools and keeps Sagax's own servers", () => {
    const { scope, notes } = pluginAgentToolScope(["Read", "Grep", "mcp__github__get_issue"], "piAgent");
    expect(scope?.allow).toEqual(expect.arrayContaining(["native:read", "native:grep", "mcp:github:get_issue", "mcp:agents:*"]));
    expect(scope?.allow).not.toContain("native:*");
    expect(notes).toEqual([]);
  });

  it("restricts only app tools on an engine that gates MCP, and says so", () => {
    const { scope, notes } = pluginAgentToolScope(["Read", "mcp__github"], "claudeAgent");
    expect(scope?.allow).toEqual(expect.arrayContaining(["native:*", "mcp:github:*", "mcp:agents:*"]));
    expect(notes.join(" ")).toContain("Read stay a guideline");
  });
});
