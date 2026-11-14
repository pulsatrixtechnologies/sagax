// A page's connector call (#3413 lot 7) goes through the bot's own approval
// path (owner decision of 2026-11-10): the same custom rules a bot of the
// reader reads (customRules.rulesOf: the reader's own rules, then the
// organization's), the one Full access decision (full-access-gate.ts) with
// its holds. The organization's Always allow policy is read where every
// page card's answer is kept (page-data-approvals.ts). Nothing here is a
// second rule: it only reads those.
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { CustomRule } from "../../shared/custom-rules.ts";
import { fullAccessActs, ruleHoldFacts } from "../approvals/full-access-gate.ts";
import { reviewCustomRules, type CustomRuleCall, type RuleProductContext } from "../rules/custom-rules-review.ts";

export interface PageActVerdict {
  /** What a rule says about this call ("ask" too for a security key the reader set on it). */
  rule: "deny" | "ask" | "allow" | "none";
  /** Whose rule: the organization's or the reader's own; null without one. */
  by: "org" | "person" | null;
  /** The reader's level acts without a card (Full access, nothing in its way). */
  acts: boolean;
}

export function pageActVerdict(input: {
  /** customRules.rulesOf(reader, their bot): their own rules, then the organization's. */
  rules: readonly CustomRule[];
  call: CustomRuleCall;
  botId: string;
  /** The reader's bot's level for a turn (approvalModeForTurn); undefined without a bot. */
  level: ApprovalMode | undefined;
  /** A security key the reader set on this kind of action. */
  keyed?: boolean;
  home?: string;
  context?: RuleProductContext;
}): PageActVerdict {
  const { decision } = reviewCustomRules(input.rules, input.call, input.botId, input.home, input.context ?? {});
  const keyed = input.keyed === true;
  const rule = decision.kind === "none" && keyed ? "ask" : decision.kind;
  const by = decision.kind !== "none" ? (decision.rule.org ? "org" : "person") : keyed ? "person" : null;
  return { rule, by, acts: fullAccessActs(input.level, ruleHoldFacts(decision, keyed)) };
}
