// @ts-nocheck
/** strictRuleQualifies (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStrictRuleQualifies(getHost: () => Host): any {
function strictRuleQualifies(personId: string, bot: BotRecord, kind: "admin" | "holder") {
  const host = getHost();
  const { isPrincipalId } = host;

  const id = personId.trim().toLowerCase();
  if (!id || !isPrincipalId(id)) return false;
  const person = host.principals.byId(id);
  if (!person || person.disabledAt !== undefined) return false;
  if (kind === "holder") return id === host.effectiveBotOwner(bot).trim().toLowerCase() && host.principalCan(id, "host.commands");
  return person.local === true || person.orgRole === "admin" || host.principalCan(id, "host.shell");

}
  return strictRuleQualifies;
}
