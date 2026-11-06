// @ts-nocheck
/** recordAchievements (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRecordAchievements(getHost: () => Host): any {
function recordAchievements(person: string | null | undefined, events: readonly AchievementEvent[]) {
  const host = getHost();

  if (!person || !events.length) return;
  try {
    const result = host.achievementStore.record(person, events, "server");
    if (result.unlocked.length) host.broadcast({ kind: "achievements", audience: person, unlocked: result.unlocked });
  } catch {
    /* achievements are a bonus: never fail the request that earned one */
  }

}
  return recordAchievements;
}
