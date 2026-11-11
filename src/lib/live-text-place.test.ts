import { describe, expect, it } from "vitest";

import { LINE_TEXT_MAX, lineWords, liveLineNote, liveTextPlace } from "./live-text-place";
import type { Message } from "@/state/store";

const note = (text: string, fields: Partial<Message> = {}): Message =>
  ({ id: "n", at: 2, role: "bot", kind: "text", text, turnId: "t", ...fields });

describe("liveTextPlace (#3696)", () => {
  it("keeps a short sentence in the working line, from its first word", () => {
    for (const text of ["Y", "Yes", "Yes, I will check the request.", "x".repeat(LINE_TEXT_MAX)]) {
      expect(liveTextPlace(text)).toBe("line");
    }
  });

  it("opens a bubble for text past the line: longer, a line break, a Markdown block or a link", () => {
    for (const text of [
      "x".repeat(LINE_TEXT_MAX + 1), "Two lines.\nSecond.", "- item", "1. first", "# Title", "> quote",
      "| a | b |", "```ts", "See [the page](x)", "See https://example.com",
    ]) expect(liveTextPlace(text)).toBe("bubble");
  });

  it("never goes back to the line once a growing text opened its bubble", () => {
    const answer = "Ticket 1042 failed three times since Monday.\n\n- Merge it into 1040\n- Order the part";
    let opened = false;
    for (let end = 1; end <= answer.length; end += 1) {
      const place = liveTextPlace(answer.slice(0, end));
      if (opened) expect(place).toBe("bubble");
      if (place === "bubble") opened = true;
    }
    expect(opened).toBe(true);
  });

  it("draws the words without their inline marks", () => {
    expect(lineWords("  Checking **ticket** `1042` ")).toBe("Checking ticket 1042");
  });
});

describe("liveLineNote (#3696)", () => {
  const live = new Set(["t"]);
  it("is the newest short note of a live turn", () => {
    const row = note("Yes, I will check the request.");
    expect(liveLineNote(row, live)).toBe(row);
  });

  it("is none for a final message, a long text, a turn that ended, a person's message or a step", () => {
    expect(liveLineNote(note("Done.", { turnTerminal: true }), live)).toBeUndefined();
    expect(liveLineNote(note("x".repeat(LINE_TEXT_MAX + 1)), live)).toBeUndefined();
    expect(liveLineNote(note("Done."), new Set())).toBeUndefined();
    expect(liveLineNote(note("Hi", { role: "user" }), live)).toBeUndefined();
    expect(liveLineNote(note("Use the main branch.", { teamNote: {} } as unknown as Partial<Message>), live)).toBeUndefined();
    expect(liveLineNote(note("", { kind: "activity", tool: { name: "Read" } }), live)).toBeUndefined();
  });
});
