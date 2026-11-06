import { describe, expect, it } from "vitest";
import { recoveryCapabilityError } from "./automatic-recovery.ts";

describe("automatic recovery capabilities", () => {
  const engine = { driverKind: "qwenAgent", capabilities: {
    sessionModelSwitch: "unsupported" as const, agentsMcp: true, browserMcp: true,
    customMcp: true, dataMcp: true, images: true,
  } };
  it("keeps a compatible local workspace and rejects losing a tool or attachment", () => {
    expect(recoveryCapabilityError(engine, { ...engine, driverKind: "claudeAgent" })).toBeUndefined();
    for (const key of ["agentsMcp", "browserMcp", "customMcp", "dataMcp", "images"] as const) {
      expect(recoveryCapabilityError(engine, { ...engine, capabilities: { ...engine.capabilities, [key]: false } })).toMatch(/tools and attachments/);
    }
  });
  it("lets a limited Claude bot carry on with an engine that has every tool but a USB phone", () => {
    const claude = { driverKind: "claudeAgent", capabilities: { sessionModelSwitch: "in-session" as const, agentsMcp: true, customMcp: true,
      computerMcp: true, phoneMcp: true, browserMcp: true, dataMcp: true, images: true } };
    const { phoneMcp: _phone, ...rest } = claude.capabilities;
    const opencode = { driverKind: "opencodeAgent", capabilities: { ...rest, sessionModelSwitch: "unsupported" as const, localComputerMcp: true } };
    expect(recoveryCapabilityError(claude, opencode)).toBeUndefined();
    expect(recoveryCapabilityError(claude, { ...opencode, capabilities: { ...opencode.capabilities, browserMcp: false } })).toMatch(/tools and attachments/);
  });
  it("does not silently move work to a file-less engine", () => {
    expect(recoveryCapabilityError(engine, { ...engine, driverKind: "openai-compat" })).toMatch(/same workspace/);
  });
});
