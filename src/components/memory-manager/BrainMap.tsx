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
  edgeStyle,
  edgeVisible,
  fitView,
  isStale,
  nodeAt,
  nodeSize,
  planLabels,
  spotlight,
  toScreen,
  visibleNodes,
  worldRect,
  brainBounds,
  LABEL_SIZE,
  type Brain,
  type BrainNode,
  type Veil,
  type View,
} from "@/lib/memory-brain";

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

interface Palette {
  colour: (token: string) => string;
  fg: string;
  muted: string;
  stale: string;
  bg: string;
  card: string;
  focus: string;
  warning: string;
  error: string;
  font: string;
  dark: boolean;
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

/** A soft round glow of one colour, drawn once and stamped many times. */
function glowSprite(cache: Map<string, HTMLCanvasElement>, colour: string): HTMLCanvasElement {
  let s = cache.get(colour);
  if (s) return s;
  s = document.createElement("canvas");
  s.width = s.height = 64;
  const g = s.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, colour);
  grad.addColorStop(0.35, colour);
  grad.addColorStop(1, "transparent");
  g.globalAlpha = 0.55;
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  cache.set(colour, s);
  return s;
}

export interface BrainStats {
  frames: number;
  fps: number;
  drawMs: number;
  drawP95: number;
  drawn: number;
  total: number;
}

interface Impulse {
  path: number[];
  t0: number;
}

const IMPULSE_MS = 1500;
const IMPULSE_EVERY_MS = 650;
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
    const w = m.clientWidth;
    const h = m.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const img = document.createElement("canvas");
    img.width = Math.round(w * dpr);
    img.height = Math.round(h * dpr);
    const g = img.getContext("2d")!;
    g.scale(dpr, dpr);
    const b = brainBounds(brain);
    const s = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY));
    brain.nodes.forEach((n, i) => {
      if (veil?.hidden.has(i)) return;
      g.globalAlpha = (isStale(n) && n.kind === "note" ? 0.35 : 0.9) * (veil?.dimmed.has(i) ? 0.3 : 1);
      g.fillStyle = colourOf(n, p);
      const r = n.kind === "root" ? 3 : n.kind === "note" ? 0.9 : 1.8;
      g.beginPath();
      g.arc(w / 2 + n.x * s, h / 2 + n.y * s, r, 0, Math.PI * 2);
      g.fill();
    });
    miniImage.current = img;
  }, [brain, palette, colourOf, veil]);

  // ---- one frame -----------------------------------------------------------

  const draw = useCallback(
    (now: number) => {
      const c = canvas.current;
      const p = palette.current;
      if (!c || !p) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const t0 = performance.now();
      const v = view.current;
      const { nodes } = brain;
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      ctx.clearRect(0, 0, v.w, v.h);

      // The glow of the centre, a little brighter than the rest.
      const centre = toScreen(v, 0, 0);
      const rootColour = colourOf(nodes[0], p);
      const halo = Math.max(60, (brain.rings[1] ?? 120) * v.s * 0.9);
      const bgGrad = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, halo);
      bgGrad.addColorStop(0, rootColour);
      bgGrad.addColorStop(1, "transparent");
      ctx.globalAlpha = p.dark ? 0.16 : 0.09;
      ctx.fillStyle = bgGrad;
      ctx.fillRect(centre.x - halo, centre.y - halo, halo * 2, halo * 2);

      const rect = worldRect(v, 60);
      const shown = veil ? visibleNodes(brain, v, 60).filter((i) => !veil.hidden.has(i)) : visibleNodes(brain, v, 60);
      const shownSet = new Set(shown);
      const hov = hoverRef.current;
      // What the hovered or selected note touches: its branch and its links.
      const near = new Set<number>();
      for (const f of [hov, selectedIndex]) {
        let i = f;
        while (i >= 0) {
          near.add(i);
          i = nodes[i].parent;
        }
      }
      const linkedTo = new Set<number>();
      for (const [a, b] of brain.links) {
        if (a === hov || a === selectedIndex) linkedTo.add(b);
        if (b === hov || b === selectedIndex) linkedTo.add(a);
      }
      const spot = (i: number): number => {
        if (!light) return 1;
        if (light.hits.has(i)) return 1;
        if (light.path.has(i) || near.has(i)) return 0.7;
        return 0.12;
      };
      // The veil: hidden is not drawn at all, dimmed as the spotlight dims.
      const dim = (i: number): number => {
        if (!veil) return spot(i);
        if (veil.hidden.has(i)) return 0;
        return veil.dimmed.has(i) && !near.has(i) ? Math.min(spot(i), 0.14) : spot(i);
      };
      const additive = p.dark ? "lighter" : "source-over";

      // Links between notes: faint arcs through the inside, lit near the hover.
      ctx.lineCap = "round";
      for (const [a, b] of brain.links) {
        const na = nodes[a];
        const nb = nodes[b];
        const on = near.has(a) || near.has(b) || linkedTo.has(a) || linkedTo.has(b);
        if (!on && !shownSet.has(a) && !shownSet.has(b)) continue;
        if (veil && (veil.hidden.has(a) || veil.hidden.has(b))) continue;
        const pa = toScreen(v, na.x, na.y);
        const pb = toScreen(v, nb.x, nb.y);
        const cp = toScreen(v, (na.x + nb.x) * 0.3, (na.y + nb.y) * 0.3);
        ctx.globalAlpha = (on ? 0.75 : p.dark ? 0.12 : 0.16) * Math.min(dim(a), dim(b));
        ctx.strokeStyle = on ? colourOf(na, p) : p.stale;
        ctx.lineWidth = on ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(cp.x, cp.y, pb.x, pb.y);
        ctx.stroke();
      }

      // Branches: a curve from each node to its parent, by recency.
      const zoomWidth = Math.min(1.8, Math.max(0.6, Math.sqrt(v.s * 2)));
      for (let i = 1; i < nodes.length; i++) {
        if (!edgeVisible(brain, i, rect)) continue;
        if (veil?.hidden.has(i)) continue;
        const n = nodes[i];
        const par = nodes[n.parent];
        const st = edgeStyle(n);
        const mid = (par.radius + n.radius) / 2;
        const a1 = par.depth === 0 ? n.angle : par.angle;
        const P = toScreen(v, par.x, par.y);
        const C = toScreen(v, n.x, n.y);
        const Q1 = toScreen(v, Math.cos(a1) * mid, Math.sin(a1) * mid);
        const Q2 = toScreen(v, Math.cos(n.angle) * mid, Math.sin(n.angle) * mid);
        const lit = near.has(i);
        const d = dim(i);
        const colour = st.tinted || lit ? colourOf(n, p) : p.stale;
        if (st.tinted && n.recency > 0.35) {
          // A wide faint stroke under a recent branch: its glow.
          ctx.globalAlpha = 0.18 * n.recency * d;
          ctx.strokeStyle = colour;
          ctx.lineWidth = (st.width * 3.2 + 2) * zoomWidth;
          ctx.beginPath();
          ctx.moveTo(P.x, P.y);
          ctx.bezierCurveTo(Q1.x, Q1.y, Q2.x, Q2.y, C.x, C.y);
          ctx.stroke();
        }
        ctx.globalAlpha = (lit ? 1 : st.alpha) * d;
        ctx.strokeStyle = colour;
        ctx.lineWidth = (lit ? st.width + 1 : st.width) * zoomWidth;
        ctx.beginPath();
        ctx.moveTo(P.x, P.y);
        ctx.bezierCurveTo(Q1.x, Q1.y, Q2.x, Q2.y, C.x, C.y);
        ctx.stroke();
      }

      // Impulses travelling out along recent branches.
      if (animated && recent.length && now >= nextImpulse.current && impulses.current.length < 6) {
        nextImpulse.current = now + IMPULSE_EVERY_MS;
        // Fresher notes fire more often.
        let pick = recent[Math.floor(Math.random() * recent.length)];
        for (let k = 0; k < 3; k++) {
          const c2 = recent[Math.floor(Math.random() * recent.length)];
          if (nodes[c2].recency > nodes[pick].recency) pick = c2;
        }
        const path: number[] = [];
        for (let i = pick; i >= 0; i = nodes[i].parent) path.unshift(i);
        impulses.current.push({ path, t0: now });
      }
      if (animated) {
        ctx.globalCompositeOperation = additive;
        impulses.current = impulses.current.filter((imp) => {
          const k = (now - imp.t0) / IMPULSE_MS;
          if (k >= 1) return false;
          const segs = imp.path.length - 1;
          const at = Math.min(segs - 1e-6, k * segs);
          const si = Math.floor(at);
          const u = at - si;
          const par = nodes[imp.path[si]];
          const n = nodes[imp.path[si + 1]];
          const mid = (par.radius + n.radius) / 2;
          const a1 = par.depth === 0 ? n.angle : par.angle;
          const pts = [
            [par.x, par.y],
            [Math.cos(a1) * mid, Math.sin(a1) * mid],
            [Math.cos(n.angle) * mid, Math.sin(n.angle) * mid],
            [n.x, n.y],
          ];
          const w0 = (1 - u) ** 3;
          const w1 = 3 * (1 - u) ** 2 * u;
          const w2 = 3 * (1 - u) * u * u;
          const w3 = u ** 3;
          const x = w0 * pts[0][0] + w1 * pts[1][0] + w2 * pts[2][0] + w3 * pts[3][0];
          const y = w0 * pts[0][1] + w1 * pts[1][1] + w2 * pts[2][1] + w3 * pts[3][1];
          const s = toScreen(v, x, y);
          if (s.x < -20 || s.y < -20 || s.x > v.w + 20 || s.y > v.h + 20) return true;
          const size = 14 * zoomWidth;
          ctx.globalAlpha = Math.sin(Math.PI * k) * (light ? 0.3 : 1);
          ctx.drawImage(glowSprite(sprites.current, colourOf(n, p)), s.x - size / 2, s.y - size / 2, size, size);
          return true;
        });
        ctx.globalCompositeOperation = "source-over";
      }

      // Nodes, the outer ring first so the branches sit on top.
      const pulse = animated ? (now % 1800) / 1800 : 0;
      const u = unfold.current;
      const grow = u.node >= 0 ? (animated ? Math.min(1, (now - u.at) / 160) : 1) : 0;
      for (let k = shown.length - 1; k >= 0; k--) {
        const i = shown[k];
        const n = nodes[i];
        const p0 = toScreen(v, n.x, n.y);
        let r = nodeSize(n, v.s);
        if (i === u.node) r *= 1 + 1.2 * grow;
        const colour = colourOf(n, p);
        const d = dim(i);
        const stale = isStale(n) && n.kind === "note";
        // Glow: the root most, then recent notes and branches.
        const glow = n.kind === "root" ? 1 : n.kind === "note" ? n.recency * 0.8 : 0.35 + 0.5 * n.recency;
        if (glow > 0.05) {
          ctx.globalCompositeOperation = additive;
          ctx.globalAlpha = glow * d;
          const g = r * (n.kind === "root" ? 5 : 4.2);
          ctx.drawImage(glowSprite(sprites.current, colour), p0.x - g / 2, p0.y - g / 2, g, g);
          ctx.globalCompositeOperation = "source-over";
        }
        if (n.pending) {
          ctx.globalAlpha = 0.9 * d;
          ctx.globalCompositeOperation = additive;
          const g = r * 6 + 10;
          ctx.drawImage(glowSprite(sprites.current, p.warning), p0.x - g / 2, p0.y - g / 2, g, g);
          ctx.globalCompositeOperation = "source-over";
        }
        if (n.risky && n.kind === "note") {
          // A soft red pulse (still ring under reduced motion).
          const rr = r + 4 + (animated ? 9 * pulse : 3);
          ctx.globalAlpha = (animated ? 0.65 * (1 - pulse) : 0.7) * d;
          ctx.strokeStyle = p.error;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = (stale ? 0.5 : 1) * d;
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, r, 0, Math.PI * 2);
        if (n.proposal) {
          ctx.fillStyle = p.card;
          ctx.fill();
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = p.warning;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = colour;
          ctx.fill();
          if (n.kind !== "note") {
            ctx.strokeStyle = p.card;
            ctx.lineWidth = n.kind === "root" ? 2.5 : 1.5;
            ctx.stroke();
          }
        }
        if (n.pending && !n.proposal) {
          ctx.strokeStyle = p.warning;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, r + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (i === selectedIndex || light?.hits.has(i)) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = i === selectedIndex ? p.fg : p.focus;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Labels: never over one another (lib/memory-brain.ts planLabels).
      const priority = [hov, selectedIndex, ...(light ? [...light.hits].slice(0, 80) : [])].filter((i) => i >= 0);
      const boxes = planLabels(brain, v, { measure, priority, only: light ? light.hits : null, visible: shown });
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const b of boxes) {
        const n = nodes[b.node];
        const d = dim(b.node);
        if (n.kind === "note") {
          const strong = b.node === hov || b.node === selectedIndex || light?.hits.has(b.node);
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.angle);
          ctx.font = `${strong ? 600 : 500} ${LABEL_SIZE.note}px ${p.font}`;
          ctx.textAlign = b.align;
          ctx.globalAlpha = Math.max(0.35, d);
          ctx.strokeStyle = p.card;
          ctx.lineWidth = 3;
          ctx.strokeText(b.text, 0, 0);
          ctx.fillStyle = strong ? p.fg : p.muted;
          ctx.fillText(b.text, 0, 0);
          ctx.restore();
        } else {
          const size = n.kind === "root" ? LABEL_SIZE.root : n.kind === "tier" ? LABEL_SIZE.tier : LABEL_SIZE.topic;
          ctx.globalAlpha = Math.max(0.35, d) * 0.92;
          ctx.fillStyle = p.card;
          ctx.beginPath();
          ctx.roundRect(b.cx - b.hw, b.cy - b.hh, b.hw * 2, b.hh * 2, b.hh);
          ctx.fill();
          if (n.kind !== "topic") {
            ctx.strokeStyle = colourOf(n, p);
            ctx.globalAlpha = Math.max(0.35, d) * 0.6;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.globalAlpha = Math.max(0.35, d);
          ctx.font = `${n.kind === "topic" ? 500 : 600} ${size}px ${p.font}`;
          ctx.textAlign = "center";
          ctx.fillStyle = p.fg;
          ctx.fillText(b.text, b.cx, b.cy + 0.5);
        }
      }
      ctx.globalAlpha = 1;

      // The unfolded node's card follows it.
      const cardEl = card.current;
      if (cardEl && u.node >= 0) {
        const n = nodes[u.node];
        const at = toScreen(v, n.x, n.y);
        const right = at.x < v.w - 300;
        const x = right ? at.x + 18 : at.x - 18 - cardEl.offsetWidth;
        let y = Math.min(Math.max(8, at.y - cardEl.offsetHeight / 2), v.h - cardEl.offsetHeight - 8);
        let cx = Math.max(8, x);
        // Keep clear of the minimap and the zoom buttons (bottom right).
        const mm = mini.current;
        if (mm) {
          const rl = mm.offsetLeft - 8;
          const rt = mm.offsetTop - 8;
          const cw = cardEl.offsetWidth;
          const ch = cardEl.offsetHeight;
          if (cx + cw > rl && y + ch > rt) {
            if (rt - ch >= 8) y = rt - ch;
            else cx = Math.max(8, rl - cw);
          }
        }
        cardEl.style.transform = `translate(${Math.round(cx)}px, ${Math.round(y)}px)`;
        cardEl.style.opacity = String(grow);
      }

      // The minimap: the still image and where the screen is.
      const m = mini.current;
      if (m && miniImage.current) {
        const mw = m.clientWidth;
        const mh = m.clientHeight;
        const dpr = v.dpr;
        if (m.width !== Math.round(mw * dpr)) {
          m.width = Math.round(mw * dpr);
          m.height = Math.round(mh * dpr);
        }
        const g = m.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, mw, mh);
        g.drawImage(miniImage.current, 0, 0, mw, mh);
        const bb = brainBounds(brain);
        const ms = Math.min(mw / (bb.maxX - bb.minX), mh / (bb.maxY - bb.minY));
        const r0 = worldRect(v, 0);
        g.strokeStyle = p.fg;
        g.globalAlpha = 0.8;
        g.lineWidth = 1.5;
        g.strokeRect(mw / 2 + r0.minX * ms, mh / 2 + r0.minY * ms, (r0.maxX - r0.minX) * ms, (r0.maxY - r0.minY) * ms);
        g.globalAlpha = 1;
      }

      // Measures, for the tests and the performance note.
      const st = stats.current;
      st.frames++;
      st.drawn = shown.length;
      st.times.push(performance.now() - t0);
      if (st.times.length > 240) st.times.shift();
      st.stamps.push(now);
      while (st.stamps.length && now - st.stamps[0] > 1000) st.stamps.shift();
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

  const pointers = useRef(new Map<number, { x: number; y: number; t: number }>());
  const gesture = useRef({ moved: 0, startDist: 0, startS: 1, node: -1, touch: false, samples: [] as { x: number; y: number; t: number }[] });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const setUnfold = useCallback(
    (i: number) => {
      if (hoverRef.current === i) return;
      hoverRef.current = i;
      unfold.current = { node: i, at: performance.now() };
      setHover(i);
      kick();
    },
    [kick],
  );
  const zoomAt = useCallback(
    (x: number, y: number, factor: number, smooth = true) => {
      const v = view.current;
      const base = target.current ?? { s: v.s, tx: v.tx, ty: v.ty };
      const s = Math.max(0.03, Math.min(MAX_SCALE, base.s * factor));
      const to = { s, tx: x - ((x - base.tx) * s) / base.s, ty: y - ((y - base.ty) * s) / base.s };
      if (smooth && animated) target.current = to;
      else {
        target.current = null;
        Object.assign(v, to);
      }
      fitted.current = false;
      kick();
    },
    [animated, kick],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = local(e);
    pointers.current.set(e.pointerId, { ...at, t: performance.now() });
    const g = gesture.current;
    velocity.current = { x: 0, y: 0 };
    target.current = null;
    g.touch = e.pointerType !== "mouse";
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.startS = view.current.s;
      g.node = -1;
      return;
    }
    dragging.current = true;
    g.moved = 0;
    g.node = pick(at.x, at.y, g.touch ? 14 : 6);
    g.samples = [{ ...at, t: performance.now() }];
    kick();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const at = local(e);
    const prev = pointers.current.get(e.pointerId);
    const v = view.current;
    if (!prev) {
      if (e.pointerType === "mouse") {
        const n = pick(at.x, at.y);
        e.currentTarget.style.cursor = n >= 0 ? "pointer" : "grab";
        setUnfold(n);
      }
      return;
    }
    const now = performance.now();
    pointers.current.set(e.pointerId, { ...at, t: now });
    const g = gesture.current;
    const dx = at.x - prev.x;
    const dy = at.y - prev.y;
    g.moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(mid.x, mid.y, (g.startS * (dist / g.startDist)) / v.s, false);
      v.tx += dx / 2;
      v.ty += dy / 2;
      return;
    }
    if (g.moved > 4) {
      v.tx += dx;
      v.ty += dy;
      fitted.current = false;
      g.samples.push({ ...at, t: now });
      while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift();
      kick();
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    const had = pointers.current.size;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    dragging.current = false;
    if (had === 1 && g.moved <= 5) {
      const n = g.node;
      if (n < 0) {
        if (g.touch) setUnfold(-1);
      } else if (g.touch && hoverRef.current !== n) setUnfold(n);
      else onSelect(brain.nodes[n]);
      return;
    }
    // Inertia: the last few samples of the drag carry on and slow down.
    if (animated && g.samples.length >= 2) {
      const a = g.samples[0];
      const b = g.samples[g.samples.length - 1];
      const dt = Math.max(1, b.t - a.t);
      if (performance.now() - b.t < 80) velocity.current = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    }
    kick();
  };

  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const lines = e.deltaMode === 1 ? 16 : 1;
      // 2026-11-03 (JC): scrolling zooms in and out (mouse wheel and
      // trackpad alike); a pinch zooms too; drag moves the map. A mostly
      // sideways trackpad swipe still pans.
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        const v = view.current;
        target.current = null;
        v.tx -= e.deltaX * lines;
        fitted.current = false;
        kick();
        return;
      }
      zoomRef.current(x, y, Math.exp(-e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.003)));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [kick]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = view.current;
    const step = 60;
    if (e.key === "+" || e.key === "=") zoomAt(v.w / 2, v.h / 2, 1.3);
    else if (e.key === "-") zoomAt(v.w / 2, v.h / 2, 1 / 1.3);
    else if (e.key === "0") fit(true);
    else if (e.key === "ArrowLeft") v.tx += step;
    else if (e.key === "ArrowRight") v.tx -= step;
    else if (e.key === "ArrowUp") v.ty += step;
    else if (e.key === "ArrowDown") v.ty -= step;
    else return;
    e.preventDefault();
    kick();
  };

  // The minimap moves the view: press or drag in it to centre there.
  const onMini = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const m = e.currentTarget.getBoundingClientRect();
    const bb = brainBounds(brain);
    const ms = Math.min(m.width / (bb.maxX - bb.minX), m.height / (bb.maxY - bb.minY));
    const wx = (e.clientX - m.left - m.width / 2) / ms;
    const wy = (e.clientY - m.top - m.height / 2) / ms;
    const v = view.current;
    const to = { s: v.s, tx: v.w / 2 - wx * v.s, ty: v.h / 2 - wy * v.s };
    if (animated && e.type === "pointerdown") target.current = to;
    else {
      target.current = null;
      Object.assign(v, to);
    }
    fitted.current = false;
    kick();
  };

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