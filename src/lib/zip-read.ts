// A zip read in the page (an Obsidian vault exported as .zip, Tools >
// Memory > Import). The central directory is read first; nothing is
// inflated until an entry is asked for. Refused before any byte is
// inflated, like server/zip.ts: ZIP64, encryption, methods other than store
// and deflate, more entries than `maxEntries`, an entry larger than
// `maxEntryBytes`, a compression ratio no real file has. A path that could
// leave the vault is refused by the import itself (shared/obsidian-import.ts).
// Deflate goes through the platform's DecompressionStream("deflate-raw").

const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const LOCAL = 0x04034b50;
const MAX_RATIO = 200;

export class ZipReadError extends Error {}

export interface ZipEntry {
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
}

async function inflate(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== size) throw new ZipReadError("A file in the zip is not the size it says.");
  return out;
}

/** The entries of a zip (files only, folders left out). */
export function readZipEntries(buffer: ArrayBuffer, limits: ZipLimits): ZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === END) { end = i; break; }
  }
  if (end < 0) throw new ZipReadError("This is not a zip file.");
  const count = view.getUint16(end + 10, true);
  const dirOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new ZipReadError("ZIP64 archives are not read here.");
  if (count > limits.maxEntries) throw new ZipReadError(`The zip holds more than ${limits.maxEntries} files.`);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let at = dirOffset;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new ZipReadError("The zip's directory is damaged.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;
    if (flags & 0x1) throw new ZipReadError("Encrypted zips are not read here.");
    if (method !== 0 && method !== 8) throw new ZipReadError("The zip uses a compression this import does not read.");
    if (size === 0xffffffff || compressed === 0xffffffff || localOffset === 0xffffffff) throw new ZipReadError("ZIP64 archives are not read here.");
    if (names.has(path)) throw new ZipReadError("The zip holds the same file twice.");
    names.add(path);
    const tooBig = size > limits.maxEntryBytes || (compressed > 0 && size / compressed > MAX_RATIO && size > 1_000_000);
    entries.push({
      path,
      size,
      read: async () => {
        if (tooBig) throw new ZipReadError(`${path} is too large.`);
        if (view.getUint32(localOffset, true) !== LOCAL) throw new ZipReadError("The zip's entries are damaged.");
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const data = bytes.subarray(start, start + compressed);
        return method === 0 ? data.slice() : inflate(data, size);
      },
    });
  }
  return entries;
}
