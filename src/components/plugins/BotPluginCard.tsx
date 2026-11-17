// A marketplace plugin's detail page, "For <bot>": the whole plugin (its
// agents, commands and skills) installed on that one bot, from the same
// marketplace as the workspace install. The bot's owner, or a person who
// manages it, installs, switches and updates it (it is removed from the page's "..." menu); anyone else who
// uses the bot reads it. Hooks and the plugin's MCP servers are left out at
// install (server/bots/bot-plugins.ts): they would run on the server.
import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import type { BotPluginsView } from "@/lib/my-connections";
import type { BotPluginState } from "@/lib/plugin-scope";
import { Switch } from "../SettingsPrimitives";
import { DetailLabel } from "./DetailParts";
import { PluginCard } from "./PluginParts";
import { PluginConfigForm } from "./PluginConfigForm";

export interface BotPluginCardProps {
  botName: string;
  personal?: boolean;
  view: BotPluginsView;
  plugin: BotPluginState;
  /** "install", "toggle", "remove" while that runs */
  busy: string | null;
  onInstall: () => void;
  onToggle: (enabled: boolean) => void;
  /** Save the plugin's configuration values for this bot (throws the refusal). */
  onSaveConfig?: (values: Record<string, string | number | boolean>) => Promise<void>;
  /** the page's header already offers "Install for <bot>" (not installed yet) */
  installInHeader?: boolean;
  /** the page above already says where it is installed, with its switch beside that chip: the card does not say it again */
  statedAbove?: boolean;
  /** the page's header already offers "Update": the card does not repeat it */
  updateInHeader?: boolean;
}

function Names({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <div className="contents">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono text-[12px] text-ink">{names.join(", ")}</dd>
    </div>
  );
}

export function BotPluginCard({ botName, personal = false, view, plugin, busy, onInstall, onToggle, onSaveConfig, installInHeader = false, statedAbove = false, updateInHeader = false }: BotPluginCardProps) {
  const installed = plugin.installed;
  const change = view.canChange;
  const contents = plugin.contents;
  const empty = contents && !contents.agents.length && !contents.commands.length && !contents.skills.length;
  return (
    <div data-bot-plugin={plugin.key} data-bot-plugin-installed={installed ? "yes" : "no"}>
      {/* under a page that states where it is installed, the card is a section of that page: its label is the page's */}
      {statedAbove && <DetailLabel>{t("connectApps.botPlugin.brings")}</DetailLabel>}
      <PluginCard
        title={statedAbove ? undefined : personal ? t("connectApps.scope.me") : t("connectApps.botPlugin.title", { name: botName })}
        action={!statedAbove && installed && change ? (
          <Switch checked={installed.enabled} disabled={busy !== null} aria-label={t("plugins.enabled", { name: plugin.plugin })} onClick={() => onToggle(!installed.enabled)} />
        ) : undefined}
      >
        {!statedAbove && <p className="text-[13px] leading-relaxed text-ink-secondary">
          {personal ? t(installed ? "connectApps.mePlugin.installed" : "connectApps.mePlugin.notInstalled") : installed ? t("connectApps.botPlugin.installed", { name: botName }) : t("connectApps.botPlugin.notInstalled", { name: botName })}
        </p>}
        {!view.engine.loadsPlugins && <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.claudeOnly")}</p>}
        {contents ? (
          empty ? <p className="mt-2 text-[12px] text-ink-secondary">{t("connectApps.botPlugin.nothing")}</p> : (
            <dl className="mt-2 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <Names label={t("connectApps.botPlugin.agents")} names={contents.agents} />
              <Names label={t("connectApps.botPlugin.commands")} names={contents.commands} />
              <Names label={t("connectApps.botPlugin.skills")} names={contents.skills} />
            </dl>
          )
        ) : (
          <p className="mt-2 text-[12px] text-ink-secondary">{t("connectApps.botPlugin.readAtInstall")}</p>
        )}
        {installed && installed.removed.length > 0 && <p className="mt-2 text-[12px] text-ink-secondary">{t("plugins.removed", { parts: installed.removed.join(", ") })}</p>}
        {!statedAbove && installed && installed.declaredMcpServers.length > 0 && <p className="mt-1 text-[12px] text-ink-secondary">{t("plugins.declaredMcp", { names: installed.declaredMcpServers.join(", ") })}</p>}
        {installed?.config && installed.config.fields.length > 0 && (
          <PluginConfigForm config={installed.config} canChange={change && Boolean(onSaveConfig)} onSave={(values) => onSaveConfig ? onSaveConfig(values) : Promise.resolve()} />
        )}
        {!change && <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("plugins.readOnly")}</p>}
        {change && !(installInHeader && !installed) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {!(installed && updateInHeader) && <button type="button" data-bot-plugin-install disabled={busy !== null} onClick={onInstall} className={installed ? "ui-button flex items-center gap-1.5 text-[12px]" : "ui-button ui-button-primary flex items-center gap-1.5 text-[12px]"}>
              {busy === "install" && <Loader2 size={13} className="animate-spin" />}
              {busy === "install" ? t("plugins.installing") : installed ? t("plugins.update") : personal ? t("connectApps.mePlugin.install") : t("connectApps.botPlugin.install", { name: botName })}
            </button>}
          </div>
        )}
      </PluginCard>
    </div>
  );
}
