// @ts-nocheck
/** orgFullAccessRefusalFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgFullAccessRefusalFor(getHost: () => Host): any {
function orgFullAccessRefusalFor(auth: RequestAuth, bot: BotRecord, confirmed: boolean) {
  const host = getHost();
  const { permissionRefusal, sessionPrincipal } = host;

  // 2026-10-09: a member's profile must include bots.fullAccess (an admin
  // still meets the owner rule below, as before).
  if (auth.kind === "session" && !host.orgAdminCaller(auth) && !host.callerCan(auth, "bots.fullAccess")) {
    const refusal = permissionRefusal("bots.fullAccess");
    return { status: 403 as const, error: refusal.message, code: "permission_missing" as const, permission: refusal.permission };
  }
  return orgFullAccessGrantRefusal({
    policyAllowed: host.orgFullAccessPolicy(),
    callerPrincipalId: sessionPrincipal(auth),
    ownerPrincipalId: host.effectiveBotOwner(bot),
    confirmed,
    consent: bot.fullAccessConsent
  });

}
  return orgFullAccessRefusalFor;
}
