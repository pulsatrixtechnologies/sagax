// @ts-nocheck
/** questionAnsweredBy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createQuestionAnsweredBy(getHost: () => Host): any {
function questionAnsweredBy(by: { kind: string; via?: string; name?: string; person?: string } | undefined, person: string) {
  const host = getHost();

  if (!by) return true;
  if (by.kind === "worker" || by.via === "primary-bot" || by.via === "auto-review") return false;
  if (by.kind !== "session") return by.kind === "loopback";
  if (by.person !== undefined) return by.person === person;
  if (host.IDENTITY.kind !== "perspicax") return true;
  const known = host.principals.byId(person);
  const names = [known?.name?.trim(), known?.login?.trim()].filter(Boolean);
  return names.length === 0 || names.includes(by.name?.trim());

}
  return questionAnsweredBy;
}
