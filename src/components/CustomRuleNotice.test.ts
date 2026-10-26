// 2026-10-16: the rule notice and "Toujours permettre ceci" on the approval
// box (custom auto-review rules, shared/custom-rules.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("@/lib/org-approval-policy", () => ({ useOrgApprovalPolicy: () => ({ alwaysAllow: true, orgRules: 0 }), noteOrgAlwaysAllowOff: () => {} }));

import { CustomRuleNoticeLine, CustomRuleSavedInset, customRuleNoticeLine } from "./CustomRuleNotice";
import { pendingApprovals, PendingApprovalActions, PendingApprovalPanel } from "./PendingApproval";

const bot = { id: "bot-1", name: "Cora" } as Bot;
const notice = { id: "crule_1", when: "la lecture de fichiers dans ~/Documents", behavior: "allow" as const, botId: null };

function message(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "approval-1", at: 1, role: "bot", kind: "options",
    card: { title: "Approval needed", subtitle: "{}", options: ["Allow", "Deny"], tool: "Read", requestId: "request-1", requestType: "permission", toolInput: '{"file_path":"/Users/jc/Documents/a.md"}', ...extra },
  };
}

describe("rule notice", () => {
  it("says when automatic review applied the rule, with its reason (lot A1)", () => {
    const model = { ...notice, reviewer: "model" as const, reason: "The file is in Documents." };
    expect(customRuleNoticeLine({ ...model, outcome: "approved" })).toBe("Approved by automatic review under your rule");
    expect(customRuleNoticeLine({ ...model, behavior: "deny", outcome: "denied" })).toBe("Refused by automatic review under your rule");
    expect(customRuleNoticeLine({ ...model, behavior: "ask", outcome: "held" })).toBe("Automatic review left this to you under your Ask first rule");
    expect(customRuleNoticeLine({ ...model, behavior: "deny", outcome: "denied", org: true })).toBe("Refused by automatic review under your organization's rule");
    const html = renderToStaticMarkup(createElement(CustomRuleNoticeLine, { notice: { ...model, outcome: "approved" } }));
    expect(html).toContain("data-custom-rule-reason");
    expect(html).toContain("The file is in Documents.");
    expect(renderToStaticMarkup(createElement(CustomRuleNoticeLine, { notice: { ...notice, outcome: "approved" } }))).not.toContain("data-custom-rule-reason");
  });
  it("says which rule decided, in its words, with Edit rule", () => {
    expect(customRuleNoticeLine({ ...notice, outcome: "approved" })).toBe("Approved automatically by your rule");
    expect(customRuleNoticeLine({ ...notice, behavior: "deny", outcome: "denied" })).toBe("Refused by your rule");
    expect(customRuleNoticeLine({ ...notice, behavior: "ask", outcome: "held" })).toBe("Paused by your \"Ask first\" rule");
    expect(customRuleNoticeLine({ ...notice, outcome: "risk", missing: ["external-send", "money"] })).toBe("Your rule matches, but it does not cover external sends, money: approve it yourself or widen the rule.");
    const html = renderToStaticMarkup(createElement(CustomRuleNoticeLine, { notice: { ...notice, outcome: "approved" } }));
    expect(html).toContain("la lecture de fichiers dans ~/Documents");
    expect(html).toContain("Edit rule");
    expect(html).toContain('data-custom-rule-notice="approved"');
  });

  it("the saved inset names the rule", () => {
    const html = renderToStaticMarkup(createElement(CustomRuleSavedInset, { rule: { id: "crule_1", when: notice.when } }));
    expect(html).toContain("Added to your &quot;Allow&quot; rules");
    expect(html).toContain(notice.when);
  });

  it("the approval box shows the rule that held the card", () => {
    const pending = pendingApprovals([message({ customRule: { ...notice, behavior: "ask", outcome: "held" } })])[0]!;
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending, count: 1, index: 0, bot }));
    expect(html).toContain('data-custom-rule-notice="held"');
  });
});

describe("Toujours permettre ceci", () => {
  const render = (extra: Partial<NonNullable<Message["card"]>> = {}) => {
    const pending = pendingApprovals([message(extra)])[0]!;
    return renderToStaticMarkup(PendingApprovalActions({ pending, bot, threadId: "thread-1", onCancelTurn: vi.fn() }));
  };

  // 2026-10-20 (JC): one "Always allow", one click, no editor on the card
  it("is offered as the one Always allow when the server proposes a rule for this card", () => {
    const html = render({ customRuleCandidate: { when: notice.when, risks: [] } });
    expect(html).toContain(">Always allow<");
    expect(html).toContain("data-always-allow");
    expect(html).not.toContain("Always allow this");
    expect(html).not.toContain("Save and allow");
  });

  it("is never offered without a proposal or on an admin card", () => {
    expect(render()).not.toContain("data-always-allow");
    expect(render({ adminApproval: true, customRuleCandidate: { when: notice.when, risks: [] } })).not.toContain("data-always-allow");
  });
});
