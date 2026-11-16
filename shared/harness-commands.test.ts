import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  claudeInitializeCommands,
  engineCommandLabel,
  groupCommandTarget,
  harnessCommandAppAction,
  leadingMention,
  normalizeClaudeCommands,
  normalizeCodexSkills,
  parseTypedCommand,
  resolveTypedCommand,
  typedCommandAppAction,
} from "./harness-commands.ts";

// A trimmed answer of the real Claude Code CLI (2.1.287) to the stream-json
// control request `initialize`, plus a project command and an MCP prompt.
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "claude-initialize-commands.json"), "utf8"));

describe("claudeInitializeCommands", () => {
  const commands = claudeInitializeCommands(fixture, "sagax-commands") ?? [];
  const byName = (name: string) => commands.find((command) => command.name === name);

  it("reads every listed command but the hidden ones", () => {
    expect(commands.map((command) => command.name)).not.toContain("__remote-workflow");
    expect(commands).toHaveLength(15);
  });

  it("groups built-ins, plugin commands and MCP prompts", () => {
    expect(byName("compact")).toMatchObject({ group: "engine", argumentHint: "<optional custom summarization instructions>" });
    expect(byName("deploy-notes")).toMatchObject({ group: "engine", argumentHint: "<version>" });
    expect(byName("pulsatrix-flow:using-px-flow")).toMatchObject({ group: "plugins", aliases: ["using-px-flow"] });
    expect(byName("superpowers:brainstorming")?.group).toBe("plugins");
    expect(byName("mcp__github__review_pr")).toMatchObject({ group: "mcp", argumentHint: "<pr>" });
    expect(byName("context")?.argumentHint).toBeUndefined();
  });

  it("marks what the chat cannot run, and why", () => {
    expect(byName("color")?.unavailable).toBe("interactive");
    expect(byName("model")?.unavailable).toBe("managed");
    expect(byName("clear")?.unavailable).toBe("managed");
    expect(byName("compact")?.unavailable).toBeUndefined();
    expect(byName("context")?.unavailable).toBeUndefined();
  });

  it("follows the live session's terminal-only list", () => {
    const listed = normalizeClaudeCommands(["context", { name: "focus" }, "custom-thing"], { terminal: ["custom-thing"] });
    expect(listed.map((command) => [command.name, command.unavailable ?? null])).toEqual([
      ["context", null], ["focus", "interactive"], ["custom-thing", "interactive"],
    ]);
  });

  it("ignores another request's answer, and an error answers nothing", () => {
    expect(claudeInitializeCommands(fixture, "other")).toBeNull();
    expect(claudeInitializeCommands({ type: "control_response", response: { subtype: "error", request_id: "x", error: "no" } }, "x")).toEqual([]);
    expect(claudeInitializeCommands({ type: "system" }, "x")).toBeNull();
  });

  it("drops malformed names and control characters", () => {
    const listed = normalizeClaudeCommands([{ name: "bad name" }, { name: "" }, { name: "ok", description: "line\none\u0007" }, 7, null]);
    expect(listed).toEqual([{ name: "ok", description: "line one", group: "engine" }]);
  });
});

describe("normalizeCodexSkills", () => {
  it("lists enabled skills with their file, a plugin's under Plugins", () => {
    const result = { data: [{ cwd: "/w", errors: [], skills: [
      { name: "release-notes", description: "Write release notes", path: "/w/.agents/skills/release-notes/SKILL.md", scope: "repo", enabled: true, pluginId: null },
      { name: "px-flow", description: "long", interface: { shortDescription: "Flow" }, path: "/p/SKILL.md", scope: "user", enabled: true, pluginId: "pulsatrix-flow" },
      { name: "off", description: "x", path: "/o/SKILL.md", scope: "user", enabled: false, pluginId: null },
      { name: "release-notes", description: "duplicate", path: "/dup", scope: "user", enabled: true, pluginId: null },
    ] }] };
    expect(normalizeCodexSkills(result)).toEqual([
      { name: "release-notes", description: "Write release notes", group: "engine", path: "/w/.agents/skills/release-notes/SKILL.md" },
      { name: "px-flow", description: "Flow", group: "plugins", path: "/p/SKILL.md" },
    ]);
    expect(normalizeCodexSkills(null)).toEqual([]);
  });
});

describe("resolveTypedCommand", () => {
  const commands = claudeInitializeCommands(fixture, "sagax-commands") ?? [];

  it("parses the command at the very start only", () => {
    expect(parseTypedCommand("/compact keep the plan")).toEqual({ name: "compact", args: "keep the plan" });
    expect(parseTypedCommand("  /context ")).toEqual({ name: "context", args: "" });
    expect(parseTypedCommand("see /context")).toBeNull();
    expect(parseTypedCommand("/ nothing")).toBeNull();
  });

  it("passes an engine command through verbatim", () => {
    expect(resolveTypedCommand("/compact keep the plan", commands)).toMatchObject({ kind: "engine", engineText: "/compact keep the plan" });
    expect(resolveTypedCommand("/pulsatrix-flow:using-px-flow billet 123", commands)).toMatchObject({
      kind: "engine", engineText: "/pulsatrix-flow:using-px-flow billet 123",
    });
    expect(resolveTypedCommand("/mcp__github__review_pr 42", commands)).toMatchObject({ kind: "engine", engineText: "/mcp__github__review_pr 42" });
    // an alias is the engine's to resolve
    expect(resolveTypedCommand("/review 12", commands)).toMatchObject({ kind: "engine", engineText: "/review 12" });
  });

  it("lets Sagax win a collision and reaches the engine's as /engine:<name>", () => {
    expect(resolveTypedCommand("/goal ship it", commands)).toEqual({ kind: "sagax", name: "goal" });
    expect(resolveTypedCommand("/setup", commands)).toEqual({ kind: "sagax", name: "setup" });
    expect(resolveTypedCommand("/engine:goal ship it", commands)).toMatchObject({ kind: "engine", engineText: "/goal ship it" });
    expect(engineCommandLabel({ name: "goal" })).toBe("/engine:goal");
    expect(engineCommandLabel({ name: "compact" })).toBe("/compact");
  });

  it("refuses what the chat cannot run and leaves anything else alone", () => {
    expect(resolveTypedCommand("/model opus", commands)).toMatchObject({ kind: "unavailable", reason: "managed" });
    expect(resolveTypedCommand("/color red", commands)).toMatchObject({ kind: "unavailable", reason: "interactive" });
    expect(resolveTypedCommand("/usr/bin is a path", commands)).toEqual({ kind: "none" });
    expect(resolveTypedCommand("/unknown thing", commands)).toEqual({ kind: "none" });
    expect(resolveTypedCommand("hello", commands)).toEqual({ kind: "none" });
  });
});

describe("a command the app manages (#4450)", () => {
  const commands = claudeInitializeCommands(fixture, "sagax-commands") ?? [];
  const byName = (name: string) => commands.find((command) => command.name === name)!;

  it("runs the app's own action, or is not listed", () => {
    expect(harnessCommandAppAction(byName("clear"))).toBe("newChat");
    expect(harnessCommandAppAction(byName("model"))).toBe("model");
    expect(harnessCommandAppAction(byName("compact"))).toBeNull();
    expect(harnessCommandAppAction(byName("color"))).toBeNull();
    expect(harnessCommandAppAction({ name: "login", unavailable: "managed" })).toBeNull();
    // a name the engine runs itself is never taken over
    expect(harnessCommandAppAction({ name: "clear" })).toBeNull();
  });

  it("answers a typed /clear, with or without the engine's list", () => {
    expect(typedCommandAppAction("/clear", commands)).toBe("newChat");
    expect(typedCommandAppAction("  /clear  ", commands)).toBe("newChat");
    expect(typedCommandAppAction("/engine:clear", commands)).toBe("newChat");
    expect(typedCommandAppAction("/model opus", commands)).toBe("model");
    expect(typedCommandAppAction("/clear", [])).toBe("newChat");
    expect(typedCommandAppAction("/compact", commands)).toBeNull();
    expect(typedCommandAppAction("/login", [])).toBeNull();
    expect(typedCommandAppAction("clear the board", commands)).toBeNull();
    expect(typedCommandAppAction("/goal clear", commands)).toBeNull();
    // an engine that does not manage it (Codex lists only its skills)
    expect(typedCommandAppAction("/clear", [{ name: "review", description: "", group: "engine" }])).toBeNull();
  });
});

describe("a group's command", () => {
  const members = [
    { id: "scout", name: "Scout" },
    { id: "scout2", name: "Scout 2" },
    { id: "pixel", name: "Pixel" },
    { id: "old", name: "Old", hidden: true },
  ];

  it("finds the leading mention, longest name first", () => {
    expect(leadingMention("@Scout /compact", members)).toEqual({ member: members[0], rest: 7 });
    expect(leadingMention("  @scout 2 /x", members)?.member.id).toBe("scout2");
    expect(leadingMention("@Scouting /x", members)).toBeNull();
    expect(leadingMention("hi @Scout /x", members)).toBeNull();
    expect(leadingMention("@Old /x", members)).toBeNull();
  });

  it("sends a command to the bot the message starts by naming, else the lead", () => {
    const everyone = { kind: "everyone" };
    expect(groupCommandTarget("@Pixel /compact keep the plan", members, everyone))
      .toEqual({ botId: "pixel", commandText: "/compact keep the plan", mentioned: true });
    // a mention in its arguments does not add a responder
    expect(groupCommandTarget("@Pixel /review ask @Scout", members, everyone)?.botId).toBe("pixel");
    expect(groupCommandTarget("/compact", members, { kind: "member", botId: "scout" }))
      .toEqual({ botId: "scout", commandText: "/compact", mentioned: false });
    // no single bot: everyone, Auto, mentions only, or a lead that left
    for (const responder of [everyone, { kind: "auto" }, { kind: "mentions" }, { kind: "member", botId: "gone" }]) {
      expect(groupCommandTarget("/compact", members, responder)).toBeNull();
    }
  });

  it("is never a Sagax command, an ordinary line, or a mention alone", () => {
    const lead = { kind: "member", botId: "scout" };
    expect(groupCommandTarget("/goal ship it", members, lead)).toBeNull();
    expect(groupCommandTarget("@Pixel /learn this", members, lead)).toBeNull();
    expect(groupCommandTarget("@Pixel /engine:goal ship", members, lead)?.commandText).toBe("/engine:goal ship");
    expect(groupCommandTarget("hello /compact", members, lead)).toBeNull();
    expect(groupCommandTarget("@Pixel", members, lead)).toBeNull();
    expect(groupCommandTarget("@Pixel/compact", members, lead)).toBeNull();
    expect(groupCommandTarget("@Pixel please /compact", members, lead)).toBeNull();
    expect(groupCommandTarget("@everyone /compact", members, lead)).toBeNull();
  });
});
