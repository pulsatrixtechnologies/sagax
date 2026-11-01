import { describe, expect, it } from "vitest";

import {
  PROACTIVE_MODES,
  PROACTIVE_MODE_DEFAULT,
  isProactiveMode,
  normalizeProactiveMode,
  proactiveModeFor,
  proactiveGate,
  proactiveMayObserve,
  proactiveWriteCanExecuteUnprompted,
} from "./proactive-mode.ts";

describe("the proactive mode value", () => {
  it("lists only off and proactive, default on", () => {
    expect(PROACTIVE_MODES).toEqual(["off", "proactive"]);
    expect(PROACTIVE_MODE_DEFAULT).toBe("proactive");
  });

  it("recognizes only the known modes", () => {
    for (const mode of PROACTIVE_MODES) expect(isProactiveMode(mode)).toBe(true);
    for (const bad of ["chief", "auto", "propose", "read-auto", "follow-rules", "", null, undefined, 3]) {
      expect(isProactiveMode(bad)).toBe(false);
    }
  });

  it("maps legacy propose, read-auto and follow-rules to proactive; keeps off; fails closed on garbage", () => {
    expect(normalizeProactiveMode(undefined)).toBe("proactive");
    expect(normalizeProactiveMode(null)).toBe("proactive");
    expect(normalizeProactiveMode("off")).toBe("off");
    expect(normalizeProactiveMode("proactive")).toBe("proactive");
    expect(normalizeProactiveMode("propose")).toBe("proactive");
    expect(normalizeProactiveMode("read-auto")).toBe("proactive");
    expect(normalizeProactiveMode("follow-rules")).toBe("proactive");
    expect(normalizeProactiveMode("chief")).toBe("off");
    expect(normalizeProactiveMode(7)).toBe("off");
  });

  it("reads a bot that never chose a mode as proactive, keeps a chosen off, and maps legacy modes", () => {
    expect(proactiveModeFor({})).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: undefined })).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: null })).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: "off" })).toBe("off");
    expect(proactiveModeFor({ proactiveMode: "propose" })).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: "read-auto" })).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: "follow-rules" })).toBe("proactive");
    expect(proactiveModeFor({ proactiveMode: "chief" })).toBe("off");
    expect(proactiveModeFor({ proactiveMode: "proactive" })).toBe("proactive");
  });
});

describe("the proactive gate", () => {
  it("OFF does nothing: no observation, every action blocked", () => {
    expect(proactiveMayObserve("off")).toBe(false);
    expect(proactiveGate({ mode: "off", kind: "read" })).toBe("blocked");
    expect(proactiveGate({ mode: "off", kind: "write" })).toBe("blocked");
  });

  it("PROACTIVE runs reads itself and defers writes to the ordinary approval path", () => {
    expect(proactiveMayObserve("proactive")).toBe(true);
    expect(proactiveGate({ mode: "proactive", kind: "read" })).toBe("auto");
    expect(proactiveGate({ mode: "proactive", kind: "write" })).toBe("defer");
  });

  it("never returns auto for a write", () => {
    for (const mode of PROACTIVE_MODES) {
      expect(proactiveGate({ mode, kind: "write" })).not.toBe("auto");
    }
  });

  it("marks no disposition as an unprompted write from the proactive layer", () => {
    expect(proactiveWriteCanExecuteUnprompted("auto")).toBe(false);
    expect(proactiveWriteCanExecuteUnprompted("defer")).toBe(false);
    expect(proactiveWriteCanExecuteUnprompted("blocked")).toBe(false);
  });

  it("Full access does not change the gate: writes still defer to the ordinary path", () => {
    expect(proactiveGate({ mode: "proactive", kind: "write", approvalLevel: "full" })).toBe("defer");
    expect(proactiveGate({ mode: "off", kind: "write", approvalLevel: "full" })).toBe("blocked");
  });
});
