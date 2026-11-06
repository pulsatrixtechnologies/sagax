// @ts-nocheck
/** providerTransitionForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createProviderTransitionForTurn(getHost: () => Host): any {
function providerTransitionForTurn(   bot: NonNullable<ReturnType<typeof store.bot>>,   runOn?: RoutineRunOn,   threadId?: string, ) {
  const host = getHost();

  const provider = host.turnProvider(bot, runOn, threadId);
  return provider && host.computerProviderConfigTransitions.has(provider)
    ? host.providerTransitionMessage(provider)
    : null;

}
  return providerTransitionForTurn;
}
