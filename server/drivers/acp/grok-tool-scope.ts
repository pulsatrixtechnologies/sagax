// Grok tool selection: the agent profile Grok inherits from disk, and the
// curated registry a tool scope builds from it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCliString } from "../../env-path.ts";
import { allowsTool, parseToolScope } from "../../../shared/tool-scope.ts";
import { grokAliasBase, grokToolNameProblem } from "../../mcp/mcp-tool-names.ts";
import { grokHome } from "./grok.ts";

export interface GrokToolConfig { id: string; name_override?: string; [key: string]: unknown }
export interface GrokScopeProfile {
  name: string;
  description: string;
  toolConfig: { tools: GrokToolConfig[]; [key: string]: unknown };
  injectDefaultTools?: boolean;
  tools?: string[];
  disallowedTools?: string[];
  [key: string]: unknown;
}

// Original names in the official 1.0.41 default registry, not arbitrary
// owner strings forwarded into Grok's inherit-all profile allowlist.
const GROK_NATIVE_TOOLS = [
  ["read_file", "GrokBuild:read_file"], ["search_replace", "GrokBuild:search_replace"], ["write", "OpenCode:write"],
  ["run_terminal_command", "GrokBuild:run_terminal_cmd"], ["list_dir", "GrokBuild:list_dir"], ["grep", "GrokBuild:grep"],
  ["kill_command_or_subagent", "GrokBuild:kill_task"], ["todo_write", "GrokBuild:todo_write"],
  ["get_command_or_subagent_output", "GrokBuild:get_task_output"], ["spawn_subagent", "GrokBuild:task"],
  ["scheduler_create", "GrokBuild:scheduler_create"], ["scheduler_delete", "GrokBuild:scheduler_delete"], ["scheduler_list", "GrokBuild:scheduler_list"],
  ["monitor", "GrokBuild:monitor"], ["search_tool", "GrokBuild:search_tool"], ["use_tool", "GrokBuild:use_tool"],
  ["workflow", "GrokBuild:workflow"], ["enter_plan_mode", "GrokBuild:enter_plan_mode"], ["exit_plan_mode", "GrokBuild:exit_plan_mode"],
  ["ask_user_question", "GrokBuild:ask_user_question"], ["send_feedback", "GrokBuild:send_feedback"],
  ["image_gen", "GrokBuild:image_gen"], ["image_edit", "GrokBuild:image_edit"],
  ["image_to_video", "GrokBuild:image_to_video"], ["reference_to_video", "GrokBuild:reference_to_video"],
] as const;

/** Read a supported on-disk profile rather than overriding its restriction. */
export function grokInheritedProfile(cli: string, env: Record<string, string | undefined>, cwd: string): GrokScopeProfile | undefined {
  const unsupported = () => { throw new Error("Grok's existing agent profile cannot be safely intersected with tool selection. Use a profile file with explicit tools or a separate default Grok account."); };
  if ((env.GROK_AGENT && env.GROK_AGENT !== "grok-build") || env.GROK_CONFIG || env.GROK_CONFIG_PATH) return unsupported();
  const args = splitCliString(cli);
  // Operator filters are applied after ACP's profile by the CLI. Refuse
  // unverified overrides rather than replacing an inherited restriction.
  if (args.some(arg => /^(--tools|--disallowed-tools|--disallowedTools|--agent)(=|$)/.test(arg))) return unsupported();
  const flags = args.flatMap((arg, index) => arg === "--agent-profile" || arg.startsWith("--agent-profile=") ? [index] : []);
  if (flags.length > 1) return unsupported();
  const flag = flags[0] ?? -1;
  let path = flag >= 0 ? (args[flag]!.includes("=") ? args[flag]!.slice(args[flag]!.indexOf("=") + 1) : args[flag + 1]) : undefined;
  if (flag >= 0 && (!path || path.startsWith("-"))) return unsupported();
  const files = [join(grokHome(env), "config.toml")];
  for (let directory = resolve(cwd);;) {
    const file = join(directory, ".grok", "config.toml"); if (!files.includes(file)) files.push(file);
    const parent = dirname(directory); if (parent === directory) break; directory = parent;
  }
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8"); if (text.length > 262_144) return unsupported();
    // Support a deliberately small, unambiguous TOML subset. Scan the whole
    // file: quoted/dotted keys, inline agent tables and multiline constructs
    // must never be silently missed by a section regex. Unsupported syntax
    // refuses this scoped turn; ordinary unrestricted turns are unaffected.
    let section = "";
    for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"))) {
      const header = /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]\s*(?:#.*)?$/.exec(line);
      if (header) { section = header[1]!; if (section.startsWith("agent.")) return unsupported(); continue; }
      const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
      if (!assignment || /'''|"""/.test(assignment[2]!) || (!section && assignment[1] === "agent")) return unsupported();
      if (section !== "agent") continue;
      const match = /^(name|definition)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
      if (!match) return unsupported();
      let value: string;
      try { value = match[2]!.startsWith('"') ? JSON.parse(match[2]!) as string : match[2]!.slice(1, -1); }
      catch { return unsupported(); }
      // Grok expands environment variables in paths. Do not resolve a
      // different literal file or fall back when that contract is unknown.
      if (value.includes("$") || !value) return unsupported();
      if (match[1] === "name" && value !== "grok-build") return unsupported();
      if (match[1] === "definition" && flag < 0) {
        if (path !== undefined && path !== value) return unsupported();
        path = value;
      }
    }
  }
  if (!path) return;
  const text = readFileSync(resolve(cwd, path), "utf8"); if (text.length > 262_144) return unsupported();
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/.exec(text);
  if (!match) return unsupported();
  const profile = parseYaml(match[1]!) as Partial<GrokScopeProfile> | null;
  if (!profile || typeof profile.name !== "string" || typeof profile.description !== "string"
    || (profile.tools !== undefined && (!Array.isArray(profile.tools) || !profile.tools.every((tool) => typeof tool === "string")))
    || (profile.disallowedTools !== undefined && (!Array.isArray(profile.disallowedTools) || !profile.disallowedTools.every((tool) => typeof tool === "string")))) return unsupported();
  const toolConfig = profile.toolConfig ?? { tools: GROK_NATIVE_TOOLS.map(([name, id]) => ({ id, name_override: name })) };
  if (!Array.isArray(toolConfig.tools) || !toolConfig.tools.every((tool) => typeof tool?.id === "string" && (tool.name_override === undefined || typeof tool.name_override === "string"))) return unsupported();
  return { ...profile, name: profile.name, description: profile.description, toolConfig, ...(match[2]?.trim() ? { promptBody: match[2].trim() } : {}) };
}

/** Whether a tool Grok registered is one the selection allows. The gate
 * filters by the connector's own names and then registers a name Grok cannot
 * qualify (`cw_psa_query`) under its alias (mcp-tool-names.ts), so an alias
 * of an allowed name is allowed. Deny selectors were applied in the gate. */
export function allowsRegisteredTool(scope: unknown, server: string, name: string): boolean {
  if (allowsTool(scope, { kind: "mcp", server, name })) return true;
  const parsed = parseToolScope(scope);
  if (!parsed.ok || !parsed.scope?.allow) return false;
  return parsed.scope.allow.some((selector) => {
    const prefix = `mcp:${server}:`;
    if (!selector.startsWith(prefix)) return false;
    const allowed = selector.slice(prefix.length);
    if (allowed === "*") return true;
    if (!grokToolNameProblem(server, allowed)) return false;
    const base = grokAliasBase(server, allowed);
    return name === base || name.startsWith(`${base}-`);
  }) && !parsed.scope.deny?.some((selector) => selector === `mcp:${server}:${name}`);
}

/** A curated registry: empty/unknown selections never inherit Grok's defaults. */
export function grokToolScopeProfile(scope: unknown, init: unknown, inherited?: GrokScopeProfile, hasMcp = false): GrokScopeProfile {
  const parsed = parseToolScope(scope);
  if (!parsed.ok) throw new Error(parsed.error);
  const meta = (init as { _meta?: { grokShell?: unknown; agentVersion?: unknown } } | null)?._meta;
  if (meta?.grokShell !== true || meta.agentVersion !== "1.0.41") {
    throw new Error("This Grok runtime does not have verified native tool selection. Use Grok 1.0.41 or Pi; update Grok support before using another version.");
  }
  if (hasMcp && (!allowsTool(scope, { kind: "native", name: "search_tool" }) || !allowsTool(scope, { kind: "native", name: "use_tool" }))) {
    throw new Error("Grok requires native:search_tool and native:use_tool to find and call selected MCP tools. Allow both explicitly or use Pi.");
  }
  const candidates = inherited?.toolConfig.tools ?? GROK_NATIVE_TOOLS.map(([name, id]) => ({ id, name_override: name }));
  const selected = candidates.filter((tool) => {
    const name = tool.name_override ?? GROK_NATIVE_TOOLS.find(([, id]) => id === tool.id)?.[0];
    return name !== undefined && allowsTool(scope, { kind: "native", name })
      && (!inherited?.tools?.length || inherited.tools.includes(name) || inherited.tools.includes(tool.id))
      && !inherited?.disallowedTools?.some((denied) => denied === name || denied === tool.id);
  });
  // Grok rejects an empty curated construction. A real read entry explicitly
  // disabled by its exact native name constructs an empty final registry.
  return {
    ...inherited, name: inherited?.name ?? "openmausbot-tools", description: inherited?.description ?? "Owner-selected tools",
    injectDefaultTools: false, discoverSkills: false,
    toolConfig: { ...inherited?.toolConfig, tools: selected.length ? selected : [{ id: "GrokBuild:read_file", name_override: "read_file" }] },
    tools: [], disallowedTools: [...new Set([...(inherited?.disallowedTools ?? []), ...(selected.length ? [] : ["read_file"])])],
  };
}
