import { describe, expect, it } from "vitest";

import { markDeadThreadChip } from "./dead-thread-chips.ts";

const alive = (id: string) => id === "alive";

describe("markDeadThreadChip", () => {
  it("marks an opened-thread chip whose thread is gone, on a copy", () => {
    const message = { id: "m", threadRef: { botId: "b", threadId: "dead", title: "T" } };
    const marked = markDeadThreadChip(message, alive);
    expect(marked.threadRef).toEqual({ botId: "b", threadId: "dead", title: "T", gone: true });
    expect(message.threadRef).not.toHaveProperty("gone");
  });

  it("leaves a live chip untouched (same object)", () => {
    const message = { id: "m", threadRef: { botId: "b", threadId: "alive", title: "T" } };
    expect(markDeadThreadChip(message, alive)).toBe(message);
  });

  it("clears a stale mark when the thread exists", () => {
    const message = { id: "m", threadRef: { botId: "b", threadId: "alive", title: "T", gone: true } };
    expect(markDeadThreadChip(message, alive).threadRef).toEqual({ botId: "b", threadId: "alive", title: "T" });
  });

  it("marks a Messaged chip by its channel thread, and skips one without a thread", () => {
    const comm = { groupId: "g", threadId: "dead", withBotId: "x", withName: "X", withColor: "blue" };
    expect(markDeadThreadChip({ comm }, alive).comm).toEqual({ ...comm, gone: true });
    const bare = { comm: { ...comm, threadId: undefined } };
    expect(markDeadThreadChip(bare, alive)).toBe(bare);
  });

  it("ignores messages that carry no chip", () => {
    const message = { id: "m", text: "hi" };
    expect(markDeadThreadChip(message, alive)).toBe(message);
  });
});
