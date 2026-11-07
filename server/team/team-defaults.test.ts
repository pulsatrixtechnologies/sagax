import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  changeEmptySection,
  ensureSections,
  readTeamDefaults,
  SECTION_CONTEXTS_FILE,
  sectionContextKey,
  writeSectionContext,
  readSectionContext,
  writeTeamDefaults,
  type TeamDefaultsRecord,
} from "../rooms/section-context.ts";
import { teamPatchPlan, withTeamDefaultsForCreate } from "./team-defaults.ts";

const OPUS = { instanceId: "claude", model: "opus" };
const SONNET = { instanceId: "claude", model: "sonnet" };
const TEAM: TeamDefaultsRecord = { model: OPUS, computer: "cloud", updatedAt: 1 };

function plan(bot: { section?: string; teamOverrides?: ("model" | "computer")[] }, body: Record<string, unknown>, defaults: Record<string, TeamDefaultsRecord> = { Dev: TEAM }) {
  const result = teamPatchPlan({ bot, body, defaultsFor: (section) => defaults[section] ?? null, sectionKey: sectionContextKey });
  return { result, body };
}

describe("team model and computer (I2)", () => {
  beforeEach(() => rmSync(SECTION_CONTEXTS_FILE, { force: true }));

  it("stores the team defaults beside the brief and follows a rename", () => {
    ensureSections(["Dev"]);
    writeSectionContext("Dev", "brief", 5);
    writeTeamDefaults("Dev", { model: OPUS, computer: "cloud" }, 10);
    expect(readTeamDefaults("Dev")).toEqual({ model: OPUS, computer: "cloud", updatedAt: 10 });
    changeEmptySection("Dev", "Pulsatrix Dev");
    expect(readTeamDefaults("Dev")).toBeNull();
    expect(readTeamDefaults("Pulsatrix Dev")).toEqual({ model: OPUS, computer: "cloud", updatedAt: 10 });
    expect(readSectionContext("Pulsatrix Dev")?.text).toBe("brief");
    writeTeamDefaults("Pulsatrix Dev", {});
    expect(readTeamDefaults("Pulsatrix Dev")).toBeNull();
  });

  it("a team change reaches a following bot and keeps it following", () => {
    const { result } = plan({ section: "Dev" }, { modelSelection: SONNET, teamApply: true });
    expect(result).toEqual({ ok: true });
  });

  it("a model set on the bot itself is an override the team leaves alone", () => {
    const { result, body } = plan({ section: "Dev" }, { modelSelection: SONNET });
    expect(result).toEqual({ ok: true, teamOverrides: ["model"] });
    expect(body.modelSelection).toEqual(SONNET);
  });

  it("inheriting again drops the override and takes the team value", () => {
    const { result, body } = plan({ section: "Dev", teamOverrides: ["model", "computer"] }, { teamInherit: ["computer"] });
    expect(result).toEqual({ ok: true, teamOverrides: ["model"] });
    expect(body).toEqual({ computer: "cloud" });
  });

  it("joining a team takes its model and computer and starts with no override", () => {
    const { result, body } = plan({ section: "Ops", teamOverrides: ["model"] }, { section: "Dev" });
    expect(result).toEqual({ ok: true, teamOverrides: [] });
    expect(body).toEqual({ section: "Dev", modelSelection: OPUS, computer: "cloud" });
  });

  it("what the move request sets itself stays the bot's own", () => {
    const { result, body } = plan({ section: "Ops" }, { section: "Dev", computer: "local" });
    expect(result).toEqual({ ok: true, teamOverrides: ["computer"] });
    expect(body).toEqual({ section: "Dev", computer: "local", modelSelection: OPUS });
  });

  it("a bot out of any team keeps no override", () => {
    const { result } = plan({ section: "Dev", teamOverrides: ["model"] }, { section: null });
    expect(result).toEqual({ ok: true, teamOverrides: [] });
  });

  it("refuses malformed flags", () => {
    expect(plan({ section: "Dev" }, { teamInherit: ["approval"] }).result.ok).toBe(false);
    expect(plan({ section: "Dev" }, { teamApply: "yes" }).result.ok).toBe(false);
  });

  it("a new bot in a team starts on the team settings", () => {
    expect(withTeamDefaultsForCreate({ name: "Rev" }, TEAM)).toEqual({ body: { name: "Rev", modelSelection: OPUS, computer: "cloud" } });
    expect(withTeamDefaultsForCreate({ name: "Rev", modelSelection: SONNET }, TEAM))
      .toEqual({ body: { name: "Rev", modelSelection: SONNET, computer: "cloud" }, teamOverrides: ["model"] });
  });
});
