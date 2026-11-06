import { describe, expect, it } from "vitest";
import {
  simpleHidesBotSection,
  simpleHidesPanelTab,
  simpleHidesSettingsSection,
} from "./interface-visibility";

describe("simple visibility", () => {
  // #2080 (L0): Simple hides no rail page but Experimental (the rest are old
  // aliases); a page's technical cards fold under "Advanced" instead
  it("hides Experimental and the old aliases, keeps every page of the rail", () => {
    for (const id of ["experimental", "connections", "decisionModel", "mail", "activity", "workspaces", "people"] as const) {
      expect(simpleHidesSettingsSection(id), id).toBe(true);
    }
    for (const id of ["general", "appearance", "organization", "companion", "usage", "engines", "computer", "backups", "providers", "voice", "about"] as const) {
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
    expect(simpleHidesPanelTab("roles")).toBe(true);
    expect(simpleHidesPanelTab("details")).toBe(false);
  });
});
