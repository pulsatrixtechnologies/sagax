// #4504: a bot's skill imported from GitHub is updated from its source; a
// failure keeps the installed copy and its switch.
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { installSkill, listSkills, readSkillFile, replaceImportedSkill, setSkillEnabled } from "./skills.ts";
import { workspaceDir } from "../workspace/workspace.ts";

const SKILL = (body: string, name = "trip-plan") => `---\nname: ${name}\ndescription: Plan a trip.\n---\n\n${body}\n`;
const origin = (commit: string) => ({ owner: "acme", repo: "skills", ref: "main", path: "trip", commit: commit.repeat(40) });
const bots: string[] = [];
afterEach(() => {
  for (const bot of bots.splice(0)) rmSync(workspaceDir(bot), { recursive: true, force: true });
});

describe("replaceImportedSkill", () => {
  it("brings the new folder in, keeps the switch, and records the new commit", () => {
    const bot = `test-update-${Math.random().toString(36).slice(2, 10)}`;
    bots.push(bot);
    expect(installSkill(bot, "acme/skills/trip", [{ path: "SKILL.md", content: SKILL("Old steps.") }], origin("a"))).not.toHaveProperty("error");
    expect(setSkillEnabled(bot, "trip-plan", true)).not.toHaveProperty("error");
    const done = replaceImportedSkill(bot, "trip-plan", "acme/skills/trip", [
      { path: "SKILL.md", content: SKILL("New steps.") },
      { path: "checklist.md", content: "- passport" },
    ], origin("b"));
    expect(done).not.toHaveProperty("error");
    expect(readSkillFile(bot, "trip-plan")).toContain("New steps.");
    expect(listSkills(bot)[0]).toMatchObject({ name: "trip-plan", enabled: true, github: { commit: "b".repeat(40) } });
  });

  it("keeps the installed copy when the source no longer fits", () => {
    const bot = `test-update-${Math.random().toString(36).slice(2, 10)}`;
    bots.push(bot);
    expect(installSkill(bot, "acme/skills/trip", [{ path: "SKILL.md", content: SKILL("Old steps.") }], origin("a"))).not.toHaveProperty("error");
    expect(replaceImportedSkill(bot, "trip-plan", "acme/skills/trip", [{ path: "SKILL.md", content: SKILL("Other.", "renamed") }], origin("b"))).toHaveProperty("error");
    expect(replaceImportedSkill(bot, "trip-plan", "acme/skills/trip", [{ path: "README.md", content: "no skill" }], origin("b"))).toHaveProperty("error");
    expect(readSkillFile(bot, "trip-plan")).toContain("Old steps.");
    expect(listSkills(bot)[0]).toMatchObject({ github: { commit: "a".repeat(40) } });
    expect(replaceImportedSkill(bot, "missing", "x", [], undefined)).toHaveProperty("error");
  });
});
