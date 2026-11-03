// Provient de Perspicax, PTI (Pulsatrix Technologies Inc.); published in Sagax under Apache-2.0 with PTI's approval (JC, 2026-11-03).
// The memory map read as a brain (Mémoire > Notes > Carte, 2026-10-19,
// JC: « comme un vrai cerveau », something one leaves open on a second
// screen). The pure half of `pages/memory/brain-map.tsx`, held by
// `scripts/memory-brain.test.mjs`: the radial layout (the scope in view at
// the centre, the tiers then the topics in concentric rings, the notes as
// small leaves on the outer ring), how recent each branch is, the search
// spotlight (it lights the matches and dims the rest, it never filters),
// the label plan (no two labels over each other), the culling of what lies
// off screen, and (lot 7d, 2026-10-30) the timeline that replays the memory
// week by week, the tag filter that dims the notes without the chosen tags
// and the per-tier counts of the legend. Plain logic, relative imports only, so `node --test`
// runs it as it is.

// Ported from the Perspicax console (console/src/lib/memory-brain.ts,
// 1.9.20) for Tools > Memory > Map (2026-11-02, JC: the Memory page "presque
// identique" to Perspicax). The layout, labels, spotlight, timeline and veil
// are the console's as they are; the tree it reads is the page's
// (`pageTree`, at the end), every tier and folder of every Sagax source.

import type { PageRow, PageTier } from "./memory-page";
import { extractWikiLinks } from "./memory-map";

/** Case and accents folded for the search. */
export function foldSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function noteKey(scope: string, id: string): string {
  return `${scope}/${id}`;
}

export function stableIndex(text: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}

export type TierKind = "me" | "org" | "team";

export function tierKind(scope: string, own: string): TierKind {
  if (scope === own || scope.startsWith("user:")) return "me";
  return scope === "org" || scope === "perspicax:org" ? "org" : "team";
}

export interface NoteEntry {
  id: string;
  title: string;
  topic: string;
  tags: string[];
  updated: string;
  created?: string;
  excerpt?: string;
  author_name?: string | null;
}

export interface NoteTier {
  scope: string;
  kind: string;
  name: string;
  topics: Array<{ topic: string; count: number; entries: NoteEntry[] }>;
}

export interface NotesTree {
  own: string;
  tiers: NoteTier[];
}

export interface GraphData {
  edges: Array<{ a: string; b: string; kind?: string }>;
}

// ---- what the server answers on top of the tree ---------------------------

/** One item waiting for a review (`GET /api/v1/memory/read/tree`, per tier). */
export interface PendingRef {
  review_id: string;
  /** `new` (a note not yet in the tier) or `edit` (a change of `edit_of`). */
  kind: "new" | "edit" | string;
  topic: string;
  title: string;
  edit_of?: string | null;
  risky: boolean;
  mine: boolean;
  created: string;
}

/** A tier as the map reads it: `pending` is absent on an older server. */
export type BrainTier = NoteTier & { pending?: PendingRef[] };

// ---- the model -------------------------------------------------------------

export type BrainKind = "root" | "tier" | "topic" | "note";

export interface BrainNode {
  /** Stable key: `root`, `tier:<scope>`, `topic:<scope>/<topic>`, `<scope>/<id>`
   *  for a note, `pending:<review id>` for a new note under review. Never shown. */
  key: string;
  kind: BrainKind;
  parent: number;
  depth: number;
  /** What the map writes beside the node (never an id). */
  label: string;
  scope: string;
  tier: TierKind | "all";
  topic: string;
  /** A note's id; empty otherwise. */
  id: string;
  excerpt: string;
  author: string;
  updated: string;
  /** When the note was first written (a branch: its oldest note); the
   *  timeline hides what did not exist yet. Empty without a date. */
  created: string;
  tags: string[];
  /** 1 for today, falling to 0 at 30 days and beyond. */
  recency: number;
  /** Days since the last change (Infinity without a date). */
  age: number;
  /** Notes under it (1 for a note). */
  count: number;
  /** A change or a new note waits for a review. */
  pending: boolean;
  /** The waiting item is flagged by the risk score. */
  risky: boolean;
  /** A new note that only exists as a review item. */
  proposal: boolean;
  /** Polar and cartesian place, in world units. */
  angle: number;
  radius: number;
  x: number;
  y: number;
}

export interface Brain {
  nodes: BrainNode[];
  /** Children of each node, by index. */
  children: number[][];
  /** Wikilinks between notes on the map, as index pairs. */
  links: [number, number][];
  index: Map<string, number>;
  /** The radius of each ring by depth. */
  rings: number[];
  /** The scope at the centre, or `all`. */
  focus: string;
  /** Notes and proposals on the map. */
  notes: number;
}

export const DAY_MS = 86_400_000;
/** Past this many days a branch is drawn faded (still reachable). */
export const STALE_DAYS = 30;
/** The arc between two leaves on the outer ring, in world units. */
export const LEAF_SPACING = 15;

/** 1 for a change today, 0 at `STALE_DAYS` and beyond, eased so the last
 *  week stands out. */
export function recencyOf(updated: string, now: number): { recency: number; age: number } {
  const t = Date.parse(updated);
  if (!updated || Number.isNaN(t)) return { recency: 0, age: Infinity };
  const age = Math.max(0, (now - t) / DAY_MS);
  if (age >= STALE_DAYS) return { recency: 0, age };
  const r = 1 - age / STALE_DAYS;
  return { recency: r * r, age };
}

/** Whether a node is past the stale line. */
export const isStale = (n: Pick<BrainNode, "age">) => n.age >= STALE_DAYS;

export interface BuildOptions {
  own: string;
  /** `all`, or one tier's scope to put at the centre. */
  focus: string;
  /** Labels the map writes: the root for `all`, a title left empty, a tier. */
  names: { all: string; untitled: string; tier: (t: BrainTier) => string };
  now?: number;
}

function blank(key: string, kind: BrainKind, parent: number, depth: number): BrainNode {
  return {
    key,
    kind,
    parent,
    depth,
    label: "",
    scope: "",
    tier: "all",
    topic: "",
    id: "",
    excerpt: "",
    author: "",
    updated: "",
    created: "",
    tags: [],
    recency: 0,
    age: Infinity,
    count: 0,
    pending: false,
    risky: false,
    proposal: false,
    angle: 0,
    radius: 0,
    x: 0,
    y: 0,
  };
}

/** The tree as a radial brain: the root, (for `all`) one branch per tier,
 *  one per topic, one leaf per note; the new notes under review as leaves
 *  of their topic; the wikilinks of `graph` between the leaves on the map. */
export function buildBrain(tree: NotesTree, graph: GraphData | null | undefined, opts: BuildOptions): Brain {
  const now = opts.now ?? Date.now();
  const tiers = (tree.tiers as BrainTier[]).filter((t) => opts.focus === "all" || t.scope === opts.focus);
  const nodes: BrainNode[] = [];
  const children: number[][] = [];
  const add = (n: BrainNode) => {
    nodes.push(n);
    children.push([]);
    if (n.parent >= 0) children[n.parent].push(nodes.length - 1);
    return nodes.length - 1;
  };
  const root = blank("root", "root", -1, 0);
  if (opts.focus === "all") root.label = opts.names.all;
  else if (tiers[0]) {
    root.label = opts.names.tier(tiers[0]);
    root.scope = tiers[0].scope;
    root.tier = tierKind(tiers[0].scope, opts.own);
  }
  add(root);
  for (const tier of tiers) {
    const kind = tierKind(tier.scope, opts.own);
    let parent = 0;
    if (opts.focus === "all") {
      const t = blank(`tier:${tier.scope}`, "tier", 0, 1);
      t.label = opts.names.tier(tier);
      t.scope = tier.scope;
      t.tier = kind;
      parent = add(t);
    }
    const pending = tier.pending ?? [];
    const edits = new Map<string, PendingRef>();
    for (const p of pending) if (p.kind === "edit" && p.edit_of) edits.set(p.edit_of, p);
    const topics = new Map<string, { entries: NoteTier["topics"][number]["entries"]; proposals: PendingRef[] }>();
    for (const t of tier.topics) topics.set(t.topic, { entries: t.entries, proposals: [] });
    for (const p of pending) {
      if (p.kind === "edit" && p.edit_of) continue;
      const slot = topics.get(p.topic) ?? { entries: [], proposals: [] };
      slot.proposals.push(p);
      topics.set(p.topic, slot);
    }
    for (const topic of [...topics.keys()].sort((a, b) => a.localeCompare(b))) {
      const slot = topics.get(topic)!;
      const tp = blank(`topic:${tier.scope}/${topic}`, "topic", parent, nodes[parent].depth + 1);
      tp.label = topic;
      tp.scope = tier.scope;
      tp.tier = kind;
      tp.topic = topic;
      const ti = add(tp);
      for (const e of slot.entries) {
        const n = blank(noteKey(tier.scope, e.id), "note", ti, tp.depth + 1);
        n.label = e.title?.trim() || opts.names.untitled;
        n.scope = tier.scope;
        n.tier = kind;
        n.topic = topic;
        n.id = e.id;
        n.excerpt = e.excerpt ?? "";
        n.author = e.author_name ?? "";
        n.updated = e.updated;
        // An older server sends no `created`: the last change stands in.
        n.created = e.created || e.updated;
        n.tags = e.tags ?? [];
        Object.assign(n, recencyOf(e.updated, now));
        const edit = edits.get(e.id);
        if (edit) {
          n.pending = true;
          n.risky = edit.risky;
        }
        add(n);
      }
      for (const p of slot.proposals) {
        const n = blank(`pending:${p.review_id}`, "note", ti, tp.depth + 1);
        n.label = p.title?.trim() || opts.names.untitled;
        n.scope = tier.scope;
        n.tier = kind;
        n.topic = topic;
        n.updated = p.created;
        n.created = p.created;
        Object.assign(n, recencyOf(p.created, now));
        n.pending = true;
        n.proposal = true;
        n.risky = p.risky;
        add(n);
      }
    }
  }
  // Counts, recency and the waiting flags rise to the branches.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.kind === "note") n.count = 1;
    if (n.parent >= 0) {
      const p = nodes[n.parent];
      p.count += n.count;
      if (n.recency > p.recency) p.recency = n.recency;
      if (n.age < p.age) p.age = n.age;
      if (n.updated > p.updated) p.updated = n.updated;
      if (n.created && (!p.created || n.created < p.created)) p.created = n.created;
      p.risky ||= n.risky;
    }
  }
  const index = new Map(nodes.map((n, i) => [n.key, i]));
  const links: [number, number][] = [];
  for (const e of graph?.edges ?? []) {
    if (e.kind === "tag") continue;
    const a = index.get(e.a);
    const b = index.get(e.b);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  const brain: Brain = { nodes, children, links, index, rings: [], focus: opts.focus, notes: nodes.filter((n) => n.kind === "note").length };
  layoutBrain(brain);
  return brain;
}

// ---- the radial layout -----------------------------------------------------

/** Each subtree gets an arc in proportion to its leaves (an empty branch
 *  counts as one), with a gap between siblings that grows toward the
 *  centre; each depth sits on its own ring, the outer ring wide enough for
 *  every leaf to keep `LEAF_SPACING` of arc. */
export function layoutBrain(brain: Brain): void {
  const { nodes, children } = brain;
  const weight = Array.from<number>({ length: nodes.length }).fill(0);
  for (let i = nodes.length - 1; i >= 0; i--) {
    weight[i] = children[i].length ? children[i].reduce((s, c) => s + weight[c], 0) : 1;
  }
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const leaves = Math.max(1, weight[0]);
  // The arc a leaf takes, the gaps between branches left aside.
  const gapShare = 0.16;
  const outer = Math.max(160 * Math.max(1, maxDepth), (leaves * LEAF_SPACING) / (2 * Math.PI * (1 - gapShare)));
  const rings = [0];
  for (let d = 1; d <= maxDepth; d++) {
    // The inner rings close to the centre, the leaves far out: a cortex.
    const f = d === maxDepth ? 1 : maxDepth === 2 ? 0.45 : 0.26 + (0.4 * (d - 1)) / Math.max(1, maxDepth - 2);
    rings.push(Math.max(d * 110, outer * f));
  }
  brain.rings = rings;
  const place = (i: number, from: number, to: number) => {
    const n = nodes[i];
    n.angle = (from + to) / 2;
    n.radius = rings[n.depth] ?? 0;
    n.x = Math.cos(n.angle) * n.radius;
    n.y = Math.sin(n.angle) * n.radius;
    const kids = children[i];
    if (!kids.length) return;
    const span = to - from;
    // Gaps between the branches at this level: a share of the span, less
    // at the leaves so a topic reads as one cluster.
    const share = kids.length > 1 ? (nodes[kids[0]].kind === "note" ? 0.04 : n.depth === 0 ? gapShare : 0.1) : 0;
    const gap = (span * share) / kids.length;
    const total = kids.reduce((s, c) => s + weight[c], 0) || 1;
    let at = from + gap / 2;
    for (const c of kids) {
      const w = ((span - gap * kids.length) * weight[c]) / total;
      place(c, at, at + w);
      at += w + gap;
    }
  };
  // The first branch starts at the top, as a clock reads.
  place(0, -Math.PI / 2, (3 * Math.PI) / 2);
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function brainBounds(brain: Brain): Bounds {
  const r = (brain.rings[brain.rings.length - 1] ?? 0) + 120;
  return { minX: -r, minY: -r, maxX: r, maxY: r };
}

// ---- the view --------------------------------------------------------------

export interface View {
  /** World to screen: sx = x * s + tx. */
  s: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export const toScreen = (v: View, x: number, y: number) => ({ x: x * v.s + v.tx, y: y * v.s + v.ty });

/** The view that fits the whole brain in a `w` by `h` box. */
export function fitView(brain: Brain, w: number, h: number, pad = 24): View {
  const b = brainBounds(brain);
  const s = Math.max(0.04, Math.min(2.2, Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY))));
  return { s, tx: w / 2, ty: h / 2, w, h };
}

/** The world rectangle the screen shows, widened by `margin` screen pixels. */
export function worldRect(v: View, margin = 40): Bounds {
  return {
    minX: (-margin - v.tx) / v.s,
    minY: (-margin - v.ty) / v.s,
    maxX: (v.w + margin - v.tx) / v.s,
    maxY: (v.h + margin - v.ty) / v.s,
  };
}

/** The nodes the screen shows (virtualisation: nothing else is drawn). */
export function visibleNodes(brain: Brain, v: View, margin = 40): number[] {
  const r = worldRect(v, margin);
  const out: number[] = [];
  brain.nodes.forEach((n, i) => {
    if (n.x >= r.minX && n.x <= r.maxX && n.y >= r.minY && n.y <= r.maxY) out.push(i);
  });
  return out;
}

/** Whether the edge from a branch to a child can cross the screen: the
 *  box of its curve (both ends and the mid ring) against the view. */
export function edgeVisible(brain: Brain, child: number, r: Bounds): boolean {
  const c = brain.nodes[child];
  const p = brain.nodes[c.parent];
  if (!p) return false;
  const mid = (p.radius + c.radius) / 2;
  const xs = [p.x, c.x, Math.cos(p.angle) * mid, Math.cos(c.angle) * mid];
  const ys = [p.y, c.y, Math.sin(p.angle) * mid, Math.sin(c.angle) * mid];
  return Math.max(...xs) >= r.minX && Math.min(...xs) <= r.maxX && Math.max(...ys) >= r.minY && Math.min(...ys) <= r.maxY;
}

// ---- the search spotlight --------------------------------------------------

export interface Spotlight {
  /** The nodes the search names. */
  hits: Set<number>;
  /** Their branches up to the root, half lit so the path reads. */
  path: Set<number>;
}

/** The nodes a search names (title, excerpt, topic, tags, folded for case
 *  and accents) and the branches leading to them; `null` without a query.
 *  The map keeps every node: the rest is dimmed, never removed. */
export function spotlight(brain: Brain, query: string): Spotlight | null {
  const q = foldSearch(query.trim());
  if (!q) return null;
  const hits = new Set<number>();
  const path = new Set<number>();
  brain.nodes.forEach((n, i) => {
    if (n.kind === "root") return;
    const text = n.kind === "note" ? [n.label, n.excerpt, n.topic, ...n.tags] : [n.label];
    if (text.some((x) => foldSearch(x).includes(q))) hits.add(i);
  });
  for (const i of hits) {
    let p = brain.nodes[i].parent;
    while (p >= 0 && !path.has(p)) {
      path.add(p);
      p = brain.nodes[p].parent;
    }
  }
  return { hits, path };
}

// ---- the timeline, the tag filter, the legend's counts --------------------

export const WEEK_MS = 7 * DAY_MS;
/** The timeline never has more stops than this: past it, a stop spans
 *  several weeks (ten years of memory still slide in one gesture). */
export const TIMELINE_MAX_STOPS = 260;

const timeOf = (iso: string) => {
  const t = Date.parse(iso);
  return iso && !Number.isNaN(t) ? t : NaN;
};

/** The stops of the timeline, in milliseconds: the first note's date, then
 *  a week later each time, the last stop `now` (today). One stop (today)
 *  for a memory without dated notes. */
export function timelineOf(brain: Brain, now = Date.now()): number[] {
  let first = Infinity;
  for (const n of brain.nodes) {
    if (n.kind !== "note") continue;
    const t = timeOf(n.created);
    if (t < first) first = t;
  }
  if (!Number.isFinite(first) || first >= now) return [now];
  const step = WEEK_MS * Math.max(1, Math.ceil((now - first) / WEEK_MS / (TIMELINE_MAX_STOPS - 1)));
  const stops: number[] = [];
  for (let t = first; t < now; t += step) stops.push(t);
  stops.push(now);
  return stops;
}

/** Whether a note existed at `at` (a note without a date always did). */
export function existedAt(n: Pick<BrainNode, "created">, at: number): boolean {
  const t = timeOf(n.created);
  return Number.isNaN(t) || t <= at;
}

/** The notes on the map that existed at `at`. */
export function notesAt(brain: Brain, at: number): number {
  let k = 0;
  for (const n of brain.nodes) if (n.kind === "note" && existedAt(n, at)) k++;
  return k;
}

/** Every tag the map's notes wear, with how many notes wear it, by name. */
export function tagsOf(brain: Brain): { tag: string; count: number }[] {
  const out = new Map<string, number>();
  for (const n of brain.nodes) if (n.kind === "note") for (const t of n.tags) out.set(t, (out.get(t) ?? 0) + 1);
  return [...out].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** What the timeline and the tag filter do to the map. */
export interface Veil {
  /** Not written yet at the chosen date: not drawn, not reachable. A branch
   *  whose every note is hidden is hidden with them. */
  hidden: Set<number>;
  /** Without any of the chosen tags: dimmed like the spotlight dims, never
   *  removed. A branch with no matching note is dimmed with them. */
  dimmed: Set<number>;
  /** Notes on the map at that date. */
  notes: number;
  /** Notes wearing one of the chosen tags at that date (`notes` without a tag filter). */
  matches: number;
}

/** The veil of a date (`null`: today, everything) and a set of tags (empty:
 *  all tags); `null` when neither is set. */
export function veilOf(brain: Brain, opt: { at?: number | null; tags?: readonly string[] }): Veil | null {
  const at = opt.at ?? null;
  const tags = new Set(opt.tags ?? []);
  if (at === null && !tags.size) return null;
  const { nodes, children } = brain;
  const hidden = new Set<number>();
  const dimmed = new Set<number>();
  // Per node: notes shown under it, notes matching under it.
  const shown = Array.from<number>({ length: nodes.length }).fill(0);
  const match = Array.from<number>({ length: nodes.length }).fill(0);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.kind === "note") {
      if (at !== null && !existedAt(n, at)) {
        hidden.add(i);
        continue;
      }
      shown[i] = 1;
      match[i] = !tags.size || n.tags.some((t) => tags.has(t)) ? 1 : 0;
      if (!match[i]) dimmed.add(i);
      continue;
    }
    for (const c of children[i]) {
      shown[i] += shown[c];
      match[i] += match[c];
    }
    if (n.kind === "root") continue;
    // An empty branch (no note at all) stays as it is.
    const any = children[i].length > 0 || n.count > 0;
    if (any && !shown[i]) hidden.add(i);
    else if (tags.size && !match[i]) dimmed.add(i);
  }
  return { hidden, dimmed, notes: shown[0] ?? 0, matches: match[0] ?? 0 };
}

/** The legend's counts: the notes of each tier (the new ones under review
 *  included, as the map draws them) and the items waiting for a review
 *  over every tier. */
export function tierCounts(tree: NotesTree): { tiers: Map<string, number>; review: number } {
  const tiers = new Map<string, number>();
  let review = 0;
  for (const tier of tree.tiers as BrainTier[]) {
    const pending = tier.pending ?? [];
    const proposals = pending.filter((p) => !(p.kind === "edit" && p.edit_of)).length;
    tiers.set(tier.scope, tier.topics.reduce((s, t) => s + t.entries.length, 0) + proposals);
    review += pending.length;
  }
  return { tiers, review };
}

// ---- recency drawn ---------------------------------------------------------

/** How an edge into a node is drawn: thick and bright when recent, thin and
 *  grey past `STALE_DAYS` (still drawn, so still reachable). */
export function edgeStyle(n: Pick<BrainNode, "recency" | "age" | "kind">): { width: number; alpha: number; tinted: boolean } {
  if (isStale(n)) return { width: n.kind === "note" ? 0.7 : 1, alpha: 0.32, tinted: false };
  const base = n.kind === "note" ? 0.9 : n.kind === "topic" ? 1.6 : 2.4;
  return { width: base + n.recency * (n.kind === "note" ? 1.8 : 2.6), alpha: 0.45 + 0.5 * n.recency, tinted: true };
}

/** A node's size on screen (pixels), before the hover unfold. */
export function nodeSize(n: Pick<BrainNode, "kind" | "count">, s: number): number {
  const z = Math.min(1.6, Math.max(0.55, Math.sqrt(s)));
  if (n.kind === "root") return 15 * z + 4;
  if (n.kind === "tier") return (7 + Math.min(5, Math.sqrt(n.count))) * z;
  if (n.kind === "topic") return (3.5 + Math.min(4, Math.sqrt(n.count) * 0.8)) * z;
  return 2.6 * z;
}

// ---- the label plan --------------------------------------------------------

/** A label on screen: an oriented box (centre, half sizes, angle). */
export interface LabelBox {
  node: number;
  text: string;
  /** Where the text starts (screen), its angle and alignment. */
  x: number;
  y: number;
  angle: number;
  align: "left" | "right" | "center";
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export interface LabelOptions {
  /** Text width in pixels at `size` (the canvas's measureText). */
  measure: (text: string, size: number) => number;
  /** Nodes that must keep a label (hovered, matched, open) first. */
  priority?: number[];
  /** Only these nodes (the spotlight hits) among the notes, when set. */
  only?: Set<number> | null;
  visible?: number[];
}

export const LABEL_SIZE = { root: 14, tier: 13, topic: 12, note: 11 } as const;
/** A note's label shows once two leaves are this many pixels apart. */
export const LEAF_LABEL_MIN_GAP = 11;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function boxOf(node: number, text: string, x: number, y: number, angle: number, align: LabelBox["align"], w: number, h: number): LabelBox {
  // The box's centre: from the start point along the angle.
  const dir = align === "left" ? 1 : align === "right" ? -1 : 0;
  const cx = x + Math.cos(angle) * (dir * w) / 2;
  const cy = y + Math.sin(angle) * (dir * w) / 2;
  return { node, text, x, y, angle, align, cx, cy, hw: w / 2, hh: h / 2 };
}

function corners(b: LabelBox): [number, number][] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  return [
    [-b.hw, -b.hh],
    [b.hw, -b.hh],
    [b.hw, b.hh],
    [-b.hw, b.hh],
  ].map(([u, v]) => [b.cx + u * c - v * s, b.cy + u * s + v * c] as [number, number]);
}

/** The area two oriented boxes share, as a share of the smaller (0 when
 *  apart): the separating axis test, then a sampled overlap. */
export function overlapShare(a: LabelBox, b: LabelBox): number {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  const ra = Math.hypot(a.hw, a.hh);
  const rb = Math.hypot(b.hw, b.hh);
  if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) return 0;
  const ca = corners(a);
  const cb = corners(b);
  for (const box of [a, b]) {
    for (const ang of [box.angle, box.angle + Math.PI / 2]) {
      const ax = Math.cos(ang);
      const ay = Math.sin(ang);
      const pa = ca.map(([x, y]) => x * ax + y * ay);
      const pb = cb.map(([x, y]) => x * ax + y * ay);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return 0;
    }
  }
  // They touch: sample the smaller box on a grid and count points inside the other.
  const [small, big] = a.hw * a.hh <= b.hw * b.hh ? [a, b] : [b, a];
  const inside = (b2: LabelBox, x: number, y: number) => {
    const c = Math.cos(-b2.angle);
    const s = Math.sin(-b2.angle);
    const u = (x - b2.cx) * c - (y - b2.cy) * s;
    const v = (x - b2.cx) * s + (y - b2.cy) * c;
    return Math.abs(u) <= b2.hw && Math.abs(v) <= b2.hh;
  };
  const c = Math.cos(small.angle);
  const s = Math.sin(small.angle);
  let hit = 0;
  const N = 8;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const u = -small.hw + ((i + 0.5) * 2 * small.hw) / N;
      const v = -small.hh + ((j + 0.5) * 2 * small.hh) / N;
      if (inside(big, small.cx + u * c - v * s, small.cy + u * s + v * c)) hit++;
    }
  }
  return hit / (N * N);
}

/** Which labels the screen shows, never one over another (beyond a sliver
 *  of a few percent): the forced ones first (hover, matches, the open
 *  note), the root, the tiers and topics, then the notes, written along
 *  their ray once leaves are far enough apart, flipped on the left half so
 *  nothing reads upside down. */
export function planLabels(brain: Brain, v: View, opt: LabelOptions): LabelBox[] {
  const vis = opt.visible ?? visibleNodes(brain, v, 80);
  const placed: LabelBox[] = [];
  // A coarse grid of the placed boxes, so each test reads its neighbours only.
  const cell = 64;
  const grid = new Map<string, number[]>();
  const keysOf = (b: LabelBox) => {
    const r = Math.hypot(b.hw, b.hh);
    const out: string[] = [];
    for (let gx = Math.floor((b.cx - r) / cell); gx <= Math.floor((b.cx + r) / cell); gx++)
      for (let gy = Math.floor((b.cy - r) / cell); gy <= Math.floor((b.cy + r) / cell); gy++) out.push(`${gx},${gy}`);
    return out;
  };
  const clashes = (b: LabelBox) => {
    const seen = new Set<number>();
    for (const k of keysOf(b))
      for (const i of grid.get(k) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (overlapShare(b, placed[i]) > 0.02) return true;
      }
    return false;
  };
  const keep = (b: LabelBox) => {
    placed.push(b);
    for (const k of keysOf(b)) {
      const l = grid.get(k);
      if (l) l.push(placed.length - 1);
      else grid.set(k, [placed.length - 1]);
    }
  };
  const done = new Set<number>();
  // The leaves' gap on screen decides whether notes get their label.
  const outer = brain.rings[brain.rings.length - 1] ?? 0;
  const leafCount = Math.max(1, brain.notes);
  const leafGap = ((2 * Math.PI * outer) / leafCount) * 0.84 * v.s;
  const label = (i: number, forced: boolean) => {
    if (done.has(i)) return;
    const n = brain.nodes[i];
    const p = toScreen(v, n.x, n.y);
    const r = nodeSize(n, v.s);
    let b: LabelBox;
    if (n.kind === "note") {
      if (!forced && (leafGap < LEAF_LABEL_MIN_GAP || (opt.only && !opt.only.has(i)))) return;
      const size = LABEL_SIZE.note;
      const text = cut(n.label, 34);
      const w = opt.measure(text, size);
      const left = Math.cos(n.angle) < 0;
      const angle = left ? n.angle + Math.PI : n.angle;
      const sx = p.x + Math.cos(n.angle) * (r + 5);
      const sy = p.y + Math.sin(n.angle) * (r + 5);
      b = boxOf(i, text, sx, sy, angle, left ? "right" : "left", w, size + 2);
    } else {
      const size = n.kind === "root" ? LABEL_SIZE.root : n.kind === "tier" ? LABEL_SIZE.tier : LABEL_SIZE.topic;
      const text = cut(n.label, n.kind === "topic" ? 28 : 36);
      const w = opt.measure(text, size) + 12;
      const h = size + 8;
      if (n.kind === "root") b = boxOf(i, text, p.x, p.y + r + 6 + h / 2, 0, "center", w, h);
      else {
        // Beside the node, toward the outside of its ring.
        const ox = Math.cos(n.angle) * (r + 4 + w / 2) * 0.9;
        const oy = Math.sin(n.angle) * (r + 4 + h / 2);
        b = boxOf(i, text, p.x + ox, p.y + oy, 0, "center", w, h);
      }
    }
    if (!forced && (b.cx + b.hw < -40 || b.cx - b.hw > v.w + 40 || b.cy + b.hh < -40 || b.cy - b.hh > v.h + 40)) return;
    if (clashes(b)) return;
    done.add(i);
    keep(b);
  };
  for (const i of opt.priority ?? []) if (i >= 0 && i < brain.nodes.length) label(i, true);
  const byKind = (k: BrainKind) => vis.filter((i) => brain.nodes[i].kind === k);
  for (const k of ["root", "tier", "topic"] as BrainKind[]) {
    // Bigger branches first.
    for (const i of byKind(k).sort((a, b) => brain.nodes[b].count - brain.nodes[a].count)) label(i, false);
  }
  for (const i of byKind("note").sort((a, b) => brain.nodes[b].recency - brain.nodes[a].recency)) label(i, false);
  return placed;
}

// ---- hit testing -----------------------------------------------------------

/** The node under a screen point (the nearest within its size and some
 *  slack), or -1. */
export function nodeAt(brain: Brain, v: View, x: number, y: number, slack = 6): number {
  let best = -1;
  let bestD = Infinity;
  const wx = (x - v.tx) / v.s;
  const wy = (y - v.ty) / v.s;
  const reach = (40 + slack) / v.s;
  brain.nodes.forEach((n, i) => {
    if (Math.abs(n.x - wx) > reach || Math.abs(n.y - wy) > reach) return;
    const p = toScreen(v, n.x, n.y);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= nodeSize(n, v.s) + slack && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** A note's real wikilink neighborhood, both directions, with the note at
 * the center and only its first/second degree neighbors on the rings. */
export function neighborhoodBrain(brain: Brain, key: string, depth: number): Brain {
  const center = brain.index.get(key);
  if (center === undefined) return brain;
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of brain.links) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  const levels = new Map([[center, 0]]);
  let front = [center];
  for (let d = 1; d <= Math.min(2, depth); d++) {
    const next: number[] = [];
    for (const from of front) for (const to of adjacency.get(from) ?? []) {
      if (!levels.has(to)) { levels.set(to, d); next.push(to); }
    }
    front = next;
  }
  const order = [...levels.keys()];
  const remap = new Map(order.map((old, i) => [old, i]));
  const nodes = order.map((old) => {
    const d = levels.get(old)!;
    const ring = order.filter((i) => levels.get(i) === d);
    const angle = -Math.PI / 2 + ring.indexOf(old) * 2 * Math.PI / ring.length;
    const radius = d * 220;
    return { ...brain.nodes[old], parent: -1, depth: d, angle, radius, x: d ? Math.cos(angle) * radius : 0, y: d ? Math.sin(angle) * radius : 0 };
  });
  return { ...brain, nodes, children: nodes.map(() => []), links: brain.links.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a)!, remap.get(b)!]), index: new Map(nodes.map((n, i) => [n.key, i])), notes: nodes.length, rings: Array.from({ length: Math.max(...levels.values()) + 1 }, (_, d) => d * 220) };
}

// ---- Sagax: the page's rows as the console's tree --------------------------


const isoOf = (at: number | undefined) => (at == null || Number.isNaN(at) ? "" : new Date(at).toISOString());

/** The page's tiers as the console's tree: each tier its folders, each note
 * keyed by its page row (a note node's `id` is the row key). */
export function pageTree(rows: PageRow[], tiers: PageTier[]): NotesTree {
  return {
    own: "mine",
    tiers: tiers.map((tier) => {
      const topics = new Map<string, NoteEntry[]>();
      for (const entry of rows) {
        if (entry.tier !== tier.key) continue;
        const topic = entry.folderPath || tier.name;
        const list = topics.get(topic) ?? [];
        list.push({
          id: entry.key,
          title: entry.row.title,
          topic,
          tags: entry.row.tags ?? [],
          updated: isoOf(entry.row.updatedAt),
          created: isoOf(entry.row.createdAt),
          excerpt: entry.row.excerpt,
          author_name: entry.row.author,
        });
        topics.set(topic, list);
      }
      return { scope: tier.key, kind: tier.kind === "mine" ? "me" : tier.kind, name: tier.name, topics: [...topics].map(([topic, entries]) => ({ topic, count: entries.length, entries })) };
    }),
  };
}

/** The [[links]] between the page's notes, by title, as the console's graph edges. */
export function pageGraph(rows: PageRow[], bodies: Record<string, string>): GraphData {
  const byTitle = new Map<string, PageRow>();
  for (const entry of rows) byTitle.set(entry.row.title.trim().toLowerCase(), entry);
  const edges: GraphData["edges"] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const body = bodies[entry.key];
    if (!body) continue;
    for (const target of extractWikiLinks(body)) {
      const hit = byTitle.get(target);
      if (!hit || hit.key === entry.key) continue;
      const a = noteKey(entry.tier, entry.key);
      const b = noteKey(hit.tier, hit.key);
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ a, b, kind: "link" });
    }
  }
  return { edges };
}