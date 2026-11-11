// #3217: the rows a restart leaves in a conversation are stored in English
// (shared/restart-words.ts). An AI client reads them through the agent API
// (await_turn, read_transcript) in the person's language, through the one
// way a server line is said (server/people/person-words.ts serverLineIn).
// These read what a restart row means for a waiting turn.
import { RESUMING_STEP, restartSentenceKey } from "../../shared/restart-words.ts";
import { CUT_TWICE, INTERRUPTED_OUTWARD } from "../runtime/tree.ts";

export { RESUMING_STEP };

/** Whether an activity row says the turn was cut by a restart and waits
 * for its resume: the stop's note, or the resuming step. */
export function restartPendingRow(name: string, ok: boolean): boolean {
  if (!ok) return false;
  const words = name.trim();
  return words === RESUMING_STEP || restartSentenceKey(words)?.key === "restart.turnNote";
}

/** Whether a failed turn's cause is a restart that did not resume it. */
export function restartCauseNotResumed(cause: string): boolean {
  const words = cause.trim();
  if (words.startsWith(INTERRUPTED_OUTWARD) || words === CUT_TWICE) return true;
  const known = restartSentenceKey(words);
  return known?.key === "restart.cut" || known?.key === "restart.resumeFailed" || known?.key === "restart.notResumed" || known?.key === "restart.notResumedNewer";
}
