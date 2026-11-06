// @ts-nocheck
/** threadTitleGate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadTitleGate(getHost: () => Host): any {
function threadTitleGate(bot: Pick<BotRecord, "modelSelection">, principalId?: string | null): { ok: true; instance: ProviderInstance } | { ok: false; refusal: string } {
  const host = getHost();

  if (!host.personalFeatureOn("llmThreadTitles", llmThreadTitlesEnabled(host.cfg), principalId)) return { ok: false, refusal: "generated thread titles are turned off on this server" };
  if (host.hostedModels && !host.hostedModels.allows(bot.modelSelection)) return { ok: false, refusal: host.hostedModels.error() };
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (!instance?.generateText) return { ok: false, refusal: "this bot's model can't generate a title — rename the thread instead" };
  const refusal = host.policyModelRefusal(instance);
  if (refusal) return { ok: false, refusal };
  try {
    assertWithinBudget(host.cfg, DATA_DIR);
  } catch (error) {
    return { ok: false, refusal: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, instance };

}
  return threadTitleGate;
}
