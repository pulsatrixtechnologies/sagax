// Connect apps > Discover, the view a person lands on (2026-10-27: the
// former home page and Manage's Discover made one): the catalog of apps,
// plugins and skills that can still be added, the category pills (no Browse
// Bots button since 2026-10-29: the Bots tab is its place), then the sections in
// two columns. View all filters this view in place. The search is Connect
// Apps' one search above the tabs (2026-10-29: one option, one place). The apps a conversation needs (its Connect
// apps pill) come first. What is installed lives in Installed; the engines'
// connectors in Installed (Providers).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { mainSections, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { ConnectedMark, PluginRow, categoryPills, filterLabel, moreCategoryPills, sectionTitle } from "./ConnectAppsView";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";
import { PLUGINS, pluginChipClass } from "./plugins-style";

const PAGE = 60;
const FROM_SAGAX = 6;

/** A row of "From Sagax": what is here, with what it brings. */
export interface FromSagaxRow {
  key: string;
  /** the mark to show (the entry's real logo) */
  item: Pick<PluginItem, "key" | "kind" | "name" | "logo" | "domain">;
  name: string;
  /** "1 connector, 27 skills" */
  sub: string;
  status: PluginItem["status"];
}

export interface DiscoverViewProps {
  /** rows not installed yet (discoverItems) */
  items: PluginItem[];
  loading?: boolean;
  filter: PluginFilter;
  onFilter: (filter: PluginFilter) => void;
  type: PluginTypeFilter;
  onType: (type: PluginTypeFilter) => void;
  sourceLabel: (source: string) => string;
  /** marketplaces: a section of their own */
  extraSources?: string[];
  /** apps a conversation needs (its Connect apps pill): shown first */
  focus?: readonly string[];
  onOpenItem: (item: PluginItem) => void;
  renderAction: (item: PluginItem) => ReactNode;
  renderBelow?: (item: PluginItem) => ReactNode;
  /** "From Sagax": what is installed, first, on All */
  fromSagax?: readonly FromSagaxRow[];
  onOpenFromSagax?: (row: FromSagaxRow) => void;
  /** View all of From Sagax: Manage */
  onViewInstalled?: () => void;
  /** the centred "Add a custom connector" at the end */
  onAddCustom?: () => void;
}

export function DiscoverView({ items, loading = false, filter, onFilter, type, onType, sourceLabel, extraSources = [], focus, onOpenItem, renderAction, renderBelow, fromSagax = [], onOpenFromSagax, onViewInstalled, onAddCustom }: DiscoverViewProps) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter, type]);
  const sections = mainSections(items, "", filter, type, extraSources, focus);
  const single = filter !== "all" || type !== "any";
  const pills = categoryPills(items, filter);
  const more = moreCategoryPills(items, filter);
  const ours = !single ? fromSagax : [];
  return (
    <div data-plugins-discover>
      {(pills.length > 1 || more.length > 0) && (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("connectApps.filtersAria")} data-plugins-chips>
          {pills.map((chip) => (
            <button key={chip} type="button" aria-pressed={filter === chip && type === "any"} data-plugins-chip={chip}
              onClick={() => { onFilter(chip); onType("any"); }} className={pluginChipClass(filter === chip && type === "any")}>
              {filterLabel(chip, sourceLabel)}
            </button>
          ))}
          {more.length > 0 && (
            <MoreChips chips={more} chosen={type === "any" && more.includes(filter) ? filter : null} label={(chip) => filterLabel(chip, sourceLabel)} onPick={(chip) => { onFilter(chip); onType("any"); }} />
          )}
          {type !== "any" && (
            <button type="button" aria-pressed data-plugins-type={type} onClick={() => onType("any")} className={pluginChipClass(true)}>
              {filterLabel(type, sourceLabel)} ×
            </button>
          )}
        </div>
      )}
      {ours.length > 0 && (
        <section data-plugins-section="from-sagax" className="mt-[30px]">
          <SectionHead title={t("connectApps.section.fromSagax")} onViewAll={ours.length > FROM_SAGAX ? onViewInstalled : undefined} />
          <div className={PLUGINS.grid}>
            {ours.slice(0, FROM_SAGAX).map((row) => (
              <div key={row.key} data-plugin-row={row.key} className="py-[13px]">
                <button type="button" onClick={() => onOpenFromSagax?.(row)} className="flex w-full min-w-0 items-center gap-3 rounded-xl text-left" aria-label={t("connectApps.openAria", { name: row.name })}>
                  <PluginIcon item={row.item} className="size-10 rounded-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className={PLUGINS.rowName}>{row.name}</span>
                    <span className={PLUGINS.rowSub}>{row.sub}</span>
                  </span>
                  {row.status === "connected" ? <ConnectedMark /> : <PluginStatusLabel status={row.status} className="text-[13px] font-normal" />}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-24 text-[12px] text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
        </div>
      ) : sections.every((section) => section.items.length === 0) ? (
        <div className="mt-6 rounded-xl bg-card px-4 py-3 text-[12px] text-ink-secondary" data-plugins-empty>
          {t("connectApps.discover.empty")}
        </div>
      ) : sections.filter((section) => section.items.length > 0).map((section) => {
        const shown = single ? section.items.slice(0, limit) : section.items;
        return (
          <section key={section.id} data-plugins-section={section.id} className="mt-[30px]">
            <SectionHead
              title={sectionTitle(section, sourceLabel)}
              id={section.id}
              onViewAll={!single && section.filter && section.total > section.items.length ? () => {
                const target = section.filter!;
                if ("filter" in target) onFilter(target.filter);
                else onType(target.type);
              } : undefined}
            />
            <div className={PLUGINS.grid}>
              {shown.map((item) => (
                <PluginRow key={item.key} item={item} onOpen={onOpenItem} action={renderAction(item)} below={renderBelow?.(item)} />
              ))}
            </div>
            {single && section.items.length > shown.length && (
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={() => setLimit((current) => current + PAGE)} className={PLUGINS.fillPill}>
                  {t("connectApps.showMore", { count: section.items.length - shown.length })}
                </button>
              </div>
            )}
          </section>
        );
      })}
      {onAddCustom && (
        <div className="mt-10 flex justify-center">
          <button type="button" onClick={onAddCustom} className={cn(PLUGINS.fillPill, "h-[37px] px-5 text-[14px]")} data-plugins-add-custom>
            {t("connectApps.addCustomConnector")}
          </button>
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, id, onViewAll }: { title: string; id?: string; onViewAll?: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-3">
      <h3 className={PLUGINS.sectionTitle}>{title}</h3>
      {onViewAll && (
        <button type="button" data-plugins-view-all={id ?? ""} className={PLUGINS.sectionLink} onClick={onViewAll}>
          {t("connectApps.viewAll")}
        </button>
      )}
    </div>
  );
}

/** "More ▾": the categories past the main ones, in a small menu. */
function MoreChips({ chips, chosen, label, onPick }: { chips: readonly PluginFilter[]; chosen: PluginFilter | null; label: (chip: PluginFilter) => string; onPick: (chip: PluginFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative" data-plugins-more-chips>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={pluginChipClass(chosen !== null)} data-plugins-chip={chosen ?? "more"}>
        {chosen ? label(chosen) : t("connectApps.filter.more")}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-20 mt-1.5 min-w-[180px] rounded-xl border border-border bg-raised p-1 shadow-lg">
          {chips.map((chip) => (
            <button key={chip} type="button" role="menuitemradio" aria-checked={chosen === chip} onClick={() => { setOpen(false); onPick(chip); }}
              className={cn("flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-hover", chosen === chip && "bg-hover")} data-plugins-chip={chip}>
              {label(chip)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
