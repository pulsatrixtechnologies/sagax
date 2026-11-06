// Tools > Memory > Map > Graph (2026-11-03, JC: "the EXACT same
// visualisation that we see in Obsidian, I want it to look like a brain").
// Written for Sagax from how Obsidian's graph view looks and behaves; none
// of its code (closed) is used.
//
// Every note is a small filled circle, a little larger the more it is
// linked; thin grey lines join the notes a [[link]] joins and, with
// "Folders and tiers" on, each note to its folder and each folder to its
// tier, so a bot's Topics and Logs gather even without a link. A force
// simulation (centre, repel, link, link distance; lib/memory-graph.ts)
// runs live, settles, and sleeps: no frame is drawn once nothing moves.
// Drag the canvas to pan, scroll or pinch to zoom, drag a node and the
// others follow; hovering a node lights it, its neighbours and their links
// and dims the rest; a click previews the note, a double-click opens it.
// The labels fade in past a zoom threshold. The Graph settings card (top
// right) has Filters, Groups, Display and Forces, remembered per person.
// The page's Find on the map, tier chips, timeline and neighbourhood depth
// drive it as they drive the radial map, and a minimap sits in a corner.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Maximize2, Minus, Play, Plus, RotateCcw, Settings2, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stableIndex } from "@/lib/memory-brain";
import {
  boundsOf,
  buildGraph,
  createSimulation,
  fitBounds,
  matchesQuery,
  nodeRadius,
  withinDepth,
  type GraphModel,
  type GraphNote,
  type GraphView,
  type Simulation,
} from "@/lib/memory-graph";
import {
  DEFAULT_GRAPH_SETTINGS,
  DISPLAY_RANGES,
  FORCE_RANGES,
  readGraphSettings,
  writeGraphSettings,
  type GraphSection,
  type GraphSettings,
} from "@/lib/memory-graph-settings";
import { useStoreOptional } from "@/state/store";
import { Switch } from "../SettingsPrimitives";
import { FIELD, MiniSegment } from "./memory-ui";
import { paintGraphFrame, paintGraphMini } from "./memory-graph-draw";
import { useMemoryGraphInteraction } from "./useMemoryGraphInteraction";

/** Folder colours (Colour by: Folder): the page's own swatches. */
const FOLDER_COLORS = [
  "var(--color-success)",
  "var(--color-unread)",
  "var(--color-warning)",
  "var(--color-primary-badge)",
  "var(--color-danger)",
  "color-mix(in srgb, var(--color-unread) 55%, var(--color-danger))",
  "color-mix(in srgb, var(--color-success) 50%, var(--color-unread))",
  "color-mix(in srgb, var(--color-warning) 55%, var(--color-danger))",
];
const GROUP_SWATCHES = ["#e5484d", "#f5a524", "#30a46c", "#3e8ef7", "#8e4ec6", "#e93d82", "#12a594", "#978365"];

interface Palette {
  colour: (css: string) => string;
  bg: string;
  line: string;
  ink: string;
  accent: string;
  ghost: string;
  tag: string;
  attachment: string;
  font: string;
  dark: boolean;
}

function readPalette(probe: HTMLElement): Palette {
  const cache = new Map<string, string>();
  const colour = (css: string) => {
    let hit = cache.get(css);
    if (hit === undefined) {
      probe.style.color = "";
      probe.style.color = css.startsWith("--") ? `var(${css})` : css;
      hit = getComputedStyle(probe).color || "gray";
      cache.set(css, hit);
    }
    return hit;
  };
  const bg = colour("--color-panel");
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  const lum = m ? (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255 : 1;
  return {
    colour,
    bg,
    line: colour("--color-ink-tertiary"),
    ink: colour("--color-ink"),
    accent: colour("--color-accent"),
    ghost: colour("--color-ink-tertiary"),
    tag: colour("color-mix(in srgb, var(--color-success) 55%, var(--color-ink-secondary))"),
    attachment: colour("--color-warning"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
    dark: lum < 0.45,
  };
}

function usePalette(host: React.RefObject<HTMLElement | null>): [React.RefObject<Palette | null>, number] {
  const ref = useRef<Palette | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.setAttribute("aria-hidden", "true");
    el.append(probe);
    const read = () => {
      ref.current = readPalette(probe);
      setVersion((n) => n + 1);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-skin", "style"] });
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", read);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", read);
      probe.remove();
    };
  }, [host]);
  return [ref, version];
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface GraphStats {
  frames: number;
  drawMs: number;
  drawP95: number;
  tickMs: number;
  ticks: number;
  /** Milliseconds from the graph's start to rest, null while it moves. */
  settledMs: number | null;
  nodes: number;
  links: number;
}

export interface MemoryGraphProps {
  notes: GraphNote[];
  /** Each tier's CSS colour. */
  tierColor: (tier: string) => string;
  /** Find on the map: the row keys it matches (null: no search). */
  matches: Set<string> | null;
  /** The timeline: row keys not written yet at its date. */
  hidden: Set<string> | null;
  /** A note the page asked to show ("Show on the map"). */
  focusKey?: string | null;
  /** With focusKey: the hops around it (0 = everything). */
  depth?: number;
  onPreview: (key: string) => void;
  onOpen: (key: string) => void;
  /** Display > Animate: the timeline replays from the first note. */
  onAnimate?: () => void;
  /** Top left, over the canvas (the tag filter). */
  overlay?: React.ReactNode;
  testId?: string;
}

type Drag =
  | { kind: "node"; node: number; id: number; x: number; y: number; moved: boolean }
  | { kind: "pan"; id: number; x: number; y: number; moved: boolean }
  | null;

export function MemoryGraph({ notes, tierColor, matches, hidden, focusKey, depth = 0, onPreview, onOpen, onAnimate, overlay, testId = "memory-graph" }: MemoryGraphProps) {
  const principalId = useStoreOptional()?.state.config?.viewer?.principalId ?? null;
  const [settings, setSettingsState] = useState<GraphSettings>(() => readGraphSettings(principalId));
  useEffect(() => setSettingsState(readGraphSettings(principalId)), [principalId]);
  const setSettings = useCallback((update: (current: GraphSettings) => GraphSettings) => {
    setSettingsState((current) => {
      const next = update(current);
      writeGraphSettings(principalId, next);
      return next;
    });
  }, [principalId]);

  // The model: the notes through the filters, then the neighbourhood asked for.
  const model = useMemo<GraphModel>(() => {
    const whole = buildGraph(notes, settings.filters);
    if (!focusKey || depth <= 0) return whole;
    const at = whole.index.get(`n:${focusKey}`);
    if (at === undefined) return whole;
    const near = withinDepth(whole, at, depth);
    const keys = new Set([...near].map((i) => whole.nodes[i]!.key).filter(Boolean));
    return buildGraph(notes.filter((note) => keys.has(note.key)), settings.filters);
  }, [notes, settings.filters, focusKey, depth]);

  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const [palette, paletteVersion] = usePalette(wrap);
  const sim = useRef<Simulation | null>(null);
  const simModel = useRef<GraphModel | null>(null);
  const view = useRef<GraphView>({ s: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const autoFit = useRef(true);
  const flyTo = useRef<GraphView | null>(null);
  const hover = useRef(-1);
  const hoverMix = useRef(0);
  const drag = useRef<Drag>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number } | null>(null);
  const raf = useRef(0);
  const started = useRef(0);
  const stats = useRef({ frames: 0, times: [] as number[], tickTimes: [] as number[], ticks: 0, settledMs: null as number | null });
  const [settled, setSettled] = useState(false);

  // The simulation, rebuilt with the model: known nodes keep their place.
  useEffect(() => {
    const previous = sim.current;
    const before = simModel.current;
    const known = new Map<string, { x: number; y: number }>();
    if (previous && before) before.nodes.forEach((node, i) => known.set(node.id, { x: previous.x[i]!, y: previous.y[i]! }));
    const place = (i: number) => {
      const node = model.nodes[i]!;
      const hit = known.get(node.id);
      if (hit) return hit;
      // A new node starts next to a neighbour already placed.
      for (const next of model.adjacency[i]!) {
        const at = known.get(model.nodes[next]!.id);
        if (at) {
          const a = (stableIndex(node.id, 360) / 360) * Math.PI * 2;
          return { x: at.x + Math.cos(a) * 12, y: at.y + Math.sin(a) * 12 };
        }
      }
      return null;
    };
    const next = createSimulation(model.links, model.nodes.length, { seed: 7, forces: settings.forces, start: known.size ? place : undefined });
    if (known.size && model.nodes.every((node) => known.has(node.id))) next.alpha = 0.3;
    sim.current = next;
    simModel.current = model;
    if (!known.size) autoFit.current = true;
    started.current = performance.now();
    stats.current.settledMs = null;
    stats.current.ticks = 0;
    if (reducedMotion()) {
      let ticks = 0;
      while (!next.settled() && ticks < 400) { next.tick(); ticks += 1; }
    }
    setSettled(false);
    kick();
    // settings.forces read at creation only; the effect below follows them
  }, [model]);

  useEffect(() => {
    const current = sim.current;
    if (!current) return;
    const same = (Object.keys(settings.forces) as Array<keyof typeof settings.forces>).every((key) => current.forces[key] === settings.forces[key]);
    if (same) return;
    current.forces = { ...settings.forces };
    current.reheat(0.5);
    setSettled(false);
    kick();
  }, [settings.forces]);

  // What each node shows: visible (the timeline), matched (the search), its colour.
  const visible = useMemo(() => {
    const out = new Uint8Array(model.nodes.length);
    if (!hidden || hidden.size === 0) return out.fill(1);
    model.nodes.forEach((node, i) => {
      if (node.kind !== "note" || hidden.has(node.key!)) return;
      out[i] = 1;
      for (let up = node.parent; up >= 0 && !out[up]; up = model.nodes[up]!.parent) out[up] = 1;
      for (const next of model.adjacency[i]!) {
        const kind = model.nodes[next]!.kind;
        if (kind === "tag" || kind === "ghost" || kind === "attachment") out[next] = 1;
      }
    });
    return out;
  }, [model, hidden]);

  const lit = useMemo(() => {
    if (!matches) return null;
    const out = new Uint8Array(model.nodes.length);
    model.nodes.forEach((node, i) => { if (node.key && matches.has(node.key)) out[i] = 1; });
    return out;
  }, [model, matches]);

  const colours = useMemo(() => {
    const p = palette.current;
    if (!p) return [] as string[];
    const groups = settings.groups.filter((group) => group.query.trim());
    const tierNames = new Map(notes.map((note) => [note.tier, note.tierName]));
    return model.nodes.map((node) => {
      if (node.kind === "ghost") return p.ghost;
      if (node.kind === "tag") return p.tag;
      if (node.kind === "attachment") return p.attachment;
      if (node.kind === "note") {
        const tierName = tierNames.get(node.tier);
        for (const group of groups) if (matchesQuery({ ...node, tierName }, group.query)) return p.colour(group.color);
      }
      if (settings.colorBy === "folder" && node.kind !== "tier") {
        const top = node.folderPath.split(/\s*\/\s*/)[0];
        if (top) return p.colour(FOLDER_COLORS[stableIndex(`${node.tier}/${top}`, FOLDER_COLORS.length)]!);
      }
      return p.colour(tierColor(node.tier));
    });
    // paletteVersion: the colours resolve again on a theme change
  }, [model, settings.groups, settings.colorBy, tierColor, notes, paletteVersion]);

  const radii = useMemo(() => Float64Array.from(model.nodes, (node) => nodeRadius(node.degree, node.kind, settings.display.nodeSize)), [model, settings.display.nodeSize]);

  // Everything the frame reads, kept fresh without restarting the loop.
  const live = useRef({ model, visible, lit, colours, radii, settings, focus: -1 });
  live.current = { model, visible, lit, colours, radii, settings, focus: focusKey ? model.index.get(`n:${focusKey}`) ?? -1 : -1 };

  const draw = useCallback(() => {
    const c = canvas.current, s = sim.current, p = palette.current;
    if (!c || !s || !p) return;
    paintGraphFrame({ canvas: c, sim: s, palette: p, size: size.current, live: live.current, view: view.current, hoverMix: hoverMix.current, hover: hover.current, stats: stats.current });
  }, [palette]);

  const drawMini = useCallback(() => {
    const c = mini.current, s = sim.current, p = palette.current;
    if (!c || !s || !p) return;
    paintGraphMini({ mini: c, sim: s, palette: p, size: size.current, live: live.current, view: view.current });
  }, [palette]);


  const frame = useCallback(() => {
    raf.current = 0;
    const s = sim.current;
    if (!s) return;
    let busy = false;
    if (!s.settled()) {
      const t0 = performance.now();
      let n = 0;
      do { s.tick(); n += 1; } while (n < 3 && performance.now() - t0 < 4 && !s.settled());
      const st = stats.current;
      st.ticks += n;
      st.tickTimes.push((performance.now() - t0) / n);
      if (st.tickTimes.length > 240) st.tickTimes.shift();
      busy = true;
      if (s.settled()) {
        st.settledMs = performance.now() - started.current;
        setSettled(true);
      }
    }
    // Keep the whole graph framed while it unfolds, until the person moves the view.
    const { w, h } = size.current;
    if (w > 0 && (autoFit.current || flyTo.current)) {
      const vis = live.current.visible;
      const goal = flyTo.current ?? fitBounds(boundsOf(s, (i) => vis[i] === 1), w, h, 56, 1.6);
      const v = view.current;
      const k = stats.current.frames < 2 ? 1 : 0.18;
      v.s += (goal.s - v.s) * k;
      v.tx += (goal.tx - v.tx) * k;
      v.ty += (goal.ty - v.ty) * k;
      const close = Math.abs(goal.s - v.s) < goal.s * 0.002 && Math.abs(goal.tx - v.tx) < 0.5 && Math.abs(goal.ty - v.ty) < 0.5;
      if (flyTo.current && close) flyTo.current = null;
      if (!close) busy = true;
    }
    const want = hover.current >= 0 ? 1 : 0;
    if (Math.abs(hoverMix.current - want) > 0.01) {
      hoverMix.current += (want - hoverMix.current) * (reducedMotion() ? 1 : 0.25);
      busy = true;
    } else hoverMix.current = want;
    draw();
    if (!busy || stats.current.frames % 6 === 0) drawMini();
    if (busy) raf.current = requestAnimationFrame(frame);
  }, [draw, drawMini]);

  const kick = useCallback(() => {
    if (!raf.current && typeof requestAnimationFrame === "function") raf.current = requestAnimationFrame(frame);
  }, [frame]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; }, []);
  useEffect(() => { kick(); }, [kick, visible, lit, colours, radii, settings.display, paletteVersion, focusKey]);

  // The canvas follows its box.
  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: rect.width, h: rect.height, dpr };
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
      c.style.width = `${rect.width}px`;
      c.style.height = `${rect.height}px`;
      kick();
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kick]);

  // Find on the map: a handful of hits come into view.
  useEffect(() => {
    const s = sim.current;
    if (!s || !lit) return;
    const count = lit.reduce((sum, on) => sum + on, 0);
    if (count === 0 || count > 40) return;
    const { w, h } = size.current;
    const b = boundsOf(s, (i) => lit[i] === 1 && visible[i] === 1);
    if (!b) return;
    autoFit.current = false;
    flyTo.current = fitBounds(b, w, h, 120, 1.8);
    kick();
  }, [lit, visible, kick]);

  // The note the page asked for: centred.
  useEffect(() => {
    const s = sim.current;
    const at = focusKey ? model.index.get(`n:${focusKey}`) : undefined;
    if (!s || at === undefined || depth > 0) return;
    const { w, h } = size.current;
    autoFit.current = false;
    const zoom = Math.max(view.current.s, 1.2);
    flyTo.current = { s: zoom, tx: w / 2 - s.x[at]! * zoom, ty: h / 2 - s.y[at]! * zoom };
    kick();
  }, [focusKey, model, depth, kick]);

  const { zoomBy, fit, onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onKeyDown, onMini, setHover } = useMemoryGraphInteraction({
    canvas, wrap, sim, live, view, hover, drag, pointers, pinch, autoFit, flyTo, size, kick, setSettled, onPreview, onOpen,
  });

  // Test and perf hooks.
  useEffect(() => {
    const c = canvas.current as (HTMLCanvasElement & { pxGraphStats?: () => GraphStats; pxGraphNode?: (id: string) => { x: number; y: number } | null }) | null;
    if (!c) return;
    c.pxGraphStats = () => {
      const st = stats.current;
      const sorted = [...st.times].sort((a, b) => a - b);
      const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
      return {
        frames: st.frames,
        drawMs: avg(sorted),
        drawP95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0,
        tickMs: avg(st.tickTimes),
        ticks: st.ticks,
        settledMs: st.settledMs,
        nodes: model.nodes.length,
        links: model.links.length,
      };
    };
    c.pxGraphNode = (id: string) => {
      const s = sim.current;
      const i = live.current.model.index.get(id);
      if (!s || i === undefined) return null;
      const v = view.current;
      return { x: s.x[i]! * v.s + v.tx, y: s.y[i]! * v.s + v.ty };
    };
  }, [model]);

  const button = (label: string, icon: React.ReactNode, act: () => void, id: string) => (
    <button type="button" className="inline-flex size-8 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary shadow-sm hover:text-ink" aria-label={label} title={label} onClick={act} data-testid={`${testId}-${id}`}>
      {icon}
    </button>
  );

  return (
    <div
      ref={wrap}
      className="relative min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-xl border border-hairline/50 bg-panel"
      data-memory-graph=""
      data-testid={testId}
      data-nodes={model.nodes.length}
      data-links={model.links.length}
      data-settled={settled ? "" : undefined}
    >
      <canvas
        ref={canvas}
        role="application"
        tabIndex={0}
        aria-label={t("memoryManager.graph.canvas")}
        className="absolute inset-0 block cursor-grab touch-none focus-visible:outline-2 focus-visible:outline-accent"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => { if (e.pointerType === "mouse" && !drag.current) setHover(-1); }}
        onDoubleClick={onDoubleClick}
        data-testid={`${testId}-canvas`}
      />
      {model.nodes.length === 0 ? (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-ink-secondary" data-testid={`${testId}-none`}>{t("memoryManager.graph.none")}</p>
      ) : null}
      {overlay ? <div className="absolute left-2 top-2 max-w-[calc(100%-16px)]">{overlay}</div> : null}
      <GraphSettingsPanel settings={settings} onChange={setSettings} onAnimate={onAnimate} testId={testId} />
      <canvas
        ref={mini}
        className="absolute bottom-2 right-[52px] size-[132px] cursor-crosshair touch-none rounded-lg border border-hairline/60 bg-panel/90"
        role="img"
        aria-label={t("memoryManager.mapMinimap")}
        onPointerDown={onMini}
        onPointerMove={onMini}
        data-testid={`${testId}-minimap`}
      />
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        {button(t("memoryManager.mapZoomIn"), <Plus size={16} />, () => zoomBy(size.current.w / 2, size.current.h / 2, 1.35), "zoom-in")}
        {button(t("memoryManager.mapZoomOut"), <Minus size={16} />, () => zoomBy(size.current.w / 2, size.current.h / 2, 1 / 1.35), "zoom-out")}
        {button(t("memoryManager.mapFit"), <Maximize2 size={16} />, fit, "fit")}
      </div>
    </div>
  );
}

/** Does the segment cross the screen though both ends are off it? */

// ------------------------------------------------------- settings panel

function Section({ id, title, open, onToggle, children, testId }: { id: GraphSection; title: string; open: boolean; onToggle: () => void; children: React.ReactNode; testId: string }) {
  return (
    <section className="border-t border-hairline/50 first:border-t-0" data-graph-section={id}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-1 py-2 text-left text-[12.5px] font-semibold text-ink" data-testid={`${testId}-section-${id}`}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        {title}
      </button>
      {open ? <div className="flex flex-col gap-2.5 pb-3 pl-1">{children}</div> : null}
    </section>
  );
}

function Toggle({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (next: boolean) => void; id: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px] text-ink-secondary" data-graph-toggle={id}>
      <span>{label}</span>
      <Switch checked={checked} onClick={() => onChange(!checked)} aria-label={label} />
    </label>
  );
}

function Slider({ label, value, range, onChange, id }: { label: string; value: number; range: { min: number; max: number; step: number }; onChange: (next: number) => void; id: string }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] text-ink-secondary" data-graph-slider={id}>
      <span>{label}</span>
      <input type="range" min={range.min} max={range.max} step={range.step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} className="w-full accent-[var(--color-accent)]" />
    </label>
  );
}

export function GraphSettingsPanel({ settings, onChange, onAnimate, testId = "memory-graph" }: {
  settings: GraphSettings;
  onChange: (update: (current: GraphSettings) => GraphSettings) => void;
  onAnimate?: () => void;
  testId?: string;
}) {
  const patch = <K extends keyof GraphSettings>(key: K, value: Partial<GraphSettings[K]>) =>
    onChange((current) => ({ ...current, [key]: typeof current[key] === "object" && !Array.isArray(current[key]) ? { ...(current[key] as object), ...(value as object) } : value }));
  const section = (id: GraphSection) => () => onChange((current) => ({ ...current, sections: { ...current.sections, [id]: !current.sections[id] } }));
  if (!settings.open) {
    return (
      <button
        type="button"
        className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-lg border border-hairline/60 bg-panel text-ink-secondary shadow-sm hover:text-ink"
        aria-label={t("memoryManager.graph.settings")}
        title={t("memoryManager.graph.settings")}
        aria-expanded={false}
        onClick={() => onChange((current) => ({ ...current, open: true }))}
        data-testid={`${testId}-settings-open`}
      >
        <Settings2 size={16} aria-hidden="true" />
      </button>
    );
  }
  const { filters, display, forces, groups, sections } = settings;
  return (
    <div className="absolute right-2 top-2 flex max-h-[calc(100%-160px)] w-[260px] max-w-[calc(100%-16px)] flex-col overflow-hidden rounded-xl border border-hairline/60 bg-panel/95 shadow-md backdrop-blur-sm" role="region" aria-label={t("memoryManager.graph.settings")} data-testid={`${testId}-settings`}>
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1 text-[12.5px] font-semibold text-ink">{t("memoryManager.graph.settings")}</span>
        <button type="button" className="grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink" aria-label={t("memoryManager.graph.reset")} title={t("memoryManager.graph.reset")} onClick={() => onChange(() => ({ ...DEFAULT_GRAPH_SETTINGS, open: true, sections: settings.sections }))} data-testid={`${testId}-settings-reset`}>
          <RotateCcw size={14} aria-hidden="true" />
        </button>
        <button type="button" className="grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink" aria-label={t("memoryManager.graph.close")} title={t("memoryManager.graph.close")} onClick={() => onChange((current) => ({ ...current, open: false }))} data-testid={`${testId}-settings-close`}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto px-3">
        <Section id="filters" title={t("memoryManager.graph.filters")} open={sections.filters} onToggle={section("filters")} testId={testId}>
          <input value={filters.search} onChange={(event) => patch("filters", { search: event.target.value })} placeholder={t("memoryManager.graph.search")} aria-label={t("memoryManager.graph.search")} className={cn(FIELD, "h-8 py-0 text-[12.5px]")} data-testid={`${testId}-filter-search`} />
          <Toggle id="tags" label={t("memoryManager.graph.tags")} checked={filters.tags} onChange={(next) => patch("filters", { tags: next })} />
          <Toggle id="attachments" label={t("memoryManager.graph.attachments")} checked={filters.attachments} onChange={(next) => patch("filters", { attachments: next })} />
          <Toggle id="existingOnly" label={t("memoryManager.graph.existingOnly")} checked={filters.existingOnly} onChange={(next) => patch("filters", { existingOnly: next })} />
          <Toggle id="orphans" label={t("memoryManager.graph.orphans")} checked={filters.orphans} onChange={(next) => patch("filters", { orphans: next })} />
          <Toggle id="folders" label={t("memoryManager.graph.folders")} checked={filters.folders} onChange={(next) => patch("filters", { folders: next })} />
        </Section>
        <Section id="groups" title={t("memoryManager.graph.groups")} open={sections.groups} onToggle={section("groups")} testId={testId}>
          <div className="flex items-center justify-between gap-2 text-[12.5px] text-ink-secondary">
            <span>{t("memoryManager.graph.colorBy")}</span>
            <MiniSegment<GraphSettings["colorBy"]>
              label={t("memoryManager.graph.colorBy")}
              value={settings.colorBy}
              onChange={(next) => onChange((current) => ({ ...current, colorBy: next }))}
              options={[{ value: "tier", label: t("memoryManager.graph.colorTier") }, { value: "folder", label: t("memoryManager.graph.colorFolder") }]}
              data-graph-color-by=""
            />
          </div>
          {groups.map((group, i) => (
            <div key={i} className="flex items-center gap-1.5" data-graph-group={i}>
              <input value={group.query} onChange={(event) => onChange((current) => ({ ...current, groups: current.groups.map((g, k) => (k === i ? { ...g, query: event.target.value } : g)) }))} placeholder={t("memoryManager.graph.groupQuery")} aria-label={t("memoryManager.graph.groupQuery")} className={cn(FIELD, "h-8 min-w-0 flex-1 py-0 text-[12.5px]")} />
              <input type="color" value={group.color} onChange={(event) => onChange((current) => ({ ...current, groups: current.groups.map((g, k) => (k === i ? { ...g, color: event.target.value } : g)) }))} aria-label={t("memoryManager.graph.groupColor")} className="size-7 shrink-0 cursor-pointer rounded-md border border-hairline/60 bg-transparent p-0.5" />
              <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink" aria-label={t("memoryManager.graph.removeGroup")} title={t("memoryManager.graph.removeGroup")} onClick={() => onChange((current) => ({ ...current, groups: current.groups.filter((_, k) => k !== i) }))}>
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
          <p className="text-[11.5px] leading-snug text-ink-tertiary">{t("memoryManager.graph.groupsHint")}</p>
          <button type="button" className="inline-flex h-8 items-center justify-center rounded-full bg-accent px-3 text-[12.5px] font-medium text-accent-ink hover:brightness-110" onClick={() => onChange((current) => ({ ...current, groups: [...current.groups, { query: "", color: GROUP_SWATCHES[current.groups.length % GROUP_SWATCHES.length]! }] }))} data-testid={`${testId}-group-new`}>
            {t("memoryManager.graph.newGroup")}
          </button>
        </Section>
        <Section id="display" title={t("memoryManager.graph.display")} open={sections.display} onToggle={section("display")} testId={testId}>
          <Toggle id="arrows" label={t("memoryManager.graph.arrows")} checked={display.arrows} onChange={(next) => patch("display", { arrows: next })} />
          <Slider id="textFade" label={t("memoryManager.graph.textFade")} value={display.textFade} range={DISPLAY_RANGES.textFade} onChange={(next) => patch("display", { textFade: next })} />
          <Slider id="nodeSize" label={t("memoryManager.graph.nodeSize")} value={display.nodeSize} range={DISPLAY_RANGES.nodeSize} onChange={(next) => patch("display", { nodeSize: next })} />
          <Slider id="linkThickness" label={t("memoryManager.graph.linkThickness")} value={display.linkThickness} range={DISPLAY_RANGES.linkThickness} onChange={(next) => patch("display", { linkThickness: next })} />
          {onAnimate ? (
            <button type="button" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-medium text-accent-ink hover:brightness-110" onClick={onAnimate} data-testid={`${testId}-animate`}>
              <Play size={13} aria-hidden="true" />{t("memoryManager.graph.animate")}
            </button>
          ) : null}
        </Section>
        <Section id="forces" title={t("memoryManager.graph.forces")} open={sections.forces} onToggle={section("forces")} testId={testId}>
          <Slider id="center" label={t("memoryManager.graph.center")} value={forces.center} range={FORCE_RANGES.center} onChange={(next) => patch("forces", { center: next })} />
          <Slider id="repel" label={t("memoryManager.graph.repel")} value={forces.repel} range={FORCE_RANGES.repel} onChange={(next) => patch("forces", { repel: next })} />
          <Slider id="link" label={t("memoryManager.graph.link")} value={forces.link} range={FORCE_RANGES.link} onChange={(next) => patch("forces", { link: next })} />
          <Slider id="linkDistance" label={t("memoryManager.graph.linkDistance")} value={forces.linkDistance} range={FORCE_RANGES.linkDistance} onChange={(next) => patch("forces", { linkDistance: next })} />
        </Section>
      </div>
    </div>
  );
}