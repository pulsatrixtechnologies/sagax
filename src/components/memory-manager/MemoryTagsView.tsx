// Tools > Memory > Tags, the Perspicax console's (tags.tsx and
// tags-overview.tsx, 2026-11-02): the tiles (Namespaces, Values, Free tags,
// Orphans), Tag namespaces, Orphan tags, Free tags as chips, and the most
// used tags as bars. Namespaces, values and orphans come from the
// organization's vocabulary on its Perspicax server; without one those
// tiles and cards stay out (Sagax never makes a number up). The console's
// team directory is an organization setting with no Sagax source: not here.
import { useState } from "react";
import { Tags } from "lucide-react";

import { t } from "@/lib/i18n";
import type { MemoryVocabulary } from "@/lib/memory-manager";
import type { TagStats } from "@/lib/memory-page";
import { MemoryCard, StatStrip, TagChip, type StatTile } from "./memory-ui";

const FREE_FIRST_PAGE = 24;

export function MemoryTagsView({ stats, vocabulary, onTag }: {
  stats: TagStats;
  vocabulary: MemoryVocabulary | null;
  /** A tag pressed: the notes that carry it. */
  onTag: (tag: string) => void;
}) {
  const tiles: StatTile[] = [];
  if (stats.namespaces != null) tiles.push({ id: "namespaces", label: t("memoryManager.tags.namespaces"), value: stats.namespaces, caption: t("memoryManager.tags.namespacesCaption", { controlled: stats.controlled ?? 0, required: stats.required ?? 0 }) });
  if (stats.values != null) tiles.push({ id: "values", label: t("memoryManager.tags.values"), value: stats.values, caption: t("memoryManager.tags.valuesCaption") });
  tiles.push({ id: "free", label: t("memoryManager.tags.free"), value: stats.free.length, caption: t("memoryManager.tags.freeCaption") });
  if (stats.orphans) tiles.push({ id: "orphans", label: t("memoryManager.tags.orphans"), value: stats.orphans.length, caption: t("memoryManager.tags.orphansCaption") });
  const counts = new Map(stats.free.map((entry) => [entry.tag, entry.count]));
  // Free tags grow with use (50+ is common): a search and a first page, never a wall of chips.
  const [freeQuery, setFreeQuery] = useState("");
  const [freeAll, setFreeAll] = useState(false);
  const freeNeedle = freeQuery.trim().toLowerCase();
  const freeMatches = freeNeedle ? stats.free.filter((entry) => entry.tag.toLowerCase().includes(freeNeedle)) : stats.free;
  const freeShown = freeAll || freeNeedle ? freeMatches : freeMatches.slice(0, FREE_FIRST_PAGE);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6" data-memory-tags-view="">
      <div>
        <h2 className="text-[20px] font-semibold text-ink">{t("memoryManager.tags.title")}</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">{t("memoryManager.tags.subtitle")}</p>
      </div>
      <StatStrip items={tiles} data-memory-tags-tiles="" />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          {vocabulary && (
            <section className="grid min-w-0 gap-3" data-memory-tags-namespaces="">
              <div>
                <h3 className="text-[16px] font-semibold text-ink">{t("memoryManager.tags.namespacesTitle")}</h3>
                <p className="mt-1 text-[12.5px] text-ink-secondary">{t("memoryManager.tags.namespacesHint")}</p>
              </div>
              {vocabulary.namespaces.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline/60 p-6 text-center" data-memory-tags-namespaces-empty="">
                  <Tags size={18} className="mx-auto mb-2 text-ink-tertiary" aria-hidden="true" />
                  <p className="text-[13px] font-medium text-ink">{t("memoryManager.tags.namespacesEmpty")}</p>
                  <p className="mt-1 text-[12.5px] text-ink-secondary">{t("memoryManager.tags.namespacesEmptyHint")}</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-hairline/50 bg-panel">
                  {vocabulary.namespaces.map((ns) => (
                    <div key={ns.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-hairline/40 px-4 py-2.5 last:border-b-0" data-memory-tags-namespace={ns.id}>
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[13px] font-medium text-ink">{ns.id}</span>
                        {(ns.label_en || ns.label_fr) && <span className="block truncate text-[12px] text-ink-secondary">{ns.label_en || ns.label_fr}</span>}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {ns.controlled && <TagChip>{t("memoryManager.tags.controlled")}</TagChip>}
                        {ns.required && <TagChip>{t("memoryManager.tags.required")}</TagChip>}
                        {!ns.controlled && !ns.required && <TagChip>{t("memoryManager.tags.freeRule")}</TagChip>}
                      </span>
                      <span className="text-right text-[12.5px] tabular-nums text-ink-secondary">{t("memoryManager.tags.valuesN", { n: ns.tags.length })}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {stats.orphans && (
            <MemoryCard title={t("memoryManager.tags.orphansTitle")} aside={stats.orphans.length ? t("memoryManager.tags.orphansTodo") : t("memoryManager.tags.clean")} data-memory-tags-orphans="">
              {stats.orphans.length === 0 ? <p className="text-[13px] text-ink-secondary">{t("memoryManager.tags.orphansNone")}</p> : (
                <div className="flex flex-col">
                  {stats.orphans.map((orphan) => (
                    <button key={orphan.tag} type="button" onClick={() => onTag(orphan.tag)} className="grid gap-0.5 border-t border-hairline/40 py-2.5 text-left first:border-t-0">
                      <span className="truncate font-mono text-[13px] font-medium text-ink">{orphan.tag}</span>
                      <span className="text-[12.5px] text-ink-secondary">
                        {t("memoryManager.tags.orphanNotes", { n: orphan.count })} · {orphan.closest ? t("memoryManager.tags.closest", { value: orphan.closest }) : t("memoryManager.tags.noClosest")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </MemoryCard>
          )}
          <MemoryCard title={t("memoryManager.tags.freeTitle")} aside={t("memoryManager.tags.freeHint")} data-memory-tags-free="">
            {stats.free.length === 0 ? <p className="text-[13px] text-ink-secondary">{t("memoryManager.tags.freeNone")}</p> : (
              <>
              {stats.free.length > FREE_FIRST_PAGE && (
                <input type="search" value={freeQuery} onChange={(event) => setFreeQuery(event.target.value)} placeholder={t("memoryManager.tags.freeFind")} aria-label={t("memoryManager.tags.freeFind")} className="mb-2 h-8 w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 text-[13px] text-ink outline-none focus:border-border-strong" data-memory-tags-free-search="" />
              )}
              <ul className="flex flex-wrap gap-1.5">
                {freeShown.map((entry) => (
                  <li key={entry.tag}>
                    <button type="button" onClick={() => onTag(entry.tag)} className="inline-flex items-baseline gap-1.5 rounded-full bg-raised px-2.5 py-0.5 font-mono text-[12px] text-ink hover:bg-raised-hover" data-memory-tags-free-chip={entry.tag}>
                      {entry.tag}<span className="font-sans font-semibold tabular-nums">{counts.get(entry.tag)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!freeAll && !freeNeedle && freeMatches.length > FREE_FIRST_PAGE && (
                <button type="button" onClick={() => setFreeAll(true)} className="mt-2 text-[12.5px] text-ink-secondary hover:text-ink" data-memory-tags-free-all="">{t("memoryManager.tags.showAll", { n: freeMatches.length })}</button>
              )}
              {freeNeedle && freeMatches.length === 0 && <p className="text-[13px] text-ink-secondary">{t("chat.find.noResults")}</p>}
              </>
            )}
          </MemoryCard>
        </div>
        <MemoryCard title={t("memoryManager.tags.top")} data-memory-tags-top="">
          {stats.top.length === 0 ? <p className="text-[13px] text-ink-secondary">{t("memoryManager.tags.topEmpty")}</p> : (
            <ul className="grid gap-2">
              {stats.top.map((entry) => (
                <li key={entry.tag} className="grid min-w-0 grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-[13px]">
                  <button type="button" onClick={() => onTag(entry.tag)} className="min-w-0 truncate text-left font-mono text-[12px] text-ink hover:underline" title={entry.tag}>{entry.tag}</button>
                  <span className="h-2 min-w-0 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, entry.share)}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-ink-secondary">{entry.count}</span>
                </li>
              ))}
            </ul>
          )}
        </MemoryCard>
      </div>
    </div>
  );
}
