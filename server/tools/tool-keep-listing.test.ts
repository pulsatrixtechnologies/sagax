// #4527 lot C: each engine family gets the agents listing its session's
// verdict decides, the same on every turn of the session, and reads a
// left out tool's call_tool as the tool it runs (scope, card, use count).
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { agentsSearchedCall, agentsSearchedFromEnv, prefixedToolId, searchedToolCall, stepToolId } from "../../shared/searched-tool-call.ts";
import { compactListed, compactToolsFromEnv } from "../drivers/agents-catalog.ts";
import { turnStdioMcpServers } from "../drivers/turn-mcp.ts";
import { buildMcpServers, piSearchedServers } from "../drivers/pi.ts";
import { museToolStart } from "../drivers/muse-code.ts";
import { piExtensionToolId } from "../drivers/pi-send-events.ts";
import { reviewCustomRules } from "../rules/custom-rules-review.ts";
import type { CustomRule } from "../../shared/custom-rules.ts";
import { agentsOffered, withKeptAgentsListing } from "./tool-keep-listing.ts";
import { forgetToolKeepInMemory, readToolKeep, toolKeepBindTurn, toolKeepDir, toolKeepSteps, toolKeepTurn } from "./tool-keep.ts";

const AGENTS = { command: "node", args: ["agents-proxy.js"], env: { SAGAX_BOT_ID: "bot-1", SAGAX_CHIEF_OF_STAFF: "1" } as Record<string, string> };
const LEFT_OUT = ["agents/list_rooms", "agents/run_routine", "crm/old_report"];
const listed = (engine: { driverKind: string; compactPrompt?: boolean }) =>
  withKeptAgentsListing(AGENTS, LEFT_OUT, { driverKind: engine.driverKind, compactPrompt: engine.compactPrompt === true });

beforeEach(() => {
  forgetToolKeepInMemory();
  rmSync(toolKeepDir(), { recursive: true, force: true });
});

describe("the agents listing per engine family", () => {
  it.each(["codex", "grokAgent", "geminiAgent", "museCode", "piAgent", "openai-compat", "mistral"])("%s lists the core and kept tools, the rest behind search", (driverKind) => {
    const mount = listed({ driverKind })!;
    expect(JSON.parse(mount.env.SAGAX_COMPACT_TOOLS!)).toEqual({ core: "kept", pinned: [], leftOut: ["list_rooms", "run_routine"] });
    expect(agentsSearchedFromEnv(mount.env)).toBe(true);
    const compact = compactToolsFromEnv(mount.env)!;
    expect(compactListed("list_rooms", { ...compact, coordinating: false })).toBe(false);
    expect(compactListed("list_bots", { ...compact, coordinating: false })).toBe(true);
    // the turn's own settings are kept
    expect(mount.env.SAGAX_BOT_ID).toBe("bot-1");
  });

  it("Claude Code keeps its own tool search, a compact prompt its compact list, the external runtime its fixed one", () => {
    expect(listed({ driverKind: "claudeAgent" })).toBe(AGENTS);
    expect(listed({ driverKind: "piAgent", compactPrompt: true })).toBe(AGENTS);
    const external = { ...AGENTS, env: { ...AGENTS.env, SAGAX_EXTERNAL_RUNTIME: "1" } };
    expect(withKeptAgentsListing(external, LEFT_OUT, { driverKind: "codex", compactPrompt: false })).toBe(external);
    // nothing of the agents server left out: today's listing, exactly
    expect(withKeptAgentsListing(AGENTS, ["crm/old_report"], { driverKind: "codex", compactPrompt: false })).toBe(AGENTS);
  });

  it("is the same on every turn of a session: the verdict is frozen", () => {
    const turn = (threadId: string) => toolKeepTurn({ botId: "bot-1", person: "alice", threadId, prompt: true });
    // a bot whose sessions never call list_rooms
    for (let n = 0; n < 7; n++) {
      turn(`t-${n}`);
      toolKeepBindTurn(`t-${n}`, `turn-${n}`, "bot-1", "alice");
      toolKeepSteps(`t-${n}`, [{ type: "item.started", itemType: "tool", turnId: `turn-${n}`, title: "list_bots", tool: "agents/list_bots" }]);
      if (n === 0) toolKeepSteps(`t-${n}`, [{ type: "item.started", itemType: "tool", turnId: `turn-${n}`, title: "list_rooms", tool: "agents/list_rooms" }]);
    }
    const first = withKeptAgentsListing(AGENTS, turn("t-live").leftOut, { driverKind: "codex", compactPrompt: false })!;
    expect(first.env.SAGAX_COMPACT_TOOLS).toContain("list_rooms");
    // the bot calls it through search in this session: the session's list does not move
    toolKeepBindTurn("t-live", "turn-live", "bot-1", "alice");
    toolKeepSteps("t-live", [{ type: "item.started", itemType: "tool", turnId: "turn-live", title: "list_rooms", tool: "agents/list_rooms" }]);
    const second = withKeptAgentsListing(AGENTS, turn("t-live").leftOut, { driverKind: "codex", compactPrompt: false })!;
    expect(second.env.SAGAX_COMPACT_TOOLS).toBe(first.env.SAGAX_COMPACT_TOOLS);
    // and the next conversation lists it again
    expect(turn("t-after").leftOut).not.toContain("agents/list_rooms");
    expect(readToolKeep("bot-1", "alice").tools["agents/list_rooms"]).toMatchObject({ sessions: 0 });
  });

  it("offers every agents tool of the turn's profile", () => {
    const offered = agentsOffered(AGENTS.env);
    expect(offered).toEqual(expect.arrayContaining(["agents/list_bots", "agents/list_rooms", "agents/ask_choice"]));
    expect(agentsOffered(undefined)).toEqual([]);
  });
});

describe("a left out tool reached through call_tool, per engine", () => {
  const mount = listed({ driverKind: "geminiAgent" })!;

  it("ACP engines and Muse Code mount the kept listing; under a tool selection the gate reads call_tool's target", () => {
    const plain = turnStdioMcpServers({ threadId: "t-acp", text: "", integrations: { agents: mount } } as never);
    expect(plain.find((server) => server.name === "agents")!.env.SAGAX_COMPACT_TOOLS).toBe(mount.env.SAGAX_COMPACT_TOOLS);
    const scoped = turnStdioMcpServers({ threadId: "t-acp", text: "", toolScope: { deny: ["mcp:agents:run_routine"] }, integrations: { agents: mount } } as never);
    expect(scoped.find((server) => server.name === "agents")!.env.SAGAX_GATE_DIRECTORY).toBe("1");
    const unkept = turnStdioMcpServers({ threadId: "t-acp", text: "", toolScope: { deny: ["mcp:agents:run_routine"] }, integrations: { agents: AGENTS } } as never);
    expect(unkept.find((server) => server.name === "agents")!.env.SAGAX_GATE_DIRECTORY).toBeUndefined();
  });

  it("ACP: the step and the permission ask read as the tool it runs", () => {
    expect(agentsSearchedCall("agents__call_tool", { name: "run_routine", arguments: { routine_id: "r-1" } }))
      .toEqual({ mcpTool: "agents__run_routine", id: "agents/run_routine", input: { routine_id: "r-1" } });
    expect(agentsSearchedCall("mcp__agents__call_tool", { name: "search_tools" })).toBeNull();
    expect(agentsSearchedCall("agents__list_bots", {})).toBeNull();
  });

  it("an organization Refuse or Ask first rule on a left out tool applies when it runs through call_tool", () => {
    const rule = (behavior: CustomRule["behavior"]): CustomRule => ({
      id: `r-${behavior}`, ownerId: "pr_admin", botId: null, when: "utiliser l'outil agents__run_routine", behavior, riskScope: [], enabled: true, org: true, createdAt: 1, updatedAt: 1,
    } as CustomRule);
    const searched = agentsSearchedCall("agents__call_tool", { name: "run_routine", arguments: { routine_id: "r-1" } })!;
    for (const behavior of ["deny", "ask"] as const) {
      const direct = reviewCustomRules([rule(behavior)], { tool: "agents__run_routine", input: JSON.stringify({ routine_id: "r-1" }) }, "bot-1", "/Users/example");
      const throughSearch = reviewCustomRules([rule(behavior)], { tool: searched.mcpTool, input: JSON.stringify(searched.input) }, "bot-1", "/Users/example");
      expect(direct.decision.kind).toBe(behavior);
      expect(throughSearch.decision.kind).toBe(behavior);
    }
    // Claude's and the chat engines' reading of the same call
    expect(searchedToolCall("mcp__agents__call_tool", { name: "run_routine", arguments: {} }, new Set(["agents"])).name).toBe("mcp__agents__run_routine");
  });

  it("Pi on a cloud model marks the agents mount searched", () => {
    const servers = buildMcpServers({ threadId: "t-pi", text: "", integrations: { agents: mount } } as never)!;
    expect(piSearchedServers(servers).has("agents")).toBe(true);
    const plain = buildMcpServers({ threadId: "t-pi", text: "", integrations: { agents: AGENTS } } as never)!;
    expect(piSearchedServers(plain).has("agents")).toBe(false);
    expect(piExtensionToolId("agents_call_tool", { name: "list_rooms", arguments: {} }, ["agents"], new Set(["agents"]))).toBe("agents/list_rooms");
  });

  it("Pi counts a folded upstream name under the tool's own spelling", () => {
    expect(piExtensionToolId("gmail_gmail_send_email", {}, ["gmail"], new Set())).toBe("gmail/gmail_send_email");
    expect(piExtensionToolId("gmail_gmail_send_email", {}, ["gmail"], new Set(), new Map([["gmail_gmail_send_email", "gmail/GMAIL_SEND_EMAIL"]]))).toBe("gmail/GMAIL_SEND_EMAIL");
  });

  it("Muse Code counts a connector's tool and a searched call under their ids", () => {
    const mounts = { names: ["agents", "crm"], searched: new Set(["agents"]) };
    expect(museToolStart({ itemId: "i1", kind: "toolCall", status: "inProgress", tool: "crm_list_deals", args: "{}" }, mounts).tool).toBe("crm/list_deals");
    expect(museToolStart({ itemId: "i2", kind: "toolCall", status: "inProgress", tool: "agents_call_tool", args: JSON.stringify({ name: "list_rooms", arguments: {} }) }, mounts).tool).toBe("agents/list_rooms");
    expect(stepToolId(museToolStart({ itemId: "i3", kind: "toolCall", status: "inProgress", tool: "bash", args: "{}" }, mounts))).toBeNull();
    expect(prefixedToolId("crm_list_deals", {}, ["crm"], new Set())).toBe("crm/list_deals");
  });
});
