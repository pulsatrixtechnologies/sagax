import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { composerCommandMenu, composerGroupCommandMenu } from "@/lib/composer-commands";
import { ComposerCommandMenu } from "./ComposerCommandMenu";

describe("ComposerCommandMenu", () => {
  it("shows the groups and argument hints; every engine row runs (#4450)", () => {
    const items = composerCommandMenu(
      [{ id: "setup", label: "/setup", description: "Set this bot up" }],
      [
        { name: "compact", description: "Free up context", group: "engine", argumentHint: "<instructions>" },
        { name: "color", description: "Prompt bar color", group: "engine", unavailable: "interactive" },
        { name: "clear", description: "Clear conversation history", group: "engine", argumentHint: "[name]", unavailable: "managed" },
        { name: "login", description: "Sign in", group: "engine", unavailable: "managed" },
        { name: "pulsatrix-flow:using-px-flow", description: "Flow entry", group: "plugins" },
        { name: "mcp__github__review_pr", description: "Review a PR", group: "mcp" },
      ],
      "",
    );
    const markup = renderToStaticMarkup(createElement(ComposerCommandMenu, {
      items, highlight: 0, loading: false, onPick: () => {}, onHighlight: () => {}, onRefresh: () => {},
    }));
    for (const text of ["Sagax", "Engine", "Plugins", "MCP", "/setup", "/compact", "&lt;instructions&gt;", "/pulsatrix-flow:using-px-flow", "/mcp__github__review_pr"]) {
      expect(markup).toContain(text);
    }
    // /clear runs the app's New chat: listed, never dimmed, said as what it does
    expect(markup).toContain("/clear");
    expect(markup).toContain("Start a new conversation with this bot");
    expect(markup).not.toContain("[name]");
    // what the chat cannot run is not listed at all
    expect(markup).not.toContain("/color");
    expect(markup).not.toContain("/login");
    expect(markup).not.toContain("Managed by");
    expect(markup).not.toContain("aria-disabled");
    expect(markup).not.toContain("opacity-55");
    expect(markup).toContain("Refresh engine commands");
  });

  it("lists the bot's own commands under Skills, between Sagax and the engine", () => {
    const items = composerCommandMenu(
      [{ id: "setup", label: "/setup", description: "Set this bot up" }],
      [{ name: "compact", description: "Free up context", group: "engine" }],
      "",
      [{ name: "presentation", description: "Give your name" }],
    );
    const markup = renderToStaticMarkup(createElement(ComposerCommandMenu, {
      items, highlight: 0, loading: false, onPick: () => {}, onHighlight: () => {},
    }));
    expect(markup.indexOf(">Sagax<")).toBeLessThan(markup.indexOf(">Skills<"));
    expect(markup.indexOf(">Skills<")).toBeLessThan(markup.indexOf("/presentation"));
    expect(markup.indexOf("/presentation")).toBeLessThan(markup.indexOf(">Engine<"));
    expect(markup).toContain("Give your name");
  });

  it("lists /goal and its subcommands under Goal, a blocked one dimmed with its reason", () => {
    const items = composerCommandMenu([
      { id: "goal", label: "/goal", description: "Keep a team working", argumentHint: "<goal>" },
      { id: "goal-status", label: "/goal status", description: "Where it stands" },
      { id: "goal-pause", label: "/goal pause", description: "Pause it", unavailableReason: "Not available yet" },
      { id: "learn", label: "/learn", description: "Write a skill" },
    ], [], "");
    const markup = renderToStaticMarkup(createElement(ComposerCommandMenu, {
      items, highlight: 0, loading: false, onPick: () => {}, onHighlight: () => {},
    }));
    expect(markup.indexOf(">Goal<")).toBeLessThan(markup.indexOf("/goal status"));
    expect(markup.indexOf("/goal status")).toBeLessThan(markup.indexOf(">Sagax<"));
    expect(markup).toContain("&lt;goal&gt;");
    expect(markup).toContain("Not available yet");
    expect(markup).not.toContain("Pause it");
    expect(markup.match(/aria-disabled="true"/g)?.length).toBe(1);
    expect(markup).toContain("Esc to close");
  });

  it("lists a group's engine commands under each bot's name", () => {
    const compact = { name: "compact", description: "Free up context", group: "engine" as const };
    const items = composerGroupCommandMenu([{ id: "goal", label: "/goal", description: "Keep a team working" }], [
      { bot: { id: "scout", name: "Scout" }, commands: [compact], mention: true },
      { bot: { id: "pixel", name: "Pixel" }, commands: [compact, { name: "review", description: "Review", group: "plugins" }], mention: true },
    ], "");
    const markup = renderToStaticMarkup(createElement(ComposerCommandMenu, {
      items, highlight: 0, loading: false, onPick: () => {}, onHighlight: () => {},
    }));
    for (const text of ["Goal", "Scout", "Pixel", "/goal", "/compact", "/review"]) expect(markup).toContain(text);
    // one heading per bot, never the engine groups
    expect(markup.match(/>Pixel</g)?.length).toBe(1);
    expect(markup).not.toContain(">Plugins<");
  });
});
