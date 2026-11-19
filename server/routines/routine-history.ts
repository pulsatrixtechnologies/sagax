// A routine's change history (#4940): one row per creation, edit or
// deletion, with who wrote it (server/history-writer.ts). Append-only NDJSON
// in the bot's folder, beside the profile history, 0600, serialized per
// file and fire-and-forget: a history write never fails the change it
// records. The routine's text is not copied here; only the fields named.
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

import { botFolder } from "../bots/bot-folder.ts";
import type { HistoryWriter } from "../history-writer.ts";

export type RoutineChangeAction = "create" | "update" | "delete";

export interface RoutineHistoryRow {
  id: string;
  at: number;
  routineId: string;
  action: RoutineChangeAction;
  /** The fields an update sent (never their values). */
  fields: string[];
  writer?: HistoryWriter;
}

const FILE_NAME = "routine-history.ndjson";
const MAX_READ_BYTES = 2 * 1024 * 1024;
const queues = new Map<string, Promise<void>>();

export function routineHistoryFile(botId: string): string {
  return join(botFolder(botId), FILE_NAME);
}

/** Fields worth naming: what the person or the agent changed, not the
 * bookkeeping a client sends along. */
const NOT_FIELDS = new Set(["id", "botId", "expected_version", "expectedUpdatedAt"]);

export function recordRoutineChange(
  botId: string,
  routineId: string,
  action: RoutineChangeAction,
  body: unknown,
  writer: HistoryWriter | undefined,
  now = Date.now(),
): void {
  if (!botId || !routineId) return;
  const fields = action === "update" && body && typeof body === "object" && !Array.isArray(body)
    ? Object.keys(body as Record<string, unknown>).filter((key) => !NOT_FIELDS.has(key)).sort().slice(0, 40)
    : [];
  const row: RoutineHistoryRow = { id: randomUUID(), at: now, routineId, action, fields, ...(writer ? { writer } : {}) };
  const previous = queues.get(botId) ?? Promise.resolve();
  const queued = previous.then(async () => {
    // A bot deleted meanwhile keeps no folder to recreate.
    if (!existsSync(botFolder(botId))) return;
    await appendFile(routineHistoryFile(botId), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  }).catch(() => {
    /* history never takes down the change it records */
  });
  queues.set(botId, queued);
  void queued.finally(() => {
    if (queues.get(botId) === queued) queues.delete(botId);
  });
}

/** Test and shutdown seam. */
export async function flushRoutineHistory(botId: string): Promise<void> {
  await queues.get(botId);
}

const isRow = (value: unknown): value is RoutineHistoryRow =>
  typeof value === "object" && value !== null &&
  typeof (value as RoutineHistoryRow).at === "number" &&
  typeof (value as RoutineHistoryRow).routineId === "string" &&
  typeof (value as RoutineHistoryRow).action === "string";

/** One routine's changes, newest first, from the newest 2 MiB of its bot's log. */
export function readRoutineHistory(botId: string, routineId: string, limit = 50): RoutineHistoryRow[] {
  let text: string;
  let offset: number;
  try {
    const fd = openSync(routineHistoryFile(botId), "r");
    try {
      const size = fstatSync(fd).size;
      offset = Math.max(0, size - MAX_READ_BYTES);
      const buffer = Buffer.alloc(size - offset);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, offset + length);
        if (!count) break;
        length += count;
      }
      text = buffer.subarray(0, length).toString("utf8");
    } finally { closeSync(fd); }
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const rows: RoutineHistoryRow[] = [];
  const max = Math.min(500, Math.max(1, limit));
  for (let index = lines.length - 1; index >= (offset > 0 ? 1 : 0) && rows.length < max; index--) {
    const line = lines[index];
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRow(value) && value.routineId === routineId) rows.push(value);
    } catch {
      /* torn line: skip */
    }
  }
  return rows;
}
