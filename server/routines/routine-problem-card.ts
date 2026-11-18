/** Investigate a failure streak once. The bot authors its own question. */
import { redactSecretsInText } from "../redact.ts";
import type { ApprovalWords } from "../../shared/approval-describe.ts";
import { ROUTINE_PROBLEM_KEY_PREFIX } from "../../shared/fix-card-keys.ts";
import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import type { SignalLedger } from "../proactive/signal-ledger.ts";
import { FIX_LADDER, dueStep, stepsToldBy } from "../proactive/escalation-ladder.ts";

/** shared/fix-card-keys.ts: the one list of the server's card keys. */
export { ROUTINE_PROBLEM_KEY_PREFIX };
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
  details: (string | undefined)[];
  /** #4438: the raw words a plain sentence replaced (a tool's own error and
   * its code), kept on the card under Details (`card.technicalDetails`). */
  technical?: string;
}

/** #4438: tool errors that mean nothing to the person, each with the plain
 * sentence the card says instead. A saved result (a connector's result
 * handle) that is unknown or expired can never come back: the routine could
 * not read it. */
const PLAIN_PROBLEMS: ReadonlyArray<{ raw: RegExp; key: string }> = [
  { raw: /\bhandle\s+\S+\s+is\s+(?:unknown|expired)\b|\bhandle_(?:unknown|expired)\b/i, key: "routine.problemCard.savedResultGone" },
];

/** A raw code a tool puts in parentheses at the end of its error
 * (`(handle_unknown)`, `(not_found)`): never shown to the person. */
const TRAILING_CODE = /\s*\((?:[a-z][a-z0-9]*_)+[a-z0-9]+\)\s*$/;

/** #4438: the problem in the person's words. A line that is a known tool
 * error becomes its plain sentence, a trailing raw code is dropped, and the
 * raw words are returned once, for the card's Details. */
export function plainProblemText(summary: string, words: ApprovalWords): { text: string; raw?: string } {
  let changed = false;
  const lines: string[] = [];
  for (const line of summary.split("\n")) {
    const known = PLAIN_PROBLEMS.find((entry) => entry.raw.test(line));
    const plain = known ? words.t(known.key) : line.replace(TRAILING_CODE, "");
    if (plain !== line) changed = true;
    // the same plain sentence twice (two failed reads of the same kind) is said once
    if (!(known && lines.includes(plain))) lines.push(plain);
  }
  return changed ? { text: lines.join("\n"), raw: summary.trim() } : { text: summary };
}

/** The card's ask_choice input, in the person's words. A paused routine is
 * not offered a pause (an option that cannot apply is not shown). */
export function routineProblemCardInput(
  routine: { id: string; name: string },
  need: RoutineNeedsPerson,
  facts: RoutineProblemFacts,
  words: ApprovalWords,
): RoutineProblemCardInput {
  const name = routine.name.trim();
  const lead = words.t("routine.investigation.unavailable", { routine: name });
  const summary = plainProblemText(facts.summary.trim(), words);
  const readiness = plainProblemText(facts.readiness?.trim() ?? "", words);
  const technical = [summary.raw, readiness.raw].filter(Boolean).join("\n\n");
  const question = [summary.text.trim(), readiness.text.trim()].filter(Boolean).join("\n\n") || lead;
  const choices = [words.t("routine.investigation.retry"), ...(need.kind === "paused" ? [words.t("routine.problemCard.open")] : [words.t("routine.problemCard.pause")])];
  return {
    tool: ASK_CHOICE_TOOL,
    key: routineProblemKey(routine.id),
    wait: false,
    decision: true,
    title: lead.slice(0, 120),
    question,
    options: choices,
    details: [],
    ...(technical ? { technical } : {}),
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
  investigate(routine: R, need: RoutineNeedsPerson, ask: (card: Pick<RoutineProblemCardInput, "title" | "question" | "options" | "details">) => string | undefined, unavailable: (reason: string) => void): void;
  words(routine: R): ApprovalWords;
  /** ask_choice as the routine's bot, in its conversation with the person:
   * raises, replaces in place (same key) or retires (`retire` true). */
  ask(routine: R, input: RoutineProblemCardInput | { tool: typeof ASK_CHOICE_TOOL; key: string; retire: true; reason?: string }, options?: { quiet?: boolean }): string | void;
  /** Whether the run the need names already rang its own failure (the
   * routine-failed notification of that run): the card it raises then
   * shows without a second ring for the same run. */
  runFailureTold?(routine: R, need: RoutineNeedsPerson): boolean;
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
      if (entry.episode) this.retire(entry.routine, "routine.problemCard.gone");
    }
  }

  sync(routine: R, retry = false): void {
    const key = routineProblemKey(routine.id);
    const last = this.shown.get(routine.id);
    const need = lastingProblem(this.deps.need(routine));
    if (!need) {
      this.shown.set(routine.id, { routine, episode: "", question: "" });
      // a card raised before (or before a restart) leaves at the first good run
      if (last?.episode || !last) this.retire(routine, "routine.problemCard.alreadyFixed");
      return;
    }
    const episode = String(need.since);
    if (!retry && last?.episode === episode) return;
    const entry: Shown<R> = { routine, episode, question: "" };
    this.shown.set(routine.id, entry);
    const told = Math.max(this.signal(routine)?.toldAt ?? 0, this.deps.latest(routine, key)?.at ?? 0);
    if (!retry && told >= need.since) return;
    const current = () => this.shown.get(routine.id) === entry && this.deps.need(routine)?.since === need.since;
    const publish = (card: Pick<RoutineProblemCardInput, "title" | "question" | "options" | "details" | "technical">) => {
      if (entry.question || !current()) return;
      const input: RoutineProblemCardInput = { ...card, key, tool: ASK_CHOICE_TOOL, wait: false, decision: true };
      const quiet = this.deps.runFailureTold?.(routine, need) === true;
      const messageId = this.deps.ask(routine, input, quiet ? { quiet } : undefined);
      if (!messageId) return;
      entry.question = input.question;
      this.deps.signals?.told(this.person(routine), { key, kind: ROUTINE_PROBLEM_KIND, level: "card", bot: routine.botId ?? "", label: input.title });
      return messageId;
    };
    const unavailable = (reason: string) => {
      if (!current()) return;
      const facts = this.deps.facts(routine, need);
      const fallback = routineProblemCardInput(routine, need, { ...facts, summary: [reason, facts.summary].filter(Boolean).join("\n") }, this.deps.words(routine));
      publish(fallback);
    };
    try {
      this.deps.investigate(routine, need, publish, unavailable);
    } catch (error) {
      unavailable(redactSecretsInText(error instanceof Error ? error.message : String(error)).slice(0, 400));
    }
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

  /** #4438: the card closes saying why (`why`: its line, "the routine
   * worked since"), never "Expired, no answer". */
  private retire(routine: R, why: string): void {
    const key = routineProblemKey(routine.id);
    if (this.deps.pending(routine, key)) this.deps.ask(routine, { tool: ASK_CHOICE_TOOL, key, retire: true, reason: this.deps.words(routine).t(why) });
    this.deps.signals?.settle(this.person(routine), routine.botId ?? "", key, "retired");
  }

  private signal(routine: R) {
    return this.deps.signals?.get(this.person(routine), routine.botId ?? "", routineProblemKey(routine.id));
  }

  private person(routine: R): string {
    return this.deps.person?.(routine) ?? "";
  }
}
