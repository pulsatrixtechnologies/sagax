// The rows a server restart leaves in a conversation. The server stores them
// in English (the phones read only these words, and a room is read by people
// in several languages); the app reads them back through
// restartSentenceKey and says them in the reader's language. One place, so
// a reworded server line can never fall back to English on screen.

/** A turn the restart cut and nothing resumes (a held card, a room round). */
export const TURN_CUT_BY_RESTART = "turn interrupted — Sagax restarted";
/** The resume of a cut turn failed to start; the engine's words follow. */
export const TURN_RESUME_FAILED_PREFIX = `${TURN_CUT_BY_RESTART}; resuming failed: `;
export const TURN_NOT_RESUMED = `${TURN_CUT_BY_RESTART} and this turn did not resume; send your request again`;
export const TURN_NOT_RESUMED_NEWER = `${TURN_CUT_BY_RESTART}; a newer request took this conversation, so the cut turn was not resumed. Send it again if it is still needed`;
/** Written at shutdown on a turn that comes back by itself. */
export const RESTART_TURN_NOTE = "Sagax restarted during this turn; it resumes when Sagax is back";
export const RESTART_RUN_NOTE = "Sagax restarted during this run; it resumes when Sagax is back";
/** A parallel task whose turn never started. */
export const PARALLEL_NOT_STARTED = "the task could not start";
/** An answer to a card whose request had already closed (often a restart). */
export const ANSWER_NOT_DELIVERED = "Couldn't deliver that answer — the request is no longer open, so the action was not run";

export type RestartSentence =
  | { key: "restart.cut" }
  | { key: "restart.resumeFailed"; detail: string }
  | { key: "restart.notResumed" }
  | { key: "restart.notResumedNewer" }
  | { key: "restart.turnNote" }
  | { key: "restart.runNote" }
  | { key: "parallel.notStarted" }
  | { key: "answer.notDelivered" };

/** Which restart line `text` is, or null for any other words. */
export function restartSentenceKey(text: string): RestartSentence | null {
  const words = text.trim();
  if (words === TURN_CUT_BY_RESTART) return { key: "restart.cut" };
  if (words.startsWith(TURN_RESUME_FAILED_PREFIX)) return { key: "restart.resumeFailed", detail: words.slice(TURN_RESUME_FAILED_PREFIX.length).trim() };
  if (words === TURN_NOT_RESUMED) return { key: "restart.notResumed" };
  if (words === TURN_NOT_RESUMED_NEWER) return { key: "restart.notResumedNewer" };
  if (words === RESTART_TURN_NOTE) return { key: "restart.turnNote" };
  if (words === RESTART_RUN_NOTE) return { key: "restart.runNote" };
  if (words === PARALLEL_NOT_STARTED) return { key: "parallel.notStarted" };
  if (words === ANSWER_NOT_DELIVERED) return { key: "answer.notDelivered" };
  return null;
}

/** The French words a server writes itself (a parallel task's result line,
 * which the bot reads back too), per restartSentenceKey. The app's own
 * reading goes through its locale files (src/lib/engine-error-text.ts). */
const FRENCH: Record<RestartSentence["key"], string> = {
  "restart.cut": "tour interrompu : Sagax a redémarré",
  "restart.resumeFailed": "tour interrompu : Sagax a redémarré et la reprise a échoué",
  "restart.notResumed": "tour interrompu : Sagax a redémarré et ce tour n'a pas repris. Renvoie ta demande",
  "restart.notResumedNewer": "tour interrompu : Sagax a redémarré et une demande plus récente a pris la conversation, alors le tour coupé n'a pas repris. Renvoie-le s'il faut encore",
  "restart.turnNote": "Sagax a redémarré pendant ce tour ; il reprend quand Sagax revient",
  "restart.runNote": "Sagax a redémarré pendant cette exécution ; elle reprend quand Sagax revient",
  "parallel.notStarted": "elle n'a pas pu démarrer",
  "answer.notDelivered": "impossible de livrer cette réponse : la demande n'est plus ouverte, alors l'action n'a pas été faite",
};

/** `text` in the person's language when it is a restart line and that
 * language is French; any other words stay as they are. */
export function restartSentenceIn(language: string | undefined, text: string): string {
  if (!language?.toLowerCase().startsWith("fr")) return text;
  const known = restartSentenceKey(text);
  if (!known) return text;
  return known.key === "restart.resumeFailed" && known.detail ? `${FRENCH[known.key]} : ${known.detail}` : FRENCH[known.key];
}
