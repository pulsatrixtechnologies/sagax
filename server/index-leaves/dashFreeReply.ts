// @ts-nocheck
/** dashFreeReply (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDashFreeReply(getHost: () => Host): any {
function dashFreeReply(text: string, threadId: string, bot: { ownerUserId?: unknown } | undefined) {
  const host = getHost();

  if (!/[\u2013\u2014]/.test(text)) return text;
  try {
    const person = host.connectorSetupSpeaker(threadId) ?? (bot ? host.effectiveBotOwner(bot) : undefined) ?? undefined;
    const language = host.languageOfPerson(person);
    const preference = host.IDENTITY.kind === "perspicax" && person ? host.userPreferenceStore.get(person).preferences[host.VOICE_DASHES_PREFERENCE] : undefined;
    return host.voiceDashesEnabled(preference, language) ? host.replaceDashes(text, language) : text;
  } catch {
    return text;
  }

}
  return dashFreeReply;
}
