import { describe, expect, it } from "vitest";
import { isPersonOwnLine } from "./start-turn-prepare-admit.ts";

// 0.8.46: only the person's own line answers a question parked on them.
describe("the person's own line (answers a parked question)", () => {
  const acts = new Set(["act-0123456789abcdef"]);
  const isAct = (sendId: string | undefined) => Boolean(sendId && acts.has(sendId));
  const line = (opts: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ opts, userMessage: {}, ...extra });
  it("is the person typing, with or without a send id", () => {
    expect(isPersonOwnLine(line({ sendId: "8834e98e-495c-4828-9e64-e31b26c0442e" }), isAct)).toBe(true);
    expect(isPersonOwnLine(line(), isAct)).toBe(true);
  });
  it("is never a line a bot's act wrote as the person", () => {
    expect(isPersonOwnLine(line({ sendId: "act-0123456789abcdef" }), isAct)).toBe(false);
  });
  it.each([{ coordination: true }, { cardContinuation: true }, { automationSource: "routine" }, { peerAsk: { name: "Peer" } }, { editedMessageId: "m1" }])("is never automation or a peer: %j", (opts) => {
    expect(isPersonOwnLine(line(opts), isAct)).toBe(false);
  });
  it("is never a warm-up or a deeper hop", () => {
    expect(isPersonOwnLine(line({}, { warmOnly: true }), isAct)).toBe(false);
    expect(isPersonOwnLine(line({}, { commsDepth: 1 }), isAct)).toBe(false);
  });
});
