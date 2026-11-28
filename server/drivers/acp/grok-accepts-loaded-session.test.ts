import { describe, expect, it } from "vitest";
import { grokAcceptsLoadedSession } from "./grok.ts";

describe("grokAcceptsLoadedSession (#5554)", () => {
  it("refuses any loaded or live session whose model differs from the turn", () => {
    expect(grokAcceptsLoadedSession({
      turn: { model: "grok-4.6" },
      currentModelId: "grok-4.7",
    })).toBe(false);
    expect(grokAcceptsLoadedSession({
      turn: { model: "grok-4.6", withholdHostTools: true },
      currentModelId: "grok-4.7",
    })).toBe(false);
    expect(grokAcceptsLoadedSession({
      turn: { model: "grok-4.6", toolScope: { allow: [] } },
      currentModelId: "grok-4.7",
    })).toBe(false);
  });

  it("keeps a session that already runs the turn's model", () => {
    expect(grokAcceptsLoadedSession({
      turn: { model: "grok-4.6" },
      currentModelId: "grok-4.6",
    })).toBe(true);
  });

  it("keeps a session when the turn or the session has no model id yet", () => {
    expect(grokAcceptsLoadedSession({ turn: {}, currentModelId: "grok-4.7" })).toBe(true);
    expect(grokAcceptsLoadedSession({ turn: { model: "grok-4.6" } })).toBe(true);
  });
});
