// #1276: on a server whose catalog is searched (the MCP gate's own tool
// search, the agents catalog in a compact prompt), the model runs a tool it
// found with `call_tool({ name, arguments })`. Everything Sagax reads about a
// call (the approval card and its rules, Always allow, the activity row, a
// tool's widget, which tools a bot uses) reads the tool that call runs, as if
// the model had called it by its own name.

import { isMergedAgentTool, readMergedCall } from "./merged-agent-tools.ts";

export const SEARCH_CALL_TOOL = "call_tool";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// #1374: the find_tool / use_tool bridge of Sagax's own agents server
// (server/drivers/catalog-bridge.ts). A use_tool call is read everywhere as
// the tool it runs, with that tool's own arguments: the approval card, the
// person's and the organization's Deny and Ask rules, Always allow, the MCP
// guard, the misuse guardrails, the activity row and the widgets all see
// exactly what a direct call would show them. A use_tool that names no
// tool, or names another meta tool, runs nothing and is refused.

/** Sagax's own MCP server, the only one the bridge serves. */
export const BRIDGE_SERVER = "agents";
export const BRIDGE_FIND_TOOL = "find_tool";
export const BRIDGE_USE_TOOL = "use_tool";
/** Tools that only reach another tool: never the target of a call. */
const META_TOOLS: ReadonlySet<string> = new Set([BRIDGE_FIND_TOOL, BRIDGE_USE_TOOL, "search_tools", "describe_tool", SEARCH_CALL_TOOL]);
/** An agents tool name, as server/people/member-tool-scope.ts reads one. */
const AGENT_TOOL = /^[a-z][a-z0-9_]{0,63}$/;
/** `mcp__agents__x` (Claude), `agents__x` (ACP, Codex), `agents.x`, `agents:x`, `agents/x`. */
const AGENTS_SPELLING = /^((?:mcp(?:__|[.:]))?agents(?:__|[.:/]))([a-z][a-z0-9_]{0,63})$/;

export const BRIDGE_REFUSED_TEXT = "use_tool needs one catalog tool name from find_tool, and its arguments as an object.";

export type BridgeCall =
  | { kind: "find" }
  | { kind: "call"; tool: string; arguments: Record<string, unknown> }
  | { kind: "refused"; reason: string };

/** A bridge tool of the agents server (bare name), as what it does: find
 * runs nothing, call runs `tool` with `arguments`, refused runs nothing.
 * Null for any other tool. */
export function readBridgeCall(tool: string, input: unknown): BridgeCall | null {
  if (tool === BRIDGE_FIND_TOOL) return { kind: "find" };
  // A family tool (shared/merged-agent-tools.ts) is read as the tool its
  // action names, with that tool's own arguments, like a use_tool.
  if (isMergedAgentTool(tool)) return readMergedCall(tool, input);
  if (tool !== BRIDGE_USE_TOOL) return null;
  if (!isRecord(input)) return { kind: "refused", reason: BRIDGE_REFUSED_TEXT };
  const raw = typeof input.name === "string" ? input.name.trim() : "";
  const spelled = AGENTS_SPELLING.exec(raw);
  const target = spelled ? spelled[2]! : raw;
  if (!AGENT_TOOL.test(target) || META_TOOLS.has(target) || isMergedAgentTool(target)) return { kind: "refused", reason: BRIDGE_REFUSED_TEXT };
  if (input.arguments !== undefined && input.arguments !== null && !isRecord(input.arguments)) return { kind: "refused", reason: BRIDGE_REFUSED_TEXT };
  return { kind: "call", tool: target, arguments: isRecord(input.arguments) ? input.arguments : {} };
}

/** An engine's name for an agents tool, in any spelling, unwrapped when it
 * is the bridge's use_tool: the same spelling for the tool it runs, and
 * that tool's arguments. `find` marks a find_tool (it runs nothing);
 * `refused` a use_tool that must not run. Any other call is unchanged. */
export function unwrapAgentsBridge(name: string, input: unknown): { name: string; input: unknown; unwrapped: boolean; find?: true; refused?: string } {
  const spelled = AGENTS_SPELLING.exec(name);
  if (!spelled) return { name, input, unwrapped: false };
  const call = readBridgeCall(spelled[2]!, input);
  if (!call) return { name, input, unwrapped: false };
  if (call.kind === "find") return { name, input, unwrapped: false, find: true };
  if (call.kind === "refused") return { name, input, unwrapped: false, refused: call.reason };
  return { name: `${spelled[1]}${call.tool}`, input: call.arguments, unwrapped: true };
}

/** `mcp__<server>__call_tool` on a searched server, as the call it runs:
 * `mcp__<server>__<tool>` with that tool's own arguments. Any other call, or
 * a call_tool that names no tool (it runs nothing), is returned unchanged.
 * #1374: the agents bridge's use_tool is unwrapped the same way on every
 * turn, and `refused` is set when the wrapper must not run at all. */
export function searchedToolCall(name: string, input: unknown, searched: ReadonlySet<string>): { name: string; input: unknown; searched: boolean; refused?: string } {
  // #1374: the agents bridge's use_tool, on any turn, whatever was searched
  const bridged = unwrapAgentsBridge(name, input);
  if (bridged.refused) return { name, input, searched: false, refused: bridged.refused };
  if (bridged.unwrapped) return { name: bridged.name, input: bridged.input, searched: true };
  const suffix = `__${SEARCH_CALL_TOOL}`;
  if (!name.startsWith("mcp__") || !name.endsWith(suffix)) return { name, input, searched: false };
  const server = name.slice("mcp__".length, -suffix.length);
  if (!server || !searched.has(server) || !isRecord(input)) return { name, input, searched: false };
  const target = typeof input.name === "string" ? input.name.trim() : "";
  if (!target || !/^[\w.:-]{1,200}$/.test(target)) return { name, input, searched: false };
  // a call_tool on Sagax's own server that would reach a meta tool runs nothing (#1374)
  if (server === BRIDGE_SERVER && META_TOOLS.has(target)) return { name, input, searched: false, refused: BRIDGE_REFUSED_TEXT };
  return { name: `mcp__${server}__${target}`, input: isRecord(input.arguments) ? input.arguments : {}, searched: true };
}

/** The names of the searched servers, from the private setting a driver
 * hands its permission proxy (SAGAX_PERMISSION_SEARCHED). */
export function searchedServersFromEnv(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && /^[\w-]{1,64}$/.test(name)) : []);
  } catch {
    return new Set();
  }
}

/** The MCP entries a Claude Code turn pre-allows (`--allowedTools`), from the
 * private setting the driver hands its permission proxy
 * (SAGAX_PERMISSION_PREALLOWED): `mcp__<server>` or `mcp__<server>__<tool>`. */
export function preallowedFromEnv(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && /^mcp__[\w-]{1,64}(?:__[\w.:-]{1,200})?$/.test(entry)) : [];
  } catch {
    return [];
  }
}

/** #1374: whether the CLI would have run this unwrapped call unasked, had
 * the model called it by its own name. A wrapper is never pre-allowed
 * itself, so its target gets exactly the direct call's treatment. */
export function preallowedCovers(entries: readonly string[], name: string): boolean {
  return entries.some((entry) => entry === name || (entry.split("__").length === 2 && name.startsWith(`${entry}__`)));
}

/** What Claude Code's permission proxy does with one `approve` call
 * (server/permission-proxy.ts): refuse a wrapper that runs nothing, let a
 * wrapped call through unasked when its target is pre-allowed by name, or
 * ask about the tool that really runs, with its own arguments. */
export function permissionRoute(toolName: string, input: unknown, searched: ReadonlySet<string>, preallowed: readonly string[]):
  | { kind: "deny"; message: string }
  | { kind: "allow" }
  | { kind: "ask"; tool: string; input: unknown; searched: boolean } {
  const runs = searchedToolCall(toolName, input, searched);
  if (runs.refused) return { kind: "deny", message: `Sagax: ${runs.refused}` };
  if (runs.searched && preallowedCovers(preallowed, runs.name)) return { kind: "allow" };
  return { kind: "ask", tool: runs.name, input: runs.input, searched: runs.searched };
}
