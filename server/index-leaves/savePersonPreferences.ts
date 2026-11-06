// @ts-nocheck
/** savePersonPreferences (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSavePersonPreferences(getHost: () => Host): any {
function savePersonPreferences(principalId: string, write: () => PersonPreferences) {
  const host = getHost();

  const before = host.personSendsReadReceipts(principalId);
  const saved = write();
  // "Show when I am online" travels with the preferences: tell the others at once.
  host.presence.refresh(principalId);
  if (host.personSendsReadReceipts(principalId) !== before) {
    for (const group of host.store.groups) {
      if (group.peopleDm && host.isPeopleDmParticipant(group, principalId)) host.broadcast({ kind: "thread.read", threadId: group.threadId, reset: true });
    }
  }
  host.broadcast({ kind: "preferences", audience: principalId, preferences: saved.preferences, updatedAt: saved.updatedAt });
  return saved;

}
  return savePersonPreferences;
}
