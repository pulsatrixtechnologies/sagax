import { describe, expect, it } from "vitest";
import { createHandleDesktopTrustedApprovalMessage } from "./desktop-trusted-approval.ts";

describe("createHandleDesktopTrustedApprovalMessage", () => {
  it("returns false for non-object payloads", () => {
    const handle = createHandleDesktopTrustedApprovalMessage(() => ({
      store: { bot: () => null, tasks: () => [], patchBot: () => null, projectBotForTask: () => null },
      registry: { cliTarget: () => null },
      threadBusy: () => false,
      supportsApprovalMode: () => true,
    }));
    expect(handle(null)).toBe(false);
    expect(handle("x")).toBe(false);
    expect(handle(1)).toBe(false);
  });

  it("returns false for unknown message types", () => {
    const handle = createHandleDesktopTrustedApprovalMessage(() => ({
      store: { bot: () => null, tasks: () => [], patchBot: () => null, projectBotForTask: () => null },
      registry: { cliTarget: () => null },
      threadBusy: () => false,
      supportsApprovalMode: () => true,
    }));
    expect(handle({ type: "not-a-trusted-approval" })).toBe(false);
  });
});
