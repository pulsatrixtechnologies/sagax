import { useMemo } from "react";

import { confirmAsync } from "@/components/ConfirmProvider";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { canEditBotField } from "@/lib/bot-capabilities";
import { installedEntries, type InstalledEntry } from "@/lib/installed-model";
import { type EntryActions } from "../plugins/InstalledView";
import { botServersAfter, botUsesServers } from "../plugins/BotsForView";
import type { PluginsPanelState } from "./usePluginsPanelState";
import type { PluginsPanelActions } from "./usePluginsPanelActions";

/** Manage > Installed: the entries, their per-bot toggles and row actions. */
export function usePluginsInstalledEntries(s: PluginsPanelState, a: PluginsPanelActions) {
  const {
    state, dispatch, mcp, page, push, scope, scopedPluginView, scopedItems,
    setInstalling, setPanelError, setMarketplaces, loadSkills, loadFeatured,
  } = s;
  const { installForBot, uninstallForBot, updatePlugin } = a;
  // Manage > Installed: one entry per thing (installed-model.ts).
  const entries = useMemo(() => installedEntries(scopedItems, s.featured ?? []), [scopedItems, s.featured]);
  const enabledServers = useMemo(() => (mcp.servers ?? []).filter((server) => server.enabled).map((server) => server.name), [mcp.servers]);
  // the person's bots whose MCP list they may change (their own, or any bot
  // on a solo installation)
  const editableBots = state.bots.filter((bot) => !bot.hidden && canEditBotField(state.config, bot, "mcpServers"));
  const botsForRows = (entry: InstalledEntry) => editableBots.map((bot) => ({ id: bot.id, name: bot.name, on: botUsesServers(bot.mcpServers, enabledServers, entry.servers) }));
  const toggleBotServers = (entry: InstalledEntry, botId: string, on: boolean) => {
    const bot = state.bots.find((candidate) => candidate.id === botId);
    if (!bot) return;
    dispatch({ type: "updateBot", botId, patch: { mcpServers: botServersAfter(bot.mcpServers, enabledServers, entry.servers, on) } });
  };
  /** Remove: the plugin (its servers and skills go with it) and every
   * server of the entry added by hand or from the catalog, after one
   * confirmation. */
  const removeEntry = async (entry: InstalledEntry) => {
    if (!(await confirmAsync({ title: t("connectApps.entry.removeConfirm", { name: entry.name }), confirmLabel: t("common.confirmRemove"), tone: "danger" }))) return;
    setPanelError(null);
    setInstalling(entry.key);
    try {
      const plugins = entry.members.filter((member) => member.kind === "plugin");
      const pluginKeys = new Set(plugins.map((plugin) => plugin.key));
      for (const plugin of plugins) {
        const [name, marketplace] = plugin.id.split("@") as [string, string];
        const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(name)}`, { method: "DELETE" });
        setMarketplaces(result.marketplaces ?? []);
      }
      for (const server of entry.members.filter((member) => member.kind === "mcp" && !(member.parent && pluginKeys.has(member.parent)))) {
        await api(`/api/mcp/servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
      }
      await Promise.all([mcp.load(true), loadSkills(), loadFeatured()]);
    } catch (cause) {
      setPanelError(readableError(cause));
      void mcp.load(true);
    } finally {
      setInstalling(null);
    }
  };
  const entryActions = (entry: InstalledEntry): EntryActions => {
    const plugin = entry.members.find((member) => member.kind === "plugin");
    if (scope !== "workspace") {
      if (!plugin || !scopedPluginView?.canChange) return {};
      return {
        ...(plugin.updateAvailable ? { update: () => installForBot(plugin.id) } : {}),
        remove: () => uninstallForBot(plugin.id),
      };
    }
    const removable = entry.members.some((member) => member.kind === "plugin" || member.kind === "mcp");
    return {
      ...(plugin?.updateAvailable ? { update: () => void updatePlugin(plugin) } : {}),
      ...(entry.servers.length > 0 ? { bots: () => push({ page: "botsFor", key: entry.key }) } : {}),
      ...(removable && !mcp.restricted ? { remove: () => void removeEntry(entry) } : {}),
    };
  };
  const botsForEntry = page.page === "botsFor" ? entries.find((entry) => entry.key === page.key) : undefined;
  return { entries, botsForRows, toggleBotServers, entryActions, botsForEntry };
}
