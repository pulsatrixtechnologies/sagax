import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";
import {
  GROK_KNOWN_TOOLS_MAX, GROK_KNOWN_TOOLS_SECTION, knownGrokTools, knownGrokToolsSection,
  recordGrokToolUse, resetGrokToolUsageCache, useToolName,
} from "./grok-tool-usage.ts";
import { GROK_STALL_MAX_MS, GROK_STALL_MIN_MS, GROK_TOOL_REUSE_HINT, grokAdaptiveStallMs, grokStallRetryMs } from "./grok.ts";

describe("grok tool usage", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "grok-tools-"));
    resetGrokToolUsageCache();
  });
  afterEach(() => removeTempDir(dir));

  it("reads the use_tool target and nothing else", () => {
    expect(useToolName({ tool_name: "agents__act", tool_input: { secret: "x" } })).toBe("agents__act");
    expect(useToolName({ query: "date" })).toBeNull();
    expect(useToolName({ tool_name: "no-separator" })).toBeNull();
    expect(useToolName({ tool_name: "a__b; rm -rf /" })).toBeNull();
    expect(useToolName(null)).toBeNull();
  });

  it("names the bot's most-used tools of mounted servers, alphabetically, and persists them", () => {
    for (let i = 0; i < 3; i++) recordGrokToolUse("bot-1", "sagax-environment__run_command", dir);
    recordGrokToolUse("bot-1", "agents__workspace_read", dir);
    recordGrokToolUse("bot-1", "cw_psa__query", dir);
    recordGrokToolUse("bot-2", "agents__act", dir);
    expect(knownGrokTools("bot-1", ["agents", "sagax-environment"], dir))
      .toEqual(["agents__workspace_read", "sagax-environment__run_command"]);
    resetGrokToolUsageCache();
    expect(knownGrokTools("bot-1", ["agents", "sagax-environment", "cw_psa"], dir))
      .toEqual(["agents__workspace_read", "cw_psa__query", "sagax-environment__run_command"]);
    expect(knownGrokTools("bot-2", ["agents"], dir)).toEqual(["agents__act"]);
    expect(knownGrokTools(undefined, ["agents"], dir)).toEqual([]);
    expect(readdirSync(join(dir, "grok-tool-usage"))).toHaveLength(2);
  });

  it("caps the list and keeps the most used", () => {
    for (let i = 0; i < GROK_KNOWN_TOOLS_MAX + 5; i++) {
      for (let n = 0; n <= i; n++) recordGrokToolUse("bot", `agents__tool_${String(i).padStart(2, "0")}`, dir);
    }
    const tools = knownGrokTools("bot", ["agents"], dir);
    expect(tools).toHaveLength(GROK_KNOWN_TOOLS_MAX);
    expect(tools).not.toContain("agents__tool_00");
    expect(tools).toContain(`agents__tool_${GROK_KNOWN_TOOLS_MAX + 4}`);
  });

  it("builds one context section, or none", () => {
    expect(knownGrokToolsSection([])).toBeNull();
    const section = knownGrokToolsSection(["agents__act", "cw_psa__query"]);
    expect(section?.id).toBe(GROK_KNOWN_TOOLS_SECTION);
    expect(section?.text).toContain("agents__act, cw_psa__query");
    expect(section?.text).toContain("without search_tool");
  });

  it("reads the stall retry setting, and sizes the wait to the conversation when it is unset", () => {
    expect(grokStallRetryMs(undefined, { SAGAX_GROK_STALL_RETRY_MS: "0" })).toBe(0);
    expect(grokStallRetryMs(undefined, { SAGAX_GROK_STALL_RETRY_MS: "30000" })).toBe(30_000);
    expect(grokStallRetryMs({ contextTokens: 150_000, promptChars: 0 }, { SAGAX_GROK_STALL_RETRY_MS: "20000" })).toBe(20_000);
    // unset or invalid: adaptive
    expect(grokStallRetryMs(undefined, {})).toBe(GROK_STALL_MIN_MS);
    expect(grokStallRetryMs({ contextTokens: 112_000, promptChars: 0 }, { SAGAX_GROK_STALL_RETRY_MS: "nope" })).toBe(21_040);
  });

  it("waits 10 s for a short conversation and up to 30 s for a long uncached one", () => {
    // a new session: Grok's own ~13k plus a 36k-character first prompt
    expect(grokAdaptiveStallMs({ contextTokens: null, promptChars: 36_000 })).toBe(10_240);
    expect(grokAdaptiveStallMs({ contextTokens: 17_000, promptChars: 1_600 })).toBe(10_000);
    // the measured slow-but-healthy prefills (94k, 112k, 173k) stay under the wait
    expect(grokAdaptiveStallMs({ contextTokens: 94_566, promptChars: 7_307 })).toBeGreaterThan(8_700);
    expect(grokAdaptiveStallMs({ contextTokens: 112_605, promptChars: 8_089 })).toBeGreaterThan(19_800);
    expect(grokAdaptiveStallMs({ contextTokens: 173_260, promptChars: 51_760 })).toBeGreaterThan(18_300);
    expect(grokAdaptiveStallMs({ contextTokens: 900_000, promptChars: 0 })).toBe(GROK_STALL_MAX_MS);
  });
});

describe("grok use_tool argument form", () => {
  // Prod 2026-11-02: the bot wrote its arguments to /tmp and /workspace with
  // sagax-environment write_file, then called use_tool with `file` and
  // `tool_input_file`. Grok reads those on the Sagax server's disk, so each
  // call failed "Cannot read complete MCP source file: ... No such file".
  it("the standing hint asks for inline tool_input and rules out the file forms", () => {
    expect(GROK_TOOL_REUSE_HINT).toMatch(/inline tool_input/);
    expect(GROK_TOOL_REUSE_HINT).toMatch(/Never use its file or tool_input_file forms/);
    expect(GROK_TOOL_REUSE_HINT).toMatch(/not your environment/);
    // the reuse guidance it already carried is still there
    expect(GROK_TOOL_REUSE_HINT).toMatch(/call it again directly with use_tool/);
  });

  // #2604: search_tool called through use_tool, refused 3 to 4 times per routine run.
  it("the standing hint says search_tool is never a use_tool target and a failing call is not repeated", () => {
    expect(GROK_TOOL_REUSE_HINT).toMatch(/call search_tool directly as its own tool call, never as use_tool's tool_name/);
    expect(GROK_TOOL_REUSE_HINT).toMatch(/use_tool only takes an MCP tool named <server>__<tool>/);
    expect(GROK_TOOL_REUSE_HINT).toMatch(/never repeat the same failing call/);
  });
});

// QA 0.8.67 G8: routine runs still ended with "use_tool failed, search_tool is a native tool".
describe("grok native search_tool in routines", () => {
  it("the standing hint covers routines and the native-tool refusal", () => {
    expect(GROK_TOOL_REUSE_HINT).toMatch(/This holds in routines too/);
    expect(GROK_TOOL_REUSE_HINT).toMatch(/search_tool is never wrapped in use_tool/);
    expect(GROK_TOOL_REUSE_HINT).toMatch(/"is a native tool", call that tool directly by its own name next/);
  });
});
