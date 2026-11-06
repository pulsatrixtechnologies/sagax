// @ts-nocheck
/** claimPhoneSecretBotDeletion (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaimPhoneSecretBotDeletion(getHost: () => Host): any {
function claimPhoneSecretBotDeletion(botId: string): (() => void) | null{
  const host = getHost();
  const { store } = host;

  const scopes = [
    { botId },
    ...store.groups
      .filter((group) => group.memberIds.includes(botId))
      .map((group) => ({ groupId: group.id })),
  ];
  const releases: Array<() => void> = [];
  for (const scope of scopes) {
    const release = host.phoneSecretSubmissions.claimMutation(scope);
    if (!release) {
      for (const undo of releases.reverse()) undo();
      return null;
    }
    releases.push(release);
  }
  return () => {
    for (const release of releases.reverse()) release();
  };

}
  return claimPhoneSecretBotDeletion;
}
