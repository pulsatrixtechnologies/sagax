// The durable store of the job runtime (docs/runtime-contract.md §1):
// one row per assignment, an append-only event per transition, and the
// inbox that is the one wake lane. node:sqlite like messages.db, so nothing
// new ships with the app; ":memory:" for the suite.
//
// The row's columns exist for lookups (tree, status, owners); the record
// itself travels whole in the json column and is validated (zod) once per
// distinct payload, so a row written by a newer or older build is refused,
// never half-read. Re-reads of the same json skip zod; JSON.parse still
// yields a fresh object so in-place mutations never share a cache entry.
// Every write the runtime cares about is one transaction: the row and its
// event land together or not at all (write-before-act).
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";

import { APPROVAL_MODES } from "../../shared/approval-mode.ts";
import { TERMINAL, type Assignment, type AssignmentEvent, type EventKind, type InboxItem, type Owner } from "./types.ts";

const evidenceSchema = z.object({
  commands: z.number().int().nonnegative().optional(),
  filesChanged: z.array(z.string()).optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  tools: z.array(z.string()).optional(),
  summary: z.string().optional(),
});

const assignmentSchema = z.object({
  id: z.string().min(1),
  rootId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  depth: z.number().int().nonnegative(),
  origin: z.object({
    kind: z.enum(["person", "routine", "outside"]),
    source: z.enum(["chat", "routine", "webhook", "relay", "external_runtime", "guest", "peer", "api"]),
    ref: z.string().optional(),
    quote: z.string().optional(),
    onBehalfOf: z.string().optional(),
  }),
  requester: z.object({
    kind: z.enum(["person", "bot_turn", "routine_run", "external_runtime"]),
    botId: z.string().optional(),
    threadId: z.string().optional(),
    runId: z.string().optional(),
    chief: z.boolean().optional(),
  }),
  assignee: z.object({
    botId: z.string().min(1),
    destination: z.object({
      kind: z.enum(["work_thread", "standing_thread", "room_thread"]),
      threadId: z.string().min(1),
      groupId: z.string().optional(),
    }),
  }),
  mode: z.enum(["work", "consult", "notify"]),
  reply: z.enum(["resume", "poll", "none"]),
  brief: z.string(),
  doneWhen: z.string().optional(),
  status: z.enum(["queued", "running", "needs_input", "waiting", "resume", "completed", "failed", "cancelled"]),
  outcome: z.enum(["done", "needs_input", "cap_continued", "stalled", "interrupted", "budget", "provider_error", "denied",
    "expired", "stopped", "refused", "duplicate", "incomplete"]).optional(),
  outcomeDetail: z.string().optional(),
  level: z.enum(APPROVAL_MODES),
  levelSource: z.enum(["own", "chief", "engine_cap"]),
  executions: z.number().int().nonnegative(),
  restarts: z.number().int().nonnegative(),
  restart: z.enum(["rerun", "cut", "teammates"]).optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  lastActivityAt: z.number(),
  finishedAt: z.number().optional(),
  result: z.string(),
  evidence: evidenceSchema.optional(),
  reportedAt: z.number().optional(),
  rework: z.boolean(),
  joins: z.string().optional(),
  person: z.string().optional(),
  request: z.string().optional(),
  question: z.string().optional(),
  answer: z.string().optional(),
  carrying: z.array(z.string()).optional(),
  budgets: z.object({ since: z.number(), requests: z.number(), executions: z.number(), wakes: z.number() }).optional(),
  approved: z.boolean().optional(),
  batchKey: z.string().optional(),
  relay: z.boolean().optional(),
  priority: z.literal("now").optional(),
  version: z.literal(1),
});

export interface RuntimeStore {
  readonly path: string;
  get(id: string): Assignment | undefined;
  /** Direct children, createdAt order. */
  children(id: string): Assignment[];
  /** Children of every assignment whose assignee is this bot+thread, excluding
   * room work (a child with a groupId). Indexed join on the parent's assignee
   * columns: the activity panel's per-thread read, never a full-table scan. */
  childrenOfAssignee(botId: string, threadId: string): Assignment[];
  /** The root of this id's tree. */
  root(id: string): Assignment | undefined;
  all(filter?: { rootId?: string; nonTerminal?: boolean; ownerThreadId?: string }): Assignment[];
  /** Insert a new row and its event in one transaction. */
  insert(a: Assignment, event: { kind: EventKind; detail?: string; at?: number }): void;
  /** Write the whole row and (optionally) an event in one transaction. */
  update(a: Assignment, event?: { kind: EventKind; detail?: string; at?: number }): void;
  /** Nested calls join the outer transaction (a savepoint inside it). */
  transaction<T>(fn: () => T): T;
  /** Oldest first. */
  events(assignmentId: string): AssignmentEvent[];
  addInbox(item: InboxItem): void;
  inbox(owner: Owner, undeliveredOnly?: boolean): InboxItem[];
  markDelivered(ids: string[], at: number): void;
  /** Remove terminal trees whose root finished before `before`; never a tree
   * with a non-terminal node. Returns assignment rows removed. */
  prune(before: number): number;
  /** Forget a confidential thread (docs/confidential-threads.md): every tree
   * it requested or ran work in goes whole when settled (rows, events, inbox);
   * in a tree still live, its own rows keep their ids and status but lose
   * their words (brief, result, question, answer, detail, evidence, quote)
   * and their events' details. */
  forgetThread(threadId: string): { removed: number; scrubbed: number };
  close(): void;
}

const terminalList = TERMINAL.map(s => `'${s}'`).join(", ");
/** A row that has not ended: the assignments_live index and all({ nonTerminal })
 * share this one term, since SQLite reads a partial index only for a WHERE
 * that repeats its own. */
const LIVE = `status NOT IN (${terminalList})`;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    parent_id TEXT,
    status TEXT NOT NULL,
    requester_thread_id TEXT,
    requester_run_id TEXT,
    assignee_bot_id TEXT NOT NULL,
    assignee_thread_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assignments_root ON assignments(root_id);
  CREATE INDEX IF NOT EXISTS assignments_parent ON assignments(parent_id);
  CREATE INDEX IF NOT EXISTS assignments_status ON assignments(status);
  CREATE INDEX IF NOT EXISTS assignments_requester_thread ON assignments(requester_thread_id);
  CREATE INDEX IF NOT EXISTS assignments_requester_run ON assignments(requester_run_id);
  CREATE INDEX IF NOT EXISTS assignments_assignee ON assignments(assignee_bot_id, assignee_thread_id);
  -- The live rows in all()'s order. NOT IN cannot use assignments_status, so
  -- without this every nonTerminal read walks the ended rows too, and those
  -- only grow. Created on every open, so an existing file gets it too;
  -- IF NOT EXISTS keeps an older definition, so a change to TERMINAL renames it.
  CREATE INDEX IF NOT EXISTS assignments_live ON assignments(created_at) WHERE ${LIVE};
  CREATE TABLE IF NOT EXISTS assignment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS assignment_events_assignment ON assignment_events(assignment_id, id);
  CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY,
    owner_bot_id TEXT,
    owner_thread_id TEXT,
    owner_run_id TEXT,
    assignment_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS inbox_thread ON inbox(owner_thread_id, delivered_at);
  CREATE INDEX IF NOT EXISTS inbox_run ON inbox(owner_run_id, delivered_at);
  CREATE INDEX IF NOT EXISTS inbox_assignment ON inbox(assignment_id);
`;

const TOUCHING = "SELECT DISTINCT root_id FROM assignments WHERE requester_thread_id = ? OR assignee_thread_id = ?";

function removeTree(db: DatabaseSync, rootId: string): number {
  db.prepare("DELETE FROM assignment_events WHERE assignment_id IN (SELECT id FROM assignments WHERE root_id = ?)").run(rootId);
  db.prepare("DELETE FROM inbox WHERE assignment_id IN (SELECT id FROM assignments WHERE root_id = ?)").run(rootId);
  return Number(db.prepare("DELETE FROM assignments WHERE root_id = ?").run(rootId).changes);
}

/** A copy of the runtime database without any tree one of these threads
 * requested or ran work in, live or settled: what a workspace backup keeps
 * when the threads are confidential (server/workspace-backup.ts). The caller
 * owns the transaction and the vacuum. Returns assignment rows removed. */
export function removeThreadTrees(db: DatabaseSync, threads: Iterable<string>): number {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'").get();
  if (!hasTable) return 0;
  const touching = db.prepare(TOUCHING);
  let removed = 0;
  for (const threadId of threads) {
    for (const row of touching.all(threadId, threadId) as Row[]) removed += removeTree(db, String(row.root_id));
  }
  return removed;
}

type Row = Record<string, unknown>;

/** Parse and validate one row. Callers that re-read the same id between
 * writes go through the per-store cache in openRuntimeStore instead. */
function parseAssignment(row: Row): Assignment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row.json));
  } catch (error) {
    throw new Error(`runtime.db: assignment ${String(row.id)} holds invalid JSON (${String(error)})`);
  }
  const result = assignmentSchema.safeParse(parsed);
  if (!result.success) throw new Error(`runtime.db: assignment ${String(row.id)} does not match the record schema: ${result.error.message}`);
  return result.data;
}

/** JSON drops undefined fields; the row read back must equal the row
 * written, so optional fields are never written as null. */
const toJson = (a: Assignment): string => JSON.stringify(a);

function readInbox(row: Row): InboxItem {
  const item: InboxItem = {
    id: String(row.id), assignmentId: String(row.assignment_id),
    kind: row.kind as InboxItem["kind"], createdAt: Number(row.created_at),
  };
  if (row.owner_bot_id != null) item.ownerBotId = String(row.owner_bot_id);
  if (row.owner_thread_id != null) item.ownerThreadId = String(row.owner_thread_id);
  if (row.owner_run_id != null) item.ownerRunId = String(row.owner_run_id);
  if (row.delivered_at != null) item.deliveredAt = Number(row.delivered_at);
  return item;
}

function readEvent(row: Row): AssignmentEvent {
  const event: AssignmentEvent = {
    id: Number(row.id), assignmentId: String(row.assignment_id), at: Number(row.at), kind: row.kind as EventKind,
  };
  if (row.detail != null) event.detail = String(row.detail);
  return event;
}

export function openRuntimeStore(path: string): RuntimeStore {
  const memory = path === ":memory:";
  if (!memory) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Briefs and results are private conversations: owner-only from the
    // first byte, and repaired on a file that inherited a loose umask.
    closeSync(openSync(path, "a", 0o600));
    try {
      chmodSync(path, 0o600);
    } catch {}
  }
  const db = new DatabaseSync(path);
  if (!memory) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  // A forgotten thread's words are overwritten on disk, not left in a free
  // page (forgetThread, docs/confidential-threads.md).
  db.exec("PRAGMA secure_delete = ON");
  db.exec(SCHEMA);

  // Zod once per distinct json payload. Each read still JSON.parse's so
  // callers that mutate the returned object (then update, or fail mid-write)
  // never share a cached reference. The expensive part of the old
  // activityChildren stall was assignmentSchema.safeParse over every row.
  const VALIDATED_CACHE_MAX = 4096;
  const validated = new Map<string, string>();
  const readAssignment = (row: Row): Assignment => {
    const id = String(row.id);
    const json = String(row.json);
    if (validated.get(id) === json) {
      try {
        return JSON.parse(json) as Assignment;
      } catch (error) {
        validated.delete(id);
        throw new Error(`runtime.db: assignment ${id} holds invalid JSON (${String(error)})`);
      }
    }
    const data = parseAssignment(row);
    validated.delete(id);
    validated.set(id, json);
    // Bounded: the oldest validated payload goes first (Map keeps insertion order).
    if (validated.size > VALIDATED_CACHE_MAX) validated.delete(validated.keys().next().value!);
    return data;
  };
  const invalidate = (id: string) => { validated.delete(id); };

  const statements = {
    get: db.prepare("SELECT id, json FROM assignments WHERE id = ?"),
    children: db.prepare("SELECT id, json FROM assignments WHERE parent_id = ? ORDER BY created_at, rowid"),
    // Parent assignee columns are indexed (assignments_assignee); the join
    // never walks every assignment the way all() does.
    childrenOfAssignee: db.prepare(`SELECT c.id, c.json FROM assignments c
      INNER JOIN assignments p ON c.parent_id = p.id
      WHERE p.assignee_bot_id = ? AND p.assignee_thread_id = ?
      ORDER BY c.created_at, c.rowid`),
    insert: db.prepare(`INSERT INTO assignments (id, root_id, parent_id, status, requester_thread_id, requester_run_id,
      assignee_bot_id, assignee_thread_id, created_at, finished_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`UPDATE assignments SET root_id = ?, parent_id = ?, status = ?, requester_thread_id = ?,
      requester_run_id = ?, assignee_bot_id = ?, assignee_thread_id = ?, created_at = ?, finished_at = ?, json = ? WHERE id = ?`),
    event: db.prepare("INSERT INTO assignment_events (assignment_id, at, kind, detail) VALUES (?, ?, ?, ?)"),
    events: db.prepare("SELECT id, assignment_id, at, kind, detail FROM assignment_events WHERE assignment_id = ? ORDER BY id"),
    addInbox: db.prepare(`INSERT INTO inbox (id, owner_bot_id, owner_thread_id, owner_run_id, assignment_id, kind, created_at, delivered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    deliver: db.prepare("UPDATE inbox SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL"),
    prunable: db.prepare(`SELECT id FROM assignments r WHERE r.parent_id IS NULL AND r.status IN (${terminalList})
      AND r.finished_at IS NOT NULL AND r.finished_at < ?
      AND NOT EXISTS (SELECT 1 FROM assignments c WHERE c.root_id = r.id AND c.status NOT IN (${terminalList}))`),
    pruneEvents: db.prepare("DELETE FROM assignment_events WHERE assignment_id IN (SELECT id FROM assignments WHERE root_id = ?)"),
    pruneInbox: db.prepare("DELETE FROM inbox WHERE assignment_id IN (SELECT id FROM assignments WHERE root_id = ?)"),
    pruneRows: db.prepare("DELETE FROM assignments WHERE root_id = ?"),
  };

  // Nested writes use savepoints, as message-db.ts does: a caught inner
  // error never commits half of an inner step, and the outermost call
  // still owns durability.
  let depth = 0;
  function transaction<T>(fn: () => T): T {
    if (depth > 0) {
      const savepoint = `runtime_${depth}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      depth += 1;
      try {
        const result = fn();
        db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
        throw error;
      } finally { depth -= 1; }
    }
    db.exec("BEGIN IMMEDIATE");
    depth = 1;
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally { depth = 0; }
  }

  const columns = (a: Assignment): SQLInputValue[] => [
    a.rootId, a.parentId ?? null, a.status, a.requester.threadId ?? null, a.requester.runId ?? null,
    a.assignee.botId, a.assignee.destination.threadId, a.createdAt, a.finishedAt ?? null, toJson(a),
  ];
  const writeEvent = (id: string, event: { kind: EventKind; detail?: string; at?: number }) => {
    statements.event.run(id, event.at ?? Date.now(), event.kind, event.detail ?? null);
  };

  return {
    path,
    get(id) {
      const row = statements.get.get(id) as Row | undefined;
      return row ? readAssignment(row) : undefined;
    },
    children(id) {
      return (statements.children.all(id) as Row[]).map(readAssignment);
    },
    childrenOfAssignee(botId, threadId) {
      const out: Assignment[] = [];
      for (const row of statements.childrenOfAssignee.all(botId, threadId) as Row[]) {
        const child = readAssignment(row);
        // Room handoffs carry a groupId; the activity panel's direct-thread
        // children list skips them (same filter as activityChildren).
        if (child.assignee.destination.groupId !== undefined) continue;
        out.push(child);
      }
      return out;
    },
    root(id) {
      const row = statements.get.get(id) as Row | undefined;
      if (!row) return undefined;
      const a = readAssignment(row);
      if (a.rootId === a.id) return a;
      const rootRow = statements.get.get(a.rootId) as Row | undefined;
      return rootRow ? readAssignment(rootRow) : undefined;
    },
    all(filter = {}) {
      const where: string[] = [];
      const params: SQLInputValue[] = [];
      if (filter.rootId !== undefined) { where.push("root_id = ?"); params.push(filter.rootId); }
      if (filter.nonTerminal) where.push(LIVE);
      if (filter.ownerThreadId !== undefined) { where.push("requester_thread_id = ?"); params.push(filter.ownerThreadId); }
      const sql = `SELECT id, json FROM assignments${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, rowid`;
      return (db.prepare(sql).all(...params) as Row[]).map(readAssignment);
    },
    insert(a, event) {
      transaction(() => {
        statements.insert.run(a.id, ...columns(a));
        writeEvent(a.id, event);
        invalidate(a.id);
      });
    },
    update(a, event) {
      transaction(() => {
        const changes = statements.update.run(...columns(a), a.id).changes;
        if (changes === 0) throw new Error(`runtime.db: assignment ${a.id} does not exist`);
        if (event) writeEvent(a.id, event);
        invalidate(a.id);
      });
    },
    transaction,
    events(assignmentId) {
      return (statements.events.all(assignmentId) as Row[]).map(readEvent);
    },
    addInbox(item) {
      statements.addInbox.run(item.id, item.ownerBotId ?? null, item.ownerThreadId ?? null, item.ownerRunId ?? null,
        item.assignmentId, item.kind, item.createdAt, item.deliveredAt ?? null);
    },
    inbox(owner, undeliveredOnly = false) {
      // Every field the caller names must match: a thread owner with a bot
      // id reads only that bot's lane; an external runtime reads by run id.
      const where: string[] = [];
      const params: SQLInputValue[] = [];
      if (owner.botId !== undefined) { where.push("owner_bot_id = ?"); params.push(owner.botId); }
      if (owner.threadId !== undefined) { where.push("owner_thread_id = ?"); params.push(owner.threadId); }
      if (owner.runId !== undefined) { where.push("owner_run_id = ?"); params.push(owner.runId); }
      if (where.length === 0) return [];
      if (undeliveredOnly) where.push("delivered_at IS NULL");
      const sql = `SELECT * FROM inbox WHERE ${where.join(" AND ")} ORDER BY created_at, rowid`;
      return (db.prepare(sql).all(...params) as Row[]).map(readInbox);
    },
    markDelivered(ids, at) {
      if (ids.length === 0) return;
      transaction(() => {
        for (const id of ids) statements.deliver.run(at, id);
      });
    },
    prune(before) {
      return transaction(() => {
        const roots = (statements.prunable.all(before) as Row[]).map(row => String(row.id));
        let removed = 0;
        for (const rootId of roots) {
          statements.pruneEvents.run(rootId);
          statements.pruneInbox.run(rootId);
          removed += Number(statements.pruneRows.run(rootId).changes);
        }
        if (roots.length) validated.clear();
        return removed;
      });
    },
    forgetThread(threadId) {
      let changed = 0;
      const forgotten = transaction(() => {
        let removed = 0;
        let scrubbed = 0;
        for (const row of db.prepare(TOUCHING).all(threadId, threadId) as Row[]) {
          const rootId = String(row.root_id);
          // Decided on the columns, so a row this build cannot read never
          // stops the forget. A settled tree the thread asked goes whole; in
          // any other (another conversation's, or still live) only its own
          // rows lose their words: the asker keeps its other teammates.
          const live = db.prepare(`SELECT 1 FROM assignments WHERE root_id = ? AND status NOT IN (${terminalList}) LIMIT 1`).get(rootId);
          const root = db.prepare("SELECT assignee_thread_id FROM assignments WHERE id = ?").get(rootId) as Row | undefined;
          if (!live && root?.assignee_thread_id === threadId) {
            removed += removeTree(db, rootId);
            validated.clear();
            continue;
          }
          for (const raw of db.prepare("SELECT id, json, requester_thread_id, assignee_thread_id FROM assignments WHERE root_id = ?").all(rootId) as Row[]) {
            const own = raw.requester_thread_id === threadId || raw.assignee_thread_id === threadId;
            let a: Assignment;
            try {
              a = readAssignment(raw);
            } catch {
              // unreadable: an own row goes rather than keep its words
              if (own) {
                db.prepare("DELETE FROM assignment_events WHERE assignment_id = ?").run(String(raw.id));
                db.prepare("DELETE FROM inbox WHERE assignment_id = ?").run(String(raw.id));
                db.prepare("DELETE FROM assignments WHERE id = ?").run(String(raw.id));
                invalidate(String(raw.id));
                removed += 1;
                changed += 1;
              }
              continue;
            }
            const quoted = a.origin.ref === threadId && a.origin.quote !== undefined;
            if (!own && !quoted) continue;
            const before = toJson(a);
            if (quoted) delete a.origin.quote;
            if (own) {
              a.brief = "";
              a.result = "";
              delete a.question;
              delete a.answer;
              delete a.outcomeDetail;
              delete a.evidence;
              delete a.doneWhen;
              const details = db.prepare("UPDATE assignment_events SET detail = NULL WHERE assignment_id = ? AND detail IS NOT NULL").run(a.id);
              changed += Number(details.changes);
            }
            if (toJson(a) === before) continue;
            if (own) scrubbed += 1;
            changed += 1;
            statements.update.run(...columns(a), a.id);
            // The cached object was mutated above; drop it so the next read
            // sees the scrubbed json from the row.
            invalidate(a.id);
          }
        }
        return { removed, scrubbed };
      });
      // and out of the write-ahead log, which still holds the old pages (a
      // reader holding it leaves them to the next checkpoint)
      if (!memory && (forgotten.removed || changed)) {
        try { db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get(); } catch { /* the next checkpoint does it */ }
      }
      return forgotten;
    },
    close() {
      validated.clear();
      db.close();
    },
  };
}
