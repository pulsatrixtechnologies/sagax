// Who a team-memory card reaches besides its bot's owner.
//
// Two memories, kept apart:
// - personal memory: one person's own (a write to their own tier, confirmed
//   on a "Save to your personal memory?" card in their conversation). It is
//   never a team-memory card and never reaches anyone else.
// - team memory: a section's shared people, places, decisions and terms. A
//   bot proposes an entry on a "Remember this for the team?" card that the
//   members of its section may confirm.
//
// Each bot chooses how far its team-memory cards travel (`teamMemorySharing`):
// - "shared" (the default, and every bot that never set it): every member of
//   the card's section gets the card;
// - "private": only the members who already see this bot and the card's
//   conversation or channel.
//
// Only "private" is ever stored; absent is the default ("shared"). A value
// that is present but unknown (a hand edit, a future option read by an older
// server) fails closed and reads as "private": a privacy control never widens
// by accident.

export type TeamMemorySharing = "shared" | "private";

export const TEAM_MEMORY_SHARING_VALUES: readonly TeamMemorySharing[] = ["shared", "private"];

/** A bot's setting: absent (or exactly "shared") reads as "shared"; any
 * other present value, "private" included, reads as "private". */
export function teamMemorySharingOf(bot: { teamMemorySharing?: unknown } | null | undefined): TeamMemorySharing {
  const value = bot?.teamMemorySharing;
  return value === undefined || value === "shared" ? "shared" : "private";
}

/** The stored form of a bot's setting: "private" or nothing (the default).
 * Export, import and duplication write this, so a corrupted value can never
 * break them and never widens who gets the cards. */
export function storedTeamMemorySharing(bot: { teamMemorySharing?: unknown } | null | undefined): "private" | undefined {
  return teamMemorySharingOf(bot) === "private" ? "private" : undefined;
}

export function isTeamMemorySharing(value: unknown): value is TeamMemorySharing {
  return value === "shared" || value === "private";
}

export interface TeamMemoryCardDelivery {
  card: { teamMemoryRequest?: { section?: unknown }; confidentialMemoryRequest?: unknown } | null | undefined;
  /** The proposing bot's setting. */
  sharing: TeamMemorySharing;
  /** Several people share team memory on this server. */
  sharedServer: boolean;
  /** A Cloud home: one person's. */
  cloudHome: boolean;
  /** The card's conversation is confidential. */
  confidential: boolean;
  /** The person can use a bot of this section now. */
  memberOfSection: (section: string) => boolean;
  /** The person sees this card's bot and its conversation or channel. */
  seesCardContext: () => boolean;
}

/** Whether a team-memory card reaches this person as a member of its
 * section. Never a personal memory card, never a confidential conversation. */
export function teamMemoryCardReachesMember(input: TeamMemoryCardDelivery): boolean {
  const card = input.card;
  if (!card || card.confidentialMemoryRequest) return false;
  const section = card.teamMemoryRequest?.section;
  if (typeof section !== "string") return false;
  if (input.cloudHome || !input.sharedServer || input.confidential) return false;
  if (!input.memberOfSection(section)) return false;
  return input.sharing === "shared" || input.seesCardContext();
}
