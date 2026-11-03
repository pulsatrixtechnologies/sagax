// Tools > Memory > Map: the Perspicax console's map chrome (notes.tsx
// MapView, 2026-11-02) around Sagax's own memory map (MemoryMapCanvas, the
// Team map's cards): "Find on the map", the tier chips with their counts,
// "n notes, m links · k waiting for review", the tag filter, the minimap,
// zoom and fit, and the timeline under the map that replays the notes by
// the day they were written.
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { buildMemoryPageGraph } from "@/lib/memory-map";
import type { PageRow, PageTier } from "@/lib/memory-page";
import { MemoryMapCanvas } from "./MemoryMapCanvas";
import { FIELD, Swatch } from "./memory-ui";

const STEPS = 60;

export function MemoryMapView({ rows, tiers, bodies, review, focusKey, onOpen }: {
  rows: PageRow[];
  tiers: PageTier[];
  bodies: Record<string, string>;
  /** Notes waiting for a review. */
  review: number;
  focusKey?: string | null;
  onOpen: (key: string) => void;
}) {
  const [focus, setFocus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [step, setStep] = useState(STEPS);
  const [playing, setPlaying] = useState(false);

  const shown = useMemo(() => (focus === "all" ? rows : rows.filter((entry) => entry.tier === focus)), [rows, focus]);
  const graph = useMemo(() => buildMemoryPageGraph(
    tiers.map((tier) => ({
      key: tier.key,
      name: tier.name,
      notes: shown.filter((entry) => entry.tier === tier.key).map((entry) => ({ ...entry.row, id: entry.key, folder: entry.folderPath || undefined })),
    })),
    Object.fromEntries(shown.filter((entry) => bodies[entry.key]).map((entry) => [entry.key, bodies[entry.key]!])),
  ), [tiers, shown, bodies]);
  const links = graph.edges.filter((edge) => edge.kind === "link").length;
  const tierCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of rows) counts.set(entry.tier, (counts.get(entry.tier) ?? 0) + 1);
    return counts;
  }, [rows]);
  const color = useMemo(() => new Map(tiers.map((tier) => [tier.key, tier.color])), [tiers]);
  const tierOf = useMemo(() => new Map(rows.map((entry) => [entry.key, entry.tier])), [rows]);
  const tags = useMemo(() => [...new Set(shown.flatMap((entry) => entry.row.tags ?? []))].sort(), [shown]);

  // The timeline: from the first note written to now.
  const dates = useMemo(() => new Map(shown.map((entry) => [entry.key, entry.row.createdAt ?? entry.row.updatedAt])), [shown]);
  const known = [...dates.values()].filter((at): at is number => at != null);
  const now = Date.now();
  const start = known.length ? Math.min(...known) : now;
  const cursor = start + ((now - start) * step) / STEPS;
  const hidden = useMemo(() => {
    if (step >= STEPS) return null;
    const out = new Set<string>();
    for (const [key, at] of dates) if (at != null && at > cursor) out.add(key);
    return out;
  }, [dates, cursor, step]);
  const visible = shown.length - (hidden?.size ?? 0);
  useEffect(() => {
    if (!playing) return;
    if (step >= STEPS) { setPlaying(false); return; }
    const timer = setTimeout(() => setStep((current) => Math.min(STEPS, current + 1)), 80);
    return () => clearTimeout(timer);
  }, [playing, step]);

  const dimmed = useMemo(() => {
    const words = search.trim().toLowerCase();
    if (!words && !tag) return null;
    return new Set(shown.filter((entry) => (!words || entry.row.title.toLowerCase().includes(words)) && (!tag || (entry.row.tags ?? []).includes(tag))).map((entry) => entry.key));
  }, [shown, search, tag]);

  const whenLabel = step >= STEPS ? t("memoryManager.map.today") : new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium" }).format(new Date(cursor));
  const chip = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-memory-map-view="">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-[240px] min-w-0 items-center gap-1.5 rounded-full border border-hairline/60 bg-panel px-3 text-ink focus-within:ring-2 focus-within:ring-accent/60">
          <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} placeholder={t("memoryManager.map.search")} aria-label={t("memoryManager.map.search")} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-tertiary" data-memory-map-search="" />
        </label>
        <div role="group" aria-label={t("memoryManager.tiers")} className="flex flex-wrap items-center gap-1.5" data-memory-map-tiers="">
          <button type="button" aria-pressed={focus === "all"} onClick={() => setFocus("all")} className={cn(chip, focus === "all" ? "border-accent/60 bg-raised text-ink" : "border-hairline/60 text-ink-secondary hover:text-ink")}>
            {t("memoryManager.map.all")}
          </button>
          {tiers.map((tier) => (
            <button key={tier.key} type="button" aria-pressed={focus === tier.key} onClick={() => setFocus(focus === tier.key ? "all" : tier.key)} className={cn(chip, focus === tier.key ? "border-accent/60 bg-raised text-ink" : "border-hairline/60 text-ink-secondary hover:text-ink")} data-memory-map-tier={tier.key}>
              <Swatch color={tier.color} />{tier.name}
              <span className="tabular-nums text-ink-tertiary">{tierCount.get(tier.key) ?? 0}</span>
            </button>
          ))}
        </div>
        <p className="ml-auto text-[12.5px] tabular-nums text-ink-secondary" aria-live="polite" data-memory-map-count="">
          {dimmed ? t("memoryManager.map.hits", { n: dimmed.size }) : t("memoryManager.map.count", { notes: shown.length, links })}
          {!dimmed && review > 0 ? ` · ${t("memoryManager.map.waiting", { n: review })}` : ""}
        </p>
      </div>
      <div className="relative flex min-h-[420px] flex-1 overflow-hidden rounded-xl border border-hairline/50">
        <MemoryMapCanvas
          graph={graph}
          onOpenNote={onOpen}
          dimmedNoteIds={dimmed}
          hiddenNoteIds={hidden}
          focusNoteId={focusKey}
          selectedNoteId={focusKey}
          noteColor={(key) => color.get(tierOf.get(key) ?? "")}
          overlay={tags.length > 0 ? (
            <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label={t("memoryManager.map.tags")} className={cn(FIELD, "h-8 w-auto bg-panel py-0 text-[12.5px]")} data-memory-map-tag="">
              <option value="">{t("memoryManager.map.allTags")}</option>
              {tags.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : undefined}
        />
      </div>
      {shown.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-hairline/50 bg-panel px-3 py-2" data-memory-map-timeline="">
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-ink hover:bg-raised-hover"
            aria-label={playing ? t("memoryManager.map.pause") : t("memoryManager.map.play")}
            onClick={() => { if (!playing && step >= STEPS) setStep(0); setPlaying((on) => !on); }}
            data-memory-map-play=""
          >
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          </button>
          <input type="range" min={0} max={STEPS} value={step} onChange={(event) => { setPlaying(false); setStep(Number(event.target.value)); }} aria-label={t("memoryManager.map.timeline")} className="min-w-0 flex-1 accent-[var(--color-accent)]" />
          <span className="shrink-0 whitespace-nowrap text-[12.5px] tabular-nums text-ink-secondary" data-memory-map-when="">{t("memoryManager.map.when", { when: whenLabel, n: visible })}</span>
        </div>
      )}
      <p className="text-[12px] text-ink-tertiary">{t("memoryManager.map.help")}</p>
    </div>
  );
}
