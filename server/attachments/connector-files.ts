// M-20261120-008: a file a person's bot downloads lands in THAT person's own
// place, never on the Sagax server.
//
// A connector answers a binary body (a ticket attachment, a document, a mail
// attachment) as an MCP embedded resource: `{ type: "resource", resource:
// { uri, mimeType, blob } }`, the bytes in base64. The engine runs on the
// Sagax server: handed that resource, it writes the bytes into its own
// folder there (Claude Code: `<config>/projects/.../tool-results/
// mcp-<server>-blob-<n>.bin`), where no tool of the person's places reaches
// and attach_file refuses it.
//
// So every answer Sagax relays to an engine goes through placeConnectorFiles
// first (the Perspicax relay and the person's own and plugin MCP servers):
// each blob is written into the person's place for the turn, their computer
// first (the Sagax attachments folder of their desktop app), else their
// server environment (/workspace/attachments), with the copy chat
// attachments use (server/index-leaves/personPlaces.ts). The engine
// gets one text line naming that path in place of the bytes. When no place
// takes it, the bytes are dropped and the line says why: nothing is kept on
// the server. attach_file reads it back from the same place to post it in
// the chat (server/routes/internal-sessions-files.ts).
import { createHash } from "node:crypto";
import { extname } from "node:path";

import { displayName } from "./attachment-staging.ts";
import { extensionForFileMime } from "./attachments.ts";

/** One of the person's own places a file can be written to. */
export interface PersonPlace {
  /** "computer": the person's paired computer; "environment": their server environment. */
  kind: "computer" | "environment";
  /** Write the whole file there under `name`; answers its path there. Throws when it cannot. */
  save(name: string, bytes: Buffer): Promise<string>;
}

/** A binary resource of one tools/call answer. */
export interface ConnectorBlob {
  /** Its index in `result.content`. */
  index: number;
  bytes: Buffer;
  mime: string;
  uri: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `result` of a JSON-RPC answer, when it is a tool result with content. */
function toolResultOf(body: unknown): { content: unknown[] } & Json | null {
  if (!isObject(body) || !isObject(body.result) || !Array.isArray(body.result.content)) return null;
  return body.result as { content: unknown[] } & Json;
}

const BASE64 = /^[A-Za-z0-9+/\r\n]*={0,2}[\r\n]*$/;

/** The binary resources of one answer, in order. */
export function connectorBlobs(body: unknown): ConnectorBlob[] {
  const result = toolResultOf(body);
  if (!result) return [];
  const found: ConnectorBlob[] = [];
  result.content.forEach((part, index) => {
    if (!isObject(part) || part.type !== "resource" || !isObject(part.resource)) return;
    const { blob, mimeType, uri } = part.resource;
    if (typeof blob !== "string" || !BASE64.test(blob)) return;
    found.push({
      index,
      bytes: Buffer.from(blob, "base64"),
      mime: typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "application/octet-stream",
      uri: typeof uri === "string" ? uri : "",
    });
  });
  return found;
}

/** The extension the bytes themselves say, else the type's, else none. */
export function sniffExtension(bytes: Buffer, mime: string): string {
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 4).equals(Buffer.from("%PDF"))) return ".pdf";
  if (head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return ".jpg";
  if (head.subarray(0, 4).equals(Buffer.from("GIF8"))) return ".gif";
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    // An Office Open XML file is a zip whose entries name its kind.
    const names = bytes.toString("latin1");
    if (names.includes("xl/")) return ".xlsx";
    if (names.includes("word/")) return ".docx";
    if (names.includes("ppt/")) return ".pptx";
    return extensionForFileMime(mime) ?? ".zip";
  }
  return extensionForFileMime(mime) ?? "";
}

/** The file name a vendor gave in a Content-Disposition header, if any. */
function dispositionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(value);
  if (star) {
    try { return decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, "")); } catch { /* the plain one */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value);
  return plain ? (plain[2] ?? plain[1]!).trim() || null : null;
}

/** A Content-Disposition name the answer's own text carries (Perspicax puts
 * the vendor's headers beside the blob, `headers`). */
function namedInAnswer(body: unknown): string | null {
  const result = toolResultOf(body);
  if (!result) return null;
  const sources: unknown[] = [result.structuredContent];
  for (const part of result.content) {
    if (!isObject(part) || part.type !== "text" || typeof part.text !== "string" || !part.text.trimStart().startsWith("{")) continue;
    try { sources.push(JSON.parse(part.text)); } catch { /* not JSON */ }
  }
  for (const source of sources) {
    if (!isObject(source) || !isObject(source.headers)) continue;
    for (const [key, value] of Object.entries(source.headers)) {
      if (key.toLowerCase() === "content-disposition") {
        const name = dispositionName(value);
        if (name) return name;
      }
    }
  }
  return null;
}

/** A name as a person reads it (`Quarterly%20report.pdf` is `Quarterly
 * report.pdf`): attach_file refuses a percent-encoded name
 * (server/safety/sensitive-path.ts), so one is never written. A malformed
 * escape keeps the name as given. */
function percentDecoded(name: string): string {
  if (!/%[0-9a-f]{2}/i.test(name)) return name;
  try { return decodeURIComponent(name); } catch { return name; }
}

/** The name the file is written under: the vendor's own when it gave one,
 * else "download" and the kind of file it is; a short hash keeps two files
 * of one name apart. Safe as one path component everywhere. */
export function connectorFileName(blob: ConnectorBlob, given: string | null): string {
  const hash = createHash("sha256").update(blob.bytes).digest("hex").slice(0, 8);
  const sniffed = sniffExtension(blob.bytes, blob.mime);
  const fromUri = percentDecoded(blob.uri.replace(/[?#].*$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? "");
  const base = given == null ? (extname(fromUri) ? fromUri : "download") : percentDecoded(given);
  const extension = extname(base) || sniffed;
  return `${hash}-${displayName(base, `file${extension.toLowerCase()}`)}`;
}

const WHERE: Record<PersonPlace["kind"], string> = {
  computer: "on the person's own computer",
  environment: "in the person's server environment",
};

/** The bytes of one file and their type, as the line names them. */
type FileFacts = { bytes: Buffer; mime: string };

/** The line the engine reads in place of the bytes. */
function placedLine(place: PersonPlace["kind"], path: string, name: string, file: FileFacts): string {
  return `The file this tool returned (${file.bytes.length} bytes, ${file.mime}) was saved ${WHERE[place]}: ${path} ` +
    `(not on the Sagax server). To give it to the person, call attach_file with this exact path to post it in the chat, ` +
    `or copy it with your tools there (for example to a folder of theirs). File name: ${name}.`;
}

function droppedLine(file: FileFacts, why: string): string {
  return `The file this tool returned (${file.bytes.length} bytes, ${file.mime}) was not kept: ${why} ` +
    "Nothing was saved on the Sagax server. Tell the person, and call the tool again once their computer is connected or their server environment is available.";
}

/** One file a connector returned, written into the first of the turn's
 * places that takes it (`places`, most preferred first): the line the engine
 * reads in its place and, when one took it, its path there. No place takes
 * it: the line says why and nothing is kept. The one placement of #5138,
 * for a blob Sagax relays (placeConnectorFiles) and for a file the engine's
 * own connector wrote (engine-connector-files.ts, #5140). */
export async function placeOneFile(name: string, file: FileFacts, places: readonly PersonPlace[]): Promise<{ line: string; path?: string }> {
  const failures: string[] = [];
  for (const place of places) {
    try {
      const path = await place.save(name, file.bytes);
      return { line: placedLine(place.kind, path, name, file), path };
    } catch (error) {
      failures.push(`${WHERE[place.kind]}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    line: droppedLine(file, places.length
      ? `it could not be written ${failures.join("; ")}.`
      : "the person has no computer connected and no server environment in this turn."),
  };
}

/**
 * The answer with every binary resource written into the person's place
 * and replaced by a line naming its path there. An answer without one is
 * returned as it is. `places` lists the turn's places, most preferred first.
 */
export async function placeConnectorFiles(body: unknown, turnPlaces: readonly PersonPlace[] | (() => readonly PersonPlace[])): Promise<unknown> {
  // a batch answers one element per frame
  if (Array.isArray(body)) return Promise.all(body.map((entry) => placeConnectorFiles(entry, turnPlaces)));
  const blobs = connectorBlobs(body);
  if (!blobs.length) return body;
  const places = typeof turnPlaces === "function" ? turnPlaces() : turnPlaces;
  const result = toolResultOf(body)!;
  const given = namedInAnswer(body);
  const content = [...result.content];
  for (const blob of blobs) {
    const name = connectorFileName(blob, blobs.length === 1 ? given : null);
    content[blob.index] = { type: "text", text: (await placeOneFile(name, blob, places)).line };
  }
  return { ...(body as Json), result: { ...result, content } };
}
