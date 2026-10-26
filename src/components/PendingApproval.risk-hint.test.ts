// 2026-10-22: why a card still shows although the bot is on auto mode with
// rules — a risky action no rule covers. The card names the risk type in
// human terms, and "Toujours permettre" (the candidate button) authors a
// correctly scoped rule that covers it.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ admin: true as boolean | null, dispatch: vi.fn(), alwaysAllow: true }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/org-approval-policy", () => ({ useOrgApprovalPolicy: () => ({ alwaysAllow: fixture.alwaysAllow, orgRules: 0 }), noteOrgAlwaysAllowOff: () => {} }));

const { pendingApprovals, PendingApprovalActions } = await import("./PendingApproval");

const bot = { id: "bot-1", name: "Cora" } as Bot;
function message(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "approval-1", at: 1, role: "bot", kind: "options",
    card: {
      title: "Approval needed", subtitle: "{}", options: ["Allow", "Deny"],
      tool: "mcp__files__delete_thing", requestId: "request-1",
      customRuleCandidate: { when: "la suppression de fichiers", risks: ["destructive"] },
      ...extra,
    },
  } as Message;
}
function html(extra: Partial<NonNullable<Message["card"]>> = {}) {
  const pending = pendingApprovals([message(extra)])[0]!;
  return renderToStaticMarkup(PendingApprovalActions({ pending, bot, threadId: "thread-1", onCancelTurn: vi.fn() }))
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

beforeEach(() => { fixture.admin = true; fixture.alwaysAllow = true; setLocale("fr"); });

describe("approval card risk hint", () => {
  it("names the risk type in human terms when a risky card has no covering rule", () => {
    const out = html();
    expect(out).toContain("data-approval-risk-hint");
    expect(out).toContain("les suppressions");
    // the one-click fix is right there
    expect(out).toContain("Toujours permettre");
  });

  it("stays silent when a rule notice already explains the hold", () => {
    const out = html({ customRule: { id: "r1", when: "x", behavior: "ask", botId: null, outcome: "held" } });
    expect(out).not.toContain("data-approval-risk-hint");
  });

  it("stays silent when the card carries no risk class", () => {
    const out = html({ customRuleCandidate: { when: "la lecture de fichiers", risks: [] } });
    expect(out).not.toContain("data-approval-risk-hint");
  });
});
