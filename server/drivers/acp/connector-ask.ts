// An engine's own connector call in an ACP permission ask (review of #943,
// points 3 and 4). Grok reaches the xAI account's cloud connectors through
// its `use_tool` meta tool; Sagax did not mount those servers, so the ask
// is the only place the call can be seen:
//   - the card gets the call's arguments (`tool_input`) when Grok sends
//     them, else it says plainly that Grok did not;
//   - a call to a server this turn did not mount, or with no target, is
//     outward-facing unless its name plainly reads (fail closed), and so is
//     any call the outbound reading flags (shared/outbound.ts);
//   - an outward ask is answered once, never "allow always".
import { connectorCallReads } from "../../../shared/engine-connectors.ts";
import { isOutboundTool } from "../../../shared/outbound.ts";
import { askInputDetail } from "../../tool-summary.ts";

export interface ConnectorAsk {
  /** The tool the engine names (use_tool's target, else the title). */
  target?: string;
  /** The call's arguments as the card's details, when the engine sent them. */
  input?: string;
  /** A use_tool call to a server this turn did not mount: an engine connector. */
  engineConnector: boolean;
  /** Reaches someone outside the app or changes their data: one-time answers only. */
  outward: boolean;
}

const NOT_MCP_KINDS = new Set(["execute", "edit", "delete", "move", "read", "search", "fetch", "think", "switch_mode"]);

function mountedTarget(target: string, mounted: ReadonlySet<string> | undefined): boolean {
  const name = target.replace(/^mcp__/, "");
  for (const server of mounted ?? []) if (server && name.startsWith(`${server}__`)) return true;
  return false;
}

export function connectorAsk(toolCall: unknown, mounted: ReadonlySet<string> | undefined): ConnectorAsk {
  if (!toolCall || typeof toolCall !== "object") return { engineConnector: false, outward: false };
  const call = toolCall as { kind?: unknown; title?: unknown; rawInput?: unknown; _meta?: unknown };
  const kind = typeof call.kind === "string" ? call.kind : "";
  if (NOT_MCP_KINDS.has(kind)) return { engineConnector: false, outward: false };
  const raw = call.rawInput && typeof call.rawInput === "object" ? (call.rawInput as Record<string, unknown>) : undefined;
  const meta = call._meta && typeof call._meta === "object"
    ? (call._meta as Record<string, unknown>)["x.ai/tool"] as { kind?: unknown; name?: unknown } | undefined
    : undefined;
  const useTool = raw?.variant === "UseTool" || meta?.kind === "use_tool" || meta?.name === "use_tool";
  const title = typeof call.title === "string" ? call.title.trim() : "";
  const named = useTool && typeof raw?.tool_name === "string" ? raw.tool_name.trim() : title;
  const target = named && named.length <= 200 ? named : undefined;
  const args = useTool ? raw?.tool_input : raw;
  const input = args && typeof args === "object" ? askInputDetail(args) : undefined;
  const engineConnector = useTool && !(target && mountedTarget(target, mounted));
  const outward = engineConnector
    ? !(target && connectorCallReads(target))
    : Boolean(target && isOutboundTool(target));
  return { ...(target ? { target } : {}), ...(input ? { input } : {}), engineConnector, outward };
}
