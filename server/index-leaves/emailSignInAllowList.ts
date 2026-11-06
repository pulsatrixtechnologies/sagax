// @ts-nocheck
/** emailSignInAllowList (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEmailSignInAllowList(getHost: () => Host): any {
function emailSignInAllowList() {
  const host = getHost();
  const { loadConfig } = host;

  const list = host.signInAllowList();
  return host.signInListWithOpenInvites({
    admins: list.admins,
    members: list.members,
    invites: loadConfig().invites ?? [],
    now: Date.now()
  });

}
  return emailSignInAllowList;
}
