// @ts-nocheck
/** githubCredentialsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createGithubCredentialsFor(getHost: () => Host): any {
function githubCredentialsFor(actor: string | null | undefined, repoOwner?: string) {
  const host = getHost();

  host.migrateGithubCredentials();
  const connection = host.usablePersonGithub(actor);
  const person = connection?.token;
  const credentials: GithubCredential[] = person ? [{ token: person, via: "person", ...(connection.login ? { login: connection.login } : {}) }] : [];
  const owner = host.credentialOwner(actor);
  try {
    if (owner) for (const entry of host.githubCredentials.automatic(owner)) credentials.push({ token: entry.token, via: "own", label: entry.label, id: entry.id });
    if (host.IDENTITY.kind === "perspicax") {
      for (const entry of host.githubCredentials.automatic(host.ORG_OWNER)) credentials.push({ token: entry.token, via: "organization", label: entry.label, id: entry.id });
    }
  } catch {
    // an unreadable list leaves the person's own connection
  }
  const wanted = repoOwner?.trim().toLowerCase();
  if (!wanted) return credentials;
  const names = (entry: GithubCredential) => `${entry.label ?? ""} ${entry.login ?? ""}`.toLowerCase();
  return [...credentials.filter((entry) => names(entry).includes(wanted)), ...credentials.filter((entry) => !names(entry).includes(wanted))];

}
  return githubCredentialsFor;
}
