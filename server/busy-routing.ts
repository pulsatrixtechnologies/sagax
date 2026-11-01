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
