// @ts-nocheck
/** sessionPersonFields (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSessionPersonFields(getHost: () => Host): any {
function sessionPersonFields(principalId: string | undefined): { name?: string; avatarUrl?: string } {
  const host = getHost();
  const { personAvatarUrl, personDisplayName } = host;

  if (host.IDENTITY.kind !== "perspicax" || !principalId) return {};
  const person = host.principals.byId(principalId);
  if (!person) return {};
  const name = personDisplayName(person);
  const avatarUrl = personAvatarUrl(person);
  return { ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) };

}
  return sessionPersonFields;
}
