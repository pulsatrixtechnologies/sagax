// A stable prompt for every engine, and a compact tool list for Claude Code
// on any model (#1276, extended past local models).
//
// A turn was sending the whole agents catalog (about 80,000 to 120,000
// characters, about 20,000 to 30,000 tokens) plus a system prompt whose first
// bytes changed in every conversation (the working folder, the auto memory
// path). A local model re-reads that before its first token. A cloud model
// re-prefills it on every cache miss. Production prefills of about 94,000 to
// 173,000 tokens were already measured on the cloud path.
//
// Stable prefix, every engine, unless the bot or the server says "full":
// the conversation's folder and the sections that differ between two new
// conversations ride at the end of the volatile half. Every rule and every
// section is still sent. Nothing is reworded.
//
// Compact tool list, Claude Code only (local or cloud), same switch:
// - lists the agents tools Claude Code would load up front, or, once the
//   bot's own use is known, the heart of a chat turn plus the tools it uses;
//   every other agents tool is found with search_tools and run with
//   call_tool (agents-proxy.ts);
// - gates every MCP server the bot owns with the gate's own search
//   (mcp-gate-search.ts): a big catalog lists whole only the tools this bot
//   used, the rest are searched;
// - keeps Claude Code's auto memory in one folder per bot and person.
//   Notes already written in Claude Code's own project folder are copied
//   in once (adoptLegacyAutoMemory). localPrompt full on the bot, or
//   SAGAX_LOCAL_PROMPT=full, leaves that folder unset, so Claude Code
//   reads its own project memory again;
// - turns Claude Code's own tool search off, so what is listed is exactly
//   what Sagax lists, in the same order every time.
// Other engines keep the full tools/list. Grok, Codex and Pi discover a tool
// from that list. Hiding one there would make it unreachable. Approvals on
// Claude Code still read the tool a call_tool runs.
import { createHash } from "node:crypto";
import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { CompactPromptInput } from "../contracts.ts";
import { isPiLocalModel } from "../models/pi-local-model.ts";

export type LocalPromptMode = "compact" | "full";

/** System prompt sections that ride the volatile half (the first message of
 * a conversation) in a compact turn: the conversation's own folder, the one
 * line of the file locations that differs in every conversation. The rest of
 * the file locations stays in the cached system prompt. */
export const COMPACT_VOLATILE_SECTIONS: ReadonlySet<string> = new Set(["files-cwd"]);

/** Volatile sections that differ between two new conversations of the same
 * bot: in a compact turn they go last in the volatile half, so everything
 * before them (workplace rules, reach, model) is the same bytes in every new
 * conversation and a local model's prefix cache serves it. */
export const COMPACT_VOLATILE_LAST: readonly string[] = ["recent", "stream", "files-cwd"];

/** The volatile half of a compact turn, with the per-conversation sections
 * last (COMPACT_VOLATILE_LAST order). Nothing is dropped or changed. */
export function compactVolatileOrder<T extends { volatile: string; volatileSections: Array<{ id: string; text: string }> }>(prompt: T): T {
  const rank = (id: string) => COMPACT_VOLATILE_LAST.indexOf(id);
  const sections = prompt.volatileSections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => (rank(a.section.id) - rank(b.section.id)) || (a.index - b.index))
    .map(({ section }) => section);
  return { ...prompt, volatileSections: sections, volatile: sections.map((section) => section.text).join("") };
}

/** Stable prefix for every engine. Off only when the bot or the server says
 * "full", which also restores the full tool list on Claude Code. */
export function usesStablePrompt(input: { bot?: LocalPromptMode; engine?: LocalPromptMode }): boolean {
  return input.bot !== "full" && input.engine !== "full";
}

/** Compact tool list: Claude Code, local or cloud. Other engines find tools
 * from the full tools/list, so they stay on that list. `model` is accepted
 * and ignored: the list does not depend on which model the engine runs. */
export function usesCompactPrompt(input: {
  driverKind: string | undefined;
  model?: string | null;
  bot?: LocalPromptMode;
  engine?: LocalPromptMode;
}): boolean {
  // #1276: pi too, on a model of a local host only (a cloud model keeps its list).
  if (input.driverKind === "piAgent") return isPiLocalModel(input.driverKind, input.model) && usesStablePrompt(input);
  if (input.driverKind !== "claudeAgent") return false;
  return usesStablePrompt(input);
}

/** A stored setting, or undefined. */
export function parseLocalPromptMode(value: unknown): LocalPromptMode | undefined {
  return value === "compact" || value === "full" ? value : undefined;
}

/** One tool call the bot made, as its activity row names it. */
export interface ToolUse {
  /** `mcp__<server>__<tool>`, a Claude Code built-in, or another engine's name */
  name: string;
}

/** How often the bot called each MCP tool, by server then tool. */
export function toolUsage(uses: Iterable<ToolUse>): Map<string, Map<string, number>> {
  const byServer = new Map<string, Map<string, number>>();
  for (const use of uses) {
    const name = use.name;
    if (!name.startsWith("mcp__")) continue;
    const rest = name.slice("mcp__".length);
    const split = rest.indexOf("__");
    if (split <= 0) continue;
    const server = rest.slice(0, split);
    const tool = rest.slice(split + 2);
    if (!tool || tool === "search_tools" || tool === "describe_tool" || tool === "call_tool") continue;
    const tools = byServer.get(server) ?? new Map<string, number>();
    tools.set(tool, (tools.get(tool) ?? 0) + 1);
    byServer.set(server, tools);
  }
  return byServer;
}

/** A bot whose agents use is known: this many recorded agents calls. Below
 * it, the agents catalog lists what Claude Code would load up front. */
export const KNOWN_USE_CALLS = 20;
/** A tool used at least this often is listed whole. */
export const PIN_MIN_USES = 1;
/** At most this many tools of one server are listed whole. */
export const PINNED_PER_SERVER_MAX = 12;

function topTools(tools: Map<string, number> | undefined, max = PINNED_PER_SERVER_MAX): string[] {
  if (!tools) return [];
  return [...tools]
    .filter(([, count]) => count >= PIN_MIN_USES)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, max)
    .map(([name]) => name)
    // the list rides the prompt: sorted, so the same use gives the same bytes
    .sort();
}

/** What a compact turn lists whole, from the bot's own recorded calls. */
export function compactPins(usage: Map<string, Map<string, number>>, servers: readonly string[]): Pick<CompactPromptInput, "agents" | "pinned"> {
  const agents = usage.get("agents");
  const agentsCalls = agents ? [...agents.values()].reduce((sum, count) => sum + count, 0) : 0;
  const pinned: Record<string, string[]> = {};
  for (const server of [...servers].sort()) {
    const tools = topTools(usage.get(server));
    if (tools.length) pinned[server] = tools;
  }
  return {
    agents: { core: agentsCalls >= KNOWN_USE_CALLS ? "used" : "default", pinned: topTools(agents) },
    pinned,
  };
}

/** Claude Code's auto memory folder for one bot and one person: the same in
 * every conversation they have, never shared with another person. */
export function compactMemoryDir(dataDir: string, botId: string, person: string): string {
  const key = createHash("sha256").update(`${botId}\u0000${person.trim().toLowerCase()}`).digest("hex").slice(0, 32);
  return join(dataDir, "claude-auto-memory", key);
}

/** Claude Code's project key: every character that is not a letter or a
 * digit becomes a hyphen. `/Users/a/b` is `-Users-a-b`. */
export function claudeProjectKey(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** Where Claude Code kept auto memory for one working folder before the
 * compact prompt named a folder of its own. */
export function legacyClaudeAutoMemoryDir(configDir: string, cwd: string): string {
  return join(configDir, "projects", claudeProjectKey(cwd), "memory");
}

/** Copy notes already in Claude Code's project memory into the compact
 * folder. A file the compact folder already has is left as it is. A symlink
 * is not followed. Missing source is a no-op. Returns the names copied. */
export function adoptLegacyAutoMemory(memoryDir: string, legacyDir: string): string[] {
  const from = resolve(legacyDir);
  const to = resolve(memoryDir);
  if (from === to) return [];
  let names: string[];
  try {
    if (!lstatSync(from).isDirectory()) return [];
    names = readdirSync(from);
  } catch {
    return [];
  }
  mkdirSync(to, { recursive: true, mode: 0o700 });
  const copied: string[] = [];
  for (const name of names) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) continue;
    const source = join(from, name);
    const dest = join(to, name);
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(source); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    try {
      copyFileSync(source, dest, constants.COPYFILE_EXCL);
      copied.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return copied;
}
