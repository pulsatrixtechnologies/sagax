// About me, per person (#3424, lot 3 of the proactive mode design #3408).
//
// About me is the free text every bot of a person receives with each turn
// (server/system-prompt.ts userProfileSystemPrompt), plus what that person's
// bots learned about them (server/profiles/profile-learned.ts).
//
// - The operator at this computer, and a personal server's one person: the
//   server's profile (config.json `profile.aboutMe`), as before.
// - Anyone else signed in on an organization server: their own text, kept in
//   their own settings (server/people/person-settings.ts), and their own
//   learned list. They write it themselves and their bots learn into it; no
//   administrator step.
//
// One person's About me is never read for another person's bot, and a fact
// one person's bot learns lands only in that person's profile.
import { personSettingsPrincipal } from "../people/person-settings.ts";
import { appendAboutMe, commitLearned, listLearnedFacts, planLearned, removeLearned, type LearnedFact } from "./profile-learned.ts";

/** Whose About me: `person` null is the server's profile (the operator's),
 * else a person's principal id. */
export interface AboutMeOwner {
  person: string | null;
}

export interface PersonAboutMeDeps {
  /** An organization server (people other than the operator sign in). */
  organization(): boolean;
  localPrincipalId(): string;
  /** The server's profile text and its save. */
  operator: { read(): string; save(text: string): void };
  /** A person's own text and its save. */
  people: { read(principalId: string): string; save(principalId: string, text: string): void };
}

export interface PersonAboutMe {
  /** The About me a bot owned by this principal speaks to; null for none. */
  ofBot(ownerPrincipalId: string): AboutMeOwner | null;
  /** The About me a viewer reads and writes in Settings; null for a session
   * with no person behind it. */
  ofViewer(viewer: { operator: boolean; principalId: string | null | undefined }): AboutMeOwner | null;
  read(owner: AboutMeOwner): string;
  save(owner: AboutMeOwner, text: string): void;
  /** What a bot learned about its person, appended to that person's About me
   * and listed in that person's learned list. Returns how many were added. */
  learn(owner: AboutMeOwner, from: { botId: string; botName: string }, texts: readonly string[], today: string): number;
  learned(owner: AboutMeOwner): LearnedFact[];
  removeLearned(owner: AboutMeOwner, id: string): { fact: LearnedFact; aboutMe: string } | null;
}

export function createPersonAboutMe(deps: PersonAboutMeDeps): PersonAboutMe {
  const OPERATOR: AboutMeOwner = { person: null };
  const personOf = (principalId: string | null | undefined): AboutMeOwner | null => {
    if (!deps.organization()) return null;
    const id = personSettingsPrincipal(principalId);
    if (!id) return null;
    return id === personSettingsPrincipal(deps.localPrincipalId()) ? OPERATOR : { person: id };
  };
  const read = (owner: AboutMeOwner): string => (owner.person === null ? deps.operator.read() : deps.people.read(owner.person));
  const save = (owner: AboutMeOwner, text: string): void => {
    if (owner.person === null) deps.operator.save(text);
    else deps.people.save(owner.person, text);
  };
  return {
    ofBot: (ownerPrincipalId) => (ownerPrincipalId === deps.localPrincipalId() ? OPERATOR : personOf(ownerPrincipalId)),
    ofViewer: (viewer) => (viewer.operator ? OPERATOR : personOf(viewer.principalId)),
    read,
    save,
    learn: (owner, from, texts, today) => {
      const current = read(owner);
      const facts = planLearned(from, texts, current, today, Date.now(), owner.person);
      const next = appendAboutMe(current, facts.map((fact) => fact.line));
      // a full About me takes nothing more; the person trims it first
      if (!facts.length || next === null) return 0;
      save(owner, next);
      commitLearned(facts, owner.person);
      return facts.length;
    },
    learned: (owner) => listLearnedFacts(owner.person),
    removeLearned: (owner, id) => removeLearned(id, read(owner), (text) => save(owner, text), owner.person),
  };
}
