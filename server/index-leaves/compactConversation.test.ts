// #3679: the fold check reads the conversation and turns every message into
// context text at every turn. When it folds nothing it hands that read to the
// turn's context selection (server/turns/start-turn-setup.ts), which used to
// read and turn it again.
import { describe, expect, it } from "vitest";

import { createCompactConversation } from "./compactConversation.ts";

function hostFor(messages: Array<{ id: string; role: string; text: string }>) {
  let contextReads = 0;
  const host = {
    cfg: {},
    sagaxCompactionOn: () => true,
    store: {
      taskByThread: () => ({ threadId: "t1" }),
      activePath: () => messages,
      patchTask: () => { throw new Error("nothing is written when nothing folds"); },
    },
    directContext: (_bot: unknown, _threadId: string, read: typeof messages) => {
      contextReads++;
      return read.map((message) => ({ id: message.id, role: message.role === "user" ? "user" : "assistant", text: message.text, keep: false }));
    },
    latestCompaction: () => undefined,
    staleEngineSession: () => null,
  };
  return { host, reads: () => contextReads };
}

describe("compactConversation (#3679)", () => {
  it("returns the conversation it read when it folds nothing, read once", async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "bot" : "user", text: `message ${i}` }));
    const { host, reads } = hostFor(messages);
    const compact = createCompactConversation(() => host);
    const read = await compact({
      bot: { id: "b1" }, threadId: "t1", generation: "g1", model: "m",
      instance: { instanceId: "i1", driverKind: "codex", models: undefined },
      excludedIds: new Set<string>(), manual: false,
    });
    expect(reads()).toBe(1);
    expect(read?.messages).toBe(messages);
    expect(read?.context.map((entry: { id: string }) => entry.id)).toEqual(messages.map((message) => message.id));
  });

  it("returns nothing when compaction is off for the bot: the turn reads the conversation itself", async () => {
    const { host, reads } = hostFor([{ id: "m0", role: "user", text: "hello" }]);
    host.sagaxCompactionOn = () => false;
    const compact = createCompactConversation(() => host);
    const read = await compact({
      bot: { id: "b1" }, threadId: "t1", generation: "g1", model: "m",
      instance: { instanceId: "i1", driverKind: "codex", models: undefined },
      excludedIds: new Set<string>(), manual: false,
    });
    expect(read).toBeUndefined();
    expect(reads()).toBe(0);
  });
});
