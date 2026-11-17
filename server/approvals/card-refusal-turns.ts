// #4490: a bot's badly made card is refused once per turn, never twice. The
// first refusal tells the bot how to ask again; if the next card of the
// same turn breaks a rule again, it is shown as asked rather than refused a
// second time, so a turn never loops on refusals and the person always gets
// a card. Shared by the bot's ask_choice call (server/routes/internal-memory.ts)
// and the engines' own question tools (request-opened-present.ts).
import { ASK_CHOICE_TOOL, askChoiceRefusal } from "../../shared/options-card.ts";

/** Turns kept; the oldest go first. A turn lives minutes, never this many. */
const KEPT = 2_000;

export class CardRefusalTurns {
  private readonly refused = new Set<string>();

  /** true the first time this turn refuses a card, false after. */
  refuse(turnKey: string): boolean {
    if (this.refused.has(turnKey)) return false;
    this.refused.add(turnKey);
    if (this.refused.size > KEPT) this.refused.delete(this.refused.values().next().value!);
    return true;
  }
}

/** The one tracker of the server. */
export const cardRefusalTurns = new CardRefusalTurns();

/** The refusal a bot's own card call gets, or null to draw it as asked. */
export function botCardRefusal(body: unknown, turnKey: string, turns: CardRefusalTurns = cardRefusalTurns): string | null {
  if (!body || typeof body !== "object" || (body as { tool?: unknown }).tool !== ASK_CHOICE_TOOL) return null;
  const refusal = askChoiceRefusal(body);
  return refusal && turns.refuse(turnKey) ? refusal : null;
}
