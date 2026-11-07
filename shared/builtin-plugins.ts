/** Built-in plugins: MCP servers Sagax ships for every bot, on unless the
 * bot switches them off (`WireBot.builtinPlugins[id] === false`). A bot saved
 * before a built-in existed has no entry and so has it on: no data rewrite.
 *
 * REA (https://github.com/morluto/rea, MIT, npm `rea-agents`): reverse
 * engineering of binaries, .NET assemblies, APKs and JS/Electron bundles,
 * plus runtime observation. Sagax runs the official stdio command pinned to
 * one version and never runs `rea-agents setup`: the registration is Sagax's
 * own mount, not the user's harness config. */

export const REA_VERSION = "6.8.0";

export type BuiltinPluginId = "rea";

export interface BuiltinPlugin {
  id: BuiltinPluginId;
  /** the capability and mount key (`plugin:bot:<key>` in the list) */
  key: `builtin:${BuiltinPluginId}`;
  /** the MCP server name a turn mounts */
  mcpName: string;
  /** readable name */
  name: string;
  version: string;
  /** English description; the screens show their own translation */
  description: string;
  homepage: string;
  /** the stdio launch, never interactive */
  spec: { command: string; args: string[]; env: Record<string, string> };
  /** the runtime the command needs, said when it is missing */
  runtime: { command: string; label: string };
}

/** Non-interactive by construction:
 * - `npx -y` answers npm's install prompt;
 * - npm_config_yes, update notifier off: no other npm prompt on stdout;
 * - the compact schema profiles keep the tool list and results small;
 * - the Hopper first-run demo/license dialog is a macOS GUI window, never a
 *   stdio prompt: REA waits for it a bounded time
 *   (REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS) and answers the tool call with an
 *   error, the turn is never blocked. REA never automates licences; the
 *   headless path (Linux sandbox) uses demo mode by itself. */
export const REA_PLUGIN: BuiltinPlugin = {
  id: "rea",
  key: "builtin:rea",
  mcpName: "rea",
  name: "REA",
  version: REA_VERSION,
  description: "Reverse engineering for agents: inspect binaries, .NET assemblies, APKs and JS/Electron apps, and observe them at runtime.",
  homepage: "https://github.com/morluto/rea",
  spec: {
    command: "npx",
    args: ["-y", `rea-agents@${REA_VERSION}`, "mcp"],
    env: {
      REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "compact",
      REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS: "10000",
      npm_config_yes: "true",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
      NO_UPDATE_NOTIFIER: "1",
    },
  },
  runtime: { command: "npx", label: "Node.js 22.23+ (npx)" },
};

export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = [REA_PLUGIN];

export function builtinPlugin(id: string): BuiltinPlugin | undefined {
  return BUILTIN_PLUGINS.find((plugin) => plugin.id === id || plugin.key === id);
}

/** On unless this bot switched it off. */
export function builtinPluginEnabled(bot: { builtinPlugins?: Record<string, boolean> } | null | undefined, id: BuiltinPluginId): boolean {
  return bot?.builtinPlugins?.[id] !== false;
}

/** A PATCH body's `builtinPlugins`: known ids, boolean values. */
export function parseBuiltinPluginsPatch(value: unknown): { ok: true; value: Record<string, boolean> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "builtinPlugins must be an object" };
  const out: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(value)) {
    if (!BUILTIN_PLUGINS.some((plugin) => plugin.id === id)) return { ok: false, error: `unknown built-in plugin: ${id}` };
    if (typeof on !== "boolean") return { ok: false, error: `builtinPlugins.${id} must be true or false` };
    out[id] = on;
  }
  return { ok: true, value: out };
}
