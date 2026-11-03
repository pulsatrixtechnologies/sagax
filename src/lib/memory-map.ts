// Graph model for Tools > Memory map view (sources, folders, notes).
// Layout mirrors Team map language: deterministic layered clusters, fixed card
// size, GAP spacing, no overlapping rectangles, edges attach at card borders.
import type { MemoryBrowse, MemoryManagerSource, MemoryNoteRow } from "./memory-manager";

export type MemoryMapNodeKind = "source" | "folder" | "note";

export interface MemoryMapNode {
  id: string;
  kind: MemoryMapNodeKind;
  label: string;
  detail?: string;
  /** Note row id when kind is note (for open). */
  noteId?: string;
  sourceId: string;
  folder?: string;
  tags?: string[];
  x: number;
  y: number;
}

export type MemoryMapEdgeKind = "contains" | "link" | "tag" | "folder";

export interface MemoryMapEdge {
  id: string;
  from: string;
  to: string;
  kind: MemoryMapEdgeKind;
}

export interface MemoryMapGraph {
  nodes: MemoryMapNode[];
  edges: MemoryMapEdge[];
}

export interface MemoryMapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Card size and spacing aligned with Team map GAP language. */
export const MEMORY_NODE_WIDTH = 168;
export const MEMORY_NODE_HEIGHT = 56;
export const MEMORY_NODE_GAP = 16;
export const MEMORY_CLUSTER_GAP = 40;
export const MEMORY_COLUMN_GAP = 56;
export const MEMORY_ORIGIN_X = 40;
export const MEMORY_ORIGIN_Y = 40;

/** Wiki-style [[Note title]] targets from a markdown body. */
export function extractWikiLinks(body: string): string[] {
  const found = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const title = match[1]?.trim();
    if (title) found.add(title.toLowerCase());
  }
  return [...found];
}

function noteNodeId(sourceId: string, note: MemoryNoteRow): string {
  return `note:${sourceId}:${note.id}`;
}

function folderNodeId(sourceId: string, folder: string): string {
  return `folder:${sourceId}:${folder}`;
}

export function memoryNodeRect(node: Pick<MemoryMapNode, "x" | "y">): MemoryMapRect {
  return {
    x: node.x,
    y: node.y,
    width: MEMORY_NODE_WIDTH,
    height: MEMORY_NODE_HEIGHT,
  };
}

/** Axis-aligned rectangle intersection with optional minimum gap (padding). */
export function memoryRectsIntersect(a: MemoryMapRect, b: MemoryMapRect, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x
    || b.x + b.width + gap <= a.x
    || a.y + a.height + gap <= b.y
    || b.y + b.height + gap <= a.y
  );
}

/** True when every pair of node cards keeps at least `gap` clear space. */
export function memoryMapNodesOverlap(nodes: Array<Pick<MemoryMapNode, "x" | "y">>, gap = MEMORY_NODE_GAP): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const a = memoryNodeRect(nodes[i]!);
    for (let j = i + 1; j < nodes.length; j++) {
      if (memoryRectsIntersect(a, memoryNodeRect(nodes[j]!), gap)) return true;
    }
  }
  return false;
}

/**
 * Edge attachment on the card border facing the other node (not through the
 * card center). Keeps strokes between borders once cards do not overlap.
 */
export function memoryEdgeEndpoints(
  from: Pick<MemoryMapNode, "x" | "y">,
  to: Pick<MemoryMapNode, "x" | "y">,
  width = MEMORY_NODE_WIDTH,
  height = MEMORY_NODE_HEIGHT,
): { x1: number; y1: number; x2: number; y2: number } {
  const hw = width / 2;
  const hh = height / 2;
  const fromCx = from.x + hw;
  const fromCy = from.y + hh;
  const toCx = to.x + hw;
  const toCy = to.y + hh;
  const borderPoint = (cx: number, cy: number, towardX: number, towardY: number) => {
    const dx = towardX - cx;
    const dy = towardY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scaleX = Math.abs(dx) < 1e-9 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx);
    const scaleY = Math.abs(dy) < 1e-9 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy);
    const t = Math.min(scaleX, scaleY);
    return { x: cx + dx * t, y: cy + dy * t };
  };
  const start = borderPoint(fromCx, fromCy, toCx, toCy);
  const end = borderPoint(toCx, toCy, fromCx, fromCy);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

function notesPerRow(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

/**
 * Deterministic layered layout: source column, then one cluster per folder
 * (and an unfiled cluster). Notes grid inside each cluster with Team-like GAP.
 * A final sweep nudges any residual collision down (should be a no-op when
 * grid math is correct; keeps denser fixtures safe).
 */
export function layoutMemoryMapNodes(nodes: MemoryMapNode[]): MemoryMapNode[] {
  if (nodes.length === 0) return [];
  const source = nodes.find((node) => node.kind === "source");
  const folders = nodes.filter((node) => node.kind === "folder");
  const notes = nodes.filter((node) => node.kind === "note");
  const placed: MemoryMapNode[] = [];

  if (source) {
    placed.push({ ...source, x: MEMORY_ORIGIN_X, y: MEMORY_ORIGIN_Y });
  }

  const folderNames = folders.map((folder) => folder.folder ?? folder.label);
  const clusters: Array<{ key: string; folder?: MemoryMapNode; notes: MemoryMapNode[] }> = folders.map((folder) => ({
    key: folder.folder ?? folder.label,
    folder,
    notes: notes.filter((note) => note.folder === (folder.folder ?? folder.label)),
  }));
  const unfiled = notes.filter((note) => !note.folder || !folderNames.includes(note.folder));
  if (unfiled.length > 0 || folders.length === 0) {
    clusters.push({ key: "", notes: unfiled.length > 0 ? unfiled : notes.filter((note) => !note.folder) });
  }

  const sourceRight = MEMORY_ORIGIN_X + MEMORY_NODE_WIDTH + MEMORY_COLUMN_GAP;
  let clusterY = MEMORY_ORIGIN_Y;

  for (const cluster of clusters) {
    let cursorX = sourceRight;
    let cursorY = clusterY;
    let clusterBottom = clusterY;

    if (cluster.folder) {
      placed.push({ ...cluster.folder, x: cursorX, y: cursorY });
      clusterBottom = Math.max(clusterBottom, cursorY + MEMORY_NODE_HEIGHT);
      cursorX += MEMORY_NODE_WIDTH + MEMORY_COLUMN_GAP;
    }

    const grid = notesPerRow(cluster.notes.length);
    cluster.notes.forEach((note, index) => {
      const col = index % grid;
      const row = Math.floor(index / grid);
      const x = cursorX + col * (MEMORY_NODE_WIDTH + MEMORY_NODE_GAP);
      const y = cursorY + row * (MEMORY_NODE_HEIGHT + MEMORY_NODE_GAP);
      placed.push({ ...note, x, y });
      clusterBottom = Math.max(clusterBottom, y + MEMORY_NODE_HEIGHT);
    });

    clusterY = clusterBottom + MEMORY_CLUSTER_GAP;
  }

  // Residual collision resolve: push later cards down until clear of earlier ones.
  for (let i = 0; i < placed.length; i++) {
    const node = placed[i]!;
    let guard = 0;
    while (guard++ < 200) {
      let hit: MemoryMapRect | null = null;
      const rect = memoryNodeRect(node);
      for (let j = 0; j < i; j++) {
        const other = memoryNodeRect(placed[j]!);
        if (memoryRectsIntersect(rect, other, MEMORY_NODE_GAP)) {
          hit = other;
          break;
        }
      }
      if (!hit) break;
      node.y = hit.y + hit.height + MEMORY_NODE_GAP;
    }
  }

  return placed;
}

/** Layout a browse snapshot as a graph: source → folders → notes, plus
 * tag and [[link]] edges between notes. */
export function buildMemoryMapGraph(input: {
  source: MemoryManagerSource;
  browse: MemoryBrowse;
  /** Optional note bodies keyed by note id (for [[links]]). */
  bodies?: Record<string, string>;
}): MemoryMapGraph {
  const { source, browse, bodies = {} } = input;
  const draft: MemoryMapNode[] = [];
  const edges: MemoryMapEdge[] = [];
  const sourceNodeId = `source:${source.id}`;
  draft.push({
    id: sourceNodeId,
    kind: "source",
    label: source.name,
    detail: source.detail,
    sourceId: source.id,
    x: 0,
    y: 0,
  });

  const folders = browse.folders.length > 0
    ? browse.folders
    : [...new Set(browse.notes.map((note) => note.folder).filter(Boolean) as string[])].map((name) => ({
      id: name,
      name,
      count: browse.notes.filter((note) => note.folder === name).length,
    }));

  folders.forEach((folder) => {
    const id = folderNodeId(source.id, folder.name);
    draft.push({
      id,
      kind: "folder",
      label: folder.name,
      detail: String(folder.count),
      sourceId: source.id,
      folder: folder.name,
      x: 0,
      y: 0,
    });
    edges.push({
      id: `contains:${sourceNodeId}:${id}`,
      from: sourceNodeId,
      to: id,
      kind: "contains",
    });
  });

  const titleIndex = new Map<string, string>();
  browse.notes.forEach((note) => {
    const id = noteNodeId(source.id, note);
    const folderName = note.folder;
    draft.push({
      id,
      kind: "note",
      label: note.title,
      detail: note.excerpt,
      noteId: note.id,
      sourceId: source.id,
      folder: folderName,
      tags: note.tags,
      x: 0,
      y: 0,
    });
    titleIndex.set(note.title.trim().toLowerCase(), id);
    if (folderName) {
      const folderId = folderNodeId(source.id, folderName);
      if (draft.some((node) => node.id === folderId)) {
        edges.push({
          id: `contains:${folderId}:${id}`,
          from: folderId,
          to: id,
          kind: "contains",
        });
      }
    } else {
      edges.push({
        id: `contains:${sourceNodeId}:${id}`,
        from: sourceNodeId,
        to: id,
        kind: "contains",
      });
    }
  });

  // Same-folder edges between notes (skip when a folder node already groups them).
  const byFolder = new Map<string, string[]>();
  for (const note of browse.notes) {
    if (!note.folder) continue;
    const id = noteNodeId(source.id, note);
    const list = byFolder.get(note.folder) ?? [];
    list.push(id);
    byFolder.set(note.folder, list);
  }
  for (const [folder, ids] of byFolder) {
    if (ids.length < 2 || folders.some((entry) => entry.name === folder)) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      edges.push({
        id: `folder:${ids[i]}:${ids[i + 1]}`,
        from: ids[i]!,
        to: ids[i + 1]!,
        kind: "folder",
      });
    }
  }

  // Shared tags.
  const byTag = new Map<string, string[]>();
  for (const note of browse.notes) {
    for (const tag of note.tags ?? []) {
      const key = tag.trim().toLowerCase();
      if (!key) continue;
      const id = noteNodeId(source.id, note);
      const list = byTag.get(key) ?? [];
      list.push(id);
      byTag.set(key, list);
    }
  }
  for (const [tag, ids] of byTag) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      edges.push({
        id: `tag:${tag}:${ids[i]}:${ids[i + 1]}`,
        from: ids[i]!,
        to: ids[i + 1]!,
        kind: "tag",
      });
    }
  }

  // [[wiki links]] from known bodies.
  for (const note of browse.notes) {
    const body = bodies[note.id];
    if (!body) continue;
    const from = noteNodeId(source.id, note);
    for (const target of extractWikiLinks(body)) {
      const to = titleIndex.get(target);
      if (!to || to === from) continue;
      edges.push({
        id: `link:${from}:${to}`,
        from,
        to,
        kind: "link",
      });
    }
  }

  return { nodes: layoutMemoryMapNodes(draft), edges };
}

/** One tier of the page's map: its name and its notes (ids are the page's row keys). */
export interface MemoryMapGroup {
  key: string;
  name: string;
  notes: MemoryNoteRow[];
}

const GROUP_GAP = 120;

/** The page's whole map: one layered cluster per tier (tier → folders →
 * notes), the clusters side by side, plus the [[links]] between notes of
 * any tier. Note ids are the page's row keys. */
export function buildMemoryPageGraph(groups: MemoryMapGroup[], bodies: Record<string, string> = {}): MemoryMapGraph {
  const nodes: MemoryMapNode[] = [];
  const edges: MemoryMapEdge[] = [];
  let offsetX = 0;
  for (const group of groups) {
    if (group.notes.length === 0) continue;
    const counts = new Map<string, number>();
    for (const note of group.notes) if (note.folder) counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1);
    const source: MemoryManagerSource = { id: group.key, kind: "perspicax", name: group.name, mayWrite: false };
    const graph = buildMemoryMapGraph({
      source,
      browse: { folders: [...counts].map(([name, count]) => ({ id: name, name, count })), notes: group.notes, mayWrite: false },
      bodies: {},
    });
    let maxX = 0;
    for (const node of graph.nodes) {
      nodes.push({ ...node, x: node.x + offsetX });
      maxX = Math.max(maxX, node.x + MEMORY_NODE_WIDTH);
    }
    edges.push(...graph.edges);
    offsetX += maxX + GROUP_GAP;
  }
  // [[links]] across the whole map, by title.
  const byTitle = new Map<string, string>();
  const nodeOfNote = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== "note" || !node.noteId) continue;
    byTitle.set(node.label.trim().toLowerCase(), node.id);
    nodeOfNote.set(node.noteId, node.id);
  }
  const seen = new Set<string>();
  for (const [noteId, body] of Object.entries(bodies)) {
    const from = nodeOfNote.get(noteId);
    if (!from) continue;
    for (const target of extractWikiLinks(body)) {
      const to = byTitle.get(target);
      if (!to || to === from) continue;
      const id = `link:${from}:${to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, from, to, kind: "link" });
    }
  }
  return { nodes, edges };
}
