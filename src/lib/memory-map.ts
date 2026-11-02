// Graph model for Tools > Memory map view (sources, folders, notes).
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

/** Layout a browse snapshot as a graph: source → folders → notes, plus
 * tag and [[link]] edges between notes. */
export function buildMemoryMapGraph(input: {
  source: MemoryManagerSource;
  browse: MemoryBrowse;
  /** Optional note bodies keyed by note id (for [[links]]). */
  bodies?: Record<string, string>;
}): MemoryMapGraph {
  const { source, browse, bodies = {} } = input;
  const nodes: MemoryMapNode[] = [];
  const edges: MemoryMapEdge[] = [];
  const sourceNodeId = `source:${source.id}`;
  nodes.push({
    id: sourceNodeId,
    kind: "source",
    label: source.name,
    detail: source.detail,
    sourceId: source.id,
    x: 80,
    y: 200,
  });

  const folders = browse.folders.length > 0
    ? browse.folders
    : [...new Set(browse.notes.map((note) => note.folder).filter(Boolean) as string[])].map((name) => ({
      id: name,
      name,
      count: browse.notes.filter((note) => note.folder === name).length,
    }));

  folders.forEach((folder, index) => {
    const id = folderNodeId(source.id, folder.name);
    nodes.push({
      id,
      kind: "folder",
      label: folder.name,
      detail: String(folder.count),
      sourceId: source.id,
      folder: folder.name,
      x: 320,
      y: 80 + index * 120,
    });
    edges.push({
      id: `contains:${sourceNodeId}:${id}`,
      from: sourceNodeId,
      to: id,
      kind: "contains",
    });
  });

  const titleIndex = new Map<string, string>();
  browse.notes.forEach((note, index) => {
    const id = noteNodeId(source.id, note);
    const folderName = note.folder;
    const folderIndex = folderName ? folders.findIndex((folder) => folder.name === folderName) : -1;
    const column = folderIndex >= 0 ? 560 : 560;
    const row = folderIndex >= 0
      ? 60 + folderIndex * 120 + (index % 3) * 36
      : 60 + index * 72;
    nodes.push({
      id,
      kind: "note",
      label: note.title,
      detail: note.excerpt,
      noteId: note.id,
      sourceId: source.id,
      folder: folderName,
      tags: note.tags,
      x: column + (index % 2) * 40,
      y: row,
    });
    titleIndex.set(note.title.trim().toLowerCase(), id);
    if (folderName) {
      const folderId = folderNodeId(source.id, folderName);
      if (nodes.some((node) => node.id === folderId)) {
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

  return { nodes, edges };
}
