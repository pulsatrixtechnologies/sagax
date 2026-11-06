// @ts-nocheck
/** describeGrantTarget (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDescribeGrantTarget(getHost: () => Host): any {
function describeGrantTarget(target: string): { label: string; disabled?: boolean } {
  const host = getHost();

  if (target.startsWith("team:")) {
    const id = target.slice(5);
    return { label: host.orgTeams.name(id) || id };
  }
  const id = target.startsWith("user:") ? target.slice(5) : target;
  const person = host.principals.byId(id);
  if (!person) return { label: id, disabled: true };
  const listed = person.subject ? host.perspicaxDirectory?.directory()?.people.find((entry) => entry.sub === person.subject!.sub) : undefined;
  const disabled = person.disabledAt !== undefined || listed?.status === "disabled";
  return { label: listed?.name || person.name || listed?.login || person.login || id, ...(disabled ? { disabled: true } : {}) };

}
  return describeGrantTarget;
}
