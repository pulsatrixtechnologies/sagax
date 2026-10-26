// The server side of custom auto-review rules (shared/custom-rules.ts):
// read one permission call, apply the person's rules, and say what the card
// or the transcript shows about it (the rule notice).
//
// Nothing here answers a provider. server/index.ts asks `reviewCustomRules`
// at request.opened, before any grant answers, and passes the decision to
// autoVerdict (server/auto-approve.ts), which keeps the order: a question
// and a safety hold first, then the person's deny or ask, then grants, then
// the person's allow.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { safetyClassKey } from "../shared/safety-review.ts";
import {
  callFacts,
  candidateWhen,
  compileRule,
  evaluateCustomRules,
  ruleCoversCall,
  type CallFacts,
  type CustomRule,
  type CustomRuleBinding,
  type CustomRuleCandidate,
  type CustomRuleDecision,
  type CustomRuleNotice,
} from "../shared/custom-rules.ts";

export type { CustomRuleCandidate, CustomRuleNotice };

export interface CustomRuleCall {
  tool: string;
  mcpTool?: string;
  input?: string;
  command?: string;
  /** What the engine reports: compared only by an exact command's binding. */
  cwd?: string;
  providerInstanceId?: string;
  paths?: readonly string[];
  summary?: string;
  hints?: { readOnly?: boolean; destructive?: boolean };
}

export function serverHome(): string | undefined {
  try {
    return homedir();
  } catch {
    return undefined;
  }
}

/** Where a path really points: a symbolic link is followed, and a path that
 * does not exist yet resolves through its nearest existing folder. */
export function realPath(absolute: string): string {
  let head = absolute;
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = realpathSync.native(head);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(head);
      if (parent === head) break;
      tail.push(basename(head));
      head = parent;
    }
  }
  return absolute;
}

export function factsForCall(call: CustomRuleCall, home: string | undefined = serverHome()): CallFacts {
  const text = [call.mcpTool, call.tool, call.command, call.summary, call.input].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
  // a command line is read on its own first: its patterns anchor at its start
  const classKey = (call.command ? safetyClassKey(call.command, call.mcpTool ?? call.tool) : undefined) ?? safetyClassKey(text, call.mcpTool ?? call.tool);
  return callFacts({
    tool: call.tool,
    ...(call.mcpTool ? { mcpTool: call.mcpTool } : {}),
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.command !== undefined ? { command: call.command } : {}),
    ...(call.cwd ? { cwd: call.cwd } : {}),
    ...(call.providerInstanceId ? { providerInstanceId: call.providerInstanceId } : {}),
    ...(call.paths ? { paths: call.paths } : {}),
    ...(call.hints ? { hints: call.hints } : {}),
    ...(classKey ? { classKey } : {}),
    ...(home ? { home } : {}),
    resolve: realPath,
  });
}

export function reviewCustomRules(rules: readonly CustomRule[], call: CustomRuleCall, botId: string, home: string | undefined = serverHome()): { decision: CustomRuleDecision; facts: CallFacts } {
  const facts = factsForCall(call, home);
  return { decision: evaluateCustomRules(rules, facts, { botId, ...(home ? { home } : {}), resolve: realPath }), facts };
}

export function customRuleNotice(decision: CustomRuleDecision): CustomRuleNotice | undefined {
  if (decision.kind === "none") {
    if (!decision.riskBlocked) return undefined;
    const { rule, missing } = decision.riskBlocked;
    return { id: rule.id, when: rule.when, behavior: rule.behavior, botId: rule.botId, outcome: "risk", missing, ...(rule.org ? { org: true as const } : {}) };
  }
  const { rule } = decision;
  return {
    id: rule.id,
    when: rule.when,
    behavior: rule.behavior,
    botId: rule.botId,
    outcome: decision.kind === "allow" ? "approved" : decision.kind === "deny" ? "denied" : "held",
    // the organization admin's rule: the card says so, and the person
    // cannot change it
    ...(rule.org ? { org: true as const } : {}),
  };
}

/** The rule "Toujours permettre ceci" would save for this call, or
 * undefined when no rule text can cover it (it then is not offered). */
export function customRuleCandidate(facts: CallFacts, language: string | undefined, home: string | undefined = serverHome()): CustomRuleCandidate | undefined {
  const when = candidateWhen(facts, language ?? "fr");
  if (!ruleCoversCall(compileRule(when, home, realPath), facts, "allow")) return undefined;
  const binding: CustomRuleBinding | undefined = facts.command
    ? { tool: facts.tool, command: facts.command, ...(facts.cwd ? { cwd: facts.cwd } : {}), ...(facts.providerInstanceId ? { providerInstanceId: facts.providerInstanceId } : {}) }
    : undefined;
  return { when, risks: [...facts.risks], ...(binding ? { binding } : {}) };
}

/** Whether a saved rule covers the call of an open card: the check behind
 * "Toujours permettre ceci", so a rule is never saved from a card it would
 * not answer. */
export function ruleCoversCard(rule: CustomRule, call: CustomRuleCall, botId: string, home: string | undefined = serverHome()): boolean {
  const decision = evaluateCustomRules([rule], factsForCall(call, home), { botId, ...(home ? { home } : {}), resolve: realPath });
  return rule.behavior === "allow" ? decision.kind === "allow" : decision.kind === rule.behavior;
}
