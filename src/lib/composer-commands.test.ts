import { describe, expect, it } from "vitest";
import type { HarnessCommand } from "../../shared/harness-commands";
import {
  composerCommandMenu,
  composerGroupCommandMenu,
  composerGroupSlashTrigger,
  composerMenuSection,
  composerSlashTrigger,
  engineCommandInsertion,
  groupCommandTargets,
  groupMenuLimitPerBot,
  goalSubcommandBlock,
  goalSubcommandFromComposer,
  goalTextFromComposer,
  replaceComposerSlashTrigger,
  skillCommandInsertion,
  type ComposerSlashCommand,
  type ComposerSlashCommandId,
} from "./composer-commands";
// skillCommandInsertion is exercised for mid-message picks (no double space).
import { enabledSlashSkills } from "./use-slash-skills";

describe("composer slash commands", () => {
  it("opens command search for the unfinished slash token at the caret", () => {
    expect(composerSlashTrigger("/", 1)).toEqual({ query: "", start: 0, end: 1 });
    expect(composerSlashTrigger("/go", 3)).toEqual({ query: "go", start: 0, end: 3 });
    expect(composerSlashTrigger("/goal write", 11)).toBeNull();
  });

  it("opens command search for a slash token later in the message", () => {
    expect(composerSlashTrigger("hello /go", 9)).toEqual({ query: "go", start: 6, end: 9 });
    expect(composerSlashTrigger("first line\n/", 12)).toEqual({ query: "", start: 11, end: 12 });
    expect(composerSlashTrigger("use /stand later", 10)).toEqual({ query: "stand", start: 4, end: 10 });
    expect(composerSlashTrigger("a/b", 3)).toBeNull();
    expect(composerSlashTrigger("see http://x/", 13)).toBeNull();
    expect(
      replaceComposerSlashTrigger("use /stand later", { query: "stand", start: 4, end: 10 }, "/standup "),
    ).toEqual({ text: "use /standup  later", caret: 13 });
  });

  it("replaces the active token without losing text after the caret", () => {
    expect(
      replaceComposerSlashTrigger("/go later", { query: "go", start: 0, end: 3 }, ""),
    ).toEqual({ text: " later", caret: 0 });
    expect(
      replaceComposerSlashTrigger("/le", { query: "le", start: 0, end: 3 }, "/learn "),
    ).toEqual({ text: "/learn ", caret: 7 });
  });

  it("adds no second space when skill insertion already has text after it", () => {
    expect(skillCommandInsertion({ kind: "skill", key: "skill:standup", group: "skills", label: "/standup", description: "", skill: { name: "standup", description: "" } }, " later")).toBe("/standup");
    expect(skillCommandInsertion({ kind: "skill", key: "skill:standup", group: "skills", label: "/standup", description: "", skill: { name: "standup", description: "" } }, "")).toBe("/standup ");
  });

  it("turns a manually typed goal command into a goal request", () => {
    expect(goalTextFromComposer("/goal ship the release")).toBe("ship the release");
    expect(goalTextFromComposer("/GOAL\n  investigate the failure")).toBe(
      "investigate the failure",
    );
    expect(goalTextFromComposer("/goalie says hello")).toBeNull();
    expect(goalTextFromComposer("discuss /goal later")).toBeNull();
  });

  it("keeps the menu open on /goal's subcommands, never on the goal itself", () => {
    expect(composerSlashTrigger("/goal ", 6)).toEqual({ query: "goal ", start: 0, end: 6 });
    expect(composerSlashTrigger("/goal st", 8)).toEqual({ query: "goal st", start: 0, end: 8 });
    expect(composerSlashTrigger("/goal stop now", 14)).toBeNull();
    expect(composerSlashTrigger("/goalie ", 8)).toBeNull();
  });

  it("reads a typed subcommand alone, and leaves it out of the goal text", () => {
    expect(goalSubcommandFromComposer("/goal stop")).toBe("stop");
    expect(goalSubcommandFromComposer("/GOAL Status ")).toBe("status");
    expect(goalSubcommandFromComposer("/goal stop the server")).toBeNull();
    expect(goalSubcommandFromComposer("/goal ship")).toBeNull();
    expect(goalTextFromComposer("/goal stop")).toBeNull();
    expect(goalTextFromComposer("/goal stop the server")).toBe("stop the server");
  });

  it("says why a subcommand cannot run from the room's latest goal run", () => {
    expect(goalSubcommandBlock("status", undefined)).toBe("noGoal");
    expect(goalSubcommandBlock("status", "completed")).toBeNull();
    expect(goalSubcommandBlock("stop", "working")).toBeNull();
    expect(goalSubcommandBlock("stop", "stopped")).toBe("notRunning");
    expect(goalSubcommandBlock("resume", "stopped")).toBeNull();
    expect(goalSubcommandBlock("resume", "working")).toBe("alreadyRunning");
    expect(goalSubcommandBlock("resume", "completed")).toBe("completed");
    expect(goalSubcommandBlock("pause", "working")).toBe("pauseUnsupported");
  });

  it("offers setup as a slash command id and keeps the typed token", () => {
    const id: ComposerSlashCommandId = "setup";
    expect(id).toBe("setup");
    expect(
      replaceComposerSlashTrigger("/se", { query: "se", start: 0, end: 3 }, "/setup "),
    ).toEqual({ text: "/setup ", caret: 7 });
  });

  it("opens on a skill name with digits", () => {
    expect(composerSlashTrigger("/weekly-2", 9)).toEqual({ query: "weekly-2", start: 0, end: 9 });
  });

  it("reads only enabled, named skills from the skills listing", () => {
    expect(enabledSlashSkills({ skills: [
      { name: "standup", description: "Writes the note.", enabled: true },
      { name: "draft", description: "Off for now.", enabled: false },
      { name: 7, description: "broken", enabled: true },
      { name: "bare", enabled: true },
    ] })).toEqual([
      { name: "standup", description: "Writes the note." },
      { name: "bare", description: "" },
    ]);
    expect(enabledSlashSkills(null)).toEqual([]);
  });
});

describe("composer command menu (Sagax and the engine)", () => {
  const sagax: ComposerSlashCommand[] = [
    { id: "goal", label: "/goal", description: "Keep a team working" },
    { id: "setup", label: "/setup", description: "Set this bot up" },
  ];
  const engine: HarnessCommand[] = [
    { name: "compact", description: "Free up context", group: "engine", argumentHint: "<instructions>" },
    { name: "goal", description: "Engine goal", group: "engine" },
    { name: "model", description: "Set the model", group: "engine", unavailable: "managed" },
    { name: "context", description: "Show context usage", group: "engine" },
    { name: "pulsatrix-flow:using-px-flow", description: "Flow entry", group: "plugins", aliases: ["using-px-flow"] },
    { name: "mcp__github__review_pr", description: "Review a PR", group: "mcp", argumentHint: "<pr>" },
  ];

  it("lists /goal's subcommands under the goal heading, matched as typed after /goal", () => {
    const goal: ComposerSlashCommand[] = [
      { id: "goal", label: "/goal", description: "Keep a team working" },
      { id: "goal-status", label: "/goal status", description: "Where it stands" },
      { id: "goal-stop", label: "/goal stop", description: "Stop it" },
      { id: "learn", label: "/learn", description: "Write a skill" },
    ];
    expect(composerCommandMenu(goal, [], "").map((item) => [item.group, item.label])).toEqual([
      ["goal", "/goal"], ["goal", "/goal status"], ["goal", "/goal stop"], ["sagax", "/learn"],
    ]);
    expect(composerCommandMenu(goal, [], "goal ").map((item) => item.label)).toEqual(["/goal status", "/goal stop"]);
    expect(composerCommandMenu(goal, [], "goal st").map((item) => item.label)).toEqual(["/goal status", "/goal stop"]);
    expect(composerCommandMenu(goal, [], "goal sto").map((item) => item.label)).toEqual(["/goal stop"]);
  });

  it("lists every command grouped Objective, Sagax, Engine, Plugins, MCP for a bare slash", () => {
    const menu = composerCommandMenu(sagax, engine, "");
    expect(menu.map((item) => [item.group, item.label])).toEqual([
      ["goal", "/goal"], ["sagax", "/setup"],
      ["engine", "/compact"], ["engine", "/engine:goal"], ["engine", "/context"], ["engine", "/model"],
      ["plugins", "/pulsatrix-flow:using-px-flow"],
      ["mcp", "/mcp__github__review_pr"],
    ]);
    const model = menu.find((item) => item.label === "/model");
    expect(model?.kind === "engine" && model.unavailable).toBe("managed");
  });

  it("filters by name, a plugin command's short name, an alias and the description", () => {
    expect(composerCommandMenu(sagax, engine, "co").map((item) => item.label)).toEqual(["/compact", "/context"]);
    expect(composerCommandMenu(sagax, engine, "using").map((item) => item.label)).toEqual(["/pulsatrix-flow:using-px-flow"]);
    expect(composerCommandMenu(sagax, engine, "engine:g").map((item) => item.label)).toEqual(["/engine:goal"]);
    expect(composerCommandMenu(sagax, engine, "go").map((item) => item.label)).toEqual(["/goal", "/engine:goal"]);
    expect(composerCommandMenu(sagax, engine, "review").map((item) => item.label)).toEqual(["/mcp__github__review_pr"]);
  });

  it("lists the bot's enabled skills under Skills, after Sagax and before the engine", () => {
    const skills = [
      { name: "presentation", description: "Introduce yourself" },
      { name: "compact", description: "A skill that shadows the engine's /compact" },
      { name: "setup", description: "Cannot shadow a built-in" },
    ];
    const menu = composerCommandMenu(sagax, engine, "", skills);
    expect(menu.map((item) => [item.group, item.label])).toEqual([
      ["goal", "/goal"], ["sagax", "/setup"],
      ["skills", "/compact"], ["skills", "/presentation"],
      ["engine", "/engine:goal"], ["engine", "/context"], ["engine", "/model"],
      ["plugins", "/pulsatrix-flow:using-px-flow"],
      ["mcp", "/mcp__github__review_pr"],
    ]);
    expect(composerCommandMenu(sagax, engine, "p", skills).map((item) => item.label)).toEqual(["/presentation", "/pulsatrix-flow:using-px-flow"]);
    const item = composerCommandMenu(sagax, engine, "pres", skills)[0];
    expect(item?.kind === "skill" && skillCommandInsertion(item)).toBe("/presentation ");
    expect(composerMenuSection(item!)).toBe("skills");
  });

  it("matches a description only from a whole word of three letters or more, after the names", () => {
    // one letter: names that start with it, never ones that only contain it
    // or descriptions ("Set this bot up", "Show context usage")
    expect(composerCommandMenu(sagax, engine, "s").map((item) => item.label)).toEqual(["/setup"]);
    expect(composerCommandMenu(sagax, engine, "us").map((item) => item.label)).toEqual(["/pulsatrix-flow:using-px-flow"]);
    expect(composerCommandMenu(sagax, engine, "usag").map((item) => item.label)).toEqual(["/context"]);
    expect(composerCommandMenu(sagax, engine, "ntext").map((item) => item.label)).toEqual(["/context"]);
  });

  it("opens on names with colons and underscores, and inserts the label with a space", () => {
    expect(composerSlashTrigger("/pulsatrix-flow:us", 18)).toEqual({ query: "pulsatrix-flow:us", start: 0, end: 18 });
    expect(composerSlashTrigger("/mcp__git", 9)?.query).toBe("mcp__git");
    const item = composerCommandMenu(sagax, engine, "engine:goal")[0];
    expect(item?.kind === "engine" && engineCommandInsertion(item)).toBe("/engine:goal ");
  });
});

describe("group slash commands (per bot)", () => {
  const members = [
    { id: "scout", name: "Scout" },
    { id: "pixel", name: "Pixel" },
    { id: "old", name: "Old", hidden: true },
  ];
  const compact: HarnessCommand = { name: "compact", description: "Compact", group: "engine" };
  const review: HarnessCommand = { name: "review", description: "Review", group: "plugins" };

  it("opens at the start, or right after a leading mention of a member", () => {
    expect(composerGroupSlashTrigger("/co", 3, members)).toEqual({ trigger: { query: "co", start: 0, end: 3 } });
    expect(composerGroupSlashTrigger("@Pixel /co", 10, members)).toEqual({ trigger: { query: "co", start: 7, end: 10 }, botId: "pixel" });
    expect(composerGroupSlashTrigger("@Pixel /compact now", 19, members)).toBeNull();
    expect(composerGroupSlashTrigger("@Pixel/co", 9, members)).toBeNull();
    expect(composerGroupSlashTrigger("@Nobody /co", 11, members)).toBeNull();
    expect(composerGroupSlashTrigger("@Old /co", 8, members)).toBeNull();
    expect(composerGroupSlashTrigger("hi @Pixel /co", 13, members)).toBeNull();
  });

  it("lists the mentioned bot, else the lead, else every active member with a mention", () => {
    expect(groupCommandTargets({ botId: "pixel" }, members, { kind: "everyone" })).toEqual([{ bot: members[1], mention: false }]);
    expect(groupCommandTargets({}, members, { kind: "member", botId: "scout" })).toEqual([{ bot: members[0], mention: false }]);
    expect(groupCommandTargets({}, members, { kind: "auto" })).toEqual([
      { bot: members[0], mention: true },
      { bot: members[1], mention: true },
    ]);
  });

  it("groups engine commands under each bot and adds the mention a pick needs", () => {
    const goal: ComposerSlashCommand = { id: "goal", label: "/goal", description: "Goal" };
    const items = composerGroupCommandMenu([goal], [
      { bot: { id: "scout", name: "Scout" }, commands: [compact], mention: true },
      { bot: { id: "pixel", name: "Pixel" }, commands: [compact, review], mention: true },
    ], "");
    expect(items.map((item) => item.key)).toEqual([
      "sagax:goal",
      "bot:scout:engine:compact",
      "bot:pixel:engine:compact",
      "bot:pixel:engine:review",
    ]);
    expect(items.map(composerMenuSection)).toEqual(["goal", "bot:scout", "bot:pixel", "bot:pixel"]);
    const pixelCompact = items[2]!;
    if (pixelCompact.kind !== "engine") throw new Error("engine item expected");
    expect(engineCommandInsertion(pixelCompact)).toBe("@Pixel /compact ");
    const lead = composerGroupCommandMenu([], [{ bot: { id: "scout", name: "Scout" }, commands: [compact], mention: false }], "comp")[0]!;
    if (lead.kind !== "engine") throw new Error("engine item expected");
    expect(engineCommandInsertion(lead)).toBe("/compact ");
    expect(lead.bot).toEqual({ id: "scout", name: "Scout" });
  });

  it("gives every bot of a group its share of the menu", () => {
    const many = (prefix: string): HarnessCommand[] => Array.from({ length: 45 }, (_, index) => ({
      name: `${prefix}-${String(index).padStart(2, "0")}`,
      description: "",
      group: index % 2 ? "plugins" : "engine",
    }));
    const bots = ["scout", "pixel", "atlas"];
    const items = composerGroupCommandMenu([], bots.map((id) => ({
      bot: { id, name: id },
      commands: many(id),
      mention: true,
    })), "");
    const perBot = groupMenuLimitPerBot(3);
    expect(perBot).toBeGreaterThan(0);
    for (const id of bots) {
      expect(items.filter((item) => composerMenuSection(item) === `bot:${id}`)).toHaveLength(perBot);
    }
    expect(groupMenuLimitPerBot(1)).toBeGreaterThanOrEqual(45);
    expect(groupMenuLimitPerBot(40)).toBe(8);
  });
});
