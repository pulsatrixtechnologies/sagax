// Built-in plugins (shared/builtin-plugins.ts) as plugin MCP servers of a
// bot: they ride the same path as an installed plugin's servers
// (scopedPluginMcp → mountPluginMcp → integrations.custom on the desktop,
// personalStdioIntegration → the person's sandbox on an organization).
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { BUILTIN_PLUGINS, builtinPluginEnabled, type BuiltinPlugin } from "../../shared/builtin-plugins.ts";
import type { McpServerSpec } from "../contracts.ts";

export interface BuiltinPluginMcp {
  key: BuiltinPlugin["key"];
  plugin: BuiltinPlugin["id"];
  name: string;
  spec: McpServerSpec;
  dir: "";
  scope: "bot";
}

/** The command's absolute path on PATH, or null. */
export function commandOnPath(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const exts = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(platform === "win32" ? ";" : delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      try {
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch { /* next */ }
    }
  }
  return null;
}

/** A fresh copy of a built-in's launch spec (callers may rewrite it). */
export function builtinPluginSpec(plugin: BuiltinPlugin): McpServerSpec {
  return { command: plugin.spec.command, args: [...plugin.spec.args], env: { ...plugin.spec.env } } as McpServerSpec;
}

/** The built-in MCP servers this bot mounts: on for the bot, and, on the
 * desktop, a runtime to start them (an organization runs them in the
 * person's sandbox, whose relay answers a missing runtime itself). */
export function builtinPluginMcp(
  bot: { builtinPlugins?: Record<string, boolean> } | null | undefined,
  options: { runtimeMissing?: (plugin: BuiltinPlugin) => boolean } = {},
): BuiltinPluginMcp[] {
  return BUILTIN_PLUGINS.flatMap((plugin) => builtinPluginEnabled(bot, plugin.id) && !options.runtimeMissing?.(plugin)
    ? [{ key: plugin.key, plugin: plugin.id, name: plugin.mcpName, spec: builtinPluginSpec(plugin), dir: "" as const, scope: "bot" as const }]
    : []);
}

/** Desktop runtime check, cached for a minute so a turn never walks PATH
 * twice and installing Node is noticed without a restart. */
export function createRuntimeCheck(lookup: (command: string) => string | null = (command) => commandOnPath(command), ttlMs = 60_000) {
  const cache = new Map<string, { at: number; found: boolean }>();
  return (plugin: BuiltinPlugin): boolean => {
    const now = Date.now();
    const hit = cache.get(plugin.runtime.command);
    if (hit && now - hit.at < ttlMs) return !hit.found;
    const found = lookup(plugin.runtime.command) !== null;
    cache.set(plugin.runtime.command, { at: now, found });
    return !found;
  };
}

/** The desktop's one check, shared by the turn mounts and the list. */
export const builtinRuntimeMissing = createRuntimeCheck();
