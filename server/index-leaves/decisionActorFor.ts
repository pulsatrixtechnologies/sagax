// @ts-nocheck
/** decisionActorFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDecisionActorFor(getHost: () => Host): any {
function decisionActorFor(auth: RequestAuth) {
  void getHost();

  if (auth.kind === "loopback") return auth.trust === "service" ? { kind: "worker" } : { kind: "loopback" };
  const session = auth.session;
  return {
    kind: "session", sessionId: session.id, label: session.label,
    ...(session.email ? { email: session.email } : {}),
    // A portal session's id is its membership grant: never written down.
    ...(session.userId && !session.userId.startsWith("portal:") ? { userId: session.userId } : {})
  };

}
  return decisionActorFor;
}
