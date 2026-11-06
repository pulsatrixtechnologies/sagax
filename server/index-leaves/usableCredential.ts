// @ts-nocheck
/** usableCredential (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUsableCredential(getHost: () => Host): any {
function usableCredential(id: string, actor: string | null | undefined): { id: string; label: string; token: string } | undefined {
  const host = getHost();

  host.migrateGithubCredentials();
  const owner = host.githubCredentials.ownerOf(id);
  const mine = host.credentialOwner(actor);
  if (!owner || !(owner === mine || (owner === host.ORG_OWNER && host.IDENTITY.kind === "perspicax"))) return undefined;
  const token = host.githubCredentials.tokenFor(id);
  const label = host.githubCredentials.list(owner, { org: false }).find((entry) => entry.id === id)?.label ?? "";
  return token ? { id, label, token } : undefined;

}
  return usableCredential;
}
