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
// (an image too, beside the picture the model sees). The tool result then
// reads `[Resource from <server> at <uri>] Binary content (<type>, <size>)
// saved to <that path>`. Sagax never gets the bytes; it sees that result
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
import { lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";

import { sensitiveReadPath } from "../safety/sensitive-path.ts";
import { attachmentMime } from "./attachments.ts";
import { connectorFileName, placeOneFile, type PersonPlace } from "./connector-files.ts";

/** Claude Code's name for a binary MCP result it saved:
 * `mcp-<server>-blob-<time>-<random>.<ext>` (an older CLI: `-blob-<n>.bin`). */
const BLOB_NAME = "mcp-[A-Za-z0-9_.-]+?-blob-[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9]{1,12})?";
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
 * file); nothing attach_file would refuse (sensitiveReadPath, #5138). */
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
  if (sensitiveReadPath(below)) return { why: "it is a hidden or credential file, which is never handed on", remove: true };
  if (stat.size > MAX_BYTES) return { why: `it is larger than ${MAX_BYTES} bytes`, remove: true };
  return null;
}

type Block = { type?: unknown; text?: unknown } & Record<string, unknown>;

/** The text parts of a tool result as an engine hands it on: a string, an
 * array of content blocks, or an object with `content`. */
function texts(output: unknown): string[] {
  if (typeof output === "string") return [output];
  const blocks = Array.isArray(output) ? output : output && typeof output === "object" && Array.isArray((output as { content?: unknown }).content) ? (output as { content: unknown[] }).content : [];
  return blocks.flatMap((block) => (block && typeof block === "object" && (block as Block).type === "text" && typeof (block as Block).text === "string" ? [(block as Block).text as string] : []));
}

/** The same output with each text part rewritten. */
function withTexts(output: unknown, rewrite: (text: string) => string): unknown {
  if (typeof output === "string") return rewrite(output);
  const map = (blocks: unknown[]) => blocks.map((block) => (block && typeof block === "object" && (block as Block).type === "text" && typeof (block as Block).text === "string"
    ? { ...(block as Block), text: rewrite((block as Block).text as string) }
    : block));
  if (Array.isArray(output)) return map(output);
  if (output && typeof output === "object" && Array.isArray((output as { content?: unknown }).content)) return { ...(output as object), content: map((output as { content: unknown[] }).content) };
  return output;
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
  read: (path) => readFileSync(path),
  remove: (path) => { try { unlinkSync(path); } catch { /* already gone */ } },
};

/** The line for an engine file removed unread. */
function unreadLine(why: string): string {
  return `The file this tool returned was not kept: ${why}. Nothing was saved on the Sagax server.`;
}

/**
 * The output with every file of the engine's own blob folder it names
 * written into the person's place (the turn's `places`, most preferred
 * first) and removed from the engine's folder. Each path is replaced by the
 * person's path (or says it was not kept) and the #5138 line follows it.
 * An output that names none is returned as it is (`moved` 0).
 */
export async function placeEngineFiles(
  output: unknown,
  folder: EngineBlobFolder,
  turnPlaces: readonly PersonPlace[] | (() => readonly PersonPlace[]),
  files: EngineFiles = DISK,
): Promise<{ output: unknown; moved: number }> {
  const all = texts(output);
  const paths = [...new Set(all.flatMap((text) => engineBlobPaths(text, folder)))];
  if (!paths.length) return { output, moved: 0 };
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
    const text = all.find((part) => part.includes(path)) ?? "";
    const { mime, uri } = described(text, path);
    try {
      const bytes = files.read(path);
      // a name from the URI first; else the type the engine already gave
      // the file (`.xlsx`); else the kind the bytes show
      const kept = extname(path).toLowerCase();
      const given = extname(uri.replace(/[?#].*$/, "")) || !kept || kept === ".bin" ? null : `download${kept}`;
      const name = connectorFileName({ index: 0, bytes, mime, uri }, given);
      placed.set(path, await placeOneFile(name, { bytes, mime }, places));
    } catch (error) {
      placed.set(path, { line: unreadLine(`it could not be read (${error instanceof Error ? error.message : String(error)})`) });
    } finally {
      // never kept on the server, whether a place took it or not
      files.remove(path);
    }
  }
  if (!placed.size) return { output, moved: 0 };
  const rewritten = withTexts(output, (text) => {
    let out = text;
    const lines: string[] = [];
    for (const [path, result] of placed) {
      if (!out.includes(path)) continue;
      out = out.split(path).join(result.path ?? "(not kept)");
      lines.push(result.line);
    }
    return lines.length ? `${out}\n${lines.join("\n")}` : out;
  });
  return { output: rewritten, moved: placed.size };
}
