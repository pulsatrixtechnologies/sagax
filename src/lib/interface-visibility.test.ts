import { describe, expect, it } from "vitest";
import {
  simpleHidesBotSection,
  simpleHidesPanelTab,
  simpleHidesSettingsSection,
} from "./interface-visibility";

describe("simple visibility", () => {
  it("hides technical settings sections and keeps the ones a person needs", () => {
    for (const id of ["experimental", "connections", "decisionModel", "engines", "computer", "mail", "activity", "backups", "workspaces", "people"] as const) {
      expect(simpleHidesSettingsSection(id), id).toBe(true);
    }
    // 2026-10-15: Usage is the person's own plan and cost, shown in Simple too
    for (const id of ["general", "appearance", "organization", "companion", "usage"] as const) {
      expect(simpleHidesSettingsSection(id), id).toBe(false);
    }
  });

  it("hides engine plumbing in the bot panel and keeps the everyday sections", () => {
    for (const id of ["access", "worksOn", "usage", "history", "skills"] as const) {
      expect(simpleHidesBotSection(id), id).toBe(true);
    }
    for (const id of ["overview", "soul", "memory", "routines", "model", "permissions", "voice", "visibility", "sharing", "slack", "details"] as const) {
      expect(simpleHidesBotSection(id), id).toBe(false);
    }
    expect(simpleHidesPanelTab("computer")).toBe(true);
    expect(simpleHidesPanelTab("details")).toBe(false);
  });
});
