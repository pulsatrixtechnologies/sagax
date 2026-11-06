// @ts-nocheck
/** orgRefusalOf (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgRefusalOf(getHost: () => Host): any {
function orgRefusalOf(plan: Extract<EngineCredentialPlan, { ok: false }>, speaker?: TurnSpeaker) {
  void getHost();

  const speakerId = speaker?.origin === "person" ? speaker.principalId?.trim() : undefined;
  return {
    reason: plan.reason,
    ...(plan.cause ? { cause: plan.cause } : {}),
    ...(plan.payer ? { payer: plan.payer } : {}),
    ...(plan.payerPrincipalId ? { payerPrincipalId: plan.payerPrincipalId } : {}),
    ...(plan.routine ? { routine: true as const } : {}),
    ...(plan.ownerPays ? { ownerPays: true as const, ...(speakerId ? { speakerPrincipalId: speakerId } : {}) } : {})
  };

}
  return orgRefusalOf;
}
