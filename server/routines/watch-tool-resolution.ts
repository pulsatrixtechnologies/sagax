import type { RoutineWatchPrecheck, RoutineWatchSource } from "../../shared/routine-watch.ts";
import { ROUTINE_WATCH_LIMITS } from "../../shared/routine-watch.ts";
import { permissionForTool } from "../mcp/mcp-permissions.ts";
import { foldToolName, resolveServedTool } from "../mcp/mcp-tool-resolve.ts";
import { closeNames } from "../close-names.ts";
import { watchToolRefusal } from "./routine-watch-tools.ts";

export const watchRepairHint = "Use propose_routine_action with action update and changes.watch to repair this routine, then use run_routine to retry.";
export const foldWatchName = foldToolName;

export class UnmappedWatchBuiltin extends Error {}

export function resolveWatchSource(watch: RoutineWatchPrecheck, served: readonly string[]): RoutineWatchSource {
  const source = watch.source;
  if (source.type !== "tool") return source;
  const wanted = source.tool.replace(/^mcp__perspicax__|^mcp__/, "");
  const folded = foldWatchName(wanted);
  const matches = served.filter(name => foldWatchName(name) === folded);
  const resolved = resolveServedTool(wanted, served);
  const name = resolved.kind === "none" ? undefined : resolved.name;
  if (name) {
    const refusal = watchToolRefusal(name, source.args);
    if (refusal) throw new Error(refusal);
    return { ...source, tool: name };
  }
  const nearby = matches.length ? matches : closeNames(wanted, served);
  const suggestion = nearby.length ? ` Close served names: ${nearby.join(", ")}.` : "";
  if (matches.length > 1) throw new Error(`Choose an exact MCP connector tool name.${suggestion}`);
  if (/^(?:sagax|agents|environment)_/.test(folded) || permissionForTool(wanted)?.source === "sagax") {
    const args = source.args ?? {};
    const path = args.path ?? ".";
    const listing = /^(?:sagax_)?environment_(?:list_files|list_directory|glob_files|glob)$/.test(folded);
    const file = /^(?:sagax_)?environment_read_file$/.test(folded);
    const relative = typeof path === "string" && path.trim() && path.length <= ROUTINE_WATCH_LIMITS.pathMaxChars
      && !/^(?:[/\\]|[a-z]:)/i.test(path) && !path.includes("\0") && !path.split(/[/\\]/).includes("..");
    const metadata = !watch.track && (!watch.condition || (watch.condition.test === "json_path"
      && ["exists", "count", "bytes"].includes(watch.condition.path.replace(/^\$\./, ""))));
    if (relative && file && args.path && Object.keys(args).every(key => key === "path" || key === "max_bytes")) {
      const bytes = args.max_bytes ?? 200_000;
      if (typeof bytes === "number" && Number.isFinite(bytes)) {
        const content = Boolean(watch.condition || watch.track || args.max_bytes !== undefined);
        return { type: "files", path, ...(content ? { readBytes: Math.min(ROUTINE_WATCH_LIMITS.maxOutputBytes, Math.max(1, Math.floor(bytes))) } : {}) };
      }
    }
    if (relative && metadata && listing && Object.keys(args).every(key =>
      key === "path" || (key === "recursive" && typeof args.recursive === "boolean")
      || (key === "pattern" && typeof args.pattern === "string" && args.pattern.length > 0 && args.pattern.length <= ROUTINE_WATCH_LIMITS.pathMaxChars))) {
      return { type: "files", path, ...(args.recursive === true || args.pattern ? { recursive: true } : {}),
        ...(typeof args.pattern === "string" ? { pattern: args.pattern } : {}) };
    }
    throw new UnmappedWatchBuiltin(`This built-in cannot run as a watch tool. Use files for file changes or command to read content where the bot works.${suggestion}`);
  }
  throw new Error(`Unknown MCP connector tool "${wanted}". Choose a name from tools/list.${suggestion}`);
}

/** Read every page on the same initialized connection. A failed listing is
 * an availability error, never evidence that a saved tool no longer exists. */
export async function watchCatalog(request: (params: Record<string, unknown>) => Promise<unknown>): Promise<string[]> {
  const names = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await request(cursor ? { cursor } : {}) as { tools?: { name: string }[]; nextCursor?: string };
    if (!Array.isArray(page?.tools)) throw new Error("The connection could not list its watch tools.");
    for (const tool of page.tools) if (typeof tool?.name === "string") names.add(tool.name);
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("The connection repeated a tool catalog page.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...names];
}
