// @ts-nocheck
/** masteryNightly (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMasteryNightly(getHost: () => Host): any {
function masteryNightly() {
  const host = getHost();
  const { masteryCensus } = host;

  try {
    for (const person of host.achievementStore.people()) {
      const day = host.achievementStore.localDay(person);
      if (host.masteryReconciledDay.get(person) === day) continue;
      host.masteryReconciledDay.set(person, day);
      const unlocked = host.achievementStore.reconcile(person, [{ kind: "threads.census", ...masteryCensus(person) }]);
      if (unlocked.length) host.broadcast({ kind: "achievements", audience: person, unlocked });
    }
  } catch (error) {
    console.warn(`achievements: the nightly pass failed (${error instanceof Error ? error.message : String(error)})`);
  }

}
  return masteryNightly;
}
