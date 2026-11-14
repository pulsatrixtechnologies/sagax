/** #4233 (Q2): a problem that lasts is told to the person as something to
 * fix, once. When a routine's need (routine-needs-person.ts, the one rule in
 * shared/outcomes.ts routineNeed) is a told problem streak or a pause after
 * failures, the server raises one keyed ask_choice card (#4205) in the
 * person's conversation with the routine's bot: key
 * `routine-problem:<routineId>`, the streak's summary and the failing
 * readiness line as its words, choices to run a check, pause the routine or
 * open it. It is the existing question card: it sits in the pinned zone and
 * in Today, rings once as a question when raised, and holds nothing.
 *
 * - While the problem lasts, a later run only replaces its words in place
 *   (the count moves); nothing rings again.
 * - The first good run (no problem need any more) retires it.
 * - The person answered it (or it was put away): nothing is raised again
 *   for the same streak, a restart included (the newest card under the key,
 *   in storage, was raised at or after the streak began).
 * - A restart finds the pending card by its key and replaces it in place.
 * - Still open after a day: told again, the needs-you of the card itself
 *   (the reminder step of a parked question, INPUT_REMIND_REPEAT_MS),
 *   marked on the card so a restart never rings it again. #4250 (S3): then
 *   weekly while it stays open (the fix ladder of
 *   server/proactive/escalation-ladder.ts), each step once.
 *
 * RoutineNeedsWatch calls `sync` on every pass with every routine; the
 * server's sweep calls `remindDue`.
 *
 * #4250 (S1): the told state is the signal ledger's (key
 * `routine-problem:<routineId>` in the person's store): raised is told, the
 * reminder is its step 1, a good run retires it. The card in storage is read
 * only for a streak a previous version told. */
import type { ApprovalWords } from "../../shared/approval-describe.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import type { SignalLedger } from "../proactive/signal-ledger.ts";
import { FIX_LADDER, dueStep, stepsToldBy } from "../proactive/escalation-ladder.ts";

export const ROUTINE_PROBLEM_KEY_PREFIX = "routine-problem:";
/** #4250: the ledger kind of a routine's fix card. */
export const ROUTINE_PROBLEM_KIND = "routine-problem";

/** The key of a routine's fix card. */
export function routineProblemKey(routineId: string): string {
  return `${ROUTINE_PROBLEM_KEY_PREFIX}${routineId}`;
}

/** The needs that ask the person to fix something. */
export function lastingProblem(need: RoutineNeedsPerson | null | undefined): RoutineNeedsPerson | null {
  return need && (need.kind === "problem" || need.kind === "paused") ? need : null;
}

export interface RoutineProblemFacts {
  /** What the streak's runs said (the streak card's words). */
  summary: string;
  /** The failing line of the last run's readiness check, if any. */
  readiness?: string;
  /** Runs with problems in a row (a pause: the failures that paused it). */
  count: number;
}

export interface RoutineProblemCardInput {
  tool: typeof ASK_CHOICE_TOOL;
  key: string;
  wait: false;
  decision: true;
  title: string;
  question: string;
  options: string[];
  details: string[];
}

/** The card's ask_choice input, in the person's words. A paused routine is
 * not offered a pause (an option that cannot apply is not shown). */
export function routineProblemCardInput(
  routine: { id: string; name: string },
  need: RoutineNeedsPerson,
  facts: RoutineProblemFacts,
  words: ApprovalWords,
): RoutineProblemCardInput {
  const name = routine.name.trim() || routine.id;
  const count = Math.max(1, facts.count);
  const lead = need.kind === "paused"
    ? words.t("routine.problemCard.paused", { routine: name, count })
    : count === 1
      ? words.t("routine.problemCard.problemOnce", { routine: name })
      : words.t("routine.problemCard.problem", { routine: name, count });
  const question = [lead, facts.summary.trim(), facts.readiness?.trim() ?? ""].filter(Boolean).join("\n\n");
  const choices: Array<[string, string]> = [
    [words.t("routine.problemCard.check"), words.t("routine.problemCard.checkDetail")],
    ...(need.kind === "paused" ? [] : [[words.t("routine.problemCard.pause"), words.t("routine.problemCard.pauseDetail")] as [string, string]]),
    [words.t("routine.problemCard.open"), words.t("routine.problemCard.openDetail")],
  ];
  return {
    tool: ASK_CHOICE_TOOL,
    key: routineProblemKey(routine.id),
    wait: false,
    decision: true,
    title: words.t("routine.problemCard.title", { routine: name }).slice(0, 120),
    question,
    options: choices.map(([label]) => label),
    details: choices.map(([, detail]) => detail),
  };
}

/** A pending keyed card as the store holds it. */
export interface PendingProblemCard {
  threadId: string;
  message: { id: string; at: number; card?: { remindedAt?: number } };
}

export interface RoutineProblemCardsDeps<R extends { id: string; name: string; botId?: string }> {
  /** The routine's need now, read without its cards and items (only a
   * problem or a pause counts here). */
  need(routine: R): RoutineNeedsPerson | null;
  facts(routine: R, need: RoutineNeedsPerson): RoutineProblemFacts;
  words(routine: R): ApprovalWords;
  /** ask_choice as the routine's bot, in its conversation with the person:
   * raises, replaces in place (same key) or retires (`retire` true). */
  ask(routine: R, input: RoutineProblemCardInput | { tool: typeof ASK_CHOICE_TOOL; key: string; retire: true }): void;
  /** The pending card raised with `key` in the bot's conversations with the
   * person, or null. */
  pending(routine: R, key: string): PendingProblemCard | null;
  /** When the newest card raised with `key` in the routine's conversation
   * was raised, in any state (answered, put away, expired), or null: read
   * from storage, so a streak already told stays told after a restart. */
  latest(routine: R, key: string): { at: number } | null;
  /** Ring the card's own needs-you again as ladder step `step` (1: the day
   * reminder, 2...: weekly) and mark it reminded. */
  remind(routine: R, card: PendingProblemCard, step: number): void;
  now(): number;
  /** #4250: the signal ledger, and whose store a routine's card is in. */
  signals?: SignalLedger;
  person?(routine: R): string;
}

interface Shown<R> {
  routine: R;
  /** The problem it was raised for (kind and since), "" for none. */
  episode: string;
  question: string;
}

export class RoutineProblemCards<R extends { id: string; name: string; botId?: string }> {
  private readonly shown = new Map<string, Shown<R>>();
  private readonly deps: RoutineProblemCardsDeps<R>;

  constructor(deps: RoutineProblemCardsDeps<R>) {
    this.deps = deps;
  }

  /** Every routine, once per pass of the needs watch: raise, replace or
   * retire each fix card; a routine gone retires its card. */
  syncAll(routines: readonly R[]): void {
    const seen = new Set<string>();
    for (const routine of routines) {
      seen.add(routine.id);
      this.sync(routine);
    }
    for (const [id, entry] of this.shown) {
      if (seen.has(id)) continue;
      this.shown.delete(id);
      if (entry.episode) this.retire(entry.routine);
    }
  }

  sync(routine: R): void {
    const key = routineProblemKey(routine.id);
    const last = this.shown.get(routine.id);
    const need = lastingProblem(this.deps.need(routine));
    if (!need) {
      this.shown.set(routine.id, { routine, episode: "", question: "" });
      // a card raised before (or before a restart) leaves at the first good run
      if (last?.episode || !last) this.retire(routine);
      return;
    }
    const episode = `${need.kind}:${need.since}`;
    const input = routineProblemCardInput(routine, need, this.deps.facts(routine, need), this.deps.words(routine));
    if (last && last.episode === episode && last.question === input.question) return;
    this.shown.set(routine.id, { routine, episode, question: input.question });
    const open = this.deps.pending(routine, key);
    if (!open) {
      // the person answered this streak's card: it is told, never raised
      // again; after a restart the ledger says so (a previous version's
      // streak: the card in storage)
      if (last?.episode === episode) return;
      // the later of the two: a card in storage newer than the ledger (a
      // rollback, then an upgrade) still counts
      const told = [this.signal(routine)?.toldAt, this.deps.latest(routine, key)?.at].filter((at): at is number => at !== undefined);
      if (told.length && Math.max(...told) >= need.since) return;
    }
    this.deps.ask(routine, input);
    const note = { key, kind: ROUTINE_PROBLEM_KIND, level: "card" as const, bot: routine.botId ?? "", label: input.title };
    if (open) this.deps.signals?.note(this.person(routine), note);
    else this.deps.signals?.told(this.person(routine), note);
  }

  /** #4250 (S3): the cards still open at a step of the fix ladder (a day
   * after they were raised, then weekly): one ring per step. The steps told
   * are the ledger's, or those the card's own mark (a previous version's,
   * one reminder at most) covers, whichever is more. */
  remindDue(routines: readonly R[]): void {
    const now = this.deps.now();
    for (const routine of routines) {
      const found = this.deps.pending(routine, routineProblemKey(routine.id));
      if (!found) continue;
      const marked = found.message.card?.remindedAt;
      const told = Math.max(this.signal(routine)?.reminded ?? 0, marked !== undefined ? stepsToldBy(FIX_LADDER, found.message.at, marked) : 0);
      const step = dueStep(FIX_LADDER, found.message.at, told, now);
      if (step === null) continue;
      this.deps.remind(routine, found, step);
    }
  }

  private retire(routine: R): void {
    const key = routineProblemKey(routine.id);
    if (this.deps.pending(routine, key)) this.deps.ask(routine, { tool: ASK_CHOICE_TOOL, key, retire: true });
    this.deps.signals?.settle(this.person(routine), routine.botId ?? "", key, "retired");
  }

  private signal(routine: R) {
    return this.deps.signals?.get(this.person(routine), routine.botId ?? "", routineProblemKey(routine.id));
  }

  private person(routine: R): string {
    return this.deps.person?.(routine) ?? "";
  }
}
