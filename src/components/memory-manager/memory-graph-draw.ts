// Canvas painters for MemoryGraph (extracted for the #1383 function-size budget).
import {
  boundsOf,
  fitBounds,
  labelOpacity,
  neighbourSet,
  type GraphModel,
  type GraphView,
  type Simulation,
} from "@/lib/memory-graph";
import type { GraphSettings } from "@/lib/memory-graph-settings";

export interface GraphPalette {
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

export interface GraphLive {
  model: GraphModel;
  visible: Uint8Array;
  lit: Uint8Array | null;
  colours: string[];
  radii: Float64Array;
  settings: GraphSettings;
  focus: number;
}

export interface GraphDrawStats {
  frames: number;
  times: number[];
}

function segmentCrosses(ax: number, ay: number, bx: number, by: number, w: number, h: number): boolean {
  return !(Math.max(ax, bx) < 0 || Math.min(ax, bx) > w || Math.max(ay, by) < 0 || Math.min(ay, by) > h);
}

export interface PaintGraphFrameArgs {
  canvas: HTMLCanvasElement;
  sim: Simulation;
  palette: GraphPalette;
  size: { w: number; h: number; dpr: number };
  live: GraphLive;
  view: GraphView;
  hoverMix: number;
  hover: number;
  stats: GraphDrawStats;
}

/** One MemoryGraph frame: links, nodes, focus ring, labels. */
export function paintGraphFrame(args: PaintGraphFrameArgs): void {
  const { canvas: c, sim: s, palette: p, size, live, view, hoverMix, hover, stats } = args;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const t0 = performance.now();
  const { w, h, dpr } = size;
  const { model: m, visible: vis, lit: on, colours: col, radii: rad, settings: st, focus } = live;
  const v = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, w, h);
  const mix = hoverMix;
  const hov = hover;
  const near = hov >= 0 ? neighbourSet(m, hov) : null;
  const sx = (i: number) => s.x[i]! * v.s + v.tx;
  const sy = (i: number) => s.y[i]! * v.s + v.ty;
  const margin = 40;
  const onScreen = (x: number, y: number) => x > -margin && x < w + margin && y > -margin && y < h + margin;

  // Links: thin, grey, faint; a hovered node's in the accent colour.
  const width = Math.max(0.35, st.display.linkThickness * Math.min(1.6, Math.max(0.5, v.s)));
  const baseAlpha = p.dark ? 0.32 : 0.42;
  const plain = new Path2D();
  const bright = new Path2D();
  const arrows = new Path2D();
  const arrowsBright = new Path2D();
  m.links.forEach((edge, k) => {
    void k;
    const a = edge.source;
    const b = edge.target;
    if (!vis[a] || !vis[b]) return;
    const ax = sx(a), ay = sy(a), bx = sx(b), by = sy(b);
    if (!onScreen(ax, ay) && !onScreen(bx, by) && !segmentCrosses(ax, ay, bx, by, w, h)) return;
    const hot = near !== null && (a === hov || b === hov);
    const path = hot ? bright : plain;
    path.moveTo(ax, ay);
    path.lineTo(bx, by);
    if (st.display.arrows && edge.kind === "link") {
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      const r = rad[b]! * v.s;
      if (len > r + 6) {
        const ux = dx / len, uy = dy / len;
        const tipX = bx - ux * r, tipY = by - uy * r;
        const head = Math.max(4, 5 * Math.min(1.5, v.s));
        const arrow = hot ? arrowsBright : arrows;
        arrow.moveTo(tipX, tipY);
        arrow.lineTo(tipX - ux * head - uy * head * 0.5, tipY - uy * head + ux * head * 0.5);
        arrow.lineTo(tipX - ux * head + uy * head * 0.5, tipY - uy * head - ux * head * 0.5);
        arrow.closePath();
      }
    }
  });
  ctx.lineWidth = width;
  ctx.strokeStyle = p.line;
  ctx.fillStyle = p.line;
  ctx.globalAlpha = baseAlpha * (1 - 0.75 * mix) * (on ? 0.5 : 1);
  ctx.stroke(plain);
  ctx.fill(arrows);
  if (near) {
    ctx.globalAlpha = Math.max(baseAlpha, 0.9 * mix);
    ctx.strokeStyle = p.accent;
    ctx.fillStyle = p.accent;
    ctx.lineWidth = width * 1.4;
    ctx.stroke(bright);
    ctx.fill(arrowsBright);
  }

  // Nodes: filled circles, batched by colour and brightness.
  const batches = new Map<string, Path2D>();
  const alphaOf = (i: number) => {
    let alpha = 1;
    if (on && !on[i]) alpha = 0.18;
    if (near && !near.has(i)) alpha *= 1 - 0.78 * mix;
    return alpha;
  };
  for (let i = 0; i < s.n; i++) {
    if (!vis[i]) continue;
    const x = sx(i), y = sy(i);
    const r = Math.max(1.2, rad[i]! * v.s);
    if (x < -r || x > w + r || y < -r || y > h + r) continue;
    const fill = i === hov ? p.accent : col[i] ?? p.ghost;
    const key = `${fill}|${alphaOf(i).toFixed(2)}`;
    let path = batches.get(key);
    if (!path) { path = new Path2D(); batches.set(key, path); }
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
  }
  for (const [key, path] of batches) {
    const cut = key.lastIndexOf("|");
    ctx.globalAlpha = Number(key.slice(cut + 1));
    ctx.fillStyle = key.slice(0, cut);
    ctx.fill(path);
  }
  // The note the page asked for: a ring.
  if (focus >= 0 && vis[focus]) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(focus), sy(focus), Math.max(1.2, rad[focus]! * v.s) + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Labels: they fade in with the zoom; a hovered node's always show.
  const fade = labelOpacity(v.s, st.display.textFade);
  if (fade > 0.01 || near || focus >= 0) {
    const fontSize = Math.round(Math.max(10, Math.min(15, 11 * Math.sqrt(Math.max(1, v.s)))));
    ctx.font = `${fontSize}px ${p.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = p.ink;
    for (let i = 0; i < s.n; i++) {
      if (!vis[i]) continue;
      const mine = near?.has(i) || i === focus;
      let alpha = mine ? 1 : fade * (near ? 1 - 0.85 * mix : 1);
      if (on && !on[i] && !mine) alpha *= 0.25;
      if (alpha < 0.02) continue;
      const x = sx(i), y = sy(i);
      if (!onScreen(x, y)) continue;
      ctx.globalAlpha = alpha;
      const label = m.nodes[i]!.label;
      ctx.fillText(label.length > 48 ? `${label.slice(0, 47)}…` : label, x, y + Math.max(1.2, rad[i]! * v.s) + 3);
    }
  }
  ctx.globalAlpha = 1;
  const st2 = stats;
  st2.frames += 1;
  st2.times.push(performance.now() - t0);
  if (st2.times.length > 240) st2.times.shift();
}

export interface PaintGraphMiniArgs {
  mini: HTMLCanvasElement;
  sim: Simulation;
  palette: GraphPalette;
  size: { w: number; h: number; dpr: number };
  live: GraphLive;
  view: GraphView;
}

/** Minimap still image and the screen rectangle. */
export function paintGraphMini(args: PaintGraphMiniArgs): void {
  const { mini: c, sim: s, palette: p, size, live, view } = args;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const dpr = size.dpr;
  const cw = c.clientWidth || 132;
  const ch = c.clientHeight || 132;
  if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const { visible: vis, colours: col } = live;
  const b = boundsOf(s, (i) => vis[i] === 1);
  if (!b) return;
  const fit = fitBounds(b, cw, ch, 8, 100);
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < s.n; i++) {
    if (!vis[i]) continue;
    ctx.fillStyle = col[i] ?? p.ghost;
    ctx.fillRect(s.x[i]! * fit.s + fit.tx - 1, s.y[i]! * fit.s + fit.ty - 1, 2, 2);
  }
  const v = view;
  const { w, h } = size;
  const x0 = ((0 - v.tx) / v.s) * fit.s + fit.tx;
  const y0 = ((0 - v.ty) / v.s) * fit.s + fit.ty;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, (w / v.s) * fit.s, (h / v.s) * fit.s);
}
