import { describe, expect, it } from "vitest";
import { modelFamily } from "../achievements/achievements-mastery.ts";
import { claudeActivityEvents, claudeTide, isClaudeComputerTool } from "./claude-activity.ts";

describe("claudeTide", () => {
  it("keys opus, sonnet and haiku by id substring and ignores other anthropic ids", () => {
    expect(claudeTide("claude-opus-4-6")).toBe("opus");
    expect(claudeTide("claude-sonnet-4-5")).toBe("sonnet");
    expect(claudeTide("claude-haiku-4-5")).toBe("haiku");
    expect(claudeTide("claude-fable")).toBeUndefined();
    expect(claudeTide("grok-4")).toBeUndefined();
    expect(claudeTide("")).toBeUndefined();
  });
});

describe("claudeActivityEvents", () => {
  // Org-key Claude turns still emit claude.turn. claudeActivityEvents does not
  // read credentials, so an anthropic turn records even when claudeAccountLinked
  // is false.
  it("emits claude.turn without a key for Fable, and nothing for non-anthropic", () => {
    expect(modelFamily("claude-fable")).toBe("anthropic");
    expect(claudeActivityEvents({ family: "anthropic", kind: "turn", model: "claude-fable" })).toEqual([{ type: "claude.turn" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "turn", model: "claude-opus-4-6" })).toEqual([{ type: "claude.turn", key: "opus" }]);
    expect(claudeActivityEvents({ family: "xai", kind: "turn", model: "grok-4" })).toEqual([]);
    expect(claudeActivityEvents({ family: null, kind: "turn", model: "llama-3" })).toEqual([]);
  });

  it("counts Auto when the completed turn's family is anthropic", () => {
    expect(claudeActivityEvents({ family: modelFamily("claude-sonnet-4-5"), kind: "turn", model: "claude-sonnet-4-5" })).toEqual([{ type: "claude.turn", key: "sonnet" }]);
  });

  it("emits subagent, routine, computer and voice only on anthropic", () => {
    expect(claudeActivityEvents({ family: "anthropic", kind: "subagent" })).toEqual([{ type: "claude.subagent" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "routine" })).toEqual([{ type: "claude.routine" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "computer" })).toEqual([{ type: "claude.computer" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "voice" })).toEqual([{ type: "claude.voice" }]);
    expect(claudeActivityEvents({ family: "openai", kind: "subagent" })).toEqual([]);
  });

  it("recognises Computer Use tool names and not computer.control", () => {
    expect(isClaudeComputerTool("computer_use")).toBe(true);
    expect(isClaudeComputerTool("computer_exec")).toBe(true);
    expect(isClaudeComputerTool("mcp__computer__click")).toBe(true);
    expect(isClaudeComputerTool("computer_select")).toBe(false);
  });
});
