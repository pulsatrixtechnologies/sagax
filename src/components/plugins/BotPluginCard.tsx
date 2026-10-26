// A marketplace plugin's detail page, "For <bot>": the whole plugin (its
// agents, commands and skills) installed on that one bot, from the same
// marketplace as the workspace install. The bot's owner, or a person who
// manages it, installs, switches, updates and removes it; anyone else who
// uses the bot reads it. Hooks and the plugin's MCP servers are left out at
// install (server/bot-plugins.ts): they would run on the server.
import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import type { BotPluginsView } from "@/lib/my-connections";
import type { BotPluginState } from "@/lib/plugin-scope";
import { Switch } from "../SettingsPrimitives";
import { IntegrationsManagedNotice } from "../settings/MyConnectionsSettings";
import { PluginCard } from "./PluginParts";
import { PluginConfigForm } from "./PluginConfigForm";

export interface BotPluginCardProps {
  botName: string;
  view: BotPluginsView;
  plugin: BotPluginState;
  /** "install", "toggle", "remove" while that runs */
  busy: string | null;
  onInstall: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
  /** Save the plugin's configuration values for this bot (throws the refusal). */
  onSaveConfig?: (values: Record<string, string | number | boolean>) => Promise<void>;
}

function Names({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <div className="contents">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono text-[11.5px] text-ink">{names.join(", ")}</dd>
    </div>
  );
}

export function BotPluginCard({ botName, view, plugin, busy, onInstall, onToggle, onUninstall, onSaveConfig }: BotPluginCardProps) {
  const installed = plugin.installed;
  const change = view.canChange;
  const contents = plugin.contents;
  const empty = contents && !contents.agents.length && !contents.commands.length && !contents.skills.length;
  return (
    <div data-bot-plugin={plugin.key} data-bot-plugin-installed={installed ? "yes" : "no"}>
      <PluginCard
        title={t("connectApps.botPlugin.title", { name: botName })}
        action={installed && change ? (
          <Switch checked={installed.enabled} disabled={busy !== null} aria-label={t("plugins.enabled", { name: plugin.plugin })} onClick={() => onToggle(!installed.enabled)} />
        ) : undefined}
      >
        <p className="text-[12.5px] leading-relaxed text-ink-secondary">
          {installed ? t("connectApps.botPlugin.installed", { name: botName }) : t("connectApps.botPlugin.notInstalled", { name: botName })}
        </p>
        {!view.engine.loadsPlugins && <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.claudeOnly")}</p>}
        {contents ? (
          empty ? <p className="mt-2 text-[12px] text-ink-secondary">{t("connectApps.botPlugin.nothing")}</p> : (
            <dl className="mt-2 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
              <Names label={t("connectApps.botPlugin.agents")} names={contents.agents} />
              <Names label={t("connectApps.botPlugin.commands")} names={contents.commands} />
              <Names label={t("connectApps.botPlugin.skills")} names={contents.skills} />
            </dl>
          )
        ) : (
          <p className="mt-2 text-[12px] text-ink-secondary">{t("connectApps.botPlugin.readAtInstall")}</p>
        )}
        {installed && installed.removed.length > 0 && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("plugins.removed", { parts: installed.removed.join(", ") })}</p>}
        {installed && installed.declaredMcpServers.length > 0 && <p className="mt-1 text-[11.5px] text-ink-secondary">{t("plugins.declaredMcp", { names: installed.declaredMcpServers.join(", ") })}</p>}
        {installed?.config && installed.config.fields.length > 0 && (
          <PluginConfigForm config={installed.config} canChange={change && Boolean(onSaveConfig)} onSave={(values) => onSaveConfig ? onSaveConfig(values) : Promise.resolve()} />
        )}
        {view.managedByAdmin
          ? <div className="mt-2"><IntegrationsManagedNotice /></div>
          : !change && <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.readOnly")}</p>}
        {change && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button type="button" data-bot-plugin-install disabled={busy !== null} onClick={onInstall} className={installed ? "ui-button flex items-center gap-1.5 text-[12px]" : "ui-button ui-button-primary flex items-center gap-1.5 text-[12px]"}>
              {busy === "install" && <Loader2 size={13} className="animate-spin" />}
              {busy === "install" ? t("plugins.installing") : installed ? t("plugins.update") : t("connectApps.botPlugin.install", { name: botName })}
            </button>
            {installed && (
              <button type="button" data-bot-plugin-uninstall disabled={busy !== null} onClick={onUninstall} className="rounded-lg border border-danger/40 px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40">
                {t("connectApps.botPlugin.uninstall", { name: botName })}
              </button>
            )}
          </div>
        )}
      </PluginCard>
    </div>
  );
}
