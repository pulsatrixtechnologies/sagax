// Content encryption at rest for files and log lines: the pure format
// (docs/content-encryption.md, "Files and logs").
//
// A sealed file is a header then AES-256-GCM chunks of 64 KiB, each with its
// own nonce and tag, so a file is sealed and opened as a stream (never whole
// in memory) and a byte range opens only the chunks it covers:
//
//   "SGXF" | version 1 | log2(chunk) | key id length | key id | context length (2) | context
//   chunk: iv 12 | ciphertext | tag 16
//
// The additional data of a chunk binds the key, its owner, the file's
// context (what it is: an attachment's stored name, a bot's memory), the
// chunk's index and whether it is the last one: a chunk moved, dropped or
// cut off, or a file copied to another place, never opens.
//
// A sealed log line keeps a small cleartext projection (what a reader
// filters on before it opens anything) beside `sealed`, the AES-256-GCM of
// the original line, byte for byte.
//
// No key material is ever logged or put in an error message.
import { createCipheriv, createDecipheriv, randomFillSync, type KeyObject } from "node:crypto";

import { ContentSealError, open, seal, type ContentKeyMaterial } from "./content-crypto.ts";

export const FILE_MAGIC = Buffer.from("SGXF", "latin1");
export const FILE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const CHUNK_OVERHEAD = IV_BYTES + TAG_BYTES;
const CHUNK_LOG2 = 16;
export const CHUNK_BYTES = 1 << CHUNK_LOG2;

export interface FileKey {
  keyId: string;
  owner: string;
  dek: ContentKeyMaterial;
}

export interface SealedHeader {
  keyId: string;
  context: string;
  chunkBytes: number;
  /** bytes before the first chunk */
  length: number;
}

const ivPool = Buffer.alloc(IV_BYTES * 512);
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

export function chunkAad(key: { keyId: string; owner: string }, context: string, index: number, final: boolean): Buffer {
  return Buffer.from(`sagax-file:v1\u0000${key.keyId}\u0000${key.owner}\u0000${context}\u0000${index}\u0000${final ? 1 : 0}`, "utf8");
}

export function fileHeader(keyId: string, context: string): Buffer {
  const id = Buffer.from(keyId, "latin1");
  const ctx = Buffer.from(context, "utf8");
  if (id.length > 255 || ctx.length > 65535) throw new ContentSealError("malformed");
  const out = Buffer.allocUnsafe(4 + 1 + 1 + 1 + id.length + 2 + ctx.length);
  FILE_MAGIC.copy(out, 0);
  out[4] = FILE_VERSION;
  out[5] = CHUNK_LOG2;
  out[6] = id.length;
  id.copy(out, 7);
  out.writeUInt16BE(ctx.length, 7 + id.length);
  ctx.copy(out, 9 + id.length);
  return out;
}

/** Whether these first bytes start a sealed file. */
export function looksSealed(head: Uint8Array): boolean {
  return head.length >= 5 && head[0] === 0x53 && head[1] === 0x47 && head[2] === 0x58 && head[3] === 0x46 && head[4] === FILE_VERSION;
}

/** The header at the start of `head` (at least its whole length), or null
 * for a plain file. Throws when it starts like a sealed file but is cut. */
export function parseHeader(head: Uint8Array): SealedHeader | null {
  if (!looksSealed(head)) return null;
  if (head.length < 9) throw new ContentSealError("malformed");
  const log2 = head[5]!;
  const idLength = head[6]!;
  if (log2 < 10 || log2 > 24 || head.length < 9 + idLength) throw new ContentSealError("malformed");
  const buffer = Buffer.from(head.buffer, head.byteOffset, head.length);
  const keyId = buffer.toString("latin1", 7, 7 + idLength);
  const ctxLength = buffer.readUInt16BE(7 + idLength);
  const length = 9 + idLength + ctxLength;
  if (head.length < length) throw new ContentSealError("malformed");
  return { keyId, context: buffer.toString("utf8", 9 + idLength, length), chunkBytes: 1 << log2, length };
}

/** The longest a header can be: read this much to parse any header. */
export const MAX_HEADER_BYTES = 9 + 255 + 65535;

/** The plaintext size of a sealed file of `size` bytes. */
export function plainSizeOf(header: SealedHeader, size: number): number {
  const body = size - header.length;
  if (body < CHUNK_OVERHEAD) throw new ContentSealError("malformed");
  const stride = header.chunkBytes + CHUNK_OVERHEAD;
  const chunks = Math.ceil(body / stride);
  // the last chunk holds its nonce and tag at least
  if (body - (chunks - 1) * stride < CHUNK_OVERHEAD) throw new ContentSealError("malformed");
  return body - chunks * CHUNK_OVERHEAD;
}

export function chunkCount(header: SealedHeader, size: number): number {
  return Math.ceil((size - header.length) / (header.chunkBytes + CHUNK_OVERHEAD));
}

function sealChunk(key: FileKey, context: string, index: number, final: boolean, plain: Uint8Array): Buffer {
  const iv = nextIv();
  const cipher = createCipheriv("aes-256-gcm", key.dek as KeyObject, iv);
  cipher.setAAD(chunkAad(key, context, index, final));
  const head = cipher.update(plain);
  const tail = cipher.final();
  const out = Buffer.allocUnsafe(IV_BYTES + head.length + tail.length + TAG_BYTES);
  iv.copy(out, 0);
  head.copy(out, IV_BYTES);
  tail.copy(out, IV_BYTES + head.length);
  cipher.getAuthTag().copy(out, IV_BYTES + head.length + tail.length);
  return out;
}

export function openChunk(key: FileKey, context: string, index: number, final: boolean, sealed: Uint8Array): Buffer {
  if (sealed.length < CHUNK_OVERHEAD) throw new ContentSealError("malformed");
  const blob = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.length);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.dek as KeyObject, blob.subarray(0, IV_BYTES));
    decipher.setAAD(chunkAad(key, context, index, final));
    decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES));
    const head = decipher.update(blob.subarray(IV_BYTES, blob.length - TAG_BYTES));
    const tail = decipher.final();
    return tail.length ? Buffer.concat([head, tail]) : head;
  } catch {
    throw new ContentSealError("unreadable");
  }
}

/** Seal a whole buffer (a memory file, a manifest): small files only. */
export function sealBuffer(key: FileKey, context: string, plain: Uint8Array): Buffer {
  const parts: Buffer[] = [fileHeader(key.keyId, context)];
  const chunks = Math.max(1, Math.ceil(plain.length / CHUNK_BYTES));
  for (let index = 0; index < chunks; index++) {
    parts.push(sealChunk(key, context, index, index === chunks - 1, plain.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)));
  }
  return Buffer.concat(parts);
}

/** Open a whole sealed buffer. `expected`: the context it must carry. */
export function openBuffer(sealed: Uint8Array, key: FileKey, expected?: string): Buffer {
  const header = parseHeader(sealed);
  if (!header) throw new ContentSealError("malformed");
  if (expected !== undefined && header.context !== expected) throw new ContentSealError("unreadable");
  const count = chunkCount(header, sealed.length);
  const stride = header.chunkBytes + CHUNK_OVERHEAD;
  const parts: Buffer[] = [];
  for (let index = 0; index < count; index++) {
    const start = header.length + index * stride;
    parts.push(openChunk(key, header.context, index, index === count - 1, sealed.subarray(start, Math.min(sealed.length, start + stride))));
  }
  return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
}

/** Seals a stream of plaintext chunk by chunk: push bytes, then end(). Each
 * call returns the sealed bytes ready to write (the header first). One
 * chunk is held back until the next arrives, so the last one is known. */
export class FileSealer {
  private readonly key: FileKey;
  private readonly context: string;
  private pending: Buffer = Buffer.alloc(0);
  private index = 0;
  private started = false;

  constructor(key: FileKey, context: string) {
    this.key = key;
    this.context = context;
  }

  push(data: Uint8Array): Buffer[] {
    const out: Buffer[] = [];
    if (!this.started) { out.push(fileHeader(this.key.keyId, this.context)); this.started = true; }
    this.pending = this.pending.length ? Buffer.concat([this.pending, data]) : Buffer.from(data.buffer, data.byteOffset, data.length);
    // keep at least one byte back: the last chunk is sealed by end()
    while (this.pending.length > CHUNK_BYTES) {
      out.push(sealChunk(this.key, this.context, this.index++, false, this.pending.subarray(0, CHUNK_BYTES)));
      this.pending = this.pending.subarray(CHUNK_BYTES);
    }
    return out;
  }

  end(): Buffer[] {
    const out: Buffer[] = [];
    if (!this.started) { out.push(fileHeader(this.key.keyId, this.context)); this.started = true; }
    out.push(sealChunk(this.key, this.context, this.index++, true, this.pending));
    this.pending = Buffer.alloc(0);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Log lines
//
// A log keeps one physical line per record (counts, line numbers and a
// rotation that cuts on a line boundary stay as they are), but records are
// sealed together, a block of consecutive lines in one AES-256-GCM message,
// so a reader pays the cipher once per block, not per line:
//
//   {"sb":"<block id>"}                                     every line but the last
//   {"sb":"<block id>","n":<n>,"l":<length>,"sealed":"<key id>:<base64>","p":[<projection>…]}
//
// The last line holds the original lines joined by "\n" (an NDJSON line
// never holds a raw newline), and each record's cleartext projection (what
// readers filter on before opening). The additional data binds the key, its
// owner, the log's context, the block id, the count and the projection text:
// a block moved to another log, cut, or with its projection edited does not
// open.

export const BLOCK_PREFIX = '{"sb":"';
export const BLOCK_ID_CHARS = 16;
/** A placeholder line is exactly `{"sb":"<id>"}`. */
export const PLACEHOLDER_LENGTH = BLOCK_PREFIX.length + BLOCK_ID_CHARS + 2;

export function blockAad(key: { keyId: string; owner: string }, context: string, blockId: string, n: number, projection: string): Buffer {
  return Buffer.from(`sagax-log:v2\u0000${key.keyId}\u0000${key.owner}\u0000${context}\u0000${blockId}\u0000${n}\u0000${projection}`, "utf8");
}

/** The physical lines of one sealed block (no newlines). */
// block ids from a pool: one random fill per 512 blocks, not one per append
const idPool = Buffer.alloc((BLOCK_ID_CHARS / 2) * 512);
let idOffset = idPool.length;
function nextBlockId(): string {
  if (idOffset + BLOCK_ID_CHARS / 2 > idPool.length) {
    randomFillSync(idPool);
    idOffset = 0;
  }
  const id = idPool.toString("hex", idOffset, idOffset + BLOCK_ID_CHARS / 2);
  idOffset += BLOCK_ID_CHARS / 2;
  return id;
}

export function sealBlock(key: FileKey, context: string, lines: readonly string[], projections: readonly Record<string, unknown>[]): string[] {
  const blockId = nextBlockId();
  const projection = JSON.stringify(projections);
  const sealed = seal(key.dek, lines.join("\n"), blockAad(key, context, blockId, lines.length, projection)).toString("base64");
  const out: string[] = [];
  const placeholder = `${BLOCK_PREFIX}${blockId}"}`;
  for (let i = 0; i < lines.length - 1; i++) out.push(placeholder);
  // the lengths first: a reader slices the line, never scans the base64
  out.push(`${BLOCK_PREFIX}${blockId}","n":${lines.length},"l":${sealed.length},"sealed":"${key.keyId}:${sealed}","p":${projection}}`);
  return out;
}

export interface BlockLine {
  blockId: string;
  /** null: a placeholder (not the block's last line) */
  last: { n: number; projection: string; keyId: string; sealed: string } | null;
}

/** A physical line of a sealed block, read by offsets (the base64 is never
 * parsed or scanned). Null: not a block line. */
export function parseBlockLine(raw: string): BlockLine | null {
  if (!raw.startsWith(BLOCK_PREFIX) || raw.length < PLACEHOLDER_LENGTH) return null;
  const blockId = raw.slice(BLOCK_PREFIX.length, BLOCK_PREFIX.length + BLOCK_ID_CHARS);
  const rest = BLOCK_PREFIX.length + BLOCK_ID_CHARS;
  if (raw.length === PLACEHOLDER_LENGTH) return raw.endsWith('"}') ? { blockId, last: null } : null;
  if (!raw.startsWith('","n":', rest)) return null;
  const nEnd = raw.indexOf(",", rest + 6);
  const n = Number(raw.slice(rest + 6, nEnd));
  if (!raw.startsWith('"l":', nEnd + 1)) return null;
  const lEnd = raw.indexOf(",", nEnd + 5);
  const length = Number(raw.slice(nEnd + 5, lEnd));
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(length) || length < 0 || !raw.startsWith('"sealed":"', lEnd + 1)) return null;
  const valueStart = lEnd + 11;
  const colon = raw.indexOf(":", valueStart);
  if (colon < valueStart + 1 || colon > valueStart + 64) return null;
  const sealedEnd = colon + 1 + length;
  if (!raw.startsWith('","p":', sealedEnd) || !raw.endsWith("}")) return null;
  return { blockId, last: { n, projection: raw.slice(sealedEnd + 6, raw.length - 1), keyId: raw.slice(valueStart, colon), sealed: raw.slice(colon + 1, sealedEnd) } };
}

/** The original lines of a block. */
export function openBlock(key: FileKey, context: string, blockId: string, last: NonNullable<BlockLine["last"]>): string[] {
  const plain = open(key.dek, Buffer.from(last.sealed, "base64"), blockAad(key, context, blockId, last.n, last.projection)).toString("utf8");
  const lines = plain.split("\n");
  if (lines.length !== last.n) throw new ContentSealError("malformed");
  return lines;
}
