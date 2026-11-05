// #2067: GET bots engine.name for the Perspicax console.
import { describe, expect, it } from "vitest";

import { adminBotEngine } from "./org-admin-bot-engine.ts";

describe("adminBotEngine", () => {
  it("returns the desktop display name beside the existing engine id", () => {
    expect(adminBotEngine({
      instanceId: "claude",
      driverKind: "claudeAgent",
      installed: true,
      displayName: "Claude",
    })).toEqual({
      instanceId: "claude",
      driverKind: "claudeAgent",
      installed: true,
      name: "Claude",
    });
  });

  it("falls back to the driver's English default name when the instance has none", () => {
    expect(adminBotEngine({
      instanceId: "claude-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      driverKind: "claudeAgent",
      installed: true,
      driverDisplayName: "Claude",
    }).name).toBe("Claude");
  });

  it("keeps a custom instance displayName (what the desktop shows)", () => {
    expect(adminBotEngine({
      instanceId: "personal-abc",
      driverKind: "openai-compat",
      installed: true,
      displayName: "Lab · OpenAI compatible",
      driverDisplayName: "OpenAI compatible",
    }).name).toBe("Lab · OpenAI compatible");
  });

  it("never invents a localized member label; blank displayName uses the English driver name", () => {
    expect(adminBotEngine({
      instanceId: "claude",
      driverKind: "claudeAgent",
      installed: false,
      displayName: "  ",
      driverDisplayName: "Claude",
    }).name).toBe("Claude");
  });
});
