// Memory signals to Perspicax (2026-10-11, Perspicax lot A.8; its
// docs/memory.md "Work log" and "Duplicate detector").
//
// Perspicax keeps a work log of the organization and a duplicate detector
// over it. A vendor write through its connector is logged by Perspicax
// itself; what it cannot see is a Sagax bot starting work. This module
// tells it, with the link token:
//
//   - POST /api/v1/memory/work: one row when a bot turn on an organization
//     server starts with the Perspicax account connection mounted (a vendor-touching task).
//     Rows are batched (at most WORK_BATCH_MAX = 50, Perspicax's cap, and
//     one person per batch) and sent a moment later, one batch in flight at
//     a time.
//   - POST /api/v1/memory/duplicates: before a routine run, its instructions
//     are checked; a hint ("someone did this on <day>, work:<id>") is
//     attached to the run and given to the bot with the run's prompt.
//
// Rules, none optional:
//   - fail open: nothing here ever blocks or fails a turn or a run. Every
//     call has a short timeout; a failure is logged once per kind, the rows
//     of a failed batch are dropped (the work log is a hint, not a ledger);
//   - only what the Perspicax contract carries: a work row is metadata (the
//     bot's and profiles' names, ids, the action and a link), never a
//     message; the duplicate check sends the routine's own instructions,
//     which Perspicax reads for their words and never stores (at most
//     DUPLICATE_TEXT_MAX characters);
//   - a person is named by their Perspicax user id only; a turn with no
//     Perspicax person (the server's operator, an unknown speaker) sends
//     nothing; each call carries that person's own token next to the link
//     token when there is one (`subject`, PerspicaxDirectory.linkPostJson);
//   - no token, prompt or answer body is ever logged.
import type { LinkPostLimits, LinkPostResult } from "../perspicax/perspicax-link.ts";

export const WORK_PATH = "/api/v1/memory/work";
export const DUPLICATES_PATH = "/api/v1/memory/duplicates";
export const FEEDBACK_PATH = "/api/v1/memory/feedback";
/** Perspicax's cap per POST /memory/work. */
export const WORK_BATCH_MAX = 50;
/** Rows waiting at most; beyond, the oldest are dropped. */
export const WORK_QUEUE_MAX = 500;
/** A row waits this long for others before its batch leaves. */
export const WORK_FLUSH_DELAY_MS = 2_000;
export const WORK_TIMEOUT_MS = 5_000;
/** The duplicate check is on a run's path: keep it short. */
export const DUPLICATES_TIMEOUT_MS = 1_500;
export const DUPLICATE_TEXT_MAX = 4_000;
export const INTENT_MAX = 140;
export const OBJECTS_MAX = 10;
export const LINK_MAX = 512;
const ANSWER_MAX_BYTES = 64 * 1024;
const HINTS_MAX = 3;
const REF = /^[A-Za-z0-9._:/-]{1,128}$/;
/** Perspicax's tag shape (memory::entry::valid_tag), with the namespace it asks for. */
const TAG = /^(?=.{1,64}$)[a-z0-9][a-z0-9_./-]*:[a-z0-9:._/-]+$/;

export type WorkAction = "run" | "turn" | "create" | "update" | "delete" | "action" | "other";
export type WorkResult = "ok" | "error" | "refused" | "partial";

/** One row of POST /api/v1/memory/work, as Perspicax reads it. */
export interface WorkRow {
  /** The Perspicax user id of the person the bot acted for. */
  person: string;
  /** `bot` (a bot run, a routine run) or `person` (a turn the person typed). */
  actor_kind: "bot" | "person";
  intent: string;
  action: WorkAction;
  objects: string[];
  result: WorkResult;
  link?: string;
  tags?: string[];
}

/** One duplicate hint as Perspicax answers it (only the fields Sagax keeps). */
export interface DuplicateHint {
  hintId: string;
  pointer: string;
  day: string;
  who: string;
  score: number;
  readable: boolean;
  intent?: string;
  link?: string;
}

/** What a routine run keeps of the check (RoutineRun.memoryHint). */
export interface RunMemoryHint {
  /** Perspicax's turn id, for a later feedback. */
  turn: string;
  checkedAt: number;
  duplicates: DuplicateHint[];
}

export interface MemorySignalsLink {
  linkPostJson(path: string, body: unknown, limits: LinkPostLimits): Promise<LinkPostResult>;
}

export interface PerspicaxMemoryOptions {
  link: () => MemorySignalsLink | null;
  now?: () => number;
  log?: (line: string) => void;
  flushDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
}

function isLineBreakOrControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
}

/** One line of at most `max` characters: control characters and line breaks
 * become spaces, runs of spaces fold. */
export function oneLine(text: string, max: number): string {
  const folded = [...text].map((char) => (isLineBreakOrControl(char) ? " " : char)).join("").replace(/\s+/g, " ").trim();
  return [...folded].slice(0, max).join("").trimEnd();
}

/** A work row Perspicax will accept, or null (a bad person, action or
 * result). Objects that are not refs, a link that is not an http(s) URL or a
 * path, and anything past the caps are dropped rather than refused, so one
 * odd value never loses the whole batch. */
export function checkedWorkRow(row: WorkRow): WorkRow | null {
  const person = row.person.trim();
  if (!person || person.length > 128) return null;
  if (row.actor_kind !== "bot" && row.actor_kind !== "person") return null;
  if (!["run", "turn", "create", "update", "delete", "action", "other"].includes(row.action)) return null;
  if (!["ok", "error", "refused", "partial"].includes(row.result)) return null;
  const objects = [...new Set(row.objects.filter((ref) => REF.test(ref)))].slice(0, OBJECTS_MAX);
  const link = row.link && row.link.length <= LINK_MAX && !/\s/.test(row.link) && /^(https?:\/\/|\/)/.test(row.link) ? row.link : undefined;
  const tags = (row.tags ?? []).filter((tag) => TAG.test(tag)).slice(0, 16);
  return {
    person,
    actor_kind: row.actor_kind,
    intent: oneLine(row.intent, INTENT_MAX),
    action: row.action,
    objects,
    result: row.result,
    ...(link ? { link } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

function parseHint(value: unknown): DuplicateHint | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string, max: number) => (typeof record[key] === "string" ? oneLine(record[key] as string, max) : "");
  const hintId = text("hint_id", 128);
  const pointer = text("pointer", 160);
  if (!hintId || !/^work:[A-Za-z0-9._:-]{1,150}$/.test(pointer)) return null;
  const readable = record.readable === true;
  const score = typeof record.score === "number" && Number.isFinite(record.score) ? Math.max(0, Math.min(1, record.score)) : 0;
  const intent = readable ? text("intent", INTENT_MAX) : "";
  const link = readable ? text("link", LINK_MAX) : "";
  return {
    hintId,
    pointer,
    day: text("day", 10),
    who: text("who", 80) || "a colleague",
    score,
    readable,
    ...(intent ? { intent } : {}),
    ...(link && /^(https?:\/\/|\/)/.test(link) ? { link } : {}),
  };
}

/** The note a routine run's bot reads when Perspicax found similar work. */
export function duplicateNote(hint: RunMemoryHint): string {
  if (!hint.duplicates.length) return "";
  const lines = hint.duplicates.map((entry) => {
    const what = entry.readable && entry.intent ? `: ${entry.intent}` : "";
    return `- ${entry.pointer} (${entry.day || "recently"}, ${entry.who})${what}`;
  });
  return [
    "Note from the organization memory (Perspicax): similar work was done or started recently.",
    ...lines,
    "Before redoing it, open a pointer with the work_open tool, or ask its author with ask_person (person work:<id>), when your tools offer them.",
  ].join("\n");
}

/** The memory signals of one organization server. */
export class PerspicaxMemory {
  private readonly options: PerspicaxMemoryOptions;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private queue: WorkRow[] = [];
  private timer: { unref?: () => void } | null = null;
  private inflight: Promise<void> | null = null;
  private readonly logged = new Set<string>();
  private dropped = 0;

  constructor(options: PerspicaxMemoryOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  private once(kind: string, line: string): void {
    if (this.logged.has(kind)) return;
    this.logged.add(kind);
    this.log(line);
  }

  /** Queue one work row; it leaves with the next batch. Never throws. */
  recordWork(row: WorkRow): void {
    const checked = checkedWorkRow(row);
    if (!checked) return;
    this.queue.push(checked);
    if (this.queue.length > WORK_QUEUE_MAX) {
      const over = this.queue.length - WORK_QUEUE_MAX;
      this.queue.splice(0, over);
      this.dropped += over;
      this.once("queue", `perspicax memory: work rows dropped (more than ${WORK_QUEUE_MAX} waiting)`);
    }
    this.schedule();
  }

  /** Rows waiting to leave (tests and diagnostics). */
  pending(): number {
    return this.queue.length;
  }

  private schedule(): void {
    if (this.timer || this.inflight) return;
    const set = this.options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const timer = set(() => {
      this.timer = null;
      void this.flush();
    }, this.options.flushDelayMs ?? WORK_FLUSH_DELAY_MS);
    timer.unref?.();
    this.timer = timer;
  }

  /** Send what waits, batch by batch (one in flight). Never throws. */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.drain().finally(() => {
      this.inflight = null;
      if (this.queue.length) this.schedule();
    });
    return this.inflight;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const link = this.options.link();
      if (!link) {
        this.dropped += this.queue.length;
        this.queue = [];
        return;
      }
      const batch = this.nextBatch();
      let result: LinkPostResult;
      try {
        result = await link.linkPostJson(WORK_PATH, { rows: batch }, { timeoutMs: WORK_TIMEOUT_MS, maxBytes: ANSWER_MAX_BYTES, subject: batch[0]!.person });
      } catch {
        result = { ok: false, error: "unreachable" };
      }
      if (!result.ok) {
        this.dropped += batch.length;
        // 404: a Perspicax before the work feed; 409: its memory is off.
        const why = result.status === 404 ? "this Perspicax has no work feed" : result.status === 409 ? "the organization memory is off" : result.error;
        this.once(`work:${result.status ?? result.error}`, `perspicax memory: ${batch.length} work row(s) not recorded (${why})`);
      }
    }
  }

  /** The next batch: the oldest row's person, their rows in order, at most
   * WORK_BATCH_MAX. One person per batch, so it goes with that person's own
   * token. The other rows keep their place. */
  private nextBatch(): WorkRow[] {
    const person = this.queue[0]!.person;
    const batch: WorkRow[] = [];
    const rest: WorkRow[] = [];
    for (const row of this.queue) {
      if (row.person === person && batch.length < WORK_BATCH_MAX) batch.push(row);
      else rest.push(row);
    }
    this.queue = rest;
    return batch;
  }

  /** Ask Perspicax whether this work was already done. Null on any failure
   * or when nothing similar is known. Bounded by DUPLICATES_TIMEOUT_MS. */
  async checkDuplicates(input: { person: string; text: string; objects?: string[]; tags?: string[]; participants?: string[] }): Promise<RunMemoryHint | null> {
    const person = input.person.trim();
    const text = [...input.text].slice(0, DUPLICATE_TEXT_MAX).join("");
    if (!person || !text.trim()) return null;
    const link = this.options.link();
    if (!link) return null;
    let result: LinkPostResult;
    try {
      result = await link.linkPostJson(DUPLICATES_PATH, {
        person,
        text,
        objects: (input.objects ?? []).filter((ref) => REF.test(ref)).slice(0, 10),
        tags: (input.tags ?? []).filter((tag) => TAG.test(tag)).slice(0, 16),
        participants: (input.participants ?? []).slice(0, 50),
      }, { timeoutMs: DUPLICATES_TIMEOUT_MS, maxBytes: ANSWER_MAX_BYTES, subject: person });
    } catch {
      return null;
    }
    if (!result.ok) {
      this.once(`dup:${result.status ?? result.error}`, `perspicax memory: duplicate check unavailable (${result.status === 404 ? "this Perspicax has no duplicate detector" : result.status ?? result.error})`);
      return null;
    }
    const body = result.body && typeof result.body === "object" ? (result.body as Record<string, unknown>) : {};
    const turn = typeof body.turn === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(body.turn) ? body.turn : "";
    const duplicates = (Array.isArray(body.duplicates) ? body.duplicates : []).map(parseHint).filter((hint): hint is DuplicateHint => hint !== null).slice(0, HINTS_MAX);
    if (!turn || !duplicates.length) return null;
    return { turn, checkedAt: this.now(), duplicates };
  }

  /** Tell Perspicax a hint's verdict or the cards a turn used. Best effort. */
  async feedback(input: { person: string; turn?: string; used?: string[]; how?: "cited" | "opened"; hint?: string; verdict?: "same" | "different" | "dismiss" }): Promise<boolean> {
    if (!input.person.trim() || (!(input.used?.length) && !input.hint) || Boolean(input.hint) !== Boolean(input.verdict)) return false;
    const link = this.options.link();
    if (!link) return false;
    try {
      const result = await link.linkPostJson(FEEDBACK_PATH, {
        person: input.person.trim(),
        ...(input.turn ? { turn: input.turn } : {}),
        ...(input.used?.length ? { used: input.used.slice(0, 50), how: input.how ?? "cited" } : {}),
        ...(input.hint ? { hint: input.hint, verdict: input.verdict } : {}),
      }, { timeoutMs: WORK_TIMEOUT_MS, maxBytes: ANSWER_MAX_BYTES, subject: input.person.trim() });
      return result.ok;
    } catch {
      return false;
    }
  }
}
