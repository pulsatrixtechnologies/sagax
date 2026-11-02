// Engine-safe MCP tool names: never drop a connector tool.
//
// Grok (xai-grok-mcp `qualify_mcp_tool_name`, grok 1.0.50 user guide,
// 07-mcp-servers.md "What Grok admits") names an MCP tool `server__tool` and
// SKIPS any tool whose qualified key is not admissible: a tool name with a
// second `__` (`cw_psa__query` from Perspicax), a leading `_` (makes `___`),
// a character outside [A-Za-z0-9_-] (dots, colons), or a key over 256
// characters. Skipped tools vanished from the bot with one log line inside
// the CLI; on 2026-10-11 every Perspicax profile lost cw_psa__query,
// cw_psa__write and cw_psa__action that way.
//
// The gate (mcp-gate.ts) now renames such a tool to an admissible alias and
// keeps an explicit alias -> upstream name map, so a call is never re-split
// or guessed back: `use_tool <server>__cw_psa_query` runs `cw_psa__query`.
// Aliases are deterministic (same catalog, same names, every turn), never
// collide with another tool, and every advertised tool gets exactly one
// registered name. `toolNameParity` proves that bijection; the gate refuses
// to pass a catalog that would lose a tool silently.
import { createHash } from "node:crypto";

/** Grok's catalog key cap (characters of `server__tool`). */
export const GROK_MAX_QUALIFIED = 256;
const SERVER = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const TOOL = /^[A-Za-z0-9_-]+$/;

export type ToolNameProblem = "invalid_server" | "invalid_characters" | "double_underscore" | "leading_underscore" | "trailing_underscore" | "too_long" | "empty" | "collision";

/** Whether Grok admits `server__tool` into its catalog, and if not, why. */
export function grokToolNameProblem(server: string, tool: string): ToolNameProblem | undefined {
  if (!SERVER.test(server) || server.includes("__") || server.endsWith("_")) return "invalid_server";
  if (!tool) return "empty";
  if (!TOOL.test(tool)) return "invalid_characters";
  if (tool.includes("__")) return "double_underscore";
  if (tool.startsWith("_")) return "leading_underscore";
  if (`${server}__${tool}`.length > GROK_MAX_QUALIFIED) return "too_long";
  return undefined;
}

function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/** The admissible base for one name: other characters become `-`, runs of
 * `_` one `_`, no leading `_`, cut to fit with a hash of the original. */
export function grokAliasBase(server: string, tool: string): string {
  let base = tool.replace(/[^A-Za-z0-9_-]/g, "-").replace(/_{2,}/g, "_").replace(/^_+/, "");
  if (!base) base = `tool-${shortHash(tool)}`;
  const room = GROK_MAX_QUALIFIED - server.length - 2;
  if (base.length > room) base = `${base.slice(0, Math.max(1, room - 9)).replace(/_+$/, "")}-${shortHash(tool)}`;
  return base;
}

export interface ToolRename { upstream: string; registered: string; reason: ToolNameProblem }
export interface ToolNamePlan {
  /** upstream name -> registered name, for every advertised tool */
  registered: Map<string, string>;
  renamed: ToolRename[];
  /** tools no admissible name could be found for (only an invalid server name) */
  unregistrable: Array<{ upstream: string; reason: ToolNameProblem }>;
}

/** Plan registered names for a whole catalog. Admissible names keep their
 * name; the rest get a deterministic alias that collides with nothing.
 * `previous` keeps names stable across pages and re-lists. */
export function planToolNames(server: string, names: readonly string[], previous?: ReadonlyMap<string, string>): ToolNamePlan {
  const registered = new Map<string, string>();
  const renamed: ToolRename[] = [];
  const unregistrable: ToolNamePlan["unregistrable"] = [];
  const taken = new Set<string>(previous?.values() ?? []);
  const unique = [...new Set(names)];
  if (grokToolNameProblem(server, "x")) {
    for (const upstream of unique) unregistrable.push({ upstream, reason: "invalid_server" });
    return { registered, renamed, unregistrable };
  }
  // Admissible names first: an original name always wins over an alias.
  const pending: string[] = [];
  for (const upstream of unique) {
    const kept = previous?.get(upstream);
    if (kept !== undefined) { registered.set(upstream, kept); continue; }
    if (!grokToolNameProblem(server, upstream) && !taken.has(upstream)) {
      registered.set(upstream, upstream);
      taken.add(upstream);
    } else pending.push(upstream);
  }
  for (const name of unique) if (!grokToolNameProblem(server, name)) taken.add(name);
  for (const upstream of pending.sort()) {
    const reason = grokToolNameProblem(server, upstream) ?? "collision";
    const base = grokAliasBase(server, upstream);
    let alias = base;
    const room = GROK_MAX_QUALIFIED - server.length - 2;
    for (let i = 0; taken.has(alias) || grokToolNameProblem(server, alias); i++) {
      const suffix = `-${shortHash(upstream)}${i ? `-${i}` : ""}`;
      alias = `${base.slice(0, room - suffix.length).replace(/_+$/, "")}${suffix}`;
      if (i > 50) break;
    }
    if (taken.has(alias) || grokToolNameProblem(server, alias)) {
      unregistrable.push({ upstream, reason });
      continue;
    }
    taken.add(alias);
    registered.set(upstream, alias);
    renamed.push({ upstream, registered: alias, reason });
  }
  return { registered, renamed, unregistrable };
}

/** The bijection check: every advertised tool has exactly one admissible
 * registered name and no two tools share one. Empty means parity. */
export function toolNameParity(server: string, advertised: readonly string[], registered: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const upstream of new Set(advertised)) {
    const name = registered.get(upstream);
    if (name === undefined) { problems.push(`${upstream}: not registered`); continue; }
    const why = grokToolNameProblem(server, name);
    if (why) problems.push(`${upstream}: registered as ${name}, which Grok skips (${why})`);
    const other = seen.get(name);
    if (other !== undefined) problems.push(`${upstream}: registered as ${name}, already used by ${other}`);
    seen.set(name, upstream);
  }
  return problems;
}

/** One gate's live map. `catalog` rewrites a tools/list page, `upstream`
 * resolves a called name through the map (never by splitting). */
export class ToolNameAliases {
  private readonly toRegistered = new Map<string, string>();
  private readonly toUpstream = new Map<string, string>();
  private readonly server: string;
  constructor(server: string) { this.server = server; }

  catalog<T extends { name: string; description?: unknown }>(tools: readonly T[]): { tools: T[]; renamed: ToolRename[]; unregistrable: ToolNamePlan["unregistrable"]; parity: string[] } {
    const names = tools.map((tool) => tool.name);
    const plan = planToolNames(this.server, names, this.toRegistered);
    for (const [upstream, name] of plan.registered) {
      this.toRegistered.set(upstream, name);
      this.toUpstream.set(name, upstream);
    }
    const out = tools.map((tool) => {
      const name = this.toRegistered.get(tool.name);
      if (name === undefined || name === tool.name) return tool;
      // The registered name is the only one that runs: Grok answers a call
      // to `${server}__${upstream}` with "Tool not found" before it reaches
      // the gate (2026-11-02, routines on Perspicax profiles).
      const note = `(Call it as ${name}; the connector's own name ${tool.name} cannot be called here.)`;
      return { ...tool, name, description: typeof tool.description === "string" && tool.description ? `${tool.description} ${note}` : note };
    });
    const parity = toolNameParity(this.server, names.filter((name) => !plan.unregistrable.some((entry) => entry.upstream === name)), this.toRegistered);
    return { tools: out, renamed: plan.renamed, unregistrable: plan.unregistrable, parity };
  }

  upstream(name: string): string {
    return this.toUpstream.get(name) ?? name;
  }
}
