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
  /** Bot source: false when no current bot owns this memory (a temporary agent's). */
  linked?: boolean;
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
  /** Team memory: "proposed" waits for a review. */
  status?: string;
  /** When the note was first written (Perspicax `created`, a bot's journal). */
  createdAt?: number;
  /** Who wrote it last, as a name (never an identifier). */
  author?: string;
  /** How many readable notes it links to or is linked from (Perspicax). */
  links?: number;
  /** Manual rank inside its folder (Perspicax). */
  rank?: number | null;
  /** An archived Perspicax note (the Archived list). */
  archived?: boolean;
}

export interface MemoryFolderRow {
  id: string;
  name: string;
  count: number;
}

/** One Perspicax tier (personal, a team, the organization) with its folders. */
export interface MemoryTierRow {
  scope: string;
  kind: string;
  name: string;
  count: number;
  trashed: number;
  mayWrite: boolean;
  mayManage: boolean;
  folders: MemoryFolderRow[];
  /** Its archived notes. */
  archived?: number;
  /** Proposals waiting for a review in this tier. */
  pending?: number;
  /** How an edit lands: "direct" or "review". */
  editMode?: string;
}

export interface MemoryBrowse {
  folders: MemoryFolderRow[];
  notes: MemoryNoteRow[];
  trashCount?: number;
  mayWrite: boolean;
  mayManage?: boolean;
  /** Perspicax only: the tiers this browse read, each with its folders. */
  tiers?: MemoryTierRow[];
  /** Team memory: each note's whole text, by note id (the listing carries it). */
  bodies?: Record<string, string>;
  /** A bot's MEMORY.md, in bytes (0: empty). */
  indexBytes?: number;
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
  /** Perspicax properties, when the server sends them. */
  author?: string;
  createdAt?: number;
  updatedAt?: number;
  provenance?: Array<{ kind: string; reference: string }>;
  /** Where the note came from (Perspicax `source`: humain, bot, import…). */
  origin?: string;
  versions?: number | null;
  editMode?: string;
  sealed?: boolean;
  linksOut?: MemoryNoteLink[];
  backlinks?: MemoryNoteLink[];
}

/** A link between two notes (Perspicax `links_out` and `backlinks`). */
export interface MemoryNoteLink {
  scope?: string;
  id: string;
  title: string;
  /** The citing line around the link (backlinks only). */
  context?: string | null;
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
  return { folders, notes, mayWrite: true, indexBytes: overview.index?.bytes ?? 0 };
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

/** A whole bot memory folder emptied (a folder no bot is linked to): its
 * topics and logs deleted and its MEMORY.md cleared (it cannot be deleted),
 * each one a journal row the Trash and Undo put back. */
export async function emptyBotFolder(botId: string, paths: string[], clearIndex: boolean) {
  const { undoIds } = await deleteBotNotes(botId, paths);
  if (clearIndex) {
    await saveMemoryDoc(botId, MEMORY_INDEX, "", undefined);
    const journal = await fetchMemoryJournal(botId, 10);
    const cleared = journal.find((row) => row.path === MEMORY_INDEX && row.canRevert);
    if (cleared) undoIds.push(cleared.id);
  }
  return { undoIds, count: paths.length + (clearIndex ? 1 : 0) };
}

export function restoreBotChange(botId: string, changeId: string) {
  return revertMemoryChange(botId, changeId);
}

export interface TeamEntry {
  id: string;
  kind: string;
  name: string;
  detail: string;
  status: string;
  updatedAt: number;
  source?: { botName?: string; at?: number };
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
    createdAt: entry.source?.at,
    author: entry.source?.botName || undefined,
    status: entry.status,
  }));
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.folder || "term", (counts.get(note.folder || "term") ?? 0) + 1);
  return {
    folders: [...counts.entries()].map(([id, count]) => ({ id, name: id, count })),
    notes,
    mayWrite: true,
    bodies: Object.fromEntries(result.entries.map((entry) => [entry.id, entry.detail])),
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
    author: entry.source?.botName || undefined,
    createdAt: entry.source?.at,
    updatedAt: entry.updatedAt,
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
      archived?: number;
      edit_mode?: string;
      pending?: unknown[];
      topics: Array<{
        topic: string;
        count: number;
        entries: Array<{ id: string; title: string; topic: string; tags: string[]; updated?: string; created?: string; excerpt?: string; author_name?: string | null; links?: number; rank?: number | null }>;
      }>;
    }>;
  }>("/tree");
  const notes: MemoryNoteRow[] = [];
  const folders: MemoryFolderRow[] = [];
  let mayWrite = false;
  let mayManage = false;
  let trashCount = 0;
  const tiers: MemoryTierRow[] = [];
  for (const tier of tree.tiers) {
    if (scope && tier.scope !== scope && !(scope === "me" && tier.kind === "me")) continue;
    mayWrite = mayWrite || tier.may_write;
    mayManage = mayManage || Boolean(tier.may_manage);
    trashCount += tier.trashed ?? 0;
    const tierFolders = tier.topics.map((topic) => ({ id: `${tier.scope}/${topic.topic}`, name: topic.topic, count: topic.count }));
    tiers.push({
      scope: tier.scope,
      kind: tier.kind,
      name: tier.name,
      count: tier.topics.reduce((sum, topic) => sum + topic.count, 0),
      trashed: tier.trashed ?? 0,
      mayWrite: tier.may_write,
      mayManage: Boolean(tier.may_manage),
      folders: tierFolders,
      archived: tier.archived ?? 0,
      pending: Array.isArray(tier.pending) ? tier.pending.length : 0,
      editMode: tier.edit_mode,
    });
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
          createdAt: entry.created ? Date.parse(entry.created) : undefined,
          author: entry.author_name || undefined,
          links: entry.links,
          rank: entry.rank,
        });
      }
    }
  }
  return { folders, notes, trashCount, mayWrite, mayManage, tiers };
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
    author_name?: string | null;
    created?: string;
    updated?: string;
    provenance?: Array<{ kind: string; reference: string }>;
    source?: string;
    versions?: number | null;
    edit_mode?: string;
    links_out?: Array<{ scope: string; id: string; title: string; context?: string | null }>;
    backlinks?: Array<{ scope: string; id: string; title: string; context?: string | null }>;
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
    author: note.author_name || undefined,
    createdAt: note.created ? Date.parse(note.created) : undefined,
    updatedAt: note.updated ? Date.parse(note.updated) : undefined,
    provenance: note.provenance,
    origin: note.source,
    versions: note.versions,
    editMode: note.edit_mode,
    sealed: note.sealed,
    linksOut: note.links_out?.map((link) => ({ scope: link.scope, id: link.id, title: link.title })),
    backlinks: note.backlinks?.map((link) => ({ scope: link.scope, id: link.id, title: link.title, context: link.context })),
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

/** An archived Perspicax note (`GET /archived`). */
export interface ArchivedNoteRow {
  scope: string;
  id: string;
  title: string;
  topic: string;
  tags: string[];
  archived_at?: string;
  author_name?: string | null;
  may_restore?: boolean;
}

export async function fetchPerspicaxArchived(): Promise<MemoryNoteRow[]> {
  const result = await pxMemory<{ notes?: ArchivedNoteRow[] }>("/archived");
  return (result.notes ?? []).map((note) => ({
    id: note.id,
    title: note.title,
    folder: note.topic,
    tags: note.tags ?? [],
    scope: note.scope,
    author: note.author_name || undefined,
    updatedAt: note.archived_at ? Date.parse(note.archived_at) : undefined,
    archived: true,
  }));
}

/** The tag vocabulary of the organization (`GET /tags`): its namespaces and their values. */
export interface MemoryVocabulary {
  namespaces: Array<{ id: string; label_fr?: string; label_en?: string; controlled?: boolean; required?: boolean; tags: Array<{ tag: string; label?: string }> }>;
}

export function fetchPerspicaxVocabulary(): Promise<MemoryVocabulary> {
  return pxMemory<MemoryVocabulary>("/tags");
}
