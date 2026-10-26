// An MCP call made through a gateway tool reads as the tool it runs.
//
// Pi with the pi-mcp-adapter extension reaches every MCP server through one
// tool named `mcp`: `{ server, tool, args }` calls a tool, `{ tool:
// "<server>_<tool>", args }` names it with the server as a prefix, and a
// call without a tool is the gateway's own housekeeping (status, search,
// connect, auth). The engine reports the gateway's name, so a step read
// "Used mcp" and lost the server and tool it ran. The driver resolves the
// call here (server/drivers/pi.ts); the chat does the same for rows stored
// before that (src/lib/step-label.ts).

/** The gateway's own name for its single tool. */
export const MCP_GATEWAY_TOOL = "mcp";

export type McpGatewayCall =
  /** a call to one tool: the id reads `mcp__<server>__<tool>` */
  | { kind: "tool"; server: string; tool: string; id: string; args: unknown }
  /** the gateway's housekeeping: what it did and on which server */
  | { kind: "admin"; action: "search" | "connect" | "describe" | "status"; server?: string; query?: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      return record(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The arguments a gateway passes on: an object, or the JSON text of one. */
function innerArgs(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return {};
  return record(value) ?? value;
}

/** `<server>_<tool>` split on a known server first, else on the first `_`
 * (server names are written with dashes: `pulsatrix-psa_cw_psa__query`). */
function splitPrefixed(name: string, servers: readonly string[]): { server: string; tool: string } | undefined {
  const known = [...servers].sort((a, b) => b.length - a.length).find((server) => name.startsWith(`${server}_`) && name.length > server.length + 1);
  if (known) return { server: known, tool: name.slice(known.length + 1) };
  const cut = name.indexOf("_");
  if (cut <= 0 || cut === name.length - 1) return undefined;
  return { server: name.slice(0, cut), tool: name.slice(cut + 1) };
}

/** What a gateway call did, from its tool name and arguments; undefined for
 * any tool that is not the gateway. `servers` are the names the turn
 * mounted, when known, to split a prefixed tool name exactly. */
export function readMcpGatewayCall(name: string | undefined, input: unknown, servers: readonly string[] = []): McpGatewayCall | undefined {
  if (name?.trim() !== MCP_GATEWAY_TOOL) return undefined;
  const args = record(input) ?? {};
  const server = text(args.server) ?? text(args.connect);
  const tool = text(args.tool);
  if (tool && NAME.test(tool)) {
    const split = server ? { server, tool } : splitPrefixed(tool, servers);
    if (split && NAME.test(split.server)) {
      return { kind: "tool", server: split.server, tool: split.tool, id: `mcp__${split.server}__${split.tool}`, args: innerArgs(args.args ?? args.arguments) };
    }
  }
  const query = text(args.search) ?? text(args.query);
  const action = text(args.action)?.toLowerCase() ?? "";
  if (query || action === "search") return { kind: "admin", action: "search", server, query };
  if (text(args.connect) || /auth|connect|login/.test(action)) return { kind: "admin", action: "connect", server };
  if (text(args.describe) || action === "describe") return { kind: "admin", action: "describe", server };
  return { kind: "admin", action: "status", server };
}

/** Whether an ACP tool call's title or `_meta["x.ai/tool"]` names Grok's
 * use_tool meta tool. */
function namesUseTool(hint: { title?: unknown; meta?: unknown } | undefined): boolean {
  if (!hint) return false;
  const title = typeof hint.title === "string" ? hint.title.trim().toLowerCase().replace(/\s+/g, "_") : "";
  if (title === "use_tool") return true;
  const tool = record(record(hint.meta)?.["x.ai/tool"]);
  return tool?.kind === "use_tool" || tool?.name === "use_tool";
}

/** Grok's `use_tool` meta tool (rawInput `{ variant: "UseTool", tool_name:
 * "<server>__<tool>", tool_input }`): the tool it runs and that tool's own
 * arguments; undefined for any other call. Its title reads "Use Tool".
 * grok 1.0.62 sends the first `tool_call` without `variant` (only the later
 * update has it) and titles it `use_tool`: `hint` (the call's title and
 * `_meta`) identifies it then, so the row names the tool, not "use tool". */
export function readUseToolCall(rawInput: unknown, hint?: { title?: unknown; meta?: unknown }): { id: string; args: unknown } | undefined {
  const raw = record(rawInput);
  if (!raw || (raw.variant !== "UseTool" && !namesUseTool(hint))) return undefined;
  const name = text(raw.tool_name);
  if (!name || !/^(?:mcp__)?[A-Za-z0-9][A-Za-z0-9_.-]*__[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) return undefined;
  return { id: name.startsWith("mcp__") ? name : `mcp__${name}`, args: innerArgs(raw.tool_input) };
}
