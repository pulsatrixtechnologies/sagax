import { describe, expect, it } from "vitest";

import { resolveClaudeSubagentModel } from "./claude-subagent-model.ts";

describe("resolveClaudeSubagentModel (#2038)", () => {
  const fast = { instanceId: "claude", model: "claude-haiku-4-5" };

  it("uses the bot's fast model on the same engine when nothing else is set", () => {
    expect(resolveClaudeSubagentModel({ fast, turnInstanceId: "claude" })).toBe("claude-haiku-4-5");
  });

  it("ignores a fast model on another engine (no blind default)", () => {
    expect(resolveClaudeSubagentModel({ fast, turnInstanceId: "codex" })).toBeUndefined();
    expect(resolveClaudeSubagentModel({ turnInstanceId: "claude" })).toBeUndefined();
    expect(resolveClaudeSubagentModel({ fast: { instanceId: "claude", model: "" }, turnInstanceId: "claude" })).toBeUndefined();
  });

  it("prefers the routine model over the fast model", () => {
    expect(resolveClaudeSubagentModel({
      routineModel: "claude-sonnet-4-5",
      fast,
      turnInstanceId: "claude",
    })).toBe("claude-sonnet-4-5");
  });

  it("lets a per-routine subagentModel override the routine model and the fast model", () => {
    expect(resolveClaudeSubagentModel({
      routineSubagentModel: "claude-haiku-4-5",
      routineModel: "claude-opus-4-5",
      fast: { instanceId: "claude", model: "claude-sonnet-4-5" },
      turnInstanceId: "claude",
    })).toBe("claude-haiku-4-5");
    expect(resolveClaudeSubagentModel({
      routineSubagentModel: "claude-haiku-4-5",
      fast,
      turnInstanceId: "claude",
    })).toBe("claude-haiku-4-5");
  });

  it("keeps today's behaviour without a fast model or a routine model", () => {
    expect(resolveClaudeSubagentModel({ turnInstanceId: "claude" })).toBeUndefined();
  });
});

/**
 * Representative routine-pass contract (#2038 Measure).
 *
 * Before: no CLAUDE_CODE_SUBAGENT_MODEL → each Agent inherits Opus (main).
 * Production baseline from the issue: 4.0–5.7M input tokens per pass,
 * sub-agents climbing to 140k–170k tokens each from the same context floor.
 *
 * After: with modelSelection.fast on the same Claude engine, every sub-agent
 * launch records the fast model id. The main turn stays on the reasoning
 * model. Token savings are measured on a live pass once the bot has a fast
 * model; this unit pins the contract that drives that measurement.
 */
describe("representative task contract (#2038 measure)", () => {
  const main = "claude-opus-4-5";
  const fast = { instanceId: "claude", model: "claude-haiku-4-5" };

  it("before: no fast model → no subagent env (inherits main / CLI default)", () => {
    expect(resolveClaudeSubagentModel({ turnInstanceId: "claude" })).toBeUndefined();
  });

  it("after: same-engine fast model → sub-agents record the fast id; main stays untouched", () => {
    const subagent = resolveClaudeSubagentModel({ fast, turnInstanceId: "claude" });
    expect(subagent).toBe("claude-haiku-4-5");
    expect(subagent).not.toBe(main);
  });
});
