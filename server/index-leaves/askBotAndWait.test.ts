import { afterEach, describe, expect, it, vi } from "vitest";

import { createLimitTakeovers } from "../usage/limit-takeovers.ts";
import { createAskBotAndWait } from "./askBotAndWait.ts";

// #4878: a routine's verification step, run as a part on an engine inside
// its 5-hour usage window, hard-stopped: the waiter took the refused turn
// for the part's failure while the usage-limit failover was already
// carrying the same part to the next engine of the chain in that thread.
function host(grace = 1_000) {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const takeovers = createLimitTakeovers();
  const started: string[] = [];
  const h = {
    bus: { subscribe: (fn: (event: Record<string, unknown>) => void) => { listeners.add(fn); return () => listeners.delete(fn); } },
    store: { bot: (id: string) => ({ id, name: "Marc" }) },
    peerThreadFor: () => "t-part",
    awaitedAsks: new Set(),
    isUnattended: () => true,
    peerSpeaker: () => ({ origin: "person" }),
    shouldIgnoreProviderEvent: () => false,
    stoppedTurnText: (_threadId: string, _turnId: string, _cause: unknown, stopReason?: string) => `The turn did not complete (${stopReason}): You've hit your limit · resets 3pm`,
    startTurn: async (_botId: string, message: string) => { started.push(message); },
    ASK_BOT_TIMEOUT_MS: 60_000,
    LIMIT_TAKEOVER_GRACE_MS: grace,
    limitTakeovers: takeovers,
  };
  // the main runtime subscriber reads the failure first (turnFailed), as on the server
  const emit = (event: Record<string, unknown>, takenOver = false) => {
    if (takenOver) takeovers.note("t-part", event.turnId as string);
    for (const listener of listeners) listener({ threadId: "t-part", ...event });
  };
  const ask = createAskBotAndWait(() => h);
  return { ask: () => ask("bot-1", "verify the plan", 0, "bot-1", "t-run", "t-part", { timeoutMs: 60_000, selfRelay: true }) as Promise<{ status: string; text: string }>, emit, started };
}

afterEach(() => { vi.useRealTimers(); });

describe("askBotAndWait and the usage-limit failover (#4878)", () => {
  it("waits for the next engine the failover carried the work to, and returns its result", async () => {
    const h = host();
    const outcome = h.ask();
    await Promise.resolve();
    h.emit({ type: "turn.completed", turnId: "turn-1", ok: false, stopReason: "quota" }, true);
    h.emit({ type: "turn.started", turnId: "turn-2" });
    h.emit({ type: "item.completed", itemType: "assistant_text", turnId: "turn-2", text: "Plan verified: 3 agreements." });
    h.emit({ type: "turn.completed", turnId: "turn-2", ok: true });
    await expect(outcome).resolves.toEqual({ status: "reply", text: "Plan verified: 3 agreements." });
    expect(h.started).toHaveLength(1);
  });

  it("ends with the refusal when no engine took the work on within the grace", async () => {
    vi.useFakeTimers();
    const h = host(1_000);
    const outcome = h.ask();
    await Promise.resolve();
    h.emit({ type: "turn.completed", turnId: "turn-1", ok: false, stopReason: "quota" }, true);
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(outcome).resolves.toEqual({ status: "failed", text: "The turn did not complete (quota): You've hit your limit · resets 3pm" });
  });

  it("a failure the failover did not take is the outcome at once", async () => {
    const h = host();
    const outcome = h.ask();
    await Promise.resolve();
    h.emit({ type: "turn.completed", turnId: "turn-1", ok: false, stopReason: "error" });
    await expect(outcome).resolves.toMatchObject({ status: "failed" });
  });
});
