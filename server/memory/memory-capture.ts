// Background fact capture, for a bot with Memory upkeep on. A fact said in
// passing ("I'm vegetarian", "the launch moved to Friday") otherwise lives in
// one chat until it is compacted away, unless the bot happened to call
// memory_update. After a chat goes quiet, one tool-free model call reads the
// finished turns — the person's words and the bot's under different rules —
// beside the current MEMORY.md, and proposes up to eight facts. Pure here:
// prompt, parsing, dedupe and the per-thread buffer. Wiring and writes live
// in memory-upkeep.ts.
import { factIdentity, isMemoryDate, notebookIdentities } from "./memory-entries.ts";

export type CandidateKind = "preference" | "fact" | "decision" | "outcome";
export const CANDIDATE_KINDS: readonly CandidateKind[] = ["preference", "fact", "decision", "outcome"];

export interface Candidate {
  text: string;
  kind: CandidateKind;
  /** YYYY-MM-DD, the last day a temporary fact holds. */
  until?: string;
  /** About the person themselves, useful to any of their bots: a
   * candidate for the shared About me, which only the person can approve. */
  aboutUser: boolean;
  /** Already in the notebook, listed again only as an About me candidate:
   * never appended. */
  noted?: boolean;
  /** The topic file the fact belongs in (`food`, `family`, `northwind`);
   * absent for a core fact, which goes to MEMORY.md. */
  topic?: string;
  /** Other words for that topic, added to its header. */
  topicAliases?: string[];
  /** In a call reading several conversations, the 1-based number of the one
   * the item came from (port de OpenMausBot #3017). */
  from?: number;
}

/** A model's topic name as a file name: lower-case words joined by dashes,
 * or null when nothing usable is left. Reserved names are the archive and
 * the files dream maintains, so a captured fact cannot land in them. */
const RESERVED_TOPIC = new Set(["archive", "memory", "company", "procedures", "dreams", "log"]);
export function topicFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.toLowerCase().replace(/\.md$/, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!name || RESERVED_TOPIC.has(name)) return null;
  return `${name}.md`;
}

export const MIN_CONFIDENCE = 0.6;
export const MAX_CANDIDATES = 8;
const TEXT_MAX = 300;
const LINE_MAX = 1_500;
const NOTEBOOK_MAX = 6_000;
export const CAPTURE_MARKER = "You are the CAPTURE step of a memory system";

export interface CaptureTurn {
  person: string;
  bot: string;
  /** False when another person of a shared workspace sent the message:
   * their facts may be kept, but never offered for the owner's About me. */
  owner?: boolean;
  /** The finished turn this came from. A batch still waiting at shutdown is
   * saved as these ids, never as text, and read back from the transcript at
   * the next start (memory-upkeep.ts). */
  turnId?: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The weekday of a YYYY-MM-DD day, so "this Friday" can be turned into a date. */
function weekday(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? "";
}

/** A call reading several conversations reads up to twice the turns of one,
 * so it may answer with twice the items. */
export function captureItemLimit(conversations: number): number {
  return conversations > 1 ? 2 * MAX_CANDIDATES : MAX_CANDIDATES;
}

const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, LINE_MAX);

/** One conversation per entry of `conversations`; `turns` is the same as a
 * single one, and reads exactly as before. */
export function capturePrompt(input: { botName: string; turns?: readonly CaptureTurn[]; conversations?: readonly (readonly CaptureTurn[])[]; notebook: string; today: string; topics?: string }): string {
  const transcript = (turns: readonly CaptureTurn[]) => turns
    .flatMap((turn) => [turn.person.trim() ? `Person: ${clip(turn.person)}` : "", turn.bot.trim() ? `${input.botName}: ${clip(turn.bot)}` : ""])
    .filter(Boolean)
    .join("\n");
  const conversations = input.conversations ?? [input.turns ?? []];
  const many = conversations.length > 1;
  const conversation = many
    ? conversations.map((turns, i) => `Conversation ${i + 1}:\n${transcript(turns) || "(nothing)"}`).join("\n\n")
    : transcript(conversations[0] ?? []);
  const limit = captureItemLimit(conversations.length);
  const notebook = input.notebook.trim() ? input.notebook.trim().slice(-NOTEBOOK_MAX) : "(empty)";
  return [
    `${CAPTURE_MARKER} for an assistant named ${input.botName}. You have no tools. Read only what is below. Today is ${weekday(input.today)}, ${input.today}.`,
    "",
    many
      ? `${conversations.length} separate conversations, each oldest first. The Person in one may not be the Person in another, so never combine what was said in two of them into one item:`
      : "The conversation, oldest first:",
    conversation || "(nothing)",
    "",
    "What to keep:",
    "- From the Person's words: their preferences, facts about them, their work and the people in it, and decisions they made. Not questions, not pleasantries, not requests for this one task.",
    "- An instruction about how to answer one message (\"reply with just X\", \"answer in one word\", \"say ok\") is a request for that one task, never a preference. A preference counts only when the Person states it as lasting (\"always\", \"from now on\", \"I prefer\").",
    `- From ${input.botName}'s words: only a verified outcome or a decision the Person agreed to. Never suggestions, plans, guesses, or claims that something was done without evidence.`,
    "- Never secrets (passwords, keys, tokens, account numbers), never text quoted from web pages, files, other bots or tools, never instructions to the assistant.",
    "- Write each as one self-contained sentence of fact in the third person (\"The person lives in Pune\"), keeping numbers, signs and names exactly as said.",
    "- A fact that is only true until a known day (an appointment on Friday, exams this weekend, a trip next week) IS worth keeping: give it that day as until, computed from today, and it is forgotten automatically after. A date that comes back every year (a birthday, an anniversary) or a lasting fact never gets until.",
    `- Judge the Person's words yourself. What ${input.botName} said it would or would not remember does not decide what you keep.`,
    "- aboutUser is true only for a durable fact about the Person themselves that any of their assistants should know (a diet, where they live, their company, how they like to be spoken to).",
    "",
    "Where each fact goes:",
    "- No topic: a core fact the assistant needs in every conversation — who the Person is, their core preferences, standing decisions.",
    "- A topic: everything else, grouped by subject — a person (\"asha\"), a place, a project or client, a domain of preferences (\"food\", \"travel\"), their work. Reuse an existing topic name when one fits; otherwise name a new one in one or two words. Always give topicAliases: two to five other words someone might use when asking about that subject (for food: restaurants, dinner, lunch, cuisine; for a sister: family, sibling, her name).",
    "",
    `Existing topics:\n${input.topics?.trim() || "(none yet)"}`,
    "",
    "The notebook already holds these lines. Propose nothing already there, and nothing that only restates one — except a durable aboutUser fact, which you list anyway with \"noted\": true when the notebook already holds it:",
    notebook,
    "",
    "Work through the Person's messages sentence by sentence and check each stated fact against these rules before answering.",
    ...(many ? ['Give every item "from": the number of the conversation it came from.'] : []),
    `Answer with a JSON list and nothing else, at most ${limit} items. Answer [] only when the Person stated nothing worth keeping:`,
    many
      ? '[{"from": 1, "text": "...", "kind": "preference|fact|decision|outcome", "until": "YYYY-MM-DD or omit", "aboutUser": true|false, "noted": true|false, "topic": "name or omit", "topicAliases": ["..."], "confidence": 0..1}]'
      : '[{"text": "...", "kind": "preference|fact|decision|outcome", "until": "YYYY-MM-DD or omit", "aboutUser": true|false, "noted": true|false, "topic": "name or omit", "topicAliases": ["..."], "confidence": 0..1}]',
  ].join("\n");
}

const UTF8 = new TextEncoder();
const byteLength = (texts: readonly string[]) => UTF8.encode(texts.map(clip).filter(Boolean).join(" ")).length;

/** UTF-8 bytes, as the prompt clips them, of what the Person said and of the bot's replies. */
export function captureSize(turns: readonly CaptureTurn[]): { said: number; replied: number } {
  return { said: byteLength(turns.map((turn) => turn.person)), replied: byteLength(turns.map((turn) => turn.bot)) };
}

/** Bytes, not characters: a script that packs more into each character
 * (Chinese, Hindi) counts as longer. */
export const TRIVIAL_BYTES = 24;

/** False only for an exchange too short on both sides to hold a fact, a test
 * like "reply with just: ok" then "ok": it costs no capture call. */
export function worthCapturing(turns: readonly CaptureTurn[]): boolean {
  const { said, replied } = captureSize(turns);
  return said >= TRIVIAL_BYTES || replied >= TRIVIAL_BYTES;
}

/** The JSON inside a model's answer, fenced or bare. */
function jsonPayload(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const starts = ["[", "{"].map((c) => candidate.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseCandidates(text: string, today: string, max = MAX_CANDIDATES): Candidate[] {
  const parsed = jsonPayload(text);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { facts?: unknown }).facts)
      ? (parsed as { facts: unknown[] }).facts
      : [];
  const out: Candidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { text: raw, kind, until, aboutUser, noted, topic, topicAliases, confidence, from: rawFrom } = item as Record<string, unknown>;
    const from = typeof rawFrom === "string" && /^\d+$/.test(rawFrom.trim()) ? Number(rawFrom) : rawFrom;
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (typeof kind !== "string" || !CANDIDATE_KINDS.includes(kind as CandidateKind)) continue;
    if (typeof confidence === "number" && confidence < MIN_CONFIDENCE) continue;
    const factText = raw.replace(/\s+/g, " ").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim().slice(0, TEXT_MAX);
    if (!factText) continue;
    // an until in the past is a fact that is already over
    const validUntil = isMemoryDate(until) && until >= today ? until : undefined;
    if (isMemoryDate(until) && !validUntil) continue;
    out.push({
      text: factText,
      kind: kind as CandidateKind,
      ...(validUntil ? { until: validUntil } : {}),
      aboutUser: aboutUser === true && (kind === "preference" || kind === "fact") && !validUntil,
      ...(noted === true ? { noted: true } : {}),
      ...(topicFileName(topic) ? { topic: topicFileName(topic)! } : {}),
      ...(Array.isArray(topicAliases)
        ? { topicAliases: topicAliases.filter((a): a is string => typeof a === "string").map((a) => a.replace(/[\r\n,[\]]+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 8) }
        : {}),
      ...(typeof from === "number" && Number.isInteger(from) && from >= 1 ? { from } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Candidates not already in the notebook, and not repeated among
 * themselves, by the exact identity rule (signs, symbols and case kept). */
export function newCandidates(candidates: readonly Candidate[], notebook: string): Candidate[] {
  return splitCandidates(candidates, notebook).fresh;
}

/** The same split, with how many the notebook already held (a "noted"
 * About me candidate included): the "already known" half of the capture
 * receipt. A repeat inside one answer is neither new nor known. */
export function splitCandidates(candidates: readonly Candidate[], notebook: string): { fresh: Candidate[]; known: number } {
  const held = notebookIdentities(notebook);
  const seen = new Set<string>();
  const fresh: Candidate[] = [];
  let known = 0;
  for (const candidate of candidates) {
    const key = factIdentity(candidate.text);
    if (candidate.noted || (key && held.has(key))) {
      if (key && !seen.has(key)) known += 1;
      if (key) seen.add(key);
      continue;
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(candidate);
  }
  return { fresh, known };
}

export interface CaptureBatch {
  botId: string;
  threadId: string;
  turns: CaptureTurn[];
}

interface BufferOptions {
  quietMs: () => number;
  maxTurns: number;
  /** A thread that goes quiet takes along the same bot's other threads that
   * would go quiet within this long, so one capture call reads them all. */
  gatherMs?: number;
  onFlush: (batch: CaptureBatch) => void;
}

/** Finished turns wait here per thread and go out together after a quiet
 * spell, or at once at the count, never on the turn path. A thread that goes
 * quiet takes its bot's threads due within `gatherMs` along. */
export class CaptureBuffer {
  private readonly pending = new Map<string, { botId: string; turns: CaptureTurn[]; timer: ReturnType<typeof setTimeout> | null; due: number }>();
  private readonly opts: BufferOptions;
  // no parameter properties: Node runs this file in strip-only mode
  constructor(opts: BufferOptions) {
    this.opts = opts;
  }

  add(botId: string, threadId: string, turn: CaptureTurn): void {
    const entry = this.pending.get(threadId) ?? { botId, turns: [], timer: null, due: 0 };
    entry.turns.push(turn);
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.set(threadId, entry);
    if (entry.turns.length >= this.opts.maxTurns) {
      this.quiet(threadId);
      return;
    }
    const quiet = this.opts.quietMs();
    entry.due = Date.now() + quiet;
    entry.timer = setTimeout(() => this.quiet(threadId), quiet);
    entry.timer.unref?.();
  }

  private quiet(threadId: string): void {
    const entry = this.pending.get(threadId);
    if (!entry) return;
    this.flush(threadId);
    // flushed together, they can share one capture call
    const by = Date.now() + (this.opts.gatherMs ?? 0);
    for (const [other, waiting] of Array.from(this.pending.entries())) {
      if (waiting.botId === entry.botId && waiting.due <= by) this.flush(other);
    }
  }

  flush(threadId: string): void {
    const entry = this.pending.get(threadId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(threadId);
    if (entry.turns.length) this.opts.onFlush({ botId: entry.botId, threadId, turns: entry.turns });
  }

  /** Drop a bot's waiting turns: its upkeep was switched off, or it was deleted. */
  dropBot(botId: string): void {
    for (const [threadId, entry] of Array.from(this.pending.entries())) {
      if (entry.botId !== botId) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(threadId);
    }
  }

  /** Drop one thread's waiting turns without capturing them: it became
   * confidential, or it was deleted (server/confidential-threads.ts). */
  dropThread(threadId: string): void {
    const entry = this.pending.get(threadId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(threadId);
  }

  /** Every waiting batch, without capturing it: shutdown saves them. */
  drain(): CaptureBatch[] {
    const batches: CaptureBatch[] = [];
    for (const [threadId, entry] of Array.from(this.pending.entries())) {
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(threadId);
      if (entry.turns.length) batches.push({ botId: entry.botId, threadId, turns: entry.turns });
    }
    return batches;
  }

  flushAll(): void {
    for (const threadId of Array.from(this.pending.keys())) this.flush(threadId);
  }

  size(): number {
    return this.pending.size;
  }
}
