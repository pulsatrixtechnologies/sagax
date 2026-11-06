// @ts-nocheck
/** strictCardRule (#1388). Pure move from server/index.ts. */
import { callStepUpClasses } from "../auth/step-up-gate.ts";
export type Host = Record<string, any>;

export function createStrictCardRule(getHost: () => Host): any {
function strictCardRule(   bot: BotRecord,   threadId: string,   call: { botId: string; tool: string; input?: string; cwd?: string },   kind: "admin" | "holder",   stepUpCall: Parameters<typeof callStepUpClasses>[0], ) {
  const host = getHost();
  const { matchOwnerRule } = host;

  // #2091 (decided 2026-11-05): every rule the person kept answers, the whole
  // tool included; no scope is filtered out "by caution"
  const rules = host.ownerApprovals.adminRulesForBot(bot.id).filter((rule) => host.strictRuleQualifies(rule.ownerId, bot, kind));
  if (!rules.length) return undefined;
  const classes = callStepUpClasses(stepUpCall, host.threadActionClassContext(bot.id, threadId));
  for (const rule of rules) {
    if (classes.length && host.securityKeys.required(rule.ownerId, classes, rule.ownerId).length) continue;
    const match = matchOwnerRule([rule], { ownerId: rule.ownerId, ...call });
    if (match) return match;
  }
  return undefined;

}
  return strictCardRule;
}
