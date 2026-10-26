// Parallel tasks: a request sent to a bot that is already working can run as
// its own task instead of joining or waiting behind the running turn.
//
// A parallel task is an ordinary thread of the same bot (same persona,
// memory and tools, its own engine session and working context) linked to
// the conversation it was asked from (`WireTask.parallelOf`). The
// conversation shows the request, a live task card (`Message.parallelTask`)
// and, when the task settles, its result as a reply quoting the request.
// Server: server/parallel-tasks.ts and the send route in server/index.ts.

/** What a message sent while the bot is busy does.
 * - steer: join the running turn (queued when the engine cannot take it live).
 * - parallel: run as its own task, in parallel.
 * - after: wait for the running turn, then run (the queue). */
export type BusySendMode = "steer" | "parallel" | "after";

/** What a send asks for. `auto` (the default since 2026-10-18, JC: the bot
 * orchestrates, the person is never asked) leaves it to the bot: a
 * correction of the running work joins it, an independent request runs as a
 * parallel task, one that depends on the running work or touches the same
 * files waits for it (server/busy-routing.ts). The three explicit modes stay
 * for the API, relays and older builds. */
export type BusySendRequest = BusySendMode | "auto";

/** An older build's per-person default (localStorage, synced per person on
 * an organization server). No client reads it any more: every send is auto. */
export type BusySendPreference = "ask" | BusySendMode;

export const BUSY_SEND_PREFERENCE_KEY = "sagax.busySend.v1";

export function isBusySendMode(value: unknown): value is BusySendMode {
  return value === "steer" || value === "parallel" || value === "after";
}

export function isBusySendRequest(value: unknown): value is BusySendRequest {
  return value === "auto" || isBusySendMode(value);
}

export function parseBusySendPreference(value: unknown): BusySendPreference {
  return value === "ask" || isBusySendMode(value) ? value : "ask";
}

/** Where a parallel task stands, as its card in the conversation shows it. */
export type ParallelTaskState = "queued" | "running" | "done" | "failed" | "stopped";

/** On a conversation's messages: the request line, the task card and the
 * result reply all carry the task they belong to. */
export interface ParallelTaskRef {
  /** The task's own thread (same bot). */
  threadId: string;
  /** Short name of the task, as its sidebar row reads. */
  title: string;
  /** The person's request line in the conversation the task answers. */
  requestMessageId: string;
  /** request: the person's words; card: the live card; result: the answer. */
  role: "request" | "card" | "result";
  /** On the card only: the last state the server recorded. While the task
   * runs, clients read live state from the task itself (busy, activity). */
  state?: ParallelTaskState;
  startedAt?: number;
  endedAt?: number;
}

/** On a task opened as a parallel task: the conversation it answers. */
export interface TaskParallelOf {
  threadId: string;
  /** The request line in that conversation. */
  messageId: string;
  /** The task card in that conversation, patched as the task moves. */
  cardMessageId?: string;
  at: number;
  /** Who asked (organization server): the person whose limit it counts in. */
  principalId?: string;
  /** Set once the result was posted back. */
  reportedAt?: number;
  /** How it ended, once reported. */
  outcome?: ParallelTaskState;
  /** Opened by the bot itself (start_thread with report_back), not a person. */
  byBot?: boolean;
  /** The files or records it writes, as the bot named them (route_message):
   * a task waits while another pending one names the same (one queue per
   * resource, server/parallel-tasks.ts parallelResourceBlocked). */
  resources?: string[];
  /** Routed by the bot from a message steered into its running turn. */
  routed?: boolean;
}

/** Default number of parallel tasks one person may have running on one bot. */
export const DEFAULT_MAX_PARALLEL_PER_PERSON = 3;
export const MAX_PARALLEL_PER_PERSON = 10;

/** Words that read as a change to the running work, not a new request. */
const STEER_HINTS = [
  // fr
  "arrête", "arrete", "stop", "plutôt", "plutot", "attends", "non,", "non ", "aussi", "en fait", "oublie", "change", "corrige", "continue", "au lieu",
  // en
  "instead", "wait", "also", "actually", "don't", "dont", "cancel", "rather", "keep going", "use ", "no,",
];

/** A short correction reads as a steer; anything else as unrelated work,
 * which runs in parallel. The first guess of classifyBusySend. */
export function suggestBusySendMode(text: string): BusySendMode {
  const words = text.trim().toLowerCase();
  if (!words) return "steer";
  const short = words.length <= 60;
  if (short && STEER_HINTS.some((hint) => words.startsWith(hint) || words.includes(` ${hint}`))) return "steer";
  return "parallel";
}

/** Openers that mark an interrogative turn. A turn that opens with one of
 * these, or ends with a question mark, is a question about the work, not a
 * new piece of work to run on its own. Includes a few request-to-explain
 * verbs ("explique", "explain", "dis-moi") that read the same way, and the
 * spoken-Québec elision "ques" for "qu'est-ce". */
const QUESTION_OPENERS = [
  // fr
  "pourquoi", "comment", "qu'est-ce", "qu est-ce", "quest-ce", "ques ", "ques-ce", "c'est quoi", "cest quoi",
  "c quoi", "quoi ", "qui ", "quand ", "où ", "ou est", "ou sont", "combien", "lequel", "laquelle",
  "est-ce", "est ce", "peux-tu", "peux tu", "peut-on", "pourrais-tu", "pourrais tu", "as-tu", "es-tu",
  "veux-tu", "explique", "dis-moi", "dis moi", "montre-moi", "montre moi",
  // en
  "why", "how", "what", "who ", "whom", "when ", "where ", "which", "whose", "is ", "are ", "do ", "does ",
  "did ", "can you", "could you", "can ", "should ", "would ", "was ", "were ", "explain", "tell me", "show me",
];

/** References that point a short follow-up back at the current work rather
 * than at new, independent work: demonstratives and second-person forms. A
 * few consecutive messages ("et ça?", "tu as fait quoi") read this way. */
const FOLLOWUP_REFS = [
  // fr
  "ça", "ca", "ceci", "cela", "ce ", "cette ", "tu ", "t'", "vous ", "ton ", "ta ", "tes ",
  // en
  "you ", "your ", "that ", "this ",
];

/** The person asked for the work to run off the main thread (in parallel /
 * in the background): a genuine parallel task even when phrased as a
 * question. */
const BACKGROUND_HINTS = [
  // fr
  "arrière-plan", "arriere-plan", "en parallèle", "en parallele", "en tâche de fond", "en tache de fond",
  "pendant ce temps", "pendant que tu", "tâche parallèle", "tache parallele",
  // en
  "in parallel", "in the background", "in background", "on the side", "meanwhile", "as a task", "a separate task",
];

function wantsBackground(words: string): boolean {
  return BACKGROUND_HINTS.some((hint) => words.includes(hint));
}

/** A question, a request to explain, or a short follow-up that points back
 * at the current work. Such a turn is answered inline (in the conversation),
 * never spun off as its own parallel task. */
function isInlineFollowUp(text: string): boolean {
  const words = text.trim().toLowerCase();
  if (!words) return false;
  if (/[?？]\s*$/.test(text.trim())) return true;
  if (QUESTION_OPENERS.some((opener) => words.startsWith(opener))) return true;
  if (words.length <= 80 && FOLLOWUP_REFS.some((ref) => words.startsWith(ref) || words.includes(` ${ref}`))) return true;
  return false;
}

/** Words that say the request needs the running work's result first. */
const AFTER_HINTS = [
  // fr
  "ensuite", "après ça", "apres ca", "après ceci", "une fois que", "une fois fini", "une fois terminé", "quand tu auras", "quand t'auras", "quand tu as fini",
  "avec le résultat", "avec le resultat", "à partir du résultat", "à partir de ça", "le même fichier", "ce même fichier", "dans ce fichier", "puis ",
  // en
  "after that", "afterwards", "then ", "once you're done", "once you are done", "once that's done", "when you're done", "when you are done",
  "when you finish", "with the result", "using the result", "based on that", "same file", "that file", "in that file",
];

/** File paths, ticket numbers and record ids a message names: two pieces of
 * work naming the same one touch the same resource. */
export function namedResources(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:^|[\s(`"'])((?:~|\.{1,2})?\/?(?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:ts|tsx|js|mjs|json|md|swift|py|rs|go|yaml|yml|sql|csv|xlsx|docx|pdf|txt|html|css))(?=$|[\s),.;:`"'])/gi)) {
    found.add(`file:${match[1]!.replace(/^\.\//, "").toLowerCase()}`);
  }
  for (const match of text.matchAll(/(?:#|\b(?:ticket|billet|issue|pr|invoice|facture)\s*#?\s*)(\d{3,})\b/gi)) found.add(`id:${match[1]}`);
  return [...found];
}

/** Whether two resource lists share one key. A key names a resource
 * (`file:src/a.ts`, `id:123456`, or any key a bot gives route_message);
 * comparison ignores case. */
export function resourcesOverlap(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  const left = new Set(a.map((key) => key.trim().toLowerCase()).filter(Boolean));
  return b.some((key) => left.has(key.trim().toLowerCase()));
}

/** Where an auto send goes while the bot works, without asking the model:
 * a short correction joins the running work, a request that needs its
 * result or names a resource the running work names waits for it, a question
 * or short follow-up about the current work is answered inline (as a steer,
 * so it never becomes its own task), and anything else runs in parallel.
 * `sure` is false when only the default picked it (the server may then ask
 * the bot's model). A turn that explicitly asks to run in the background
 * (`wantsBackground`) keeps its parallel default even when phrased as a
 * question, so a real backgroundable job still goes parallel. */
export function classifyBusySend(input: { text: string; running?: string }): { mode: BusySendMode; sure: boolean; why: "correction" | "depends" | "same-resource" | "question" | "independent" } {
  const words = input.text.trim().toLowerCase();
  if (suggestBusySendMode(input.text) === "steer") return { mode: "steer", sure: true, why: "correction" };
  if (AFTER_HINTS.some((hint) => words.startsWith(hint.trimEnd()) || words.includes(` ${hint}`) || words.includes(`, ${hint}`))) return { mode: "after", sure: true, why: "depends" };
  if (input.running && resourcesOverlap(namedResources(input.text), namedResources(input.running))) return { mode: "after", sure: true, why: "same-resource" };
  if (!wantsBackground(words) && isInlineFollowUp(input.text)) return { mode: "steer", sure: true, why: "question" };
  return { mode: "parallel", sure: false, why: "independent" };
}

/** A task card's state from the task's live record. */
export function liveParallelState(
  recorded: ParallelTaskState | undefined,
  task: { busy?: boolean; activity?: string } | undefined,
  queued: boolean,
): ParallelTaskState | "waiting" {
  if (recorded === "done" || recorded === "failed" || recorded === "stopped") return recorded;
  if (task?.activity === "waiting-on-you") return "waiting";
  if (task?.busy) return "running";
  if (queued) return "queued";
  return recorded ?? "queued";
}
