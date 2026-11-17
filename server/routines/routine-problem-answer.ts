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
 * - Run a check: the routine runs once now, as Run now does, in its own
 *   conversation; when that run ends (or the one already going), the card's
 *   line says what it did: worked (the problem is cleared), the same problem
 *   again, or stopped before the end (RoutineCheckFollowUps, #4579);
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
import { answerWithNote, answerWithoutNote } from "../../shared/options-card.ts";

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
  /** #4579: Run a check: the run whose end the card's line then tells. */
  checkRunId?: string;
}

export type RoutineFixStep = { ok: true; note?: string } | { ok: false; error: string };
/** Run now's step: the run started (`runId`), or the one already going. */
export type RoutineRunStep = { ok: true; note?: string; runId?: string } | { ok: false; error: string } | { ok: false; running: true; runId?: string };

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
  runNow(routine: R): RoutineRunStep;
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
    if (run.ok) return { note: run.note ?? words.t("routine.problemCard.checkStarted"), ...(run.runId ? { checkRunId: run.runId } : {}) };
    if ("running" in run) return { note: words.t("routine.problemCard.checkRunning"), ...(run.runId ? { checkRunId: run.runId } : {}) };
    return { note: run.error };
  }
  const paused = deps.pause(routine);
  return { note: paused.ok ? paused.note ?? words.t("routine.problemCard.pausedNow") : paused.error };
}

/** #4579: where a check's answered card is. */
export interface RoutineCheckCard {
  routineId: string;
  threadId: string;
  messageId: string;
}

const RUN_GOING = new Set(["queued", "running", "waiting"]);
/** A run that ended without doing the routine's work. */
const RUN_STOPPED = new Set(["cancelled", "missed"]);
/** Checks followed at once; the oldest goes first (a check left behind). */
const FOLLOWED_MAX = 200;

export interface RoutineCheckFollowUpDeps {
  /** The card's language, for its routine. */
  words(routineId: string): ApprovalWords;
  /** The routine's problem still stands, read when the run ended. */
  stillWrong(routineId: string): boolean;
  /** Write the card's new line. */
  tell(card: RoutineCheckCard, note: string): void;
}

/** #4579: Run a check's follow-up: the run the answer started (or the one
 * already going) is followed, and when it ends the answered card's line says
 * what it did: the routine worked (the problem is cleared), the same problem
 * came back, or the run stopped before the end. Told once per run. Kept in
 * memory: a restart while the check runs leaves the card's first line. */
export class RoutineCheckFollowUps {
  private readonly followed = new Map<string, RoutineCheckCard>();
  private readonly deps: RoutineCheckFollowUpDeps;

  constructor(deps: RoutineCheckFollowUpDeps) {
    this.deps = deps;
  }

  remember(runId: string, card: RoutineCheckCard): void {
    this.followed.delete(runId);
    this.followed.set(runId, card);
    if (this.followed.size > FOLLOWED_MAX) this.followed.delete(this.followed.keys().next().value!);
  }

  /** A run changed (RoutineManager onRunChanged). */
  runChanged(run: { id: string; routineId?: string | null; status: string }): void {
    const card = this.followed.get(run.id);
    if (!card || RUN_GOING.has(run.status)) return;
    this.followed.delete(run.id);
    const words = this.deps.words(card.routineId);
    const key = RUN_STOPPED.has(run.status)
      ? "routine.problemCard.checkStopped"
      : this.deps.stillWrong(card.routineId) ? "routine.problemCard.checkStill" : "routine.problemCard.checkClean";
    this.deps.tell(card, words.t(key));
  }
}

/** #4579: the answered card with the check's new line: its note, and the
 * line after its words when the first one was written there too (an app
 * that reads only the words). */
export function cardWithCheckNote<C extends { answeredText?: string; answerNote?: string }>(card: C, note: string): C {
  if (card.answeredText === undefined) return { ...card, answerNote: note };
  const words = answerWithoutNote(card.answeredText, card.answerNote);
  return { ...card, answerNote: note, answeredText: words !== card.answeredText ? answerWithNote(words, note) : words };
}

