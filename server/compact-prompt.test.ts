import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPACT_VOLATILE_LAST,
  COMPACT_VOLATILE_SECTIONS,
  KNOWN_USE_CALLS,
  adoptLegacyAutoMemory,
  claudeProjectKey,
  compactMemoryDir,
  compactPins,
  compactVolatileOrder,
  legacyClaudeAutoMemoryDir,
  parseLocalPromptMode,
  toolUsage,
  usesCompactPrompt,
  usesStablePrompt,
} from "./compact-prompt.ts";
import { availableTools, catalogProfileFromEnv, compactListed, compactToolsFromEnv } from "./drivers/agents-catalog.ts";
import { parseGateSearch, searchedCatalog } from "./mcp/mcp-gate-search.ts";
import { searchedToolCall } from "../shared/searched-tool-call.ts";
import { workspaceCwdPrompt, workspaceLocationsPrompt } from "./workspace/workspace.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("usesCompactPrompt (#1276)", () => {
  it("compacts Claude Code on every model, and keeps the full tool list elsewhere", () => {
    expect(usesCompactPrompt({ driverKind: "claudeAgent", model: "omlx::local-35b" })).toBe(true);
    expect(usesCompactPrompt({ driverKind: "claudeAgent", model: "claude-sonnet-5" })).toBe(true);
    expect(usesCompactPrompt({ driverKind: "claudeAgent", model: null })).toBe(true);
    expect(usesCompactPrompt({ driverKind: "codex", model: "omlx::local-35b" })).toBe(false);
    expect(usesCompactPrompt({ driverKind: "grok", model: "grok-4.7" })).toBe(false);
    expect(usesCompactPrompt({ driverKind: "pi", model: "pi" })).toBe(false);
  });

  it("stabilizes the prefix for every engine", () => {
    expect(usesStablePrompt({})).toBe(true);
    expect(usesStablePrompt({ bot: "compact" })).toBe(true);
    expect(usesStablePrompt({ bot: "full" })).toBe(false);
    expect(usesStablePrompt({ engine: "full" })).toBe(false);
  });

  it("goes back to the whole prompt when the bot or the server says full", () => {
    expect(usesCompactPrompt({ driverKind: "claudeAgent", model: "claude-sonnet-5", bot: "full" })).toBe(false);
    expect(usesCompactPrompt({ driverKind: "claudeAgent", model: "omlx::local-35b", engine: "full" })).toBe(false);
    expect(usesCompactPrompt({ driverKind: "claudeAgent", model: "omlx::local-35b", bot: "compact" })).toBe(true);
    expect(parseLocalPromptMode("full")).toBe("full");
    expect(parseLocalPromptMode("anything")).toBeUndefined();
  });
});

describe("compact pins", () => {
  it("counts real tools only, never the directory tools", () => {
    const usage = toolUsage([
      { name: "mcp__px__get_ticket" },
      { name: "mcp__px__get_ticket" },
      { name: "mcp__px__search_tools" },
      { name: "mcp__px__call_tool" },
      { name: "Bash" },
    ]);
    expect([...usage.get("px")!]).toEqual([["get_ticket", 2]]);
  });

  it("gives the same bytes for the same use, whatever the order of the calls", () => {
    const a = compactPins(toolUsage([{ name: "mcp__px__b" }, { name: "mcp__px__a" }, { name: "mcp__px__a" }]), ["px"]);
    const b = compactPins(toolUsage([{ name: "mcp__px__a" }, { name: "mcp__px__a" }, { name: "mcp__px__b" }]), ["px"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.pinned.px).toEqual(["a", "b"]);
  });

  it("keeps a bot with little Sagax tool use on the default list", () => {
    const few = Array.from({ length: KNOWN_USE_CALLS - 1 }, () => ({ name: "mcp__agents__ask_bot" }));
    expect(compactPins(toolUsage(few), []).agents.core).toBe("default");
    const enough = [...few, { name: "mcp__agents__ask_bot" }];
    expect(compactPins(toolUsage(enough), []).agents.core).toBe("used");
  });

  it("keeps one memory folder per bot and person, the same in every conversation", () => {
    expect(compactMemoryDir("/data", "bot-1", "Alice@Example.test")).toBe(compactMemoryDir("/data", "bot-1", "alice@example.test"));
    expect(compactMemoryDir("/data", "bot-1", "alice@example.test")).not.toBe(compactMemoryDir("/data", "bot-1", "bob@example.test"));
    expect(compactMemoryDir("/data", "bot-1", "alice@example.test")).not.toBe(compactMemoryDir("/data", "bot-2", "alice@example.test"));
  });

  it("copies the auto memory a thread already had into the compact folder", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-compact-memory-"));
    dirs.push(root);
    const cwd = "/Users/a/bot_work";
    expect(claudeProjectKey(cwd)).toBe("-Users-a-bot-work");
    const legacy = legacyClaudeAutoMemoryDir(join(root, "claude"), cwd);
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "MEMORY.md"), "the old note\n");
    writeFileSync(join(legacy, "topic.md"), "kept\n");
    symlinkSync(join(legacy, "MEMORY.md"), join(legacy, "link.md"));
    const compact = compactMemoryDir(root, "bot-1", "ada@example.test");
    expect(adoptLegacyAutoMemory(compact, legacy).sort()).toEqual(["MEMORY.md", "topic.md"]);
    expect(readFileSync(join(compact, "MEMORY.md"), "utf8")).toBe("the old note\n");
    writeFileSync(join(compact, "MEMORY.md"), "the compact note\n");
    writeFileSync(join(legacy, "later.md"), "added\n");
    expect(adoptLegacyAutoMemory(compact, legacy).sort()).toEqual(["later.md"]);
    expect(readFileSync(join(compact, "MEMORY.md"), "utf8")).toBe("the compact note\n");
    expect(readFileSync(join(compact, "later.md"), "utf8")).toBe("added\n");
  });
});

describe("compact volatile half", () => {
  it("puts what differs between conversations last and drops nothing", () => {
    const sections = [
      { id: "files-cwd", text: "\n\ncwd" },
      { id: "model", text: "\n\nmodel" },
      { id: "recent", text: "\n\nrecent" },
      { id: "workplace", text: "\n\nworkplace" },
    ];
    const ordered = compactVolatileOrder({ volatile: sections.map((s) => s.text).join(""), volatileSections: sections, extra: 1 });
    expect(ordered.volatileSections.map((s) => s.id)).toEqual(["model", "workplace", "recent", "files-cwd"]);
    expect(ordered.volatile).toBe("\n\nmodel\n\nworkplace\n\nrecent\n\ncwd");
    expect(ordered.volatile.length).toBe(sections.map((s) => s.text).join("").length);
    expect(ordered.extra).toBe(1);
    expect(COMPACT_VOLATILE_LAST.at(-1)).toBe("files-cwd");
    expect(COMPACT_VOLATILE_SECTIONS.has("files-cwd")).toBe(true);
  });

  it("keeps every file location rule in a text that is the same for every conversation", () => {
    const one = workspaceLocationsPrompt("bot-1", "/w/bot-1/thread-a", undefined, { relativePaths: true, attachFile: true, cwdElsewhere: true });
    const two = workspaceLocationsPrompt("bot-1", "/w/bot-1/thread-b", undefined, { relativePaths: true, attachFile: true, cwdElsewhere: true });
    expect(one).toBe(two);
    expect(one).not.toContain("thread-a");
    const whole = workspaceLocationsPrompt("bot-1", "/w/bot-1/thread-a", undefined, { relativePaths: true, attachFile: true });
    // the same rules, only the folder's value moved to its own line
    expect(one.slice(one.indexOf("Each conversation"))).toBe(whole.slice(whole.indexOf("Each conversation")));
    expect(workspaceCwdPrompt("/w/bot-1/thread-a")).toContain("/w/bot-1/thread-a");
    expect(workspaceCwdPrompt(undefined)).toBe("");
  });
});

describe("every tool stays reachable", () => {
  it("lists or searches every agents tool, for a new bot and a known one", () => {
    const profile = catalogProfileFromEnv({});
    const tools = availableTools(profile);
    for (const core of ["default", "used"] as const) {
      const listed = tools.filter((tool) => compactListed(tool.name, { core, pinned: new Set(), coordinating: profile.coordinating }));
      const searched = tools.filter((tool) => !compactListed(tool.name, { core, pinned: new Set(), coordinating: profile.coordinating }));
      expect(listed.length + searched.length).toBe(tools.length);
      expect(new Set([...listed, ...searched].map((tool) => tool.name)).size).toBe(tools.length);
    }
  });

  it("lists the bot's own most used tools whole", () => {
    const profile = catalogProfileFromEnv({});
    const rare = availableTools(profile).find((tool) => !compactListed(tool.name, { core: "used", pinned: new Set(), coordinating: false }));
    expect(rare).toBeDefined();
    expect(compactListed(rare!.name, { core: "used", pinned: new Set([rare!.name]), coordinating: false })).toBe(true);
  });

  it("reads the compact setting, and an unreadable one falls back to the full default list", () => {
    expect(compactToolsFromEnv({})).toBeUndefined();
    expect(compactToolsFromEnv({ SAGAX_COMPACT_TOOLS: "{bad" })?.core).toBe("default");
    expect([...compactToolsFromEnv({ SAGAX_COMPACT_TOOLS: JSON.stringify({ core: "used", pinned: ["ask_bot"] }) })!.pinned]).toEqual(["ask_bot"]);
  });

  it("reads a call_tool on a searched server as the tool it runs, for approvals and activity", () => {
    const searched = new Set(["px"]);
    expect(searchedToolCall("mcp__px__call_tool", { name: "update_ticket", arguments: { id: 1 } }, searched))
      .toEqual({ name: "mcp__px__update_ticket", input: { id: 1 }, searched: true });
    // another server, or no tool named: unchanged
    expect(searchedToolCall("mcp__other__call_tool", { name: "x" }, searched).searched).toBe(false);
    expect(searchedToolCall("mcp__px__call_tool", {}, searched).searched).toBe(false);
  });

  it("searches only a big catalog, and an unreadable gate setting stops the gate", () => {
    const fail = (message: string): never => { throw new Error(message); };
    const search = parseGateSearch(JSON.stringify({ pinned: ["b", "a"] }), fail)!;
    expect(search.pinned).toEqual(["a", "b"]);
    const tool = (name: string) => ({ name, description: "d", inputSchema: { type: "object" } });
    expect(searchedCatalog([tool("a"), tool("b")], search)).toBe(false);
    expect(searchedCatalog(Array.from({ length: search.maxTools + 1 }, (_, i) => tool(`t${i}`)), search)).toBe(true);
    expect(() => parseGateSearch("{bad", fail)).toThrow();
  });
});

describe("usesCompactPrompt on pi (#1276)", () => {
  it("is on for a pi model of a local host only", () => {
    expect(usesCompactPrompt({ driverKind: "piAgent", model: "omlx/Some-Model" })).toBe(true);
    expect(usesCompactPrompt({ driverKind: "piAgent", model: "anthropic/claude-sonnet-5" })).toBe(false);
    expect(usesCompactPrompt({ driverKind: "piAgent", model: "omlx/Some-Model", bot: "full" })).toBe(false);
  });
});
