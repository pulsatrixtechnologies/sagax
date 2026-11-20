// Listening sessions (#4100, lot "listening-session-store"): the server's
// record of a person listening to a conversation in a bot's chat.
//
// One record per session, the person's own, written under
// DATA_DIR/listening/<threadId>/<sessionId>.json and sealed at rest under the
// conversation's key (docs/content-encryption.md; same pattern as
// held-steers: write plain + noteAtRestWrite, read via readAtRestTextSync).
// The device sends the final lines it heard, idempotent by `seq`; the server
// keeps them, says the session in one chat row patched in place (never a row
// per sentence) and in a `listening` frame to the person's other devices,
// and ends a session whose device went quiet (no line, no heartbeat) for
// LISTENING_IDLE_END_MS. No audio is ever stored.
//
// Who: a session answers only to the person who started it (principal id,
// kept as given for the turn's speaker, compared case-insensitively). Anyone else, an administrator included,
// gets null here and 404 at the route.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { noteAtRestWrite, readAtRestTextSync, type ContentScope } from "../encryption/content-at-rest.ts";
import {
  LISTENING_IDLE_END_MS,
  LISTENING_SESSION_ID,
  listeningRowText,
  type ListeningCard,
  type ListeningFrame,
  type ListeningLine,
  type ListeningPurpose,
  type ListeningSessionView,
  type ListeningSources,
  type ListeningSpeaker,
  type ListeningState,
} from "../../shared/listening.ts";

/** The stored record. `messageId` is the chat row this session patches. */
export interface ListeningRecord {
  id: string;
  botId: string;
  principalId: string;
  threadId: string;
  state: ListeningState;
  startedAt: number;
  endedAt?: number;
  sources: ListeningSources;
  speakers: ListeningSpeaker[];
  lines: ListeningLine[];
  messageId?: string;
  /** #5130: "meeting" for an in-person meeting; absent for a conversation. */
  purpose?: "meeting";
  /** How it ended (absent on records written before #5130). */
  endCause?: ListeningEndCause;
}

/** Why a session ended: the person's stop, or the server's idle end. The
 * bot's turn (lot "listening-bot-turn") follows a stop only. */
export type ListeningEndCause = "stop" | "idle";

/** The one row a session keeps in the person's conversation with the bot. */
export interface ListeningRow {
  role: "bot";
  kind: "text";
  text: string;
  listening: ListeningCard;
}

export interface ListeningSessionsDeps {
  /** DATA_DIR/listening */
  dir: string;
  now?: () => number;
  newId?: () => string;
  /** Appends the session's row at the conversation's leaf: its id, or null
   * when the conversation is gone. */
  appendRow(threadId: string, row: ListeningRow): { id: string } | null;
  /** Patches the session's row in place (a `message.patch`). */
  patchRow(threadId: string, messageId: string, patch: Pick<ListeningRow, "text" | "listening">): void;
  /** The live frame, to the person's own streams. */
  broadcast(frame: ListeningFrame): void;
  /** A session ended. Never throws into the caller. */
  onEnded?(record: ListeningRecord, cause: ListeningEndCause): void;
  log?(message: string): void;
}

const THREAD_DIR = /^[\w-]{1,200}$/;
const SESSION_FILE = /^ls_[a-f0-9]{20}\.json$/;

const norm = (principalId: string) => principalId.trim().toLowerCase();

function newSessionId(): string {
  return `ls_${randomBytes(10).toString("hex")}`;
}

/** The card the chat row and the routes carry: the newest line under its
 * speaker's label. */
export function listeningCard(record: ListeningRecord): ListeningCard {
  const lastLine = record.lines.at(-1);
  return {
    sessionId: record.id,
    state: record.state,
    startedAt: record.startedAt,
    ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
    lineCount: record.lines.length,
    speakers: record.speakers.map((speaker) => ({ ...speaker })),
    ...(lastLine ? { last: { speaker: speakerLabel(record, lastLine.speaker), text: lastLine.text } } : {}),
  };
}

/** A session as the routes answer it. Never the principal id. */
export function listeningView(record: ListeningRecord): ListeningSessionView {
  return {
    ...listeningCard(record),
    botId: record.botId,
    threadId: record.threadId,
    sources: { ...record.sources },
    purpose: record.purpose ?? "conversation",
    lastSeq: record.lines.reduce((highest, line) => Math.max(highest, line.seq), 0),
    ...(record.messageId ? { messageId: record.messageId } : {}),
  };
}

function speakerLabel(record: ListeningRecord, key: string): string {
  return record.speakers.find((speaker) => speaker.key === key)?.label ?? key;
}

function parseRecord(raw: unknown): ListeningRecord | null {
  const r = raw as Partial<ListeningRecord> | null;
  if (!r || typeof r.id !== "string" || !LISTENING_SESSION_ID.test(r.id)) return null;
  if (typeof r.botId !== "string" || typeof r.principalId !== "string" || typeof r.threadId !== "string") return null;
  if (r.state !== "listening" && r.state !== "ended") return null;
  if (typeof r.startedAt !== "number") return null;
  const sources = r.sources && typeof r.sources === "object" ? r.sources : { microphone: true, computer: false };
  return {
    id: r.id,
    botId: r.botId,
    principalId: r.principalId,
    threadId: r.threadId,
    state: r.state,
    startedAt: r.startedAt,
    ...(typeof r.endedAt === "number" ? { endedAt: r.endedAt } : {}),
    sources: { microphone: sources.microphone === true, computer: sources.computer === true },
    speakers: Array.isArray(r.speakers) ? r.speakers.filter((s): s is ListeningSpeaker => Boolean(s) && typeof s.key === "string" && typeof s.label === "string") : [],
    lines: Array.isArray(r.lines) ? r.lines.filter((l): l is ListeningLine => Boolean(l) && typeof l.seq === "number" && typeof l.at === "number" && typeof l.speaker === "string" && typeof l.text === "string") : [],
    ...(typeof r.messageId === "string" ? { messageId: r.messageId } : {}),
    ...(r.purpose === "meeting" ? { purpose: "meeting" as const } : {}),
    ...(r.endCause === "stop" || r.endCause === "idle" ? { endCause: r.endCause } : {}),
  };
}

/** A batch of lines (and the speakers it names) as the route reads it, or
 * why it is not one. */
export function parseListeningBatch(body: unknown): { lines: ListeningLine[]; speakers: ListeningSpeaker[] } | { error: string } {
  if (!body || typeof body !== "object") return { error: "a JSON body is required" };
  const { lines, speakers } = body as { lines?: unknown; speakers?: unknown };
  if (!Array.isArray(lines)) return { error: "lines must be a list" };
  if (speakers !== undefined && !Array.isArray(speakers)) return { error: "speakers must be a list" };
  const parsedLines: ListeningLine[] = [];
  for (const raw of lines) {
    const line = raw as Partial<ListeningLine> | null;
    if (!line || typeof line !== "object") return { error: "each line is an object" };
    if (typeof line.seq !== "number" || !Number.isSafeInteger(line.seq) || line.seq < 0) return { error: "seq must be a whole number" };
    if (typeof line.speaker !== "string" || !line.speaker.trim()) return { error: "speaker must be a speaker key" };
    if (typeof line.text !== "string") return { error: "text must be a string" };
    if (line.at !== undefined && (typeof line.at !== "number" || !Number.isFinite(line.at))) return { error: "at must be a time in milliseconds" };
    parsedLines.push({ seq: line.seq, at: line.at ?? 0, speaker: line.speaker.trim(), text: line.text });
  }
  const parsedSpeakers: ListeningSpeaker[] = [];
  for (const raw of (speakers as unknown[] | undefined) ?? []) {
    const speaker = raw as Partial<ListeningSpeaker> | null;
    if (!speaker || typeof speaker.key !== "string" || !speaker.key.trim() || typeof speaker.label !== "string") return { error: "each speaker has a key and a label" };
    parsedSpeakers.push({ key: speaker.key.trim(), label: speaker.label.trim() || speaker.key.trim() });
  }
  return { lines: parsedLines, speakers: parsedSpeakers };
}

export class ListeningSessions {
  private readonly now: () => number;
  private readonly newId: () => string;
  /** every session's conversation, by id (file names only, read at boot) */
  private readonly threadOf = new Map<string, string>();
  /** the live sessions, in memory */
  private readonly live = new Map<string, ListeningRecord>();
  /** when each live session last heard its device */
  private readonly heard = new Map<string, number>();

  private readonly deps: ListeningSessionsDeps;

  constructor(deps: ListeningSessionsDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? newSessionId;
    const booted = this.now();
    for (const { id, threadId } of this.listFiles()) {
      this.threadOf.set(id, threadId);
      const record = this.read(id);
      // a session live when the server stopped gets a full idle span from
      // this boot for its device to come back
      if (record?.state === "listening") {
        this.live.set(id, record);
        this.heard.set(id, booted);
      }
    }
  }

  /** Starts a session in the person's conversation with the bot and writes
   * its row. A session already live there for this person is answered
   * again (a meeting start makes it a meeting: #5130). Null when the
   * conversation is gone. */
  start(input: { botId: string; threadId: string; principalId: string; sources?: Partial<ListeningSources>; purpose?: ListeningPurpose }): ListeningRecord | null {
    if (!THREAD_DIR.test(input.threadId)) return null;
    const principalId = input.principalId.trim();
    const already = this.liveFor(input.threadId);
    if (already && norm(already.principalId) === norm(principalId) && already.botId === input.botId) {
      this.heard.set(already.id, this.now());
      if (input.purpose === "meeting" && already.purpose !== "meeting") {
        already.purpose = "meeting";
        this.write(already);
      }
      return already;
    }
    const record: ListeningRecord = {
      id: this.newId(),
      botId: input.botId,
      principalId,
      threadId: input.threadId,
      state: "listening",
      startedAt: this.now(),
      sources: { microphone: input.sources?.microphone !== false, computer: input.sources?.computer === true },
      speakers: [],
      lines: [],
      ...(input.purpose === "meeting" ? { purpose: "meeting" as const } : {}),
    };
    const card = listeningCard(record);
    const row = this.deps.appendRow(record.threadId, { role: "bot", kind: "text", text: listeningRowText(card), listening: card });
    if (!row) return null;
    record.messageId = row.id;
    this.threadOf.set(record.id, record.threadId);
    this.live.set(record.id, record);
    this.heard.set(record.id, this.now());
    this.write(record);
    // the row was just written as it stands: the frame only
    this.announce(record, false);
    return record;
  }

  /** The person's own session, live or ended; null for anyone else. */
  get(id: string, principalId: string): ListeningRecord | null {
    if (!LISTENING_SESSION_ID.test(id)) return null;
    const record = this.live.get(id) ?? this.read(id);
    return record && norm(record.principalId) === norm(principalId) ? record : null;
  }

  /** A session by id, whoever started it: for the server's own readers that
   * check the conversation themselves (listening_read, the turn's context).
   * Never answered to a route. */
  byId(id: string): ListeningRecord | null {
    if (!LISTENING_SESSION_ID.test(id)) return null;
    return this.live.get(id) ?? this.read(id);
  }

  /** The live session of a conversation, if one is on. */
  liveFor(threadId: string): ListeningRecord | null {
    for (const record of this.live.values()) if (record.threadId === threadId) return record;
    return null;
  }

  /** Adds final lines (a seq already kept is skipped) and the speakers they
   * name. An empty batch is a heartbeat. Lines that arrive after the end (a
   * device that reconnects late) still join the transcript. */
  addLines(id: string, principalId: string, batch: { lines: readonly ListeningLine[]; speakers?: readonly ListeningSpeaker[] }): ListeningRecord | null {
    const record = this.get(id, principalId);
    if (!record) return null;
    if (record.state === "listening") this.heard.set(record.id, this.now());
    let changed = false;
    for (const speaker of batch.speakers ?? []) {
      const known = record.speakers.find((entry) => entry.key === speaker.key);
      if (!known) { record.speakers.push({ key: speaker.key, label: speaker.label }); changed = true; }
      else if (known.label !== speaker.label) { known.label = speaker.label; changed = true; }
    }
    const seqs = new Set(record.lines.map((line) => line.seq));
    let unordered = false;
    for (const line of batch.lines) {
      const text = line.text.trim();
      if (seqs.has(line.seq) || !text) continue;
      seqs.add(line.seq);
      const last = record.lines.at(-1);
      if (last && last.seq > line.seq) unordered = true;
      record.lines.push({ seq: line.seq, at: line.at || this.now(), speaker: line.speaker, text });
      if (!record.speakers.some((speaker) => speaker.key === line.speaker)) record.speakers.push({ key: line.speaker, label: line.speaker });
      changed = true;
    }
    if (unordered) record.lines.sort((a, b) => a.seq - b.seq);
    if (!changed) return record;
    this.write(record);
    this.announce(record);
    return record;
  }

  /** The lines after `after` (a seq), oldest first. */
  linesAfter(record: ListeningRecord, after?: number): ListeningLine[] {
    return after === undefined ? record.lines.slice() : record.lines.filter((line) => line.seq > after);
  }

  /** The person's stop. Ending twice answers the ended session.
   * #5130 (D-20261120-005): a meeting the server ended for silence (the
   * watch lost its connection for longer than LISTENING_IDLE_END_MS) is
   * still the person's meeting: their stop, when the device comes back with
   * its last lines, gives the notes' turn, once. */
  stop(id: string, principalId: string): ListeningRecord | null {
    const record = this.get(id, principalId);
    if (!record) return null;
    if (record.state === "listening") this.end(record, "stop");
    else if (record.purpose === "meeting" && record.endCause === "idle") {
      record.endCause = "stop";
      // the meeting lasted until its last line, not until the server gave up on it
      const last = record.lines.reduce((latest, line) => Math.max(latest, line.at), 0);
      if (record.endedAt === undefined || last > record.endedAt) record.endedAt = last;
      this.write(record);
      this.announce(record);
      this.ended(record, "stop");
    }
    return record;
  }

  /** Ends every live session whose device has been quiet for
   * LISTENING_IDLE_END_MS. Returns the ones it ended. */
  sweep(): ListeningRecord[] {
    const now = this.now();
    const ended: ListeningRecord[] = [];
    for (const record of this.live.values()) {
      if (now - (this.heard.get(record.id) ?? record.startedAt) < LISTENING_IDLE_END_MS) continue;
      this.end(record, "idle");
      ended.push(record);
    }
    return ended;
  }

  /** The files the at-rest migration seals, each under its conversation's key. */
  files(): Array<{ path: string; scope: ContentScope }> {
    return this.listFiles().map(({ id, threadId }) => ({ path: this.pathOf(threadId, id), scope: { thread: threadId } }));
  }

  private end(record: ListeningRecord, cause: ListeningEndCause): void {
    record.state = "ended";
    record.endedAt = this.now();
    record.endCause = cause;
    this.live.delete(record.id);
    this.heard.delete(record.id);
    this.write(record);
    this.announce(record);
    this.ended(record, cause);
  }

  private ended(record: ListeningRecord, cause: ListeningEndCause): void {
    try {
      this.deps.onEnded?.(record, cause);
    } catch (error) {
      this.deps.log?.(`[listening] after the end of ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The row patched in place and the frame to the person's devices. */
  private announce(record: ListeningRecord, patchRow = true): void {
    const card = listeningCard(record);
    if (patchRow && record.messageId) {
      try {
        this.deps.patchRow(record.threadId, record.messageId, { text: listeningRowText(card), listening: card });
      } catch (error) {
        // the conversation went away: the session and its transcript stand
        this.deps.log?.(`[listening] row of ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.deps.broadcast({
      kind: "listening",
      audience: norm(record.principalId),
      botId: record.botId,
      threadId: record.threadId,
      sessionId: record.id,
      state: record.state,
      lineCount: card.lineCount,
      ...(card.last ? { last: card.last } : {}),
    });
  }

  private pathOf(threadId: string, id: string): string {
    return join(this.deps.dir, threadId, `${id}.json`);
  }

  private read(id: string): ListeningRecord | null {
    const threadId = this.threadOf.get(id);
    if (!threadId) return null;
    const path = this.pathOf(threadId, id);
    if (!existsSync(path)) return null;
    try {
      const record = parseRecord(JSON.parse(readAtRestTextSync(path)));
      return record && record.id === id && record.threadId === threadId ? record : null;
    } catch {
      return null;
    }
  }

  private write(record: ListeningRecord): void {
    const dir = join(this.deps.dir, record.threadId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = this.pathOf(record.threadId, record.id);
    writeFileAtomic(path, JSON.stringify(record), { mode: 0o600 });
    noteAtRestWrite(path, { thread: record.threadId });
  }

  private listFiles(): Array<{ id: string; threadId: string }> {
    if (!existsSync(this.deps.dir)) return [];
    const out: Array<{ id: string; threadId: string }> = [];
    let threads: string[];
    try { threads = readdirSync(this.deps.dir); } catch { return []; }
    for (const threadId of threads) {
      if (!THREAD_DIR.test(threadId)) continue;
      let names: string[];
      try { names = readdirSync(join(this.deps.dir, threadId)); } catch { continue; }
      for (const name of names) if (SESSION_FILE.test(name)) out.push({ id: name.slice(0, -".json".length), threadId });
    }
    return out;
  }
}
