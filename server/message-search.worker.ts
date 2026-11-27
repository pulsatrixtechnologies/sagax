import { createReadStream, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import {
  messageThreadIdsInDatabase,
  newestAtsInDatabase,
  openKeysFrom,
  searchMessagesInDatabase,
  threadsReferencingInDatabase,
  type NewestAtsMode,
  type SealedKeyMaterial,
} from "./messages/message-search-query.ts";

// Each request reads the latest committed WAL state. Closing after the scan
// avoids keeping an old database inode open across a workspace restore.
// Sealed rows (docs/content-encryption.md) open with the unwrapped content
// keys the server passes with the request, in this process's memory only.
//
// #5343: warm / newestAts / threadIds also run here so boot and the semantic
// index never hold the server's event loop on a cold messages.db.
parentPort!.on("message", (request: {
  id: number;
  query?: string;
  limit?: number;
  threadId?: string;
  keys?: SealedKeyMaterial[];
  plaintext?: boolean;
  references?: string[];
  warm?: boolean;
  newestAts?: { threadIds: string[]; mode?: NewestAtsMode };
  threadIds?: boolean;
}) => {
  // Page-cache warm: read the file and discard. The OS cache is shared with
  // the server process; the main thread never waits on these reads.
  if (request.warm) {
    const file = String(workerData.file ?? "");
    if (!file || !existsSync(file)) {
      parentPort!.postMessage({ id: request.id, warmed: true });
      return;
    }
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", () => { /* discard; page cache is the point */ });
    stream.on("error", () => parentPort!.postMessage({ id: request.id, failed: true }));
    stream.on("end", () => parentPort!.postMessage({ id: request.id, warmed: true }));
    return;
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(workerData.file, { readOnly: true });
    // 2026-11-03 (audit S-5): the tidy's attribution, off the server's thread
    if (request.references) {
      parentPort!.postMessage({ id: request.id, references: [...threadsReferencingInDatabase(db, request.references)] });
      return;
    }
    if (request.newestAts) {
      const ats = newestAtsInDatabase(db, request.newestAts.threadIds, request.newestAts.mode ?? "all");
      parentPort!.postMessage({ id: request.id, newestAts: [...ats] });
      return;
    }
    if (request.threadIds) {
      parentPort!.postMessage({ id: request.id, threadIds: messageThreadIdsInDatabase(db) });
      return;
    }
    const sealed = request.keys?.length ? { keys: openKeysFrom(request.keys), plaintext: request.plaintext !== false } : undefined;
    const hits = searchMessagesInDatabase(db, request.query ?? "", request.limit ?? 40, request.threadId, sealed);
    parentPort!.postMessage({ id: request.id, hits });
  } catch {
    // Database errors can contain private paths or query text. The server
    // returns a generic retryable error, never a synchronous fallback scan.
    parentPort!.postMessage({ id: request.id, failed: true });
  } finally {
    db?.close();
  }
});
