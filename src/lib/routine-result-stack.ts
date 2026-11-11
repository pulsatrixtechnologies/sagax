// #3581: a routine's result is a compact card while it is the newest thing a
// routine said, or while it needs the person; once something newer says the
// same kind of thing, it folds into its one row (AskSettledLine), so a bot
// with 17 routines reporting in one hour fits one screen. Read from the
// conversation's rows (a store selector), the way HandoffRow reads its result.
import type { Message } from "@/state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";

type Row = Pick<Message, "id" | "role" | "kind" | "text" | "routineRun" | "attention">;

const OPEN_GOAL = new Set<NonNullable<RoutineRunCardData["goalStatus"]>>(["needs-input", "blocked", "limit-reached", "paused", "failed"]);

/** A finished result: what the run had to say once it ended. */
export function isRoutineResult(run: RoutineRunCardData | undefined): boolean {
  return Boolean(run && (run.status === "completed" || run.status === "nothing_to_report") && (!run.goalStatus || run.goalStatus === "completed"));
}

/** The run's result needs the person: it completed with problems, it is
 * blocked, a team goal waits on them, or its items for them are still open. */
export function routineResultNeedsPerson(message: Pick<Message, "routineRun" | "attention">): boolean {
  const run = message.routineRun;
  if (!run) return false;
  if (run.status === "completed" && run.problems) return true;
  if (run.status === "blocked") return true;
  if (run.goalStatus && OPEN_GOAL.has(run.goalStatus)) return true;
  return Boolean(message.attention?.items.length && !message.attention.handledAt);
}

/** A row that breaks a stack of results: the person's message, or a bot's
 * own answer (a text bubble). Steps, receipts and other runs do not. */
function breaksStack(row: Row): boolean {
  if (row.role === "user") return true;
  if (row.role !== "bot") return false;
  if (row.kind && row.kind !== "text") return false;
  return typeof row.text === "string" && row.text.trim().length > 0;
}

/** Whether the result in `messageId` folds to its row:
 * - one that needed the person folds when nothing is open any more (a later
 *   run of the same routine works again, or its items were answered);
 * - any other folds when a newer result follows it with no message of the
 *   person and no answer of the bot between them. */
export function routineResultFolded(messages: readonly Row[], messageId: string): boolean {
  const at = messages.findIndex((row) => row.id === messageId);
  const self = messages[at];
  const run = self?.routineRun;
  if (!self || !run || !isRoutineResult(run) && run.status !== "blocked") return false;
  if (routineResultNeedsPerson(self)) {
    if (self.attention?.items.length && !self.attention.handledAt) return false;
    const problem = (run.status === "completed" && Boolean(run.problems)) || run.status === "blocked";
    if (!problem) return true;
    // a lasting problem stays a card until a later run of its routine works again
    return messages.slice(at + 1).some((row) => {
      const later = row.routineRun;
      return Boolean(later && later.routineId === run.routineId && isRoutineResult(later) && !later.problems);
    });
  }
  for (const row of messages.slice(at + 1)) {
    if (row.kind === "routine.run" && isRoutineResult(row.routineRun)) return true;
    if (breaksStack(row)) return false;
  }
  return false;
}
