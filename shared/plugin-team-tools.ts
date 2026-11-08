/** A plugin agent's frontmatter `tools` as a real per-bot tool selection
 * (#2669, decided 2026-11-07: "mappe tools en vraie restriction").
 *
 * Claude Code names (Read, Edit, Bash, mcp__server__tool...) become the
 * selectors of shared/tool-scope.ts for the engine the bot runs on:
 * - Pi and Grok Build narrow their native tools to the mapped names;
 * - an engine that gates only MCP (Claude, Codex...) keeps `native:*` and
 *   narrows the MCP servers; the note says the native list is not enforced;
 * - Sagax's own servers (agents, data, messages) always stay, so the bot
 *   can still work with its team.
 * No `tools` in the frontmatter: no selection (the bot keeps every tool). */
import { TOOL_SCOPE_SUPPORT } from "./tool-scope-support.ts";
import { MCP_SERVER_NAME, type ToolScope } from "./tool-scope.ts";

const SAGAX_CORE = ["mcp:agents:*", "mcp:data:*", "mcp:messages:*"];

const PI_NAMES: Record<string, string[]> = {
  Read: ["read"], Write: ["write"], Edit: ["edit"], MultiEdit: ["edit"], NotebookEdit: ["edit"],
  Bash: ["bash", "powershell"], Grep: ["grep"], Glob: ["find"], LS: ["ls"],
};
const GROK_NAMES: Record<string, string[]> = {
  Read: ["read_file"], Write: ["write"], Edit: ["search_replace"], MultiEdit: ["search_replace"], NotebookEdit: ["search_replace"],
  Bash: ["run_terminal_command", "get_command_or_subagent_output", "kill_command_or_subagent"], Grep: ["grep"], Glob: ["list_dir"], LS: ["list_dir"],
  Task: ["spawn_subagent", "get_command_or_subagent_output"], Agent: ["spawn_subagent", "get_command_or_subagent_output"], TodoWrite: ["todo_write"],
};

export interface PluginToolScope {
  /** Undefined: the bot keeps every tool. */
  scope?: ToolScope;
  /** What could not be enforced, in plain words. */
  notes: string[];
}

/** `mcp__server__tool` or `mcp__server` as a selector, or null. */
function mcpSelector(name: string): string | null | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const [server = "", ...rest] = name.slice(5).split("__");
  const normalized = server.toLowerCase();
  if (!MCP_SERVER_NAME.test(normalized)) return null;
  const tool = rest.join("__");
  return `mcp:${normalized}:${tool && tool !== "*" ? tool : "*"}`;
}

export function pluginAgentToolScope(tools: readonly string[], engine: string | undefined): PluginToolScope {
  if (!tools.length) return { notes: [] };
  const notes: string[] = [];
  const mcp = new Set<string>(SAGAX_CORE);
  const native = new Set<string>();
  const unmapped: string[] = [];
  const support = engine ? TOOL_SCOPE_SUPPORT[engine as keyof typeof TOOL_SCOPE_SUPPORT] : undefined;
  const table = engine === "piAgent" ? PI_NAMES : engine === "grokAgent" || engine === "grok" ? GROK_NAMES : undefined;
  for (const tool of tools) {
    const selector = mcpSelector(tool);
    if (selector === null) { unmapped.push(tool); continue; }
    if (selector) { mcp.add(selector); continue; }
    if (!table) continue;
    const mapped = table[tool];
    if (mapped) for (const name of mapped) native.add(`native:${name}`);
    else unmapped.push(tool);
  }
  if (!support) {
    notes.push(`the tool list (${tools.join(", ")}) is not enforced on this engine; it stays in the instructions`);
    return { notes };
  }
  if (support !== "native-and-mcp" || !table) {
    native.clear();
    native.add("native:*");
    const natives = tools.filter((tool) => !tool.startsWith("mcp__"));
    if (natives.length) notes.push(`this engine does not narrow its built-in tools, so ${natives.join(", ")} stay a guideline in the instructions; app tools are restricted`);
    const badServers = unmapped.filter((tool) => tool.startsWith("mcp__"));
    if (badServers.length) notes.push(`no app server matches ${badServers.join(", ")}`);
  } else if (unmapped.length) {
    notes.push(`no matching built-in tool on this engine for ${unmapped.join(", ")}`);
  }
  return { scope: { allow: [...native, ...mcp] }, notes };
}
