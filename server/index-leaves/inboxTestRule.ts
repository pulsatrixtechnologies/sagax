// @ts-nocheck
/** inboxTestRule (#1388). Pure move from server/index.ts. */
import { RULE_TEST_DAYS } from "../../shared/action-journal.ts";
import { compileRule } from "../../shared/custom-rules.ts";
import { testRuleOnJournal, replayable } from "../action-journal.ts";
import { serverHome, reviewCustomRules } from "../rules/custom-rules-review.ts";
export type Host = Record<string, any>;

export function createInboxTestRule(getHost: () => Host): any {
function inboxTestRule(_auth: RequestAuth, viewer: InboxViewer, draft: RuleTestDraft): RuleTestResult | { error: string; status: number } {
  const host = getHost();
  if (draft.botId && host.effectiveBotOwner(host.store.bot(draft.botId) ?? {}) !== viewer.principalId) return { error: "no such bot of yours", status: 404 };
  const saved = draft.id ? host.customRules.ownRulesOf(viewer.principalId).find((rule) => rule.id === draft.id) : undefined;
  if (draft.id && !saved) return { error: "no such rule of yours", status: 404 };
  const draftId = saved?.id ?? "rule-test-draft";
  const rule: CustomRule = {
    id: draftId, ownerId: viewer.principalId, botId: draft.botId, when: draft.when, behavior: draft.behavior,
    riskScope: draft.riskScope, enabled: true, ...(saved?.binding ? { binding: saved.binding } : {}),
    createdAt: saved?.createdAt ?? Date.now(), updatedAt: Date.now()
  };
  const home = serverHome();
  const unreadable = !compileRule(draft.when, home, undefined, host.ruleProductsOfPerson(viewer.principalId, draft.botId)).recognized;
  const { rows } = host.journalRowsFor(viewer, RULE_TEST_DAYS);
  return testRuleOnJournal(rows, draftId, (row) => {
    if (!replayable(row)) return null;
    if (draft.botId && draft.botId !== row.botId) return null;
    const rules = [...host.customRules.rulesOf(viewer.principalId, row.botId).filter((other) => other.id !== draftId), rule];
    const call = row.call;
    return reviewCustomRules(rules, {
      tool: row.tool,
      ...(call?.mcpTool ? { mcpTool: call.mcpTool } : {}),
      ...(call?.input !== undefined ? { input: call.input } : {}),
      ...(call?.command !== undefined ? { command: call.command } : {}),
      ...(call?.cwd ? { cwd: call.cwd } : {}),
      ...(call?.providerInstanceId ? { providerInstanceId: call.providerInstanceId } : {}),
      ...(call?.paths?.length ? { paths: call.paths } : {}),
      ...(row.summary ? { summary: row.summary } : {})
    }, row.botId, home, host.ruleProductsOf(row.botId)).decision;
  }, RULE_TEST_DAYS, unreadable);
}
  return inboxTestRule;
}
