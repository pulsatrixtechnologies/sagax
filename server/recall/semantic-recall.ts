// Local vectors beside the FTS5 recall in server/recall/recall.ts. The index is
// server/recall/semantic-index.ts, registered at start (setSemanticIndex) and on
// unless switched off (memory.semanticRecall false in config.json, or
// SAGAX_SEMANTIC_RECALL=0). Nothing here downloads a model: the built-in
// encoder hashes pieces of words, and an embedding endpoint the person
// already runs is used when they set one.
//
// FTS5 passages always come first; a vector passage only takes a free slot.

import type { MemoryDestination } from "../memory/memory-audience.ts";
import type { RecallPassage } from "./recall.ts";


export interface SemanticHit {
  source: "memory" | "conversation";
  /** memory: the file (`memory/<topic>.md`); conversation: the thread id */
  label: string;
  snippet: string;
  /** Higher is closer. The fuse keeps FTS5 order and only appends. */
  score: number;
  at?: number;
  /** conversation: the thread and the author, so the caller names them */
  threadId?: string;
  role?: string;
  from?: string;
  peer?: string;
}

/** What a search may look at: the conversations the caller allows (the
 * same list FTS5 recall gets) and the place the passages will be shown. */
export interface SemanticScope {
  threadIds: readonly string[];
  audience?: MemoryDestination;
}

/** A local vector index. The process registers at most one. */
export interface SemanticIndex {
  ready(botId: string): boolean;
  search(botId: string, query: string, limit: number, scope: SemanticScope): SemanticHit[];
  /** Optional async step before a search (embedding the query). */
  prepare?(botId: string, query: string): Promise<void>;
}

/** How the caller names a conversation passage. */
export interface SemanticNames {
  label: (threadId: string) => string;
  author: (hit: { role: string; from?: string; peer?: string }) => string;
}

let index: SemanticIndex | null = null;

/** Register a local index, or null to remove it. */
export function setSemanticIndex(next: SemanticIndex | null): void {
  index = next;
}

export function semanticIndexReady(botId: string): boolean {
  try {
    return Boolean(index?.ready(botId));
  } catch {
    return false;
  }
}

/** Run the index's async step (embedding the query) before a turn's
 * recall, never longer than `timeoutMs`. Never throws. */
export async function prepareSemanticRecall(botId: string, query: string | null, timeoutMs = 1_500): Promise<void> {
  if (!index?.prepare || !query || !semanticIndexReady(botId)) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      index.prepare(botId, query).catch(() => {}),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); timer.unref?.(); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Vector passages, or none when no local index is ready. A conversation
 * passage outside `scope.threadIds` is dropped whatever the index says. */
export function semanticPassages(botId: string, query: string, limit: number, scope: SemanticScope = { threadIds: [] }, names?: SemanticNames): RecallPassage[] {
  if (!index || limit < 1 || !semanticIndexReady(botId)) return [];
  let hits: SemanticHit[] = [];
  try {
    hits = index.search(botId, query, limit, scope);
  } catch (error) {
    console.warn(`semantic recall failed for ${botId}: ${(error as Error).message}`);
    return [];
  }
  const allowed = new Set(scope.threadIds);
  return hits
    .filter((hit) => hit && (hit.source === "memory" || hit.source === "conversation") && typeof hit.snippet === "string" && hit.snippet.trim() && typeof hit.label === "string")
    .filter((hit) => hit.source === "memory" || (hit.threadId !== undefined && allowed.has(hit.threadId)))
    .slice(0, limit)
    .map((hit) => {
      const at = typeof hit.at === "number" ? { at: hit.at } : {};
      if (hit.source === "memory") return { source: "memory" as const, label: hit.label, snippet: hit.snippet.trim(), ...at };
      const author = names?.author({ role: hit.role ?? "assistant", ...(hit.from ? { from: hit.from } : {}), ...(hit.peer ? { peer: hit.peer } : {}) });
      return {
        source: "conversation" as const,
        label: names ? names.label(hit.threadId!) : hit.label,
        snippet: author ? `${author}: ${hit.snippet.trim()}` : hit.snippet.trim(),
        ...at,
      };
    });
}

/** One memory file, or one conversation message, is said once. */
const fuseKey = (passage: RecallPassage) => passage.source === "memory" ? `memory\n${passage.label}` : `conversation\n${passage.label}\n${passage.at ?? passage.snippet}`;

/** FTS5 passages stay in front. A vector passage is added only when it is
 * new (another memory file, another message) and the cap allows it. */
export function fusePassages(lexical: readonly RecallPassage[], semantic: readonly RecallPassage[], limit: number): RecallPassage[] {
  const out = lexical.slice(0, Math.max(0, limit));
  const seen = new Set(out.map(fuseKey));
  for (const passage of semantic) {
    if (out.length >= limit) break;
    const key = fuseKey(passage);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(passage);
  }
  return out;
}
