// Browse Bots, one bot: the mascot with its creator's avatar, the name, by
// whom, the description and the actions; then a left column of tabs
// (Instructions, Memories, Skills, Routines, Integrations) and the chosen
// one on the right, the instructions first. Read only: editing happens in
// the bot's own panel. A template also shows the apps it uses as chips and
// its small print; a team template (community or organization package)
// shows the import preview instead of the tabs.
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { itemCreator, itemDescription, itemName, type BotCatalogDetail, type CatalogItem } from "@/lib/bot-catalog";
import { ChatMarkdown } from "../ChatMarkdown";
import { CatalogMascot, itemLook, nameColor } from "./BotCatalogView";

export type CatalogTab = "soul" | "memories" | "skills" | "routines" | "integrations";
export const CATALOG_TABS: readonly CatalogTab[] = ["soul", "memories", "skills", "routines", "integrations"];

const TAB_KEYS: Record<CatalogTab, { label: LocaleKey; hint: LocaleKey; none: LocaleKey }> = {
  soul: { label: "botCatalog.tab.soul", hint: "botCatalog.tab.soulHint", none: "botCatalog.none.soul" },
  memories: { label: "botCatalog.tab.memories", hint: "botCatalog.tab.memoriesHint", none: "botCatalog.none.memories" },
  skills: { label: "botCatalog.tab.skills", hint: "botCatalog.tab.skillsHint", none: "botCatalog.none.skills" },
  routines: { label: "botCatalog.tab.routines", hint: "botCatalog.tab.routinesHint", none: "botCatalog.none.routines" },
  integrations: { label: "botCatalog.tab.integrations", hint: "botCatalog.tab.integrationsHint", none: "botCatalog.none.integrations" },
};

/** What the detail shows: the server's for a bot, the template's own. */
export type CatalogDetailContent = Omit<BotCatalogDetail, "entry">;

export function templateDetail(item: Extract<CatalogItem, { kind: "template" }>): CatalogDetailContent {
  return { soul: item.template.soul, memories: [], skills: item.template.skills, routines: [], integrations: [] };
}

function count(content: CatalogDetailContent | null, tab: CatalogTab): number | null {
  if (!content || tab === "soul") return null;
  if (tab === "memories") return content.memories?.length ?? null;
  return content[tab].length;
}

function TabBody({ tab, content }: { tab: CatalogTab; content: CatalogDetailContent }) {
  const none = <p className="text-[13px] text-ink-tertiary" data-catalog-tab-empty="">{t(TAB_KEYS[tab].none)}</p>;
  if (tab === "soul") {
    return content.soul.trim()
      // Markdown, drawn as in the chat; inert: nothing in a bot's
      // instructions runs code or reaches the network from this view.
      ? <div className="min-w-0 break-words text-[13.5px] leading-[21px] text-ink" data-catalog-soul=""><ChatMarkdown text={content.soul} inert /></div>
      : none;
  }
  if (tab === "memories") {
    if (content.memories === null) return <p className="text-[13px] leading-[19px] text-ink-secondary" data-catalog-memories-private="">{t("botCatalog.memoriesPrivate")}</p>;
    if (!content.memories.length) return none;
    return <ul className="flex flex-col gap-1.5" data-catalog-memories="">{content.memories.map((fact, index) => <li key={index} className="rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px] leading-[19px] text-ink">{fact}</li>)}</ul>;
  }
  if (tab === "skills") {
    if (!content.skills.length) return none;
    return (
      <ul className="flex flex-col gap-1.5" data-catalog-skills="">
        {content.skills.map((skill) => (
          <li key={skill.name} className="rounded-lg bg-ink/[0.04] px-3 py-2">
            <div className="text-[13px] font-medium text-ink">{skill.name}</div>
            {skill.description && <div className="text-[12px] leading-[17px] text-ink-secondary">{skill.description}</div>}
          </li>
        ))}
      </ul>
    );
  }
  if (tab === "routines") {
    if (!content.routines.length) return none;
    return (
      <ul className="flex flex-col gap-1.5" data-catalog-routines="">
        {content.routines.map((routine, index) => (
          <li key={index} className="flex items-center gap-2 rounded-lg bg-ink/[0.04] px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{routine.name}</span>
              <span className="block truncate text-[12px] text-ink-secondary">{routine.schedule}</span>
            </span>
            {!routine.enabled && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("botCatalog.routine.paused")}</span>}
          </li>
        ))}
      </ul>
    );
  }
  if (!content.integrations.length) return none;
  return (
    <ul className="flex flex-col gap-1.5" data-catalog-integrations="">
      {content.integrations.map((integration) => (
        <li key={`${integration.kind}:${integration.name}`} className="flex items-center gap-2 rounded-lg bg-ink/[0.04] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            {integration.kind === "browser" ? t("botCatalog.integration.browser") : integration.name}
          </span>
          {integration.kind !== "browser" && (
            <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t(integration.kind === "mcp" ? "botCatalog.integration.mcp" : "botCatalog.integration.app")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface BotCatalogDetailViewProps {
  item: CatalogItem;
  content: CatalogDetailContent | null;
  loading?: boolean;
  tab: CatalogTab;
  onTab: (tab: CatalogTab) => void;
  onBack: () => void;
  creatorAvatar?: string;
  /** The action buttons, the primary one first. */
  actions: ReactNode;
  /** Under the actions: the publish form, feedback. */
  below?: ReactNode;
  /** In place of the tabs: a team template's import preview. */
  preview?: ReactNode;
}

/** The apps a template uses, as chips. */
export function TemplateAppChips({ apps }: { apps: readonly string[] }) {
  if (!apps.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" data-catalog-apps="">
      {apps.map((app) => (
        <span key={app} data-catalog-app={app} className="rounded-full border border-hairline-weak px-1.5 py-px text-[10.5px] leading-[15px] text-ink-secondary">{app}</span>
      ))}
    </span>
  );
}

export function BotCatalogDetailView({ item, content, loading, tab, onTab, onBack, creatorAvatar, actions, below, preview }: BotCatalogDetailViewProps) {
  const name = itemName(item);
  const template = item.kind === "template" ? item.template : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" data-bot-catalog-detail={item.key}>
      <div className="shrink-0 px-6 pr-14 pt-5 sm:px-8" data-catalog-header="">
        <button type="button" onClick={onBack} className="-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink" data-catalog-back="">
          <ChevronLeft size={14} aria-hidden="true" />{t("botCatalog.back")}
        </button>
        <div className="mt-4 flex flex-col items-center text-center">
          <CatalogMascot item={item} size={96} creatorAvatar={creatorAvatar} />
          <h2 id="bot-catalog-title" className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.01em]" style={{ color: nameColor(itemLook(item)) }}>{name}</h2>
          <p className="mt-0.5 text-[13px] text-ink-tertiary">{t("botCatalog.byDetail", { name: itemCreator(item) })}</p>
          {itemDescription(item) && <p className="mt-2 max-w-[520px] text-[13.5px] leading-[20px] text-ink-secondary">{itemDescription(item)}</p>}
          {template && template.apps.length > 0 && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <span className="text-[11.5px] text-ink-tertiary">{t("botCatalog.template.uses")}</span>
              <TemplateAppChips apps={template.apps} />
            </div>
          )}
          {template && template.notes.length > 0 && (
            <ul className="mt-2 flex flex-col items-center gap-0.5 text-[11.5px] text-ink-tertiary" data-catalog-notes="">
              {template.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2" data-catalog-actions="">{actions}</div>
          {below}
        </div>
      </div>
      {preview !== undefined ? (
        <div className="mx-6 mb-6 mt-6 shrink-0 border-t border-hairline-weak pt-5 text-left sm:mx-8" data-catalog-preview="">{preview}</div>
      ) : (<>
      <div className="mx-6 mt-6 flex shrink-0 flex-col gap-4 border-t border-hairline-weak pt-5 sm:mx-8 sm:min-h-[260px] sm:flex-row sm:items-start sm:gap-6" data-catalog-tabs-layout="">
        <div
          role="tablist"
          aria-label={t("botCatalog.tabsAria")}
          aria-orientation="vertical"
          data-catalog-tablist=""
          className="-mx-6 flex shrink-0 gap-1 overflow-x-auto px-6 pb-1 sm:sticky sm:top-0 sm:mx-0 sm:w-[210px] sm:flex-col sm:gap-0.5 sm:overflow-visible sm:px-0 sm:pb-0"
        >
          {CATALOG_TABS.map((id) => {
            const n = count(content, id);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-catalog-tab={id}
                onClick={() => onTab(id)}
                className={cn(
                  "flex shrink-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left sm:w-full",
                  tab === id ? "bg-selected" : "hover:bg-hover",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-nowrap text-[13px] font-medium leading-[18px] text-ink sm:whitespace-normal">{t(TAB_KEYS[id].label)}</span>
                  <span className="hidden text-[11.5px] leading-[16px] text-ink-secondary sm:block">{t(TAB_KEYS[id].hint)}</span>
                </span>
                {n !== null && <span className="shrink-0 text-[11.5px] leading-[18px] tabular-nums text-ink-tertiary" data-catalog-tab-count="">{n}</span>}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" className="min-w-0 flex-1 rounded-xl border border-hairline-weak bg-panel p-4 sm:px-5 sm:py-4" data-catalog-tabpanel={tab}>
          {content ? <TabBody tab={tab} content={content} /> : (
            <p className="text-[13px] text-ink-secondary">{loading ? t("botCatalog.loading") : t("botCatalog.loadError")}</p>
          )}
        </div>
      </div>
      <p className="mx-6 mb-6 mt-4 shrink-0 text-[11.5px] leading-[16px] text-ink-tertiary sm:mx-8" data-catalog-readonly="">{t("botCatalog.readOnlyNote")}</p>
      </>)}
    </div>
  );
}
