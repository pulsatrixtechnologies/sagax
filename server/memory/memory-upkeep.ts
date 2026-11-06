// Memory upkeep: the background half of a bot's memory. On for every bot
// unless switched off (BotRecord.memoryUpkeep === false). The main agent
// keeps reading and writing its notes as before; this adds what happens
// without it choosing:
//   - capture: finished 1:1 turns (and, with Learn from group chats on, a
//     member bot's room turns) are read after the chat goes quiet; core
//     facts go to MEMORY.md, detail to a topic file per subject that upkeep
//     creates and names, with other words for it (server/memory/memory-capture.ts);
//     turns still waiting at shutdown are saved as ids and captured after
//     the next start;
//   - About me: a durable fact about the person, from their own words, is
//     added to the shared About me and listed in Settings with Remove
//     (server/profiles/profile-learned.ts);
//   - tidy-up: nightly, and on demand, expired entries are archived, exact
//     duplicates merged (MEMORY.md and topic files) and contradictions in
//     MEMORY.md struck (server/memory/memory-tidy.ts).
//   - dream: the same nightly and on-demand pass re-reads topics and the
//     journal, merges topic files that say the same thing, promotes a
//     repeated fact into MEMORY.md, and moves a contradicted or expired
//     fact into the archive (server/memory/memory-dream.ts). Notes stay in files.
//     No model is trained.
// Every memory write is a journal row with actor "upkeep", so the Memory
// panel shows it and Undo works. The model steps need a one-shot text call
// (`generateText`: Claude and the chat-completion engines, or
// `generateMemoryText`: the ACP engines, server/drivers/acp/background-text.ts,
// and Codex, server/drivers/codex-background-text.ts); on any other
// engine the helper model writes them when one is set (server/side-jobs.ts),
// and otherwise they are skipped and only the deterministic tidy steps run.
import { captureCallPhase, fileCandidatesPhase, runTidyPhase, type MemoryPhaseHost } from "./memory-upkeep-phases.ts";

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { CaptureBuffer, captureSize, worthCapturing, type Candidate, type CaptureBatch, type CaptureTurn } from "./memory-capture.ts";
import { factIdentity, lineFactIdentity, notebookIdentities } from "./memory-entries.ts";
import { mergeTopicText } from "./memory-topics.ts";
import { applyMoves, MAX_MOVES, organizeCandidates, organizePrompt, parseMoves } from "./memory-organize.ts";
import { dreamTouched, planDream, type DreamPlan } from "./memory-dream.ts";
import { journalMemoryDelete, journalMemoryWrite, readMemoryJournal, recordMemoryChange } from "./memory-journal.ts";
import { appendMemoryArchive, ARCHIVE_TOPIC, ensureWorkspace, listMemoryTopics, memoryDate, memoryTopicIndex, readMemoryText, workspaceDir, writeMemoryFile, writeMemoryTopic } from "../workspace/workspace.ts";
import { reportBackgroundError } from "../background-error.ts";

export const CAPTURE_MAX_TURNS = 6;
/** One capture call reads at most this much of one bot's waiting threads;
 * the rest wait for the next call (port de OpenMausBot #3017). */
export const CAPTURE_CALL_MAX_TURNS = 2 * CAPTURE_MAX_TURNS;
export const CAPTURE_CALL_MAX_BYTES = 24_000;
/** A thread that goes quiet takes along its bot's other threads that would
 * go quiet within this long. */
export const CAPTURE_GATHER_MS = 15_000;
export const MODEL_TIMEOUT_MS = 60_000;
/** At most this many topic files get a model contradiction check per tidy. */
export const MAX_TOPIC_CHECKS = 4;
export const TIDY_CHECK_MS = 10 * 60_000;
/** Below this many live entries there is nothing a contradiction pass may change. */
export const MIN_ENTRIES_FOR_CONTRADICTIONS = 5;
const ARCHIVE_PATH = `memory/${ARCHIVE_TOPIC}`;
/** At most this many threads' waiting turns are kept across a restart. */
export const MAX_PENDING_THREADS = 50;
/** A topic file past this size gains nothing more from capture. */
export const TOPIC_MAX_BYTES = 64 * 1024;

export interface UpkeepEngine {
  generateText?: (prompt: string, options?: { signal?: AbortSignal; noThinking?: boolean }) => Promise<string>;
}

export interface UpkeepBot {
  id: string;
  name: string;
  memoryUpkeep?: boolean;
  memoryEnabled?: boolean;
}

/** On unless switched off: every bot keeps its memory in shape by default. */
export function upkeepEnabled(bot: Pick<UpkeepBot, "memoryUpkeep" | "memoryEnabled"> | undefined): bot is UpkeepBot {
  return Boolean(bot) && bot!.memoryUpkeep !== false && bot!.memoryEnabled !== false;
}

export interface UpkeepDeps {
  bots: () => readonly UpkeepBot[];
  bot: (id: string) => UpkeepBot | undefined;
  /** Whoever writes the bot's model steps: its own engine when it can and
   * may receive memory text (policy allows), else the helper model when one
   * is set (server/side-jobs.ts), else null. */
  engine: (botId: string) => UpkeepEngine | null;
  /** A turn is running for the bot: the scheduled tidy waits. */
  busy: (botId: string) => boolean;
  /** Append facts about the person to the shared About me; returns how many were added. */
  addToAboutMe: (from: { botId: string; botName: string }, texts: readonly string[]) => number;
  /** `chat "Title"` or `room "Name"`, for the source of a captured entry. */
  sourceLabel: (botId: string, threadId: string) => string;
  /** Whether this thread may still feed this bot's memory, asked again
   * when a batch is captured: a room turn queued before Learn from group
   * chats was switched off, or before the room or the bot changed who can
   * see them, is dropped instead. Absent: every queued turn may. */
  mayCapture?: (botId: string, threadId: string) => boolean;
  /** The turn as capture reads it, rebuilt from the transcript, or null when
   * it is gone (thread deleted, rewound) or no longer capturable. Without it
   * turns still waiting at shutdown are dropped, as before. */
  restoreTurn?: (botId: string, threadId: string, turnId: string) => CaptureTurn | null;
  /** Whether a thread may still be captured when its batch goes out: false
   * for a thread that became confidential while its turns waited
   * (server/threads/confidential-threads.ts). Absent: every thread. */
  capturable?: (threadId: string) => boolean;
  quietMs: () => number;
  tidyHour: () => number;
  /** Wraps each synchronous burst of writes this makes to one bot's memory
   * (capture, organize, tidy), so the host can tell them from writes made
   * elsewhere (an OMB Cloud home: server/lending-memory.ts). */
  writing?: <T>(botId: string, write: () => T) => T;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface TidyReport {
  at: number;
  expired: number;
  duplicates: number;
  superseded: number;
  deferred: number;
  /** MEMORY.md entries moved into topic files. */
  organized?: number;
  /** Whether the contradiction step ran (needs a text engine and five entries). */
  contradictionsChecked: boolean;
  /** Topic files that received a model contradiction check this pass. */
  topicChecks?: number;
  /** Topic checks skipped for budget, timeout or concurrent edits. */
  topicsDeferred?: number;
  /** Why it did not run, in the person's words. */
  note?: string;
  /** The dream pass, when it changed a file. Absent when there was nothing to do. */
  dream?: DreamReport;
}

export interface DreamReport {
  at: number;
  promoted: number;
  merged: number;
  archived: number;
}

export interface CaptureReport {
  at: number;
  /** Facts appended to MEMORY.md. */
  added: number;
  /** Facts filed into topic files. */
  topics: number;
  /** Facts added to the shared About me. */
  aboutMe: number;
  /** MEMORY.md entries moved into topic files afterwards. */
  organized?: number;
  /** Facts the model found that memory already held: the "N already known"
   * of the receipt (parity M3). Absent on reports written before it. */
  known?: number;
  note?: string;
}

interface UpkeepState {
  bots: Record<string, { lastTidy?: TidyReport; lastCapture?: CaptureReport; core?: string[]; topicCursor?: string }>;
}

/** How many "this entry is core" judgements are remembered per bot. */
const MAX_CORE = 500;

function statePath(): string {
  return join(DATA_DIR, "memory-upkeep.json");
}

function loadState(): UpkeepState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as UpkeepState;
    return parsed && typeof parsed.bots === "object" && parsed.bots ? parsed : { bots: {} };
  } catch {
    return { bots: {} };
  }
}

function saveState(state: UpkeepState): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileAtomic(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // status is a convenience; losing it only means the tidy may run again
  }
}

// Turns still waiting at shutdown, kept as ids only: the transcript already
// holds the text, and a thread deleted meanwhile leaves nothing behind.
interface PendingCapture {
  batches: { botId: string; threadId: string; turnIds: string[] }[];
}

function pendingPath(): string {
  return join(DATA_DIR, "memory-capture-pending.json");
}

function savePending(batches: readonly CaptureBatch[]): void {
  // per bot and thread: a room's thread holds every member bot's turns
  const byThread = new Map<string, { botId: string; threadId: string; turnIds: string[] }>();
  for (const batch of batches) {
    const ids = batch.turns.map((turn) => turn.turnId).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) continue;
    const key = `${batch.botId}\n${batch.threadId}`;
    const entry = byThread.get(key) ?? { botId: batch.botId, threadId: batch.threadId, turnIds: [] };
    entry.turnIds.push(...ids.filter((id) => !entry.turnIds.includes(id)));
    byThread.set(key, entry);
  }
  if (!byThread.size) return;
  const state: PendingCapture = {
    batches: [...byThread.values()].slice(-MAX_PENDING_THREADS).map((entry) => ({ ...entry, turnIds: entry.turnIds.slice(-CAPTURE_MAX_TURNS) })),
  };
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileAtomic(pendingPath(), `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch {
    // best effort: losing it only means those turns are not captured
  }
}

/** Read and remove the saved turns. Removed first, so a start that fails
 * part way never replays them twice. */
function takePending(): PendingCapture["batches"] {
  let raw: string;
  try {
    raw = readFileSync(pendingPath(), "utf8");
  } catch {
    return [];
  }
  rmSync(pendingPath(), { force: true });
  try {
    const parsed = JSON.parse(raw) as Partial<PendingCapture>;
    if (!Array.isArray(parsed?.batches)) return [];
    return parsed.batches
      .filter((batch) => batch && typeof batch.botId === "string" && typeof batch.threadId === "string" && Array.isArray(batch.turnIds))
      .slice(-MAX_PENDING_THREADS)
      .map((batch) => ({ botId: batch.botId, threadId: batch.threadId, turnIds: batch.turnIds.filter((id): id is string => typeof id === "string").slice(-CAPTURE_MAX_TURNS) }));
  } catch {
    return [];
  }
}

function readRaw(botId: string, relative: string): string | null {
  try {
    return readMemoryText(join(workspaceDir(botId), relative));
  } catch {
    return null;
  }
}

async function askModel(engine: UpkeepEngine, prompt: string, timeoutMs = MODEL_TIMEOUT_MS): Promise<string | null> {
  if (!engine.generateText) return null;
  const expiry = AbortSignal.timeout(timeoutMs);
  try {
    const answer = await Promise.race([
      engine.generateText(prompt, { signal: expiry, noThinking: true }),
      new Promise<never>((_, reject) => expiry.addEventListener("abort", () => reject(new Error("timed out")), { once: true })),
    ]);
    return typeof answer === "string" ? answer : null;
  } catch {
    return null;
  }
}

/** A flushed thread waiting for its capture call; `done` answers a caller of `capture`. */
interface Waiting {
  batch: CaptureBatch;
  done?: { resolve: (report: CaptureReport) => void; reject: (error: unknown) => void };
}

function callBytes(batch: CaptureBatch): number {
  const { said, replied } = captureSize(batch.turns);
  return said + replied;
}

export const NO_TEXT_ENGINE = "This bot's engine cannot make the quick background model call upkeep uses, so only expired notes and exact duplicates are tidied.";

export interface MemoryUpkeep {
  /** A finished turn of an upkeep bot, for capture: 1:1, or a room's. */
  noteTurn(botId: string, threadId: string, turn: CaptureTurn): void;
  /** Capture a thread's waiting turns now, without waiting for the quiet spell. */
  flushThread(threadId: string): void;
  /** Forget a bot's waiting turns (its upkeep or memory switched off). */
  dropBot(botId: string): void;
  /** The bot was deleted: forget its waiting turns, its deferred batches
   * and its upkeep status (port de OpenMausBot #2856). */
  forgetBot(botId: string): void;
  /** Forget one thread's waiting turns (it became confidential, or was deleted). */
  dropThread(threadId: string): void;
  /** Run one capture batch; resolves when written. Exposed for tests. */
  capture(batch: CaptureBatch): Promise<CaptureReport>;
  tidy(botId: string): Promise<TidyReport>;
  /** The dream pass on its own. The nightly and on-demand tidy run it too. */
  dream(botId: string): Promise<DreamReport>;
  status(botId: string): { lastTidy?: TidyReport; lastCapture?: CaptureReport; modelSteps: boolean };
  /** One scheduler pass: tidy every due bot. Exposed for tests. */
  tick(): Promise<void>;
  /** Start the scheduler, and queue again the turns that were still
   * waiting when the last run stopped. */
  start(): void;
  /** Shutdown: stop the scheduler and save the waiting turns as ids, so the
   * next start captures them instead of losing them. No model call here. */
  stop(): void;
  /** Backup maintenance: nothing writes until resume, and batches that
   * came due meanwhile run then. */
  pause(): void;
  resume(): void;
  /** Wait for captures in flight (tests, shutdown). */
  idle(): Promise<void>;
}

export function createMemoryUpkeep(deps: UpkeepDeps): MemoryUpkeep {
  const now = () => deps.now?.() ?? new Date();
  const log = (line: string) => deps.log?.(line);
  const inflight = new Set<Promise<unknown>>();
  const tidying = new Map<string, Promise<TidyReport>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let paused = false;
  const pause = { get on() { return paused; } };
  // Flushed threads wait here, also through a backup. One worker drains it
  // for the whole server, one capture call at a time.
  const queue: Waiting[] = [];
  /** The batches of the call out now, kept for a stop before it answers. */
  let calling: CaptureBatch[] = [];
  let worker: Promise<void> | null = null;

  const record = (botId: string, patch: { lastTidy?: TidyReport; lastCapture?: CaptureReport; topicCursor?: string }) => {
    // a capture or tidy still out when its bot was deleted leaves nothing behind
    if (!deps.bot(botId)) return;
    const state = loadState();
    state.bots[botId] = { ...state.bots[botId], ...patch };
    saveState(state);
  };

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inflight.add(promise);
    void promise.finally(() => inflight.delete(promise)).catch(() => undefined);
    return promise;
  };

  const writing = deps.writing ?? (<T>(_botId: string, write: () => T): T => write());

  let phases: MemoryPhaseHost;
  /** Files one conversation's items as that conversation's: its source
   * label, its thread on every journal row. */
  function fileCandidates(botId: string, threadId: string, candidates: readonly Candidate[]): { added: number; topics: number; known: number } {
    return fileCandidatesPhase(phases, botId, threadId, candidates);
  }

  /**
   * Which conversation each item came from. With several in one call and no
   * valid "from", the guess is the one with the most said, used only where it
   * cannot matter: the item is kept only if every conversation may still be
   * captured, and reaches About me only if every one is the owner's own.
   */
  function attribute(candidates: readonly Candidate[], conversations: readonly CaptureBatch[], still: readonly boolean[]) {
    const owner = conversations.map((conversation) => conversation.turns.every((turn) => turn.owner !== false));
    const sizes = conversations.map((conversation) => captureSize(conversation.turns).said);
    const guess = sizes.indexOf(Math.max(...sizes));
    return candidates.flatMap((candidate) => {
      const named = conversations.length === 1 ? 0 : candidate.from !== undefined && candidate.from <= conversations.length ? candidate.from - 1 : -1;
      const sure = named >= 0;
      const at = sure ? named : guess;
      if (!still[at] || (!sure && !still.every(Boolean))) return [];
      // Only the owner's own words reach About me: on a shared workspace
      // another person's facts are not the owner's profile.
      return [{ candidate, at, aboutMe: candidate.aboutUser && owner[at]! && (sure || owner.every(Boolean)) }];
    });
  }

  /** One model call for one bot's waiting threads, each read as its own
   * conversation. A thread that may not be captured (confidential) is left
   * out before the prompt is built and checked again after the answer. */
  async function captureCall(batches: readonly CaptureBatch[]): Promise<CaptureReport> {
    return captureCallPhase(phases, batches);
  }

  const ownedBy = (batch: CaptureBatch) => batch.turns.every((turn) => turn.owner !== false);

  /** The first waiting batch, with its bot's other waiting batches that fit
   * in the same call. */
  function takeCall(): Waiting[] {
    const first = queue.shift()!;
    const call = [first];
    let turns = first.batch.turns.length;
    let bytes = callBytes(first.batch);
    for (let i = 0; i < queue.length;) {
      const next = queue[i]!;
      const size = callBytes(next.batch);
      // Only threads of one ownership share a call: a fact from someone
      // else's thread must never be filed under the owner's (About me).
      if (next.batch.botId === first.batch.botId && ownedBy(next.batch) === ownedBy(first.batch) && turns + next.batch.turns.length <= CAPTURE_CALL_MAX_TURNS && bytes + size <= CAPTURE_CALL_MAX_BYTES) {
        call.push(...queue.splice(i, 1));
        turns += next.batch.turns.length;
        bytes += size;
      } else i += 1;
    }
    return call;
  }

  async function work(): Promise<void> {
    try {
      // threads flushed together are all queued before the first call takes its share
      await Promise.resolve();
      while (!paused && queue.length) {
        const call = takeCall();
        calling = call.map((entry) => entry.batch);
        try {
          const report = await captureCall(call.map((entry) => entry.batch));
          for (const entry of call) entry.done?.resolve(report);
        } catch (error) {
          log(`memory upkeep: capture failed for ${call[0]!.batch.botId}: ${(error as Error).message}`);
          for (const entry of call) entry.done?.reject(error);
        } finally {
          calling = [];
        }
      }
    } finally {
      worker = null;
    }
  }

  function kick(): void {
    if (!worker && !paused && queue.length) worker = track(work());
  }

  function enqueue(entry: Waiting): void {
    queue.push(entry);
    kick();
  }

  function dropQueued(match: (batch: CaptureBatch) => boolean): void {
    calling = calling.filter((batch) => !match(batch));
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (!match(queue[index]!.batch)) continue;
      const [entry] = queue.splice(index, 1);
      entry!.done?.resolve({ at: now().getTime(), added: 0, topics: 0, aboutMe: 0, note: "upkeep is off" });
    }
  }

  const buffer = new CaptureBuffer({
    quietMs: deps.quietMs,
    maxTurns: CAPTURE_MAX_TURNS,
    gatherMs: CAPTURE_GATHER_MS,
    onFlush: (batch) => {
      if (deps.capturable && !deps.capturable(batch.threadId)) return;
      // a test or a pleasantry has nothing to keep, so it costs no call
      if (worthCapturing(batch.turns)) enqueue({ batch });
    },
  });

  /** Move MEMORY.md entries that are not core into their topic files. One
   * model call over entries not judged before; lines move unchanged, topics
   * first so undoing the newest row (MEMORY.md) never loses one. */
  async function organize(botId: string): Promise<number> {
    const engine = deps.engine(botId);
    if (!engine?.generateText) return 0;
    const today = memoryDate(now());
    const state = loadState();
    const core = new Set(state.bots[botId]?.core ?? []);
    const first = readRaw(botId, "MEMORY.md") ?? "";
    const candidates = organizeCandidates(first, today, core);
    if (!candidates.length) return 0;
    const answer = await askModel(engine, organizePrompt(candidates, memoryTopicIndex(botId)));
    if (answer === null || paused || !upkeepEnabled(deps.bot(botId))) return 0;
    // the line numbers are the file's as read; a write since means ask again later
    const before = readRaw(botId, "MEMORY.md") ?? "";
    if (before !== first) return 0;
    const proposed = parseMoves(answer, candidates);
    if (proposed === null) return 0;
    // Deferred moves are not core: let the next pass reconsider them.
    const moved = new Set(proposed.map((move) => move.entry.line));
    const moves = proposed.slice(0, MAX_MOVES);
    const judgedCore = candidates.filter((entry) => !moved.has(entry.line)).map((entry) => factIdentity(entry.body));
    const saved = loadState();
    saved.bots[botId] = { ...saved.bots[botId], core: [...new Set([...(saved.bots[botId]?.core ?? []), ...judgedCore])].slice(-MAX_CORE) };
    saveState(saved);
    if (!moves.length) return 0;
    return writing(botId, () => {
      const { byTopic } = applyMoves(before, moves);
      const written = new Set<string>();
      const existing = new Map(listMemoryTopics(botId).map((topic) => [topic.name.toLowerCase(), topic.name]));
      let count = 0;
      for (const [wanted, group] of byTopic) {
        const name = existing.get(wanted) ?? wanted;
        const path = `memory/${name}`;
        const current = readRaw(botId, path);
        const seen = notebookIdentities(current ?? "");
        const lines = group.lines.filter((line) => !seen.has(lineFactIdentity(line)));
        if (lines.length) {
          try {
            writeMemoryTopic(botId, name, mergeTopicText(current, { title: name.replace(/\.md$/, "").replace(/-/g, " "), aliases: group.aliases, lines }));
          } catch (error) {
            log(`memory upkeep: could not write ${path}; kept its entries in MEMORY.md: ${(error as Error).message}`);
            continue;
          }
          recordMemoryChange(botId, { path, actor: "upkeep", via: "organize", before: current, after: readRaw(botId, path) });
        }
        existing.set(name.toLowerCase(), name);
        written.add(wanted);
        count += group.lines.length;
      }
      if (!written.size) return 0;
      const { text } = applyMoves(before, moves.filter((move) => written.has(move.topic)));
      writeMemoryFile(botId, text);
      recordMemoryChange(botId, { path: "MEMORY.md", actor: "upkeep", via: "organize", before, after: readRaw(botId, "MEMORY.md") });
      log(`memory upkeep: moved ${count} entr${count === 1 ? "y" : "ies"} from MEMORY.md into topic files for ${deps.bot(botId)?.name ?? botId}`);
      return count;
    });
  }

  function applyDream(botId: string, plan: DreamPlan, memoryBefore: string): void {
    const today = memoryDate(now());
    if (plan.archiveLines.length) {
      const before = readRaw(botId, ARCHIVE_PATH);
      appendMemoryArchive(botId, plan.archiveLines);
      recordMemoryChange(botId, { path: ARCHIVE_PATH, actor: "upkeep", via: "dream", before, after: readRaw(botId, ARCHIVE_PATH) });
    }
    for (const topic of plan.topics) {
      const path = `memory/${topic.name}`;
      if (topic.text === null) {
        journalMemoryDelete(botId, path, { actor: "upkeep", via: "dream" });
        continue;
      }
      const before = readRaw(botId, path);
      writeMemoryTopic(botId, topic.name, topic.text);
      recordMemoryChange(botId, { path, actor: "upkeep", via: "dream", before, after: readRaw(botId, path) });
    }
    if (plan.memory !== memoryBefore) {
      writeMemoryFile(botId, plan.memory);
      recordMemoryChange(botId, { path: "MEMORY.md", actor: "upkeep", via: "dream", before: memoryBefore, after: readRaw(botId, "MEMORY.md") });
    }
    if (plan.company !== null) {
      const path = "memory/company.md";
      const before = readRaw(botId, path);
      writeMemoryTopic(botId, "company.md", plan.company);
      recordMemoryChange(botId, { path, actor: "upkeep", via: "dream", before, after: readRaw(botId, path) });
    }
    if (plan.account) {
      const path = `memory/dreams/${today}.md`;
      const existing = readRaw(botId, path);
      const next = existing && existing.trim()
        ? `${existing.endsWith("\n") ? existing : `${existing}\n`}${plan.account.replace(/^# Dream [^\n]*\n+/, "")}`
        : plan.account;
      journalMemoryWrite(botId, path, next, { actor: "upkeep", via: "dream" });
    }
  }

  function runDream(botId: string): DreamReport {
    const at = now().getTime();
    const empty: DreamReport = { at, promoted: 0, merged: 0, archived: 0 };
    if (paused || !upkeepEnabled(deps.bot(botId))) return empty;
    ensureWorkspace(botId);
    const today = memoryDate(now());
    const memory = readRaw(botId, "MEMORY.md") ?? "";
    const topics = listMemoryTopics(botId).map((topic) => ({ name: topic.name, text: readRaw(botId, `memory/${topic.name}`) ?? "" }));
    let journal: { diff: string }[] = [];
    try {
      journal = readMemoryJournal(botId, 200).map((row) => ({ diff: row.diff }));
    } catch {
      journal = [];
    }
    const plan = planDream({ today, memory, topics, journal });
    if (!dreamTouched(plan)) return empty;
    if ((readRaw(botId, "MEMORY.md") ?? "") !== memory) return empty;
    writing(botId, () => applyDream(botId, plan, memory));
    log(`memory upkeep: dream for ${deps.bot(botId)?.name ?? botId} promoted ${plan.promoted.length}, merged ${plan.merged.length}, archived ${plan.archiveLines.length}`);
    return { at, promoted: plan.promoted.length, merged: plan.merged.length, archived: plan.archiveLines.length };
  }

  function appendArchive(botId: string, archived: readonly string[]): void {
    const archiveBefore = readRaw(botId, ARCHIVE_PATH);
    appendMemoryArchive(botId, archived);
    recordMemoryChange(botId, { path: ARCHIVE_PATH, actor: "upkeep", via: "tidy", before: archiveBefore, after: readRaw(botId, ARCHIVE_PATH) });
  }

  async function runTidy(botId: string): Promise<TidyReport> {
    return runTidyPhase(phases, botId);
  }

  function tidy(botId: string): Promise<TidyReport> {
    const running = tidying.get(botId);
    if (running) return running;
    const promise = track(runTidy(botId)).finally(() => tidying.delete(botId));
    tidying.set(botId, promise);
    return promise;
  }

  function due(botId: string): boolean {
    const current = now();
    if (current.getHours() < deps.tidyHour()) return false;
    const last = loadState().bots[botId]?.lastTidy?.at;
    return !last || memoryDate(new Date(last)) < memoryDate(current);
  }

  async function tick(): Promise<void> {
    if (paused) return;
    for (const bot of deps.bots()) {
      if (paused) return;
      if (!upkeepEnabled(bot) || deps.busy(bot.id) || !due(bot.id)) continue;
      try {
        await tidy(bot.id);
      } catch (error) {
        log(`memory upkeep: tidy failed for ${bot.id}: ${(error as Error).message}`);
      }
    }
  }

  phases = {
    deps,
    now,
    log,
    pause,
    queue,
    record,
    topicCursorOf: (botId) => loadState().bots[botId]?.topicCursor,
    writing,
    attribute,
    fileCandidates,
    organize,
    appendArchive,
    runDream,
    readRaw,
    askModel,
    upkeepEnabled,
    ARCHIVE_PATH,
    TOPIC_MAX_BYTES,
    NO_TEXT_ENGINE,
    MIN_ENTRIES_FOR_CONTRADICTIONS,
    MAX_TOPIC_CHECKS,
    MODEL_TIMEOUT_MS,
  };

  return {
    noteTurn(botId, threadId, turn) {
      if (!upkeepEnabled(deps.bot(botId))) return;
      if (!turn.person.trim() && !turn.bot.trim()) return;
      buffer.add(botId, threadId, turn);
    },
    flushThread: (threadId) => buffer.flush(threadId),
    dropBot(botId) {
      buffer.dropBot(botId);
      dropQueued((batch) => batch.botId === botId);
    },
    forgetBot(botId) {
      buffer.dropBot(botId);
      dropQueued((batch) => batch.botId === botId);
      const state = loadState();
      if (!state.bots[botId]) return;
      delete state.bots[botId];
      saveState(state);
    },
    dropThread: (threadId) => {
      buffer.dropThread(threadId);
      // a batch waiting for its call, or for a backup to finish, goes too
      dropQueued((batch) => batch.threadId === threadId);
    },
    capture: (batch) => new Promise<CaptureReport>((resolve, reject) => enqueue({ batch, done: { resolve, reject } })),
    tidy,
    dream: (botId) => track(Promise.resolve().then(() => runDream(botId))),
    status(botId) {
      // the core judgements are upkeep's own bookkeeping, not status
      const { lastTidy, lastCapture } = loadState().bots[botId] ?? {};
      return { ...(lastTidy ? { lastTidy } : {}), ...(lastCapture ? { lastCapture } : {}), modelSteps: Boolean(deps.engine(botId)?.generateText) };
    },
    tick,
    start() {
      if (timer) return;
      if (deps.restoreTurn) {
        try {
          for (const saved of takePending()) {
            if (!upkeepEnabled(deps.bot(saved.botId))) continue;
            for (const turnId of saved.turnIds) {
              const turn = deps.restoreTurn(saved.botId, saved.threadId, turnId);
              if (turn && (turn.person.trim() || turn.bot.trim())) buffer.add(saved.botId, saved.threadId, { ...turn, turnId });
            }
          }
        } catch (error) {
          log(`memory upkeep: could not queue turns saved at the last shutdown: ${(error as Error).message}`);
        }
      }
      timer = setInterval(() => void tick().catch(reportBackgroundError), TIDY_CHECK_MS);
      timer.unref?.();
      // a first pass shortly after start catches a night the computer slept through
      const first = setTimeout(() => void tick().catch(reportBackgroundError), 60_000);
      first.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      const queued = queue.splice(0);
      for (const entry of queued) entry.done?.resolve({ at: now().getTime(), added: 0, topics: 0, aboutMe: 0, note: "kept for the next start" });
      // the call out now may never answer before exit: its turns are kept too
      const waiting = [...calling, ...queued.map((entry) => entry.batch), ...buffer.drain()];
      if (deps.restoreTurn) savePending(waiting);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      kick();
    },
    async idle() {
      while (inflight.size) await Promise.allSettled(inflight);
    },
  };
}
