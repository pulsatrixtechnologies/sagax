import { describe, expect, it } from "vitest";
import {
  ULTRACODE_EFFORT,
  effortAcceptedByEngine,
  effortForEngine,
  isUltracodeEffort,
  maxNativeEffort,
  pickerEffortLevels,
  resolveEngineTurnEffort,
} from "./ultracode-effort.ts";

describe("ultracode effort", () => {
  const codex = ["low", "medium", "high", "xhigh", "max"] as const;
  const claude = [...codex, ULTRACODE_EFFORT] as const;

  it("offers ultracode only on an engine that lists it (Claude Code)", () => {
    expect(pickerEffortLevels(claude)).toEqual([...codex, ULTRACODE_EFFORT]);
    expect(pickerEffortLevels(codex)).toEqual([...codex]);
    expect(pickerEffortLevels([ULTRACODE_EFFORT])).toEqual([]);
    expect(pickerEffortLevels([])).toEqual([]);
  });

  it("accepts ultracode only where the engine offers it", () => {
    expect(effortAcceptedByEngine(ULTRACODE_EFFORT, claude)).toBe(true);
    expect(effortAcceptedByEngine(ULTRACODE_EFFORT, codex)).toBe(false);
    expect(effortAcceptedByEngine(ULTRACODE_EFFORT, [])).toBe(false);
    expect(effortAcceptedByEngine("high", codex)).toBe(true);
  });

  it("runs a stored ultracode at the top native level on other engines", () => {
    expect(effortForEngine(ULTRACODE_EFFORT, codex)).toBe("max");
    expect(effortForEngine(ULTRACODE_EFFORT, ["low", "high"])).toBe("high");
    expect(effortForEngine(ULTRACODE_EFFORT, claude)).toBe(ULTRACODE_EFFORT);
    expect(effortForEngine("medium", codex)).toBe("medium");
    expect(effortForEngine(undefined, codex)).toBeUndefined();
  });

  it("maps ultracode to the CLI on Claude and to max elsewhere", () => {
    expect(resolveEngineTurnEffort(ULTRACODE_EFFORT, "claudeAgent", codex)).toBe(ULTRACODE_EFFORT);
    expect(resolveEngineTurnEffort(ULTRACODE_EFFORT, "codex", codex)).toBe("max");
    expect(resolveEngineTurnEffort("high", "codex", codex)).toBe("high");
    expect(isUltracodeEffort(ULTRACODE_EFFORT)).toBe(true);
    expect(maxNativeEffort(["low", "high", "xhigh"])).toBe("xhigh");
  });
});
