// Skill history (#2610): every change to a bot's skill is kept as a version
// with its text before and after, newest first, capped, and any version can be
// put back; the restore is itself a version, so it can be undone too.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";

process.env.SAGAX_DATA_DIR = mkdtempSync(join(tmpdir(), "sagax-skill-history-"));

const history = await import("./skill-history.ts");
const skills = await import("./skills.ts");

const SKILL = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: Writes the weekly report.\n---\n\n# ${name}\n\n${body}\n`;

describe("the history log", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sagax-history-log-")); });
  afterEach(async () => { await removeTempDir(dir); });

  it("keeps changes newest first and skips a change that changed nothing", () => {
    expect(history.recordSkillVersion(dir, "weekly", { by: "bot", gist: "Created", before: null, after: "a", at: 1 })).not.toBeNull();
    expect(history.recordSkillVersion(dir, "weekly", { by: "person", before: "a", after: "a", at: 2 })).toBeNull();
    history.recordSkillVersion(dir, "weekly", { by: "person", gist: "  Shorter\n bullets ", before: "a", after: "b", at: 3 });
    const versions = history.readSkillHistory(dir, "weekly");
    expect(versions.map((version) => [version.by, version.gist, version.before, version.after])).toEqual([
      ["person", "Shorter bullets", "a", "b"],
      ["bot", "Created", null, "a"],
    ]);
  });

  it("keeps the newest versions only", () => {
    for (let index = 0; index < history.MAX_SKILL_HISTORY + 5; index += 1) {
      history.recordSkillVersion(dir, "weekly", { by: "bot", before: String(index), after: String(index + 1), at: index });
    }
    const versions = history.readSkillHistory(dir, "weekly");
    expect(versions).toHaveLength(history.MAX_SKILL_HISTORY);
    expect(versions[0]!.after).toBe(String(history.MAX_SKILL_HISTORY + 5));
  });

  it("refuses names that are not skill names", () => {
    expect(history.recordSkillVersion(dir, "../escape", { by: "bot", before: null, after: "x" })).toBeNull();
    expect(history.readSkillHistory(dir, "../escape")).toEqual([]);
  });
});

describe("skill changes land in the history and can be put back", () => {
  let bot: string;
  beforeEach(() => { bot = `bot-history-${Math.random().toString(36).slice(2, 10)}`; });

  it("records the bot's learned create and update, and restores through the same path", () => {
    const created = skills.stageSkillWrite(bot, {
      action: "create",
      source: "learn:weekly report",
      gist: "Weekly report steps",
      files: [{ path: "SKILL.md", content: SKILL("weekly", "Write the report.") }],
    });
    if ("error" in created) throw new Error(created.error);
    expect(skills.applyStagedSkillWrite(bot, created.id, { expectedSha256: created.sha256 })).toMatchObject({ name: "weekly" });
    const original = skills.readSkillFile(bot, "weekly");

    const updated = skills.stageSkillWrite(bot, {
      action: "update",
      targetName: "weekly",
      source: "learn:weekly report",
      gist: "Keep it to five bullets",
      files: [{ path: "SKILL.md", content: SKILL("weekly", "Write the report. Keep it to five bullets.") }],
    });
    if ("error" in updated) throw new Error(updated.error);
    skills.applyStagedSkillWrite(bot, updated.id, { expectedSha256: updated.sha256 });

    const versions = skills.listSkillHistory(bot, "weekly");
    expect(versions.map((version) => [version.by, version.gist, version.before === null])).toEqual([
      ["bot", "Keep it to five bullets", false],
      ["bot", "Weekly report steps", true],
    ]);

    // Undo the newest change: the text from before it comes back, as a new version
    const undone = skills.restoreSkillVersion(bot, "weekly", versions[0]!.id, "before");
    expect(undone).toMatchObject({ skill: { name: "weekly" } });
    expect(skills.readSkillFile(bot, "weekly")).toBe(original);
    const after = skills.listSkillHistory(bot, "weekly");
    expect(after).toHaveLength(3);
    expect(after[0]).toMatchObject({ by: "restore", before: versions[0]!.after, after: original });

    // the version that created the skill has nothing before it
    expect(skills.restoreSkillVersion(bot, "weekly", versions[1]!.id, "before")).toMatchObject({ status: 409 });
    expect(skills.restoreSkillVersion(bot, "weekly", "missing", "after")).toMatchObject({ status: 404 });
  });

  it("records the person's own save and restores it", () => {
    const installed = skills.installSkill(bot, "local-import", [{ path: "SKILL.md", content: SKILL("notes", "First.") }]);
    if ("error" in installed) throw new Error(installed.error);
    const first = skills.readSkillFile(bot, "notes");
    expect(skills.updateBotSkillByPerson(bot, "notes", { text: SKILL("notes", "Second.") })).toMatchObject({ skill: { name: "notes" } });
    const [saved] = skills.listSkillHistory(bot, "notes");
    expect(saved).toMatchObject({ by: "person", before: first, after: SKILL("notes", "Second.") });

    expect(skills.restoreSkillVersion(bot, "notes", saved!.id, "before")).toMatchObject({ skill: { name: "notes" } });
    expect(skills.readSkillFile(bot, "notes")).toBe(first);
    expect(skills.listSkillHistory(bot, "notes")[0]).toMatchObject({ by: "restore", after: first });
  });
});
