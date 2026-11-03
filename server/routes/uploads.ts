// Public upload and attachment routes (#1388 slice P3):
//   POST /api/attachments?phase=… and POST /api/files?phase=…  (resumable)
//   POST /api/attachments                                      (image bytes)
//   POST /api/files                                            (shared files)
//   GET  /api/attachments/:name/manifest
//   GET  /api/attachments/:name                                (serve + audio Range)
//
// Runs after the auth gate via ROUTES. Visibility of a named attachment is
// decided earlier by pathSubject / subjectVisible in handleRequest.
import { open as openFileHandle } from "node:fs/promises";

import {
  archiveSummary,
  prepareArchiveUpload,
  recoverArchiveUpload,
  removeArchiveUpload,
  storedArchiveManifest,
  type StoredArchiveManifest,
} from "../attachments/attachment-archives.ts";
import {
  attachmentMime,
  extensionForMime,
  imageMaxBytes,
  isArchiveAttachment,
  maxBytesForFileMime,
  parseAttachmentRange,
  resumableAttachmentUpload,
  saveFile,
  saveImageStream,
  servableAttachmentPath,
  validateAttachmentUploadId,
  type SavedAttachment,
} from "../attachments/attachments.ts";
import { atRestStream, describeHandle } from "../encryption/content-at-rest.ts";
import { ContentKeyUnavailable } from "../encryption/content-keys.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface UploadsRouteDeps {
  /** Resumable upload owner (viewer, else local principal, else "workspace"). */
  uploadOwner(auth: RequestAuth): string;
  /** Content-at-rest encryption owner; null on solo / non-session. */
  encryptionOwner(auth: RequestAuth): string | null;
  /** Solo unpacks archives next to the upload; organization servers do not. */
  extractArchivesHere(): boolean;
  /** Overridable for characterization tests. Defaults are the leaf helpers. */
  resumableUpload?: typeof resumableAttachmentUpload;
  saveImage?: typeof saveImageStream;
  saveSharedFile?: typeof saveFile;
  isArchive?: (path: string) => boolean;
  prepareArchive?: (path: string, opts: { extractHere: boolean }) => Promise<StoredArchiveManifest>;
  summarizeArchive?: (manifest: StoredArchiveManifest) => unknown;
  removeArchive?: (path: string) => void;
  recoverArchive?: (path: string) => void | Promise<void>;
  readManifest?: (name: string) => StoredArchiveManifest | null;
  resolveServable?: (name: string) => string | null;
}

const MANIFEST = /^\/api\/attachments\/([\w.-]+)\/manifest$/;
const ONE = /^\/api\/attachments\/([\w.-]+)$/;

function headerText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function finalizeArchive<T extends SavedAttachment>(
  deps: UploadsRouteDeps,
  saved: T,
): Promise<T & { archive?: unknown }> {
  const isArchive = deps.isArchive ?? isArchiveAttachment;
  if (!isArchive(saved.path)) return saved;
  const prepare = deps.prepareArchive ?? prepareArchiveUpload;
  const summarize = deps.summarizeArchive ?? archiveSummary;
  const manifest = await prepare(saved.path, { extractHere: deps.extractArchivesHere() });
  return { ...saved, archive: summarize(manifest) };
}

export function createUploadsRoutes(deps: UploadsRouteDeps): RouteHandler {
  const resumable = deps.resumableUpload ?? resumableAttachmentUpload;
  const saveImage = deps.saveImage ?? saveImageStream;
  const saveShared = deps.saveSharedFile ?? saveFile;
  const readManifest = deps.readManifest ?? storedArchiveManifest;
  const resolveServable = deps.resolveServable ?? servableAttachmentPath;
  const removeArchive = deps.removeArchive ?? removeArchiveUpload;
  const recoverArchive = deps.recoverArchive ?? recoverArchiveUpload;

  return async ({ req, res, url, path, method, auth, json }) => {
    // The same upload routes and personal write scopes support resumable
    // bodies. Every request fits through a proxy with a 100 MB body limit.
    if (method === "POST" && (path === "/api/attachments" || path === "/api/files") && url.searchParams.has("phase")) {
      const phase = url.searchParams.get("phase");
      if (phase !== "chunk" && phase !== "status" && phase !== "commit" && phase !== "cancel") {
        req.resume();
        return json(res, 400, { error: "invalid upload phase" });
      }
      try {
        const rawType = headerText(req.headers["content-type"]);
        const result = await resumable({
          owner: deps.uploadOwner(auth),
          encryptionOwner: deps.encryptionOwner(auth),
          uploadId: url.searchParams.get("uploadId") ?? "",
          name: url.searchParams.get("name") ?? "image",
          mime: rawType ?? "",
          image: path === "/api/attachments",
          total: Number(url.searchParams.get("total")),
          phase,
          offset: Number(url.searchParams.get("offset")),
          ...(phase === "chunk" ? { chunks: req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer> } : {}),
          finalize: async (saved) => finalizeArchive(deps, saved),
          cleanup: removeArchive,
          recover: recoverArchive,
        });
        req.resume();
        return json(res, 200, result);
      } catch (error) {
        req.resume();
        throw error;
      }
    }

    // Pasted/dropped images: raw bytes, content-type must be an image type.
    if (method === "POST" && path === "/api/attachments") {
      let uploadId: string | undefined;
      try {
        uploadId = validateAttachmentUploadId(url.searchParams.get("uploadId") ?? undefined);
      } catch (error) {
        req.resume();
        throw error;
      }
      const rawType = headerText(req.headers["content-type"]);
      const mime = rawType?.split(";")[0]?.trim().toLowerCase();
      if (!mime || !extensionForMime(mime)) {
        return json(res, 400, { error: "content-type must be an image type" });
      }
      const rawLength = headerText(req.headers["content-length"]);
      const declaredLength = rawLength === undefined ? undefined : Number(rawLength);
      if (declaredLength !== undefined && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
        req.resume();
        return json(res, 400, { error: "content-length must be a non-negative integer" });
      }
      const imageCeiling = imageMaxBytes();
      if (declaredLength !== undefined && declaredLength > imageCeiling) {
        req.resume();
        return json(res, 413, { error: `image exceeds ${imageCeiling} bytes` });
      }
      let saved: SavedAttachment;
      try {
        saved = await saveImage(req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>, mime, {
          uploadId,
          expectedBytes: declaredLength,
          owner: deps.encryptionOwner(auth),
        });
      } catch (error) {
        req.resume();
        throw error;
      }
      return json(res, 201, saved);
    }

    // Shared documents over the same authenticated connection as messages.
    if (method === "POST" && path === "/api/files") {
      let uploadId: string | undefined;
      try {
        uploadId = validateAttachmentUploadId(url.searchParams.get("uploadId") ?? undefined);
      } catch (error) {
        req.resume();
        throw error;
      }
      const name = url.searchParams.get("name");
      if (!name) {
        req.resume();
        return json(res, 400, { error: "name is required" });
      }
      const rawType = headerText(req.headers["content-type"]);
      const rawLength = headerText(req.headers["content-length"]);
      const declaredLength = rawLength === undefined ? undefined : Number(rawLength);
      if (declaredLength !== undefined && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
        req.resume();
        return json(res, 400, { error: "content-length must be a non-negative integer" });
      }
      const maxBytes = maxBytesForFileMime(rawType);
      if (declaredLength !== undefined && declaredLength > maxBytes) {
        req.resume();
        return json(res, 413, { error: `file exceeds ${maxBytes} bytes` });
      }
      try {
        const chunks = req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>;
        const saved = await saveShared(chunks, name, rawType ?? "", {
          uploadId,
          expectedBytes: declaredLength,
          owner: deps.encryptionOwner(auth),
        });
        return json(res, 201, await finalizeArchive(deps, saved));
      } catch (error) {
        req.resume();
        throw error;
      }
    }

    // Archive chip ("Voir le contenu"). Visibility was checked above the table.
    let m = path.match(MANIFEST);
    if (m && method === "GET") {
      const manifest = readManifest(m[1]!);
      if (!manifest) return json(res, 404, { error: "no such archive" });
      res.setHeader("cache-control", "private, no-store");
      const summarize = deps.summarizeArchive ?? archiveSummary;
      return json(res, 200, summarize(manifest));
    }

    // Name-locked to the attachments dir: refuse anything that is not a bare
    // generated filename. Range serving is audio-only (#1745).
    m = path.match(ONE);
    if (m && method === "GET") {
      const storedPath = resolveServable(m[1]!);
      let handle: Awaited<ReturnType<typeof openFileHandle>> | null = null;
      let stored: Awaited<ReturnType<typeof describeHandle>>;
      try {
        if (!storedPath) throw new Error("not servable");
        handle = await openFileHandle(storedPath, "r");
        if (!(await handle.stat()).isFile()) throw new Error("not a file");
        stored = await describeHandle(handle, storedPath);
      } catch (error) {
        await handle?.close().catch(() => undefined);
        if (error instanceof ContentKeyUnavailable) throw error;
        return json(res, 404, { error: "no such attachment" });
      }
      const opened = handle;
      const size = stored.size;
      const mime = attachmentMime(m[1]!);
      const headers = {
        "content-type": mime,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      };
      const send = (status: number, extra: Record<string, string>, start: number, end: number) => {
        res.writeHead(status, { ...headers, ...extra });
        if (end < start || res.destroyed) {
          void opened.close().catch(() => undefined);
          res.end();
          return;
        }
        const stream = atRestStream(opened, stored, start, end);
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      };
      if (mime.startsWith("audio/")) {
        const ranged = { "cache-control": "private, no-store, no-transform", "accept-ranges": "bytes" };
        const rawRange = headerText(req.headers.range);
        const range = parseAttachmentRange(rawRange, size);
        if (range.kind === "unsatisfiable") {
          await opened.close().catch(() => undefined);
          res.writeHead(416, { ...headers, ...ranged, "content-range": `bytes */${size}` });
          res.end();
          return;
        }
        if (range.kind === "range") {
          send(206, {
            ...ranged,
            "content-length": String(range.end - range.start + 1),
            "content-range": `bytes ${range.start}-${range.end}/${size}`,
          }, range.start, range.end);
          return;
        }
        send(200, { ...ranged, "content-length": String(size) }, 0, size - 1);
        return;
      }
      send(200, { "content-length": String(size) }, 0, size - 1);
      return;
    }

    return PASS;
  };
}

/** Whose content key an upload is sealed with at rest: the signed-in person
 * on an organization server (their erasure erases it), else the workspace. */
export function encryptionOwnerForUpload(
  auth: { kind: string; session?: { principalId?: string } },
  isPerspicax: boolean,
): string | null {
  return isPerspicax && auth.kind === "session" ? auth.session?.principalId?.trim() || null : null;
}
