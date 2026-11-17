// Whose team memory a bot reads and writes (#4460).
//
// A solo install (one person) keeps one memory per section of its sidebar:
// the section's storage key (section-context.ts), unchanged.
//
// On a server several people use (an organization server, or a workspace
// with members) a section is one person's sidebar group and
// never an audience: two people may both have no section, or a section of
// the same name, and share nothing. The memory a bot reads there is its owner's own
// (`person:<principal id>`), whatever section the bot sits in, so a person's
// own bots share it and no other person's bot reads it (someone the person
// lets use one of their bots reads it there, in that conversation). Memory shared with a
// team is the organization console's (its team tiers, chosen explicitly
// there); this server keeps none of it between people.

export const PERSON_MEMORY_PREFIX = "person:";
/** Entries whose author could not be named when they left a shared key. No
 * bot's prompt reads this key; the server's admins list and manage it on
 * their memory page (they were the whole server's). */
export const UNCLAIMED_MEMORY_KEY = "unclaimed:";
/** A caller with no principal at all (never expected): its own empty key. */
export const NO_OWNER_MEMORY_KEY = "nobody:";

export function personMemoryKey(principalId: string): string {
  return `${PERSON_MEMORY_PREFIX}${principalId.trim().toLowerCase()}`;
}

export function isPersonMemoryKey(key: string): boolean {
  return key.startsWith(PERSON_MEMORY_PREFIX) && key.length > PERSON_MEMORY_PREFIX.length;
}

export interface TeamMemoryScopeInput {
  /** An organization server (teamMemoryPersonScoped in server/index.ts). */
  personScoped: boolean;
  /** The bot's owner, or the signed-in person (a principal id). */
  owner: string;
  /** The section's storage key and label (teamStorageForBot / teamStorageKeyFor). */
  section: () => { key: string; label: string };
  /** The owner's display name, organization team names and whether a
   * console keeps team memory, for the prompt. */
  person?: () => { name: string; teams: readonly string[]; console?: boolean };
}

export interface TeamMemoryScope {
  key: string;
  label: string;
  /** Set when the key is a person's own memory. */
  person?: { name: string; teams: readonly string[]; console?: boolean };
}

/** The one rule every reader and writer of team memory follows. */
export function teamMemoryScope(input: TeamMemoryScopeInput): TeamMemoryScope {
  if (!input.personScoped) return input.section();
  const owner = input.owner.trim();
  // no owner to name: a key of its own, never a shared one
  if (!owner) return { key: NO_OWNER_MEMORY_KEY, label: "Nobody" };
  const person = input.person?.() ?? { name: owner, teams: [] };
  return { key: personMemoryKey(owner), label: person.name, person };
}

/** What the bot, its tool and the person are told about team memory: one
 * source per wording, by mode (#4460). On a server several people use, an
 * entry goes to the bot owner's own memory, read by that person's bots only;
 * a team's shared memory lives in an organization console, never here. */
export interface TeamMemoryWording {
  /** The instruction appended after the memory block (system prompt). */
  prompt: string;
  /** propose_team_memory's description. */
  toolDescription: string;
  /** The card's and its notification's title. */
  cardTitle: string;
  /** What Always allow keeps on that card. */
  ruleDescription: (kind: string) => string;
  /** Why a restricted conversation cannot propose an entry. */
  restrictedRefusal: string;
  /** Where the tool's result says the entry goes, after its name. */
  resultTarget: string;
}

const LEARN = "When you learn who someone is, where something lives, what was decided, or what a term or nickname means, propose it with propose_team_memory.";
const KINDS = "who a person is (person), where something lives (place), what was decided (decision), or what a name means (term)";
const UNTIL = "End the turn and do not claim it is remembered before confirmation; accepted facts stay unchanged until then.";

const SECTION_WORDING: TeamMemoryWording = {
  prompt: ` ${LEARN} Every addition or replacement waits for a member of this team, or an organization admin, to confirm a card before it enters shared prompts; do not claim it is remembered before then.`,
  toolDescription: `Propose something every bot on the team should know: ${KINDS}. Every addition or replacement waits for a member of this team, or an organization admin, to confirm its card before entering shared prompts. ${UNTIL}`,
  cardTitle: "Remember this for the team?",
  ruleDescription: (kind) => `Remember ${kind} entries for the team`,
  restrictedRefusal: "restricted conversations cannot publish section-wide memory; ask an admin to add it",
  resultTarget: "for the team",
};

const OWN = "the own memory of the person this bot belongs to: only that person's bots read it (and whoever they let use one of those bots, in that conversation), no other person's bot does. Memory shared with a team is kept only in an organization console, never here.";

const PERSON_WORDING: TeamMemoryWording = {
  prompt: ` ${LEARN} It goes to ${OWN} Every addition or replacement waits for a confirmation on its card in this conversation; do not claim it is remembered before then.`,
  toolDescription: `Propose something to keep in ${OWN} What to keep: ${KINDS}. Every addition or replacement waits for a confirmation on its card in this conversation. ${UNTIL}`,
  cardTitle: "Remember this in the bot owner's own memory?",
  ruleDescription: (kind) => `Remember ${kind} entries in the bot owner's own memory`,
  restrictedRefusal: "restricted conversations cannot add to the bot owner's own memory: every bot of that person reads it",
  resultTarget: "in the bot owner's own memory",
};

export function teamMemoryWording(personScoped: boolean): TeamMemoryWording {
  return personScoped ? PERSON_WORDING : SECTION_WORDING;
}
