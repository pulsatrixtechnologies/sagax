import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLearnedRouter, outcomeOfSettledTurn, type RoutingOutcome } from "./learned-routing.ts";

const NOW = Date.UTC(2026, 10, 22, 15, 0);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const context = { provider: "anthropic", requestedModel: "fast", hourUtc: 15, promptTokens: 400, fresh: false };

function outcome(patch: Partial<RoutingOutcome> = {}): RoutingOutcome {
  return {
    instanceId: "claude",
    model: "fast",
    context,
    ttftMs: 200,
    tokensPerSec: 40,
    error: false,
    rateLimited: false,
    quotaBurn: 1,
    costTier: 1,
    at: NOW,
    ...patch,
  };
}

describe("learned routing counts", () => {
  it("writes counts under usage/learned-routing.json and nothing of the turn", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-learned-"));
    dirs.push(dir);
    const router = createLearnedRouter({ dataDir: dir, now: () => NOW });
    router.record(outcome());
    router.flush();
    const file = join(dir, "usage", "learned-routing.json");
    const text = readFileSync(file, "utf8");
    const saved = JSON.parse(text) as { version: number; total: number };
    expect(saved.version).toBe(1);
    expect(saved.total).toBe(1);
    expect(text).not.toMatch(/sk-|bearer|prompt text/i);
  });

  it("drops a stopped turn and keeps the model the person chose", () => {
    const kept = outcomeOfSettledTurn({
      instanceId: "claude-work",
      model: "fast",
      provider: "anthropic",
      promptTokens: 400,
      fresh: false,
      ttftMs: 180,
      durationMs: 2_000,
      outputTokens: 80,
      ok: true,
      stopped: false,
      limited: null,
      quotaBurn: 0,
      costTier: 1,
      at: NOW,
    });
    expect(kept?.model).toBe("fast");
    expect(kept?.context.requestedModel).toBe("fast");
    expect(kept?.instanceId).toBe("claude-work");
    expect(outcomeOfSettledTurn({
      instanceId: "claude",
      model: "fast",
      provider: "anthropic",
      promptTokens: 0,
      fresh: false,
      ttftMs: 0,
      durationMs: 100,
      outputTokens: 0,
      ok: false,
      stopped: true,
      limited: null,
      quotaBurn: 0,
      costTier: 1,
      at: NOW,
    })).toBeNull();
  });

  it("marks a rate limit as a rate limit and a failed turn as an error", () => {
    const limited = outcomeOfSettledTurn({
      instanceId: "claude", model: "fast", provider: "anthropic", promptTokens: 10, fresh: true,
      ttftMs: 50, durationMs: 50, outputTokens: 0, ok: false, stopped: false, limited: "rate_limited",
      quotaBurn: 0, costTier: 1, at: NOW,
    });
    expect(limited).toMatchObject({ model: "fast", error: true, rateLimited: true });
    const failed = outcomeOfSettledTurn({
      instanceId: "claude", model: "fast", provider: "anthropic", promptTokens: 10, fresh: false,
      ttftMs: 50, durationMs: 800, outputTokens: 0, ok: false, stopped: false, limited: null,
      quotaBurn: 0, costTier: 2, at: NOW,
    });
    expect(failed).toMatchObject({ error: true, rateLimited: false, costTier: 2 });
  });
});
