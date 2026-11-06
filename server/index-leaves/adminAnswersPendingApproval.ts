// @ts-nocheck
/** adminAnswersPendingApproval (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAdminAnswersPendingApproval(getHost: () => Host): any {
function adminAnswersPendingApproval(method: string, path: string, auth: RequestAuth) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || method !== "POST" || !host.orgAdminCaller(auth)) return false;
  const match = /^\/api\/threads\/([\w-]+)\/respond$/.exec(path);
  if (!match) return false;
  return host.store.messagesFor(match[1]!).some((row) => row.card?.adminApproval && row.card.requestId && !row.card.answered && !row.card.dismissed && !row.card.expired);

}
  return adminAnswersPendingApproval;
}
