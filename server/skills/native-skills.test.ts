import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { installSkill, setSkillEnabled } from "./skills.ts";
import {
  expandNativeSkillCommand,
  nativeSkillListing,
  nativeSkills,
  readNativeSkillFile,
  type SkillTurnEngine,
} from "./native-skills.ts";
import { TASK_WORKSPACES_DIR } from "../workspace/workspace.ts";

// HOME and the data folder are this test file's own temporary ones (server/testing/setup.ts).
const HOME = join(DATA_DIR, "..");
const USER_SKILLS = join(HOME, ".claude", "skills");
const SHARED = join(TASK_WORKSPACES_DIR, ".claude", "skills");
const PROJECTS = join(HOME, "projects");
afterEach(() => {
  for (const dir of [TASK_WORKSPACES_DIR, USER_SKILLS, PROJECTS]) rmSync(dir, { recursive: true, force: true });
});

const skillMd = (name: string) => `---\nname: ${name}\ndescription: Works with ${name}.\n---\n\nFollow the steps.\n`;
function plant(root: string, name: string): string {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), skillMd(name));
  return join(root, name, "SKILL.md");
}

const claude: SkillTurnEngine = { driverKind: "claudeAgent" };
const listed = (skills: Array<{ name: string; origin?: string }>) =>
  skills.map((skill) => `${skill.name}:${skill.origin ?? "own"}`);

describe("skills the engine loads by itself", () => {
  it("reach a Claude bot's / menu from the folders above its task folder", () => {
    const botId = `bot-${randomUUID().slice(0, 8)}`;
    const cwd = join(TASK_WORKSPACES_DIR, botId, "main");
    const shared = plant(SHARED, "growth-data-expert");
    const own = plant(join(TASK_WORKSPACES_DIR, botId, ".claude", "skills"), "bot-notes");
    plant(SHARED, "bot-notes");
    plant(SHARED, "mine");
    installSkill(botId, "local", [{ path: "SKILL.md", content: skillMd("mine") }]);
    setSkillEnabled(botId, "mine", true);
    mkdirSync(join(SHARED, "no-frontmatter"), { recursive: true });
    writeFileSync(join(SHARED, "no-frontmatter", "SKILL.md"), "Just do\nthe thing.\n\nMore steps.\n");
    for (const [name, value] of [["model-only", "false"], ["model-only-no", "No"], ["model-only-off", "off"], ["model-only-zero", "0"]] as const) {
      mkdirSync(join(SHARED, name), { recursive: true });
      writeFileSync(join(SHARED, name, "SKILL.md"), `---\ndescription: Only for the model.\nuser-invocable: ${value}\n---\n\nSteps.\n`);
    }

    const natives = nativeSkills(claude, { claudeUserSkills: false, cwd, home: HOME }).map(nativeSkillListing);
    expect(listed(natives)).toEqual(["bot-notes:native", "growth-data-expert:native", "mine:native", "no-frontmatter:native"]);
    expect(natives.find((skill) => skill.name === "no-frontmatter")?.description).toBe("Just do the thing.");
    expect(natives.find((skill) => skill.name === "bot-notes")).toMatchObject({ enabled: true, editable: false });
    const growth = nativeSkills(claude, { claudeUserSkills: false, cwd, home: HOME }).find((skill) => skill.name === "growth-data-expert")!;
    expect(readNativeSkillFile(growth)).toBe(skillMd("growth-data-expert"));
    expect(expandNativeSkillCommand("/growth-data-expert find churn", [growth])).toContain(`Read ${JSON.stringify(shared)}`);
    const notes = nativeSkills(claude, { claudeUserSkills: false, cwd, home: HOME }).find((skill) => skill.name === "bot-notes")!;
    expect(expandNativeSkillCommand("/bot-notes", [notes])).toContain(`Read ${JSON.stringify(own)}`);
  });

  it("include ~/.claude/skills only with Also use my Claude Code skills, and no task folders for other engines", () => {
    plant(SHARED, "shared-one");
    plant(USER_SKILLS, "personal-one");
    plant(SHARED, "both");
    const personal = plant(USER_SKILLS, "both");
    const cwd = join(TASK_WORKSPACES_DIR, "bot-x", "main");
    mkdirSync(cwd, { recursive: true });

    const off = nativeSkills(claude, { claudeUserSkills: false, cwd, home: HOME }).map(nativeSkillListing);
    expect(listed(off)).toEqual(["both:native", "shared-one:native"]);
    const on = nativeSkills(claude, { claudeUserSkills: true, cwd, home: HOME });
    expect(listed(on.map(nativeSkillListing))).toEqual(["both:native", "personal-one:native", "shared-one:native"]);
    expect(expandNativeSkillCommand("/both", on)).toContain(`Read ${JSON.stringify(personal)}`);
    const other = nativeSkills({ driverKind: "geminiAgent" }, { claudeUserSkills: true, cwd, home: HOME });
    expect(other).toEqual([]);
    expect(expandNativeSkillCommand("/shared-one", other)).toBe("/shared-one");
  });

  it("come from the folder a thread really works in, up to its git root", () => {
    const repo = join(PROJECTS, "repo");
    plant(join(PROJECTS, ".claude", "skills"), "above-the-repo");
    plant(join(repo, ".claude", "skills"), "repo-skill");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "app"), { recursive: true });
    plant(SHARED, "task-folder-skill");

    expect(listed(nativeSkills(claude, { claudeUserSkills: false, cwd: join(repo, "app"), home: HOME }).map(nativeSkillListing)))
      .toEqual(["repo-skill:native"]);
    expect(listed(nativeSkills(claude, { claudeUserSkills: false, cwd: repo, home: HOME }).map(nativeSkillListing)))
      .toEqual(["repo-skill:native"]);
    expect(listed(nativeSkills(claude, { claudeUserSkills: false, cwd: join(TASK_WORKSPACES_DIR, "bot-y", "main"), home: HOME }).map(nativeSkillListing)))
      .toEqual(["task-folder-skill:native"]);
    expect(expandNativeSkillCommand("/repo-skill", nativeSkills(claude, { claudeUserSkills: false, cwd: null, home: HOME })))
      .toBe("/repo-skill");
  });

  it.skipIf(process.platform === "win32")("never read a SKILL.md that is itself a link", () => {
    const cwd = join(TASK_WORKSPACES_DIR, "bot-z", "main");
    mkdirSync(join(SHARED, "linked"), { recursive: true });
    symlinkSync(plant(join(DATA_DIR, "elsewhere"), "secret"), join(SHARED, "linked", "SKILL.md"));
    expect(nativeSkills(claude, { claudeUserSkills: false, cwd, home: HOME })).toEqual([]);
  });
});
