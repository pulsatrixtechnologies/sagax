// Plugins: one panel, after the "Connect apps" screens people know from
// desktop assistants.
//
//   - Plugins (#2104, 2026-11-05; "Capabilities" with five tabs before): one
//     page with its title, one scope (This bot / Me / Organization, always
//     live), one search that looks everywhere (ConnectAppsSearch.tsx), one
//     refresh and three tabs, Installed first (where a person lands): one
//     line per thing, deduplicated, with a "..." menu (Update, For which
//     bots, Remove), one "+ Add" menu (an MCP server, a pasted config, a
//     skill), the private skills, "This Mac" (the Messages row opens its
//     setup directly) and the connectors of their engine accounts in one
//     list with one "Manage on <engine>" each; Discover (the catalog and the
//     category pills); Sources (a GitHub connection row, the marketplaces,
//     and for an organization admin the allowed marketplaces). Bots (Browse
//     Bots) and Pages (their published pages) are no tabs: every old link
//     to them opens that pane alone, with its own title and a back arrow.
//   - Detail: one plugin's accounts, tools (a switch per MCP tool, applied to
//     every bot) and details, with Uninstall.
//   - GitHub (owner, 2026-10-29: "Why is GitHub listed as a provider?"):
//     the person's GitHub account, the one GitHub connection of every use,
//     with the other credentials beside it, is on the GitHub plugin's page
//     (its detail page, installed or listed in Discover). With no GitHub
//     plugin in any marketplace, a page of its own with that one section.
//     Every link to it goes through `openGithub`.
//
// Two install scopes on one marketplace list (src/lib/plugin-scope.ts):
// everyone (a marketplace plugin's MCP servers and skills) or, when a bot is
// in reach, "For <bot>" (the whole plugin, agents and commands included, on
// that bot only; its owner or a person who manages it).
//
// This panel is the only place that adds, removes, configures or lists
// plugins, servers, apps, skills and marketplaces. Other screens link here
// or choose among them for one bot; keys stay in Settings > API keys.
import { PluginsPanelView } from "./PluginsPanel.tsx-parts/PluginsPanelView";
import { usePluginsPanelActions } from "./PluginsPanel.tsx-parts/usePluginsPanelActions";
import { usePluginsPanelState } from "./PluginsPanel.tsx-parts/usePluginsPanelState";

export { githubPluginKey, pluginSourceLabel, openGrokConnectors } from "./PluginsPanel.tsx-parts/helpers";
export { GrokConnectorAction, grokRowAction, grokConnectorDetail } from "./PluginsPanel.tsx-parts/GrokConnectors";

export function PluginsPanel() {
  const state = usePluginsPanelState();
  const actions = usePluginsPanelActions(state);
  return <PluginsPanelView s={state} a={actions} />;
}
