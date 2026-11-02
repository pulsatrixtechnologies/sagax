import { describe, expect, it } from "vitest";

import {
  MESSAGES_SETUP_STEPS,
  messagesPrivacyAnchor,
  messagesSetupHostGate,
  messagesStepState,
  messagesTestNamesView,
} from "./mac-messages-setup.ts";

describe("mac-messages-setup", () => {
  it("allows only the solo darwin host", () => {
    expect(messagesSetupHostGate({ platform: "darwin", identityKind: "solo" })).toEqual({ ok: true });
    expect(messagesSetupHostGate({ platform: "darwin", identityKind: "perspicax" })).toEqual({
      ok: false,
      reason: "organization_server",
    });
    expect(messagesSetupHostGate({ platform: "linux", identityKind: "solo" })).toEqual({
      ok: false,
      reason: "not_darwin",
    });
    expect(messagesSetupHostGate({ platform: "darwin", identityKind: "solo", bridgeAction: true })).toEqual({
      ok: false,
      reason: "bridge_refused",
    });
  });

  it("orders setup steps and privacy anchors", () => {
    expect(MESSAGES_SETUP_STEPS.map((step) => step.id)).toEqual([
      "fullDiskAccess",
      "automation",
      "test",
      "enable",
    ]);
    expect(messagesPrivacyAnchor("fullDiskAccess")).toBe("Privacy_AllFiles");
    expect(messagesPrivacyAnchor("automation")).toBe("Privacy_Automation");
  });

  it("derives checklist states from live permissions", () => {
    const permissions = { fullDiskAccess: "granted" as const, automation: "notAsked" as const };
    expect(messagesStepState({ step: "fullDiskAccess", permissions, useMessages: false, tested: false, testOk: false })).toBe("done");
    expect(messagesStepState({ step: "automation", permissions, useMessages: false, tested: false, testOk: false })).toBe("todo");
    expect(messagesStepState({ step: "test", permissions, useMessages: false, tested: false, testOk: false })).toBe("todo");
    expect(messagesStepState({ step: "enable", permissions, useMessages: false, tested: true, testOk: true })).toBe("todo");
    expect(messagesStepState({ step: "enable", permissions, useMessages: true, tested: true, testOk: true })).toBe("done");
    expect(messagesStepState({
      step: "test",
      permissions: { fullDiskAccess: "denied", automation: "denied" },
      useMessages: false,
      tested: false,
      testOk: false,
    })).toBe("blocked");
  });

  it("returns conversation name counts without inventing bodies", () => {
    expect(messagesTestNamesView(["Ada", "  ", "Bea", "Cara"], 2)).toEqual({
      conversationCount: 3,
      names: ["Ada", "Bea"],
    });
  });
});
