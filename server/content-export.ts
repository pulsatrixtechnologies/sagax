// A plaintext copy of a sealed message database (docs/content-encryption.md),
// for the workspace backup: the archive (itself encrypted with the backup
// password) carries transcripts in the clear as before, so it restores on
// any machine, whose own migration seals them again under its own keys.
// The keys come from the running server's memory (provideContentKeys); a
// backup worker gets them in its workerData, never from disk.
import { DatabaseSync } from "node:sqlite";

import { fieldAad, messageAad, openField, openText, sealedFieldKeyId } from "./encryption/content-crypto.ts";

export interface ExportedContentKey {
  keyId: string;
  owner: string;
  threadId: string | null;
  raw: Uint8Array;
}

let source: (() => ExportedContentKey[]) | null = null;

/** message-db.ts registers its live keyring here. */
export function provideContentKeys(provide: () => ExportedContentKey[]): void {
  source = provide;
}

export function contentKeysForExport(): ExportedContentKey[] {
  try { return source?.() ?? []; } catch { return []; }
}

export class ContentExportError extends Error {}

const hasTable = (db: DatabaseSync, name: string): boolean => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name));

/** Open every sealed row of the database copy at `path` in place; rows
 * whose key was destroyed (erased content) are removed. Refuses, leaving the
 * copy unusable for a backup, when a key exists but is not among `keys`. */
export function unsealDatabaseCopy(path: string, keys: readonly ExportedContentKey[]): { opened: number; erased: number } {
  const db = new DatabaseSync(path);
  let opened = 0, erased = 0;
  try {
    const columns = new Set((db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has("sealed") || !hasTable(db, "content_keys")) return { opened, erased };
    const byId = new Map(keys.map((key) => [key.keyId, { ...key, raw: Buffer.from(key.raw) }]));
    const stored = new Set((db.prepare("SELECT key_id FROM content_keys").all() as Array<{ key_id: string }>).map((row) => row.key_id));
    const missing = [...stored].filter((id) => !byId.has(id) && (db.prepare("SELECT 1 FROM messages WHERE key_id = ? LIMIT 1").get(id)));
    if (missing.length) throw new ContentExportError("Some conversations are encrypted with a key this server cannot open right now; the backup was not made.");
    db.exec("BEGIN");
    try {
      const update = db.prepare("UPDATE messages SET text = ?, json = ?, sealed = NULL, key_id = NULL WHERE rowid = ?");
      const remove = db.prepare("DELETE FROM messages WHERE rowid = ?");
      for (const row of db.prepare("SELECT rowid AS rowid, thread_id, id, sealed, key_id FROM messages WHERE sealed IS NOT NULL").all() as Array<{ rowid: number; thread_id: string; id: string; sealed: Uint8Array; key_id: string }>) {
        const key = byId.get(row.key_id);
        if (!key || !stored.has(row.key_id)) { remove.run(row.rowid); erased++; continue; }
        let message: { text?: unknown };
        try { message = JSON.parse(openText(key.raw, row.sealed, messageAad(key.keyId, key.owner, row.thread_id, row.id))) as { text?: unknown }; }
        catch { remove.run(row.rowid); erased++; continue; }
        update.run(typeof message.text === "string" ? message.text : null, JSON.stringify(message), row.rowid);
        opened++;
      }
      const field = (value: string, domain: string, id: string): string | null => {
        const keyId = sealedFieldKeyId(value);
        if (!keyId) return value;
        const key = byId.get(keyId);
        if (!key) return null;
        try { return openField(key.raw, value, fieldAad(key.keyId, key.owner, domain, id)); } catch { return null; }
      };
      if (hasTable(db, "chat_followups")) {
        for (const row of db.prepare("SELECT rowid AS rowid, id, payload FROM chat_followups").all() as Array<{ rowid: number; id: string; payload: string }>) {
          const plain = field(row.payload, "followup", row.id);
          if (plain === null) db.prepare("DELETE FROM chat_followups WHERE rowid = ?").run(row.rowid);
          else if (plain !== row.payload) db.prepare("UPDATE chat_followups SET payload = ? WHERE rowid = ?").run(plain, row.rowid);
        }
      }
      if (hasTable(db, "command_receipts")) {
        for (const row of db.prepare("SELECT rowid AS rowid, kind, key, result FROM command_receipts").all() as Array<{ rowid: number; kind: string; key: string; result: string }>) {
          const plain = field(row.result, "receipt", `${row.kind}\u0000${row.key}`);
          if (plain === null) db.prepare("DELETE FROM command_receipts WHERE rowid = ?").run(row.rowid);
          else if (plain !== row.result) db.prepare("UPDATE command_receipts SET result = ? WHERE rowid = ?").run(plain, row.rowid);
        }
      }
      // the copy keeps no key, binding or keyed token
      for (const trigger of ["messages_sealed_ad", "messages_sealed_au"]) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
      db.exec("DROP TABLE IF EXISTS messages_sealed_fts; DROP TABLE IF EXISTS message_index; DROP TABLE IF EXISTS content_keys; DROP TABLE IF EXISTS thread_keys; DROP TABLE IF EXISTS content_meta;");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
  return { opened, erased };
}
