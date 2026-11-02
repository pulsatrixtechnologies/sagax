import type { RuntimeEvent } from "../contracts.ts";

/** A turn whose engine events must show under a different turn id (saved-steps
 * fallback, or a quick-model retry when that module is wired). */
export interface RetriedTurn {
  /** The turn the conversation shows. */
  turnId?: string;
  /** The engine's new turn: its sendTurn's id, or else the first other turn id seen. */
  retryTurnId?: string;
}

/** The retry's event under the shown turn's id; "dropped" for the retry's own
 * turn.started; null for any other turn's event. */
export function retriedTurnEvent(turn: RetriedTurn, event: RuntimeEvent): RuntimeEvent | "dropped" | null {
  if (!turn.turnId || !event.turnId || event.turnId === turn.turnId) return null;
  turn.retryTurnId ??= event.turnId;
  if (event.turnId !== turn.retryTurnId) return null;
  if (event.type === "turn.started") return "dropped";
  return { ...event, turnId: turn.turnId } as RuntimeEvent;
}
