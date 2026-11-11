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

/** A turn a restart cut runs again once; cut again, it ends with this. */
export const CUT_TWICE = "Interrupted by another Sagax restart after resuming once; not resumed again. Some of its steps may already have taken effect.";

/** A cut turn that already acted outward is not run again: its outcome
 * detail opens with this, then names what it did (outwardSentence). */
export const INTERRUPTED_OUTWARD = "Interrupted by a Sagax restart after it already";
const OUTWARD_CLOSE = "; not resumed, so nothing is done twice.";

/** What an outward action did, as the person reads it. */
export type OutwardKind = "pushed" | "committed" | "payment" | "email" | "message" | "posted" | "other";

/** The stored English verb phrase of each kind (the label follows in parentheses). */
const OUTWARD_VERBS: Record<OutwardKind, string> = {
  pushed: "pushed",
  committed: "committed",
  payment: "made a payment",
  email: "sent an email",
  message: "sent a message",
  posted: "posted",
  other: "completed an outward action",
};

/** The kind of an outward action from its label: the host names the tool
 * ("GMAIL_SEND_EMAIL", "git push"). Tool slugs join words with underscores,
 * which are word characters, so the money words are matched bare. */
export function outwardKind(label: string): OutwardKind {
  if (/\bgit\s+push\b/i.test(label)) return "pushed";
  if (/\bgit\s+commit\b/i.test(label)) return "committed";
  if (/pay|charge|refund|transfer/i.test(label)) return "payment";
  if (/mail/i.test(label)) return "email";
  if (/send|message|reply/i.test(label)) return "message";
  if (/post|publish|tweet/i.test(label)) return "posted";
  return "other";
}

export type OutwardAction = { kind: OutwardKind; label: string };

/** The stored English line of a cut turn that acted outward: what it
 * already did (`more` actions not named), and that nothing is done twice. */
export function outwardSentence(actions: readonly OutwardAction[], more: number): string {
  const shown = actions.map((a) => `${OUTWARD_VERBS[a.kind]} (${a.label})`).join(", ");
  return `${INTERRUPTED_OUTWARD} ${shown}${more > 0 ? ` and ${more} more` : ""}${OUTWARD_CLOSE}`;
}

const OUTWARD_PIECE = new RegExp(
  `(${Object.values(OUTWARD_VERBS).join("|")}) \\((.*?)\\)(?=, (?:${Object.values(OUTWARD_VERBS).join("|")}) \\(| and \\d+ more$|$)`,
  "g",
);

/** The actions an outward line names, or null when `words` is not one. */
function parseOutward(words: string): { actions: OutwardAction[]; more: number } | null {
  if (!words.startsWith(`${INTERRUPTED_OUTWARD} `) || !words.endsWith(OUTWARD_CLOSE)) return null;
  let body = words.slice(INTERRUPTED_OUTWARD.length + 1, words.length - OUTWARD_CLOSE.length);
  let more = 0;
  const tail = / and (\d+) more$/.exec(body);
  if (tail) { more = Number(tail[1]); body = body.slice(0, tail.index); }
  const kinds = Object.fromEntries(Object.entries(OUTWARD_VERBS).map(([k, v]) => [v, k as OutwardKind]));
  const actions: OutwardAction[] = [];
  for (const m of body.matchAll(OUTWARD_PIECE)) actions.push({ kind: kinds[m[1]!]!, label: m[2]! });
  return actions.length && outwardSentence(actions, more) === words ? { actions, more } : null;
}

/** The detail of an outward line in a reader's language: each action's
 * words come from `say` (keys chat.restart.outward.<kind> with {label},
 * chat.restart.outward.more with {count}). */
export function outwardDetailIn(
  known: { actions: readonly OutwardAction[]; more: number },
  say: (key: string, vars: Record<string, string>) => string,
): string {
  const shown = known.actions.map((a) => say(`chat.restart.outward.${a.kind}`, { label: a.label })).join(", ");
  return known.more > 0 ? `${shown} ${say("chat.restart.outward.more", { count: String(known.more) })}` : shown;
}

export type RestartSentence =
  | { key: "restart.cut" }
  | { key: "restart.outward"; actions: OutwardAction[]; more: number }
  | { key: "restart.cutTwice" }
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
  if (words === CUT_TWICE) return { key: "restart.cutTwice" };
  const outward = parseOutward(words);
  if (outward) return { key: "restart.outward", ...outward };
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
  "restart.outward": "interrompu par un redémarrage de Sagax après avoir déjà {detail} ; pas repris, pour que rien ne soit fait deux fois.",
  "restart.cutTwice": "interrompu par un autre redémarrage de Sagax après une première reprise ; pas repris de nouveau. Certaines de ses étapes ont peut-être déjà pris effet.",
  "restart.notResumed": "tour interrompu : Sagax a redémarré et ce tour n'a pas repris. Renvoie ta demande",
  "restart.notResumedNewer": "tour interrompu : Sagax a redémarré et une demande plus récente a pris la conversation, alors le tour coupé n'a pas repris. Renvoie-le s'il faut encore",
  "restart.turnNote": "Sagax a redémarré pendant ce tour ; il reprend quand Sagax revient",
  "restart.runNote": "Sagax a redémarré pendant cette exécution ; elle reprend quand Sagax revient",
  "parallel.notStarted": "elle n'a pas pu démarrer",
  "answer.notDelivered": "impossible de livrer cette réponse : la demande n'est plus ouverte, alors l'action n'a pas été faite",
};

const FRENCH_OUTWARD: Record<string, string> = {
  "chat.restart.outward.pushed": "poussé ({label})",
  "chat.restart.outward.committed": "fait un commit ({label})",
  "chat.restart.outward.payment": "fait un paiement ({label})",
  "chat.restart.outward.email": "envoyé un courriel ({label})",
  "chat.restart.outward.message": "envoyé un message ({label})",
  "chat.restart.outward.posted": "publié ({label})",
  "chat.restart.outward.other": "fait une action vers l'extérieur ({label})",
  "chat.restart.outward.more": "et {count} de plus",
};

const fill = (words: string, vars: Record<string, string>): string =>
  words.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);

/** `text` in the person's language when it is a restart line and that
 * language is French; any other words stay as they are. */
export function restartSentenceIn(language: string | undefined, text: string): string {
  if (!language?.toLowerCase().startsWith("fr")) return text;
  const known = restartSentenceKey(text);
  if (!known) return text;
  if (known.key === "restart.outward") {
    return FRENCH[known.key].replace("{detail}", outwardDetailIn(known, (key, vars) => fill(FRENCH_OUTWARD[key] ?? key, vars)));
  }
  return known.key === "restart.resumeFailed" && known.detail ? `${FRENCH[known.key]} : ${known.detail}` : FRENCH[known.key];
}
