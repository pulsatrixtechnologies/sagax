// Files a person attaches in a turn, where the bot's tools run (organization
// server). The composer stores an upload in the server's attachments folder
// and the message carries `<attached-file path="<data>/attachments/<uuid>.md"
// name="README.md" />`. In solo that path is on the same machine as the
// engine's own Read tool; on an organization server the bot's tools run on
// the person's computer (desktop bridge) or in their server environment,
// where that path does not exist. So for the CURRENT message only:
//
//   1. small text files are also given inline, so the bot reads them with no
//      tool at all (images already reach vision models natively,
//      server/turn-images.ts);
//   2. every file is copied, lazily (at the bot's first tool call), into the
//      target: `/workspace/attachments/<name>` in the server environment, or
//      the desktop app's own attachments folder on the person's computer;
//   3. the tag the bot sees names THAT path.
//
// Only the speaker's own uploads are ever copied: a file is the speaker's
// when the first message that referenced it is theirs (or nothing has
// referenced it yet, its name being random). Another person's attachment in
// a private thread is never copied or inlined, whatever a message claims.
import { lstatSync, realpathSync } from "node:fs";
import { dirname, extname, posix, resolve, win32 } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";

import { atRestChunks, atRestSizeSync, readAtRestSync } from "./content-at-rest.ts";
import { maxBytesForAttachment } from "./attachments.ts";

const OWNED_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;
const FILE_TAG = /^<attached-file[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;
/** Text formats the upload endpoint accepts that a bot can read as is. */
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".tsv", ".json"]);
/** Inline at most this much text per file, and in all, per turn. */
export const INLINE_FILE_MAX_BYTES = 100 * 1024;
export const INLINE_TOTAL_MAX_BYTES = 256 * 1024;
/** Where a server environment keeps them. */
export const SANDBOX_ATTACHMENTS_DIR = "/workspace/attachments";

export interface TurnAttachedFile {
  /** Offsets of the tag in the message text. */
  start: number;
  end: number;
  /** The upload's random name on the server (`<uuid>.<ext>`). */
  file: string;
  /** Its path on the server. */
  serverPath: string;
  /** The person's own name for it, as shown. */
  name: string;
  bytes: number;
}

export type StagingTarget =
  | { kind: "user-sandbox" }
  | { kind: "user-desktop"; attachmentsDir: string; platform: "darwin" | "win32" | "linux" };

function decodeAttribute(value: string): string {
  return value.replace(/&(quot|lt|gt|amp);|&#(9|10|13);/g, (entity, named: string | undefined, numeric: string | undefined) => {
    if (numeric === "9") return "\t";
    if (numeric === "10") return "\n";
    if (numeric === "13") return "\r";
    if (named === "quot") return '"';
    if (named === "lt") return "<";
    if (named === "gt") return ">";
    if (named === "amp") return "&";
    return entity;
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;").replaceAll("\r", "&#13;").replaceAll("\n", "&#10;");
}

type MarkdownNode = { type: string; children?: MarkdownNode[]; value?: string; position?: { start: { offset?: number }; end: { offset?: number } } };

/** The app-owned `<attached-file>` tags of one message: standalone transport
 * tags only (never one quoted in code or prose), pointing at a regular file
 * directly inside the attachments folder. */
export function attachedFilesInText(text: string, attachmentsDir: string): TurnAttachedFile[] {
  if (!text.includes("<attached-file")) return [];
  const found: TurnAttachedFile[] = [];
  const pending: MarkdownNode[] = [fromMarkdown(text) as MarkdownNode];
  let canonicalRoot: string;
  try { canonicalRoot = realpathSync(attachmentsDir); } catch { return []; }
  while (pending.length) {
    const node = pending.pop()!;
    for (const child of node.children ?? []) pending.push(child);
    if (node.type !== "html" || !node.value || !node.position) continue;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === undefined || end === undefined) continue;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    if (text.slice(lineStart, start).trim() || text.slice(end, nextLine < 0 ? text.length : nextLine).trim()) continue;
    const match = FILE_TAG.exec(node.value);
    if (!match) continue;
    const serverPath = decodeAttribute(match[1]!);
    const file = serverPath.split(/[\\/]/).at(-1) ?? "";
    if (!OWNED_FILE_NAME.test(file) || resolve(serverPath) !== resolve(attachmentsDir, file)) continue;
    try {
      const entry = lstatSync(resolve(attachmentsDir, file));
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      // its plaintext size: a stored file may be sealed at rest (server/content-at-rest.ts)
      const bytes = atRestSizeSync(resolve(attachmentsDir, file));
      if (bytes > maxBytesForAttachment(file)) continue;
      if (dirname(realpathSync(resolve(attachmentsDir, file))) !== canonicalRoot) continue;
      found.push({ start, end, file, serverPath: resolve(attachmentsDir, file), name: displayName(match[2] ? decodeAttribute(match[2]) : file, file), bytes });
    } catch { /* gone */ }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** A name safe as one path component on every platform, keeping the
 * upload's real extension (the name never decides the type). */
export function displayName(name: string, file: string): string {
  const stored = extname(file).toLowerCase();
  // a tar.gz upload is stored as .tgz but keeps the name it was given
  const extension = stored === ".tgz" && /\.tar\.gz$/i.test(name.trim()) ? ".tar.gz" : stored;
  const base = Array.from(name.normalize("NFKC").split(/[\\/]/).at(-1) ?? "", (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || "<>:\"|?*".includes(character) ? "_" : character;
  }).join("").replace(/^\.+/, "").replace(/[.\s]+$/, "").trim();
  const stem = (base.toLowerCase().endsWith(extension) ? base.slice(0, base.length - extension.length) : base).slice(0, 120) || "attachment";
  return `${stem}${extension}`;
}

/** The file's name where it is copied: a short prefix of the upload's random
 * id keeps two "README.md" from different messages apart. */
export function stagedName(file: TurnAttachedFile): string {
  return `${file.file.slice(0, 8)}-${file.name}`;
}

/** Where the bot finds it in the target. */
export function targetPath(file: TurnAttachedFile, target: StagingTarget): string {
  if (target.kind === "user-sandbox") return posix.join(SANDBOX_ATTACHMENTS_DIR, stagedName(file));
  return (target.platform === "win32" ? win32 : posix).join(target.attachmentsDir, stagedName(file));
}

/** The speaker's own upload, by the first message that referenced it.
 * `references` lists every stored message mentioning the file's name, with
 * its person (undefined for a bot or nobody) and time. */
export function attachmentIsTheirs(person: string, references: readonly { person?: string; at: number }[]): boolean {
  const key = person.trim().toLowerCase();
  const people = references.filter((reference) => reference.person !== undefined).sort((a, b) => a.at - b.at);
  if (!people.length) return references.length === 0;
  return people[0]!.person!.trim().toLowerCase() === key;
}

function inlineText(file: TurnAttachedFile): string | null {
  if (!TEXT_EXTENSIONS.has(extname(file.file).toLowerCase()) || file.bytes > INLINE_FILE_MAX_BYTES) return null;
  try {
    const bytes = readAtRestSync(file.serverPath);
    if (bytes.includes(0)) return null;
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return value;
  } catch {
    return null;
  }
}

/** The provider-facing text: each of the speaker's own attachment tags
 * names the copy in the target and, for small text files, carries the
 * content; `annotate` may add a block after a tag (an archive's manifest,
 * server/attachment-archives.ts). Tags for files that are not theirs are
 * left untouched (and are never copied). Returns the files to copy at the
 * first tool call. */
export function stageTurnAttachments(
  text: string,
  files: readonly TurnAttachedFile[],
  target: StagingTarget | null,
  annotate?: (file: TurnAttachedFile, where: string | null) => string | null,
): { text: string; staged: TurnAttachedFile[] } {
  if (!files.length) return { text, staged: [] };
  let out = text;
  let inlined = 0;
  const staged: TurnAttachedFile[] = [];
  for (const file of [...files].sort((a, b) => b.start - a.start)) {
    const where = target ? targetPath(file, target) : null;
    const content = inlineText(file);
    const fits = content !== null && inlined + Buffer.byteLength(content) <= INLINE_TOTAL_MAX_BYTES;
    if (fits) inlined += Buffer.byteLength(content!);
    const tag = where
      ? `<attached-file path="${escapeAttribute(where)}" name="${escapeAttribute(file.name)}" />`
      : `<attached-file name="${escapeAttribute(file.name)}" />`;
    const body = fits ? `\n<attached-file-content name="${escapeAttribute(file.name)}">\n${content}\n</attached-file-content>` : "";
    const note = annotate?.(file, where);
    out = out.slice(0, file.start) + tag + body + (note ? `\n${note}` : "") + out.slice(file.end);
    if (where) staged.unshift(file);
  }
  return { text: out, staged };
}

/** Read one file for copying, in chunks the transports accept. */
export async function* attachmentChunks(file: TurnAttachedFile, chunkBytes: number): AsyncGenerator<{ offset: number; data: Buffer; final: boolean }> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new Error("chunk size must be positive");
  const total = atRestSizeSync(file.serverPath);
  if (total !== file.bytes) throw new Error("attachment changed while copying");
  let offset = 0;
  let pending: Buffer = Buffer.alloc(0);
  for await (const bytes of atRestChunks(file.serverPath)) {
    pending = pending.length ? Buffer.concat([pending, bytes]) : bytes;
    while (pending.length >= chunkBytes) {
      const data = pending.subarray(0, chunkBytes);
      offset += data.length;
      if (offset > total) throw new Error("attachment changed while copying");
      yield { offset: offset - data.length, data, final: offset === total };
      pending = pending.subarray(chunkBytes);
    }
  }
  if (offset + pending.length !== total || atRestSizeSync(file.serverPath) !== total) throw new Error("attachment changed while copying");
  if (pending.length || total === 0) yield { offset, data: pending, final: true };
}
