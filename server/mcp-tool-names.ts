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

/** A connector tool name with a second `__` as it appears in text
 * (`cw_psa__query`, `cw_psa_time__entries_write`): starts with a letter or
 * digit, and no name character touches it on either side. */
const DOUBLE_UNDERSCORE_NAME = /(?<![A-Za-z0-9_-])[A-Za-z0-9][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)*__[A-Za-z0-9-]+(?:_{1,2}[A-Za-z0-9-]+)*(?![A-Za-z0-9_-])/g;
const NAME_CHAR = "A-Za-z0-9_-";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every string value in a JSON value through `map`; keys and other values
 * are kept. Returns the same object when nothing changed. */
export function mapJsonStrings(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => { const next = mapJsonStrings(item, map); if (next !== item) changed = true; return next; });
    return changed ? out : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = mapJsonStrings(item, map);
      if (next !== item) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

/** One gate's live map. `catalog` rewrites a tools/list page, `upstream`
 * resolves a called name through the map (never by splitting).
 *
 * 2026-11-02: the bot must never see a connector name Grok cannot call.
 * Perspicax's instructions, its api_search / api_describe / api_list
 * results and its error texts name `cw_psa__query`; a Grok bot copied it,
 * called `<server>__cw_psa__query` and Grok answered "Tool not found"
 * before the call reached the gate. `toAliases` rewrites those names to the
 * registered alias (a pure name mapping, nothing else in the text changes)
 * and `argumentsToUpstream` maps an alias passed as an argument value
 * (api_describe's `name`, api_plan's steps, flow_action's `tool`) back. */
export class ToolNameAliases {
  private readonly toRegistered = new Map<string, string>();
  private readonly toUpstream = new Map<string, string>();
  /** connector name -> alias, only for the tools that were renamed */
  private readonly renamedNames = new Map<string, string>();
  private renamedPattern: RegExp | undefined;
  /** Names rewritten in the instructions before the catalog was known. */
  private readonly predicted = new Map<string, string>();
  private readonly server: string;
  constructor(server: string) { this.server = server; }

  catalog<T extends { name: string; description?: unknown; inputSchema?: unknown }>(tools: readonly T[]): { tools: T[]; renamed: ToolRename[]; unregistrable: ToolNamePlan["unregistrable"]; parity: string[]; predictionMismatches: string[] } {
    const names = tools.map((tool) => tool.name);
    const plan = planToolNames(this.server, names, this.toRegistered);
    for (const [upstream, name] of plan.registered) {
      this.toRegistered.set(upstream, name);
      this.toUpstream.set(name, upstream);
      if (name !== upstream) this.renamedNames.set(upstream, name);
    }
    this.renamedPattern = undefined;
    const out = tools.map((tool) => {
      const name = this.toRegistered.get(tool.name) ?? tool.name;
      const description = typeof tool.description === "string" ? this.toAliases(tool.description) : tool.description;
      const inputSchema = tool.inputSchema === undefined ? undefined : mapJsonStrings(tool.inputSchema, (text) => this.toAliases(text));
      if (name === tool.name && description === tool.description && inputSchema === tool.inputSchema) return tool;
      return { ...tool, name, ...(description === undefined ? {} : { description }), ...(inputSchema === undefined ? {} : { inputSchema }) };
    });
    const parity = toolNameParity(this.server, names.filter((name) => !plan.unregistrable.some((entry) => entry.upstream === name)), this.toRegistered);
    const predictionMismatches: string[] = [];
    for (const [upstream, alias] of this.predicted) {
      const actual = this.toRegistered.get(upstream);
      if (actual !== undefined && actual !== alias) predictionMismatches.push(`${upstream}: instructions say ${alias}, registered as ${actual}`);
    }
    return { tools: out, renamed: plan.renamed, unregistrable: plan.unregistrable, parity, predictionMismatches };
  }

  upstream(name: string): string {
    return this.toUpstream.get(name) ?? name;
  }

  /** Text with every renamed connector tool name replaced by its alias.
   * A name that was not renamed, and any other text, stays as it is. */
  toAliases(text: string): string {
    if (!this.renamedNames.size || !text.includes("__")) return text;
    if (!this.renamedPattern) {
      const names = [...this.renamedNames.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
      this.renamedPattern = new RegExp(`(?<![${NAME_CHAR}])(?:${names.join("|")})(?![${NAME_CHAR}])`, "g");
    }
    return text.replace(this.renamedPattern, (name) => this.renamedNames.get(name) ?? name);
  }

  /** The server's instructions, which come before any catalog: a connector
   * name Grok cannot register gets the alias the catalog will give it (the
   * same deterministic rule, planToolNames); the catalog reports any name it
   * registered differently. Once a catalog is known, its map is used. */
  instructionsToAliases(text: string): string {
    if (this.renamedNames.size) return this.toAliases(text);
    return text.replace(DOUBLE_UNDERSCORE_NAME, (name) => {
      if (!grokToolNameProblem(this.server, name.replace(/_{2,}/g, "_")) && grokToolNameProblem(this.server, name) === "double_underscore") {
        const alias = grokAliasBase(this.server, name);
        this.predicted.set(name, alias);
        return alias;
      }
      return name;
    });
  }

  /** Call arguments with every string value that is exactly a renamed
   * tool's alias mapped back to the connector name. */
  argumentsToUpstream(args: unknown): unknown {
    if (!this.renamedNames.size && !this.predicted.size) return args;
    return mapJsonStrings(args, (text) => {
      const upstream = this.toUpstream.get(text);
      if (upstream !== undefined && upstream !== text) return upstream;
      for (const [name, alias] of this.predicted) if (alias === text && !this.toUpstream.has(text)) return name;
      return text;
    });
  }
}
