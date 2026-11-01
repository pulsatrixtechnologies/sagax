// Upload content checks: the declared mime must match the real bytes (magic
// numbers), executables are refused whatever they claim to be, and, when a
// clamd endpoint is configured, the file is scanned before it is committed.
// Zip-bomb limits for archives stay in electron/archive-extract.mjs
// (ARCHIVE_LIMITS: files, total bytes, ratio, depth).
import { open } from "node:fs/promises";
import { createReadStream, type ReadStream } from "node:fs";
import { connect, type Socket } from "node:net";

export const SNIFF_BYTES = 4100;

export type SniffedKind =
  | "png" | "jpeg" | "gif" | "webp" | "pdf" | "zip" | "gzip" | "7z" | "tar" | "rtf"
  | "ole" | "ogg" | "flac" | "wav" | "webm" | "mp4" | "mp3" | "aac"
  | "elf" | "pe" | "macho" | "wasm" | "shebang" | "text" | "unknown";

const startsWith = (b: Buffer, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, s: string, at = 0) => startsWith(b, [...Buffer.from(s, "latin1")], at);

/** Identify a file from its first bytes. */
export function sniff(head: Buffer): SniffedKind {
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return "elf";
  if (ascii(head, "MZ")) return "pe";
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]].some((s) => startsWith(head, s))) return "macho";
  // 0xCAFEBABE is both a Mach-O fat binary and a Java class file: refuse both.
  if (startsWith(head, [0xca, 0xfe, 0xba, 0xbe])) return "macho";
  if (startsWith(head, [0x00, 0x61, 0x73, 0x6d])) return "wasm";
  if (ascii(head, "#!")) return "shebang";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(head, "GIF87a") || ascii(head, "GIF89a")) return "gif";
  if (ascii(head, "RIFF") && ascii(head, "WEBP", 8)) return "webp";
  if (ascii(head, "RIFF") && ascii(head, "WAVE", 8)) return "wav";
  if (ascii(head, "%PDF-")) return "pdf";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (startsWith(head, [0x1f, 0x8b])) return "gzip";
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (ascii(head, "ustar", 257)) return "tar";
  if (ascii(head, "{\\rtf")) return "rtf";
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (ascii(head, "OggS")) return "ogg";
  if (ascii(head, "fLaC")) return "flac";
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(head, "ftyp", 4)) return "mp4";
  if (ascii(head, "ID3") || (head.length > 1 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) {
    return head.length > 1 && head[0] === 0xff && (head[1]! & 0xf6) === 0xf0 ? "aac" : "mp3";
  }
  if (!head.subarray(0, Math.min(head.length, 8192)).includes(0)) return "text";
  return "unknown";
}

const EXECUTABLE: ReadonlySet<SniffedKind> = new Set(["elf", "pe", "macho", "wasm"]);

/** Kinds each declared mime may really be. */
const ALLOWED: Readonly<Record<string, readonly SniffedKind[]>> = {
  "image/png": ["png"], "image/jpeg": ["jpeg"], "image/gif": ["gif"], "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/zip": ["zip"], "application/x-zip-compressed": ["zip"],
  "application/x-tar": ["tar"],
  "application/gzip": ["gzip"], "application/x-gzip": ["gzip"], "application/x-gtar": ["gzip"], "application/x-compressed-tar": ["gzip"],
  "application/x-7z-compressed": ["7z"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["zip"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["zip"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["zip"],
  "application/vnd.oasis.opendocument.text": ["zip"],
  "application/vnd.oasis.opendocument.spreadsheet": ["zip"],
  "application/vnd.oasis.opendocument.presentation": ["zip"],
  "application/msword": ["ole"], "application/vnd.ms-excel": ["ole"], "application/vnd.ms-powerpoint": ["ole"],
  "application/rtf": ["rtf", "text"], "text/rtf": ["rtf", "text"],
  "text/plain": ["text"], "text/markdown": ["text"], "text/csv": ["text"], "text/tab-separated-values": ["text"],
  "application/json": ["text"],
  "audio/ogg": ["ogg"], "audio/opus": ["ogg"], "audio/flac": ["flac"], "audio/x-flac": ["flac"],
  "audio/wav": ["wav"], "audio/x-wav": ["wav"], "audio/wave": ["wav"],
  "audio/webm": ["webm"], "video/webm": ["webm"],
  "audio/mp4": ["mp4"], "audio/x-m4a": ["mp4"], "video/mp4": ["mp4"], "video/quicktime": ["mp4"],
  "audio/mpeg": ["mp3"], "audio/aac": ["aac", "mp4"],
};

export class UploadContentError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type SniffMode = "off" | "warn" | "enforce";

/** SAGAX_UPLOAD_SNIFF=off|warn|enforce. Default warn (observe and log only),
 * so existing deployments are not broken by a false positive; set enforce once
 * the logs are clean. Off under the test runner, whose fixtures use placeholder
 * bytes (this module has its own tests). */
export function sniffModeFromEnv(env: NodeJS.ProcessEnv = process.env): SniffMode {
  const value = env.SAGAX_UPLOAD_SNIFF?.trim().toLowerCase();
  if (value === "off" || value === "warn" || value === "enforce") return value;
  return env.VITEST ? "off" : "warn";
}

/** Throws when the bytes are an executable or do not match the declared mime. */
export function assertContentMatches(mime: string, head: Buffer, mode: SniffMode = sniffModeFromEnv()): SniffedKind {
  const kind = sniff(head);
  if (mode === "off") return kind;
  if (mode === "warn") {
    try { return assertContentMatches(mime, head, "enforce"); } catch (error) {
      console.warn(`[attachments] content check (warn only): ${(error as Error).message}`);
      return kind;
    }
  }
  if (EXECUTABLE.has(kind)) throw new UploadContentError(`executable content (${kind}) is not accepted`, 415);
  const allowed = ALLOWED[mime];
  // Unknown declared mimes are rejected earlier by the allow-list; be strict here too.
  if (!allowed || !allowed.includes(kind)) {
    throw new UploadContentError(`file content (${kind}) does not match declared type ${mime}`, 415);
  }
  return kind;
}

export async function readHead(path: string, bytes = SNIFF_BYTES): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

export interface ClamdConfig { socket?: string; host?: string; port?: number; required: boolean; timeoutMs: number }

/** SAGAX_CLAMD_SOCKET (unix path) or SAGAX_CLAMD_HOST[:SAGAX_CLAMD_PORT]; SAGAX_CLAMD_REQUIRED=1 fails closed. */
export function clamdConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClamdConfig | null {
  const socket = env.SAGAX_CLAMD_SOCKET?.trim();
  const host = env.SAGAX_CLAMD_HOST?.trim();
  if (!socket && !host) return null;
  return {
    socket: socket || undefined,
    host: host || undefined,
    port: Number(env.SAGAX_CLAMD_PORT) || 3310,
    required: env.SAGAX_CLAMD_REQUIRED === "1",
    timeoutMs: Number(env.SAGAX_CLAMD_TIMEOUT_MS) || 60_000,
  };
}

export type ScanResult = { status: "clean" } | { status: "infected"; signature: string } | { status: "error"; message: string };

export interface ClamdScanDiagnostics {
  /** Test/diagnostic hooks only. They never alter the scan. */
  onBackpressure?: () => void;
  onSourceClose?: () => void;
}

/** Stream a file to clamd with INSTREAM. */
export function clamdScanFile(path: string, config: ClamdConfig, diagnostics: ClamdScanDiagnostics = {}): Promise<ScanResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stream: ReadStream | undefined;
    const done = (r: ScanResult) => { if (!settled) { settled = true; stream?.destroy(); sock.destroy(); resolve(r); } };
    const sock: Socket = config.socket ? connect(config.socket) : connect(config.port ?? 3310, config.host ?? "127.0.0.1");
    sock.setTimeout(config.timeoutMs, () => done({ status: "error", message: "clamd timeout" }));
    let reply = "";
    sock.on("data", (d) => { reply += d.toString("utf8"); });
    sock.on("error", (e) => done({ status: "error", message: e.message }));
    sock.on("end", () => {
      const line = reply.replace(/\0/g, "").trim();
      const found = /^stream: (.+) FOUND$/.exec(line);
      if (found) done({ status: "infected", signature: found[1]! });
      else if (/^stream: OK$/.test(line)) done({ status: "clean" });
      else done({ status: "error", message: line || "empty clamd reply" });
    });
    sock.on("connect", () => {
      if (settled) return;
      sock.write("zINSTREAM\0");
      stream = createReadStream(path, { highWaterMark: 64 * 1024 });
      stream.once("close", () => diagnostics.onSourceClose?.());
      sock.on("drain", () => { if (!settled) stream?.resume(); });
      stream.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const size = Buffer.alloc(4); size.writeUInt32BE(buf.length, 0);
        const headerReady = sock.write(size);
        const bodyReady = sock.write(buf);
        if (!headerReady || !bodyReady) {
          stream!.pause();
          diagnostics.onBackpressure?.();
        }
      });
      stream.on("error", (e) => done({ status: "error", message: e.message }));
      stream.on("end", () => sock.write(Buffer.alloc(4)));
    });
  });
}

/** Sniff + optional clamd scan of a file about to be committed. */
export async function checkUploadedFile(path: string, mime: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertContentMatches(mime, await readHead(path), sniffModeFromEnv(env));
  const config = clamdConfigFromEnv(env);
  if (!config) return;
  const result = await clamdScanFile(path, config);
  if (result.status === "infected") throw new UploadContentError(`file rejected by antivirus (${result.signature})`, 422);
  if (result.status === "error") {
    console.warn(`[attachments] clamd scan failed: ${result.message}`);
    if (config.required) throw new UploadContentError("antivirus scan unavailable", 503);
  }
}
