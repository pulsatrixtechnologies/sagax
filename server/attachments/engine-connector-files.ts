// #5140 (M-20261120-008): a file returned by a connector the ENGINE holds
// itself lands in the person's own place too, never on the Sagax server.
//
// #5138 (connector-files.ts) places every blob Sagax relays to an engine. A
// connector the engine reaches by itself is not relayed: Claude Code's
// claude.ai connectors (`mcp__claude_ai_<Name>__<tool>`), in a bot's own
// turn and in the connector hub's Claude host (call_connector,
// server/connectors/hosts/claude-host.ts). Claude Code decodes a binary MCP
// result in its own MCP client and writes it, before any hook and before the
// model, into its session folder on the machine it runs on:
//
//   <config>/projects/<folder key>/<session>/tool-results/mcp-<server>-blob-<time>-<random>.<ext>
//
// (an image too, beside the picture the model sees; a resource the model
// reads with ReadMcpResource as `mcp-resource-<time>-<n>-<random>.<ext>`).
// The tool result then reads `[Resource from <server> at <uri>] Binary
// content (<type>, <size>) saved to <that path>`. Sagax never gets the bytes; it sees that result
// before the model only through a synchronous PostToolUse hook (whose
// `updatedMCPToolOutput` the engine applies), and, for the hub, in the
// host's own reading of the call. Both hand it here.
//
// placeEngineFiles: each path of the engine's own blob folder named in the
// result is read (a regular file of that folder, never through a link, the
// same sensitive-path verdict as attach_file), written into the person's
// place by the one placement of #5138 (placeOneFile, copyToPersonPlace),
// removed from the engine's folder whatever happened, and the result names
// the person's path instead. Nothing else in the result changes.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, type Stats } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";

import { sensitiveReadPath } from "../safety/sensitive-path.ts";
import { attachmentMime } from "./attachments.ts";
import { connectorFileName, placeOneFile, type PersonPlace } from "./connector-files.ts";

/** Claude Code's names for a binary MCP result it saved: a tool's
 * `mcp-<server>-blob-<time>-<random>.<ext>` (an older CLI: `-blob-<n>.bin`)
 * and a read resource's `mcp-resource-<time>-<n>-<random>.<ext>`. */
const BLOB_NAME = "mcp-(?:[A-Za-z0-9_.-]+?-blob-[A-Za-z0-9_-]+|resource-[0-9]+-[0-9]+-[A-Za-z0-9]+)(?:\\.[A-Za-z0-9]{1,12})?";

/** A Claude Code session id, the folder of one session's tool results. */
const SESSION = "[0-9A-Za-z][0-9A-Za-z-]{7,79}";
/** The biggest file read back: Claude Code itself keeps no more on disk
 * (its binary persist limit, 100 MiB on CLI 2.1.329). */
const MAX_BYTES = 100 * 1024 * 1024;

/** Where one call's engine wrote its files: the folder as the result writes
 * it, and what may follow it up to the file name. */
export interface EngineBlobFolder {
  /** An absolute folder of the engine's own config. */
  root: string;
  /** The session folders below `root` that may hold the call's files:
   * exactly one (a turn's hook names its session), or any (the hub's
   * one-call process). */
  session: string | null;
}

/** The blob folder of one turn's session, from the hook's own fields
 * (`transcript_path` and `session_id`, which Claude Code fills, never the
 * tool's output): `<dirname(transcript)>/<session>/tool-results`. Null when
 * they do not have that shape. */
export function sessionBlobFolder(transcriptPath: unknown, sessionId: unknown): EngineBlobFolder | null {
  if (typeof transcriptPath !== "string" || typeof sessionId !== "string") return null;
  if (!new RegExp(`^${SESSION}$`).test(sessionId) || !isAbsolute(transcriptPath)) return null;
  if (basename(transcriptPath) !== `${sessionId}.jsonl`) return null;
  const project = dirname(transcriptPath);
  if (basename(dirname(project)) !== "projects") return null;
  return { root: project, session: sessionId };
}

/** The blob folders of a one-call process run in `cwd` on the config folder
 * `configDir`: any session of `<configDir>/projects/<folder key of cwd>`. */
export function projectBlobFolder(configDir: string, cwd: string): EngineBlobFolder {
  return { root: join(configDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-")), session: null };
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The engine's file paths a result text names, in the order it names them. */
export function engineBlobPaths(text: string, folder: EngineBlobFolder): string[] {
  const session = folder.session === null ? SESSION : escaped(folder.session);
  const pattern = new RegExp(`${escaped(folder.root)}[\\\\/](${session})[\\\\/]tool-results[\\\\/](${BLOB_NAME})`, "g");
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const path = join(folder.root, match[1]!, "tool-results", match[2]!);
    if (!found.includes(path)) found.push(path);
  }
  return found;
}

/** Why the server does not read this path as the engine's own file, or
 * null. `remove`: it is the engine's own blob all the same (a regular file
 * of that folder with one name), so it is removed unread. A regular file
 * directly in the session's tool-results folder, no link on the way below
 * the engine's folder and no second name (a hard link to a credential
 * file); nothing attach_file would refuse (sensitiveReadPath, #5138). The
 * read itself opens the same file again without following a link
 * (`readEngineFile`). */
export function engineFileRefusal(path: string, folder: EngineBlobFolder): { why: string; remove: boolean } | null {
  const outside = { why: "it is not a file of the engine's own folder", remove: false };
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { why: "it is no longer there", remove: false };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return outside;
  if (stat.nlink !== 1) return { why: "it has another name on the server", remove: false };
  let real: string;
  let root: string;
  try {
    real = realpathSync(path);
    root = realpathSync(folder.root);
  } catch {
    return { why: "it is no longer there", remove: false };
  }
  const below = relative(root, real);
  if (!below || below.startsWith("..") || isAbsolute(below)) return outside;
  const parts = below.split(sep);
  if (parts.length !== 3 || parts[1] !== "tool-results" || (folder.session !== null && parts[0] !== folder.session)) return outside;
  if (!new RegExp(`^${BLOB_NAME}$`).test(parts[2]!)) return outside;
  // Defense only: a name Claude Code writes never matches here (it starts
  // with `mcp-`, its extension comes from the CLI's fixed list, anything
  // else is `.bin`). It stays as the #5138 guard so a name something else
  // put in that folder (the test forges a `.pem`) is never handed on;
  // attach_file still applies the same guard on the person's side
  // (personPlaces readFromPersonPlace).
  if (sensitiveReadPath(below)) return { why: "it is a hidden or credential file, which is never handed on", remove: true };
  if (stat.size > MAX_BYTES) return { why: `it is larger than ${MAX_BYTES} bytes`, remove: true };
  return null;
}

/** The bytes of a file the refusal check passed, through one descriptor
 * opened without following a link: still a regular file with one name and
 * the same identity, so nothing swapped in between is read. */
export function readEngineFile(path: string): Buffer {
  const before = lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat: Stats = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.ino !== before.ino || stat.dev !== before.dev || stat.size > MAX_BYTES) throw new Error("the file changed before it was read");
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const got = readSync(fd, bytes, read, stat.size - read, read);
      if (got === 0) break;
      read += got;
    }
    if (read !== stat.size) throw new Error("the file changed while it was read");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

/** Every string of a tool result as the engine hands it on (a string, an
 * array of content blocks, `{ content }`, a read resource's `{ contents:
 * [{ text, blobSavedTo }] }`), in order. A picture's data is a string too:
 * it never names a path. */
function strings(output: unknown, depth = 0): string[] {
  if (typeof output === "string") return [output];
  if (!output || typeof output !== "object" || depth > 8) return [];
  return (Array.isArray(output) ? output : Object.values(output)).flatMap((value) => strings(value, depth + 1));
}

/** The same output with each string rewritten. */
function withStrings(output: unknown, rewrite: (text: string) => string, depth = 0): unknown {
  if (typeof output === "string") return rewrite(output);
  if (!output || typeof output !== "object" || depth > 8) return output;
  if (Array.isArray(output)) return output.map((value) => withStrings(value, rewrite, depth + 1));
  return Object.fromEntries(Object.entries(output).map(([key, value]) => [key, withStrings(value, rewrite, depth + 1)]));
}

/** What the engine's own line says about the file: its type and its URI.
 * A picture's line (`[Image source: <path>]`) names no type: the extension
 * the engine gave the file does. */
function described(text: string, path: string): { mime: string; uri: string } {
  const at = text.indexOf(path);
  const before = at < 0 ? text : text.slice(0, at);
  const resource = [...before.matchAll(/\[Resource from [^\]\n]*? at ([^\]\s]+)\]/g)].at(-1);
  const binary = [...before.matchAll(/Binary content \(([^,()\n]+),/g)].at(-1);
  const mime = binary?.[1]?.trim();
  return { mime: mime && mime !== "unknown type" ? mime : attachmentMime(path), uri: resource?.[1] ?? "" };
}

/** The file system the engine's files are read from and removed in. */
export interface EngineFiles {
  refusal(path: string, folder: EngineBlobFolder): { why: string; remove: boolean } | null;
  read(path: string): Buffer;
  remove(path: string): void;
}

const DISK: EngineFiles = {
  refusal: engineFileRefusal,
  read: readEngineFile,
  remove: (path) => { try { unlinkSync(path); } catch { /* already gone */ } },
};

/** The line for an engine file removed unread. */
function unreadLine(why: string): string {
  return `The file this tool returned was not kept: ${why}. Nothing was saved on the Sagax server.`;
}

/** The placement of one file, or the line saying it did not end in time:
 * a hook's engine waits for its answer only so long (the copy may still
 * reach the person's place). */
async function placedWithin(name: string, file: { bytes: Buffer; mime: string }, places: readonly PersonPlace[], deadline: number | undefined): Promise<{ path?: string; line: string }> {
  const placing = placeOneFile(name, file, places);
  if (deadline === undefined) return placing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ line: string }>((resolve) => {
    timer = setTimeout(() => resolve({ line: unreadLine("the copy to the person's place did not finish in time (it may still arrive there)") }), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([placing, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The output with every file of the engine's own blob folder it names
 * written into the person's place (the turn's `places`, most preferred
 * first) and removed from the engine's folder. Each path is replaced by the
 * person's path (or says it was not kept), and the #5138 line follows the
 * first sentence that names it. An output that names none is returned as it
 * is (`moved` 0). `withinMs`: how long the caller can wait for the copies.
 */
export async function placeEngineFiles(
  output: unknown,
  folder: EngineBlobFolder,
  turnPlaces: readonly PersonPlace[] | (() => readonly PersonPlace[]),
  files: EngineFiles = DISK,
  withinMs?: number,
): Promise<{ output: unknown; moved: number }> {
  const all = strings(output);
  const paths = [...new Set(all.flatMap((text) => engineBlobPaths(text, folder)))];
  if (!paths.length) return { output, moved: 0 };
  const deadline = withinMs === undefined ? undefined : Date.now() + withinMs;
  const places = typeof turnPlaces === "function" ? turnPlaces() : turnPlaces;
  const placed = new Map<string, { path?: string; line: string }>();
  for (const path of paths) {
    const refused = files.refusal(path, folder);
    if (refused) {
      // read nothing; the engine's own blob is still never kept
      if (refused.remove) {
        files.remove(path);
        placed.set(path, { line: unreadLine(refused.why) });
      }
      continue;
    }
    // the sentence that names it (not a bare `blobSavedTo` path)
    const text = all.find((part) => part.includes(path) && part.trim() !== path) ?? "";
    const { mime, uri } = described(text, path);
    try {
      const bytes = files.read(path);
      // a name from the URI first; else the type the engine already gave
      // the file (`.xlsx`); else the kind the bytes show
      const kept = extname(path).toLowerCase();
      const given = extname(uri.replace(/[?#].*$/, "")) || !kept || kept === ".bin" ? null : `download${kept}`;
      const name = connectorFileName({ index: 0, bytes, mime, uri }, given);
      placed.set(path, await placedWithin(name, { bytes, mime }, places, deadline));
    } catch (error) {
      placed.set(path, { line: unreadLine(`it could not be read (${error instanceof Error ? error.message : String(error)})`) });
    } finally {
      // never kept on the server, whether a place took it or not
      files.remove(path);
    }
  }
  if (!placed.size) return { output, moved: 0 };
  const explained = new Set<string>();
  const rewritten = withStrings(output, (text) => {
    let out = text;
    const lines: string[] = [];
    for (const [path, result] of placed) {
      if (!out.includes(path)) continue;
      const bare = out.trim() === path;
      out = out.split(path).join(result.path ?? "(not kept)");
      if (!bare && !explained.has(path)) {
        explained.add(path);
        lines.push(result.line);
      }
    }
    return lines.length ? `${out}\n${lines.join("\n")}` : out;
  });
  return { output: rewritten, moved: placed.size };
}
