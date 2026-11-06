// @ts-nocheck
/** resolveAndSendPhoneCallConsent (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendPhoneCallConsent(getHost: () => Host): any {
function resolveAndSendPhoneCallConsent(res: ServerResponse, auth: RequestAuth, threadId: string, requestId: string, behavior: "allow" | "deny" | "answer") {
  const host = getHost();
  const { DATA_DIR, appendDecision, json } = host;
  return host.resolvePhoneCallConsentCard({
    store: host.store,
    outbound: host.outbound,
    actorPrincipalId: host.actorPrincipalId,
    localPrincipalId: host.localPrincipalId,
    isSolo: () => host.IDENTITY.kind === "solo",
    appendDecision: (row) => appendDecision(DATA_DIR, row),
    json,
  }, res, auth, threadId, requestId, behavior);

}
  return resolveAndSendPhoneCallConsent;
}
