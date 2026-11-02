// Client helpers for Tools > Memory (main-column page, 2026-11-02).
import { api } from "@/state/store";
import {
  deleteMemoryDoc,
  fetchMemoryDoc,
  fetchMemoryJournal,
  fetchMemoryOverview,
  revertMemoryChange,
  saveMemoryDoc,
  MEMORY_INDEX,
  type MemoryDoc,
  type MemoryOverview,
} from "@/lib/memory";

export type MemorySourceKind = "bot" | "team" | "perspicax";

export interface MemoryManagerSource {
  id: string;
  kind: MemorySourceKind;
  name: string;
  detail?: string;
  mayWrite: boolean;
  mayManage?: boolean;
  botId?: string;
  section?: string;
  scope?: string;
}

export interface MemoryManagerSourcesResponse {
  sources: MemoryManagerSource[];
  perspicax: { available: boolean; reason?: "link" | "sign_in" | "solo" };
}

export interface MemoryNoteRow {
  id: string;
  title: string;
  folder?: string;
  tags?: string[];
  updatedAt?: number;
  excerpt?: string;
  /** Local bot path (MEMORY.md or memory/topic.md). */
  path?: string;
  /** Team memory kind. */
  kind?: string;
  scope?: string;
}

export interface MemoryFolderRow {
  id: string;
  name: string;
  count: number;
}

export interface MemoryBrowse {
  folders: MemoryFolderRow[];
  notes: MemoryNoteRow[];
  trashCount?: number;
  mayWrite: boolean;
  mayManage?: boolean;
}

export interface MemoryNoteDetail {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folder?: string;
  scope?: string;
  path?: string;
  hash?: string;
  version?: number;
  mayEdit: boolean;
  /** Whole-file JSON or markdown with ```json blocks for the folding tree. */
  bodyKind: "markdown" | "json";
}

export function fetchMemoryManagerSources(): Promise<MemoryManagerSourcesResponse> {
  return api("/api/memory-manager/sources");
}

export function pxMemory<T>(path: string, init?: RequestInit): Promise<T> {
  return api(`/api/me/memory${path}`, init);
}

/** Detect a whole-document JSON note (trimmed text parses as object/array). */
export function detectBodyKind(text: string): "markdown" | "json" {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return "markdown";
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" ? "json" : "markdown";
  } catch {
    return "markdown";
  }
}

/** Split markdown into text and ```json fences for the read view. */
export function splitJsonFences(text: string): Array<{ kind: "text" | "json"; value: string }> {
  const parts: Array<{ kind: "text" | "json"; value: string }> = [];
  const re = /```json\s*\n([\s\S]*?)```/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ kind: "text", value: text.slice(last, match.index) });
    parts.push({ kind: "json", value: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts.length ? parts : [{ kind: "text", value: text }];
}

export async function browseBotSource(botId: string): Promise<MemoryBrowse> {
  const overview: MemoryOverview = await fetchMemoryOverview(botId);
  const notes: MemoryNoteRow[] = [
    {
      id: MEMORY_INDEX,
      title: MEMORY_INDEX,
      path: MEMORY_INDEX,
      folder: undefined,
      updatedAt: undefined,
      excerpt: undefined,
    },
    ...overview.topics.map((topic) => ({
      id: topic.path,
      title: topic.name.replace(/\.md$/i, ""),
      path: topic.path,
      folder: "topics",
      updatedAt: topic.modifiedAt,
    })),
    ...overview.logs.map((log) => ({
      id: log.path,
      title: log.name.replace(/\.md$/i, ""),
      path: log.path,
      folder: "logs",
      updatedAt: log.modifiedAt,
    })),
  ];
  const folders: MemoryFolderRow[] = [
    { id: "topics", name: "Topics", count: overview.topics.length },
    { id: "logs", name: "Logs", count: overview.logs.length },
  ].filter((folder) => folder.count > 0);
  return { folders, notes, mayWrite: true };
}

export async function openBotNote(botId: string, path: string): Promise<MemoryNoteDetail> {
  const doc: MemoryDoc = await fetchMemoryDoc(botId, path);
  return {
    id: path,
    title: path === MEMORY_INDEX ? MEMORY_INDEX : path.split("/").pop()?.replace(/\.md$/i, "") || path,
    body: doc.text,
    tags: [],
    path,
    hash: doc.hash,
    mayEdit: true,
    bodyKind: detectBodyKind(doc.text),
  };
}

export async function saveBotNote(botId: string, path: string, text: string, expectedHash?: string) {
  return saveMemoryDoc(botId, path, text, expectedHash);
}

export async function deleteBotNotes(botId: string, paths: string[]) {
  const deleted: string[] = [];
  for (const path of paths) {
    await deleteMemoryDoc(botId, path);
    deleted.push(path);
  }
  // Journal rows for undo: latest deletes for these paths.
  const journal = await fetchMemoryJournal(botId, 40);
  const undoIds = deleted.map((path) => journal.find((row) => row.path === path && row.kind === "deleted" && row.canRevert)?.id).filter(Boolean) as string[];
  return { deleted, undoIds };
}

export async function undoBotDeletes(botId: string, undoIds: string[]) {
  for (const id of undoIds) await revertMemoryChange(botId, id);
}

export interface TeamEntry {
  id: string;
  kind: string;
  name: string;
  detail: string;
  status: string;
  updatedAt: number;
}

export async function browseTeamSource(section: string): Promise<MemoryBrowse> {
  const result: { entries: TeamEntry[] } = await api(`/api/team-memory?section=${encodeURIComponent(section)}`);
  const notes: MemoryNoteRow[] = result.entries.map((entry) => ({
    id: entry.id,
    title: entry.name,
    folder: entry.kind,
    kind: entry.kind,
    excerpt: entry.detail.slice(0, 160),
    updatedAt: entry.updatedAt,
  }));
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.folder || "term", (counts.get(note.folder || "term") ?? 0) + 1);
  return {
    folders: [...counts.entries()].map(([id, count]) => ({ id, name: id, count })),
    notes,
    mayWrite: true,
  };
}

export async function openTeamNote(section: string, id: string): Promise<MemoryNoteDetail | null> {
  const result: { entries: TeamEntry[] } = await api(`/api/team-memory?section=${encodeURIComponent(section)}`);
  const entry = result.entries.find((row) => row.id === id);
  if (!entry) return null;
  return {
    id: entry.id,
    title: entry.name,
    body: entry.detail,
    tags: [],
    folder: entry.kind,
    mayEdit: true,
    bodyKind: "markdown",
  };
}

export async function browsePerspicax(folder?: string, scope?: string): Promise<MemoryBrowse> {
  const tree = await pxMemory<{
    tiers: Array<{
      scope: string;
      kind: string;
      name: string;
      may_write: boolean;
      may_manage?: boolean;
      trashed?: number;
      topics: Array<{ topic: string; count: number; entries: Array<{ id: string; title: string; topic: string; tags: string[]; updated?: string; excerpt?: string }> }>;
    }>;
  }>("/tree");
  const notes: MemoryNoteRow[] = [];
  const folders: MemoryFolderRow[] = [];
  let mayWrite = false;
  let mayManage = false;
  let trashCount = 0;
  for (const tier of tree.tiers) {
    if (scope && tier.scope !== scope && !(scope === "me" && tier.kind === "me")) continue;
    mayWrite = mayWrite || tier.may_write;
    mayManage = mayManage || Boolean(tier.may_manage);
    trashCount += tier.trashed ?? 0;
    for (const topic of tier.topics) {
      folders.push({ id: `${tier.scope}/${topic.topic}`, name: topic.topic, count: topic.count });
      for (const entry of topic.entries) {
        if (folder && entry.topic !== folder && `${tier.scope}/${entry.topic}` !== folder) continue;
        notes.push({
          id: entry.id,
          title: entry.title,
          folder: entry.topic,
          tags: entry.tags,
          scope: tier.scope,
          excerpt: entry.excerpt,
          updatedAt: entry.updated ? Date.parse(entry.updated) : undefined,
        });
      }
    }
  }
  return { folders, notes, trashCount, mayWrite, mayManage };
}

export async function openPerspicaxNote(scope: string, id: string): Promise<MemoryNoteDetail> {
  const note = await pxMemory<{
    id: string;
    title: string;
    body: string;
    tags: string[];
    topic: string;
    scope: string;
    version?: number;
    may_edit?: boolean;
    sealed?: boolean;
  }>(`/entry?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`);
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    tags: note.tags ?? [],
    folder: note.topic,
    scope: note.scope,
    version: note.version,
    mayEdit: note.may_edit !== false && !note.sealed,
    bodyKind: detectBodyKind(note.body),
  };
}

export function filterNotes(notes: MemoryNoteRow[], query: string): MemoryNoteRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((note) => {
    const hay = [note.title, note.excerpt, note.folder, ...(note.tags ?? [])].filter(Boolean).join("\n").toLowerCase();
    return hay.includes(q);
  });
}
