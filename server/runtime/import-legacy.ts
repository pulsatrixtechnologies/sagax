// The one-time import of a room-handoff tree (the file the server kept
// before the job runtime) into assignment rows, so an update that lands
// while teammates are working loses nothing: the restart policy then
// treats the cut turns like any other. Ids, lineage, statuses and results
// carry over; the file is renamed, never deleted.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { z } from "zod";

import type { RuntimeStore } from "./store.ts";
import { TERMINAL, type Assignment, type Origin, type Status } from "./types.ts";

const legacyNode = z.object({
  id: z.string(), rootId: z.string(), parentId: z.string().optional(),
  groupId: z.string().optional(), threadId: z.string(), botId: z.string(),
  text: z.string().default(""), createdAt: z.number(),
  requestBatchKey: z.string().optional(),
  status: z.enum(["source", "queued", "running", "waiting", "resume", "completed", "failed", "cancelled"]),
  result: z.string().default(""), reported: z.boolean().default(false),
  executions: z.number().int().nonnegative().default(0), startedAt: z.number().optional(),
  lastProgressAt: z.number().optional(),
  approvalGranted: z.boolean().default(false),
  origin: z.object({ kind: z.literal("user"), request: z.string() }).or(z.object({ kind: z.literal("outside") })).optional(),
  restarts: z.number().int().nonnegative().default(0),
  restart: z.enum(["rerun", "cut", "teammates"]).optional(),
}).passthrough();
type LegacyNode = z.infer<typeof legacyNode>;

const STATUS: Record<LegacyNode["status"], Status> = {
  source: "running", queued: "queued", running: "running", waiting: "waiting", resume: "resume",
  completed: "completed", failed: "failed", cancelled: "cancelled",
};

function origin(node: LegacyNode): Origin {
  if (node.origin?.kind === "user") return { kind: "person", source: "chat", ref: node.threadId, quote: node.origin.request };
  return { kind: "outside", source: "chat", ref: node.threadId };
}

/** Imports `file` into the store and renames it `<file>.migrated`. Returns
 * the rows written (0 when there is no file). Rows that already exist are
 * left alone, so a crash between the writes and the rename is harmless. */
export function importLegacyHandoffs(store: RuntimeStore, file: string, now: number): number {
  if (!existsSync(file)) return 0;
  const nodes = z.array(legacyNode).parse(JSON.parse(readFileSync(file, "utf8")));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: LegacyNode): number => {
    let d = 0;
    for (let cur = n; cur.parentId && byId.has(cur.parentId) && d < 64; cur = byId.get(cur.parentId)!) d += 1;
    return d;
  };
  // Parents before children, so every row's lineage exists when it lands.
  const ordered = [...nodes].sort((a, b) => depth(a) - depth(b) || a.createdAt - b.createdAt);
  let written = 0;
  store.transaction(() => {
    for (const n of ordered) {
      if (store.get(n.id)) continue;
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      const root = byId.get(n.rootId) ?? n;
      const status = STATUS[n.status];
      const terminal = (TERMINAL as readonly Status[]).includes(status);
      const row: Assignment = {
        id: n.id, rootId: n.rootId, depth: depth(n),
        origin: origin(root),
        requester: parent
          ? { kind: "bot_turn", botId: parent.botId, threadId: parent.threadId }
          : { kind: "person", threadId: n.threadId, botId: n.botId },
        assignee: { botId: n.botId, destination: {
          kind: n.groupId ? "room_thread" : parent ? "work_thread" : "standing_thread", threadId: n.threadId,
          ...(n.groupId ? { groupId: n.groupId } : {}) } },
        mode: "work", reply: "resume", brief: n.text.slice(0, 12_000), status,
        level: "ask", levelSource: "own",
        executions: n.status === "source" ? Math.max(1, n.executions) : n.executions, restarts: n.restarts,
        createdAt: n.createdAt, lastActivityAt: n.lastProgressAt ?? n.startedAt ?? n.createdAt,
        result: n.result.slice(0, 12_000), rework: false, version: 1,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        ...(n.startedAt !== undefined ? { startedAt: n.startedAt } : {}),
        ...(n.restart ? { restart: n.restart } : {}),
        ...(n.approvalGranted ? { approved: true } : {}),
        ...(n.requestBatchKey ? { batchKey: n.requestBatchKey } : {}),
        ...(terminal ? { finishedAt: n.lastProgressAt ?? now, outcome: status === "completed" ? "done" : status === "failed" ? "provider_error" : "stopped",
          ...(n.reported ? { reportedAt: n.lastProgressAt ?? now } : {}) } : {}),
        ...(!parent ? { budgets: { since: now, requests: 0, executions: 0, wakes: 0 } } : {}),
      } as Assignment;
      store.insert(row, { kind: "enqueued", at: now, detail: `imported from room-handoffs.json as ${n.status}` });
      if (status === "running" || status === "waiting" || status === "resume") {
        store.update(row, { kind: "started", at: now, detail: `running: imported turn ${row.executions}, level ${row.level}` });
      }
      if (terminal) store.update(row, { kind: status === "cancelled" ? "cancelled" : "settled", at: now, detail: `${status}: imported` });
      written += 1;
    }
  });
  renameSync(file, `${file}.migrated`);
  return written;
}
