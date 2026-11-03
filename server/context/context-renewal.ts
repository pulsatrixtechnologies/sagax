// A turn whose engine session ran out of room keeps going in a fresh one.
//
// Claude Code compacts its own session when it nears the window Sagax picks
// (--autocompact). When the context fills back up within three model calls of
// each compaction, three times in a row, the CLI gives up on the turn with
// "Autocompact is thrashing … use /clear to start fresh" (api_error
// autocompact_thrashing, terminal reason rapid_refill_breaker). A model call
// that runs parallel tools on a machine (a port scan, a recursive search for
// keys) can add that much on its own. The person never types /clear: the
// driver starts a fresh session for the same turn, hands it the conversation
// and what the turn already did, and the turn goes on (renewalPrompt). Only a
// second overflow in that fresh session reaches the chat, in plain words, and
// the next send (Retry) starts fresh again instead of reopening the full one.
//
// Pure: the drivers own the sessions; this words what they send and show.

/** An engine saying its context is full, in any of the shapes seen: Claude
 * Code's thrashing breaker and its API's 400, Codex's context-window error
 * (codexErrorInfo contextWindowExceeded), an OpenAI-style context_length. */
const CONTEXT_FULL = /\bautocompact is thrashing\b|\bautocompact_thrashing\b|\brapid_refill_breaker\b|\bprompt is too long\b|\bcontext_length_exceeded\b|\bcontextWindowExceeded\b|\bran out of room in the model'?s context window\b|\bexceeds? the (?:model'?s? )?context window\b|\bmaximum context length\b/i;

export function isContextFullText(text: string | null | undefined): boolean {
  return typeof text === "string" && CONTEXT_FULL.test(text);
}

/** The Events lens line (runtime.notice) when a turn went on in a fresh
 * session; the chat shows nothing (shared/chat-notices.ts). */
export function contextRenewedNotice(engine: string): string {
  return `${engine}'s context filled up during this turn, so it went on in a fresh session that was given the conversation and the steps already done.`;
}

/** The one row a person reads when even a fresh session filled up. No
 * command to type: sending again (Retry) starts fresh. Kept clear of the
 * words classifyError reads as a transient or account failure. */
export function contextFullMessage(engine: string): string {
  return `${engine} had more to keep in mind than fits in one session, even after starting fresh. Press Retry to continue from here in a new session, or ask for a smaller step.`;
}

/** One step the turn already took, as the driver saw it. */
export interface RenewalStep {
  /** the engine's id for the call, to attach its result */
  id?: string;
  name: string;
  /** the command or a short form of the arguments */
  summary?: string;
  ok?: boolean;
  /** a short preview of what it returned */
  output?: string;
}

const STEPS_KEPT = 20;
const SUMMARY_CHARS = 160;
const OUTPUT_CHARS = 240;
const LAST_TEXT_CHARS = 800;
const NOTE_CHARS = 6_000;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Record a step, keeping only the latest ones. */
export function pushRenewalStep(steps: RenewalStep[], step: RenewalStep): void {
  steps.push(step);
  if (steps.length > STEPS_KEPT) steps.splice(0, steps.length - STEPS_KEPT);
}

/** What the fresh session is sent: the conversation as the turn carried it
 * (`base`: the rebuild from the chat when the turn had one, else the turn's
 * own text), then a short note of what this turn already did. The note is
 * bounded: it must never be what fills the new session. */
export function renewalPrompt(input: {
  base: string; steps: readonly RenewalStep[]; lastText?: string;
  /** Why the work moved: the session's context filled up (the default), or
   * the engine reached its usage limit and another one carries the same
   * turn on (server/usage/limit-failover-host.ts). */
  cause?: "context" | "limit";
}): string {
  const lines = input.steps.slice(-STEPS_KEPT).map((step) => {
    const what = [step.name, step.summary ? oneLine(step.summary, SUMMARY_CHARS) : ""].filter(Boolean).join(": ");
    const how = step.ok === undefined ? "no result" : step.ok ? "done" : "failed";
    const out = step.output ? ` -> ${oneLine(step.output, OUTPUT_CHARS)}` : "";
    return `- ${what} (${how})${out}`;
  });
  const said = input.lastText?.trim() ? `What you last wrote: ${oneLine(input.lastText, LAST_TEXT_CHARS)}` : "";
  const limit = input.cause === "limit";
  const note = (kept: string[]) => [
    limit
      ? "[Sagax note, not from the person: the engine that was working on this request reached its usage limit in the middle of the work,"
      : "[Sagax note, not from the person: your previous session for this request ran out of context space in the middle of the work",
    limit
      ? "so you continue the same request now. Do not mention the switch: just carry on."
      : "(a tool output or a file was too large), so you continue it now in a fresh session.",
    kept.length ? `Steps you already took for this request, with the start of what each returned:\n${kept.join("\n")}` : "No step had finished yet.",
    said,
    `Carry on from where you stopped. Do not redo a step that already succeeded unless you need its result again.${limit ? "]" : ""}`,
    limit ? "" : "Keep each output small: filter it (grep, head, tail, a narrower command, fewer hosts or ports at a time) and read big files in pieces.]",
  ].filter(Boolean).join("\n");
  // The latest steps matter most: the oldest go first until the note fits.
  let kept = lines;
  while (kept.length && note(kept).length > NOTE_CHARS) kept = kept.slice(1);
  return `${input.base.trimEnd()}\n\n${note(kept)}`;
}
