// 2026-10-28 (one source of truth): what the selector shows is what the
// server applies. A conversation that runs a level other than its bot's
// setting says why. Since #4200 a stored conversation level other than a
// Primary Bot's wider hand-off is dropped at start (store load).
import { describe, expect, it } from "vitest";

import { appliedLevelReason, botApprovalSetting } from "./approval-mode";

describe("appliedLevelReason", () => {
  it("is absent when the conversation runs the bot's setting", () => {
    expect(appliedLevelReason("full", "full", {})).toBeUndefined();
  });

  // #4200 (one approval level per bot, #4226): the only level a
  // conversation still holds is a Primary Bot's hand-off, and only above
  // the bot's own; the older thread, engine and safety exceptions are gone.
  it("names the conversation's own level first, after a pending grant", () => {
    expect(appliedLevelReason("ask", "auto", { threadException: "delegated", threadLevel: "auto" })).toBe("delegated");
    expect(appliedLevelReason("ask", "auto", { pending: true, threadException: "delegated", threadLevel: "auto" })).toBe("pending");
    expect(appliedLevelReason("full", "ask", { threadException: "engine", threadLevel: "ask" })).toBe("engine-unsupported");
    expect(appliedLevelReason("full", "ask", { threadException: "thread", threadLevel: "ask" })).toBe("engine-unsupported");
  });

  it("names the owner's missing confirmation for Full, then the organization's policy", () => {
    expect(appliedLevelReason("full", "ask", { consentMissing: true })).toBe("consent");
    expect(appliedLevelReason("auto", "ask", { memberPolicy: true })).toBe("member-policy");
    expect(appliedLevelReason("full", "ask", { guest: true, consentMissing: true })).toBe("guest");
    expect(appliedLevelReason("full", "ask", { mail: true })).toBe("mail");
  });

  it("falls back to the engine when nothing else explains it", () => {
    expect(appliedLevelReason("full", "ask", {})).toBe("engine-unsupported");
  });
});

describe("botApprovalSetting", () => {
  it("reads the bot's own setting, never the open conversation's level", () => {
    expect(botApprovalSetting({ approvalSetting: "full", approvalMode: "ask" })).toBe("full");
    expect(botApprovalSetting({ approvalMode: "auto" })).toBe("auto");
    expect(botApprovalSetting({ approvalSetting: "nonsense", autoApprove: true })).toBe("auto");
  });
});
