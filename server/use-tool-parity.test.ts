// #1374 non-regression: a call through the agents bridge's use_tool gets the
// very decision the same call made directly gets, on every layer that
// decides on a call. Each case below runs the direct call and the use_tool
// call through the entry the layer really reads them from, then compares.
import { describe, expect, it } from "vitest";

import { createAgentCardGuard } from "./agent-tool-card-guard.ts";
import { autoVerdict } from "./approvals/auto-approve.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "./agent-tool-policy.ts";
import { reviewCustomRules } from "./custom-rules-review.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { catalogBridgeOn, findCatalogTools, routeBridgeCall } from "./drivers/catalog-bridge.ts";
import { hookRuns } from "./lifecycle-hooks.ts";
import { guardToolCall } from "./mcp/mcp-permissions.ts";
import { memberOwnScopeTool } from "./member-tool-scope.ts";
import { misuseToolFrameText } from "./safety/misuse-guardrails.ts";
import { ToolGrantStore } from "./tool-grants.ts";
import type { CustomRule } from "../shared/custom-rules.ts";
import { readUseToolCall } from "../shared/mcp-gateway-call.ts";
import { permissionRoute, readBridgeCall, searchedToolCall, unwrapAgentsBridge } from "../shared/searched-tool-call.ts";

const TOOL = "run_routine";
const ARGS = { routine_id: "routine-1" };
const useTool = (name: string, args: unknown = ARGS) => ({ name, arguments: args });

/** The (tool, input) each entry hands the layers after it. */
type Entry = (direct: boolean) => { tool: string; input: unknown };
const ENTRIES: Record<string, Entry> = {
  // Claude Code: the permission proxy's `approve`
  "Claude permission proxy": (direct) => {
    const route = permissionRoute(direct ? `mcp__agents__${TOOL}` : "mcp__agents__use_tool", direct ? ARGS : useTool(TOOL), new Set(), []);
    if (route.kind !== "ask") throw new Error(`expected an ask, got ${route.kind}`);
    return { tool: route.tool, input: route.input };
  },
  // Claude Code: the permission broker, whatever the proxy sent
  "Claude permission broker": (direct) => {
    const bridged = unwrapAgentsBridge(direct ? `mcp__agents__${TOOL}` : "mcp__agents__use_tool", direct ? ARGS : useTool(TOOL));
    return { tool: bridged.name, input: bridged.input };
  },
  // Claude Code: the activity row, widgets and toolUsage (item.started)
  "Claude activity row": (direct) => {
    const runs = searchedToolCall(direct ? `mcp__agents__${TOOL}` : "mcp__agents__use_tool", direct ? ARGS : useTool(TOOL), new Set());
    return { tool: runs.name, input: runs.input };
  },
  // the MCP gate in front of the agents server (Grok, Codex, Pi)
  "MCP gate": (direct) => {
    if (direct) return { tool: `agents__${TOOL}`, input: ARGS };
    const call = readBridgeCall("use_tool", useTool(TOOL));
    if (call?.kind !== "call") throw new Error("expected a call");
    return { tool: `agents__${call.tool}`, input: call.arguments };
  },
  // Grok's own use_tool around the agents use_tool
  "Grok use_tool": (direct) => {
    const read = readUseToolCall(
      { variant: "UseTool", tool_name: direct ? `agents__${TOOL}` : "agents__use_tool", tool_input: direct ? ARGS : useTool(TOOL) },
    );
    if (!read) throw new Error("expected a use_tool call");
    return { tool: read.id, input: read.args };
  },
};

const rule = (behavior: CustomRule["behavior"], org: boolean): CustomRule => ({
  id: `r-${behavior}-${org ? "org" : "person"}`, ownerId: "pr_owner", botId: null,
  when: `utiliser l'outil agents__${TOOL}`, behavior, riskScope: [], enabled: true,
  ...(org ? { org: true as const } : {}), createdAt: 1, updatedAt: 1,
});
const RULES = {
  "Refuser (org)": rule("deny", true),
  "Demander d'abord (org)": rule("ask", true),
  "Refuser (personne)": rule("deny", false),
  "Demander d'abord (personne)": rule("ask", false),
} as const;

const decide = (rules: CustomRule[], call: { tool: string; input: unknown }) =>
  reviewCustomRules(rules, { tool: call.tool, input: JSON.stringify(call.input) }, "bot-1", "/Users/example").decision.kind;

describe("#1374: use_tool decides like the direct call", () => {
  describe.each(Object.entries(ENTRIES))("%s", (_entry, entry) => {
    it.each(Object.entries(RULES))("rule %s", (_name, saved) => {
      const direct = decide([saved], entry(true));
      expect(direct).toBe(saved.behavior);
      expect(decide([saved], entry(false))).toBe(direct);
    });

    it("unwraps to the same tool and arguments", () => {
      const direct = entry(true);
      const wrapped = entry(false);
      expect(wrapped.tool).toBe(direct.tool);
      expect(wrapped.input).toEqual(direct.input);
    });
  });

  it("before the fix the raw use_tool slipped past a Deny rule", () => {
    expect(decide([RULES["Refuser (org)"]], { tool: "mcp__agents__use_tool", input: useTool(TOOL) })).not.toBe("deny");
  });

  it("MCP guard (enforce): the same refusal and the same audit tool", async () => {
    const tools = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b" }));
    const audit: Array<{ tool: string; decision: string }> = [];
    const options = { principal: { id: "pr_viewer", role: "viewer" }, mode: "enforce" as const, ownBotId: "b", audit: (row: { tool: string; decision: string }) => audit.push(row), allowedSample: 1 };
    const run = async () => ({ text: "ran" });
    for (const [tool, args] of [[TOOL, ARGS], ["list_bots", {}]] as const) {
      const routed = routeBridgeCall(tools, "use_tool", useTool(tool, args));
      if (routed.kind !== "call") throw new Error(routed.text);
      const direct = await guardToolCall(options, tool, args as Record<string, unknown>, run);
      const wrapped = await guardToolCall(options, routed.name, routed.arguments as Record<string, unknown>, run);
      expect(wrapped).toEqual(direct);
    }
    expect(audit.filter((row) => row.tool === TOOL)).toHaveLength(2);
    expect(audit.filter((row) => row.tool === TOOL).every((row) => row.decision === "denied")).toBe(true);
  });

  it("tool guard before the card: the same grant decision", () => {
    for (const mode of ["shadow", "enforce"] as const) {
      const grants = new ToolGrantStore(null);
      const guard = createAgentCardGuard({ grants, mode: () => mode, audit: () => {} });
      const bot = { id: "bot-1" };
      for (const tool of ["create_agent", "send_prompt"]) {
        const direct = guard.opened({ requestId: `d-${tool}`, mcpTool: `mcp__agents__${tool}`, bot, input: { agent_id: "a1" } });
        const wrapped = guard.opened({ requestId: `w-${tool}`, mcpTool: "mcp__agents__use_tool", bot, input: useTool(tool, { agent_id: "a1" }) });
        expect(wrapped, `${mode} ${tool}`).toEqual(direct);
      }
    }
  });

  it("misuse guardrails read the same call text", () => {
    const args = { command: "rm -rf / --no-preserve-root" };
    const frame = (name: string, params: unknown) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: params } });
    expect(misuseToolFrameText(frame("use_tool", useTool("vm_exec", args)))).toBe(misuseToolFrameText(frame("vm_exec", args)));
  });

  it("per-engine allow list: a reviewed read runs unasked, anything else asks, as directly", () => {
    for (const tool of ["list_bots", TOOL, "shared_computer"]) {
      const call = readBridgeCall("use_tool", useTool(tool, {}));
      expect(call?.kind).toBe("call");
      expect(READ_ONLY_AGENT_TOOL_NAMES.has(call?.kind === "call" ? call.tool : "")).toBe(READ_ONLY_AGENT_TOOL_NAMES.has(tool));
    }
  });

  it("Claude's pre-allowed tools: unasked only when the target is pre-allowed by name", () => {
    const preallowed = ["mcp__agents__list_bots", `mcp__agents__${TOOL}`];
    expect(permissionRoute("mcp__agents__use_tool", useTool("list_bots", {}), new Set(), preallowed)).toEqual({ kind: "allow" });
    expect(permissionRoute("mcp__agents__call_tool", useTool("list_bots", {}), new Set(["agents"]), preallowed)).toEqual({ kind: "allow" });
    // shared_computer is never pre-allowed: it asks, as itself
    expect(permissionRoute("mcp__agents__use_tool", useTool("shared_computer", { action: "status" }), new Set(), preallowed))
      .toEqual({ kind: "ask", tool: "mcp__agents__shared_computer", input: { action: "status" }, searched: true });
    expect(permissionRoute("mcp__agents__call_tool", useTool("shared_computer", { action: "status" }), new Set(["agents"]), preallowed))
      .toEqual({ kind: "ask", tool: "mcp__agents__shared_computer", input: { action: "status" }, searched: true });
  });

  it("a member's own scope and the admin gate read the target", () => {
    for (const tool of ["list_bots", TOOL, "vm_exec", "shared_computer"]) {
      const wrapped = unwrapAgentsBridge("agents__use_tool", useTool(tool, {}));
      expect(memberOwnScopeTool(wrapped.name)).toBe(memberOwnScopeTool(`agents__${tool}`));
    }
  });

  it("a plugin's tool hook matches the target", () => {
    const hooks = [{ event: "pre_tool_use" as const, command: "x", matcher: `mcp__agents__${TOOL}`, timeoutMs: 1000 }];
    const wrapped = unwrapAgentsBridge("mcp__agents__use_tool", useTool(TOOL));
    expect(hookRuns("pre_tool_use", hooks, wrapped.name)).toEqual(hookRuns("pre_tool_use", hooks, `mcp__agents__${TOOL}`));
    expect(hookRuns("pre_tool_use", hooks, wrapped.name)).toHaveLength(1);
  });
});

// 2026-10-28: at Full access the server asks the person nothing, direct or
// through use_tool: the ask is answered with no card. Only an organization's
// Refuse and Ask first rules (and the person's own Ask first rule) still stop
// it, the same way on both paths.
describe("Full access asks nothing, direct or through use_tool", () => {
  const verdictAtFull = (rules: CustomRule[], call: { tool: string; input: unknown }) => {
    const kind = decide(rules, call);
    const saved = rules[0];
    return autoVerdict("full", call.tool, kind === "none" || !saved ? {} : { customRule: { behavior: kind as CustomRule["behavior"], id: saved.org ? `orule_${saved.id}` : saved.id } });
  };

  describe.each(Object.entries(ENTRIES))("%s", (_entry, entry) => {
    it("no rule: approved with no card, the same on both paths", () => {
      const direct = verdictAtFull([], entry(true));
      expect(direct).toMatchObject({ source: "full-access" });
      expect(direct.approve).toBeTruthy();
      expect(verdictAtFull([], entry(false))).toEqual(direct);
    });

    it.each(Object.entries(RULES))("rule %s still decides, the same on both paths", (_name, saved) => {
      const direct = verdictAtFull([saved], entry(true));
      expect(direct.approve).toBeNull();
      expect(direct.source).toBe(saved.behavior === "deny" ? "custom-rule-deny" : "custom-rule-ask");
      expect(verdictAtFull([saved], entry(false))).toEqual(direct);
    });
  });
});

describe("#1374: a use_tool that runs nothing is refused everywhere", () => {
  const tools = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b" }));
  const BAD: Array<[string, unknown]> = [
    ["no name", { arguments: {} }],
    ["an empty name", { name: " " }],
    ["itself", { name: "use_tool" }],
    ["find_tool", { name: "find_tool" }],
    ["call_tool", { name: "call_tool", arguments: { name: TOOL } }],
    ["search_tools", { name: "search_tools" }],
    ["arguments that are not an object", { name: TOOL, arguments: "routine-1" }],
    ["not an object", "run_routine"],
  ];
  it.each(BAD)("%s", (_label, input) => {
    expect(permissionRoute("mcp__agents__use_tool", input, new Set(), ["mcp__agents"]).kind).toBe("deny");
    expect(unwrapAgentsBridge("mcp__agents__use_tool", input).refused).toBeTruthy();
    expect(readBridgeCall("use_tool", input)?.kind).toBe("refused");
    expect(routeBridgeCall(tools, "use_tool", input)).toMatchObject({ kind: "answer", isError: true });
    const guard = createAgentCardGuard({ grants: new ToolGrantStore(null), mode: () => "enforce", audit: () => {} });
    expect(guard.opened({ requestId: "r", mcpTool: "agents__use_tool", bot: { id: "b" }, input })).toMatchObject({ deny: true });
  });

  it("an unknown tool or one outside the bot's catalog", () => {
    expect(routeBridgeCall(tools, "use_tool", useTool("no_such_tool", {}))).toEqual({ kind: "answer", text: "Unknown tool: no_such_tool", isError: true });
  });

  it("a call_tool on the agents server that would reach a meta tool", () => {
    expect(permissionRoute("mcp__agents__call_tool", { name: "use_tool", arguments: useTool(TOOL) }, new Set(["agents"]), []).kind).toBe("deny");
  });
});

describe("#1374: defaults per engine (#1314)", () => {
  it("is off unless asked, and only on a compact prompt (Claude Code)", () => {
    expect(catalogBridgeOn({})).toBe(false);
    expect(catalogBridgeOn({ SAGAX_CATALOG_BRIDGE: "1" })).toBe(false);
    expect(catalogBridgeOn({ SAGAX_COMPACT_TOOLS: "{}" })).toBe(false);
    expect(catalogBridgeOn({ SAGAX_CATALOG_BRIDGE: "1", SAGAX_COMPACT_TOOLS: "{}" })).toBe(true);
  });

  it("find_tool returns each match's arguments", () => {
    const tools = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b" }));
    const match = findCatalogTools(tools, "run routine").matches.find((row) => row.name === TOOL);
    const listed = tools.find((tool) => tool.name === TOOL)!;
    expect(match?.inputSchema).toEqual(listed.inputSchema);
  });
});
