import { type ModelFamily } from "../achievements/achievements-mastery.ts";
import type { AchievementEvent } from "../achievements/achievements.ts";

export type ClaudeTide = "opus" | "sonnet" | "haiku";

export function claudeTide(model: string | undefined | null): ClaudeTide | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  if (id.includes("opus")) return "opus";
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  return undefined;
}

export function isClaudeComputerTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "computer_use" || n === "computer_exec" || n.startsWith("mcp__computer__");
}

export function claudeActivityEvents(input: {
  family: ModelFamily | null;
  kind: "turn" | "subagent" | "routine" | "computer" | "voice";
  model?: string | null;
}): AchievementEvent[] {
  if (input.family !== "anthropic") return [];
  if (input.kind === "turn") {
    const key = claudeTide(input.model);
    return [{ type: "claude.turn", ...(key ? { key } : {}) }];
  }
  if (input.kind === "subagent") return [{ type: "claude.subagent" }];
  if (input.kind === "routine") return [{ type: "claude.routine" }];
  if (input.kind === "computer") return [{ type: "claude.computer" }];
  return [{ type: "claude.voice" }];
}
