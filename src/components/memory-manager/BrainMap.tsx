// Provient de Perspicax, PTI (Pulsatrix Technologies Inc.); published in Sagax under Apache-2.0 with PTI's approval (JC, 2026-11-03).
// Ported from the Perspicax console (console/src/pages/memory/brain-map.tsx,
// 1.9.20) for Tools > Memory > Map; Sagax's skin tokens in place of the
// console's, each tier's colour from the page (`colorOf`).
//
// The map of the memory as a brain (Mémoire > Notes > Carte, 2026-10-19;
// it replaces the force graph of 2026-10-11, JC: « à peine visible »,
// « comme un vrai cerveau »). A canvas drawn by hand, no library; the pure
// half (layout, labels, spotlight, culling) is `lib/memory-brain.ts`.
//
// The scope in view sits at the centre and glows a little more; the tiers
// (for the whole memory), then the topics, sit on concentric rings; the
// notes are small leaves on the outer ring. Each tier keeps its colour (the
// chart tokens, light and dark). A branch is as bright and as thick as its
// freshest note; past 30 days it is thin and grey, still drawn and still
// reachable. A change or a new note waiting for a review wears an amber
// halo; one the risk score flags pulses softly in red. Hovering (or a first
// tap) unfolds a node in place: it grows, and a card beside it gives two
// lines of the note and when, by whom, where; a click (or a second tap)
// opens the note in the side panel, which never covers the map. The search
// is a spotlight: the matches and their branches light up, the rest dims.
// Zoom with the wheel or a pinch, with inertia, and a minimap in a corner.
// Only what the screen shows is drawn. Under prefers-reduced-motion the
// pulses, the travelling impulses and the inertia are off. A veil (lot 7d,
// `map-timeline.tsx`) hides what was not written yet at the timeline's date
// and dims the notes without the chosen tags, as the spotlight dims.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import {
  fitView,
  nodeAt,
  spotlight,
  toScreen,
  type Brain,
  type BrainNode,
  type Veil,
  type View,
} from "@/lib/memory-brain";
import {
  paintBrainFrame,
  paintMiniImage,
  type Impulse,
  type Palette,
} from "./brain-map-draw";
import { useBrainMapInteraction } from "./useBrainMapInteraction";

function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [on, setOn] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const change = () => setOn(mq.matches);
    mq.addEventListener?.("change", change);
    return () => mq.removeEventListener?.("change", change);
  }, [query]);
  return on;
}


function luminance(colour: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Any CSS colour (a token, a color-mix) as the rgb the canvas draws with. */
function resolveColour(value: string, probe: HTMLElement): string {
  probe.style.color = "";
  probe.style.color = value;
  return getComputedStyle(probe).color || value;
}

function toHex(rgb: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return rgb;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

let probeElement: HTMLElement | null = null;
function paletteProbe(): HTMLElement {
  if (probeElement?.isConnected) return probeElement;
  probeElement = document.createElement("span");
  probeElement.style.display = "none";
  probeElement.setAttribute("aria-hidden", "true");
  document.body.append(probeElement);
  return probeElement;
}

function readPalette(): Palette {
  const probe = paletteProbe();
  const cache = new Map<string, string>();
  const v = (value: string) => {
    let hit = cache.get(value);
    if (hit === undefined) {
      hit = resolveColour(value.startsWith("--") ? `var(${value})` : value, probe) || "gray";
      cache.set(value, hit);
    }
    return hit;
  };
  const bg = v("--color-panel");
  const palette: Palette = {
    colour: v,
    fg: v("--color-ink"),
    muted: v("--color-ink-secondary"),
    stale: v("--color-ink-tertiary"),
    bg: v("--color-app"),
    card: bg,
    focus: v("--color-accent"),
    warning: v("--color-warning"),
    error: v("--color-danger"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
    dark: luminance(toHex(bg)) < 0.2,
  };
  // the probe stays until every colour of this palette is read once
  return palette;
}

/** The palette, read again when the theme or a skin changes. */
function usePalette(): [React.RefObject<Palette | null>, number] {
  const ref = useRef<Palette | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const read = () => {
      ref.current = readPalette();
      setVersion((n) => n + 1);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-skin", "style"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", read);
    };
  }, []);
  return [ref, version];
}


export interface BrainStats {
  frames: number;
  fps: number;
  drawMs: number;
  drawP95: number;
  drawn: number;
  total: number;
}


const FRICTION = 0.9;
const MAX_SCALE = 10;
/** Left alone this long, the breathing brain draws at half rate (a map left
 *  open on a second screen should cost little). */
const IDLE_MS = 4000;

export interface BrainMapLabels {
  zoomIn: string;
  zoomOut: string;
  fit: string;
  graph: string;
  minimap: string;
}

export function BrainMap({
  brain,
  colorOf,
  search = "",
  current,
  selected,
  onSelect,
  renderCard,
  labels,
  veil = null,
  overlay,
  testId,
}: {
  brain: Brain;
  /** A tier's colour (a CSS value), by the scope the map gives it. */
  colorOf: (scope: string) => string;
  search?: string;
  /** The open note's key: the map flies to it once. */
  current?: string | null;
  /** The note shown in the side panel, drawn with a ring. */
  selected?: string | null;
  onSelect: (node: BrainNode) => void;
  /** The unfolded node's card (two lines and its facts). */
  renderCard: (node: BrainNode) => React.ReactNode;
  labels: BrainMapLabels;
  /** The timeline's and the tag filter's veil (`lib/memory-brain.ts` veilOf). */
  veil?: Veil | null;
  /** Drawn over the map, in its top right corner (the tag filter). */
  overlay?: React.ReactNode;
  testId?: string;
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [palette, paletteVersion] = usePalette();
  const view = useRef<View & { dpr: number }>({ s: 1, tx: 0, ty: 0, w: 0, h: 0, dpr: 1 });
  const target = useRef<{ s: number; tx: number; ty: number } | null>(null);
  const velocity = useRef({ x: 0, y: 0 });
  const [hover, setHover] = useState(-1);
  /** The canvas has its size: a fly to the open note can be computed. */
  const [sized, setSized] = useState(false);
  const hoverRef = useRef(-1);
  const unfold = useRef({ node: -1, at: 0 });
  const raf = useRef(0);
  const last = useRef(0);
  const sprites = useRef(new Map<string, HTMLCanvasElement>());
  const widths = useRef(new Map<string, number>());
  const impulses = useRef<Impulse[]>([]);
  const nextImpulse = useRef(0);
  const stats = useRef({ frames: 0, times: [] as number[], stamps: [] as number[], drawn: 0 });
  const miniImage = useRef<HTMLCanvasElement | null>(null);
  const fitted = useRef(false);
  const dragging = useRef(false);
  const lastInput = useRef(0);
  const lastDraw = useRef(0);

  const light = useMemo(() => spotlight(brain, search), [brain, search]);
  const selectedIndex = selected ? (brain.index.get(selected) ?? -1) : -1;
  const recent = useMemo(
    () => brain.nodes.map((n, i) => (n.kind === "note" && n.recency > 0 && !veil?.hidden.has(i) ? i : -1)).filter((i) => i >= 0),
    [brain, veil],
  );
  const veilRef = useRef(veil);
  veilRef.current = veil;
  /** The node under a point, never one the timeline hides. */
  const pick = useCallback(
    (x: number, y: number, slack?: number) => {
      const i = nodeAt(brain, view.current, x, y, slack);
      return i >= 0 && veilRef.current?.hidden.has(i) ? -1 : i;
    },
    [brain],
  );
  const animated = !reduced;
  const animatedRef = useRef(animated);
  animatedRef.current = animated;

  const colourOf = useCallback(
    (n: BrainNode, p: Palette) => {
      if (n.kind === "root" && !n.scope) return p.focus;
      return p.colour(colorOf(n.scope));
    },
    [colorOf],
  );

  const measure = useCallback(
    (text: string, size: number) => {
      const key = `${size}|${text}`;
      let w = widths.current.get(key);
      if (w === undefined) {
        const ctx = canvas.current?.getContext("2d");
        const p = palette.current;
        if (!ctx || !p) return text.length * size * 0.56;
        ctx.font = `500 ${size}px ${p.font}`;
        w = ctx.measureText(text).width;
        widths.current.set(key, w);
      }
      return w;
    },
    [palette],
  );

  const fit = useCallback(
    (smooth: boolean) => {
      const v = view.current;
      if (!v.w || !v.h) return;
      const f = fitView(brain, v.w, v.h);
      if (smooth && animated) target.current = { s: f.s, tx: f.tx, ty: f.ty };
      else {
        target.current = null;
        Object.assign(v, { s: f.s, tx: f.tx, ty: f.ty });
      }
      fitted.current = true;
    },
    [brain, animated],
  );

  const flyTo = useCallback(
    (i: number) => {
      const v = view.current;
      const n = brain.nodes[i];
      if (!n || !v.w) return;
      const s = Math.max(v.s, n.kind === "note" ? Math.min(MAX_SCALE, (fitView(brain, v.w, v.h).s * 3.5)) : v.s);
      const to = { s, tx: v.w / 2 - n.x * s, ty: v.h / 2 - n.y * s };
      if (animated) target.current = to;
      else Object.assign(v, to);
      fitted.current = false;
    },
    [brain, animated],
  );

  // The minimap's still image: every node as a dot, redrawn when the brain,
  // the theme or the size changes.
  const paintMini = useCallback(() => {
    const m = mini.current;
    const p = palette.current;
    if (!m || !p) return;
    miniImage.current = paintMiniImage({ mini: m, palette: p, brain, colourOf, veil });
  }, [brain, palette, colourOf, veil]);

  // ---- one frame -----------------------------------------------------------

  const draw = useCallback(
    (now: number) => {
      const c = canvas.current;
      const p = palette.current;
      if (!c || !p) return;
      paintBrainFrame({
        now,
        canvas: c,
        palette: p,
        brain,
        view: view.current,
        colourOf,
        light,
        selectedIndex,
        measure,
        recent,
        animated,
        veil,
        hoverIndex: hoverRef.current,
        unfold: unfold.current,
        impulses: impulses.current,
        nextImpulse,
        sprites: sprites.current,
        stats: stats.current,
        cardEl: card.current,
        mini: mini.current,
        miniImageRef: miniImage,
      });
    },
    [brain, palette, colourOf, light, selectedIndex, measure, recent, animated, veil],
  );

  // ---- the frame loop --------------------------------------------------------

  const drawRef = useRef(draw);
  drawRef.current = draw;
  const kick = useCallback(() => {
    lastInput.current = performance.now();
    if (raf.current) return;
    const tick = (now: number) => {
      raf.current = 0;
      const dt = last.current ? Math.min(64, now - last.current) : 16;
      last.current = now;
      const v = view.current;
      let moving = false;
      const tg = target.current;
      if (tg) {
        const k = 1 - Math.exp(-dt / 90);
        v.s += (tg.s - v.s) * k;
        v.tx += (tg.tx - v.tx) * k;
        v.ty += (tg.ty - v.ty) * k;
        if (Math.abs(tg.s - v.s) / tg.s < 0.002 && Math.abs(tg.tx - v.tx) < 0.5 && Math.abs(tg.ty - v.ty) < 0.5) {
          Object.assign(v, tg);
          target.current = null;
        } else moving = true;
      }
      const vel = velocity.current;
      if (!dragging.current && (Math.abs(vel.x) > 0.01 || Math.abs(vel.y) > 0.01)) {
        v.tx += vel.x * dt;
        v.ty += vel.y * dt;
        const f = FRICTION ** (dt / 16);
        vel.x *= f;
        vel.y *= f;
        moving = true;
      }
      const idle = !moving && !dragging.current && now - lastInput.current > IDLE_MS;
      if (!idle || now - lastDraw.current >= 30) {
        lastDraw.current = now;
        drawRef.current(now);
      }
      const unfolding = unfold.current.node >= 0 && now - unfold.current.at < 200;
      // The brain keeps breathing (impulses, pulses) unless motion is reduced.
      if (moving || unfolding || animatedRef.current || dragging.current) raf.current = requestAnimationFrame(tick);
      else last.current = 0;
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    kick();
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [kick, draw]);

  useEffect(() => {
    widths.current.clear();
    sprites.current.clear();
    paintMini();
    kick();
  }, [paletteVersion, paintMini, kick]);

  // A new brain (another scope, new notes): fit it, then fly to the open note.
  useEffect(() => {
    fitted.current = false;
    impulses.current = [];
    unfold.current = { node: -1, at: 0 };
    hoverRef.current = -1;
    setHover(-1);
    if (view.current.w) fit(false);
    paintMini();
    kick();
  }, [brain, fit, paintMini, kick]);

  // The card mounts after the hover changes: place it on the next frame.
  useEffect(() => {
    kick();
  }, [hover, kick]);

  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (!current || flown.current === current || !sized) return;
    const i = brain.index.get(current);
    if (i === undefined) return;
    flown.current = current;
    flyTo(i);
    unfold.current = { node: i, at: performance.now() };
    hoverRef.current = i;
    setHover(i);
    kick();
  }, [current, brain, flyTo, kick, sized]);

  // The canvas follows its box and the screen's pixel ratio.
  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const size = () => {
      const r = { width: el.clientWidth, height: el.clientHeight };
      const v = view.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const first = !v.w;
      if (!first && r.width === v.w && r.height === v.h && dpr === v.dpr) return;
      // Keep the centre of the screen where it was.
      if (!first && r.width && r.height) {
        v.tx += (r.width - v.w) / 2;
        v.ty += (r.height - v.h) / 2;
      }
      v.w = r.width;
      v.h = r.height;
      v.dpr = dpr;
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      if (first || fitted.current) fit(false);
      paintMini();
      kick();
      if (r.width && r.height) setSized(true);
      el.setAttribute("data-settled", "");
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, paintMini, kick]);

  // ---- pointers ------------------------------------------------------------
  const {
    pointers, setUnfold, zoomAt, onPointerDown, onPointerMove, onPointerUp, onKeyDown, onMini,
  } = useBrainMapInteraction({
    canvas, view, target, velocity, dragging, fitted, hoverRef, unfold, setHover,
    kick, pick, animated, brain, onSelect, fit,
  });

  // Test hooks: where a node sits on the canvas, and the frame measures.
  useEffect(() => {
    const c = canvas.current as (HTMLCanvasElement & { pxNodePosition?: (key: string) => { x: number; y: number } | null; pxBrainStats?: () => BrainStats }) | null;
    if (!c) return;
    c.pxNodePosition = (key: string) => {
      const i = brain.index.get(key);
      if (i === undefined) return null;
      const n = brain.nodes[i];
      return toScreen(view.current, n.x, n.y);
    };
    c.pxBrainStats = () => {
      const st = stats.current;
      const sorted = [...st.times].sort((a, b) => a - b);
      return {
        frames: st.frames,
        fps: st.stamps.length,
        drawMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
        drawP95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
        drawn: st.drawn,
        total: brain.nodes.length,
      };
    };
  }, [brain]);

  const button = (label: string, icon: React.ReactNode, act: () => void, id: string) => (
    <button type="button" className="inline-flex size-8 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary shadow-sm hover:text-ink" aria-label={label} title={label} onClick={act} data-testid={`${testId}-${id}`}>
      {icon}
    </button>
  );

  const hovered = hover >= 0 ? brain.nodes[hover] : null;
  return (
    <div
      ref={wrap}
      className="relative min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-xl border border-hairline/50 [background:radial-gradient(ellipse_at_center,var(--color-panel)_0%,var(--color-panel)_45%,var(--color-app)_100%)] [&>canvas:first-child]:absolute [&>canvas:first-child]:inset-0 [&>canvas:first-child]:block [&>canvas:first-child]:cursor-grab [&>canvas:first-child]:touch-none [&>canvas:first-child]:focus-visible:outline-2 [&>canvas:first-child]:focus-visible:outline-accent"
      data-memory-map=""
      data-testid={testId}
      data-nodes={brain.notes}
      data-hits={light ? light.hits.size : undefined}
      data-shown={veil ? veil.notes : undefined}
      data-matches={veil ? veil.matches : undefined}
    >
      <canvas
        ref={canvas}
        role="application"
        tabIndex={0}
        aria-label={labels.graph}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !pointers.current.size) setUnfold(-1);
        }}
        data-testid={testId ? `${testId}-canvas` : undefined}
      />
      {hovered ? (
        <div ref={card} className="pointer-events-none absolute left-0 top-0 w-[280px] max-w-[calc(100%-16px)] rounded-xl border border-hairline/60 bg-panel px-3 py-2.5 opacity-0 shadow-md transition-opacity duration-100" aria-hidden data-testid={testId ? `${testId}-card` : undefined}>
          {renderCard(hovered)}
        </div>
      ) : null}
      <canvas
        ref={mini}
        className="absolute bottom-2 right-[52px] size-[132px] cursor-crosshair touch-none rounded-lg border border-hairline/60 bg-panel/90"
        role="img"
        aria-label={labels.minimap}
        onPointerDown={onMini}
        onPointerMove={onMini}
        data-testid={testId ? `${testId}-minimap` : undefined}
      />
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        {button(labels.zoomIn, <Plus size={16} />, () => zoomAt(view.current.w / 2, view.current.h / 2, 1.35), "zoom-in")}
        {button(labels.zoomOut, <Minus size={16} />, () => zoomAt(view.current.w / 2, view.current.h / 2, 1 / 1.35), "zoom-out")}
        {button(labels.fit, <Maximize2 size={16} />, () => fit(true), "fit")}
      </div>
      {overlay ? <div className="absolute right-2 top-2 max-w-[calc(100%-16px)]">{overlay}</div> : null}
    </div>
  );
}

/** The empty brain: a quiet outline and one invitation. */
export function BrainEmpty({ invite, onInvite, testId }: { invite: string; onInvite?: () => void; testId?: string }) {
  return (
    <div className="relative flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-hairline/50 bg-panel" data-testid={testId}>
      <svg viewBox="0 0 240 190" className="h-40 w-48 fill-none stroke-ink-tertiary [stroke-linecap:round] [stroke-width:1.5]" aria-hidden>
        <path d="M70 150C40 152 16 132 20 106C6 94 8 66 28 56C28 32 50 18 74 22C86 8 110 4 128 14C148 4 178 10 188 30C212 32 230 52 226 76C238 92 232 118 214 126C208 144 188 154 168 148C158 160 136 164 122 154C106 162 82 162 70 150Z" />
        <path d="M74 40C88 52 78 70 94 80M122 24C114 44 134 52 126 72M172 40C158 54 174 70 162 88M40 92C62 88 66 108 88 104M108 102C124 94 140 110 156 100M194 94C180 106 194 120 178 130M60 128C76 120 90 132 104 126M128 150C134 138 150 136 160 128" />
        <path d="M150 152C152 164 146 176 138 184" />
      </svg>
      {onInvite ? (
        <button type="button" className="text-[13px] text-ink-secondary" onClick={onInvite} data-testid={testId ? `${testId}-invite` : undefined}>
          {invite}
        </button>
      ) : (
        <p className="text-[13px] text-ink-secondary">{invite}</p>
      )}
    </div>
  );
}