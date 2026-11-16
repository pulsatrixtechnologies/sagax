// #4407: a conversation busy when a thread it carried was made confidential
// kept its process to the end of that turn. Its next turn must not reuse or
// resume that session: setup forgets it again before anything reads it.
import { describe, expect, it, vi } from "vitest";
import { createSetupStartTurn } from "./start-turn-setup.ts";

class Stop extends Error {}

function run(task: { threadId: string; forgetSessionsAtNextTurn?: true }) {
  const order: string[] = [];
  const forgetThreadEngineSessions = vi.fn(() => { order.push("forget"); });
  const host = {
    forgetThreadEngineSessions,
    store: { taskByThread: (_botId: string, threadId: string) => (threadId === task.threadId ? task : undefined) },
    turnTrace: () => undefined,
    // the first step after the check: stop the turn here
    connectorPlanForTurn: () => { order.push("connectors"); throw new Stop(); },
  };
  const setup = createSetupStartTurn(host as never);
  const state = { bot: { id: "bot-1" }, threadId: task.threadId, warmOnly: false, instance: { adapter: {} }, opts: {} };
  return { order, forgetThreadEngineSessions, done: setup(state as never).then(() => "returned", (error) => (error instanceof Stop ? "stopped" : error)) };
}

describe("turn setup after a thread it carried turned confidential (#4407)", () => {
  it("forgets the carrier's sessions before anything reads them", async () => {
    const { order, forgetThreadEngineSessions, done } = run({ threadId: "parallel", forgetSessionsAtNextTurn: true });
    expect(await done).toBe("stopped");
    expect(forgetThreadEngineSessions).toHaveBeenCalledWith("bot-1", "parallel", "carried a thread made confidential");
    expect(order).toEqual(["forget", "connectors"]);
  });

  it("leaves an unmarked thread's session alone", async () => {
    const { forgetThreadEngineSessions, done } = run({ threadId: "plain" });
    expect(await done).toBe("stopped");
    expect(forgetThreadEngineSessions).not.toHaveBeenCalled();
  });
});
