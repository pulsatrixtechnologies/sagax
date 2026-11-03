// #1276 non-regression: on pi, a call_tool on a searched server gets the very
// decision the same call made directly gets, whatever the length of its
// arguments. Each case runs the call through the real pi-mcp-extension (the
// card it writes), then the pi driver's reading of that card (piGatedMcpTool,
// piGatedMcpInput, piSearchedCall), then the person's and the organization's
// rules (reviewCustomRules), and compares with the direct call.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reviewCustomRules } from "./custom-rules-review.ts";
import extension from "../drivers/pi-mcp-extension.ts";
import { buildMcpServers, piGatedMcpInput, piGatedMcpTool, piSearchedCall, piSearchedServers } from "../drivers/pi.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { CustomRule } from "../../shared/custom-rules.ts";

type ExtensionApi = Parameters<typeof extension>[0];
type RegisteredTool = Parameters<ExtensionApi["registerTool"]>[0];
type Handler = Parameters<ExtensionApi["on"]>[1];

const SERVER = "ops";
const TOOL = "update_record";
const SHORT = { id: 7 };
// past the extension's 300-character cut of a card's arguments
const LONG = { id: 7, note: "x".repeat(600) };

const tempDirs: string[] = [];
const originalConfig = process.env.SAGAX_MCP_CONFIG;
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await removeTempDir(dir);
  if (originalConfig === undefined) delete process.env.SAGAX_MCP_CONFIG;
  else process.env.SAGAX_MCP_CONFIG = originalConfig;
});

/** A searched server as the gate serves it: the three directory tools plus
 * one tool listed whole (called by its own name). */
function searchedServerScript(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-pi-parity-"));
  tempDirs.push(dir);
  const path = join(dir, "fake-mcp.mjs");
  writeFileSync(path, `
    import { createInterface } from "node:readline";
    const object = { type: "object" };
    createInterface({ input: process.stdin }).on("line", (line) => {
      const m = JSON.parse(line); if (m.id === undefined) return;
      let result = {};
      if (m.method === "tools/list") result = { tools: ["search_tools", "describe_tool", "call_tool", "${TOOL}"].map((name) => ({ name, inputSchema: object })) };
      if (m.method === "tools/call") result = { content: [{ type: "text", text: "ran" }] };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
    });
  `, "utf8");
  chmodSync(path, 0o755);
  return path;
}

/** The card pi's extension writes for one call, as the driver reads it. */
async function cardFor(direct: boolean, args: Record<string, unknown>, toolScope?: unknown): Promise<{ tool: string; input: string; refused?: string }> {
  const dir = mkdtempSync(join(tmpdir(), "omb-pi-parity-config-"));
  tempDirs.push(dir);
  const mcpServers = { [SERVER]: { command: process.execPath, args: [searchedServerScript()], scope: "custom", searched: true } };
  process.env.SAGAX_MCP_CONFIG = join(dir, "mcp.json");
  writeFileSync(process.env.SAGAX_MCP_CONFIG, JSON.stringify({ mcpServers, approvalMode: "ask", ...(toolScope ? { toolScope } : {}) }));
  const tools: RegisteredTool[] = [];
  const handlers = new Map<string, Handler>();
  let active: string[] = [];
  await extension({
    registerTool(tool) { tools.push(tool); active.push(tool.name); },
    on(event, handler) { handlers.set(event, handler); },
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => { active = names; },
  });
  try {
    const cards: Array<{ title: string; message: string }> = [];
    const ui = { confirm: async (title: string, message: string) => { cards.push({ title, message }); return true; } };
    const name = direct ? `${SERVER}_${TOOL}` : `${SERVER}_call_tool`;
    const tool = tools.find((row) => row.name === name);
    if (!tool) throw new Error(`${name} is not registered`);
    await tool.execute("call", direct ? args : { name: TOOL, arguments: args }, undefined, undefined, { ui });
    expect(cards).toHaveLength(1);
    const gated = piGatedMcpTool(cards[0]!.title, mcpServers);
    if (!gated) throw new Error(`unnamed card: ${cards[0]!.title}`);
    const read = piSearchedCall(gated, piGatedMcpInput(cards[0]!.message, gated), piSearchedServers(mcpServers));
    return { tool: read.mcpTool, input: read.input, ...(read.refused ? { refused: read.refused } : {}) };
  } finally { await handlers.get("session_shutdown")?.({}); }
}

const rule = (behavior: CustomRule["behavior"], org: boolean): CustomRule => ({
  id: `r-${behavior}-${org ? "org" : "person"}`, ownerId: "pr_owner", botId: null,
  when: `utiliser l'outil ${SERVER}__${TOOL}`, behavior, riskScope: [], enabled: true,
  ...(org ? { org: true as const } : {}), createdAt: 1, updatedAt: 1,
});
const RULES = {
  "Refuser (org)": rule("deny", true),
  "Demander d'abord (org)": rule("ask", true),
  "Refuser (personne)": rule("deny", false),
  "Demander d'abord (personne)": rule("ask", false),
} as const;
const decide = (rules: CustomRule[], call: { tool: string; input: string }) =>
  reviewCustomRules(rules, { tool: call.tool, input: call.input }, "bot-1", "/Users/example").decision.kind;

describe("#1276: pi's call_tool on a searched server decides like the direct call", () => {
  describe.each([["short arguments", SHORT], ["arguments past the card's cut", LONG]] as const)("%s", (_label, args) => {
    it.each(Object.entries(RULES))("rule %s", async (_name, saved) => {
      const direct = await cardFor(true, args);
      const wrapped = await cardFor(false, args);
      expect(decide([saved], direct)).toBe(saved.behavior);
      expect(decide([saved], wrapped)).toBe(decide([saved], direct));
    });

    it("names the same tool with the same arguments", async () => {
      const direct = await cardFor(true, args);
      const wrapped = await cardFor(false, args);
      expect(wrapped.tool).toBe(`${SERVER}__${TOOL}`);
      expect(wrapped).toEqual(direct);
    });
  });

  it("a narrow tool scope keeps call_tool reachable for an allowed tool and refuses any other", async () => {
    const scope = { allow: [`mcp:${SERVER}:${TOOL}`] };
    expect(await cardFor(false, SHORT, scope)).toEqual(await cardFor(true, SHORT, scope));
    await expect(cardFor(false, SHORT, { allow: [`mcp:${SERVER}:other_tool`] })).rejects.toThrow(/not registered|Tool selection excludes this tool/);
  });
});

describe("#1276: piSearchedCall on a card that runs nothing named", () => {
  const searched = new Set([SERVER, "agents"]);
  it("refuses a call_tool card left on a searched server whose arguments do not parse", () => {
    expect(piSearchedCall(`${SERVER}__call_tool`, "{\"name\": \"update_rec", searched).refused).toBeTruthy();
    expect(piSearchedCall(`${SERVER}__call_tool`, "{}", searched).refused).toBeTruthy();
  });

  it("refuses an agents call_tool that would reach a meta tool, as Claude's path does", () => {
    expect(piSearchedCall("agents__call_tool", JSON.stringify({ name: "use_tool", arguments: {} }), searched).refused).toBeTruthy();
    expect(piSearchedCall("agents__use_tool", JSON.stringify({ name: "find_tool" }), searched).refused).toBeTruthy();
  });

  it("leaves a real tool named call_tool on a server that is not searched", () => {
    expect(piSearchedCall("other__call_tool", "{\"name\": \"x\"}", searched)).toEqual({ mcpTool: "other__call_tool", input: "{\"name\": \"x\"}" });
  });

  it("marks only searched servers (the gate's search, the agents catalog in a compact prompt)", () => {
    const script = searchedServerScript();
    const servers = buildMcpServers({
      threadId: "pi-parity", text: "Go",
      compactPrompt: { agents: { core: "used", pinned: [] }, pinned: { [SERVER]: [] } },
      integrations: {
        agents: { command: process.execPath, args: [script], env: {} },
        custom: { [SERVER]: { command: process.execPath, args: [script], env: {} } },
      },
    });
    expect([...piSearchedServers(servers)].sort()).toEqual(["agents", SERVER]);
    expect(piSearchedServers(buildMcpServers({ threadId: "pi-parity-plain", text: "Go", integrations: { custom: { [SERVER]: { command: process.execPath, args: [script], env: {} } } } }))).toEqual(new Set());
  });
});
