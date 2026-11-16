/** #4438: the routine fix card's choices act at once (routine-problem-card.ts).
 *
 * Before, every choice reached the routine's bot as a model turn: "Open the
 * routine" made the bot work for a minute and write a text in the chat (about
 * another routine, once) while the card stayed pinned. Now the server does
 * what the choice says, with no model turn and no text in the chat:
 *
 * - Open the routine: the person's device opens the routine's page (its
 *   settings and its last runs) from the answer's `open`; a device that
 *   cannot (a released app, a call) is told where the page is;
 * - Run a check: the routine runs once now, as Run now does;
 * - Pause the routine: the routine is turned off, as its switch does;
 *
 * and the answered card says what happened in one line (`card.answerNote`).
 * Words of the person's own (the card's Other field) still reach the bot.
 *
 * An answer is never applied on stale facts: the problem is read again first.
 * A problem that is over (the routine worked since) changes nothing and the
 * card says so. */
import { ENGLISH_WORDS, type ApprovalWords } from "../../shared/approval-describe.ts";
import { ROUTINE_PROBLEM_KEY_PREFIX, serverCardRoutineId } from "../../shared/fix-card-keys.ts";

export type RoutineFixChoice = "check" | "pause" | "open";

const CHOICE_WORDS: ReadonlyArray<[RoutineFixChoice, string]> = [
  ["check", "routine.problemCard.check"],
  ["pause", "routine.problemCard.pause"],
  ["open", "routine.problemCard.open"],
];

const plain = (text: string): string => text.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

/** Which of the card's choices `answer` is, read in each of `words` (the
 * card's language, then English), or null for words of the person's own. */
export function routineFixChoice(answer: string, words: readonly ApprovalWords[]): RoutineFixChoice | null {
  const said = plain(answer);
  if (!said) return null;
  for (const catalog of words) {
    for (const [choice, key] of CHOICE_WORDS) if (plain(catalog.t(key)) === said) return choice;
  }
  return null;
}

/** What the device does after the answer: open the routine's page. */
export interface RoutineFixOpen {
  type: "open_routine";
  routineId: string;
  botId?: string;
}

export interface RoutineFixAnswer {
  /** The one line the answered card shows. */
  note: string;
  open?: RoutineFixOpen;
}

export type RoutineFixStep = { ok: true; note?: string } | { ok: false; error: string };

export interface RoutineFixAnswerDeps<R extends { id: string; name?: string; botId?: string }> {
  routine(id: string): R | undefined;
  /** The answering device opens the answer's `open` (a released app or a
   * call does not: the card then says where the page is). */
  opens?: boolean;
  /** The card's language. */
  words(routine: R): ApprovalWords;
  /** The routine's problem still stands, read now (its need is a told
   * problem streak or a pause after failures). */
  stillWrong(routine: R): boolean;
  /** Run the routine once now as the person who answered; `running` when a
   * run of it is already going. */
  runNow(routine: R): RoutineFixStep | { ok: false; running: true };
  /** Turn the routine off as the person who answered. */
  pause(routine: R): RoutineFixStep;
}

/** The fix card's answer applied at once, or null when it is not the fix
 * card's own choice (the bot reads it, as before). */
export function answerRoutineFix<R extends { id: string; name?: string; botId?: string }>(
  key: string,
  answer: string,
  deps: RoutineFixAnswerDeps<R>,
): RoutineFixAnswer | null {
  if (!key.startsWith(ROUTINE_PROBLEM_KEY_PREFIX)) return null;
  const routineId = serverCardRoutineId(key);
  const routine = routineId ? deps.routine(routineId) : undefined;
  const words = routine ? deps.words(routine) : ENGLISH_WORDS;
  const choice = routineFixChoice(answer, words === ENGLISH_WORDS ? [words] : [words, ENGLISH_WORDS]);
  if (!choice) return null;
  if (!routine) return { note: words.t("routine.problemCard.gone") };
  if (choice === "open") {
    if (!deps.opens) return { note: words.t("routine.problemCard.openWhere", { routine: routine.name ?? "" }) };
    return { note: words.t("routine.problemCard.opened"), open: { type: "open_routine", routineId: routine.id, ...(routine.botId ? { botId: routine.botId } : {}) } };
  }
  // the facts may have changed since the card was raised: read them again
  if (!deps.stillWrong(routine)) return { note: words.t("routine.problemCard.alreadyFixed") };
  if (choice === "check") {
    const run = deps.runNow(routine);
    if (run.ok) return { note: run.note ?? words.t("routine.problemCard.checkStarted") };
    return { note: "running" in run ? words.t("routine.problemCard.checkRunning") : run.error };
  }
  const paused = deps.pause(routine);
  return { note: paused.ok ? paused.note ?? words.t("routine.problemCard.pausedNow") : paused.error };
}
