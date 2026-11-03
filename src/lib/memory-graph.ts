// Tools > Memory > Map > Graph (2026-11-03, JC: "the EXACT same
// visualisation that we see in Obsidian, I want it to look like a brain").
// Our own code, written from what the graph view looks like and how it
// behaves; nothing is copied from Obsidian, whose code is closed.
//
// The pure half of MemoryGraph.tsx:
//   - the model: one node per note, optional nodes for tags, attachments,
//     links to notes that do not exist yet, and the tier and folder
//     hierarchy, so a bot's Topics and Logs cluster without a single
//     [[link]];
//   - the force simulation: centre, repel (Barnes-Hut), link force and link
//     distance, d3-force style (alpha decays to rest, the velocity decays
//     every tick), seeded so two runs land on the same picture, and still
//     once settled: no jitter;
//   - the view helpers: fit, hit test, the hover neighbourhood, node radius
//     and the label fade by zoom.

import { foldSearch } from "./memory-brain";

// ---------------------------------------------------------------- model

export type GraphNodeKind = "note" | "ghost" | "attachment" | "tag" | "folder" | "tier";
export type GraphLinkKind = "link" | "folder" | "tag" | "attachment";

/** One note of the page, as the graph needs it. */
export interface GraphNote {
  /** The page's row key: stable, never shown. */
  key: string;
  title: string;
  /** PageTier.key */
  tier: string;
  tierName: string;
  /** "notes", "Atlas / Topics": the folders under the tier. */
  folderPath: string;
  tags: readonly string[];
  /** Its body, when the page has read it: the [[links]] and attachments. */
  body?: string;
  /** A local path (memory/dining.md): its file name also resolves links. */
  path?: string;
  createdAt?: number;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** The tier the node belongs to ("" for a tag, a ghost, an attachment). */
  tier: string;
  /** The note's row key (note nodes only). */
  key?: string;
  folderPath: string;
  tags: readonly string[];
  /** Links of any kind drawn to it. */
  degree: number;
  /** The folder or tier above it (hierarchy nodes and notes), -1 for none. */
  parent: number;
}

export interface GraphLink {
  source: number;
  target: number;
  kind: GraphLinkKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
  /** The neighbours of each node, by index. */
  adjacency: number[][];
  index: Map<string, number>;
  /** Note to note links (the count the toolbar shows). */
  noteLinks: number;
}

export interface GraphFilters {
  /** Obsidian's Filters search: only the notes it matches stay. */
  search: string;
  tags: boolean;
  attachments: boolean;
  /** Links to notes that do not exist yet are left out. */
  existingOnly: boolean;
  /** Notes with no link at all stay. */
  orphans: boolean;
  /** The tier and folder hierarchy as nodes and edges. */
  folders: boolean;
}

const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|m4a|wav|ogg|mp4|mov|webm|csv|xlsx?|docx?|pptx?|zip|txt|json)$/i;

/** The [[links]] and attachments of a markdown body. Note targets come
 * folded (case and accents), attachments keep their file name. */
export function bodyRefs(body: string): { notes: string[]; attachments: string[] } {
  const notes = new Set<string>();
  const attachments = new Set<string>();
  const wiki = /(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(body)) !== null) {
    const target = match[2]!.trim();
    if (!target) continue;
    if (ATTACHMENT.test(target)) attachments.add(baseName(target));
    else notes.add(foldSearch(target.replace(/\.md$/i, "")));
  }
  const image = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((match = image.exec(body)) !== null) {
    const target = decodeSafe(match[1]!);
    if (/^[a-z]+:\/\//i.test(target) || target.startsWith("data:")) continue;
    if (ATTACHMENT.test(target)) attachments.add(baseName(target));
  }
  return { notes: [...notes], attachments: [...attachments] };
}

function decodeSafe(text: string): string {
  try { return decodeURIComponent(text); } catch { return text; }
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** The folder path as its segments: "Atlas / Topics" -> ["Atlas", "Topics"]. */
export function folderSegments(path: string): string[] {
  return path.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
}

/** Obsidian-like queries, case and accents folded, every word must match:
 * `tag:#x` (or `tag:x`), `path:x` (or `folder:x`), `tier:x`, `file:x`, or
 * plain words found in the title (or the folder). */
export function matchesQuery(node: Pick<GraphNode, "label" | "folderPath" | "tags" | "kind"> & { tierName?: string }, query: string): boolean {
  const words = foldSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const title = foldSearch(node.label);
  const folder = foldSearch(node.folderPath);
  const tags = node.tags.map((tag) => foldSearch(tag).replace(/^#/, ""));
  return words.every((word) => {
    const at = word.indexOf(":");
    const op = at > 0 ? word.slice(0, at) : "";
    const value = at > 0 ? word.slice(at + 1) : word;
    if (op === "tag") {
      const want = value.replace(/^#/, "");
      return want ? tags.some((tag) => tag === want || tag.startsWith(`${want}/`) || tag.startsWith(`${want}:`)) || (node.kind === "tag" && title.replace(/^#/, "") === want) : true;
    }
    if (op === "path" || op === "folder") return folder.includes(value);
    if (op === "tier") return foldSearch(node.tierName ?? "").includes(value);
    if (op === "file") return title.includes(value);
    return title.includes(value) || folder.includes(value);
  });
}

/** The graph of the notes, with the filters of the settings panel. */
export function buildGraph(notes: readonly GraphNote[], filters: GraphFilters): GraphModel {
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  const linkSet = new Set<string>();
  const links: GraphLink[] = [];
  const add = (node: Omit<GraphNode, "degree" | "parent"> & { parent?: number }): number => {
    const known = index.get(node.id);
    if (known !== undefined) return known;
    const at = nodes.length;
    nodes.push({ ...node, degree: 0, parent: node.parent ?? -1 });
    index.set(node.id, at);
    return at;
  };
  const link = (a: number, b: number, kind: GraphLinkKind) => {
    if (a === b) return;
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (linkSet.has(id)) return;
    linkSet.add(id);
    links.push({ source: a, target: b, kind });
  };

  const tierNames = new Map(notes.map((note) => [note.tier, note.tierName]));
  const kept = notes.filter((note) => !filters.search.trim() || matchesQuery({ label: note.title, folderPath: note.folderPath, tags: note.tags, kind: "note", tierName: note.tierName }, filters.search));

  for (const note of kept) {
    add({ id: `n:${note.key}`, kind: "note", label: note.title, tier: note.tier, key: note.key, folderPath: note.folderPath, tags: note.tags });
  }
  // Titles (and file names) resolve [[links]].
  const byName = new Map<string, number>();
  for (const note of kept) {
    const at = index.get(`n:${note.key}`)!;
    byName.set(foldSearch(note.title.trim()), at);
    if (note.path) {
      const file = foldSearch(baseName(note.path).replace(/\.md$/i, ""));
      if (file && !byName.has(file)) byName.set(file, at);
    }
  }
  let noteLinks = 0;
  for (const note of kept) {
    if (!note.body) continue;
    const from = index.get(`n:${note.key}`)!;
    const refs = bodyRefs(note.body);
    for (const target of refs.notes) {
      const to = byName.get(target);
      if (to !== undefined) {
        const before = links.length;
        link(from, to, "link");
        if (links.length > before) noteLinks += 1;
      } else if (!filters.existingOnly) {
        link(from, add({ id: `g:${target}`, kind: "ghost", label: target, tier: "", folderPath: "", tags: [] }), "link");
      }
    }
    if (filters.attachments) {
      for (const file of refs.attachments) link(from, add({ id: `a:${file.toLowerCase()}`, kind: "attachment", label: file, tier: "", folderPath: "", tags: [] }), "attachment");
    }
  }
  if (filters.tags) {
    for (const note of kept) {
      const from = index.get(`n:${note.key}`)!;
      for (const tag of note.tags) {
        const name = tag.replace(/^#/, "");
        if (!name) continue;
        link(from, add({ id: `t:${name.toLowerCase()}`, kind: "tag", label: `#${name}`, tier: "", folderPath: "", tags: [name] }), "tag");
      }
    }
  }
  if (filters.folders) {
    for (const note of kept) {
      const from = index.get(`n:${note.key}`)!;
      let parent = add({ id: `r:${note.tier}`, kind: "tier", label: tierNames.get(note.tier) || note.tier, tier: note.tier, folderPath: "", tags: [] });
      // A bot's folders start with its name, which the tier node already is.
      const segments = folderSegments(note.folderPath);
      const skip = segments.length > 0 && foldSearch(segments[0]!) === foldSearch(note.tierName) ? 1 : 0;
      let path = "";
      for (const [i, segment] of segments.entries()) {
        path = path ? `${path} / ${segment}` : segment;
        if (i < skip) continue;
        const folder = add({ id: `f:${note.tier}:${path}`, kind: "folder", label: segment, tier: note.tier, folderPath: path, tags: [], parent });
        link(parent, folder, "folder");
        parent = folder;
      }
      nodes[from]!.parent = parent;
      link(parent, from, "folder");
    }
  }

  // Orphans out: a note with no link of any kind (and nothing else is ever an orphan).
  let finalNodes = nodes;
  let finalLinks = links;
  if (!filters.orphans) {
    const linked = new Uint8Array(nodes.length);
    for (const edge of links) { linked[edge.source] = 1; linked[edge.target] = 1; }
    if (linked.some((on, i) => !on && nodes[i]!.kind === "note")) {
      const remap = new Int32Array(nodes.length).fill(-1);
      finalNodes = [];
      nodes.forEach((node, i) => {
        if (node.kind === "note" && !linked[i]) return;
        remap[i] = finalNodes.length;
        finalNodes.push(node);
      });
      for (const node of finalNodes) node.parent = node.parent >= 0 ? remap[node.parent]! : -1;
      finalLinks = links.map((edge) => ({ ...edge, source: remap[edge.source]!, target: remap[edge.target]! }));
      index.clear();
      finalNodes.forEach((node, i) => index.set(node.id, i));
    }
  }
  const adjacency: number[][] = finalNodes.map(() => []);
  for (const edge of finalLinks) {
    adjacency[edge.source]!.push(edge.target);
    adjacency[edge.target]!.push(edge.source);
    finalNodes[edge.source]!.degree += 1;
    finalNodes[edge.target]!.degree += 1;
  }
  return { nodes: finalNodes, links: finalLinks, adjacency, index, noteLinks };
}

/** The node and its neighbours: what a hover lights up. */
export function neighbourSet(model: Pick<GraphModel, "adjacency">, node: number): Set<number> {
  const out = new Set<number>();
  if (node < 0 || node >= model.adjacency.length) return out;
  out.add(node);
  for (const next of model.adjacency[node]!) out.add(next);
  return out;
}

/** The links of a hovered node: their indexes in `links`. */
export function neighbourLinks(model: Pick<GraphModel, "links">, node: number): Set<number> {
  const out = new Set<number>();
  model.links.forEach((edge, i) => { if (edge.source === node || edge.target === node) out.add(i); });
  return out;
}

/** Everything within `depth` hops of `node` (Obsidian's local graph). */
export function withinDepth(model: Pick<GraphModel, "adjacency">, node: number, depth: number): Set<number> {
  const out = new Set<number>([node]);
  let edge = [node];
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (const at of edge) for (const n of model.adjacency[at]!) if (!out.has(n)) { out.add(n); next.push(n); }
    edge = next;
  }
  return out;
}

// --------------------------------------------------------------- forces

/** Obsidian's four sliders, on its own ranges. */
export interface GraphForces {
  /** 0..1 */
  center: number;
  /** 0..20 */
  repel: number;
  /** 0..1 */
  link: number;
  /** 30..500 */
  linkDistance: number;
}

export const DEFAULT_FORCES: GraphForces = { center: 0.5, repel: 10, link: 1, linkDistance: 250 };

/** World units per unit of the link distance slider. */
const DISTANCE_SCALE = 0.2;
const REPEL_SCALE = 14;
const CENTER_SCALE = 0.06;
const THETA2 = 0.81;
const DISTANCE_MAX2 = 1600 * 1600;

export interface SimulationOptions {
  seed?: number;
  forces?: GraphForces;
  /** Where a node starts (a rebuilt graph keeps the places it had). */
  start?: (i: number) => { x: number; y: number } | null | undefined;
}

/** mulberry32: a small seeded generator. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Simulation {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** NaN when free; a dragged node is pinned here. */
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  alpha: number;
  alphaTarget: number;
  readonly alphaMin: number;
  forces: GraphForces;
  tick(): void;
  /** At rest: alpha under alphaMin and nothing pinned keeps it warm. */
  settled(): boolean;
  reheat(alpha?: number): void;
  pin(i: number, x: number, y: number): void;
  release(i: number): void;
}

export function createSimulation(links: readonly Pick<GraphLink, "source" | "target">[], n: number, options: SimulationOptions = {}): Simulation {
  const rng = seededRandom(options.seed ?? 1);
  const jiggle = () => (rng() - 0.5) * 1e-6;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const fx = new Float64Array(n).fill(Number.NaN);
  const fy = new Float64Array(n).fill(Number.NaN);
  const count = new Float64Array(n);
  for (const edge of links) { count[edge.source]! += 1; count[edge.target]! += 1; }
  // A phyllotaxis spiral turned by the seed: even, organic, and the same twice.
  const turn = rng() * Math.PI * 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const at = options.start?.(i);
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      x[i] = at.x;
      y[i] = at.y;
      continue;
    }
    const r = 10 * Math.sqrt(0.5 + placed);
    const a = turn + placed * golden;
    x[i] = r * Math.cos(a);
    y[i] = r * Math.sin(a);
    placed += 1;
  }
  const src = Int32Array.from(links, (edge) => edge.source);
  const dst = Int32Array.from(links, (edge) => edge.target);
  const bias = Float64Array.from(links, (edge) => count[edge.source]! / (count[edge.source]! + count[edge.target]!));
  const linkStrength = Float64Array.from(links, (edge) => 1 / Math.max(1, Math.min(count[edge.source]!, count[edge.target]!)));

  // The Barnes-Hut quadtree, rebuilt every tick in flat arrays: a cell holds
  // a contiguous range of `order`, its centre of mass and its size.
  const order = new Int32Array(n);
  const cap = Math.max(16, n * 4);
  let cellLo = new Int32Array(cap);
  let cellHi = new Int32Array(cap);
  let cellX = new Float64Array(cap);
  let cellY = new Float64Array(cap);
  let cellSize = new Float64Array(cap);
  let cellChild = new Int32Array(cap * 4);
  let cells = 0;
  const grow = () => {
    const next = cellLo.length * 2;
    const resize = <T extends Int32Array | Float64Array>(from: T, size: number): T => {
      const to = new (from.constructor as { new(length: number): T })(size);
      to.set(from);
      return to;
    };
    cellLo = resize(cellLo, next);
    cellHi = resize(cellHi, next);
    cellX = resize(cellX, next);
    cellY = resize(cellY, next);
    cellSize = resize(cellSize, next);
    cellChild = resize(cellChild, next * 4);
  };
  const partition = (lo: number, hi: number, test: (i: number) => boolean): number => {
    let a = lo;
    let b = hi - 1;
    while (a <= b) {
      if (test(order[a]!)) a += 1;
      else { const tmp = order[a]!; order[a] = order[b]!; order[b] = tmp; b -= 1; }
    }
    return a;
  };
  const build = (lo: number, hi: number, x0: number, y0: number, size: number, depth: number): number => {
    if (cells >= cellLo.length) grow();
    const c = cells++;
    cellLo[c] = lo;
    cellHi[c] = hi;
    cellSize[c] = size;
    let sx = 0;
    let sy = 0;
    for (let k = lo; k < hi; k++) { sx += x[order[k]!]!; sy += y[order[k]!]!; }
    cellX[c] = sx / (hi - lo);
    cellY[c] = sy / (hi - lo);
    cellChild.fill(-1, c * 4, c * 4 + 4);
    if (hi - lo <= 1 || depth > 24 || size < 1e-3) return c;
    const half = size / 2;
    const mx = x0 + half;
    const my = y0 + half;
    const top = partition(lo, hi, (i) => y[i]! < my);
    const left1 = partition(lo, top, (i) => x[i]! < mx);
    const left2 = partition(top, hi, (i) => x[i]! < mx);
    const ranges: Array<[number, number, number, number]> = [
      [lo, left1, x0, y0], [left1, top, mx, y0], [top, left2, x0, my], [left2, hi, mx, my],
    ];
    ranges.forEach(([a, b, qx, qy], q) => {
      if (b > a) cellChild[c * 4 + q] = build(a, b, qx, qy, half, depth + 1);
    });
    return c;
  };
  const stack = new Int32Array(256);

  const sim: Simulation = {
    n, x, y, vx, vy, fx, fy,
    alpha: 1,
    alphaTarget: 0,
    alphaMin: 0.001,
    forces: { ...(options.forces ?? DEFAULT_FORCES) },
    tick() {
      const decay = 1 - Math.pow(this.alphaMin, 1 / 300);
      this.alpha += (this.alphaTarget - this.alpha) * decay;
      const alpha = this.alpha;
      const { center, repel, link, linkDistance } = this.forces;
      // Link force: springs to the link distance, the busier end moves less.
      const distance = Math.max(1, linkDistance * DISTANCE_SCALE);
      if (link > 0) {
        for (let k = 0; k < src.length; k++) {
          const s = src[k]!;
          const t = dst[k]!;
          let dx = x[t]! + vx[t]! - x[s]! - vx[s]!;
          let dy = y[t]! + vy[t]! - y[s]! - vy[s]!;
          if (dx === 0) dx = jiggle();
          if (dy === 0) dy = jiggle();
          let l = Math.sqrt(dx * dx + dy * dy);
          l = ((l - distance) / l) * alpha * link * linkStrength[k]!;
          dx *= l;
          dy *= l;
          const b = bias[k]!;
          vx[t] = vx[t]! - dx * b;
          vy[t] = vy[t]! - dy * b;
          vx[s] = vx[s]! + dx * (1 - b);
          vy[s] = vy[s]! + dy * (1 - b);
        }
      }
      // Repel: every node pushes every other away, far groups as one (Barnes-Hut).
      if (repel > 0 && n > 1) {
        const strength = -repel * REPEL_SCALE;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < n; i++) {
          order[i] = i;
          if (x[i]! < minX) minX = x[i]!;
          if (x[i]! > maxX) maxX = x[i]!;
          if (y[i]! < minY) minY = y[i]!;
          if (y[i]! > maxY) maxY = y[i]!;
        }
        const size = Math.max(maxX - minX, maxY - minY, 1) * 1.0001;
        cells = 0;
        build(0, n, minX, minY, size, 0);
        for (let i = 0; i < n; i++) {
          const xi = x[i]!;
          const yi = y[i]!;
          let ax = 0;
          let ay = 0;
          let top = 0;
          stack[top++] = 0;
          while (top > 0) {
            const c = stack[--top]!;
            const count = cellHi[c]! - cellLo[c]!;
            let dx = cellX[c]! - xi;
            let dy = cellY[c]! - yi;
            let l2 = dx * dx + dy * dy;
            const w = cellSize[c]!;
            const leaf = cellChild[c * 4] === -1 && cellChild[c * 4 + 1] === -1 && cellChild[c * 4 + 2] === -1 && cellChild[c * 4 + 3] === -1;
            if (!leaf && (w * w) / THETA2 < l2) {
              if (l2 < DISTANCE_MAX2) {
                if (l2 < 1) l2 = Math.sqrt(l2);
                const f = (strength * count * alpha) / l2;
                ax += dx * f;
                ay += dy * f;
              }
              continue;
            }
            if (leaf) {
              for (let k = cellLo[c]!; k < cellHi[c]!; k++) {
                const j = order[k]!;
                if (j === i) continue;
                dx = x[j]! - xi;
                dy = y[j]! - yi;
                if (dx === 0) dx = jiggle();
                if (dy === 0) dy = jiggle();
                l2 = dx * dx + dy * dy;
                if (l2 >= DISTANCE_MAX2) continue;
                if (l2 < 1) l2 = Math.sqrt(l2);
                const f = (strength * alpha) / l2;
                ax += dx * f;
                ay += dy * f;
              }
              continue;
            }
            for (let q = 0; q < 4; q++) {
              const child = cellChild[c * 4 + q]!;
              if (child >= 0 && top < stack.length) stack[top++] = child;
            }
          }
          vx[i] = vx[i]! + ax;
          vy[i] = vy[i]! + ay;
        }
      }
      // Centre: a pull to the middle, so islands stay in one picture.
      if (center > 0) {
        const k = center * CENTER_SCALE * alpha;
        for (let i = 0; i < n; i++) {
          vx[i] = vx[i]! - x[i]! * k;
          vy[i] = vy[i]! - y[i]! * k;
        }
      }
      // Move, the velocity decaying (d3's 0.4).
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(fx[i]!)) {
          x[i] = fx[i]!;
          y[i] = fy[i]!;
          vx[i] = 0;
          vy[i] = 0;
          continue;
        }
        vx[i] = vx[i]! * 0.6;
        vy[i] = vy[i]! * 0.6;
        x[i] = x[i]! + vx[i]!;
        y[i] = y[i]! + vy[i]!;
      }
    },
    settled() {
      return this.alpha < this.alphaMin && this.alphaTarget < this.alphaMin;
    },
    reheat(alpha = 0.3) {
      this.alpha = Math.max(this.alpha, alpha);
    },
    pin(i, px, py) {
      fx[i] = px;
      fy[i] = py;
    },
    release(i) {
      fx[i] = Number.NaN;
      fy[i] = Number.NaN;
    },
  };
  return sim;
}

/** Ticks until the simulation rests (or `max`): how long a layout takes. */
export function settle(sim: Simulation, max = 1000): number {
  let ticks = 0;
  while (!sim.settled() && ticks < max) { sim.tick(); ticks += 1; }
  return ticks;
}

// ----------------------------------------------------------------- view

export interface GraphView {
  /** Zoom: screen pixels per world unit. */
  s: number;
  tx: number;
  ty: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

/** The radius of a node, in world units: gentle with its link count. */
export function nodeRadius(degree: number, kind: GraphNodeKind, size = 1): number {
  const base = kind === "tier" ? 7 : kind === "folder" ? 4.5 : kind === "note" ? 4 : 3.2;
  return size * (base + Math.min(12, Math.sqrt(degree) * 1.35));
}

/** How visible the labels are at zoom `s`: Obsidian's text fade, the
 * threshold (-3..3) moving where they come in, one step doubling it. */
export function labelOpacity(s: number, threshold = 0): number {
  const start = 0.55 * Math.pow(2, threshold);
  const end = start * 1.75;
  if (s <= start) return 0;
  if (s >= end) return 1;
  return (Math.log(s) - Math.log(start)) / (Math.log(end) - Math.log(start));
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function boundsOf(sim: Pick<Simulation, "x" | "y" | "n">, only?: (i: number) => boolean): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < sim.n; i++) {
    if (only && !only(i)) continue;
    const xi = sim.x[i]!;
    const yi = sim.y[i]!;
    if (xi < minX) minX = xi;
    if (xi > maxX) maxX = xi;
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** The view that shows `b` in a `w` x `h` canvas. */
export function fitBounds(b: Bounds | null, w: number, h: number, pad = 48, maxZoom = 2): GraphView {
  if (!b) return { s: 1, tx: w / 2, ty: h / 2 };
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const s = Math.max(MIN_ZOOM, Math.min(maxZoom, (w - pad * 2) / bw, (h - pad * 2) / bh));
  return { s, tx: w / 2 - ((b.minX + b.maxX) / 2) * s, ty: h / 2 - ((b.minY + b.maxY) / 2) * s };
}

/** The node under a screen point, the nearest within its radius plus `slack`. */
export function nodeAtPoint(sim: Pick<Simulation, "x" | "y" | "n">, radius: (i: number) => number, v: GraphView, px: number, py: number, slack = 4, visible?: (i: number) => boolean): number {
  const wx = (px - v.tx) / v.s;
  const wy = (py - v.ty) / v.s;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < sim.n; i++) {
    if (visible && !visible(i)) continue;
    const dx = sim.x[i]! - wx;
    const dy = sim.y[i]! - wy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = radius(i) + slack / v.s;
    if (d <= reach && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/** Zoom by `factor` keeping the world point under (px, py) in place. */
export function zoomAround(v: GraphView, px: number, py: number, factor: number): GraphView {
  const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.s * factor));
  const k = s / v.s;
  return { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
}
