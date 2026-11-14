// A message sent while the bot works, with no mode named (shared/parallel-tasks.ts
// BusySendRequest "auto", the default since 2026-10-18): the bot orchestrates,
// the person is never asked.
//
// - The engine can take words inside its running turn: they are steered in
//   with a short note naming a routing handle. The bot reads them with the
//   rest of its work and decides (THREADS_PROMPT in server/system-prompt.ts):
//   a precision or correction it uses now; an independent request it hands to
//   route_message `parallel` (a parallel task, server/parallel-tasks.ts); one
//   that needs the running work's result, or touches the same files or
//   records, to route_message `after` (it waits for this turn, then runs).
// - The engine cannot steer, or the steer is refused: the server decides
//   (classifyBusySend, then the bot's own tool-free model for a request
//   only the default classified) between a parallel task and the queue;
//   without an answer, the queue (2026-11-01). Never an error, never a
//   chooser.
//
// Pure helpers and the in-memory handle registry live here; index.ts owns the
// routes and the turn machinery.
import { classifyBusySend, type BusySendMode } from "../shared/parallel-tasks.ts";
import type { VoiceCallMark } from "../shared/wire.ts";
import { isCorrectionUtterance, isStopUtterance } from "../src/lib/voice-mode/voice-topics.ts";

/** How long a steered message stays routable: the running turn reads it and
 * calls route_message, normally within the same turn. */
export const ROUTE_HANDLE_TTL_MS = 6 * 60 * 60 * 1000;
/** The bound on the model's one-shot classification (fallback path only). */
export const BUSY_CLASSIFY_TIMEOUT_MS = 6_000;
/** Resource keys one route_message call may name. */
export const MAX_ROUTE_RESOURCES = 12;

/** A message steered into a running turn that the bot may still route. */
export interface RoutableSteer<C = unknown> {
  botId: string;
  threadId: string;
  /** The person's row in the conversation (written steered). */
  messageId?: string;
  text: string;
  at: number;
  /** Set once route_message moved it: a second call reads as done. */
  routed?: "parallel" | "after";
  /** The parallel task it became, or the queue slot it waits in. */
  target?: string;
  /** What the send carried (sender, usage trigger, speaker...), for the
   * parallel task or the turn it starts later. */
  context: C;
}

/** The steer handles of this process. Lost on restart: a turn that
 * restarts no longer holds the words in its context either. */
export class RoutableSteers<C = unknown> {
  private readonly byHandle = new Map<string, RoutableSteer<C>>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Before the steer: the handle is named in the words the turn reads. */
  open(handle: string, entry: Omit<RoutableSteer<C>, "at">): void {
    this.prune();
    this.byHandle.set(handle, { ...entry, at: this.now() });
  }

  /** After the steer was recorded: the person's row it wrote. */
  bind(handle: string, messageId: string): void {
    const entry = this.byHandle.get(handle);
    if (entry) entry.messageId = messageId;
  }

  /** The steer did not reach the turn: nothing to route. */
  drop(handle: string): void {
    this.byHandle.delete(handle);
  }

  get(handle: string): RoutableSteer<C> | undefined {
    const entry = this.byHandle.get(handle);
    if (entry && this.now() - entry.at > ROUTE_HANDLE_TTL_MS) {
      this.byHandle.delete(handle);
      return undefined;
    }
    return entry;
  }

  /** Every handle of a thread (deleted, made confidential): forgotten. */
  forgetThread(threadId: string): void {
    for (const [handle, entry] of this.byHandle) if (entry.threadId === threadId) this.byHandle.delete(handle);
  }

  private prune(): void {
    const cutoff = this.now() - ROUTE_HANDLE_TTL_MS;
    for (const [handle, entry] of this.byHandle) if (entry.at < cutoff) this.byHandle.delete(handle);
  }
}

/** The note in front of words steered in auto mode. Short: the rule itself
 * is in the system prompt (THREADS_PROMPT). */
export function orchestratedSteerText(handle: string, words: string): string {
  return `[Sent while you work · route ${handle}: use it now if it changes the current work; otherwise call your agents tool route_message (handle "${handle}"), mode parallel when it is independent, after when it needs your result or the same files or records.]\n${words}`;
}

/** The question for the bot's model when the engine cannot steer. */
export function busyClassifyPrompt(input: { running: string; incoming: string }): string {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
  return [
    "You are routing a message a person sent to an assistant that is busy with other work.",
    "Answer with exactly one word:",
    "parallel: the message is an independent request that can run on its own now;",
    "after: it needs the result of the current work, continues it, corrects it, or touches the same files or records.",
    "",
    `Current work: ${clip(input.running.replace(/\s+/g, " ").trim(), 1200) || "(unknown)"}`,
    `New message: ${clip(input.incoming.replace(/\s+/g, " ").trim(), 1200)}`,
    "",
    "Answer:",
  ].join("\n");
}

/** Read the model's answer; anything else is no answer. */
export function parseBusyClassification(answer: string): "parallel" | "after" | null {
  const word = answer.trim().toLowerCase().match(/\b(parallel|after)\b/)?.[1];
  return word === "parallel" || word === "after" ? word : null;
}

/** Where an auto send goes when the running turn cannot take it live:
 * a parallel task or the queue (a correction waits: it applies to the
 * running work, which it cannot join). The heuristic decides what it is
 * sure of; the model (bounded, optional) decides the rest; the default is
 * the queue: the running work's one follow-up, which the safe-point pause
 * starts at once (2026-11-01). A parallel task guessed without the bot's
 * say was a second session answering beside the running turn, and the
 * person read the same things answered twice. Never throws. */
export async function classifyWithoutSteer(input: {
  text: string;
  running: string;
  generateText?: (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;
  timeoutMs?: number;
}): Promise<{ mode: Exclude<BusySendMode, "steer">; by: "rule" | "model" | "default" }> {
  const guess = classifyBusySend({ text: input.text, running: input.running });
  if (guess.sure) return { mode: guess.mode === "steer" ? "after" : guess.mode === "after" ? "after" : "parallel", by: "rule" };
  if (input.generateText) {
    const signal = AbortSignal.timeout(input.timeoutMs ?? BUSY_CLASSIFY_TIMEOUT_MS);
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        Promise.resolve().then(() => input.generateText!(busyClassifyPrompt({ running: input.running, incoming: input.text }), { signal })).then(resolve, reject);
      });
      const mode = parseBusyClassification(answer);
      if (mode) return { mode, by: "model" };
    } catch {
      // timed out or failed: the default below
    }
  }
  return { mode: "after", by: "default" };
}

/** Clean resource keys a bot named: trimmed, lower case, bounded. */
export function routeResources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value
    .filter((key): key is string => typeof key === "string")
    .map((key) => key.trim().toLowerCase().slice(0, 200))
    .filter(Boolean);
  return [...new Set(keys)].slice(0, MAX_ROUTE_RESOURCES);
}

// ── a request said on a call while the bot works (#4216) ──
//
// The rule: on a call, a new request starts at once as its own parallel task
// beside the running work (server/parallel-tasks.ts, the same tasks a typed
// send can become), by default. It steers the running work instead when it
// is a correction or a follow-up of it: a stop, "instead", "actually",
// "no, ...", "rather", "wait", "don't", "change ...", "use ...", "forget
// it", "also for that", "how is it going", an elliptic "and in ...", "what
// about ...", a short line that only narrows it ("only the urgent ones") or
// points back at it ("make it shorter", "send it to the team too"), and
// their French forms. It waits for the running work when it needs its
// result ("then", "once you are done") or names the same file or record. A question is a
// request like any other here: on a call, "what's the last text I got" is
// new work, not a question about the running one.

/** Spoken forms (folded: lower case, no accents, words only) that point a
 * request back at the work in progress. */
const CALL_FOLLOW_UPS = [
  // en
  "actually", "instead", "rather", "i meant", "not that", "also for that", "for that too", "for that one", "same for that",
  "that one", "keep going", "go on", "how is it going", "how s it going", "hows it going", "how far are you", "where are you at",
  "are you done", "is it done", "any news", "hold on", "hang on", "never mind", "nevermind",
  // fr
  "en fait", "plutot", "au lieu", "je voulais dire", "pas ca", "aussi pour ca", "pour ca aussi", "et pour ca", "celui la", "celle la",
  "laisse faire", "laisse tomber", "continue", "ca avance", "t es rendu", "tu es rendu", "c est fait", "as tu fini", "t as fini",
];

/** Openings of an elliptic follow-up that only makes sense with the running
 * request ("and in Quebec City" after "the weather in Montreal"). */
const CALL_FOLLOW_UP_OPENINGS = [
  "and in", "and for", "and at", "and on", "and what about", "what about", "how about", "same for", "same thing for",
  "et a", "et au", "et aux", "et en", "et dans", "et pour", "et sur", "pis a", "pis pour", "pis en", "pareil pour", "meme chose pour",
];

function spokenWords(text: string): string {
  const folded = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return ` ${(folded.match(/[a-z0-9]+/g) ?? []).join(" ")} `;
}

/** What a request said on a call does while the bot works: steer the running
 * work, wait for it, or start beside it (the default). */
export function callBusyMode(input: { text: string; running?: string }): BusySendMode {
  const text = input.text.trim();
  if (!text || isStopUtterance(text) || isCorrectionUtterance(text)) return "steer";
  const words = spokenWords(text);
  if (CALL_FOLLOW_UPS.some((phrase) => words.includes(` ${phrase} `))) return "steer";
  if (CALL_FOLLOW_UP_OPENINGS.some((phrase) => words.startsWith(` ${phrase} `))) return "steer";
  // The typed-send rule, with two changes: "also ..." on a call is a new
  // request (it is dropped before the steer hints are read), and a question
  // is new work, not a question about the running one. Its other steer
  // hints ("wait", "don't", "change", "use ...", "oublie", ...) still steer.
  const guess = classifyBusySend({ text: withoutAlso(text), running: input.running });
  if (guess.why === "correction") return "steer";
  if (guess.mode === "after") return "after";
  if (narrowsOrPointsBack(text, words)) return "steer";
  return "parallel";
}

/** "also check my calendar": the "also" alone does not make it a correction. */
function withoutAlso(text: string): string {
  return text.replace(/(^|[\s,])(also|aussi)(?=[\s,.!?]|$)/giu, "$1").replace(/\s+/g, " ").trim();
}

/** Openings of a short line that only narrows the running request
 * ("only the urgent ones", "juste ceux d'aujourd'hui"). */
const NARROWING = /^ (only|just|juste|seulement|uniquement|rien que) (the|those|these|ones|my|ceux|celles|les|le|la|l|ce|ces|cette|mes|ma|mon) /;
/** Words that point a short line back at the running work ("make it
 * shorter", "send it to the team too", "oublie ca"). */
const POINTING_BACK = [" it ", " that ", " them ", " ca ", " cela "];
/** "it" opening its own clause ("check if it is raining") is not a pointer. */
const NOT_A_POINTER = [" it is ", " it s ", " that is ", " that s ", " ca va ", " ca fait "];
/** Openings of a spoken question: new work on a call, not a pointer. */
const ASKING = /^ (what|whats|when|where|who|whose|why|how|which|is|are|was|were|do|does|did|can|could|quel|quelle|quels|quelles|quand|ou|pourquoi|comment|combien|qui|est ce) /;
/** A French negated order ("n'envoie pas", "ne le fais plus"). */
const NEGATED = /( ne | n )\S.*( pas | plus | jamais )/;

/** A short spoken line that narrows, cancels or points back at the running
 * request: it steers, never a task of its own (#4216, "a correction steers"). */
function narrowsOrPointsBack(text: string, words: string): boolean {
  const count = words.trim().split(" ").length;
  if (count > 8) return false;
  if (NARROWING.test(words)) return true;
  if (NEGATED.test(words)) return true;
  // a French object pronoun after the verb: "envoie-le", "garde-les"
  if (/\p{L}-(le|la|les|lui|leur)\b/iu.test(text)) return true;
  // a question's "it" is its own subject ("what time is it in Tokyo")
  if (/[?？]\s*$/.test(text) || ASKING.test(words)) return false;
  return POINTING_BACK.some((word) => words.includes(word)) && !NOT_A_POINTER.some((phrase) => words.includes(phrase));
}

/** A whole line said on a call (the voice mode marks each utterance). Not a
 * speech-to-text partial, not the end of a sentence cut by a pause (it
 * completes the line before it), and not a line typed while a call is open
 * (it carries the call's id only): those keep joining the running turn. */
export function isSpokenCallSend(mark: VoiceCallMark | undefined): boolean {
  return Boolean(mark?.utteranceId) && mark?.speculative !== true && mark?.continues !== true;
}

/** Start a call request's parallel task; past the bot's parallel limit (the
 * task line is full too: `parallel_limit`), it waits in the queue instead. */
export async function parallelOrWait<T>(start: () => Promise<T>, wait: () => T): Promise<T> {
  try {
    return await start();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "parallel_limit") return wait();
    throw error;
  }
}
