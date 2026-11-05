// Rare agents tools wait for tool search on Claude Code (2026-10-19 perf
// parity): the proxy marks them `_meta["anthropic/alwaysLoad"] = false` only
// when the Claude driver asks (SAGAX_DEFER_RARE_TOOLS=1). Every other engine
// gets the catalog exactly as before (#1374: find_tool and use_tool only on
// request, on a compact prompt).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { childEnv } from "../testing/omb-env.ts";
import { waitForExit } from "../testing/cleanup.ts";
import { availableTools, catalogProfileFromEnv, COMPACT_CORE_AGENT_TOOL_NAMES, DEFERRED_AGENT_TOOL_NAMES, withCompactNativeDeferral, withDeferredRareTools } from "./agents-catalog.ts";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "agents-proxy.ts");
const EVERYTHING = {
  SAGAX_BOT_ID: "bot-a", SAGAX_CHIEF_OF_STAFF: "1", SAGAX_AGENT_API: "1", SAGAX_CLAIMS: "1", SAGAX_PERSPICAX_TOOLS: "1",
  SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1", SAGAX_MEETINGS: "1",
  SAGAX_ROUTE_MESSAGES: "1", SAGAX_SINGLE_STREAM: "1", SAGAX_GROUP_MEMORY: "1", SAGAX_MEMORY_ENABLED: "1",
  SAGAX_PHONE_TOOLS: "location,status",
};

/** The tools at the heart of a chat turn: never behind a search step. */
const ALWAYS_LOADED = [
  "list_bots", "ask_bot", "coordinate_bots", "send_to_bot", "route_message", "list_room_targets",
  "delegate_bot", "check_delegation", "wait_delegation",
  "react_to_message", "show_widget", "update_widget", "check_widget", "attach_file", "select_computer", "request_credential",
  "memory_update", "memory_log", "session_search", "tool_result_read", "answer_approval", "act",
  // #1989: every bot that owns a routine can list and check/run without ToolSearch
  "list_routines", "run_routine",
];

async function listTools(env: Record<string, string>): Promise<Array<{ name: string; _meta?: Record<string, unknown> }>> {
  const child = spawn(process.execPath, [PROXY], { env: { ...childEnv(), SAGAX_HARNESS_URL: "http://127.0.0.1:9", SAGAX_COMMS_TOKEN: "t", ...env, SAGAX_CATALOG_BRIDGE: "0" }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const reply = await new Promise<any>((resolve, reject) => {
      let buf = "";
      child.stdout!.on("data", (chunk) => {
        buf += chunk;
        const line = buf.split("\n").slice(0, -1).find((entry) => entry.includes('"id":7'));
        if (line) resolve(JSON.parse(line));
      });
      child.on("error", reject);
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n");
    });
    return reply.result.tools;
  } finally {
    child.stdin!.end();
    await waitForExit(child, { signal: "SIGTERM" });
  }
}

describe("deferred rare agents tools", () => {
  it("names only real tools and never a core chat tool", () => {
    const every = new Set([
      ...availableTools(catalogProfileFromEnv(EVERYTHING)).map((tool) => tool.name),
      ...availableTools(catalogProfileFromEnv({ ...EVERYTHING, SAGAX_ROOM_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1" })).map((tool) => tool.name),
    ]);
    for (const name of DEFERRED_AGENT_TOOL_NAMES) expect(every, name).toContain(name);
    for (const name of ALWAYS_LOADED) expect(DEFERRED_AGENT_TOOL_NAMES.has(name), name).toBe(false);
  });

  it("marks the rare tools and leaves every tool's own fields unchanged", () => {
    const tools = availableTools(catalogProfileFromEnv(EVERYTHING));
    const marked = withDeferredRareTools(tools, { coordinating: false });
    expect(marked.map(({ _meta, ...tool }) => tool)).toEqual(tools);
    for (const tool of marked) {
      expect(tool._meta?.["anthropic/alwaysLoad"]).toBe(DEFERRED_AGENT_TOOL_NAMES.has(tool.name) ? false : undefined);
    }
  });

  it("defers start_thread only in a coordinating turn, and keeps a tool's own _meta", () => {
    const start = { name: "start_thread", _meta: { "x/keep": 1 } };
    expect(withDeferredRareTools([start], { coordinating: false })[0]).toEqual(start);
    expect(withDeferredRareTools([start], { coordinating: true })[0]!._meta).toEqual({ "x/keep": 1, "anthropic/alwaysLoad": false });
  });

  it("serves the marker only when the Claude driver asks for it", async () => {
    const plain = await listTools(EVERYTHING);
    expect(plain.some((tool) => tool._meta !== undefined)).toBe(false);
    const claude = await listTools({ ...EVERYTHING, SAGAX_DEFER_RARE_TOOLS: "1" });
    expect(claude.map((tool) => tool.name)).toEqual(plain.map((tool) => tool.name));
    expect(claude.find((tool) => tool.name === "propose_routine")?._meta).toEqual({ "anthropic/alwaysLoad": false });
    expect(claude.find((tool) => tool.name === "coordinate_bots" || tool.name === "ask_bot")?._meta).toBeUndefined();
  }, 30_000);

  // #1989: tool availability rules per bot — list/run stay always loaded so a
  // Claude turn (deferred rare tools + merged families) still offers them by
  // name; propose stays deferred behind ToolSearch.
  it("keeps list_routines and run_routine always loaded for every bot (#1989)", async () => {
    const claude = await listTools({ ...EVERYTHING, SAGAX_DEFER_RARE_TOOLS: "1", SAGAX_MERGED_TOOLS: "1" });
    const names = claude.map((tool) => tool.name);
    expect(names).toContain("list_routines");
    expect(names).toContain("run_routine");
    expect(names).toContain("routines");
    expect(claude.find((tool) => tool.name === "list_routines")?._meta?.["anthropic/alwaysLoad"]).toBeUndefined();
    expect(claude.find((tool) => tool.name === "run_routine")?._meta?.["anthropic/alwaysLoad"]).toBeUndefined();
    expect(claude.find((tool) => tool.name === "routines")?._meta).toEqual({ "anthropic/alwaysLoad": false });
    expect(claude.find((tool) => tool.name === "list_routines" || tool.name === "run_routine")).toBeDefined();
  }, 30_000);

  // #2037: a compact Claude turn used to list the core and the pins whole and
  // hide every other tool behind search_tools / call_tool (two round trips a
  // call, names invisible). With ToolSearch the rest is listed by name and
  // deferred to it: a bot with no recorded use dropped from 34k to 18k
  // tokens of context floor (haiku, agents server alone), and every tool is
  // called by its own name.
  it("#2037: a compact Claude turn lists every tool by name and loads only the core and the pins up front", async () => {
    const plain = await listTools(EVERYTHING);
    const compact = await listTools({ ...EVERYTHING, SAGAX_COMPACT_TOOLS: JSON.stringify({ core: "default", pinned: ["propose_routine"] }), SAGAX_DEFER_RARE_TOOLS: "1" });
    const names = compact.map((tool) => tool.name);
    expect([...names].sort()).toEqual(plain.map((tool) => tool.name).sort());
    expect(names).not.toContain("search_tools");
    expect(names).not.toContain("call_tool");
    const loaded = compact.filter((tool) => tool._meta?.["anthropic/alwaysLoad"] !== false).map((tool) => tool.name);
    for (const name of ALWAYS_LOADED) if (names.includes(name)) expect(loaded).toContain(name);
    expect(loaded).toContain("propose_routine");
    expect(loaded).toContain("shared_computer");
    expect(loaded).not.toContain("update_agent_settings");
    expect(loaded).not.toContain("propose_team_setup");
    expect(loaded).not.toContain("start_thread");
    expect(loaded.every((name) => COMPACT_CORE_AGENT_TOOL_NAMES.has(name) || name === "propose_routine" || name === "shared_computer")).toBe(true);
    expect(compact.find((tool) => tool.name === "update_agent_settings")?._meta).toEqual({ "anthropic/alwaysLoad": false });
    // the bot's recorded use does not narrow the names: core "used" lists the same set
    const used = await listTools({ ...EVERYTHING, SAGAX_COMPACT_TOOLS: JSON.stringify({ core: "used", pinned: [] }), SAGAX_DEFER_RARE_TOOLS: "1" });
    expect(used.map((tool) => tool.name).sort()).toEqual([...names].sort());
    // an engine without ToolSearch keeps the directory pair and no marker
    const other = await listTools({ ...EVERYTHING, SAGAX_COMPACT_TOOLS: JSON.stringify({ core: "used", pinned: [] }) });
    expect(other.map((tool) => tool.name)).toContain("search_tools");
    expect(other.some((tool) => tool._meta !== undefined)).toBe(false);
  }, 60_000);

  it("withCompactNativeDeferral keeps a tool's own fields and marks all but the core, the pins and shared_computer", () => {
    const tools = [{ name: "ask_bot", description: "a" }, { name: "shared_computer", description: "s" }, { name: "update_agent_settings", description: "u", _meta: { kept: true } }, { name: "propose_routine", description: "p" }];
    const out = withCompactNativeDeferral(tools, { pinned: new Set(["propose_routine"]), coordinating: true });
    expect(out.map((tool) => tool._meta)).toEqual([undefined, undefined, { kept: true, "anthropic/alwaysLoad": false }, undefined]);
    expect(out.map((tool) => tool.description)).toEqual(["a", "s", "u", "p"]);
  });
});
