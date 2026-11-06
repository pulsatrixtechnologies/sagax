import type { DatabaseSync } from "node:sqlite";

/** The bot's memory files — MEMORY.md, memory/<topic>.md, memory/log/<day>.md —
 * indexed for the same session_search. One row per file, with the size and
 * mtime it was indexed at so a search can notice a file the bot's own file
 * tools rewrote without any filesystem watcher. Kept in this database because
 * FTS5 is already here; the files themselves stay the source of truth on disk
 * and this table is rebuilt from them at any time. */
export function ensureMemoryIndex(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_files (
      bot_id TEXT NOT NULL,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (bot_id, path)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      text, content='memory_files', content_rowid='rowid', tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_files BEGIN
      INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory_files BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memory_files BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);
  // Sealed memory rows (docs/content-encryption.md): `text` empty, the text
  // in `sealed` under the bot's key, its keyed words and prefixes in a
  // contentless FTS5 table, like the transcripts' blind index.
  const columns = new Set((db.prepare("PRAGMA table_info(memory_files)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("sealed")) db.exec("ALTER TABLE memory_files ADD COLUMN sealed BLOB");
  if (!columns.has("key_id")) db.exec("ALTER TABLE memory_files ADD COLUMN key_id TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS memory_files_key_id ON memory_files(key_id) WHERE key_id IS NOT NULL;
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_sealed_fts USING fts5(
      words, prefixes, content='', contentless_delete=1, detail=column
    );
    CREATE TRIGGER IF NOT EXISTS memory_sealed_ad AFTER DELETE ON memory_files WHEN old.key_id IS NOT NULL BEGIN
      DELETE FROM memory_sealed_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS memory_sealed_au AFTER UPDATE OF sealed, key_id ON memory_files WHEN old.key_id IS NOT NULL BEGIN
      DELETE FROM memory_sealed_fts WHERE rowid = old.rowid;
    END;
  `);
}
