// Tools > Memory > Map, the Perspicax console's (notes.tsx MapView,
// 2026-11-02): "Find on the map", the tier chips with their counts,
// "n notes, m links · k waiting for review", the tag filter, the minimap,
// zoom and fit, and the timeline under the map that replays the notes by
// the day they were written. The map itself is the console's radial brain
// (BrainMap.tsx, lib/memory-brain.ts); Sagax's column map (Team map cards)
// stays one press away for a reader who prefers it. Graph (the default since
// 2026-11-03, JC) is Obsidian's graph view: MemoryGraph.tsx,
// lib/memory-graph.ts. `scope` is the rail's selection: the map shows the
// notes it keeps, in all three layouts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Columns3, Network, Orbit, Pause, Play, Search, SlidersHorizontal, Tag, Waypoints } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { buildBrain, neighborhoodBrain, noteKey, pageGraph, pageTree, spotlight, timelineOf, veilOf, type BrainNode } from "@/lib/memory-brain";
import { buildMemoryPageGraph } from "@/lib/memory-map";
import type { GraphNote } from "@/lib/memory-graph";
import type { PageRow, PageTier } from "@/lib/memory-page";
import { BrainEmpty, BrainMap } from "./BrainMap";
import { MemoryGraph } from "./MemoryGraph";
import { MemoryMapCanvas } from "./MemoryMapCanvas";
import { readGraphSettings } from "@/lib/memory-graph-settings";
import { useStoreOptional } from "@/state/store";
import { PillSelect, type PillOption } from "../SettingsPrimitives";
import { excerptLabel, MiniSegment, relLabel, Swatch } from "./memory-ui";

type Layout = "graph" | "brain" | "columns";

const STEPS = 60;

export function MemoryMapView({ rows: allRows, tiers, bodies, review, focusKey, onOpen, onOpenNote, onNew, scope }: {
  rows: PageRow[];
  tiers: PageTier[];
  bodies: Record<string, string>;
  /** Notes waiting for a review. */
  review: number;
  focusKey?: string | null;
  /** A note chosen on the map: its preview. */
  onOpen: (key: string) => void;
  /** A note double-clicked on the graph: its page (else the preview). */
  onOpenNote?: (key: string) => void;
  /** The empty map's invitation. */
  onNew?: () => void;
  /** The rail's selection: only the notes it keeps are on the map. */
  scope?: ((row: PageRow) => boolean) | null;
}) {
  const rows = useMemo(() => (scope ? allRows.filter(scope) : allRows), [allRows, scope]);
  const [layout, setLayout] = useState<Layout>("graph");
  const [depth, setDepth] = useState(1);
  const [focus, setFocus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [step, setStep] = useState(STEPS);
  const [playing, setPlaying] = useState(false);
  const principalId = useStoreOptional()?.state.config?.viewer?.principalId ?? null;
  const [settingsOpen, setSettingsOpen] = useState(() => readGraphSettings(principalId).open);

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
  // The few fixed scopes stay buttons; every team (data-built, 50+ is real) goes in one searchable select.
  const fixedTiers = useMemo(() => tiers.filter((tier) => tier.kind !== "team" || tier.fixed), [tiers]);
  const teamTiers = useMemo(() => tiers.filter((tier) => tier.kind === "team" && !tier.fixed), [tiers]);
  const teamOptions = useMemo(() => teamTiers
    .map((tier) => ({ value: tier.key, label: tier.name, color: tier.color, count: tierCount.get(tier.key) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, activeLocale()))
    .map((option) => ({ ...option, quiet: option.count === 0 })), [teamTiers, tierCount]);
  // One scope select: every scope with its count (the fixed ones first, then the data-built teams under their heading).
  const scopeOptions = useMemo<PillOption<string>[]>(() => [
    { value: "all", label: t("memoryManager.map.all"), count: rows.length },
    ...fixedTiers.map((tier) => ({ value: tier.key, label: tier.name, color: tier.color, count: tierCount.get(tier.key) ?? 0 })),
    ...teamOptions.map((option) => ({ ...option, group: t("memoryManager.map.teams") })),
  ], [rows.length, fixedTiers, tierCount, teamOptions]);
  const color = useMemo(() => new Map(tiers.map((tier) => [tier.key, tier.color])), [tiers]);
  const tierOf = useMemo(() => new Map(rows.map((entry) => [entry.key, entry.tier])), [rows]);
  const tags = useMemo(() => [...new Set(shown.flatMap((entry) => entry.row.tags ?? []))].sort(), [shown]);
  const tagOptions = useMemo<PillOption<string>[]>(() => [{ value: "", label: t("memoryManager.map.allTags"), triggerLabel: t("memoryManager.tags") }, ...tags.map((value) => ({ value, label: value }))], [tags]);

  // The console's radial brain of the rows shown.
  const wholeBrain = useMemo(() => buildBrain(pageTree(rows, tiers), pageGraph(rows, bodies), {
    own: "mine",
    focus: focusKey && depth ? "all" : focus,
    names: { all: t("memoryManager.map.all"), untitled: t("memoryManager.collections.untitled"), tier: (tier) => tier.name },
  }), [rows, tiers, bodies, focus, focusKey, depth]);
  const centre = useMemo(() => {
    if (!focusKey) return null;
    const entry = rows.find((row) => row.key === focusKey);
    return entry ? noteKey(entry.tier, entry.key) : null;
  }, [focusKey, rows]);
  const brain = useMemo(() => (centre && depth ? neighborhoodBrain(wholeBrain, centre, depth) : wholeBrain), [wholeBrain, centre, depth]);
  const stops = useMemo(() => timelineOf(brain), [brain]);

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

  const graphNotes = useMemo<GraphNote[]>(() => {
    const names = new Map(tiers.map((tier) => [tier.key, tier.name]));
    return shown.map((entry) => ({
      key: entry.key,
      title: entry.row.title,
      tier: entry.tier,
      tierName: names.get(entry.tier) ?? "",
      folderPath: entry.folderPath,
      tags: entry.row.tags ?? [],
      body: bodies[entry.key],
      path: entry.row.path,
      createdAt: entry.row.createdAt ?? entry.row.updatedAt,
    }));
  }, [shown, tiers, bodies]);
  const brainAt = step >= STEPS ? null : stops[Math.min(stops.length - 1, Math.round((step / STEPS) * (stops.length - 1)))] ?? null;
  const veil = useMemo(() => veilOf(brain, { at: brainAt, tags: tag ? [tag] : [] }), [brain, brainAt, tag]);
  const hits = useMemo(() => spotlight(brain, search), [brain, search]);
  const brainLinks = brain.links.length;
  const colorOf = useCallback((scope: string) => color.get(scope) ?? "var(--color-accent)", [color]);
  const card = (node: BrainNode) => (
    <>
      <p className="break-words text-[14px] font-semibold text-ink">{node.label}</p>
      {node.kind === "note" && node.excerpt ? <p className="mt-1 line-clamp-2 text-[13px] leading-[1.4] text-ink">{excerptLabel(node.excerpt)}</p> : null}
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-secondary">
        {node.kind === "note" && <Swatch color={colorOf(node.scope)} />}
        {node.kind === "note"
          ? [tiers.find((tier) => tier.key === node.scope)?.name, node.topic, relLabel(node.updated ? Date.parse(node.updated) : undefined), node.author].filter(Boolean).join(" · ")
          : t("memoryManager.map.notesN", { n: node.count })}
      </p>
    </>
  );

  const countText = (layout === "brain"
    ? (hits ? t("memoryManager.map.hits", { n: hits.hits.size }) : t("memoryManager.map.count", { notes: brain.notes, links: brainLinks }))
    : dimmed ? t("memoryManager.map.hits", { n: dimmed.size }) : t("memoryManager.map.count", { notes: shown.length, links }))
    + (!dimmed && review > 0 ? ` · ${t("memoryManager.map.waiting", { n: review })}` : "");
  const whenLabel = step >= STEPS ? t("memoryManager.map.today") : new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium" }).format(new Date(layout === "brain" && brainAt != null ? brainAt : cursor));
  const chip = "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-memory-map-view="">
      <div className="@container" data-memory-map-bar-host="">
        {/* one row of 36px controls, one 8px gap; nothing is cut: the search gives way first, and a very narrow page wraps (never scrolls) */}
        <div className="flex flex-wrap items-center gap-2" data-memory-map-bar="">
          <label className="flex h-9 min-w-[180px] flex-1 basis-[180px] @max-[640px]:min-w-[106px] @max-[640px]:basis-[106px] items-center gap-1.5 rounded-full border border-hairline/60 bg-panel px-3 text-ink focus-within:ring-2 focus-within:ring-accent/60">
            <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} placeholder={t("memoryManager.map.search")} aria-label={t("memoryManager.map.search")} className="min-w-0 flex-1 overflow-hidden text-ellipsis bg-transparent text-[13px] outline-none placeholder:text-ink-tertiary" data-memory-map-search="" />
          </label>
          <div className="flex min-w-0 max-w-[230px] shrink @max-[640px]:w-[140px] @max-[640px]:max-w-[140px]" data-memory-map-tiers="" data-memory-map-teams="">
            <PillSelect
              value={focus}
              onChange={setFocus}
              ariaLabel={t("memoryManager.tiers")}
              searchAbove={8}
              searchLabel={t("memoryManager.map.teamsSearch")}
              active={focus !== "all"}
              triggerClass={cn(chip, "w-full min-w-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/70", focus !== "all" ? "border-accent/60 bg-raised text-ink" : "border-hairline/60 text-ink hover:bg-hover")}
              options={scopeOptions}
            />
          </div>
          {tags.length > 0 && (
            <div className="flex min-w-0 max-w-[150px] shrink @max-[640px]:w-[120px] @max-[640px]:max-w-[120px]" data-memory-map-tags="">
              <PillSelect
                value={tag}
                onChange={setTag}
                leading={<Tag size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />}
                ariaLabel={t("memoryManager.map.tags")}
                searchAbove={8}
                searchLabel={t("memoryManager.map.tags")}
                triggerClass={cn(chip, "w-full min-w-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/70", tag ? "border-accent/60 bg-raised text-ink" : "border-hairline/60 text-ink hover:bg-hover")}
                options={tagOptions}
              />
            </div>
          )}
          <MiniSegment<Layout>
            label={t("memoryManager.map.layout")}
            value={layout}
            onChange={setLayout}
            tall
            options={[
              { value: "graph", label: t("memoryManager.map.layoutGraph"), icon: <Waypoints size={14} aria-hidden="true" /> },
              { value: "brain", label: t("memoryManager.map.layoutBrain"), icon: <Orbit size={14} aria-hidden="true" /> },
              { value: "columns", label: t("memoryManager.map.layoutColumns"), icon: <Columns3 size={14} aria-hidden="true" /> },
            ]}
            data-memory-map-layout-switch=""
          />
          {layout === "graph" && shown.length > 0 && (
            <button
              type="button"
              className={cn("grid size-9 shrink-0 place-items-center rounded-full border hover:text-ink", settingsOpen ? "border-accent/60 bg-raised text-ink" : "border-hairline/60 bg-panel text-ink-secondary")}
              aria-label={t("memoryManager.graph.settings")}
              title={t("memoryManager.graph.settings")}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
              data-testid="memory-graph-settings-open"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {centre && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-secondary" data-memory-map-neighbourhood="">
          <Network size={14} aria-hidden="true" />
          <span className="font-medium text-ink">{rows.find((row) => row.key === focusKey)?.row.title}</span>
          <MiniSegment<string>
            label={t("memoryManager.map.depth")}
            value={String(depth)}
            onChange={(next) => setDepth(Number(next))}
            options={[
              { value: "0", label: t("memoryManager.map.everything") },
              { value: "1", label: t("memoryManager.map.level") },
              { value: "2", label: t("memoryManager.map.levels") },
            ]}
          />
        </div>
      )}
      <div className="relative flex min-h-[420px] flex-1 overflow-hidden rounded-xl" data-memory-map-layout={layout}>
        {layout === "graph" ? (
          shown.length === 0 ? (
            <BrainEmpty invite={t("memoryManager.map.first")} onInvite={onNew} testId="memory-map-empty" />
          ) : (
            <MemoryGraph
              notes={graphNotes}
              tierColor={colorOf}
              matches={dimmed}
              hidden={hidden}
              focusKey={focusKey}
              depth={focusKey ? depth : 0}
              onPreview={onOpen}
              onOpen={onOpenNote ?? onOpen}
              onAnimate={() => { setStep(0); setPlaying(true); }}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
            />
          )
        ) : layout === "brain" ? (
          brain.notes === 0 ? (
            <BrainEmpty invite={t("memoryManager.map.first")} onInvite={onNew} testId="memory-map-empty" />
          ) : (
            <BrainMap
              brain={brain}
              colorOf={colorOf}
              search={search}
              current={centre}
              selected={centre}
              veil={veil}
              onSelect={(node) => {
                if (node.kind === "note" && node.id) onOpen(node.id);
                else if (node.kind === "tier") setFocus(node.scope);
                else if (node.kind === "root" && focus !== "all") setFocus("all");
              }}
              renderCard={card}
              labels={{ zoomIn: t("memoryManager.mapZoomIn"), zoomOut: t("memoryManager.mapZoomOut"), fit: t("memoryManager.mapFit"), graph: t("memoryManager.map.graph"), minimap: t("memoryManager.mapMinimap") }}
              testId="memory-brain"
            />
          )
        ) : (
          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-hairline/50">
            <MemoryMapCanvas
              graph={graph}
              onOpenNote={onOpen}
              dimmedNoteIds={dimmed}
              hiddenNoteIds={hidden}
              focusNoteId={focusKey}
              selectedNoteId={focusKey}
              noteColor={(key) => color.get(tierOf.get(key) ?? "")}
            />
          </div>
        )}
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
          <span className="shrink-0 whitespace-nowrap text-[12.5px] tabular-nums text-ink-secondary" data-memory-map-when="">{t("memoryManager.map.when", { when: whenLabel, n: layout === "brain" ? (veil ? veil.notes : brain.notes) : visible })}</span>
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* the map's own count: out of the toolbar row, never cut */}
        <p className="text-[12.5px] tabular-nums text-ink-secondary" aria-live="polite" title={countText} data-memory-map-count="" data-memory-map-count-text={countText}>{countText}</p>
        <p className="text-[12px] text-ink-tertiary">{t("memoryManager.map.help")}</p>
      </div>
    </div>
  );
}
