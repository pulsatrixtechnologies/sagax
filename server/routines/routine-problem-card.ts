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
 * - Still open after a day: one reminder, the needs-you of the card itself
 *   (the reminder step of a parked question, INPUT_REMIND_REPEAT_MS),
 *   marked on the card so a restart never rings it again.
 *
 * RoutineNeedsWatch calls `sync` on every pass with every routine; the
 * server's sweep calls `remindDue`. */
import type { ApprovalWords } from "../../shared/approval-describe.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import { INPUT_REMIND_REPEAT_MS } from "../runtime/types.ts";

export const ROUTINE_PROBLEM_KEY_PREFIX = "routine-problem:";

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

export interface RoutineProblemCardsDeps<R extends { id: string; name: string }> {
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
  /** Ring the card's own needs-you again and mark it reminded. */
  remind(routine: R, card: PendingProblemCard): void;
  now(): number;
}

interface Shown<R> {
  routine: R;
  /** The problem it was raised for (kind and since), "" for none. */
  episode: string;
  question: string;
}

export class RoutineProblemCards<R extends { id: string; name: string }> {
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
    if (!this.deps.pending(routine, key)) {
      // the person answered this streak's card: it is told, never raised
      // again; after a restart the card in storage says so
      if (last?.episode === episode) return;
      const told = this.deps.latest(routine, key);
      if (told && told.at >= need.since) return;
    }
    this.deps.ask(routine, input);
  }

  /** The cards still open a day after they were raised: one reminder each. */
  remindDue(routines: readonly R[]): void {
    const now = this.deps.now();
    for (const routine of routines) {
      const found = this.deps.pending(routine, routineProblemKey(routine.id));
      if (!found || found.message.card?.remindedAt) continue;
      if (now - found.message.at < INPUT_REMIND_REPEAT_MS) continue;
      this.deps.remind(routine, found);
    }
  }

  private retire(routine: R): void {
    const key = routineProblemKey(routine.id);
    if (this.deps.pending(routine, key)) this.deps.ask(routine, { tool: ASK_CHOICE_TOOL, key, retire: true });
  }
}
