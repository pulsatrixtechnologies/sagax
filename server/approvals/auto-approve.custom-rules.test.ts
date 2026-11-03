// 2026-10-16: custom auto-review rules in autoVerdict's order, and the
// server reading of a call and its rule notice.
import { describe, expect, it } from "vitest";

import { approvalHeldNote, autoVerdict } from "./auto-approve.ts";
import { customRuleCandidate, customRuleNotice, reviewCustomRules, ruleCoversCard } from "../rules/custom-rules-review.ts";
import type { CustomRule } from "../../shared/custom-rules.ts";

const HOME = "/Users/example";
let seq = 0;
function rule(when: string, behavior: CustomRule["behavior"], extra: Partial<CustomRule> = {}): CustomRule {
  seq += 1;
  return { id: `r${seq}`, ownerId: "owner", botId: null, when, behavior, riskScope: [], enabled: true, createdAt: seq, updatedAt: seq, ...extra };
}

describe("autoVerdict with a custom rule", () => {
  it("a deny or ask rule wins over Full access, a saved command and a web search", () => {
    expect(autoVerdict("full", "Bash", { customRule: { behavior: "deny", id: "r" } })).toEqual({ approve: null, source: "custom-rule-deny" });
    expect(autoVerdict("full", "Bash", { customRule: { behavior: "ask", id: "r" } })).toEqual({ approve: null, source: "custom-rule-ask" });
    expect(autoVerdict("auto", "Bash", { commandAllowed: true, customRule: { behavior: "ask", id: "r" } }).approve).toBeNull();
    expect(autoVerdict("auto", "WebSearch", { customRule: { behavior: "ask", id: "r" } }).approve).toBeNull();
    expect(autoVerdict("auto", "Read", { safetyAllow: true, customRule: { behavior: "ask", id: "r" } }).approve).toBeNull();
  });

  it("an allow rule answers a card nothing else answered", () => {
    expect(autoVerdict("ask", "Read", { customRule: { behavior: "allow", id: "r" } })).toEqual({ approve: "approved Read (your rule)", source: "custom-rule" });
    expect(autoVerdict("ask", "other", { sagaxGate: true, customRule: { behavior: "allow", id: "r" } }).source).toBe("custom-rule");
  });

  it("never answers a question, a safety hold or a sandbox widening", () => {
    expect(autoVerdict("full", "AskUserQuestion", { customRule: { behavior: "allow", id: "r" } })).toEqual({ approve: null, source: "no-grant" });
    expect(autoVerdict("ask", "Bash", { safetyHold: true, customRule: { behavior: "allow", id: "r" } })).toEqual({ approve: null, source: "safety-hold" });
    expect(autoVerdict("ask", "Bash", { requiresExplicitApproval: true, customRule: { behavior: "allow", id: "r" } }).approve).toBeNull();
  });

  it("an approved email draft is the person's own answer, and an ask rule does not hold it again", () => {
    expect(autoVerdict("ask", "mcp__outlook__send_mail", { emailDraftApproved: true, customRule: { behavior: "ask", id: "r" } }).source).toBe("email-draft-approval");
    expect(autoVerdict("ask", "mcp__outlook__send_mail", { emailDraftApproved: true, safetyHold: true }).source).toBe("safety-hold");
  });

  it("a card held by an ask rule says so", () => {
    expect(approvalHeldNote({ source: "custom-rule-ask", permission: true })).toBe("approval.held.customRule");
  });
});

// reviewCustomRules resolves each path on this disk: on Windows
// /Users/example/... becomes D:\Users\example\..., which no folder rule reads, so a
// folder allow fails closed there (server/rules/custom-rules.security.test.ts,
// "Windows paths fail closed") and no candidate is offered.
const windows = process.platform === "win32";

describe("reviewCustomRules and the rule notice", () => {
  const read = { tool: "Read", input: JSON.stringify({ file_path: "/Users/example/Documents/plan.md" }), paths: ["/Users/example/Documents/plan.md"] };
  const send = { tool: "mcp__outlook__send_mail", input: JSON.stringify({ to: ["a@example.com"], subject: "Bonjour" }) };

  it("deny wins over ask over allow, and the notice names the rule that decided", () => {
    const allow = rule("la lecture de fichiers dans ~/Documents", "allow", { botId: "b1" });
    const ask = rule("la lecture de fichiers", "ask");
    const deny = rule("lire les fichiers de ~/Documents", "deny");
    const denied = reviewCustomRules([allow, ask, deny], read, "b1", HOME).decision;
    expect(customRuleNotice(denied)).toEqual({ id: deny.id, when: deny.when, behavior: "deny", botId: null, outcome: "denied" });
    expect(customRuleNotice(reviewCustomRules([allow, ask], read, "b1", HOME).decision)?.outcome).toBe("held");
    expect(customRuleNotice(reviewCustomRules([allow], read, "b1", HOME).decision)?.outcome).toBe(windows ? undefined : "approved");
    expect(customRuleNotice(reviewCustomRules([], read, "b1", HOME).decision)).toBeUndefined();
  });

  it("an allow that does not cover an external send leaves the card and says which kind is missing", () => {
    const allow = rule("l'envoi de courriels", "allow");
    const notice = customRuleNotice(reviewCustomRules([allow], send, "b1", HOME).decision);
    expect(notice).toMatchObject({ id: allow.id, outcome: "risk", missing: ["external-send"] });
  });

  it("reads a send by its safety class even when the tool name hides it", () => {
    const facts = reviewCustomRules([], { tool: "Bash", command: "mail -s hi a@example.com < note.txt" }, "b1", HOME).facts;
    expect(facts.risks).toContain("external-send");
  });

  it("offers a candidate rule that covers its own card, and refuses one that does not", () => {
    const { facts } = reviewCustomRules([], read, "b1", HOME);
    const candidate = customRuleCandidate(facts, "fr", HOME);
    if (windows) {
      expect(candidate).toBeUndefined();
    } else {
      expect(candidate).toEqual({ when: "la lecture de fichiers dans ~/Documents", risks: [] });
      expect(ruleCoversCard(rule(candidate!.when, "allow", { botId: "b1" }), read, "b1", HOME)).toBe(true);
      expect(ruleCoversCard(rule(candidate!.when, "allow", { botId: "b2" }), read, "b1", HOME)).toBe(false);
    }
    const sendCandidate = customRuleCandidate(reviewCustomRules([], send, "b1", HOME).facts, "fr", HOME);
    expect(sendCandidate?.risks).toEqual(["external-send"]);
    expect(ruleCoversCard(rule(sendCandidate!.when, "allow"), send, "b1", HOME)).toBe(false);
    expect(ruleCoversCard(rule(sendCandidate!.when, "allow", { riskScope: ["external-send"] }), send, "b1", HOME)).toBe(true);
  });
});
