// #5425: when a Heavy turn ends, the hidden plan and expert threads' warm
// engines must close (same path as releaseBootEngineSlot: forget the idle
// session, then releaseWarmSession). They are never reused; at 8 experts
// that is up to 9 CLI processes left warm for ~10 minutes otherwise.
import { afterEach, describe, expect, it, vi } from "vitest";

import { heavyAgentThreads } from "../heavy-team.ts";
import { createRunHeavyTeam } from "./runHeavyTeam.ts";

class DirectTurnSetupCancelled extends Error {}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  // module-level set: leave no leftover from a run that skipped finally
  for (const threadId of ["plan", "expert-1", "expert-2", "t-main"]) {
    heavyAgentThreads.delete(threadId);
  }
});

function heavyHost() {
  let nextThread = 0;
  const forgotten: string[] = [];
  const released: string[] = [];
  const cold: string[] = [];
  const bootReleased: Array<{ threadId: string; closeIdle: boolean }> = [];

  const host = {
    DirectTurnSetupCancelled,
    registry: { get: () => ({ adapter: { capabilities: {} } }) },
    store: {
      bot: () => ({ id: "bot-1", name: "Marc" }),
      isConfidentialThread: () => false,
      isHeavyExpert: () => false,
      createTask: (_botId: string, title: string) => {
        const threadId = title.startsWith("Heavy plan") ? "plan" : `expert-${++nextThread}`;
        return { threadId };
      },
      confineHeavyExpert: () => true,
      appendMessage: () => ({ id: "row-1" }),
      patchMessage: vi.fn(),
      messagesFor: () => [],
      taskByThread: () => undefined,
    },
    isRelayPart: () => false,
    openedThreadOwner: () => "ada",
    openerFrom: () => "ada",
    noteRelayParent: vi.fn(),
    threadStarters: new Map(),
    directTurnClaimIsCurrent: () => true,
    interruptDirectThread: vi.fn(async () => undefined),
    bus: { subscribe: () => () => {} },
    autoPayerKey: () => "ada",
    rememberAutoRefusal: vi.fn(),
    askBotAndWait: vi.fn(async (_botId: string, _prompt: string, _a: number, _b: string, _parent: string, threadId: string) => {
      if (threadId === "plan") {
        return {
          status: "reply",
          text: JSON.stringify({
            experts: [
              { persona: "Skeptic", focus: "risks" },
              { persona: "Pragmatist", focus: "steps" },
            ],
          }),
        };
      }
      // timeout: leaves the team without seat hopping (askOnSeats)
      return { status: "timeout", text: "no answer in time" };
    }),
    releaseBootEngineSlot: vi.fn((threadId: string, closeIdleProcess: boolean) => {
      bootReleased.push({ threadId, closeIdle: closeIdleProcess });
    }),
    idleEngines: {
      forget: vi.fn((threadId: string) => { forgotten.push(threadId); }),
    },
    releaseThreadEngines: vi.fn((threadId: string) => { released.push(threadId); }),
    perspicaxMcp: {
      noteEngineCold: vi.fn((threadId: string) => { cold.push(threadId); }),
    },
  };

  return { host, forgotten, released, cold, bootReleased };
}

describe("runHeavyTeam closes hidden engines when the turn ends (#5425)", () => {
  it("forgets idle sessions and releases warm adapters for the plan and every expert thread", async () => {
    const { host, forgotten, released, cold, bootReleased } = heavyHost();
    const run = createRunHeavyTeam(() => host);

    await run({
      threadId: "t-main",
      botId: "bot-1",
      dispatchClaimId: "claim-1",
      text: "Plan the migration",
      userMessage: { id: "m1", text: "Plan the migration" },
      speaker: "ada",
      autoTurn: {
        pick: {
          mode: "heavy",
          engineLabel: "Claude",
          modelLabel: "Opus",
          selection: { instanceId: "acct-1", model: "opus" },
          team: [
            { instanceId: "acct-1", model: "opus", engineLabel: "Claude", modelLabel: "Opus" },
            { instanceId: "acct-2", model: "gpt", engineLabel: "Codex", modelLabel: "GPT" },
          ],
        },
      },
    });

    await flushImmediate();

    const hidden = ["plan", "expert-1", "expert-2"];
    for (const threadId of hidden) {
      expect(heavyAgentThreads.has(threadId), threadId).toBe(false);
      expect(bootReleased).toContainEqual({ threadId, closeIdle: true });
      expect(forgotten).toContain(threadId);
      expect(released).toContain(threadId);
      expect(cold).toContain(threadId);
    }
    expect(forgotten).toHaveLength(3);
    expect(released).toHaveLength(3);
  });

  });
