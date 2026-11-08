// #2915: where a background thread's words and cards land, and under which
// label (pulled out of server/index.ts so the mapping is tested).
import { describe, expect, it, vi } from "vitest";

import { backgroundCardHome, backgroundCardPeople, backgroundRelayAllowed, mcpThreadAnswerer, relayViaOf, type BackgroundRelayDeps, type RelayBot, type RelayTask } from "./background-relay.ts";

const BOT: RelayBot = { id: "bot" };

function deps(tasks: Record<string, RelayTask>, more: Partial<BackgroundRelayDeps<RelayBot>> = {}): BackgroundRelayDeps<RelayBot> {
  return {
    inRoom: (threadId) => threadId === "room",
    task: (_botId, threadId) => tasks[threadId],
    run: (threadId) => threadId === "wake" ? { proactive: true } : threadId === "hook" ? { webhookId: "w" } : null,
    privateThreads: () => false,
    confidentialByDefault: () => false,
    threadPerson: () => undefined,
    answerer: () => "owner",
    readable: () => true,
    conversationFor: () => undefined,
    conversationOrStart: () => "main",
    ...more,
  };
}

const TASKS: Record<string, RelayTask> = {
  mcp: { hidden: true },
  agent: { openedBy: { botId: "x", name: "Claude Code", kind: "agent", at: 1 }, askedAt: 2 },
  handoff: { openedBy: { botId: "nova", name: "Nova", kind: "work", at: 1 } },
  opened: { openedBy: { botId: "nova", name: "Nova", at: 1 } },
  wrote: { openedBy: { botId: "nova", name: "Nova", kind: "work", at: 1 }, askedAt: 3 },
  run: { routineRunId: "r1" },
  wake: { routineRunId: "r2" },
  hook: { routineResults: true },
  secret: { hidden: true, confidential: true },
  parallel: { hidden: true, parallelOf: { threadId: "main" } as never },
  room: { hidden: true },
  own: {},
};

describe("relayViaOf (#2915)", () => {
  it.each([
    ["mcp", "mcp"], ["agent", "mcp"], ["handoff", "teammate"], ["opened", "teammate"],
    ["run", "routine"], ["wake", "proactive"], ["hook", "proactive"],
  ])("labels %s as %s", (threadId, via) => {
    expect(relayViaOf(deps(TASKS), "bot", threadId)).toBe(via);
  });

  it.each(["secret", "parallel", "room", "own", "wrote", "missing"])("leaves %s alone", (threadId) => {
    expect(relayViaOf(deps(TASKS), "bot", threadId)).toBeUndefined();
  });

  it("keeps the label of an archived thread an AI client continues", () => {
    expect(relayViaOf(deps({ mcp: { hidden: true, archivedAt: 5 } as RelayTask }), "bot", "mcp")).toBe("mcp");
  });
});

describe("backgroundCardPeople (#2915)", () => {
  it("names the card's person, then the thread's, then who answers, once each", () => {
    const d = deps(TASKS, { privateThreads: () => true, threadPerson: () => "Member@x", answerer: () => "owner" });
    expect(backgroundCardPeople(d, BOT, "mcp", { destinationAnswerer: "member@x" })).toEqual(["member@x", "owner"]);
    expect(backgroundCardPeople(deps(TASKS), BOT, "mcp", undefined)).toEqual([]);
  });
});

describe("backgroundCardHome (#2915)", () => {
  it("puts a member's MCP card in that member's chat, not the owner's", () => {
    const d = deps(TASKS, {
      privateThreads: () => true,
      threadPerson: () => "member",
      conversationFor: (_bot, person) => `chat-${person}`,
    });
    expect(backgroundCardHome(d, BOT, "mcp", undefined)).toBe("chat-member");
  });

  it("starts nothing before someone may read the source", () => {
    const start = vi.fn(() => "new");
    const d = deps(TASKS, { privateThreads: () => true, readable: () => false, conversationOrStart: start });
    expect(backgroundCardHome(d, BOT, "mcp", undefined)).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
    expect(backgroundCardHome(deps(TASKS, { conversationOrStart: start }), BOT, "own", undefined)).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts no conversation that would be confidential", () => {
    const start = vi.fn(() => "new");
    const d = deps(TASKS, { privateThreads: () => true, threadPerson: () => "member", confidentialByDefault: () => true, conversationOrStart: start });
    expect(backgroundCardHome(d, BOT, "mcp", undefined)).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
    const open = deps(TASKS, { privateThreads: () => true, threadPerson: () => "member", conversationOrStart: start });
    expect(backgroundCardHome(open, BOT, "mcp", undefined)).toBe("new");
  });

  it("never sends a card home to its own thread or from a hidden bot", () => {
    expect(backgroundCardHome(deps(TASKS, { conversationOrStart: () => "mcp" }), BOT, "mcp", undefined)).toBeUndefined();
    expect(backgroundCardHome(deps(TASKS), { id: "bot", hidden: true }, "mcp", undefined)).toBeUndefined();
    expect(backgroundCardHome(deps(TASKS), BOT, "mcp", undefined)).toBe("main");
  });
});

describe("mcpThreadAnswerer (#2915: the member answers their own MCP card)", () => {
  const tasks: Record<string, RelayTask> = { ...TASKS, mine: { hidden: true, ownerPrincipalId: "Alice@x" }, theirs: { openedBy: { botId: "nova", name: "Nova", kind: "work", at: 1 }, ownerPrincipalId: "alice@x" } };
  it("is the member for their own MCP conversation, under private threads only", () => {
    expect(mcpThreadAnswerer(deps(tasks, { privateThreads: () => true }), "bot", "mine")).toBe("alice@x");
    expect(mcpThreadAnswerer(deps(tasks), "bot", "mine")).toBeUndefined();
  });
  it("leaves every other thread to the bot owner", () => {
    const d = deps(tasks, { privateThreads: () => true });
    expect(mcpThreadAnswerer(d, "bot", "theirs")).toBeUndefined();
    expect(mcpThreadAnswerer(d, "bot", "mcp")).toBeUndefined();
    expect(mcpThreadAnswerer(d, "bot", undefined)).toBeUndefined();
  });
});

describe("backgroundRelayAllowed (#2915: mayRelay)", () => {
  const priv = (more: Partial<BackgroundRelayDeps<RelayBot>> = {}) => deps(TASKS, { privateThreads: () => true, threadPerson: () => "member", answerer: () => "owner", ...more });
  it("lets the thread's own person relay a member's MCP card to their own chat", () => {
    const check = { readsSource: (p: string) => p === "member", ownsDestination: (p: string) => p === "member" };
    expect(backgroundRelayAllowed(priv(), BOT, "mcp", undefined, check)).toBe(true);
  });
  it("never pairs one person reading the source with another owning the destination", () => {
    const check = { readsSource: (p: string) => p === "member", ownsDestination: (p: string) => p === "owner" };
    expect(backgroundRelayAllowed(priv(), BOT, "mcp", undefined, check)).toBe(false);
  });
  it("tries who answers first and looks no further when they may", () => {
    const threadPerson = vi.fn(() => "member");
    const check = { readsSource: () => true, ownsDestination: (p: string) => p === "owner" };
    expect(backgroundRelayAllowed(priv({ threadPerson }), BOT, "mcp", undefined, check)).toBe(true);
    expect(threadPerson).not.toHaveBeenCalled();
  });
  it("keeps a room's or a person's own thread with who answers", () => {
    const check = { readsSource: (p: string) => p === "member", ownsDestination: (p: string) => p === "member" };
    expect(backgroundRelayAllowed(priv(), BOT, "room", undefined, check)).toBe(false);
    expect(backgroundRelayAllowed(priv(), BOT, "own", undefined, check)).toBe(false);
  });
});
