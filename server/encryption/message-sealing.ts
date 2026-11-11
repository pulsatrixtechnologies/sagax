// The shape of a sealed message row (docs/content-encryption.md), pure.
//
// A sealed row keeps its columns (thread, id, time, role, kind) and, in its
// json column, a small cleartext projection: only the fields the server's
// own SQL filters on (who wrote it, whether it is a person's send, an open
// approval card, a working goal, the stored file names it points at).
// Everything else, the text and the full message included, is in `sealed`.
import type { WireMessage as Message } from "../../shared/wire.ts";
import { BlindTokenizer, PREFIX_LETTERS, bloomOf, foldWord, gramCodesOf, wordsOf } from "./content-crypto.ts";

/** Stored file names (an opaque id and an extension) a message points at,
 * so threadsReferencing still finds them without opening the row. */
const STORED_NAME = /[A-Za-z0-9-]{16,}\.[a-z0-9]{1,8}(?![A-Za-z0-9])/g;

const flag = (value: unknown): unknown => (value === undefined || value === null ? undefined : typeof value === "object" ? true : value);

/** The projection's version. 2 (#3517) added the open flags of the waiting
 * rows (a question in words, a person's attention card, a proposal card), so
 * the age expiry finds them by a query. A sealed row without `v` predates
 * it: its projection is rewritten once (reprojectSealedRows). */
export const SKELETON_VERSION = 2;

export function skeletonOf(message: Message, full: string): string {
  const out: Record<string, unknown> = { id: message.id, at: message.at, role: message.role, kind: message.kind, sealed: 1, v: SKELETON_VERSION };
  if (typeof message.text === "string") out.hasText = 1;
  if (message.from && typeof message.from === "object") out.from = { name: message.from.name, botId: message.from.botId };
  if (message.peerAsk && typeof message.peerAsk === "object") out.peerAsk = { name: message.peerAsk.name };
  if (message.relayed !== undefined) out.relayed = flag(message.relayed);
  if (message.sendId !== undefined) out.sendId = message.sendId;
  if (message.webhookPost !== undefined) out.webhookPost = message.webhookPost;
  if (message.goalRun && typeof message.goalRun === "object") out.goalRun = { status: (message.goalRun as { status?: unknown }).status };
  if (message.card && typeof message.card === "object") {
    const card = message.card as unknown as Record<string, unknown>;
    out.card = {
      requestType: card.requestType, requestId: card.requestId,
      answered: flag(card.answered), dismissed: flag(card.dismissed), expired: flag(card.expired),
      proactiveProposal: flag(card.proactiveProposal),
    };
  }
  const request = (message as { inputRequest?: unknown }).inputRequest;
  if (request && typeof request === "object") {
    const fields = request as Record<string, unknown>;
    out.inputRequest = { reminder: flag(fields.reminder), answered: flag(fields.answered), expired: flag(fields.expired) };
  }
  const attention = (message as { attention?: unknown }).attention;
  if (attention && typeof attention === "object") {
    out.attention = { handledAt: flag((attention as Record<string, unknown>).handledAt) };
  }
  const refs = [...new Set(full.match(STORED_NAME) ?? [])];
  if (refs.length) out.refs = refs;
  return JSON.stringify(out);
}

/** What the blind index takes from a message: recall words of text and
 * digest rows, substring windows of text rows and of an activity's tool. */
export function indexSourcesOf(message: Message): { recall: string | null; search: string | null; tool: string | null } {
  const text = typeof message.text === "string" ? message.text : null;
  return {
    recall: message.kind === "text" || message.kind === "digest" ? text : null,
    search: message.kind === "text" ? text : null,
    tool: message.kind === "activity" && typeof message.tool?.name === "string" ? message.tool.name : null,
  };
}

/** The blind index of one message under one key: keyed words and
 * four-letter prefixes for the FTS5 table, and a keyed Bloom filter of its
 * three-character windows for the substring search. */
export function indexColumns(tokenizer: BlindTokenizer, sources: { recall: string | null; search: string | null; tool: string | null }): { words: string; prefixes: string; bloom: Uint8Array | null } | null {
  let words = "";
  let prefixes = "";
  if (sources.recall) {
    const list = wordsOf(sources.recall);
    // the repeats stay: FTS5 counts them for bm25
    words = tokenizer.tokens("word", list).join(" ");
    const heads = new Set<string>();
    for (const word of list) if (word.length > PREFIX_LETTERS && /^\p{L}+$/u.test(word)) heads.add(word.slice(0, PREFIX_LETTERS));
    prefixes = tokenizer.tokens("prefix", [...heads]).join(" ");
  }
  const codes: number[] = [];
  if (sources.search) gramCodesOf(sources.search.toLowerCase(), codes);
  if (sources.tool) gramCodesOf(sources.tool.toLowerCase(), codes);
  // every text and activity row gets one, even a text too short for a
  // window: a short needle then still finds it (opened and confirmed)
  const bloom = sources.search !== null || sources.tool !== null ? bloomOf(tokenizer.gramHashes(codes)) : null;
  if (!words && !bloom) return null;
  return { words, prefixes, bloom };
}

/** One recall term, as the plain FTS query reads it: an exact word, or a
 * prefix stem (recallMatchTerm's `"stem"*`). A quoted token of several
 * words (`"v2.1"`) is all of them, a superset of the phrase. */
export type RecallTerm = { words: string[] } | { prefix: string };

export function recallTermsFor(terms: readonly string[], prefix: (term: string) => boolean): RecallTerm[] {
  const out: RecallTerm[] = [];
  for (const term of terms) {
    if (prefix(term)) out.push({ prefix: foldWord(term) });
    else {
      const words = wordsOf(term);
      if (words.length) out.push({ words });
    }
  }
  return out;
}

/** The MATCH expression of a recall over every key in scope: per key, the
 * terms joined by AND ("all") or OR ("any"); the keys joined by OR. */
export function recallMatch(tokenizers: readonly BlindTokenizer[], terms: readonly RecallTerm[], mode: "all" | "any"): string | null {
  if (!terms.length || !tokenizers.length) return null;
  const groups: string[] = [];
  for (const tokenizer of tokenizers) {
    const parts = terms.map((term) => {
      if ("words" in term) return `(${tokenizer.tokens("word", term.words).map((token) => `words : ${token}`).join(" AND ")})`;
      // a stem is the word itself (exact) or any longer word sharing its
      // first letters; the opened text confirms the whole stem (recallHolds)
      return `(words : ${tokenizer.tokens("word", [term.prefix])[0]} OR prefixes : ${tokenizer.tokens("prefix", [term.prefix.slice(0, PREFIX_LETTERS)])[0]})`;
    });
    groups.push(`(${parts.join(mode === "all" ? " AND " : " OR ")})`);
  }
  return groups.join(" OR ");
}

/** Whether an opened text really holds the recall: every term ("all") or
 * one ("any"), a prefix stem as the start of a word. The index matched a
 * superset (four-letter prefixes, words of a quoted phrase in any order). */
export function recallHolds(text: string, terms: readonly RecallTerm[], mode: "all" | "any"): boolean {
  const words = new Set(wordsOf(text));
  const holds = (term: RecallTerm): boolean => {
    if ("words" in term) return term.words.every((word) => words.has(word));
    for (const word of words) if (word.startsWith(term.prefix)) return true;
    return false;
  };
  return mode === "all" ? terms.every(holds) : terms.some(holds);
}

/** FTS5's snippet() for a row the index holds no text of: up to `size`
 * words around the first match, matched words in [brackets], an ellipsis
 * where the text goes on. */
export function blindSnippet(text: string, terms: readonly RecallTerm[], size: number): string {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const term of terms) {
    if ("words" in term) for (const word of term.words) exact.add(word);
    else prefixes.push(term.prefix);
  }
  const hit = (word: string): boolean => {
    const folded = foldWord(word);
    return exact.has(folded) || prefixes.some((stem) => folded.startsWith(stem));
  };
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  if (!tokens.length) return text.slice(0, 240);
  const first = Math.max(0, tokens.findIndex((token) => hit(token[0])));
  const start = Math.max(0, Math.min(first - Math.floor(size / 4), tokens.length - size));
  const end = Math.min(tokens.length, start + size);
  let out = start > 0 ? "…" : "";
  let cursor = tokens[start]!.index;
  for (let i = start; i < end; i++) {
    const token = tokens[i]!;
    out += text.slice(cursor, token.index);
    out += hit(token[0]) ? `[${token[0]}]` : token[0];
    cursor = token.index + token[0].length;
  }
  if (end < tokens.length) out += "…";
  return out;
}
