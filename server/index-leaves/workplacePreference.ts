// @ts-nocheck
/** workplacePreference (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWorkplacePreference(getHost: () => Host): any {
function workplacePreference(person: string | null) {
  const host = getHost();

  if (!person) return host.parseBotWorkplace(null);
  try {
    return host.parseBotWorkplace(host.userPreferenceStore.get(person).preferences[host.BOT_WORKPLACE_PREFERENCE]);
  } catch {
    return host.parseBotWorkplace(null);
  }

}
  return workplacePreference;
}
