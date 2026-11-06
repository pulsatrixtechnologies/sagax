// @ts-nocheck
/** syncGithubForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSyncGithubForTurn(getHost: () => Host): any {
async function syncGithubForTurn(principalId: string, generation: string, botId?: string) {
  const host = getHost();

  const key = `${principalId}\n${generation}`;
  if (host.githubSyncedGenerations.has(key)) return;
  host.githubSyncedGenerations.add(key);
  if (host.githubSyncedGenerations.size > 2_000) host.githubSyncedGenerations.delete(host.githubSyncedGenerations.values().next().value!);
  const connection = host.personGithub(principalId);
  if (connection) await host.syncGithubToSandbox(principalId, connection, botId);

}
  return syncGithubForTurn;
}
