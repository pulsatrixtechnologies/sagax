// The engine's own plugin, MCP and extension commands, refused for every
// person's turns. A person manages their own plugins, skills and MCP servers
// in Sagax with no admin; the only rule is the Sagax permission
// `apps.ownIntegrations` (shared/permissions.ts). The Perspicax person sheet
// field `sagax_integrations` is ignored (removed 2026-10-30) if an older
// Perspicax still sends it.
//
// `/plugin`, `/plugins`, `/mcp` and `/reload-*` typed in the chat are
// managed by Sagax for everyone (shared/harness-commands.ts), the host Bash
// is denied on an organization server (withholdHostTools), and `run_command`
// (the person's server environment and their desktop, including a Local VM
// command) refuses the CLIs' plugin, MCP and extension subcommands
// (`enginePluginCommandRefusal`). The tool result tells the bot to install
// through Sagax `act` plugin actions. That check is a courtesy, not the
// boundary: nothing a person installs in their environment reaches a bot's
// turn, which loads only the plugins Sagax keeps and the servers Sagax mounts.

const ENGINE = String.raw`(?:claude|codex|gemini|kimi|pi|grok|npx\s+(?:-y\s+)?@anthropic-ai/claude-code)`;
const SUBCOMMAND = String.raw`(?:plugins?|mcp|extensions?|marketplace)`;
const ACTION = String.raw`(?:add|add-json|add-from-claude-desktop|install|i|update|upgrade|remove|rm|uninstall|enable|disable|link|import|marketplace|new)`;
// The engine name at a command start: the line's start or after a shell
// separator, a path (`/usr/local/bin/claude`) or `command`/`exec`/`env`.
const ENGINE_COMMAND = new RegExp(
  String.raw`(?:^|[;&|(\n\`]|\$\()\s*(?:(?:command|exec|env|sudo)\s+(?:[A-Z_][A-Z0-9_]*=\S*\s+)*)?(?:\S*/)?${ENGINE}\s+${SUBCOMMAND}\s+${ACTION}\b`,
  "i",
);

/** Whether a shell command installs, updates or removes an engine's
 * plugins, MCP servers or extensions (`claude plugin install ...`,
 * `claude mcp add ...`, `codex mcp add ...`, `gemini extensions install`). */
export function engineIntegrationCommand(command: string): boolean {
  return ENGINE_COMMAND.test(command);
}

/** What `run_command` says instead of running an engine plugin command:
 * the bot installs through Sagax `act`, on every engine. */
export const PLUGIN_ACT_COMMAND =
  "Refused: Sagax installs plugins for this bot. Do not run an engine plugin, MCP or extension command. Call act with plugins.action set to list, addMarketplace, install, setEnabled, uninstall or removeMarketplace. Skills and commands then load on every engine. Hooks and MCP from a plugin stay out.";

export function enginePluginCommandRefusal(command: string): string | null {
  return engineIntegrationCommand(command) ? PLUGIN_ACT_COMMAND : null;
}
