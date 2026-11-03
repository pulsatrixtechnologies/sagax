// Tools > Memory > Notes: the list, the Perspicax console's (notes-list.tsx,
// 2026-11-02). A card with the place's title and line, "New note here" and
// "From a template"; the toolbar (View, the search with its operators,
// Filter, the order, the count); the select-all row; one row per note: a
// box, the title, a line of the text (a JSON body in words), the tier's
// swatch and name, the folder, the tags, the links, then the author and
// when it changed. Ticked rows bring the bar of the bulk actions.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileStack, FolderInput, Link2, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  applyFilters,
  applyListView,
  facetCounts,
  filterCount,
  LIST_VIEWS,
  matchesQuery,
  NO_FILTERS,
  parseMemoryQuery,
  sortPageRows,
  type AgeFilter,
  type ListFilters,
  type ListSort,
  type ListView,
  type PageRow,
  type PageTier,
} from "@/lib/memory-page";
import { AuthorBadge, excerptLabel, FIELD, GHOST_BUTTON, MiniSegment, OUTLINE_BUTTON, relLabel, Swatch, TagChip } from "./memory-ui";

export interface ListTemplate {
  key: string;
  title: string;
}

export function MemoryNotesList({
  title,
  line,
  rows,
  archived,
  tiers,
  bodies,
  fixedView,
  canSelect,
  emptyText,
  onOpen,
  onEdit,
  onNewHere,
  templates,
  onFromTemplate,
  onDelete,
  onMove,
  onRestore,
  restoreLabel,
  headExtra,
  busy,
  loading,
  initialQuery,
}: {
  title: string;
  line: string;
  /** The place's notes, before the view, the search and the filters. */
  rows: PageRow[];
  /** Archived Perspicax notes (the views All and Archived). */
  archived: PageRow[];
  tiers: PageTier[];
  bodies: Record<string, string>;
  /** Trash and Archived: their rows only, no View select. */
  fixedView?: boolean;
  canSelect: (entry: PageRow) => boolean;
  emptyText: string;
  onOpen: (entry: PageRow) => void;
  onEdit: (entry: PageRow) => void;
  onNewHere?: () => void;
  templates?: ListTemplate[];
  onFromTemplate?: (template: ListTemplate) => void;
  onDelete?: (keys: string[]) => void;
  /** Perspicax rows only: the Move form for the ticked rows. */
  onMove?: (keys: string[]) => void;
  /** Trash and Archived: restore the ticked rows. */
  onRestore?: (keys: string[]) => void;
  restoreLabel?: string;
  headExtra?: React.ReactNode;
  busy: boolean;
  loading: boolean;
  initialQuery?: string;
}) {
  const [view, setView] = useState<ListView>("active");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [sort, setSort] = useState<ListSort>("updated");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [templateOpen, setTemplateOpen] = useState(false);
  const filterRef = useRef<HTMLDetailsElement | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);
  useEffect(() => { if (initialQuery != null) setQuery(initialQuery); }, [initialQuery]);

  const now = Date.now();
  const tierName = useMemo(() => new Map(tiers.map((tier) => [tier.key, tier.name])), [tiers]);
  const tierColor = useMemo(() => new Map(tiers.map((tier) => [tier.key, tier.color])), [tiers]);
  const inView = useMemo(() => (fixedView ? rows : applyListView(rows, view, archived, now)), [rows, view, archived, fixedView, now]);
  const parsed = useMemo(() => parseMemoryQuery(query), [query]);
  const shown = useMemo(() => {
    const searched = inView.filter((entry) => matchesQuery(entry, parsed, tierName.get(entry.tier) ?? "", bodies[entry.key]));
    return sortPageRows(applyFilters(searched, filters, now), sort);
  }, [inView, parsed, tierName, bodies, filters, sort, now]);
  const visibleKeys = useMemo(() => new Set(shown.map((entry) => entry.key)), [shown]);
  const selected = shown.filter((entry) => picked.has(entry.key));
  const selectable = shown.filter(canSelect);
  const allOn = selectable.length > 0 && selectable.every((entry) => picked.has(entry.key));
  useEffect(() => {
    setPicked((current) => {
      const next = new Set([...current].filter((key) => visibleKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [visibleKeys]);

  const tierFacet = facetCounts(inView, (entry) => [entry.tier]);
  const tagFacet = facetCounts(inView, (entry) => entry.row.tags ?? []).slice(0, 24);
  const authorFacet = facetCounts(inView, (entry) => (entry.row.author ? [entry.row.author] : []));
  const active = filterCount(filters);
  const toggleIn = (field: "tiers" | "tags" | "authors", value: string) => setFilters((current) => ({
    ...current,
    [field]: current[field].includes(value) ? current[field].filter((entry) => entry !== value) : [...current[field], value],
  }));

  const toggle = (key: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(selectable.map((entry) => entry.key)));
  const keys = selected.map((entry) => entry.key);
  const movable = onMove && selected.length > 0 && selected.every((entry) => entry.source.kind === "perspicax");

  const viewLabel: Record<ListView, string> = {
    active: t("memoryManager.view.active"),
    all: t("memoryManager.view.all"),
    archived: t("memoryManager.view.archived"),
    stale: t("memoryManager.view.stale"),
  };
  const ageLabel: Record<Exclude<AgeFilter, "">, string> = {
    week: t("memoryManager.filter.ageWeek"),
    month: t("memoryManager.filter.ageMonth"),
    old: t("memoryManager.filter.ageOld"),
  };

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-hairline/50 bg-panel px-5 pb-6 pt-4" aria-label={title} data-memory-list="">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[20px] font-semibold leading-[1.3] text-ink" data-memory-list-title="">{title}</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">{line}</p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {headExtra}
          {onNewHere && (
            <button type="button" className={OUTLINE_BUTTON} onClick={onNewHere} data-memory-new-here="">
              <Plus size={14} aria-hidden="true" />{t("memoryManager.newHere")}
            </button>
          )}
          {onFromTemplate && templates && templates.length > 0 && (
            <>
              <button type="button" className={OUTLINE_BUTTON} aria-expanded={templateOpen} onClick={() => setTemplateOpen((open) => !open)} data-memory-from-template="">
                <FileStack size={14} aria-hidden="true" />{t("memoryManager.fromTemplate")}
              </button>
              {templateOpen && (
                <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-[260px] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 popover-surface" data-memory-templates="">
                  {templates.map((template) => (
                    <button key={template.key} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover" onClick={() => { setTemplateOpen(false); onFromTemplate(template); }}>
                      <FileStack size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                      <span className="truncate">{template.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-memory-list-toolbar="">
        {!fixedView && (
          <select value={view} onChange={(event) => setView(event.target.value as ListView)} aria-label={t("memoryManager.view.label")} className={cn(FIELD, "h-8 w-auto max-w-[220px] py-0 text-[12.5px]")} data-memory-list-view="">
            {LIST_VIEWS.filter((entry) => entry !== "archived" || archived.length > 0 || view === "archived").map((entry) => (
              <option key={entry} value={entry}>{t("memoryManager.view.prefix", { name: viewLabel[entry] })}</option>
            ))}
          </select>
        )}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
          placeholder={t("memoryManager.searchPlaceholder")}
          aria-label={t("memoryManager.search")}
          className={cn(FIELD, "h-8 min-w-[180px] flex-1 py-0 text-[12.5px]")}
          data-memory-search=""
        />
        <details ref={filterRef} className="relative" data-memory-filter="">
          <summary role="button" className={cn(OUTLINE_BUTTON, "list-none [&::-webkit-details-marker]:hidden", active > 0 && "border-accent/50")} aria-label={active ? t("memoryManager.filterActive", { n: active }) : t("memoryManager.filter")}>
            <SlidersHorizontal size={14} aria-hidden="true" />{t("memoryManager.filter")}
            {active > 0 && <span className="min-w-[18px] rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-[18px] text-accent-ink">{active}</span>}
          </summary>
          <div className="absolute left-0 top-full z-30 mt-1.5 flex w-[280px] flex-col gap-3 rounded-xl border-[0.5px] border-border bg-elevated p-3 popover-surface">
            {tierFacet.length > 1 && (
              <fieldset>
                <legend className="mb-1 text-[12px] font-medium text-ink-secondary">{t("memoryManager.tier")}</legend>
                {tierFacet.map((facet) => (
                  <label key={facet.value} className="flex items-center gap-2 py-0.5 text-[13px] text-ink">
                    <input type="checkbox" checked={filters.tiers.includes(facet.value)} onChange={() => toggleIn("tiers", facet.value)} />
                    <Swatch color={tierColor.get(facet.value) ?? "var(--color-ink-tertiary)"} />
                    <span className="min-w-0 flex-1 truncate">{tierName.get(facet.value) ?? ""}</span>
                    <span className="text-[11px] tabular-nums text-ink-tertiary">{facet.count}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {tagFacet.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-[12px] font-medium text-ink-secondary">{t("memoryManager.tags")}</legend>
                <div className="flex flex-wrap gap-1">
                  {tagFacet.map((facet) => (
                    <button key={facet.value} type="button" aria-pressed={filters.tags.includes(facet.value)} onClick={() => toggleIn("tags", facet.value)} className={cn("rounded-full px-2 py-px text-[11px]", filters.tags.includes(facet.value) ? "bg-accent text-accent-ink" : "bg-raised text-ink")}>
                      {facet.value} <span className="tabular-nums opacity-70">{facet.count}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {authorFacet.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-[12px] font-medium text-ink-secondary">{t("memoryManager.author")}</legend>
                {authorFacet.map((facet) => (
                  <label key={facet.value} className="flex items-center gap-2 py-0.5 text-[13px] text-ink">
                    <input type="checkbox" checked={filters.authors.includes(facet.value)} onChange={() => toggleIn("authors", facet.value)} />
                    <span className="min-w-0 flex-1 truncate">{facet.value}</span>
                    <span className="text-[11px] tabular-nums text-ink-tertiary">{facet.count}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.filter.changed")}</span>
              <select value={filters.age} onChange={(event) => setFilters((current) => ({ ...current, age: event.target.value as AgeFilter }))} className={FIELD}>
                <option value="">{t("memoryManager.filter.ageAny")}</option>
                {(Object.keys(ageLabel) as Array<keyof typeof ageLabel>).map((age) => <option key={age} value={age}>{ageLabel[age]}</option>)}
              </select>
            </label>
            {active > 0 && <button type="button" className="self-start text-[12px] text-accent-text hover:underline" onClick={() => setFilters(NO_FILTERS)}>{t("memoryManager.filter.clear")}</button>}
          </div>
        </details>
        <div className="ml-auto flex items-center gap-2">
          <MiniSegment<ListSort>
            label={t("memoryManager.sort")}
            value={sort}
            onChange={setSort}
            options={[
              { value: "updated", label: t("memoryManager.sort.updated") },
              { value: "title", label: t("memoryManager.sort.title") },
              { value: "manual", label: t("memoryManager.sort.manual") },
            ]}
            data-memory-list-sort=""
          />
          <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-secondary" data-memory-list-count="">{t("memoryManager.countOf", { n: shown.length, total: inView.length })}</span>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="sticky top-0 z-10 mt-2.5 flex flex-wrap items-center gap-1.5 rounded-xl bg-accent py-1.5 pl-3.5 pr-2 text-[13px] text-accent-ink" role="toolbar" aria-label={t("memoryManager.bulkBar")} data-memory-bulk="">
          <b className="mr-auto font-semibold">{t("memoryManager.selected", { count: selected.length })}</b>
          {movable && (
            <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] shadow-[inset_0_0_0_1px_currentColor] hover:bg-ink/10" onClick={() => onMove?.(keys)} data-memory-bulk-move="">
              <FolderInput size={14} aria-hidden="true" />{t("memoryManager.move")}
            </button>
          )}
          {onRestore && (
            <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] shadow-[inset_0_0_0_1px_currentColor] hover:bg-ink/10" onClick={() => onRestore(keys)} disabled={busy} data-memory-bulk-restore="">
              <RotateCcw size={14} aria-hidden="true" />{restoreLabel ?? t("memoryManager.restore")}
            </button>
          )}
          {onDelete && (
            <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] shadow-[inset_0_0_0_1px_currentColor] hover:bg-ink/10" onClick={() => onDelete(keys)} disabled={busy} data-memory-bulk-delete="">
              <Trash2 size={14} aria-hidden="true" />{t("memoryManager.delete")}
            </button>
          )}
          <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-ink/10" onClick={() => setPicked(new Set())} aria-label={t("memoryManager.bulkClear")} title={t("memoryManager.bulkClear")}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {shown.length > 0 && (
        <div className="mt-3 flex items-center gap-2.5 border-b border-hairline/50 px-2.5 py-1.5 text-[12px] text-ink-secondary">
          {selectable.length > 0
            ? <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allOn; }} onChange={toggleAll} aria-label={t("memoryManager.selectAll")} data-memory-select-all="" />
            : <span className="w-[13px]" />}
          <span>{fixedView ? t("memoryManager.listHintFixed", { n: shown.length }) : t("memoryManager.listHint", { n: shown.length })}</span>
        </div>
      )}

      <div role={shown.length > 0 ? "list" : undefined} className="flex flex-col" data-memory-rows="">
        {shown.map((entry) => {
          const on = picked.has(entry.key);
          const row = entry.row;
          const when = relLabel(row.updatedAt, now);
          return (
            <div key={entry.key} role="listitem" className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border-b border-hairline/40 px-2.5 py-3 hover:bg-hover", on && "bg-accent/10")} data-memory-note-row={row.id} data-memory-row-key={entry.key}>
              {canSelect(entry)
                ? <input type="checkbox" checked={on} onChange={() => toggle(entry.key)} className="mt-[3px]" aria-label={t("memoryManager.selectNote", { title: row.title })} />
                : <span className="w-[13px]" />}
              <button
                type="button"
                className="flex min-w-0 flex-col gap-1 text-left"
                onClick={() => {
                  if (clickTimer.current) clearTimeout(clickTimer.current);
                  clickTimer.current = setTimeout(() => { clickTimer.current = null; onOpen(entry); }, 0);
                }}
                onDoubleClick={() => { if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = null; if (!row.archived) onEdit(entry); }}
                data-memory-row-open=""
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("truncate text-[14px] font-semibold", row.archived ? "text-ink-secondary" : "text-ink")}>{row.title || row.id}</span>
                  {row.status === "proposed" && <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[11px] text-warning">{t("memoryManager.proposed")}</span>}
                </span>
                {row.excerpt && <span className="line-clamp-2 text-[13px] leading-[1.5] text-ink-secondary">{excerptLabel(row.excerpt)}</span>}
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-secondary">
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                    <Swatch color={tierColor.get(entry.tier) ?? "var(--color-ink-tertiary)"} />
                    {tierName.get(entry.tier) ?? ""}
                  </span>
                  {entry.folderPath && <span>{entry.folderPath}</span>}
                  {(row.tags ?? []).slice(0, 4).map((tag) => <TagChip key={tag}>{tag}</TagChip>)}
                  {(row.tags ?? []).length > 4 && <span>+{(row.tags ?? []).length - 4}</span>}
                  {row.links ? (
                    <span className="inline-flex items-center gap-0.5" title={t("memoryManager.linksCount", { n: row.links })}>
                      <Link2 size={12} aria-hidden="true" />{row.links}
                    </span>
                  ) : null}
                  {row.archived && <TagChip>{t("memoryManager.archivedChip")}</TagChip>}
                </span>
              </button>
              <span className="flex flex-col items-end gap-1.5 whitespace-nowrap text-[12px] text-ink-secondary">
                {row.author && <AuthorBadge name={row.author} />}
                {when && <span title={row.updatedAt ? new Date(row.updatedAt).toLocaleString() : undefined}>{when}</span>}
              </span>
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="px-2.5 py-8 text-[13px] text-ink-secondary" data-memory-list-empty="">
            {loading ? t("memoryManager.loading") : query.trim() || active ? t("memoryManager.listNone") : emptyText}
          </div>
        )}
      </div>
      {shown.length > 0 && query.trim() && (
        <button type="button" className={cn(GHOST_BUTTON, "mt-2 self-start text-ink-secondary")} onClick={() => setQuery("")}>{t("memoryManager.clearSearch")}</button>
      )}
    </section>
  );
}
