import { describe, expect, it } from "vitest";
import { effortForTurn } from "./turn-effort.ts";

const grok = ["low", "medium", "high", "xhigh"] as const;
const claude = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;

describe("effort for one turn", () => {
  it("runs a call and a background one-shot at low, and keeps a lower bot setting", () => {
    expect(effortForTurn({ kind: "call", driverKind: "grok", levels: grok, effort: "high" })).toBe("low");
    expect(effortForTurn({ kind: "background", driverKind: "grok", levels: grok })).toBe("low");
    expect(effortForTurn({ kind: "call", driverKind: "claudeAgent", levels: claude, effort: "none" })).toBe("none");
    // Codex keeps an omitted effort from the previous turn of its thread.
    expect(effortForTurn({ kind: "background", driverKind: "codex", levels: ["low", "medium", "high"] })).toBeUndefined();
    expect(effortForTurn({ kind: "background", driverKind: "codex", levels: ["low", "medium", "high"], effort: "high" })).toBe("low");
  });

  it("keeps a saved chat, warm or routine effort, and maps ultracode off Claude", () => {
    expect(effortForTurn({ kind: "chat", driverKind: "claudeAgent", levels: claude, effort: "xhigh" })).toBe("xhigh");
    expect(effortForTurn({ kind: "warm", driverKind: "claudeAgent", levels: claude, effort: "medium" })).toBe("medium");
    expect(effortForTurn({ kind: "routine", driverKind: "grok", levels: grok, effort: "high", routineEffort: "low" })).toBe("low");
    expect(effortForTurn({ kind: "chat", driverKind: "codex", levels: ["low", "medium", "high", "max"], effort: "ultracode" })).toBe("max");
  });

  it("sends high on a Grok HTTP chat that saved no effort, and leaves other engines unset", () => {
    expect(effortForTurn({ kind: "chat", driverKind: "grok", levels: grok })).toBe("high");
    expect(effortForTurn({ kind: "warm", driverKind: "grok", levels: grok })).toBe("high");
    expect(effortForTurn({ kind: "routine", driverKind: "grok", levels: grok })).toBe("high");
    expect(effortForTurn({ kind: "chat", driverKind: "claudeAgent", levels: claude })).toBeUndefined();
    expect(effortForTurn({ kind: "chat", driverKind: "grok" })).toBeUndefined();
  });
});
