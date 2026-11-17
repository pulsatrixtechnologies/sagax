import { describe, expect, it } from "vitest";

import { claudeLanding, type LandingEngine } from "./claude-landing.ts";

const engine = (instanceId: string, driverKind: string, ids: string[], enabled = true): LandingEngine => ({ instanceId, driverKind, enabled, models: { options: ids.map((id) => ({ id })) } });
const from = { instanceId: "pi", model: "anthropic/claude-opus-5" };

describe("where a refused Claude account under pi lands (#4410)", () => {
  it("is the Claude engine, with the same model under its own id", () => {
    const engines = [engine("pi", "piAgent", ["anthropic/claude-opus-5"]), engine("codex", "codex", ["gpt-6"]), engine("claude", "claudeAgent", ["claude-opus-5"])];
    expect(claudeLanding(engines, from)).toEqual({ instanceId: "claude", model: "claude-opus-5" });
  });

  it("is nowhere when the Claude engine is off or has not that model", () => {
    expect(claudeLanding([engine("claude", "claudeAgent", ["claude-opus-5"], false)], from)).toBeNull();
    expect(claudeLanding([engine("claude", "claudeAgent", ["claude-haiku-5"])], from)).toBeNull();
    expect(claudeLanding([], from)).toBeNull();
  });
});
