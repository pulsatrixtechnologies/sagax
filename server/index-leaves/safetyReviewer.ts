// @ts-nocheck
/** safetyReviewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSafetyReviewer(getHost: () => Host): any {
function safetyReviewer(botId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  const selected = bot?.modelSelection.instanceId;
  if (!selected) return undefined;
  const instance = host.registry.get(selected);
  const review = instance?.reviewPermission;
  if (!review) return undefined;
  // #3519: the review signs in as the bot's turn does; a card where the
  // review should have answered would be a card nobody decided.
  const signed = host.botOneShotText(bot, instance, (text, options) => review.call(instance, text, options?.signal, options?.access));
  return (prompt, signal) => signed(prompt, signal ? { signal } : undefined);

}
  return safetyReviewer;
}
