// A small ZIP writer and a defensive ZIP reader, for the bot package
// (`<bot>.sagaxbot.zip`, server/bot-zip.ts). No dependency: node:zlib does
// the deflate and the CRC-32.
//
// Writer: entries are written one after the other to a sink (an HTTP
// response), so a large bot never sits whole in memory; each entry is
// deflated on its own, or stored when it is already compressed.
//
// Reader: reads the central directory of a file on disk and refuses, before
// any byte is inflated: ZIP64, encryption, methods other than store and
// deflate, symbolic links, duplicate names, a path that is absolute, has a
// drive letter, a backslash, a NUL or a `..` segment, more entries or more
// declared bytes than the caller allows, and a compression ratio no real
// file has. Each entry is inflated with an output cap at its declared size
// and its CRC is checked.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8 = 0x0800;
const VERSION = 20;
const STORED_TYPES = /\.(?:png|jpe?g|gif|webp|mp3|mp4|m4a|zip|gz|tgz|xz|7z|pdf|woff2?)$/i;
/** Beyond this ratio between declared and compressed bytes, refuse. */
const MAX_RATIO = 200;

export class ZipError extends Error {
  readonly code: string;
  constructor(message: string, code = "invalid_zip") {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** A path inside an archive: relative, forward slashes, no `..`. */
export function safeZipPath(name: string): boolean {
  if (!name || name.length > 512) return false;
  // oxlint-disable-next-line no-control-regex -- a path must not carry control characters
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return false;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.replace(/\/$/, "").split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

interface Written {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  method: number;
  offset: number;
  time: { time: number; date: number };
}

/** Writes entries in order to `sink`; `finish` writes the central directory. */
export class ZipWriter {
  private readonly sink: (chunk: Buffer) => Promise<void> | void;
  private readonly entries: Written[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private done = false;

  constructor(sink: (chunk: Buffer) => Promise<void> | void) {
    this.sink = sink;
  }

  get bytes(): number {
    return this.offset;
  }

  get count(): number {
    return this.entries.length;
  }

  async add(name: string, data: Buffer | string, options: { mtime?: Date; store?: boolean } = {}): Promise<void> {
    if (this.done) throw new ZipError("The archive is already finished.", "finished");
    if (!safeZipPath(name)) throw new ZipError(`Unsafe path in archive: ${name}`, "unsafe_path");
    if (this.names.has(name)) throw new ZipError(`Duplicate path in archive: ${name}`, "duplicate");
    this.names.add(name);
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const store = options.store ?? STORED_TYPES.test(name);
    let body = store ? bytes : deflateRawSync(bytes, { level: 6 });
    let method = store ? 0 : 8;
    if (!store && body.length >= bytes.length) { body = bytes; method = 0; }
    const nameBytes = Buffer.from(name, "utf8");
    const time = dosTime(options.mtime ?? new Date());
    const entry: Written = { name: nameBytes, crc: crc32(bytes) >>> 0, compressed: body.length, size: bytes.length, method, offset: this.offset, time };
    if (this.offset + 30 + nameBytes.length + body.length > 0xfffffffe || bytes.length > 0xfffffffe) throw new ZipError("The archive is larger than 4 GB.", "too_large");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time.time, 10);
    header.writeUInt16LE(time.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    await this.sink(Buffer.concat([header, nameBytes]));
    await this.sink(body);
    this.offset += 30 + nameBytes.length + body.length;
    this.entries.push(entry);
  }

  async finish(): Promise<void> {
    if (this.done) return;
    this.done = true;
    if (this.entries.length > 0xfffe) throw new ZipError("Too many files for one archive.", "too_many");
    const start = this.offset;
    const parts: Buffer[] = [];
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL, 0);
      header.writeUInt16LE((3 << 8) | VERSION, 4);
      header.writeUInt16LE(VERSION, 6);
      header.writeUInt16LE(UTF8, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time.time, 12);
      header.writeUInt16LE(entry.time.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      // A regular file, 0644.
      header.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
      header.writeUInt32LE(entry.offset, 42);
      parts.push(header, entry.name);
    }
    const central = Buffer.concat(parts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(start, 16);
    end.writeUInt16LE(0, 20);
    await this.sink(central);
    await this.sink(end);
    this.offset += central.length + end.length;
  }
}

export interface ZipEntry {
  /** Preserve executable files when extracting a plugin, never other mode bits. */
  executable: boolean;
  name: string;
  size: number;
  compressed: number;
  method: number;
  crc: number;
  offset: number;
}

export interface ZipLimits {
  maxEntries: number;
  /** Sum of the declared (uncompressed) sizes. */
  maxTotalBytes: number;
  /** One entry's declared size. */
  maxEntryBytes: number;
}

/** An archive on disk, its directory checked. Close it when done. */
export class ZipReader {
  readonly entries: ReadonlyMap<string, ZipEntry>;
  readonly totalBytes: number;
  private readonly fd: number;
  private closed = false;

  private constructor(fd: number, entries: Map<string, ZipEntry>, totalBytes: number) {
    this.fd = fd;
    this.entries = entries;
    this.totalBytes = totalBytes;
  }

  static open(path: string, limits: ZipLimits): ZipReader {
    const fd = openSync(path, "r");
    try {
      const { entries, total } = readDirectory(fd, limits);
      return new ZipReader(fd, entries, total);
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Names under a folder prefix (`memory/`), files only. */
  under(prefix: string): string[] {
    return [...this.entries.keys()].filter((name) => name.startsWith(prefix));
  }

  read(name: string): Buffer {
    if (this.closed) throw new ZipError("The archive is closed.", "closed");
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`Missing in archive: ${name}`, "missing");
    const header = Buffer.alloc(30);
    if (readSync(this.fd, header, 0, 30, entry.offset) !== 30 || header.readUInt32LE(0) !== LOCAL) throw new ZipError("The archive is damaged.", "damaged");
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const raw = Buffer.alloc(entry.compressed);
    if (entry.compressed && readSync(this.fd, raw, 0, entry.compressed, start) !== entry.compressed) throw new ZipError("The archive is damaged.", "damaged");
    let data: Buffer;
    if (entry.method === 0) data = raw;
    else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
      } catch {
        throw new ZipError(`A file in the archive could not be read: ${name}`, "damaged");
      }
    }
    if (data.length !== entry.size || (crc32(data) >>> 0) !== entry.crc) throw new ZipError(`A file in the archive is damaged: ${name}`, "damaged");
    return data;
  }

  text(name: string): string {
    return this.read(name).toString("utf8");
  }

  json(name: string): unknown {
    try {
      return JSON.parse(this.text(name));
    } catch (error) {
      if (error instanceof ZipError) throw error;
      throw new ZipError(`${name} is not valid JSON.`, "invalid_json");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }
}

function readDirectory(fd: number, limits: ZipLimits): { entries: Map<string, ZipEntry>; total: number } {
  const size = fstatSync(fd).size;
  if (size < 22) throw new ZipError("This file is not a zip archive.", "not_zip");
  const tail = Math.min(size, 22 + 0xffff);
  const buffer = Buffer.alloc(tail);
  readSync(fd, buffer, 0, tail, size - tail);
  let at = -1;
  for (let index = tail - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === END) { at = index; break; }
  }
  if (at < 0) throw new ZipError("This file is not a zip archive.", "not_zip");
  const disk = buffer.readUInt16LE(at + 4);
  const count = buffer.readUInt16LE(at + 10);
  const length = buffer.readUInt32LE(at + 12);
  const offset = buffer.readUInt32LE(at + 16);
  if (disk !== 0 || buffer.readUInt16LE(at + 6) !== 0 || count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError("Split or ZIP64 archives are not supported.", "unsupported");
  }
  if (count > limits.maxEntries) throw new ZipError(`The archive holds more than ${limits.maxEntries} files.`, "too_many");
  if (offset + length > size) throw new ZipError("The archive is damaged.", "damaged");
  const central = Buffer.alloc(length);
  if (length && readSync(fd, central, 0, length, offset) !== length) throw new ZipError("The archive is damaged.", "damaged");
  const entries = new Map<string, ZipEntry>();
  let cursor = 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL) throw new ZipError("The archive is damaged.", "damaged");
    const made = central.readUInt16LE(cursor + 4) >> 8;
    const flags = central.readUInt16LE(cursor + 8);
    const method = central.readUInt16LE(cursor + 10);
    const crc = central.readUInt32LE(cursor + 16);
    const compressed = central.readUInt32LE(cursor + 20);
    const declared = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const external = central.readUInt32LE(cursor + 38);
    const local = central.readUInt32LE(cursor + 42);
    const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    const name = (flags & UTF8) ? nameBytes.toString("utf8") : nameBytes.toString("latin1");
    if (flags & 0x1) throw new ZipError("Encrypted archives are not supported.", "unsupported");
    if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.", "unsupported");
    if (!safeZipPath(name)) throw new ZipError(`The archive holds an unsafe path: ${JSON.stringify(name.slice(0, 120))}`, "unsafe_path");
    // Unix-made entries carry their file type: a link is refused.
    const mode = (external >>> 16) & 0o170000;
    if (made === 3 && mode === 0o120000) throw new ZipError(`The archive holds a symbolic link: ${name}`, "unsafe_path");
    if (name.endsWith("/")) continue;
    if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression in ${name}.`, "unsupported");
    if (method === 0 && compressed !== declared) throw new ZipError("The archive is damaged.", "damaged");
    if (entries.has(name)) throw new ZipError(`The archive holds the same path twice: ${name}`, "duplicate");
    if (declared > limits.maxEntryBytes) throw new ZipError(`${name} is larger than the limit.`, "too_large");
    if (declared > 1024 * 1024 && compressed > 0 && declared / compressed > MAX_RATIO) throw new ZipError(`${name} expands too much to be a real file.`, "zip_bomb");
    total += declared;
    if (total > limits.maxTotalBytes) throw new ZipError("The archive expands beyond the size limit.", "too_large");
    if (local + 30 > size) throw new ZipError("The archive is damaged.", "damaged");
    entries.set(name, { name, size: declared, compressed, method, crc, offset: local, executable: made === 3 && ((external >>> 16) & 0o111) !== 0 });
  }
  return { entries, total };
}
