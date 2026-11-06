// @ts-nocheck
/** orgDirectoryTeams (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgDirectoryTeams(getHost: () => Host): any {
function orgDirectoryTeams(): { id: string; name: string; managers: string[]; members: string[] }[] {
  const host = getHost();

  const byId = new Map<string, { id: string; name: string; managers: string[]; members: string[] }>();
  for (const team of host.orgTeams.list()) byId.set(team.id, { id: team.id, name: team.name, managers: [], members: [] });
  for (const person of host.principals.list()) {
    if (person.disabledAt !== undefined) continue;
    for (const team of person.teams ?? []) {
      const entry = byId.get(team.id) ?? { id: team.id, name: team.id, managers: [], members: [] };
      (team.manager ? entry.managers : entry.members).push(person.id);
      byId.set(team.id, entry);
    }
  }
  return [...byId.values()].map((team) => ({ ...team, managers: team.managers.sort(), members: team.members.sort() }))
    .sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id.localeCompare(b.id));

}
  return orgDirectoryTeams;
}
