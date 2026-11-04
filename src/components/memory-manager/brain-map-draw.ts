// Frame painter for BrainMap (extracted for the #1383 function-size budget).
import {
  edgeStyle,
  edgeVisible,
  isStale,
  nodeSize,
  planLabels,
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

export interface Palette {
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

export interface Impulse {
  path: number[];
  t0: number;
}

export const IMPULSE_MS = 1500;
export const IMPULSE_EVERY_MS = 650;

/** A soft round glow of one colour, drawn once and stamped many times. */
export function glowSprite(cache: Map<string, HTMLCanvasElement>, colour: string): HTMLCanvasElement {
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

export interface BrainFrameStats {
  frames: number;
  times: number[];
  stamps: number[];
  drawn: number;
}

export interface SpotlightLight {
  hits: Set<number>;
  path: Set<number>;
}

export interface PaintMiniArgs {
  mini: HTMLCanvasElement;
  palette: Palette;
  brain: Brain;
  colourOf: (n: BrainNode, p: Palette) => string;
  veil: Veil | null | undefined;
}

/** Still image of every node as a dot for the minimap. */
export function paintMiniImage(args: PaintMiniArgs): HTMLCanvasElement | null {
  const { mini: m, palette: p, brain, colourOf, veil } = args;
  const w = m.clientWidth;
  const h = m.clientHeight;
  if (!w || !h) return null;
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
  return img;
}

export interface PaintBrainFrameArgs {
  now: number;
  canvas: HTMLCanvasElement;
  palette: Palette;
  brain: Brain;
  view: View & { dpr: number };
  colourOf: (n: BrainNode, p: Palette) => string;
  light: SpotlightLight | null | undefined;
  selectedIndex: number;
  measure: (text: string, size: number) => number;
  recent: number[];
  animated: boolean;
  veil: Veil | null | undefined;
  hoverIndex: number;
  unfold: { node: number; at: number };
  impulses: Impulse[];
  nextImpulse: { current: number };
  sprites: Map<string, HTMLCanvasElement>;
  stats: BrainFrameStats;
  cardEl: HTMLDivElement | null;
  mini: HTMLCanvasElement | null;
  miniImageRef: { current: HTMLCanvasElement | null };
}

/** One BrainMap frame: links, branches, impulses, nodes, labels, card, minimap. */
export function paintBrainFrame(args: PaintBrainFrameArgs): void {
  const {
    now, canvas: c, palette: p, brain, view: v, colourOf, light, selectedIndex, measure,
    recent, animated, veil, hoverIndex: hov, unfold: u, impulses, nextImpulse, sprites, stats,
    cardEl, mini: m, miniImageRef,
  } = args;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const t0 = performance.now();
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
  if (animated && recent.length && now >= nextImpulse.current && impulses.length < 6) {
    nextImpulse.current = now + IMPULSE_EVERY_MS;
    // Fresher notes fire more often.
    let pick = recent[Math.floor(Math.random() * recent.length)];
    for (let k = 0; k < 3; k++) {
      const c2 = recent[Math.floor(Math.random() * recent.length)];
      if (nodes[c2].recency > nodes[pick].recency) pick = c2;
    }
    const path: number[] = [];
    for (let i = pick; i >= 0; i = nodes[i].parent) path.unshift(i);
    impulses.push({ path, t0: now });
  }
  if (animated) {
    ctx.globalCompositeOperation = additive;
    const kept = impulses.filter((imp) => {
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
      ctx.drawImage(glowSprite(sprites, colourOf(n, p)), s.x - size / 2, s.y - size / 2, size, size);
      return true;
    });
    impulses.length = 0;
    impulses.push(...kept);
    ctx.globalCompositeOperation = "source-over";
  }

  // Nodes, the outer ring first so the branches sit on top.
  const pulse = animated ? (now % 1800) / 1800 : 0;
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
      ctx.drawImage(glowSprite(sprites, colour), p0.x - g / 2, p0.y - g / 2, g, g);
      ctx.globalCompositeOperation = "source-over";
    }
    if (n.pending) {
      ctx.globalAlpha = 0.9 * d;
      ctx.globalCompositeOperation = additive;
      const g = r * 6 + 10;
      ctx.drawImage(glowSprite(sprites, p.warning), p0.x - g / 2, p0.y - g / 2, g, g);
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
  if (cardEl && u.node >= 0) {
    const n = nodes[u.node];
    const at = toScreen(v, n.x, n.y);
    const right = at.x < v.w - 300;
    const x = right ? at.x + 18 : at.x - 18 - cardEl.offsetWidth;
    let y = Math.min(Math.max(8, at.y - cardEl.offsetHeight / 2), v.h - cardEl.offsetHeight - 8);
    let cx = Math.max(8, x);
    // Keep clear of the minimap and the zoom buttons (bottom right).
    const mm = m;
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
  if (m && miniImageRef.current) {
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
    g.drawImage(miniImageRef.current, 0, 0, mw, mh);
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
  stats.frames++;
  stats.drawn = shown.length;
  stats.times.push(performance.now() - t0);
  if (stats.times.length > 240) stats.times.shift();
  stats.stamps.push(now);
  while (stats.stamps.length && now - stats.stamps[0] > 1000) stats.stamps.shift();
}
