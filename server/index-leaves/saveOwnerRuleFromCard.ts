// @ts-nocheck
/** saveOwnerRuleFromCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSaveOwnerRuleFromCard(getHost: () => Host): any {
function saveOwnerRuleFromCard(auth: RequestAuth, threadId: string, requestId: string, rule: unknown, behavior: string, ruleScope?: unknown): { status: 400 | 403 | 404 | 409 | 500 | 503; error: string } | null {
  const host = getHost();

  if (rule === undefined || rule === null) return null;
  if (rule !== "allow" && rule !== "deny") return { status: 400, error: "rule must be allow or deny" };
  if (rule !== behavior) return { status: 400, error: "Always allow allows and Always deny denies." };
  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card) return { status: 404, error: "No such approval." };
  if (ruleScope !== undefined && ruleScope !== null && ruleScope !== "exact" && ruleScope !== "folder") return { status: 400, error: "ruleScope must be exact or folder" };
  // 2026-10-26 (#1065): "folder" keeps the card's folder rule (every file
  // of the folder and its subfolders), only an allow, only where the card
  // offered it. An ordinary card has no `from`. An admin card offers the
  // folder only for a read of one agent root (`from: "admin"`, no writes).
  const wholeFolder = ruleScope === "folder";
  if (wholeFolder) {
    const folder = card.ownerRuleFolder;
    const ordinary = rule === "allow" && Boolean(folder) && card.ownerRule?.from === undefined;
    const adminRead = rule === "allow" && folder?.from === "admin" && folder.writes !== true && card.ownerRule?.from === "admin";
    if (!ordinary && !adminRead) {
      return { status: 409, error: "This approval cannot be remembered for the whole folder." };
    }
  }
  if (!card.ownerRule || card.answered || card.dismissed || card.expired) {
    return { status: 409, error: "This approval cannot be remembered as a rule." };
  }
  const bot = host.botForApproval(threadId, message);
  if (!bot) return { status: 404, error: "No such approval." };
  const caller = host.ruleManager(auth);
  // 2026-10-19 an admin's card is remembered by the person who answers
  // it (an admin, a holder of host.shell, or the owner holding
  // host.commands for their own bot's server command), as their own rule
  // for this bot; an Always deny there answers nothing (the card stays).
  // Always deny only where it answers something (shared/approval-rule-card.ts)
  if (rule === "deny" && !host.alwaysDenyOffered(card) && card.ownerRule.from !== "admin") return { status: 400, error: "On this card, only Always allow is remembered." };
  const strict = card.adminApproval === true || card.serverCommandHolder === true;
  if (strict) {
    if (card.ownerRule.from !== "admin") return { status: 409, error: "This approval cannot be remembered as a rule." };
    if (rule !== "allow") return { status: 400, error: "On an admin's card, only Always allow is remembered." };
    if (!caller || !host.strictRuleQualifies(caller, bot, card.adminApproval ? "admin" : "holder")) {
      return { status: 403, error: "Only a person who answers this card can save a rule for it." };
    }
  }
  const ownerId = strict ? caller! : host.cardAnswererId(bot, threadId, card);
  if (!caller || caller.toLowerCase() !== ownerId.toLowerCase()) return { status: 403, error: "Only the bot owner can save a rule." };
  const candidate: NonNullable<typeof card.ownerRule> = wholeFolder ? card.ownerRuleFolder! : card.ownerRule;
  // #2091 (decided 2026-11-05): whatever the card offers is saved, the whole
  // tool included; no "cannot be remembered" refusal by caution
  let saved: OwnerRule;
  try {
    saved = host.ownerApprovals.add({
      ownerId, botId: bot.id, tool: candidate.tool, scope: candidate.scope,
      ...(candidate.destructive ? { destructive: candidate.destructive } : {}),
      ...(candidate.from ? { from: candidate.from } : {}),
      behavior: rule, description: candidate.description
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { status: status === 409 || status === 503 ? status : 500, error: error instanceof Error ? error.message : String(error) };
  }
  host.store.patchMessage(threadId, message.id, { card: { ...card, ruleSaved: { id: saved.id, behavior: saved.behavior, description: saved.description } } });
  host.orgAudit({
    category: "approval", action: "approval.rule.save", target: host.auditBotTarget(bot.id),
    after: { rule: saved.id, behavior: saved.behavior, tool: saved.tool },
    actor: host.orgAuditActor(auth)
  });
  return null;

}
  return saveOwnerRuleFromCard;
}
