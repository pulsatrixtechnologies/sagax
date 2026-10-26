// Plugins > Manage, after the reference's "Plugins and skills" page: what is
// installed (apps, MCP servers, marketplace plugins) as a grid of cards,
// then the private skills of this installation. Adding an MCP server by
// hand, pasting a config, marketplaces, the engine providers and the
// settings for every server sit below, in a collapsed Advanced zone (the
// engine accounts also live in Settings > Models and voices).
import { useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ClipboardPaste, Plus, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { installedPlugins, type PluginItem } from "@/lib/plugins-model";
import type { Crumb } from "../Breadcrumb";
import { PluginIcon, PluginPageHeader } from "./PluginParts";

const INSTALLED_PREVIEW = 8;

export interface ManageViewProps {
  items: PluginItem[];
  /** the subline under an installed card: "1 connector", "3 connectors" */
  countLabel: (item: PluginItem) => string;
  sourceLabel: (source: string) => string;
  onBack: () => void;
  /** the pages above this one in the panel (the breadcrumb) */
  trail?: readonly Crumb[];
  onOpenItem: (item: PluginItem) => void;
  onAddManually: () => void;
  onPasteConfig: () => void;
  /** "New skill" beside Private skills (absent: no button) */
  onNewSkill?: () => void;
  addDisabled?: boolean;
  addTitle?: string;
  refreshing: boolean;
  onRefresh: () => void;
  /** the MCP add / paste forms and their messages (inside Advanced) */
  forms?: ReactNode;
  /** sections at the end of Advanced (marketplaces, settings) */
  children?: ReactNode;
  /** a section after the skills, outside Advanced (a person's own
   * connections on an organization server) */
  personal?: ReactNode;
  /** opens Advanced at first sight (a form inside it is open) */
  advancedOpen?: boolean;
  /** engine accounts and the connectors they bring, a section of Advanced */
  providers?: ReactNode;
  /** the install scope (everyone, or one bot) above the installed cards */
  scope?: ReactNode;
  /** one bot's plugins: no private skills and no personal connections */
  pluginsOnly?: boolean;
}

/** Connected in green, anything else a muted Not connected (Off for a
 * server switched off on purpose). */
function CardStatus({ item }: { item: PluginItem }) {
  if (item.status === "connected") return <span data-plugin-status="connected" className="shrink-0 text-[12px] font-medium text-success">{t("connectApps.status.connected")}</span>;
  return (
    <span data-plugin-status={item.status} className="shrink-0 text-[12px] text-ink-secondary">
      {t(item.status === "off" ? "connectApps.status.off" : "connectApps.status.notConnected")}
    </span>
  );
}

export function ManageView(props: ManageViewProps) {
  const { items, countLabel, sourceLabel, onBack, trail, onOpenItem, onAddManually, onPasteConfig, onNewSkill, addDisabled, addTitle, refreshing, onRefresh,
    forms, children, personal, advancedOpen, providers, scope, pluginsOnly } = props;
  const [showAll, setShowAll] = useState(false);
  const installed = installedPlugins(items);
  const shown = showAll ? installed : installed.slice(0, INSTALLED_PREVIEW);
  const skills = items.filter((item) => item.kind === "skill").sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PluginPageHeader titleId="plugins-title" title={t("connectApps.manage.title")} trail={trail} onBack={onBack} plainBack />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-4 sm:px-8" data-plugins-manage>
        {scope && <div className="mb-4">{scope}</div>}
        <section data-plugins-installed>
          <div className="mb-1 flex justify-end">
            <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button disabled:opacity-50" aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
              <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
            </button>
          </div>
          {installed.length === 0 ? (
            <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.manage.noneInstalled")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
              {shown.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  data-plugin-card={item.key}
                  onClick={() => onOpenItem(item)}
                  className="flex items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-ink/5"
                >
                  <PluginIcon item={item} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{item.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-secondary">{countLabel(item)}</span>
                  </span>
                  <CardStatus item={item} />
                </button>
              ))}
            </div>
          )}
          {installed.length > INSTALLED_PREVIEW && (
            <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline">
              {showAll ? t("connectApps.manage.showFewer") : t("connectApps.manage.showAll", { count: installed.length })}
            </button>
          )}
        </section>

        {!pluginsOnly && (
        <section className="mt-6" data-plugins-skills>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.manage.skills")}</h3>
            {onNewSkill && (
              <button type="button" onClick={onNewSkill} data-plugins-new-skill className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink">
                <Plus size={13} /> {t("connectApps.skill.new")}
              </button>
            )}
          </div>
          {skills.length === 0 ? (
            <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.manage.noSkills")}</p>
          ) : (
            <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
              {skills.map((skill) => (
                <li key={skill.key}>
                  <button type="button" data-plugin-skill={skill.id} onClick={() => onOpenItem(skill)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><BookOpen size={15} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{skill.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-secondary">
                        {skill.source === "local" ? t("connectApps.skill.createdLocally") : t("connectApps.skill.from", { source: sourceLabel(skill.source) })}
                        {skill.description ? ` · ${skill.description}` : ""}
                      </span>
                    </span>
                    {skill.status === "off" && <span className="shrink-0 text-[12px] text-ink-secondary">{t("connectApps.status.off")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}

        {!pluginsOnly && personal}

        <details className="group mt-6 border-t border-hairline/60 pt-4" data-plugins-advanced open={advancedOpen || pluginsOnly || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold text-ink">
            <span>{t("connectApps.manage.advanced")}</span>
            <ChevronDown size={15} className="text-ink-secondary transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-3">
            {!pluginsOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onAddManually} disabled={addDisabled} title={addTitle} className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
                <Plus size={14} /> {t("connectApps.manage.addManually")}
              </button>
              <button type="button" onClick={onPasteConfig} disabled={addDisabled} title={addTitle} className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">
                <ClipboardPaste size={14} /> {t("mcp.import")}
              </button>
            </div>
            )}
            {!pluginsOnly && forms}
            {children}
            {providers && (
              <section className="mt-6" data-plugins-manage="providers">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.tabProviders")}</h3>
                {providers}
              </section>
            )}
          </div>
        </details>
      </div>
    </>
  );
}
