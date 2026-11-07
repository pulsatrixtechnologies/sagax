import { ASK_USER_QUESTION_TOOL, ASK_USER_TOOL, askQuestionSummary, parseAskQuestions, type AskQuestion } from "../../shared/ask-question.ts";
import { askInputSummary } from "../tools/tool-summary.ts";

export interface Ask {
  id: string;
  kind: "permission" | "question";
  tool: string;
  input: Record<string, unknown>;
  at: number;
}
export type AskBehavior = "allow" | "deny" | "answer";
export type AskResolutionSource = "user" | "timeout" | "system";

export const DENY_TIMEOUT_NOTE =
  "Sagax: nobody answered this permission request in time. Skip this action and finish what you can without it.";
export const QUESTION_TIMEOUT_NOTE = "Sagax: nobody answered in time. Use your best judgment and continue.";
export const DUPLICATE_ASK_ID_NOTE = "Sagax: duplicate ask id — skipping this request.";

/** The system-source reply for an ask that outlives the turn — used both to
 * drain in-flight `pending` asks on close() and to answer one that arrives
 * on an already-closed broker (see the `closed` branch below). */
export function systemEndedReply(kind: Ask["kind"]): { behavior: AskBehavior; message: string } {
  return kind === "question"
    ? { behavior: "answer", message: "Sagax: the turn is ending — wrap up." }
    : { behavior: "deny", message: "Sagax: the turn ended" };
}

/** The structured questions behind an ask, when it is one. Claude's own
 * AskUserQuestion carries them, and so does a multiSelect ask_user;
 * everything else answers null and keeps the plain summary/choices card. */
export function askQuestions(ask: Ask): AskQuestion[] | null {
  return ask.tool === ASK_USER_QUESTION_TOOL || ask.tool === ASK_USER_TOOL ? parseAskQuestions(ask.input) : null;
}

/** One human-readable line for an ask — what the card subtitle shows. */
export function askSummary(ask: Ask): string {
  const questions = askQuestions(ask);
  if (questions) return askQuestionSummary(questions);
  return askInputSummary(ask.input) ?? ask.tool ?? "tool";
}
