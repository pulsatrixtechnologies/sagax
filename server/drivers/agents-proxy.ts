// The "agents" MCP server — spawned inside a bot's agent process (via the
// "agents" integration). Exposes the teammate, room, routine, memory and
// skill tools, each routed back through the harness so the harness stays the
// single owner of turns, permissions, and recursion limits.
//
// Speaks raw JSON-RPC 2.0 over stdio (no MCP SDK — house style, matches
// permission-proxy). All state comes from env, injected by the harness when
// it builds the integration (catalogProfileFromEnv and
// toolCallContextFromEnv read it). The main ones:
//   SAGAX_HARNESS_URL  base URL of the harness (http://127.0.0.1:8799)
//   SAGAX_BOT_ID       the calling bot's id (excluded from list_bots; sender)
//   SAGAX_COMMS_TOKEN  shared secret for the localhost-only internal endpoints
//   SAGAX_TURN_DEPTH   this turn's comms depth (the harness refuses recursion)
//   SAGAX_EXTERNAL_RUNTIME  "1" for a standing process: peer tools and polling only
//   SAGAX_CHIEF_OF_STAFF    "1" for a Chief of Staff, the only bot shown the Chief-only tools
//
// This file is the stdio front end only. What the tools are and which a turn
// sees: agents-catalog.ts. What a call does: agents-call.ts. How the harness
// is reached: agents-client.ts. The harness spawns THIS file as its own
// process (server/proxy-paths.ts), and scripts/bundle-server.mjs inlines the
// other three into it, so a packaged build still ships one agents-proxy.js.
import readline from "node:readline";

import { availableTools, catalogProfileFromEnv, compactListed, compactToolsFromEnv, withDeferredRareTools } from "./agents-catalog.ts";
import { applyCatalogGroups, catalogGroupsOn, routeGroupCall } from "./agents-catalog-budget.ts";
import { catalogBridgeDefinitions, catalogBridgeOn, resolveCatalogUse, routeBridgeCall } from "./catalog-bridge.ts";
import { mergeByAction } from "./agents-merged.ts";
import { readMergedCall } from "../../shared/merged-agent-tools.ts";
import { BRIDGE_USE_TOOL } from "../../shared/searched-tool-call.ts";
import { CALL_TOOL, DESCRIBE_TOOL, SEARCH_TOOL, ToolDirectory, isDirectoryTool, type CatalogTool } from "../mcp-directory.ts";
import { callTool, capResult, toolCallContextFromEnv } from "./agents-call.ts";
import { harnessClientFromEnv, type Json } from "./agents-client.ts";
import { auditSampleFromEnv, deniedResourcesFromEnv, guardToolCall, learnCreatedBot, permissionModeFromEnv, principalFromEnv, scopeOwnersFromEnv } from "../mcp-permissions.ts";

const PROFILE = catalogProfileFromEnv(process.env);
const AVAILABLE_TOOLS = availableTools(PROFILE);
// #1374: off unless SAGAX_CATALOG_BRIDGE=1 on a compact prompt (Claude
// Code only, #1314). The model is then shown find_tool and use_tool.
// use_tool calls the named catalog tool through the same path, checks and
// approvals as a direct call, and every layer outside this process reads it
// as that tool (shared/searched-tool-call.ts). No catalog tool is removed.
// Claude Code only (SAGAX_DEFER_RARE_TOOLS=1): rare tools wait for tool search.
// #1276, a compact prompt (Claude Code, local or cloud, SAGAX_COMPACT_TOOLS):
// the core of a chat turn and the bot's own most used tools are listed whole;
// every other tool is found with search_tools and run with call_tool, through
// the same call path, checks and approvals as a listed one. The list is the
// same for every conversation of the bot, so a prefix cache serves it.
// #1703: SAGAX_CATALOG_GROUPS=1 lists the chat-turn core plus
// list_tool_groups / load_tool_group / use_tool. Every other tool stays
// reachable by group. Off by default so Grok, Codex and Pi keep the full
// list (#1314). Prefer this when a profile approaches the soft ceiling.
const COMPACT = compactToolsFromEnv(process.env);
const BRIDGE = catalogBridgeOn(process.env);
const GROUPS = catalogGroupsOn(process.env) && !BRIDGE && !COMPACT;
const SEARCHED = COMPACT && !BRIDGE
  ? new ToolDirectory(AVAILABLE_TOOLS.filter((tool) => !compactListed(tool.name, { ...COMPACT, coordinating: PROFILE.coordinating })) as unknown as CatalogTool[])
  : undefined;
// #1276: with the bridge, the heart of a chat turn and the bot's own most
// used tools stay listed whole and are called by their own names: reaching
// them through find_tool then use_tool cost two model round trips per call
// (a local model took a minute where one call does). The rest of the
// catalog stays behind find_tool and use_tool. The list is sorted and the
// same in every conversation of the bot, so a prefix cache serves it.
const BRIDGE_LISTED = BRIDGE
  ? AVAILABLE_TOOLS
    .filter((tool) => compactListed(tool.name, { core: "used", pinned: COMPACT?.pinned ?? new Set(), coordinating: PROFILE.coordinating }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  : [];
const LISTED_TOOLS = BRIDGE
  ? [
    ...BRIDGE_LISTED,
    ...catalogBridgeDefinitions().map((tool) => tool.name === "find_tool" && BRIDGE_LISTED.length
      ? { ...tool, description: `Find a Sagax tool that is not listed here by its own name (call a listed one directly). ${tool.description}` }
      : tool),
  ]
  : GROUPS
  ? applyCatalogGroups(AVAILABLE_TOOLS, process.env)
  : COMPACT
  ? [
    ...AVAILABLE_TOOLS.filter((tool) => compactListed(tool.name, { ...COMPACT, coordinating: PROFILE.coordinating })),
    ...(SEARCHED!.tools.length ? SEARCHED!.listed({ server: "agents", title: "Sagax", instructions: "Sagax's own tools: teammates, rooms, routines, settings, artifacts, transcripts, cloud agents, skills and the person's phone." }) : []),
  ]
  : mergedListing(process.env.SAGAX_DEFER_RARE_TOOLS === "1" ? withDeferredRareTools(AVAILABLE_TOOLS, PROFILE) : AVAILABLE_TOOLS);
/** SAGAX_MERGED_TOOLS=1, set by a driver whose engine is shown the whole
 * catalog and reads a family call as the tool it runs: each family of tools
 * is listed as one tool (agents-merged.ts, shared/merged-agent-tools.ts). */
function mergedListing<T extends { name: string }>(tools: T[]) {
  return process.env.SAGAX_MERGED_TOOLS === "1" ? mergeByAction(tools) : tools;
}
// A warm engine keeps this process across its turns; the harness keeps
// every per-turn limit, so nothing here counts.
const CONTEXT = toolCallContextFromEnv(process.env);
// Permission check and audit row for every call (docs/mcp/permissions.md).
// SAGAX_MCP_PERMISSIONS: off | shadow (default: refuses nothing, audits the
// denials and SAGAX_MCP_AUDIT_SAMPLE of the allowed calls) | enforce (audits all).
const PRINCIPAL = principalFromEnv(process.env);
const GUARD = {
  principal: PRINCIPAL,
  // 2026-10-26: the person's own bots and rooms (SAGAX_MCP_OWN_BOTS / _ROOMS)
  owners: scopeOwnersFromEnv(process.env, PRINCIPAL.id),
  mode: permissionModeFromEnv(process.env),
  ownBotId: CONTEXT.botId,
  deniedResources: deniedResourcesFromEnv(process.env),
  allowedSample: auditSampleFromEnv(process.env),
  // The server's activity log first; one JSON line on stderr when the
  // server cannot be reached. Never arguments, text or results.
  audit: (record: unknown) => {
    const line = `[mcp-audit] ${JSON.stringify(record)}\n`;
    void harnessClientFromEnv(process.env).apiResponse("/api/internal/mcp-audit", { method: "POST", body: JSON.stringify(record) })
      .then((r) => { if (!r.ok) process.stderr.write(line); })
      .catch(() => process.stderr.write(line));
  },
};

const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id: unknown, text: string, isError = false) =>
  ok(id, { content: [{ type: "text", text }], isError });

async function handle(msg: Json) {
  const id = msg.id;
  const method = msg.method as string | undefined;
  if (!method) return;
  const params = (msg.params ?? {}) as Json;
  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: (params.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-agents", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: LISTED_TOOLS });
      return;
    case "tools/call": {
      let name = params.name as string;
      let args = (params.arguments ?? {}) as Json;
      if (BRIDGE) {
        const routed = routeBridgeCall(AVAILABLE_TOOLS, name, args);
        if (routed.kind === "answer") return textResult(id, routed.text, routed.isError);
        name = routed.name;
        args = routed.arguments as Json;
      }
      if (GROUPS) {
        const grouped = routeGroupCall(AVAILABLE_TOOLS, name, args);
        if (grouped.kind === "answer") return textResult(id, grouped.text, grouped.isError);
        if (name === BRIDGE_USE_TOOL) {
          const resolved = resolveCatalogUse(AVAILABLE_TOOLS, args);
          if ("error" in resolved) return textResult(id, resolved.error, true);
          name = resolved.name;
          args = resolved.arguments as Json;
        }
      }
      if (SEARCHED && SEARCHED.tools.length && isDirectoryTool(name)) {
        if (name === SEARCH_TOOL) return ok(id, await SEARCHED.search(args));
        if (name === DESCRIBE_TOOL) return ok(id, SEARCHED.describe(args));
        if (name === CALL_TOOL) {
          const call = SEARCHED.call(args);
          if ("answer" in call) return ok(id, call.answer);
          name = call.name;
          args = call.arguments as Json;
        }
      }
      // A family tool runs the tool its action names, with that tool's own
      // arguments, through the same checks as a direct call.
      const family = readMergedCall(name, args);
      if (family?.kind === "refused") return textResult(id, family.reason, true);
      if (family?.kind === "call") {
        name = family.tool;
        args = family.arguments as Json;
      }
      if (!AVAILABLE_TOOLS.some((t) => t.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      try {
        const { text, isError, passthrough } = await guardToolCall(GUARD, name, args, () => callTool(name, args, CONTEXT)) as Awaited<ReturnType<typeof callTool>>;
        // 2026-10-27 (#1098): a bot the person just created is theirs for
        // the rest of this process (its spawn list predates it)
        if (name === "create_bot" && !isError) learnCreatedBot(GUARD.owners, text);
        if (passthrough) ok(id, passthrough);
        else textResult(id, name === "tool_result_read" ? text : await capResult(text, CONTEXT), isError);
      } catch (e) {
        textResult(id, await capResult((e as Error).message, CONTEXT), true);
      }
      return;
    }
    default:
      if (id !== undefined) rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg: Json;
  try {
    msg = JSON.parse(t) as Json;
  } catch {
    return;
  }
  void handle(msg).catch((e) => {
    if (msg.id !== undefined) rpcErr(msg.id, -32603, (e as Error).message);
  });
});
rl.on("close", () => process.exit(0));
