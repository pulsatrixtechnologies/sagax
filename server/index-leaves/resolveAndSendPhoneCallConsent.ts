// @ts-nocheck
/** resolveAndSendPhoneCallConsent (#1388). Pure move from server/index.ts. */
import { DATA_DIR } from "../config.ts";
import { appendDecision } from "../decision-log.ts";
import { json } from "../harness/http.ts";
import { resolveAndSendPhoneCallConsent as resolvePhoneCallConsentCard } from "../routes/phone-call-consent.ts";
export type Host = Record<string, any>;

export function createResolveAndSendPhoneCallConsent(getHost: () => Host): any {
function resolveAndSendPhoneCallConsent(res: ServerResponse, auth: RequestAuth, threadId: string, requestId: string, behavior: "allow" | "deny" | "answer"): boolean {
  const host = getHost();
  return resolvePhoneCallConsentCard({
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
