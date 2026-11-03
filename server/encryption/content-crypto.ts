// Content encryption at rest: the pure crypto (docs/content-encryption.md).
//
// A message row is sealed with AES-256-GCM under a content key (DEK) of its
// owner (a person, or the workspace for rooms), or of a confidential thread.
// The additional data binds the key, the owner, the thread and the message
// id, so a sealed blob copied to another row, thread or person never opens.
//
// Search works on a blind index: every word, word prefix and three-character
// window of a message becomes a keyed token (AES-256 of one block under an
// index key derived once from the DEK, truncated to 6 bytes). The index holds
// those tokens only, never text; a query is tokenized under the same key, and
// a hit is always confirmed on the decrypted text.
//
// No key material is ever logged or put in an error message.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomFillSync, type Cipheriv, type KeyObject } from "node:crypto";

export const SEALED_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const TOKEN_BYTES = 6;
/** Letters of the prefix token of a word of five or more letters: a
 * recall stem (recallMatchTerm's `"stem"*`) matches on its first four
 * letters, then on the opened text. */
export const PREFIX_LETTERS = 4;

export class ContentSealError extends Error {
  readonly code: "unreadable" | "malformed";
  constructor(code: "unreadable" | "malformed") {
    super(code === "malformed" ? "A sealed record is malformed." : "A sealed record could not be opened.");
    this.code = code;
  }
}

/** Additional data of a sealed message row. NUL never occurs in an id. */
export function messageAad(keyId: string, owner: string, threadId: string, messageId: string): Buffer {
  return Buffer.from(`sagax-content:v1\u0000${keyId}\u0000${owner}\u0000${threadId}\u0000${messageId}`, "utf8");
}

/** Additional data of another sealed field (a receipt, a queued follow-up). */
export function fieldAad(keyId: string, owner: string, domain: string, id: string): Buffer {
  return Buffer.from(`sagax-field:v1\u0000${domain}\u0000${keyId}\u0000${owner}\u0000${id}`, "utf8");
}

/** Additional data of a wrapped content key. */
export function keyAad(keyId: string, owner: string, threadId: string | null): Buffer {
  return Buffer.from(`sagax-content-key:v1\u0000${keyId}\u0000${owner}\u0000${threadId ?? ""}`, "utf8");
}

// One random fill per 256 nonces instead of one call per row. A nonce is
// never reused: the pool is consumed forward and refilled when spent.
const ivPool = Buffer.alloc(IV_BYTES * 256);
let ivOffset = ivPool.length;
function nextIv(): Buffer {
  if (ivOffset + IV_BYTES > ivPool.length) {
    randomFillSync(ivPool);
    ivOffset = 0;
  }
  const iv = Buffer.from(ivPool.subarray(ivOffset, ivOffset + IV_BYTES));
  ivOffset += IV_BYTES;
  return iv;
}

export type ContentKeyMaterial = Buffer | KeyObject;

/** [version][iv 12][tag 16][ciphertext] */
export function seal(key: ContentKeyMaterial, plaintext: Buffer | string, aad: Buffer): Buffer {
  const iv = nextIv();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const body = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const head = cipher.update(body);
  const tail = cipher.final();
  const out = Buffer.allocUnsafe(1 + IV_BYTES + TAG_BYTES + head.length + tail.length);
  out[0] = SEALED_VERSION;
  iv.copy(out, 1);
  cipher.getAuthTag().copy(out, 1 + IV_BYTES);
  head.copy(out, 1 + IV_BYTES + TAG_BYTES);
  tail.copy(out, 1 + IV_BYTES + TAG_BYTES + head.length);
  return out;
}

export function open(key: ContentKeyMaterial, sealed: Uint8Array, aad: Buffer): Buffer {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== SEALED_VERSION) throw new ContentSealError("malformed");
  const blob = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed.buffer, sealed.byteOffset, sealed.length);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 1 + IV_BYTES));
    decipher.setAAD(aad);
    decipher.setAuthTag(blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
    const head = decipher.update(blob.subarray(1 + IV_BYTES + TAG_BYTES));
    const tail = decipher.final();
    return tail.length ? Buffer.concat([head, tail]) : head;
  } catch {
    throw new ContentSealError("unreadable");
  }
}

export function openText(key: ContentKeyMaterial, sealed: Uint8Array, aad: Buffer): string {
  return open(key, sealed, aad).toString("utf8");
}

/** A text field sealed into a TEXT column: a prefix no JSON document has. */
const FIELD_PREFIX = "sagax-sealed:v1:";
export function sealField(keyId: string, key: ContentKeyMaterial, value: string, aad: Buffer): string {
  return `${FIELD_PREFIX}${keyId}:${seal(key, value, aad).toString("base64")}`;
}
export function sealedFieldKeyId(value: string): string | null {
  if (!value.startsWith(FIELD_PREFIX)) return null;
  const end = value.indexOf(":", FIELD_PREFIX.length);
  return end > FIELD_PREFIX.length ? value.slice(FIELD_PREFIX.length, end) : null;
}
export function openField(key: ContentKeyMaterial, value: string, aad: Buffer): string {
  const end = value.indexOf(":", FIELD_PREFIX.length);
  if (!value.startsWith(FIELD_PREFIX) || end < 0) throw new ContentSealError("malformed");
  return openText(key, Buffer.from(value.slice(end + 1), "base64"), aad);
}

export function newContentKey(): Buffer {
  return randomBytes(32);
}

/** One HKDF per key, never per message: the caller caches the result. */
export function deriveSubkey(key: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(info, "utf8"), 32));
}

// ---------------------------------------------------------------------------
// Blind index

const WORD = /[\p{L}\p{N}]+/gu;
// eslint-disable-next-line no-control-regex
const ASCII = /^[\u0000-\u007f]*$/;

/** unicode61's folding, closely enough: lower case, diacritics removed. */
export function foldWord(value: string): string {
  const lower = value.toLowerCase();
  // ASCII needs no decomposition: most words skip the NFD pass entirely
  return ASCII.test(lower) ? lower : lower.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** The FTS5-like words of a text, folded, in order. */
export function wordsOf(text: string): string[] {
  // ASCII text: one lower-casing and a byte-class split, no Unicode classes
  if (ASCII.test(text)) {
    const out = text.toLowerCase().split(/[^a-z0-9]+/);
    if (out.length && out[0] === "") out.shift();
    if (out.length && out[out.length - 1] === "") out.pop();
    return out;
  }
  const out: string[] = [];
  for (const match of text.matchAll(WORD)) out.push(foldWord(match[0]));
  return out;
}

/** Keyed hash values of every three-code-unit window of an already
 * lower-cased string (one cipher call for the windows not seen before). */
export function gramCodesOf(lower: string, into: number[] = []): number[] {
  for (let i = 0; i + 3 <= lower.length; i++) {
    into.push((lower.charCodeAt(i) * 65536 + lower.charCodeAt(i + 1)) * 65536 + lower.charCodeAt(i + 2));
  }
  return into;
}

const DOMAIN = { word: 1, prefix: 2, gram: 3 } as const;
export type TermDomain = keyof typeof DOMAIN;
const CACHE_LIMIT = 200_000;

/** Keyed tokens: AES-256 (one block per term, a pseudorandom permutation
 * under the index key) truncated to 6 bytes, as 12 hex digits that the
 * unicode61 tokenizer keeps whole. One cipher call for the whole list.
 * Results are cached per key (bounded): words and windows repeat. */
export class BlindTokenizer {
  private readonly cipher: Cipheriv;
  private readonly wordCache = new Map<string, string>();
  private readonly prefixCache = new Map<string, string>();
  private readonly gramCache = new Map<number, number>();
  constructor(indexKey: Buffer) {
    this.cipher = createCipheriv("aes-256-ecb", indexKey, null);
    this.cipher.setAutoPadding(false);
  }

  private encrypt(domain: TermDomain, terms: readonly string[]): Buffer {
    const blocks = Buffer.alloc(terms.length * 16);
    const tag = DOMAIN[domain];
    for (let i = 0; i < terms.length; i++) {
      const offset = i * 16;
      const term = terms[i]!;
      const written = term.length <= 15 ? blocks.write(term, offset + 1, 15, "utf8") : -1;
      // a term that fits whole is its own block; a longer one is first
      // compressed (sha256, 15 bytes) under a distinct domain byte
      if (written >= 0 && Buffer.byteLength(term, "utf8") === written) {
        blocks[offset] = tag | (written << 3);
      } else {
        blocks.fill(0, offset, offset + 16);
        blocks[offset] = tag | 0x80;
        createHash("sha256").update(term, "utf8").digest().copy(blocks, offset + 1, 0, 15);
      }
    }
    return this.cipher.update(blocks);
  }

  tokens(domain: "word" | "prefix", terms: readonly string[]): string[] {
    if (!terms.length) return [];
    const cache = domain === "word" ? this.wordCache : this.prefixCache;
    const missing: string[] = [];
    for (const term of terms) if (!cache.has(term)) missing.push(term);
    if (missing.length) {
      const unique = [...new Set(missing)];
      const out = this.encrypt(domain, unique);
      if (cache.size + unique.length > CACHE_LIMIT) cache.clear();
      for (let i = 0; i < unique.length; i++) cache.set(unique[i]!, out.toString("hex", i * 16, i * 16 + TOKEN_BYTES));
    }
    return terms.map((term) => cache.get(term)!);
  }

  /** 32-bit keyed values of window codes (gramCodesOf), for a Bloom filter. */
  gramHashes(codes: readonly number[]): Uint32Array {
    const out = new Uint32Array(codes.length);
    const missing: number[] = [];
    for (const code of codes) if (!this.gramCache.has(code)) missing.push(code);
    if (missing.length) {
      const unique = [...new Set(missing)];
      const blocks = Buffer.alloc(unique.length * 16);
      for (let i = 0; i < unique.length; i++) {
        blocks[i * 16] = DOMAIN.gram;
        blocks.writeUIntBE(unique[i]!, i * 16 + 1, 6);
      }
      const encrypted = this.cipher.update(blocks);
      if (this.gramCache.size + unique.length > CACHE_LIMIT) this.gramCache.clear();
      for (let i = 0; i < unique.length; i++) this.gramCache.set(unique[i]!, encrypted.readUInt32BE(i * 16));
    }
    for (let i = 0; i < codes.length; i++) out[i] = this.gramCache.get(codes[i]!)!;
    return out;
  }
}

/** A Bloom filter of the windows (one bit each): size a power of two,
 * twice the windows, 256 bits at least. */
export function bloomOf(hashes: Uint32Array): Uint8Array {
  let bits = 256;
  while (bits < hashes.length * 2) bits *= 2;
  const bloom = new Uint8Array(bits / 8);
  const mask = bits - 1;
  for (const hash of hashes) {
    const bit = hash & mask;
    bloom[bit >>> 3]! |= 1 << (bit & 7);
  }
  return bloom;
}

export function bloomHas(bloom: Uint8Array, hashes: Uint32Array): boolean {
  const mask = bloom.length * 8 - 1;
  for (const hash of hashes) {
    const bit = hash & mask;
    if (!(bloom[bit >>> 3]! & (1 << (bit & 7)))) return false;
  }
  return true;
}
