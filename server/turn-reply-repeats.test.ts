import { describe, expect, it } from "vitest";

import { TurnReplyRepeats } from "./turn-reply-repeats.ts";

describe("TurnReplyRepeats", () => {
  it("flags text one turn already wrote, whitespace aside, and nothing else", () => {
    const repeats = new TurnReplyRepeats();
    expect(repeats.repeated("t", "turn-1", "Let me check the ticket.")).toBe(false);
    expect(repeats.repeated("t", "turn-1", "  Let me check\nthe ticket. ")).toBe(true);
    expect(repeats.repeated("t", "turn-1", "Ticket 4242 is closed.")).toBe(false);
    // another thread, another turn
    expect(repeats.repeated("u", "turn-1", "Let me check the ticket.")).toBe(false);
  });

  it("starts clean on the next turn and after a settle", () => {
    const repeats = new TurnReplyRepeats();
    repeats.repeated("t", "turn-1", "Done.");
    expect(repeats.repeated("t", "turn-2", "Done.")).toBe(false);
    repeats.settle("t", "turn-2");
    expect(repeats.repeated("t", "turn-2", "Done.")).toBe(false);
  });

  it("a settle of an older turn leaves the running one alone", () => {
    const repeats = new TurnReplyRepeats();
    repeats.repeated("t", "turn-2", "Working on it.");
    repeats.settle("t", "turn-1");
    expect(repeats.repeated("t", "turn-2", "Working on it.")).toBe(true);
  });

  it("never compares without a turn id or with blank text", () => {
    const repeats = new TurnReplyRepeats();
    expect(repeats.repeated("t", undefined, "Same")).toBe(false);
    expect(repeats.repeated("t", undefined, "Same")).toBe(false);
    expect(repeats.repeated("t", "turn-1", "   ")).toBe(false);
    expect(repeats.repeated("t", "turn-1", "   ")).toBe(false);
  });
});
