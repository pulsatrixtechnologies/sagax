import { describe, expect, it } from "vitest";

import {
  PROACTIVE_MODES,
  PROACTIVE_MODE_DEFAULT,
  isProactiveMode,
  proactiveModeFor,
  proactiveGate,
  proactiveMayObserve,
  proactiveWriteCanExecuteUnprompted,
  type ProactiveMode,
} from "./proactive-mode.ts";

describe("the proactive mode value", () => {
  it("lists off, propose, read-auto and follow-rules in that order", () => {
    expect(PROACTIVE_MODES).toEqual(["off", "propose", "read-auto", "follow-rules"]);
    expect(PROACTIVE_MODE_DEFAULT).toBe("off");
  });

  it("recognizes only the known modes", () => {
    for (const mode of PROACTIVE_MODES) expect(isProactiveMode(mode)).toBe(true);
    for (const bad of ["chief", "auto", "", null, undefined, 3, "FOLLOW-RULES"]) expect(isProactiveMode(bad)).toBe(false);
  });

  it("defaults to off and fails closed to off on an unknown stored value", () => {
    expect(proactiveModeFor({})).toBe("off");
    expect(proactiveModeFor({ proactiveMode: undefined })).toBe("off");
    expect(proactiveModeFor({ proactiveMode: "chief" })).toBe("off");
    expect(proactiveModeFor({ proactiveMode: 7 })).toBe("off");
    for (const mode of PROACTIVE_MODES) expect(proactiveModeFor({ proactiveMode: mode })).toBe(mode);
  });
});

describe("the proactive gate, per mode", () => {
  it("OFF does nothing: no observation, every action blocked", () => {
    expect(proactiveMayObserve("off")).toBe(false);
    expect(proactiveGate({ mode: "off", kind: "read" })).toBe("blocked");
    expect(proactiveGate({ mode: "off", kind: "write" })).toBe("blocked");
  });

  it("PROPOSE observes read-only, proposes every action, and executes nothing", () => {
    expect(proactiveMayObserve("propose")).toBe(true);
    // Even a read-only follow-up is proposed, not run: it executes nothing without a yes.
    expect(proactiveGate({ mode: "propose", kind: "read" })).toBe("propose");
    expect(proactiveGate({ mode: "propose", kind: "write" })).toBe("propose");
  });

  it("READ-AUTO runs read-only work itself and cards every write/outbound", () => {
    expect(proactiveMayObserve("read-auto")).toBe(true);
    expect(proactiveGate({ mode: "read-auto", kind: "read" })).toBe("auto");
    expect(proactiveGate({ mode: "read-auto", kind: "write" })).toBe("card");
  });

  it("FOLLOW-RULES runs read-only work itself and defers writes to the bot's normal approval path", () => {
    expect(proactiveMayObserve("follow-rules")).toBe(true);
    expect(proactiveGate({ mode: "follow-rules", kind: "read" })).toBe("auto");
    expect(proactiveGate({ mode: "follow-rules", kind: "write" })).toBe("defer");
  });
});

describe("the safety invariant: no write executes unprompted from the proactive layer", () => {
  it("never returns auto for a write in any mode", () => {
    for (const mode of PROACTIVE_MODES) {
      const disposition = proactiveGate({ mode, kind: "write" });
      expect(disposition).not.toBe("auto");
    }
  });

  it("marks only auto as an execute-without-a-card disposition, never for a write", () => {
    // A read in an auto-capable mode may run; a write never may.
    expect(proactiveWriteCanExecuteUnprompted("auto")).toBe(false);
    expect(proactiveWriteCanExecuteUnprompted("card")).toBe(false);
    expect(proactiveWriteCanExecuteUnprompted("propose")).toBe(false);
    expect(proactiveWriteCanExecuteUnprompted("blocked")).toBe(false);
    // "defer" hands the write to the normal approval path, which cards unless
    // a standing rule the person set already covers it: that is prompted, not
    // the proactive layer executing on its own.
    expect(proactiveWriteCanExecuteUnprompted("defer")).toBe(false);
  });

  it("reads are the only thing a non-off mode may run on its own", () => {
    const autoReadModes: ProactiveMode[] = ["read-auto", "follow-rules"];
    for (const mode of autoReadModes) expect(proactiveGate({ mode, kind: "read" })).toBe("auto");
    // Propose never runs even a read.
    expect(proactiveGate({ mode: "propose", kind: "read" })).toBe("propose");
  });
});
