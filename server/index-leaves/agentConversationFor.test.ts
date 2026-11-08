import { describe, expect, it } from "vitest";
import { createAgentConversationFor } from "./agentConversationFor.ts";
import { agentOpenerId, agentCallerLabel, isAgentConversation } from "../../shared/agent-conversation.ts";

// #2631: send_prompt without thread_id must open a fresh conversation every
// time, even when an earlier one of the same caller sits idle (a refused
// question, an interrupted turn, minutes of quiet) or still runs.
function host() {
  const tasks: any[] = [];
  let n = 0;
  return {
    tasks,
    host: {
      isAgentConversation,
      isPrincipalId: () => true,
      store: {
        tasks: () => tasks,
        createTask: (_bot: string, _a: unknown, _b: unknown, _c: unknown, openedBy: any, _d: unknown, owner: string) => {
          const task = { threadId: `t${++n}`, openedBy, ownerPrincipalId: owner, createdAt: n, updatedAt: n };
          tasks.push(task);
          return task;
        },
      },
    },
  };
}

describe("agentConversationFor (#2631)", () => {
  it("opens a new conversation on every fresh send, never the caller's earlier one", () => {
    const h = host();
    const conversationFor = createAgentConversationFor(() => h.host);
    const bot = { id: "b1" } as any;
    const first = conversationFor(bot, "p1", "Claude", true);
    // the earlier conversation is idle, its question refused, and newest
    h.tasks[0].updatedAt = 1_000;
    const ids = [first, conversationFor(bot, "p1", "Claude", true), conversationFor(bot, "p1", "Claude", true)];
    expect(new Set(ids).size).toBe(3);
    expect(h.tasks.every((task) => task.openedBy.botId === agentOpenerId(agentCallerLabel("Claude")))).toBe(true);
  });

  it("only a non-fresh lookup reuses the newest open conversation", () => {
    const h = host();
    const conversationFor = createAgentConversationFor(() => h.host);
    const bot = { id: "b1" } as any;
    const first = conversationFor(bot, "p1", "Claude", true);
    expect(conversationFor(bot, "p1", "Claude", false)).toBe(first);
  });
});
