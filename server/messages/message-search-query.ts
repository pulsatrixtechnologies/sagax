import { createSecretKey, type KeyObject } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { BlindTokenizer, ContentSealError, bloomHas, deriveSubkey, gramCodesOf, messageAad, openText } from "../encryption/content-crypto.ts";
import { WEBHOOK_AUTHOR } from "../peer-provenance.ts";

/** An unwrapped content key, as the search needs it (content-keys.ts LiveKey). */
export interface OpenKey {
  keyId: string;
  owner: string;
  dek: KeyObject;
  tokenizer(): BlindTokenizer;
}

/** A key as it crosses to the search worker (same process, never disk). */
export interface SealedKeyMaterial {
  keyId: string;
  owner: string;
  raw: Uint8Array;
}

/** Keys rebuilt in the worker, kept across requests: one HKDF per key. */
const rebuilt = new Map<string, OpenKey>();
export function openKeysFrom(material: readonly SealedKeyMaterial[]): OpenKey[] {
  const out: OpenKey[] = [];
  for (const entry of material) {
    let key = rebuilt.get(entry.keyId);
    if (!key) {
      const raw = Buffer.from(entry.raw);
      let tokenizer: BlindTokenizer | null = null;
      key = { keyId: entry.keyId, owner: entry.owner, dek: createSecretKey(raw), tokenizer: () => (tokenizer ??= new BlindTokenizer(deriveSubkey(raw, "sagax content index v1"))) };
      if (rebuilt.size >= 10_000) rebuilt.clear();
      rebuilt.set(entry.keyId, key);
    }
    out.push(key);
  }
  return out;
}

/** The sealed half of a search: keys in scope, and whether plaintext rows
 * may remain (a migration under way, or encryption off). */
export interface SealedSearch {
  keys: readonly OpenKey[];
  plaintext: boolean;
}

export interface SearchHit {
  threadId: string;
  messageId: string;
  at: number;
  role: string;
  kind: string;
  /** the matched text, trimmed to a window around the first hit */
  snippet: string;
  /** where the match sits inside `snippet`, for highlighting */
  matchStart: number;
  matchLength: number;
  /** room messages: which member said it */
  from?: string;
}

/** Shared query and snippet logic; the worker never calls the write-side open(). */
export function searchMessagesInDatabase(database: DatabaseSync, query: string, limit = 40, threadId?: string, sealed?: SealedSearch): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  // escape LIKE wildcards so a literal % or _ in the query stays literal
  const pattern = `%${needle.replace(/([\\%_])/g, "\\$1")}%`;
  // text messages by their text; activity chips by the tool name — "which
  // bot ran that migration" is a tool-name question. The chip's name lives
  // in the row's json; a JSON1 extract keeps this one query.
  // every row sealed: the plaintext scan has nothing left to find
  const plain = sealed && !sealed.plaintext ? [] : plainHits(database, needle, pattern, limit, threadId);
  if (!sealed?.keys.length) return plain;
  const hidden = sealedHits(database, needle, limit, threadId, sealed.keys);
  if (!hidden.length) return plain;
  return [...plain, ...hidden].sort((a, b) => b.at - a.at).slice(0, limit);
}

function plainHits(database: DatabaseSync, needle: string, pattern: string, limit: number, threadId: string | undefined): SearchHit[] {
  const scope = threadId ? "thread_id = ? AND " : "";
  const statement = database.prepare(
    "SELECT thread_id, id, at, role, kind, text, json_extract(json, '$.tool.name') AS tool_name, json_extract(json, '$.from.name') AS from_name, json_extract(json, '$.webhookPost') AS webhook_post FROM messages " +
      `WHERE ${scope}((kind = 'text' AND text IS NOT NULL AND lower(text) LIKE ? ESCAPE '\\') ` +
      "   OR (kind = 'activity' AND tool_name IS NOT NULL AND lower(tool_name) LIKE ? ESCAPE '\\')) " +
      "ORDER BY at DESC LIMIT ?",
  );
  const rows = (threadId
    ? statement.all(threadId, pattern, pattern, limit)
    : statement.all(pattern, pattern, limit)) as Array<{
    thread_id: string;
    id: string;
    at: number;
    role: string;
    kind: string;
    text: string | null;
    tool_name: string | null;
    from_name: string | null;
    webhook_post: number | null;
  }>;
  return rows.map((row) => hitOf(row, row.kind === "activity" ? (row.tool_name ?? "") : (row.text ?? ""), needle));
}

interface HitRow {
  thread_id: string;
  id: string;
  at: number;
  role: string;
  kind: string;
  from_name: string | null;
  webhook_post: number | null;
}

function hitOf(row: HitRow, haystack: string, needle: string): SearchHit {
  const hitAt = Math.max(0, haystack.toLowerCase().indexOf(needle));
  const start = Math.max(0, hitAt - 60);
  const end = Math.min(haystack.length, hitAt + needle.length + 90);
  const head = start > 0 ? "…" : "";
  const body = haystack.slice(start, end).replace(/\s+/g, " ").trim();
  const snippet = head + body + (end < haystack.length ? "…" : "");
  // whitespace folding can shift the offset; find the match again inside
  const folded = needle.replace(/\s+/g, " ");
  const matchStart = snippet.toLowerCase().indexOf(folded);
  return {
    threadId: row.thread_id,
    messageId: row.id,
    at: row.at,
    role: row.role,
    kind: row.kind,
    snippet,
    matchStart: matchStart < 0 ? head.length : matchStart,
    // A defensive fallback must not mark arbitrary snippet text as the hit.
    matchLength: matchStart < 0 ? 0 : folded.length,
    ...(row.webhook_post ? { from: WEBHOOK_AUTHOR } : row.from_name ? { from: row.from_name } : {}),
  };
}

/** Sealed rows: each one's keyed Bloom filter (message_index) narrows them
 * to rows that may hold every three-character window of the needle (a
 * needle under three characters keeps them all); the candidates are opened
 * newest first and the substring confirmed on the text, until `limit`. */
function sealedHits(database: DatabaseSync, needle: string, limit: number, threadId: string | undefined, keys: readonly OpenKey[]): SearchHit[] {
  const byId = new Map(keys.map((key) => [key.keyId, key]));
  const codes = gramCodesOf(needle);
  const hashes = new Map<string, Uint32Array>();
  const candidates: Array<{ rowid: number; at: number }> = [];
  const scan = database.prepare(`SELECT rowid AS rowid, at, key_id, bloom FROM message_index WHERE ${threadId ? "thread_id = ? AND " : ""}bloom IS NOT NULL`);
  for (const row of (threadId ? scan.iterate(threadId) : scan.iterate()) as Iterable<{ rowid: number; at: number; key_id: string; bloom: Uint8Array }>) {
    if (codes.length) {
      let needleHashes = hashes.get(row.key_id);
      if (!needleHashes) {
        const key = byId.get(row.key_id);
        if (!key) continue;
        needleHashes = key.tokenizer().gramHashes(codes);
        hashes.set(row.key_id, needleHashes);
      }
      if (!bloomHas(row.bloom, needleHashes)) continue;
    } else if (!byId.has(row.key_id)) continue;
    candidates.push({ rowid: row.rowid, at: row.at });
  }
  candidates.sort((a, b) => b.at - a.at);
  const read = database.prepare("SELECT m.thread_id, m.id, m.at, m.role, m.kind, m.sealed, m.key_id, json_extract(m.json, '$.from.name') AS from_name, json_extract(m.json, '$.webhookPost') AS webhook_post FROM messages m WHERE m.rowid = ?");
  const out: SearchHit[] = [];
  for (const candidate of candidates) {
    const row = read.get(candidate.rowid) as (HitRow & { sealed: Uint8Array | null; key_id: string | null }) | undefined;
    if (!row?.sealed || !row.key_id || (row.kind !== "text" && row.kind !== "activity")) continue;
    const key = byId.get(row.key_id);
    if (!key) continue;
    let message: { text?: unknown; tool?: { name?: unknown } };
    try { message = JSON.parse(openText(key.dek, row.sealed, messageAad(key.keyId, key.owner, row.thread_id, row.id))) as typeof message; }
    catch (error) { if (error instanceof ContentSealError || error instanceof SyntaxError) continue; throw error; }
    const haystack = row.kind === "activity" ? (typeof message.tool?.name === "string" ? message.tool.name : "") : (typeof message.text === "string" ? message.text : "");
    if (!haystack.toLowerCase().includes(needle)) continue;
    out.push(hitOf(row, haystack, needle));
    if (out.length >= limit) break;
  }
  return out;
}
