// @ts-nocheck
/** ruleManager (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRuleManager(getHost: () => Host): any {
function ruleManager(auth: RequestAuth) {
  const host = getHost();
  const { isBotActSession } = host;

  // a bot's act copy of its person's session is the bot, not the person:
  // it never saves, edits or removes a rule, nor changes a mode
  // unless it replays a change the person allowed on its card (sagax_settings)
  if (auth.kind === "session" && isBotActSession(auth.session) && host.actConfirmed()?.personKey !== host.personKey(auth.session)) return null;
  const id = host.approvalCallerUserId(auth);
  return id ? id : null;

}
  return ruleManager;
}
