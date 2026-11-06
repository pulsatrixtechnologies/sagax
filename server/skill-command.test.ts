import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { enabledSkillFile, expandSkillCommandTurnText, installSkill, setSkillEnabled, skillCommandInline } from "./skills/skills.ts";
import { workspaceDir } from "./workspace/workspace.ts";
import { BUILT_IN_SLASH_COMMANDS, offersSkillCommand, parseSkillCommand, skillMentions } from "../shared/skill-command.ts";

const SKILL = (name: string) =>
  `---\nname: ${name}\ndescription: Writes the weekly standup note.\n---\n\n# Standup\n\nSummarize {input} as three bullets.\n`;

function botWith(name: string, enabled = true, bot = `slash-bot-${Math.random().toString(36).slice(2, 10)}`): string {
  const installed = installSkill(bot, "local:test", [{ path: "SKILL.md", content: SKILL(name) }]);
  expect("error" in installed).toBe(false);
  if (enabled) expect("error" in setSkillEnabled(bot, name, true)).toBe(false);
  return bot;
}

describe("parseSkillCommand", () => {
  it("reads a leading /name and the request after it", () => {
    expect(parseSkillCommand("/standup", ["standup"])).toEqual({ name: "standup", request: "" });
    expect(parseSkillCommand("/standup  the billing work\nand more", ["standup"])).toEqual({ name: "standup", request: "the billing work\nand more" });
    expect(parseSkillCommand("/standup.", ["standup"])).toEqual({ name: "standup", request: "" });
    expect(parseSkillCommand("/standup: the billing work", ["standup"])).toEqual({ name: "standup", request: "the billing work" });
    expect(parseSkillCommand("  /weekly-2 go", ["weekly-2"])).toEqual({ name: "weekly-2", request: "go" });
  });

  it("leaves anything else as ordinary text", () => {
    expect(parseSkillCommand("/standupnow", ["standup"])).toBeNull();
    expect(parseSkillCommand("please run /standup", ["standup"])).toBeNull();
    expect(parseSkillCommand("/compact", ["standup"])).toBeNull();
    expect(parseSkillCommand("/Standup", ["standup"])).toBeNull();
  });

  it("never lets a skill shadow a built-in command", () => {
    for (const name of BUILT_IN_SLASH_COMMANDS) {
      expect(parseSkillCommand(`/${name} x`, [name])).toBeNull();
      expect(offersSkillCommand(name)).toBe(false);
    }
    expect(offersSkillCommand("standup")).toBe(true);
  });
});

describe("expandSkillCommandTurnText", () => {
  it("points the engine at the enabled skill's reviewed SKILL.md", () => {
    const bot = botWith("standup");
    const file = join(workspaceDir(bot), "skills", "standup", "SKILL.md");
    expect(enabledSkillFile(bot, "standup")).toBe(file);
    const text = expandSkillCommandTurnText(bot, "/standup the billing work");
    expect(text).toContain(`Read ${JSON.stringify(file)}`);
    expect(text).toContain("Request: the billing work");
    expect(text).toContain("{input}");
    expect(expandSkillCommandTurnText(bot, "/standup")).toContain("There is no further request");
    expect(expandSkillCommandTurnText(bot, "/standup.")).toContain("There is no further request");
  });

  it("runs a skill named later in the message with the whole message as the request", () => {
    const bot = botWith("standup");
    const file = join(workspaceDir(bot), "skills", "standup", "SKILL.md");
    const text = expandSkillCommandTurnText(bot, "write up the billing work with /standup please");
    expect(text).toContain(`Read ${JSON.stringify(file)}`);
    expect(text).toContain("Request: write up the billing work with /standup please");
    expect(expandSkillCommandTurnText(bot, "first line\n/standup.")).toContain(`Read ${JSON.stringify(file)}`);
  });

  it("runs every skill named in one message", () => {
    const bot = botWith("review", true, botWith("standup"));
    const standup = join(workspaceDir(bot), "skills", "standup", "SKILL.md");
    const review = join(workspaceDir(bot), "skills", "review", "SKILL.md");
    const text = expandSkillCommandTurnText(bot, "/review the diff, then /standup it and /review again");
    expect(text).toContain("ran 2 of your skills with /review, /standup");
    expect(text).toContain(`${JSON.stringify(review)} for /review`);
    expect(text).toContain(`${JSON.stringify(standup)} for /standup`);
    expect(text).toContain("Request: /review the diff, then /standup it and /review again");
  });

  it("leaves paths, links and built-in commands alone", () => {
    const bot = botWith("standup");
    expect(expandSkillCommandTurnText(bot, "open notes/standup now")).toBe("open notes/standup now");
    expect(expandSkillCommandTurnText(bot, "see https://x.test/standup")).toBe("see https://x.test/standup");
    expect(expandSkillCommandTurnText(bot, "the /standups folder")).toBe("the /standups folder");
    expect(skillMentions("run /learn then /goal and /standup")).toEqual(["standup"]);
    expect(skillMentions("open /standup.txt or /standup,now")).toEqual([]);
    expect(expandSkillCommandTurnText(bot, "open /standup.txt")).toBe("open /standup.txt");
  });

  it("passes a disabled skill, an unknown name and plain text through", () => {
    const bot = botWith("standup", false);
    expect(enabledSkillFile(bot, "standup")).toBeNull();
    expect(expandSkillCommandTurnText(bot, "/standup now")).toBe("/standup now");
    const on = botWith("standup");
    expect(expandSkillCommandTurnText(on, "/review now")).toBe("/review now");
    expect(expandSkillCommandTurnText(on, "standup please")).toBe("standup please");
  });
});

describe("expandSkillCommandTurnText for an engine without file tools", () => {
  it("carries the skill's instructions in the turn instead of a path", () => {
    const bot = botWith("standup");
    const text = expandSkillCommandTurnText(bot, "/standup the billing work", undefined, { inline: true });
    expect(text).not.toContain("SKILL.md\"");
    expect(text).not.toContain("file tools");
    expect(text).toContain("Summarize {input} as three bullets.");
    expect(text).not.toContain("description: Writes the weekly standup note.");
    expect(text).toContain("Request: the billing work");
    expect(expandSkillCommandTurnText(bot, "/standup", undefined, { inline: true })).toContain("There is no further request");
  });

  it("still passes a disabled skill, an unknown name and plain text through", () => {
    const off = botWith("standup", false);
    expect(expandSkillCommandTurnText(off, "/standup now", undefined, { inline: true })).toBe("/standup now");
    const on = botWith("standup");
    expect(expandSkillCommandTurnText(on, "/review now", undefined, { inline: true })).toBe("/review now");
    expect(expandSkillCommandTurnText(on, "standup please", undefined, { inline: true })).toBe("standup please");
  });

  it("inlines every skill named later in one message", () => {
    const bot = botWith("review", true, botWith("standup"));
    const text = expandSkillCommandTurnText(bot, "use /standup then /review", undefined, { inline: true });
    expect(text).toContain("ran 2 of your skills with /standup, /review");
    expect(text).toContain("Skill instructions (standup):");
    expect(text).toContain("Skill instructions (review):");
    expect(text).toContain("Request: use /standup then /review");
  });
});

describe("a /name turn on an organization server", () => {
  it("carries the skill's instructions for every engine, since the bot cannot reach the server's SKILL.md (#1508)", () => {
    expect(skillCommandInline({ workspaceFiles: true, organization: true })).toBe(true);
    expect(skillCommandInline({ workspaceFiles: false, organization: true })).toBe(true);
    expect(skillCommandInline({ workspaceFiles: false, organization: false })).toBe(true);
    // a solo server still points an engine with file tools at the file
    expect(skillCommandInline({ workspaceFiles: true, organization: false })).toBe(false);
    const bot = botWith("standup");
    const text = expandSkillCommandTurnText(bot, "/standup", undefined, { inline: skillCommandInline({ workspaceFiles: true, organization: true }) });
    expect(text).toContain("Summarize {input} as three bullets.");
    expect(text).not.toContain("file tools");
  });
});
