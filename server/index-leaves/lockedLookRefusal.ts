// @ts-nocheck
/** lockedLookRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLockedLookRefusal(getHost: () => Host): any {
function lockedLookRefusal(auth: RequestAuth, bot: BotRecord | null | undefined, nextLook: unknown) {
  const host = getHost();
  const { lockedLookChange } = host;

  if (nextLook === undefined) return null;
  const person = host.actorPrincipalId(auth);
  if (!person) return null;
  try {
    return lockedLookChange(bot?.mascotLook, nextLook, new Set(host.achievementStore.snapshot(person).rewards));
  } catch {
    return null;
  }

}
  return lockedLookRefusal;
}
