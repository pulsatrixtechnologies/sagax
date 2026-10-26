// Read-only snapshot of the Mac's Messages database (chat.db). The caller
// passes a directory it already copied. This module never opens
// ~/Library/Messages itself and never launches Messages.app.
import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

const APPLE_EPOCH = 978_307_200;

/** Apple's Cocoa timestamp (seconds, or nanoseconds since 2001-01-01). */
export function appleDate(raw: unknown): string | null {
  const value = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const seconds = value > 1e14 ? value / 1e9 : value;
  return new Date((seconds + APPLE_EPOCH) * 1000).toISOString();
}

/** Readable text out of an attributedBody blob when the text column is empty. */
export function textFromAttributedBody(blob: unknown): string | null {
  if (!(blob instanceof Uint8Array) && !Buffer.isBuffer(blob)) return null;
  const buf = Buffer.from(blob);
  const parts: string[] = [];
  for (let i = 0; i < buf.length - 1; i += 1) {
    if (buf[i] !== 0x2b) continue;
    const len = buf[i + 1];
    if (!len || i + 2 + len > buf.length) continue;
    const slice = buf.subarray(i + 2, i + 2 + len);
    if (slice.some((byte) => byte < 32 && byte !== 9)) continue;
    const text = slice.toString("utf8").trim();
    if (text.length >= 1) parts.push(text);
  }
  const joined = parts.join("");
  return joined ? joined.slice(0, 4_000) : null;
}

export type ChatRow = {
  id: number;
  guid: string;
  identifier: string;
  displayName?: string;
  service: string;
  handles: string[];
};

export type MessageRow = {
  id: number;
  guid: string;
  chatGuid: string;
  date: string | null;
  fromMe: boolean;
  handle?: string;
  service: string;
  text: string;
  fallback: boolean;
};

export type MessagesReader = {
  findChats(query?: { displayName?: string; handle?: string; limit?: number }): ChatRow[];
  items(chatGuid: string, limit?: number): MessageRow[];
  search(needle: string, limit?: number): MessageRow[];
};

function limitOf(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function rows(db: DatabaseSync, sql: string, args: Array<string | number> = []): Array<Record<string, unknown>> {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement.all(...args) as Array<Record<string, unknown>>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function openMessagesReader(dir: string): { reader: MessagesReader; close: () => void } {
  const file = join(dir, "chat.db");
  const db = new DatabaseSync(file, { readOnly: true });
  const handlesByChat = new Map<number, string[]>();
  try {
    for (const row of rows(db, `SELECT chat_id, handle.id AS handle
      FROM chat_handle_join JOIN handle ON handle.ROWID = handle_id`)) {
      const id = Number(row.chat_id);
      const list = handlesByChat.get(id) ?? [];
      const handle = str(row.handle);
      if (handle) list.push(handle);
      handlesByChat.set(id, list);
    }
  } catch {
    handlesByChat.clear();
  }
  const mapChat = (row: Record<string, unknown>): ChatRow => {
    const display = str(row.display_name).trim();
    return {
      id: Number(row.id),
      guid: str(row.guid),
      identifier: str(row.chat_identifier),
      ...(display ? { displayName: display } : {}),
      service: str(row.service_name) || "iMessage",
      handles: handlesByChat.get(Number(row.id)) ?? [],
    };
  };
  const bodyOf = (row: Record<string, unknown>): { text: string; fallback: boolean } => {
    const plain = str(row.text).trim();
    if (plain) return { text: plain.slice(0, 4_000), fallback: false };
    const extracted = textFromAttributedBody(row.attributedBody);
    return extracted ? { text: extracted, fallback: true } : { text: "", fallback: false };
  };
  const mapMessage = (row: Record<string, unknown>): MessageRow => {
    const body = bodyOf(row);
    const handle = str(row.handle).trim();
    return {
      id: Number(row.id),
      guid: str(row.guid),
      chatGuid: str(row.chat_guid),
      date: appleDate(row.date),
      fromMe: Number(row.is_from_me) === 1,
      ...(handle ? { handle } : {}),
      service: str(row.service) || "iMessage",
      text: body.text,
      fallback: body.fallback,
    };
  };
  const messageSql = `SELECT m.ROWID AS id, m.guid AS guid, c.guid AS chat_guid, m.date AS date,
      m.is_from_me AS is_from_me, m.text AS text, m.attributedBody AS attributedBody,
      m.service AS service, h.id AS handle
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    LEFT JOIN handle h ON h.ROWID = m.handle_id`;
  const reader: MessagesReader = {
    findChats(query = {}) {
      const cap = limitOf(query.limit, 20, 50);
      const all = rows(db, `SELECT ROWID AS id, guid, chat_identifier, display_name, service_name
        FROM chat ORDER BY ROWID DESC LIMIT 200`).map(mapChat);
      const handle = query.handle?.trim().toLowerCase();
      const name = query.displayName?.trim().toLowerCase();
      return all.filter((chat) => {
        if (handle && !chat.handles.some((item) => item.toLowerCase() === handle) && chat.identifier.toLowerCase() !== handle) return false;
        if (name && !(chat.displayName ?? "").toLowerCase().includes(name)) return false;
        return true;
      }).slice(0, cap);
    },
    items(chatGuid, limit) {
      const cap = limitOf(limit, 30, 100);
      return rows(db, `${messageSql} WHERE c.guid = ? ORDER BY m.date DESC LIMIT ?`, [chatGuid, cap]).map(mapMessage);
    },
    search(needle, limit) {
      const cap = limitOf(limit, 30, 100);
      const like = `%${needle.replace(/[\\%_]/g, "")}%`;
      return rows(db, `${messageSql} WHERE m.text LIKE ? ORDER BY m.date DESC LIMIT ?`, [like, cap]).map(mapMessage);
    },
  };
  return { reader, close: () => db.close() };
}

/** A file under `root` (realpath), or null when it is not. */
export function fileInsideRoot(root: string, target: string): string | null {
  if (!isAbsolute(root) || !isAbsolute(target)) return null;
  let base: string;
  let file: string;
  try {
    base = realpathSync(root);
    file = realpathSync(target);
  } catch {
    return null;
  }
  if (file !== base && !file.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  return file;
}

/** Read at most `maxBytes` from a file that stays inside `root`. */
export function readBoundedFile(root: string, target: string, maxBytes: number): Buffer | null {
  const file = fileInsideRoot(root, target);
  if (!file) return null;
  const info = statSync(file);
  if (!info.isFile() || info.size > maxBytes) return null;
  const handle = openSync(file, "r");
  try {
    const buf = Buffer.alloc(info.size);
    readSync(handle, buf, 0, info.size, 0);
    return buf;
  } finally {
    closeSync(handle);
  }
}

export function messagesDbPresent(dir: string): boolean {
  return existsSync(join(dir, "chat.db"));
}
