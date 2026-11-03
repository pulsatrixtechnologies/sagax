// Persistent "seen" keys for typed-trigger pollers (DEL-04): a calendar
// instance or IMAP message already handed to ingest must not be re-logged
// after a process restart. One SQLite file under DATA_DIR; keys age out
// after 30 days. No secrets: keys are trigger id + provider-stable dedupe
// tokens already used by WebhookManager.ingest.
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Drop a seen key this long after it was recorded. */
export const SEEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS seen (
    trigger_id TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (trigger_id, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS seen_at_idx ON seen(seen_at);
  CREATE INDEX IF NOT EXISTS seen_trigger_idx ON seen(trigger_id);
`;

export interface TriggerSeenStore {
  readonly path: string;
  has(triggerId: string, key: string): boolean;
  /** Record that this key was handed over. Idempotent. */
  add(triggerId: string, key: string, at?: number): void;
  /** Drop every key of a removed trigger. */
  forget(triggerId: string): number;
  /** Delete rows older than the retention window. Returns how many went. */
  purge(now?: number): number;
  close(): void;
}

export interface TriggerSeenStoreOptions {
  /** Wall clock; tests freeze it. */
  now?: () => number;
  /** Retention window; defaults to 30 days. */
  retentionMs?: number;
}

export function openTriggerSeenStore(path: string, options: TriggerSeenStoreOptions = {}): TriggerSeenStore {
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? SEEN_RETENTION_MS;
  const memory = path === ":memory:";
  if (!memory) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    try {
      chmodSync(path, 0o600);
    } catch {
      /* windows */
    }
  }
  const db = new DatabaseSync(path);
  if (!memory) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  db.exec(SCHEMA);

  const hasStmt = db.prepare("SELECT 1 AS ok FROM seen WHERE trigger_id = ? AND dedupe_key = ? LIMIT 1");
  const addStmt = db.prepare(
    "INSERT INTO seen(trigger_id, dedupe_key, seen_at) VALUES (?, ?, ?) ON CONFLICT(trigger_id, dedupe_key) DO UPDATE SET seen_at = excluded.seen_at",
  );
  const forgetStmt = db.prepare("DELETE FROM seen WHERE trigger_id = ?");
  const purgeStmt = db.prepare("DELETE FROM seen WHERE seen_at < ?");

  const store: TriggerSeenStore = {
    path,
    has(triggerId, key) {
      return Boolean(hasStmt.get(triggerId, key));
    },
    add(triggerId, key, at = now()) {
      addStmt.run(triggerId, key, at);
    },
    forget(triggerId) {
      return Number(forgetStmt.run(triggerId).changes);
    },
    purge(at = now()) {
      return Number(purgeStmt.run(at - retentionMs).changes);
    },
    close() {
      db.close();
    },
  };

  store.purge();
  return store;
}
