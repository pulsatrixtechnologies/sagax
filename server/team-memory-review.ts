// Who may confirm a section's shared team memory.
//
// A bot proposes an entry for the section it sits in. On a shared workspace
// the people who can use a bot in that section confirm it, and so does an
// organization admin. Anyone else is refused. A solo workspace keeps the older
// rule: only the owner's session (admin scope) confirms; a client-only paired
// device may chat but not write shared memory.

export const TEAM_MEMORY_REVIEW_REFUSAL =
  "Only a member of this team, or an organization admin, can review its shared memory.";

export const TEAM_MEMORY_SOLO_REFUSAL =
  "Only the owner of this installation can review shared team memory.";

export interface TeamMemoryReview {
  /** Organization admin scope, or the operator at this computer. */
  admin: boolean;
  /** More than one person uses this workspace. */
  shared: boolean;
  /** The caller can use a bot whose current section is this entry's. */
  memberOfSection: boolean;
}

/** Null when this caller may review the entry. The refusal is the whole decision. */
export function teamMemoryReviewRefusal(input: TeamMemoryReview): string | null {
  if (input.admin) return null;
  if (!input.shared) return TEAM_MEMORY_SOLO_REFUSAL;
  return input.memberOfSection ? null : TEAM_MEMORY_REVIEW_REFUSAL;
}
