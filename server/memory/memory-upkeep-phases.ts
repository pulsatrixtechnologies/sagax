// Capture, filing and tidy phases for memory upkeep (#1383).
// createMemoryUpkeep keeps the queue, the worker and the scheduler.
import type { Candidate, CaptureBatch } from "./memory-capture.ts";
import { captureItemLimit, capturePrompt, parseCandidates, splitCandidates } from "./memory-capture.ts";
import { factIdentity, notebookIdentities } from "./memory-entries.ts";
import { mergeTopicText } from "./memory-topics.ts";
import { recordMemoryChange } from "./memory-journal.ts";
import { applyTidy, contradictionCandidates, contradictionPrompt, parseContradictions, planChanges, planTidy, type Contradiction } from "./memory-tidy.ts";
import { ARCHIVE_TOPIC, ensureWorkspace, listMemoryTopics, memoryDate, memoryEntry, memoryTopicIndex, updateMemory, writeMemoryFile, writeMemoryTopic } from "../workspace/workspace.ts";

interface DreamReport {
  at: number;
  promoted: number;
  merged: number;
  archived: number;
}

interface TidyReport {
  at: number;
  expired: number;
  duplicates: number;
  superseded: number;
  deferred: number;
  organized?: number;
  contradictionsChecked: boolean;
  topicChecks?: number;
  topicsDeferred?: number;
  note?: string;
  dream?: DreamReport;
}

interface CaptureReport {
  at: number;
  added: number;
  topics: number;
  aboutMe: number;
  organized?: number;
  known?: number;
  note?: string;
}

interface PhaseBot {
  id: string;
  name: string;
  memoryUpkeep?: boolean;
  memoryEnabled?: boolean;
}

interface PhaseEngine {
  generateText?: (prompt: string, options?: { signal?: AbortSignal; noThinking?: boolean }) => Promise<string>;
}

interface PhaseDeps {
  bot: (id: string) => PhaseBot | undefined;
  engine: (botId: string) => PhaseEngine | null;
  addToAboutMe: (from: { botId: string; botName: string }, texts: readonly string[]) => number;
  sourceLabel: (botId: string, threadId: string) => string;
  capturable?: (threadId: string) => boolean;
  /** Whether this thread may still feed this bot's memory (Learn from group chats). */
  mayCapture?: (botId: string, threadId: string) => boolean;
}

export interface MemoryPhaseHost {
  deps: PhaseDeps;
  now: () => Date;
  log: (line: string) => void;
  pause: { readonly on: boolean };
  queue: { batch: CaptureBatch }[];
  record: (botId: string, patch: { lastTidy?: TidyReport; lastCapture?: CaptureReport; topicCursor?: string }) => void;
  topicCursorOf: (botId: string) => string | undefined;
  writing: <T>(botId: string, write: () => T) => T;
  attribute: (candidates: readonly Candidate[], conversations: readonly CaptureBatch[], still: readonly boolean[]) => { candidate: Candidate; at: number; aboutMe: boolean }[];
  fileCandidates: (botId: string, threadId: string, candidates: readonly Candidate[]) => { added: number; topics: number; known: number };
  organize: (botId: string) => Promise<number>;
  appendArchive: (botId: string, archived: readonly string[]) => void;
  runDream: (botId: string) => DreamReport;
  readRaw: (botId: string, relative: string) => string | null;
  askModel: (engine: PhaseEngine, prompt: string, timeoutMs?: number) => Promise<string | null>;
  upkeepEnabled: (bot: PhaseBot | undefined) => bot is PhaseBot;
  ARCHIVE_PATH: string;
  TOPIC_MAX_BYTES: number;
  NO_TEXT_ENGINE: string;
  MIN_ENTRIES_FOR_CONTRADICTIONS: number;
  MAX_TOPIC_CHECKS: number;
  MODEL_TIMEOUT_MS: number;
}

export function fileCandidatesPhase(host: MemoryPhaseHost, botId: string, threadId: string, candidates: readonly Candidate[]): { added: number; topics: number; known: number } {
  const { deps, now, readRaw, ARCHIVE_PATH, TOPIC_MAX_BYTES } = host;
  const before = readRaw(botId, "MEMORY.md");
  const archiveBefore = readRaw(botId, ARCHIVE_PATH);
  const { fresh, known: inNotebook } = splitCandidates(candidates, before ?? "");
  let known = inNotebook;
  const source = `${deps.sourceLabel(botId, threadId)} (noticed)`;
  let added = 0;
  const byTopic = new Map<string, Candidate[]>();
  for (const candidate of fresh) {
    if (candidate.topic) {
      byTopic.set(candidate.topic, [...(byTopic.get(candidate.topic) ?? []), candidate]);
      continue;
    }
    if (updateMemory(botId, { action: "append", text: candidate.text, ...(candidate.until ? { until: candidate.until } : {}) }, { source, now: now(), readers: { kind: "person" } }).ok) added += 1;
  }
  // Older entries the appends moved out are journaled first, as the
  // tidy-up does, so undoing the newest row (MEMORY.md) brings them back.
  recordMemoryChange(botId, { path: ARCHIVE_PATH, actor: "upkeep", via: "capture", threadId, before: archiveBefore, after: readRaw(botId, ARCHIVE_PATH) });
  if (added) recordMemoryChange(botId, { path: "MEMORY.md", actor: "upkeep", via: "capture", threadId, before, after: readRaw(botId, "MEMORY.md") });
  // Detail goes to a topic file the bot keeps for that subject, created
  // with a header (title and other words for it) the first time.
  const existing = new Map(listMemoryTopics(botId).map((topic) => [topic.name.toLowerCase(), topic.name]));
  let topics = 0;
  for (const [wanted, group] of byTopic) {
    const name = existing.get(wanted) ?? wanted;
    const path = `memory/${name}`;
    const current = readRaw(botId, path);
    if (current !== null && Buffer.byteLength(current, "utf8") > TOPIC_MAX_BYTES) continue;
    const seen = notebookIdentities(current ?? "");
    const unseen = group.filter((candidate) => !seen.has(factIdentity(candidate.text)));
    known += group.length - unseen.length;
    const lines = unseen
      .map((candidate) => memoryEntry(candidate.text, { source, now: now(), readers: { kind: "person" }, ...(candidate.until ? { until: candidate.until } : {}) }));
    if (!lines.length) continue;
    const title = name.replace(/\.md$/, "").replace(/-/g, " ");
    const aliases = [...new Set(group.flatMap((candidate) => candidate.topicAliases ?? []))];
    try {
      writeMemoryTopic(botId, name, mergeTopicText(current, { title, aliases, lines }));
    } catch {
      continue;
    }
    recordMemoryChange(botId, { path, actor: "upkeep", via: "capture", threadId, before: current, after: readRaw(botId, path) });
    existing.set(name.toLowerCase(), name);
    topics += lines.length;
  }
  return { added, topics, known };
}

export async function captureCallPhase(host: MemoryPhaseHost, batches: readonly CaptureBatch[]): Promise<CaptureReport> {
  const { deps, now, log, pause, queue, record, writing, attribute, fileCandidates, organize, readRaw, askModel, upkeepEnabled, NO_TEXT_ENGINE } = host;
  const bot = deps.bot(batches[0]!.botId);
  const at = now().getTime();
  const off: CaptureReport = { at, added: 0, topics: 0, aboutMe: 0, note: "upkeep is off" };
  if (!upkeepEnabled(bot)) return off;
  const confidential = (threadId: string) => Boolean(deps.capturable && !deps.capturable(threadId));
  // A room turn queued before Learn from group chats was switched off, or
  // before the room or the bot changed who can see them, is dropped too.
  const allowed = (threadId: string) => !confidential(threadId) && (deps.mayCapture?.(bot.id, threadId) ?? true);
  const refusal = (threadIds: readonly string[]): CaptureReport => ({
    ...off,
    note: threadIds.some(confidential) ? "the conversation is confidential" : "this conversation no longer feeds the bot's memory",
  });
  const byThread = new Map<string, CaptureBatch>();
  for (const batch of batches) {
    if (!allowed(batch.threadId)) continue;
    const same = byThread.get(batch.threadId);
    if (same) same.turns.push(...batch.turns);
    else byThread.set(batch.threadId, { ...batch, turns: [...batch.turns] });
  }
  const conversations = [...byThread.values()];
  if (!conversations.length) return refusal(batches.map((batch) => batch.threadId));
  const engine = deps.engine(bot.id);
  if (!engine?.generateText) {
    const report = { at, added: 0, topics: 0, aboutMe: 0, note: NO_TEXT_ENGINE };
    record(bot.id, { lastCapture: report });
    return report;
  }
  ensureWorkspace(bot.id);
  const today = memoryDate(now());
  const answer = await askModel(engine, capturePrompt({
    botName: bot.name,
    conversations: conversations.map((conversation) => conversation.turns),
    notebook: readRaw(bot.id, "MEMORY.md") ?? "",
    today,
    topics: memoryTopicIndex(bot.id),
  }));
  if (answer === null) {
    const report = { at, added: 0, topics: 0, aboutMe: 0, note: "The capture call did not answer in time." };
    record(bot.id, { lastCapture: report });
    return report;
  }
  if (pause.on) {
    // a backup began while the model answered: ask again after it
    queue.unshift(...conversations.map((batch) => ({ batch })));
    return { at, added: 0, topics: 0, aboutMe: 0, note: "deferred until the backup finishes" };
  }
  // Re-read after the await: the bot or the person may have written since,
  // and a thread may have turned confidential while the model answered.
  // From here to the journal rows there is no await, so no write interleaves.
  if (!upkeepEnabled(deps.bot(bot.id))) return off;
  const still = conversations.map((conversation) => allowed(conversation.threadId));
  const refused = refusal(conversations.filter((_, i) => !still[i]).map((conversation) => conversation.threadId));
  if (!still.some(Boolean)) return refused;
  // A thread turned confidential (or stopped feeding this bot's memory)
  // while the model read it beside others: the model may have filed its
  // facts under another conversation, so the whole answer goes and the
  // others are read again without it.
  if (!still.every(Boolean)) {
    for (const [i, conversation] of conversations.entries()) if (still[i]) queue.push({ batch: conversation });
    return refused;
  }
  const filed = attribute(parseCandidates(answer, today, captureItemLimit(conversations.length)), conversations, still);
  const { added, topics, known } = writing(bot.id, () => {
    let added = 0;
    let topics = 0;
    let known = 0;
    conversations.forEach((conversation, i) => {
      const own = filed.filter((item) => item.at === i).map((item) => item.candidate);
      if (!own.length) return;
      const result = fileCandidates(bot.id, conversation.threadId, own);
      added += result.added;
      topics += result.topics;
      known += result.known;
    });
    return { added, topics, known };
  });
  // Every parsed fact counts for About me, not only new ones: the bot may
  // already have noted it in its own memory, and About me is where every
  // other bot learns it.
  const learned = filed.filter((item) => item.aboutMe).map((item) => item.candidate.text);
  const aboutMe = learned.length ? deps.addToAboutMe({ botId: bot.id, botName: bot.name }, learned) : 0;
  // whoever wrote MEMORY.md (the bot, the person or this capture), detail
  // that is not core moves to its topic now, not only at night
  const organized = await organize(bot.id);
  const report: CaptureReport = { at, added, topics, aboutMe, organized, known };
  record(bot.id, { lastCapture: report });
  if (added || topics || aboutMe) log(`memory upkeep: noticed ${added} fact(s) for MEMORY.md, ${topics} for topic files and ${aboutMe} for About me: ${bot.name} (${bot.id}) from ${conversations.map((conversation) => conversation.threadId).join(", ")}`);
  return report;
}

export async function runTidyPhase(host: MemoryPhaseHost, botId: string): Promise<TidyReport> {
  const { deps, now, log, pause, record, topicCursorOf, writing, organize, appendArchive, runDream, readRaw, askModel, upkeepEnabled, NO_TEXT_ENGINE, MIN_ENTRIES_FOR_CONTRADICTIONS, MAX_TOPIC_CHECKS, MODEL_TIMEOUT_MS } = host;
  const bot = deps.bot(botId);
  const at = now().getTime();
  const today = memoryDate(now());
  const stopped: TidyReport = { at, expired: 0, duplicates: 0, superseded: 0, deferred: 0, contradictionsChecked: false, note: "Memory upkeep is off or pause.on; no further changes were made." };
  if (pause.on || !upkeepEnabled(bot)) return stopped;
  ensureWorkspace(botId);
  const organized = await organize(botId);
  if (pause.on || !upkeepEnabled(deps.bot(botId))) return stopped;
  const first = readRaw(botId, "MEMORY.md") ?? "";
  const engine = deps.engine(botId);
  const candidates = contradictionCandidates(first, today);
  let contradictions: Contradiction[] = [];
  let contradictionsChecked = false;
  let note: string | undefined;
  if (!engine?.generateText) note = NO_TEXT_ENGINE;
  else if (candidates.length < MIN_ENTRIES_FOR_CONTRADICTIONS) note = `Contradictions are checked from ${MIN_ENTRIES_FOR_CONTRADICTIONS} notes on.`;
  else {
    const answer = await askModel(engine, contradictionPrompt(candidates));
    if (answer === null) note = "The contradiction check did not answer in time.";
    else {
      contradictions = parseContradictions(answer, candidates.length);
      contradictionsChecked = true;
    }
  }
  if (pause.on || !upkeepEnabled(deps.bot(botId))) return stopped;
  // Re-read after the await. If the notes changed meanwhile, the model's
  // line numbers no longer point at the same facts: keep only the
  // deterministic steps this time.
  const before = readRaw(botId, "MEMORY.md") ?? "";
  if (before !== first && contradictions.length) {
    contradictions = [];
    note = "The notes changed during the check; contradictions wait for the next tidy-up.";
  }
  const plan = planTidy(before, today, contradictions);
  if (planChanges(plan)) {
    const { text, archived } = applyTidy(before, plan, today);
    // The archive is written first: a line is never out of MEMORY.md
    // before it is in the archive, and the newest journal row — the one a
    // person undoes — is MEMORY.md, whose undo brings the line back.
    writing(botId, () => {
      if (archived.length) appendArchive(botId, archived);
      writeMemoryFile(botId, text);
    });
    recordMemoryChange(botId, { path: "MEMORY.md", actor: "upkeep", via: "tidy", before, after: readRaw(botId, "MEMORY.md") });
  }
  // Project topics also reconcile contradictory decisions; re-read after every model call.
  let topicExpired = 0;
  let topicDuplicates = 0;
  let topicSuperseded = 0;
  let topicDeferred = 0;
  let topicChecks = 0;
  let topicsDeferred = 0;
  let topicCursor = topicCursorOf(botId);
  const deadline = Date.now() + MODEL_TIMEOUT_MS;
  const topics = listMemoryTopics(botId).filter((topic) => topic.name !== ARCHIVE_TOPIC).sort((a, b) => a.name.localeCompare(b.name));
  const cursorAt = topics.findIndex((topic) => topic.name === topicCursor) + 1;
  for (const topic of [...topics.slice(cursorAt), ...topics.slice(0, cursorAt)]) {
    const path = `memory/${topic.name}`;
    const topicBefore = readRaw(botId, path);
    if (topicBefore === null) continue;
    const topicCandidates = contradictionCandidates(topicBefore, today);
    let topicContradictions: Contradiction[] = [];
    if (engine?.generateText && topicCandidates.length >= 2) {
      const remaining = deadline - Date.now();
      if (topicChecks >= MAX_TOPIC_CHECKS || remaining <= 0) topicsDeferred++;
      else {
        topicChecks++;
        topicCursor = topic.name;
        const answer = await askModel(engine, contradictionPrompt(topicCandidates), remaining);
        if (pause.on || !upkeepEnabled(deps.bot(botId))) return stopped;
        if (readRaw(botId, path) !== topicBefore) {
          topicsDeferred++;
          continue;
        }
        if (answer !== null) {
          topicContradictions = parseContradictions(answer, topicCandidates.length);
          contradictionsChecked = true;
          if (note?.startsWith("Contradictions are checked from")) note = undefined;
        } else topicsDeferred++;
      }
    }
    const topicPlan = planTidy(topicBefore, today, topicContradictions, 1);
    topicSuperseded += topicPlan.superseded.length;
    topicDeferred += topicPlan.deferred;
    if (!planChanges(topicPlan)) continue;
    const tidied = applyTidy(topicBefore, topicPlan, today);
    writing(botId, () => {
      if (tidied.archived.length) appendArchive(botId, tidied.archived);
      writeMemoryTopic(botId, topic.name, tidied.text);
    });
    recordMemoryChange(botId, { path, actor: "upkeep", via: "tidy", before: topicBefore, after: readRaw(botId, path) });
    topicExpired += topicPlan.expired.length;
    topicDuplicates += topicPlan.duplicates.length;
  }
  if (topicsDeferred) note = [note, `${topicsDeferred} topic checks deferred because of the budget, a timeout or concurrent edits.`].filter(Boolean).join(" ");
  let dream: DreamReport | undefined;
  try {
    const dreamed = runDream(botId);
    if (dreamed.promoted || dreamed.merged || dreamed.archived) dream = dreamed;
  } catch (error) {
    log(`memory upkeep: dream failed for ${bot?.name ?? botId}: ${(error as Error).message}`);
  }
  const report: TidyReport = {
    at,
    expired: plan.expired.length + topicExpired,
    duplicates: plan.duplicates.length + topicDuplicates,
    superseded: plan.superseded.length + topicSuperseded,
    deferred: plan.deferred + topicDeferred,
    ...(organized ? { organized } : {}),
    contradictionsChecked,
    topicChecks,
    topicsDeferred,
    ...(note ? { note } : {}),
    ...(dream ? { dream } : {}),
  };
  record(botId, { lastTidy: report, topicCursor });
  if (report.expired || report.duplicates || report.superseded || organized) log(`memory upkeep: tidied ${bot?.name ?? botId} — ${report.expired} expired, ${report.duplicates} duplicate(s), ${report.superseded} contradicted`);
  return report;
}
