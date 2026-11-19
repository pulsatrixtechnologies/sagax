// A voice call turn's reasoning effort (server/voice/voice-call-effort.ts).
import { describe, expect, it } from "vitest";

import { callTurnEffort } from "./voice-call-effort.ts";

describe("callTurnEffort", () => {
  it("lowers a call turn to the engine's low effort", () => {
    expect(callTurnEffort({ driverKind: "grokAgent", levels: ["low", "medium", "high"] })).toBe("low");
    expect(callTurnEffort({ driverKind: "grokAgent", levels: ["low", "medium", "high"], effort: "high" })).toBe("low");
    expect(callTurnEffort({ driverKind: "claudeAgent", levels: ["low", "medium", "high", "xhigh", "max"], effort: "max" })).toBe("low");
    expect(callTurnEffort({ driverKind: "codex", levels: ["low", "medium", "high", "xhigh", "max"], effort: "medium" })).toBe("low");
  });

  it("never turns reasoning off, and keeps a bot already set lower", () => {
    expect(callTurnEffort({ driverKind: "pi", levels: ["none", "low", "medium", "high"] })).toBe("low");
    expect(callTurnEffort({ driverKind: "pi", levels: ["none", "low", "medium"], effort: "none" })).toBe("none");
    expect(callTurnEffort({ driverKind: "other", levels: ["medium", "high"] })).toBe("medium");
  });

  it("leaves engines without an effort control, and a Codex bot with no effort, as they are", () => {
    expect(callTurnEffort({ driverKind: "openaiChat" })).toBeUndefined();
    expect(callTurnEffort({ driverKind: "openaiChat", effort: "high" })).toBe("high");
    expect(callTurnEffort({ driverKind: "codex", levels: ["low", "medium", "high"] })).toBeUndefined();
  });
});
