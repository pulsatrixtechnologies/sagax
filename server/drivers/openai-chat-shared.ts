// Shared constants for the OpenAI chat runtime (extracted with #1383).
export const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/** At most this many models take over one turn after a refusal. */
export const MAX_MODEL_SWITCHES = 3;

/** The plain words a turn ends with when no model of the engine can answer
 * it. "model ... is not supported" lets Auto skip it (model-auto.ts). */
export const noModelLeftMessage = (label: string) =>
  `This model is not supported for conversations (${label}), and no other model of this engine could take over. Choose another model.`;

/** One turn's safety stops: model steps, and tool calls across all of them. */
export const MAX_CHAT_ROUNDS = 64;
export const MAX_TURN_TOOL_CALLS = 200;
export const stoppedAfter = (count: string) =>
  `Stopped after ${count} without a final answer. The steps so far already ran, so ask only for what's left.`;

/** Threads remembered at once; the least recently sent is forgotten first. */
export const MAX_DELIVERED_THREADS = 256;

export const CORRECTIVE_ROUND = "[Sagax: a tool call in this turn failed (its result is marked ok:false). Re-run the failed operations with corrected inputs where possible, check the results, then give your final answer. Do not report results you did not get.]";
export const NUDGE_ANNOUNCED_ACTION = "You said what you would do next but called no tool. Do it now with your tools, or reply with your final answer if nothing is left to do.";

/** A short reply that only announces a next step, with nothing to answer. */
export function announcesAction(text: string): boolean {
  const reply = text.trim();
  if (!reply || reply.length > 400 || reply.includes("?")) return false;
  return /(?:[:\u2014\u2013]|\.\.\.|\u2026)$/.test(reply) ||
    /^(?:checking|let me|i'll|i will|i'm going to|i am going to|opening|pulling|looking|searching|navigating|reading|fetching|loading|now (?:i'll|let me|opening|checking|pulling|reading))\b/i.test(reply);
}

export const TEXT_ONLY_ATTACHMENT_NOTE = "[The person attached image(s), but this model cannot see images. Say so if the request depends on them.]";
export const TEXT_ONLY_SCREENSHOT_NOTE = "[Screenshot not shown: this model cannot see images. Read the page with a snapshot or a text tool instead.]";

/** What a failed turn says once the provider refused every attempt. */
export function refusedToolCallFailure(error: { refusal: { message?: unknown }; message: string }, earlierSteps: boolean): string {
  const words = typeof error.refusal.message === "string" ? error.refusal.message : error.message;
  const tool = /attempted to call tool '([^']+)'/.exec(words)?.[1];
  const what = tool ? `tried to use a tool it was not given ("${tool}")` : "made a tool call the provider rejected";
  const next = earlierSteps
    ? "The steps before it already ran, so ask only for what's left."
    : "Nothing ran. Retry; if it keeps happening, rephrase the request or choose another model.";
  return `The model ${what}. ${next} Provider: ${words.slice(0, 200)}`;
}
