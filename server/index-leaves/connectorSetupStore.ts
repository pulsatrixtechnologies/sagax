// @ts-nocheck
/** connectorSetupStore (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConnectorSetupStore(getHost: () => Host): any {
function connectorSetupStore() {
  const host = getHost();

  return {
    cards: (threadId: string) => host.store.messagesFor(threadId).flatMap((message) => message.connectorSetup ? [{ messageId: message.id, view: message.connectorSetup }] : []),
    proofs: () => host.connectorSetupProofs,
    botOf: (threadId: string) => host.store.botByThread(threadId)?.id,
    patch: (threadId: string, messageId: string, view: ConnectorSetupView) => { host.store.patchMessage(threadId, messageId, { connectorSetup: view }); },
    // the person's own Grok sign-in folder, as their turns run it (engine-credentials.ts)
    grokReach: (principalId: string) => {
      const reach = host.grokAccountReach(host.principalLoginDir(principalId, "grokAgent"));
      // 2026-10-29: the person's second Grok sign-in, when that one has it
      const second = host.engineLogins?.signedIn(principalId, "grokAgent", "second") ? host.grokAccountReach(host.principalLoginDir(principalId, "grokAgent", "second")) : undefined;
      const elsewhere = second?.connectors.length
        ? { engine: host.relayAccountLabel(host.driverDisplayName("grokAgent"), host.grokAccountKindFor(principalId, "second")), connectors: second.connectors }
        : undefined;
      // 2026-10-30: which account the card's connector goes on
      const account = host.grokAccountKindFor(principalId, "primary");
      if (!reach && !elsewhere && !account) return undefined;
      return { connectors: reach?.connectors ?? [], at: reach?.at ?? 0, ...(elsewhere ? { elsewhere } : {}), ...(account ? { account } : {}) };
    }
  };

}
  return connectorSetupStore;
}
