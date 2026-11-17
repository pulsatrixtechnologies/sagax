import { describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { PI_CLAUDE_SIGN_IN_ENV } from "../engines/engine-credentials.ts";
import { holdClaudeAccountRefusal, isClaudeAccountRefusal, PiClaudeAccountRefusedError, turnUsesClaudeAccount } from "./pi-claude-refusal.ts";

const base = { threadId: "t1", turnId: "turn-1" };
const ev = (event: Record<string, unknown>) => ({ ...base, ...event }) as unknown as RuntimeEvent;

describe("the vendor's refusal of a Claude account under pi (#4410)", () => {
  it.each([
    "OAuth authentication is currently not supported.",
    "401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid x-api-key\"}}",
    "This credential is only authorized for use with Claude Code and cannot be used for other API requests.",
    "403 permission_error: third-party applications are not allowed on this plan",
  ])("is read as a refusal: %s", (text) => {
    expect(isClaudeAccountRefusal(text)).toBe(true);
  });

  it.each([
    "429 rate_limit_error: slow down",
    "529 overloaded_error",
    "fetch failed: ECONNRESET",
    "You have reached your usage limit",
    "git: failed to authenticate with the remote",
    undefined,
  ])("is not one: %s", (text) => {
    expect(isClaudeAccountRefusal(text)).toBe(false);
  });

  it("knows a turn that carries the person's sign-in", () => {
    expect(turnUsesClaudeAccount({ access: { environment: { [PI_CLAUDE_SIGN_IN_ENV]: "x" } } as never })).toBe(true);
    expect(turnUsesClaudeAccount({ access: { environment: { OPENAI_API_KEY: "x" } } as never })).toBe(false);
    expect(turnUsesClaudeAccount({})).toBe(false);
  });
});

describe("holdClaudeAccountRefusal", () => {
  it("drops a refused turn's words and rejects it as not started, with nothing shown", async () => {
    const seen: RuntimeEvent[] = [];
    const hold = holdClaudeAccountRefusal((event) => seen.push(event));
    hold.emit(ev({ type: "turn.started" }));
    hold.emit(ev({ type: "runtime.error", message: "OAuth authentication is currently not supported." }));
    hold.emit(ev({ type: "turn.completed", ok: false, stopReason: "failed" }));
    await expect(hold.outcome).rejects.toBeInstanceOf(PiClaudeAccountRefusedError);
    await expect(hold.outcome).rejects.toMatchObject({ turnId: "turn-1", name: "PiClaudeAccountRefusedError" });
    expect(seen).toEqual([]);
  });

  it("lets a turn through, in order, once the model answered", async () => {
    const seen: string[] = [];
    const hold = holdClaudeAccountRefusal((event) => seen.push(event.type));
    hold.emit(ev({ type: "turn.started" }));
    hold.emit(ev({ type: "content.delta", text: "Hello" }));
    hold.emit(ev({ type: "turn.completed", ok: true }));
    await expect(hold.outcome).resolves.toBeUndefined();
    expect(seen).toEqual(["turn.started", "content.delta", "turn.completed"]);
  });

  it("never swallows a refusal that came after the model spoke", async () => {
    const seen: string[] = [];
    const hold = holdClaudeAccountRefusal((event) => seen.push(event.type));
    hold.emit(ev({ type: "content.delta", text: "partial" }));
    hold.emit(ev({ type: "runtime.error", message: "OAuth authentication is currently not supported." }));
    hold.emit(ev({ type: "turn.completed", ok: false }));
    await expect(hold.outcome).resolves.toBeUndefined();
    expect(seen).toEqual(["content.delta", "runtime.error", "turn.completed"]);
  });

  it("passes another failure (a rate limit) on as the engine's own words", async () => {
    const seen: string[] = [];
    const hold = holdClaudeAccountRefusal((event) => seen.push(event.type));
    hold.emit(ev({ type: "runtime.error", message: "429 rate_limit_error" }));
    hold.emit(ev({ type: "turn.completed", ok: false }));
    await expect(hold.outcome).resolves.toBeUndefined();
    expect(seen).toEqual(["runtime.error", "turn.completed"]);
  });

  it("stops waiting on a silent turn", async () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const hold = holdClaudeAccountRefusal((event) => seen.push(event.type), 50);
      hold.emit(ev({ type: "turn.started" }));
      await vi.advanceTimersByTimeAsync(60);
      await expect(hold.outcome).resolves.toBeUndefined();
      expect(seen).toEqual(["turn.started"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
