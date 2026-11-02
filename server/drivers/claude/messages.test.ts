import { describe, expect, it } from "vitest";
import {
  COMPACTED_VOLATILE,
  UNDELIVERED_VOLATILE,
  claudeUserMessage,
  diagnosticClaudeUserMessage,
  volatileTurnMessage,
  withReminder,
  withVolatileNote,
} from "./messages.ts";

describe("withReminder", () => {
  it("wraps a system-reminder and keeps empty user text as the note alone", () => {
    expect(withReminder("hello", "note")).toBe("<system-reminder>\nnote\n</system-reminder>\n\nhello");
    expect(withReminder("", "note")).toBe("<system-reminder>\nnote\n</system-reminder>");
  });
});

describe("withVolatileNote", () => {
  it("describes a cleared half, a launch delivery, and a mid-session change", () => {
    expect(withVolatileNote("hi", "")).toContain("have been cleared");
    expect(withVolatileNote("hi", "mem", true)).toContain("arrives here instead of in the system prompt");
    expect(withVolatileNote("hi", "mem", false)).toContain("changed since this session started");
  });
});

describe("volatileTurnMessage", () => {
  it("passes harness commands and unchanged halves through as bare user text", () => {
    expect(volatileTurnMessage({ text: "/compact", harnessCommand: { name: "compact", args: "" } }, "held", undefined)).toEqual(
      claudeUserMessage("/compact", undefined),
    );
    expect(volatileTurnMessage({ text: "hi", systemVolatile: "same" }, "same", undefined)).toEqual(
      claudeUserMessage("hi", undefined),
    );
    expect(volatileTurnMessage({ text: "hi" }, "", undefined)).toEqual(claudeUserMessage("hi", undefined));
    // held markers force a full note when there is new volatile text
    const launch = volatileTurnMessage({ text: "hi", systemVolatile: "mem" }, UNDELIVERED_VOLATILE, undefined);
    expect(JSON.stringify(launch)).toContain("arrives here instead of in the system prompt");
    const compacted = volatileTurnMessage({ text: "hi", systemVolatile: "mem" }, COMPACTED_VOLATILE, undefined);
    expect(JSON.stringify(compacted)).toContain("changed since this session started");
  });
});

describe("diagnosticClaudeUserMessage", () => {
  it("redacts base64 image bytes while keeping shape and length", () => {
    const msg = {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "abcd" } },
          { type: "text" as const, text: "see" },
        ],
      },
    };
    const out = diagnosticClaudeUserMessage(msg);
    expect(out.message.content[0]).toMatchObject({
      type: "image",
      source: { data: "[image data: 4 base64 chars]" },
    });
    expect(out.message.content[1]).toEqual({ type: "text", text: "see" });
  });
});
