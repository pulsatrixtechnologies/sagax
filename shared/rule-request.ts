/**
 * Durable payload on an approval-rule confirmation card (propose_rule).
 *
 * a bot offers to add, change or remove one of the
 * person's Auto-review (custom) rules; the person confirms on the card.
 * Writes go through the existing custom-approval-rules store (no parallel
 * system). Org Ask/Deny rules stay enforced at runtime and stay locked.
 */
import type { CustomRuleBehavior, RiskClass } from "./custom-rules.ts";

export const RULE_REQUEST_ACTIONS = ["add", "change", "remove"] as const;
export type RuleRequestAction = (typeof RULE_REQUEST_ACTIONS)[number];

export type RuleRequestOperation =
  | {
    action: "add";
    when: string;
    behavior: CustomRuleBehavior;
    /** One bot, or null for every bot this person owns. */
    botId: string | null;
    riskScope?: RiskClass[];
  }
  | {
    action: "change";
    ruleId: string;
    /** Snapshot of the rule when the card was prepared (staleness). */
    before: { when: string; behavior: CustomRuleBehavior; botId: string | null; enabled: boolean };
    changes: {
      when?: string;
      behavior?: CustomRuleBehavior;
      botId?: string | null;
      enabled?: boolean;
      riskScope?: RiskClass[];
    };
  }
  | {
    action: "remove";
    ruleId: string;
    before: { when: string; behavior: CustomRuleBehavior; botId: string | null };
  };

export interface RuleRequestCardData {
  version: 1;
  requestId: string;
  /** The proposing conversation. */
  botId: string;
  threadId: string;
  /** Whose rules change (the bot owner's principal). */
  ownerId: string;
  /** Bot the rule is about (null = every bot of the person). */
  scopeBotId: string | null;
  scopeBotName: string;
  createdAt: number;
  reason: string;
  operation: RuleRequestOperation;
  /** One sentence shown on the card (Grok-style). */
  sentence: string;
  appliedAt?: number;
}

export function isRuleRequestAction(value: unknown): value is RuleRequestAction {
  return (RULE_REQUEST_ACTIONS as readonly string[]).includes(String(value));
}

const BEHAVIOR_LABEL: Record<CustomRuleBehavior, string> = {
  allow: "Allow automatically",
  ask: "Ask first",
  deny: "Refuse",
};

export function ruleBehaviorLabel(behavior: CustomRuleBehavior): string {
  return BEHAVIOR_LABEL[behavior];
}

/** Title and detail for the confirmation card. */
export function ruleCardCopy(input: {
  action: RuleRequestAction;
  sentence: string;
  behavior: CustomRuleBehavior;
  scopeBotName: string;
  allBots: boolean;
  reason: string;
  beforeWhen?: string;
}): { title: string; summary: string; detail: string } {
  const scope = input.allBots ? "every bot of yours" : input.scopeBotName;
  const title = input.action === "add"
    ? "Add this approval rule?"
    : input.action === "change"
      ? "Change this approval rule?"
      : "Remove this approval rule?";
  const lines: string[] = [`Why: ${input.reason}`];
  if (input.action === "change" && input.beforeWhen && input.beforeWhen !== input.sentence) {
    lines.push(`Was: When ${scope} wants to: ${input.beforeWhen}`);
    lines.push(`Now: When ${scope} wants to: ${input.sentence}`);
  } else if (input.action === "remove") {
    lines.push(`When ${scope} wants to: ${input.sentence}`);
  } else {
    lines.push(`When ${scope} wants to: ${input.sentence}`);
  }
  lines.push(`It should: ${ruleBehaviorLabel(input.behavior)}`);
  lines.push(input.action === "remove"
    ? "Confirm removes this rule. Org Ask first and Refuse rules still apply."
    : "Confirm saves this rule for you. Org Ask first and Refuse rules still win over it.");
  return { title, summary: `${title} · ${ruleBehaviorLabel(input.behavior)}`, detail: lines.join("\n") };
}
