// Text to vectors for the local semantic recall (server/recall/semantic-index.ts).
//
// The built-in encoder needs no model and no download: it hashes words,
// word pairs and the 3- and 4-letter pieces of every word into a fixed
// number of slots, then normalises. Two texts that share pieces of words
// land close together, so a typo ("dentst"), another ending ("allergie",
// "allergique") or a split word still meets the note it means. It does
// not know that two unrelated words mean the same thing; an embedding
// model does, and the person may point Sagax at one they already run
// (any OpenAI-compatible /v1/embeddings: Ollama, LM Studio, a local MLX
// server). When that endpoint is absent or fails, the built-in vectors
// are used alone.

import { createHash } from "node:crypto";

/** Slots of a built-in vector. */
export const HASHED_DIM = 512;

/** A built-in hit needs at least this cosine. Unrelated short texts in the
 * same language share a few letter pieces and sit well below it. */
export const HASHED_MIN_SCORE = 0.17;
/** An embedding hit needs at least this cosine (typical local embedding
 * models put related sentences above it, unrelated ones below). */
export const EMBEDDING_MIN_SCORE = 0.5;

// Words that carry no meaning of their own, English and French.
const STOP = new Set((
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my no not of on or our so " +
  "than that the their them then there these they this to too up us was we were what when where which who why will with would you your " +
  "please thanks thank hi hello hey ok okay yes again just also about any some all like " +
  "au aux avec ce ces cet cette dans de des du elle en est et eux il ils je la le les leur lui ma mais me mes moi mon ne nos notre nous " +
  "ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y est-ce quoi quand comment merci bonjour salut"
).split(" "));

/** Lower case, accents off. */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** The content words of a text, folded. */
export function contentWords(text: string): string[] {
  const words = foldText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => word.length > 1 && !STOP.has(word));
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function add(vector: Float32Array, feature: string, weight: number): void {
  const hash = fnv1a(feature);
  // the top bit picks the sign, so collisions cancel out instead of piling up
  vector[hash % HASHED_DIM]! += hash & 0x80000000 ? -weight : weight;
}

function normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < vector.length; i += 1) vector[i]! /= norm;
  return vector;
}

/** The built-in vector of a text, unit length (all zeros for a text with
 * no content word). */
export function hashedVector(text: string): Float32Array {
  const vector = new Float32Array(HASHED_DIM);
  const words = contentWords(text);
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  for (const [word, count] of counts) {
    // a word said three times is not three times the topic
    const weight = 1 + Math.log(count);
    add(vector, `w:${word}`, weight);
    if (!/^\p{L}{3,}$/u.test(word)) continue;
    const padded = `<${word}>`;
    const pieces: string[] = [];
    for (const size of [3, 4]) {
      for (let i = 0; i + size <= padded.length; i += 1) pieces.push(padded.slice(i, i + size));
    }
    // the pieces of one word weigh as much together as the word itself
    const share = (weight * 1.2) / Math.sqrt(pieces.length);
    for (const piece of pieces) add(vector, `g:${piece}`, share);
  }
  for (let i = 0; i + 1 < words.length; i += 1) add(vector, `b:${words[i]} ${words[i + 1]}`, 0.5);
  return normalise(vector);
}

/** Dot product of two unit vectors: their cosine. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

/** A vector kept in one byte a slot: the slot over the largest slot. */
export interface QuantizedVector {
  scale: number;
  values: Int8Array;
}

export function quantize(vector: Float32Array): QuantizedVector {
  let max = 0;
  for (const value of vector) max = Math.max(max, Math.abs(value));
  const values = new Int8Array(vector.length);
  if (max === 0) return { scale: 0, values };
  for (let i = 0; i < vector.length; i += 1) values[i] = Math.round((vector[i]! / max) * 127);
  return { scale: max / 127, values };
}

/** Cosine of a unit query and a stored vector. */
export function quantizedCosine(query: Float32Array, stored: QuantizedVector): number {
  if (!stored.scale || query.length !== stored.values.length) return 0;
  return cosine(query, stored.values) * stored.scale;
}

/** The first 16 bytes of a text's SHA-256: whether a chunk changed. Kept
 * only inside a sealed payload, never as a column. */
export function fingerprint(text: string): Buffer {
  return createHash("sha256").update(text).digest().subarray(0, 16);
}

// ── an embedding endpoint the person runs ──────────────────────────────

export interface EmbeddingEndpoint {
  /** The OpenAI-compatible base, `http://127.0.0.1:11434/v1`, or the full
   * `/v1/embeddings` address. */
  url: string;
  model: string;
}

/** The address an embeddings request goes to, or null for one that is not http(s). */
export function embeddingsAddress(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = path.endsWith("/embeddings") ? path : `${path || "/v1"}/embeddings`;
  return parsed.toString();
}

/** Embed texts with the person's endpoint, each vector unit length. Null
 * when the endpoint is unset, unreachable, slow or answers something else:
 * the caller keeps the built-in vectors. */
export async function embedTexts(endpoint: EmbeddingEndpoint, texts: readonly string[], timeoutMs: number, fetcher: typeof fetch = fetch): Promise<Float32Array[] | null> {
  const address = embeddingsAddress(endpoint.url);
  if (!address || !endpoint.model.trim() || !texts.length) return null;
  try {
    const response = await fetcher(address, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: endpoint.model.trim(), input: texts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Array<{ index?: number; embedding?: unknown }> };
    if (!Array.isArray(body.data) || body.data.length !== texts.length) return null;
    const out: Array<Float32Array | undefined> = Array.from({ length: texts.length });
    for (const [position, row] of body.data.entries()) {
      const index = typeof row.index === "number" ? row.index : position;
      if (!Array.isArray(row.embedding) || !row.embedding.length || row.embedding.length > 8192 || index < 0 || index >= texts.length) return null;
      if (!row.embedding.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
      out[index] = normalise(Float32Array.from(row.embedding as number[]));
    }
    return out.every(Boolean) ? out as Float32Array[] : null;
  } catch {
    return null;
  }
}
