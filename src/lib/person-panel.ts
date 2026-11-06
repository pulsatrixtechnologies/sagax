// What the person panel shows about someone in the organization: only the
// directory fields Perspicax exposes (name, login, email, avatar, role,
// teams), the groups the viewer shares with them, and the bots they own
// that the viewer already sees. Nothing from a private thread.
import type { OrgDirectory, OrgDirectoryPerson } from "@/lib/perspicax-org";

export type PanelPerson = OrgDirectory["people"][number];

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function findPanelPerson(directory: Pick<OrgDirectory, "people"> | null, personId: string): PanelPerson | null {
  const id = norm(personId);
  return directory?.people.find((person) => norm(person.principalId) === id) ?? null;
}

/** Team names, managers first marked, sorted by name. */
export function personTeams(person: Pick<PanelPerson, "teams"> | null, directory: Pick<OrgDirectory, "teams"> | null): { id: string; name: string; manager: boolean }[] {
  const teams = new Map((directory?.teams ?? []).map((team) => [team.id, team.name]));
  return (person?.teams ?? [])
    .map((team) => ({ id: team.id, name: teams.get(team.id) ?? "", manager: team.manager }))
    .filter((team) => team.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface GroupLike { id: string; name: string; humanIds?: string[]; dm?: boolean; peopleDm?: boolean }

/** The groups the viewer sees that this person is in (not the direct
 * conversation with them, not a bot-to-bot chat). */
export function sharedGroups<G extends GroupLike>(groups: readonly G[], personId: string): G[] {
  const id = norm(personId);
  return groups.filter((group) => !group.dm && !group.peopleDm && (group.humanIds ?? []).some((human) => norm(human) === id));
}

/** The direct conversation with this person, when there is one. */
export function personDmGroup<G extends GroupLike>(groups: readonly G[], personId: string): G | undefined {
  const id = norm(personId);
  return groups.find((group) => group.peopleDm && (group.humanIds ?? []).some((human) => norm(human) === id));
}

/** Their bots the viewer already sees (shared with the viewer), live ones only. */
export function personSharedBots<B extends { id: string; ownerUserId?: string; hidden?: boolean }>(bots: readonly B[], personId: string): B[] {
  const id = norm(personId);
  return bots.filter((bot) => !bot.hidden && norm(bot.ownerUserId) === id);
}

/** Whether the viewer may write to this person: an active person, not a
 * service account, not themselves. */
export function canMessagePerson(person: Pick<OrgDirectoryPerson, "principalId" | "disabled" | "service"> | null, viewerId: string): boolean {
  return Boolean(person && !person.disabled && !person.service && norm(person.principalId) !== norm(viewerId));
}
