/** How a settling ACP turn ends once its last text is out. */
import { errorReplyFailure, type ErrorReplyFailure } from "../engine-errors.ts";
import type { AcpTurn } from "./types.ts";

export interface AcpTurnEnd {
  ok: boolean;
  stopReason: string | null;
  error?: Omit<ErrorReplyFailure, "stopReason">;
}

/** How a settling turn ends, once its last text is out. A Stop the agent answers with end_turn (OpenCode does) is the
 * person's stop. A reply that is only a provider's error body fails the turn in plain words. Otherwise `end_turn` with
 * nothing to show is a lost turn: a provider may cut a reasoning-only stream and still answer end_turn. */
export function endTurn(current: AcpTurn, ok: boolean, stopReason: string | null, ai: string, emptyMessage: string): AcpTurnEnd {
  const ended = ok && stopReason === null;
  const errorReply = ended && !current.state.stopped && !current.state.repliedText ? errorReplyFailure(ai, current.state.text) : null;
  if (!errorReply) current.flushAssistantText();
  if (ended && current.state.stopped) return { ok, stopReason: "cancelled" };
  if (errorReply) {
    const { stopReason: failed, ...error } = errorReply;
    return { ok: false, stopReason: failed, error };
  }
  if (ended && !current.state.producedItem) return { ok: false, stopReason: "empty_turn", error: { message: emptyMessage } };
  return { ok, stopReason };
}
