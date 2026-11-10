// @ts-nocheck
/** connectorSetupStore (#1388). Pure move from server/index.ts.
 * #3344: the person's Grok reach comes from their connector registry
 * (server/connectors/registry.ts), known right after a restart. */
export type Host = Record<string, any>;

/** The catalog ids (GROK_CLOUD_CONNECTORS) a registry account carries. */
function catalogIds(account) {
  return account ? account.connectors.filter((entry) => entry.state === "connected" && entry.id).map((entry) => entry.id) : [];
}

export function createConnectorSetupStore(getHost: () => Host): any {
function connectorSetupStore() {
  const host = getHost();

  return {
    cards: (threadId: string) => host.store.messagesFor(threadId).flatMap((message) => message.connectorSetup ? [{ messageId: message.id, view: message.connectorSetup }] : []),
    proofs: () => host.connectorSetupProofs,
    botOf: (threadId: string) => host.store.botByThread(threadId)?.id,
    patch: (threadId: string, messageId: string, view: ConnectorSetupView) => { host.store.patchMessage(threadId, messageId, { connectorSetup: view }); },
    // the person's own Grok sign-ins, as their turns run them (engine-credentials.ts)
    grokReach: (principalId: string) => {
      // #2384: the person's first signed-in Grok account (an added one has its own folder)
      const acct = host.engineLogins?.preferredAccount(principalId, "grokAgent");
      const registry = host.connectorRegistry;
      const known = (slot) => {
        // no added account: the person's own Grok folder
        const account = registry?.account(principalId, { provider: "grok-com", instanceId: acct ?? "grok", slot });
        return account && account.at > 0 ? account : undefined;
      };
      const reach = known("primary");
      // 2026-10-29: the person's second Grok sign-in, when that one has it
      const second = known("second");
      const elsewhere = catalogIds(second).length
        ? { engine: host.relayAccountLabel(host.driverDisplayName("grokAgent"), second.kind ?? host.grokAccountKindFor(principalId, "second", acct)), connectors: catalogIds(second) }
        : undefined;
      // 2026-10-30: which account the card's connector goes on
      const account = reach?.kind ?? host.grokAccountKindFor(principalId, "primary", acct);
      if (!reach && !elsewhere && !account) return undefined;
      return { connectors: catalogIds(reach), at: reach?.at ?? 0, ...(elsewhere ? { elsewhere } : {}), ...(account ? { account } : {}) };
    }
  };

}
  return connectorSetupStore;
}
