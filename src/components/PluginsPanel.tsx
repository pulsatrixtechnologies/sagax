// Plugins: one panel, after the "Connect apps" screens people know from
// desktop assistants.
//
//   - Connect apps (2026-10-27, the owner: one place per subject): one page with
//     its title, the scope, one search that looks everywhere (2026-10-29,
//     ConnectAppsSearch.tsx) and six tabs. Discover (where a person lands:
//     the catalog, the category pills and a link to Bots), Bots (Browse
//     Bots, a tab of its own since 2026-10-29: every link to Browse Bots
//     opens it),
//     Installed (one line per thing, deduplicated, with a "..." menu:
//     Update, For which bots, Remove; the private skills), Providers (the
//     connectors of their engine accounts and their own MCP servers, with a
//     pill per service), Pages (their published pages) and Sources (a
//     GitHub connection row, the marketplaces, and for an organization
//     admin the allowed marketplaces). "N connected" opens Installed, or
//     Providers when only engine connectors are connected (#1194).
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
