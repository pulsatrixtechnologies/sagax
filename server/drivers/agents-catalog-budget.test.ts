// #1703: catalog budget strategy. Groups keep every tool reachable; the
// margin rows document headroom to the measured provider limits.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_GROUPS,
  AGENTS_CATALOG_BYTES_SOFT_CEILING,
  AGENTS_CATALOG_TOOL_COUNT_LIMIT,
  applyCatalogGroups,
  catalogGroupListed,
  catalogGroupsOn,
  catalogMargin,
  formatCatalogMargin,
  listOfferedToolGroups,
  loadOfferedToolGroup,
  routeGroupCall,
  ungroupedOfferedTools,
  LIST_TOOL_GROUPS,
  LOAD_TOOL_GROUP,
} from "./agents-catalog-budget.ts";
import { availableTools, catalogProfileFromEnv, COMPACT_CORE_AGENT_TOOL_NAMES, DEFERRED_AGENT_TOOL_NAMES } from "./agents-catalog.ts";
import { resolveCatalogUse } from "./catalog-bridge.ts";
import { BRIDGE_USE_TOOL } from "../../shared/searched-tool-call.ts";
import { DEFAULT_TOOL_LIMIT } from "./chat-mcp-tools.ts";
import { childEnv } from "../testing/omb-env.ts";
import { waitForExit } from "../testing/cleanup.ts";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "agents-proxy.ts");

const wireBytes = (tools: readonly unknown[]) => Buffer.byteLength(JSON.stringify({ tools }), "utf8");

const EVERYTHING = {
  SAGAX_BOT_ID: "bot-a",
  SAGAX_CHIEF_OF_STAFF: "1",
  SAGAX_AGENT_API: "1",
  SAGAX_CLAIMS: "1",
  SAGAX_PERSPICAX_TOOLS: "1",
  SAGAX_SKILL_AUTHORING_ENABLED: "1",
  SAGAX_SHARED_COMPUTERS_ENABLED: "1",
  SAGAX_VOICE_NOTES: "1",
  SAGAX_MEETINGS: "1",
  SAGAX_ROUTE_MESSAGES: "1",
  SAGAX_SINGLE_STREAM: "1",
  SAGAX_GROUP_MEMORY: "1",
  SAGAX_MEMORY_ENABLED: "1",
  SAGAX_PHONE_TOOLS: "location,status",
  SAGAX_WEB_SEARCH: "1",
  SAGAX_VAULT_HTTP: "1",
  SAGAX_GITHUB_CONNECT: "1",
};

const GROUPS_ON = { SAGAX_CATALOG_GROUPS: "1" };

describe("agents catalog budget strategy (#1703)", () => {
  it("matches the measured chat-completions tool count limit", () => {
    expect(AGENTS_CATALOG_TOOL_COUNT_LIMIT).toBe(DEFAULT_TOOL_LIMIT);
    expect(AGENTS_CATALOG_TOOL_COUNT_LIMIT).toBe(128);
    expect(AGENTS_CATALOG_BYTES_SOFT_CEILING).toBe(150_000);
  });

  it("puts every non-core offered tool in exactly one group", () => {
    const profiles = [
      catalogProfileFromEnv(EVERYTHING),
      catalogProfileFromEnv({ ...EVERYTHING, SAGAX_ROOM_TURN: "1", SAGAX_GROUP_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1" }),
      catalogProfileFromEnv({ ...EVERYTHING, SAGAX_CHIEF_OF_STAFF: "0", SAGAX_CREATE_BOTS: "1" }),
      catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", SAGAX_EXTERNAL_RUNTIME: "1" }),
    ];
    for (const profile of profiles) {
      const tools = availableTools(profile);
      expect(ungroupedOfferedTools(tools), JSON.stringify(ungroupedOfferedTools(tools))).toEqual([]);
    }
    const seen = new Set<string>();
    for (const group of AGENT_TOOL_GROUPS) {
      for (const name of group.tools) {
        expect(seen.has(name), name).toBe(false);
        seen.add(name);
        expect(COMPACT_CORE_AGENT_TOOL_NAMES.has(name), `${name} is core and must not be grouped`).toBe(false);
      }
    }
    for (const name of DEFERRED_AGENT_TOOL_NAMES) {
      expect(seen.has(name) || COMPACT_CORE_AGENT_TOOL_NAMES.has(name), `deferred ${name} has no group`).toBe(true);
    }
  });

  it("lists only the core and discovery tools when groups mode is on", () => {
    expect(catalogGroupsOn({})).toBe(false);
    expect(catalogGroupsOn(GROUPS_ON)).toBe(true);
    const full = availableTools(catalogProfileFromEnv(EVERYTHING));
    expect(applyCatalogGroups(full, {})).toBe(full);
    const listed = applyCatalogGroups(full, GROUPS_ON);
    const names = listed.map((tool) => tool.name);
    expect(names.slice(-3)).toEqual([LIST_TOOL_GROUPS, LOAD_TOOL_GROUP, BRIDGE_USE_TOOL]);
    for (const name of names.slice(0, -3)) {
      expect(catalogGroupListed(name), name).toBe(true);
    }
    expect(wireBytes(listed), `full=${wireBytes(full)} groups=${wireBytes(listed)}`).toBeLessThan(wireBytes(full) / 2);
    expect(listed.length).toBeLessThan(full.length);
  });

  it("loads every offered tool through a group and use_tool", () => {
    const full = availableTools(catalogProfileFromEnv(EVERYTHING));
    const { groups } = listOfferedToolGroups(full);
    expect(groups.length).toBeGreaterThan(5);
    const reachable = new Set<string>();
    for (const group of groups) {
      const loaded = loadOfferedToolGroup(full, group.id);
      expect("error" in loaded, group.id).toBe(false);
      if ("error" in loaded) continue;
      expect(loaded.tools.map((tool) => tool.name).sort()).toEqual([...group.tools].sort());
      for (const tool of loaded.tools) {
        reachable.add(tool.name);
        const original = full.find((entry) => entry.name === tool.name)!;
        expect(tool.inputSchema).toEqual(original.inputSchema);
        expect(resolveCatalogUse(full, { name: tool.name, arguments: {} })).toEqual({
          name: tool.name,
          arguments: {},
        });
      }
    }
    for (const tool of full) {
      if (COMPACT_CORE_AGENT_TOOL_NAMES.has(tool.name)) continue;
      expect(reachable.has(tool.name), tool.name).toBe(true);
    }
    expect(loadOfferedToolGroup(full, "no_such_group")).toMatchObject({ error: expect.stringContaining("Unknown tool group") });
    expect(routeGroupCall(full, LIST_TOOL_GROUPS, {}).kind).toBe("answer");
    expect(routeGroupCall(full, LOAD_TOOL_GROUP, { id: "routines" }).kind).toBe("answer");
    expect(routeGroupCall(full, "list_bots", {}).kind).toBe("pass");
  });

  it("documents remaining margin per profile against the soft ceiling and tool limit", () => {
    const profiles: Record<string, Record<string, string>> = {
      "direct+skills+shared+voice": {
        SAGAX_BOT_ID: "bot-golden",
        SAGAX_CHIEF_OF_STAFF: "1",
        SAGAX_SKILL_AUTHORING_ENABLED: "1",
        SAGAX_SHARED_COMPUTERS_ENABLED: "1",
        SAGAX_VOICE_NOTES: "1",
      },
      "direct": { SAGAX_BOT_ID: "bot-golden", SAGAX_CHIEF_OF_STAFF: "1" },
      "direct+non-chief": { SAGAX_BOT_ID: "bot-golden", SAGAX_CHIEF_OF_STAFF: "0" },
      "room+own-thread+skills+shared+voice": {
        SAGAX_BOT_ID: "bot-golden",
        SAGAX_CHIEF_OF_STAFF: "1",
        SAGAX_ROOM_TURN: "1",
        SAGAX_GROUP_TURN: "1",
        SAGAX_OWN_THREAD_CREATION: "1",
        SAGAX_SKILL_AUTHORING_ENABLED: "1",
        SAGAX_SHARED_COMPUTERS_ENABLED: "1",
        SAGAX_VOICE_NOTES: "1",
      },
      "room+non-chief": {
        SAGAX_BOT_ID: "bot-golden",
        SAGAX_CHIEF_OF_STAFF: "0",
        SAGAX_ROOM_TURN: "1",
        SAGAX_GROUP_TURN: "1",
      },
      "external": { SAGAX_BOT_ID: "bot-golden", SAGAX_EXTERNAL_RUNTIME: "1" },
      "widest+perspicax": EVERYTHING,
    };

    const lines: string[] = [
      "agents catalog budget margins (#1703)",
      `soft_ceiling_bytes=${AGENTS_CATALOG_BYTES_SOFT_CEILING}`,
      `tool_count_limit=${AGENTS_CATALOG_TOOL_COUNT_LIMIT}`,
      "",
    ];

    for (const [name, env] of Object.entries(profiles)) {
      const full = availableTools(catalogProfileFromEnv(env));
      const fullWire = wireBytes(full);
      const grouped = applyCatalogGroups(full, GROUPS_ON);
      const groupWire = wireBytes(grouped);
      const margin = catalogMargin({
        profile: name,
        bytes: fullWire,
        tools: full.length,
        baseline: fullWire,
      });
      expect(margin.headroomToSoftCeiling, name).toBeGreaterThan(0);
      // Goldens profiles stay under 128 tools. The widest Perspicax turn can
      // pass 128; chat-mcp already defers the overflow (tool_search/tool_call),
      // and groups mode keeps the listed count small.
      if (name !== "widest+perspicax") {
        expect(margin.headroomToToolLimit, `${name} tools=${full.length}`).toBeGreaterThan(0);
      } else {
        expect(grouped.length, "groups mode listed count").toBeLessThanOrEqual(AGENTS_CATALOG_TOOL_COUNT_LIMIT);
      }
      lines.push(formatCatalogMargin(margin));
      lines.push(`  groups_mode_bytes=${groupWire} saved=${fullWire - groupWire}`);
      expect(groupWire).toBeLessThan(AGENTS_CATALOG_BYTES_SOFT_CEILING);
      expect(groupWire).toBeLessThan(fullWire);
    }

    console.log(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(5);
  });

  it("serves groups mode from the agents proxy", async () => {
    const env = { ...EVERYTHING, ...GROUPS_ON, SAGAX_CATALOG_BRIDGE: "0" };
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SAGAX_")));
    const child = spawn(process.execPath, [PROXY], {
      env: { ...inherited, ...childEnv(), SAGAX_HARNESS_URL: "http://127.0.0.1:9", SAGAX_COMMS_TOKEN: "t", ...env },
      stdio: ["pipe", "pipe", "inherit"],
    });
    try {
      const reply = await new Promise<{ result: { tools: Array<{ name: string }> } }>((resolve, reject) => {
        let buf = "";
        child.stdout!.on("data", (chunk) => {
          buf += chunk;
          const line = buf.split("\n").slice(0, -1).find((entry) => entry.includes('"id":7'));
          if (line) resolve(JSON.parse(line));
        });
        child.on("error", reject);
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n");
      });
      const names = reply.result.tools.map((tool) => tool.name);
      expect(names.slice(-3)).toEqual([LIST_TOOL_GROUPS, LOAD_TOOL_GROUP, BRIDGE_USE_TOOL]);
      expect(names).toContain("list_bots");
      expect(names).not.toContain("propose_routine");
    } finally {
      child.stdin!.end();
      await waitForExit(child, { signal: "SIGTERM" });
    }
  }, 30_000);
});
