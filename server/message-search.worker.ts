import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { openKeysFrom, searchMessagesInDatabase, type SealedKeyMaterial } from "./messages/message-search-query.ts";

// Each request reads the latest committed WAL state. Closing after the scan
// avoids keeping an old database inode open across a workspace restore.
// Sealed rows (docs/content-encryption.md) open with the unwrapped content
// keys the server passes with the request, in this process's memory only.
parentPort!.on("message", (request: { id: number; query: string; limit: number; threadId?: string; keys?: SealedKeyMaterial[]; plaintext?: boolean }) => {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(workerData.file, { readOnly: true });
    const sealed = request.keys?.length ? { keys: openKeysFrom(request.keys), plaintext: request.plaintext !== false } : undefined;
    const hits = searchMessagesInDatabase(db, request.query, request.limit, request.threadId, sealed);
    parentPort!.postMessage({ id: request.id, hits });
  } catch {
    // Database errors can contain private paths or query text. The server
    // returns a generic retryable error, never a synchronous fallback scan.
    parentPort!.postMessage({ id: request.id, failed: true });
  } finally {
    db?.close();
  }
});
