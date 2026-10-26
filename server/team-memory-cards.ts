// The "Remember this for the team?" cards of one team-memory entry, once
// that entry is settled somewhere else.
//
// A proposed entry can be settled two ways: on its card (Remember / Skip) or
// on the section's team-memory page (Accept / Delete, an admin's). Either way
// every open card of that entry closes with the real outcome, and a click on
// a card that is already settled gets that outcome back (409), never a fresh
// "allowed".

import type { CardAnswerer } from "../shared/wire.ts";

export type TeamMemoryCardOutcome = "allowed-once" | "rejected" | "unavailable";

export interface SettledCard {
  answered?: string;
  dismissed?: boolean;
  expired?: boolean;
  answeredBy?: CardAnswerer;
}

/** The refusal's machine code: the client words it in the person's language. */
export const TEAM_MEMORY_SETTLED_CODE = "team_memory_settled";

/** Whether this card no longer takes an answer. */
export function teamMemoryCardSettled(card: SettledCard | null | undefined): boolean {
  return Boolean(card && (card.answered || card.dismissed || card.expired));
}

/** A person's name on a settled card, when it names one. */
function settledByName(card: SettledCard): string | undefined {
  const by = card.answeredBy;
  return by && by.kind === "session" && by.name.trim() ? by.name.trim().slice(0, 80) : undefined;
}

/** What a click on an already settled card answers: 409, with the outcome
 * the card already carries and who settled it when the card names them. */
export function teamMemoryLateAnswer(card: SettledCard): { status: 409; body: Record<string, unknown> } {
  const outcome: TeamMemoryCardOutcome = card.answered === "allow" ? "allowed-once"
    : card.answered === "deny" ? "rejected" : "unavailable";
  const who = settledByName(card);
  const by = who ? ` by ${who}` : " by someone else";
  const error = outcome === "allowed-once" ? `This team memory entry was already accepted${by}.`
    : outcome === "rejected" ? `This team memory entry was already declined or deleted${by}.`
      : "This team memory entry is no longer available.";
  return {
    status: 409,
    body: { error, code: TEAM_MEMORY_SETTLED_CODE, outcome, alreadySettled: true, ...(who ? { settledBy: who } : {}) },
  };
}
