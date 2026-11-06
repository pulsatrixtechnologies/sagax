// @ts-nocheck
/** takeTemporaryCreateToken (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTakeTemporaryCreateToken(getHost: () => Host): any {
function takeTemporaryCreateToken(token: unknown, auth: RequestAuth) {
  const host = getHost();

  if (typeof token !== "string") return null;
  const entry = host.temporaryCreateTokens.get(token);
  host.temporaryCreateTokens.delete(token);
  if (!entry || entry.expires <= Date.now()) return null;
  if (auth.kind !== "session" || (auth.session.principalId ?? "").trim().toLowerCase() !== entry.principalId) return null;
  return entry.record;

}
  return takeTemporaryCreateToken;
}
