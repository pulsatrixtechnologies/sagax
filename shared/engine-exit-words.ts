// #3008: an engine process that ended before it answered (pi could not
// start, crashed, or was killed) leaves a failed-turn row whose cause is
// the driver's English line plus the tail of the engine's stderr. That tail
// is a machine's words ("spawn npm ENOENT", a stack trace): a person reads
// one plain sentence in the app's language, the raw words stay under
// Details, and an AI client reading the turn gets the plain sentence too.

/** The line a driver writes when its engine process closes before replying. */
export function engineExitedLine(engine: string, stderr: string): string {
  const tail = stderr.trim().slice(-300);
  return `${engine} process exited before replying${tail ? `: ${tail}` : ""}`;
}

const EXITED_BEFORE_REPLY = /^\S+ process exited before replying\b/;

/** Whether a failed turn's cause is an engine process that ended before
 * its reply (engineExitedLine). */
export function isEngineExitedBeforeReply(cause: string): boolean {
  return EXITED_BEFORE_REPLY.test(cause.trim());
}

/** The plain English sentence for such a turn, for callers that read the
 * turn without the app's catalog (the agent API). */
export const ENGINE_EXITED_SENTENCE =
  "The bot's engine stopped before it could reply. Send your message again; if it keeps happening, restart the engine.";
