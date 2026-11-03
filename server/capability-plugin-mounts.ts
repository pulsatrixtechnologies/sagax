// Plugin priority is shared by execution and the capabilities receipt.
// A declaration without a current folder never claims a plugin name.
import type { McpServerSpec } from "./contracts.ts";
import { parseStoredMcpServer } from "./mcp-registry.ts";
import { SANDBOX_PLUGINS_DIR } from "./sandbox/sandbox-plugins.ts";

export type PluginScope = "organization" | "person" | "bot";
export interface PluginFolder { name: string; dir: string }

export function selectPluginScopes<T extends PluginFolder>(input: {
  organization: readonly T[];
  person: readonly T[];
  bot: readonly T[];
}): Array<T & { scope: PluginScope }> {
  const names = new Set<string>();
  const selected: Array<T & { scope: PluginScope }> = [];
  for (const scope of ["organization", "person", "bot"] as const) {
    for (const plugin of input[scope]) {
      if (names.has(plugin.name)) continue;
      names.add(plugin.name);
      selected.push({ ...plugin, scope });
    }
  }
  return selected;
}

export type PluginMcpSkip = "name_taken" | "reserved" | "invalid" | "no_environment";

/** The exact name check used by the runtime and its read-only receipt. */
export function pluginMcpPrecheck(name: string, spec: McpServerSpec, input: {
  taken: (name: string) => boolean;
  organization: boolean;
  hasEnvironment: boolean;
}): PluginMcpSkip | null {
  if (input.taken(name)) return "name_taken";
  const parsed = parseStoredMcpServer(name, spec);
  if (!parsed.ok) return /reserved/i.test(parsed.error) ? "reserved" : "invalid";
  if (input.organization && !("url" in spec) && !input.hasEnvironment) return "no_environment";
  return null;
}

/** Install records keep the environment-relative plugin root. A solo
 * computer executes its own plugin at its real folder instead. */
export function pluginSpecOnComputer(spec: McpServerSpec, plugin: PluginFolder): McpServerSpec {
  const from = `${SANDBOX_PLUGINS_DIR}/${plugin.name}`;
  const text = (value: string) => value.replaceAll(from, plugin.dir);
  if ("url" in spec) return { ...spec, url: text(spec.url), headers: Object.fromEntries(Object.entries(spec.headers).map(([key, value]) => [key, text(value)])) };
  return { ...spec, command: text(spec.command), args: spec.args.map(text), env: Object.fromEntries(Object.entries(spec.env).map(([key, value]) => [key, text(value)])) };
}
