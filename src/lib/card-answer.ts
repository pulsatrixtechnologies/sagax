// How an option card's answer reaches the harness.
//
// Two kinds of card share one component. A PERMISSION card answers
// allow/deny — it is a decision about an action. A QUESTION answers with the
// chosen text; the broker accepts nothing else for one, and refuses an
// allow/deny outright (server/drivers/claude.ts). Getting that wrong is not
// a cosmetic bug: the refused answer resolves `unavailable`, the card closes
// as unreachable, and the bot then waits out its whole 15-minute timeout.
//
// So the kind comes from the CARD, never from the label the user pressed.
// The old rule read the text — `answer === "Allow" ? "allow" : …` — which
// works only as long as no question ever offers an option called "Allow".
// A question's options are written by the model, so that is a matter of
// luck, and the CLI's own AskUserQuestion makes questions common.
import { QUESTION_DISMISS_MESSAGE } from "../../shared/ask-question";

/** The only field that decides it: a permission card names its tool. */
interface CardKind {
  tool?: string;
}
export interface CardResponse {
  behavior: "allow" | "deny" | "answer";
  message?: string;
  dismiss?: boolean;
  /** #4438: this device opens the place a server card's answer names (the
   * routine fix card's Open the routine). */
  opens?: boolean;
}

/** The response for pressing one of a card's options. */
export function answerResponse(card: CardKind, answer: string): CardResponse {
  if (!card.tool) return { behavior: "answer", message: answer, opens: true };
  // A permission card's own options are Allow / Deny / Always allow; the
  // grant behind "always" is written separately, so anything that is not a
  // refusal lets this one action through.
  return { behavior: answer === "Deny" ? "deny" : "allow" };
}

/** The response for closing a card with its X. Unresolved questions carry an
 * explicit dismiss marker that the server rejects until an answer is chosen. */
export function dismissResponse(card: CardKind): CardResponse {
  if (card.tool) return { behavior: "deny", message: "Dismissed by user." };
  // Closing a question is an answer — "I am not choosing" — not a denial.
  return {
    behavior: "answer",
    message: QUESTION_DISMISS_MESSAGE,
    dismiss: true,
  };
}

/** #4438: the place a server card's answer opens on the device (the routine
 * fix card's Open the routine: its page), read from the respond route's
 * answer; null when it names none. */
export function cardAnswerOpen(response: unknown): { routineId: string; botId?: string } | null {
  const open = response && typeof response === "object" ? (response as { open?: unknown }).open : undefined;
  if (!open || typeof open !== "object") return null;
  const { type, routineId, botId } = open as { type?: unknown; routineId?: unknown; botId?: unknown };
  if (type !== "open_routine" || typeof routineId !== "string" || !routineId) return null;
  return { routineId, ...(typeof botId === "string" && botId ? { botId } : {}) };
}
