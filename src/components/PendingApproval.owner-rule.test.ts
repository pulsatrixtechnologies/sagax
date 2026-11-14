// 2026-10-14 (bot owner permissions): a card of the owner route offers
// Deny, Always deny, Always allow and Allow once; the two "Always" save the
// owner's rule with the answer.
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ admin: true as boolean | null, dispatch: vi.fn(), alwaysAllow: true }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/org-approval-policy", () => ({ useOrgApprovalPolicy: () => ({ alwaysAllow: fixture.alwaysAllow, orgRules: 0 }), noteOrgAlwaysAllowOff: () => {} }));

import { pendingApprovals, PendingApprovalActions } from "./PendingApproval";
import { approvalPill } from "./ApprovalCard";

const bot = { id: "bot-1", name: "Cora" } as Bot;
const ownerRule = { tool: "perspicax_quasar__acme_desk__write", scope: { resource: "service/tickets", operation: "update" }, description: "Update tickets in Acme Desk (service/tickets, update)" };
function message(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "approval-1", at: 1, role: "bot", kind: "options",
    card: { title: "Approval needed", subtitle: "{}", options: ["Allow", "Deny"], tool: "mcp__perspicax_quasar__acme_desk__write",
      requestId: "request-1", allowKey: "mcp:perspicax_quasar__acme_desk__write", ownerRule, ...extra },
  };
}
type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function view(extra: Partial<NonNullable<Message["card"]>> = {}) {
  const pending = pendingApprovals([message(extra)])[0]!;
  const tree = PendingApprovalActions({ pending, bot, threadId: "thread-1", onCancelTurn: vi.fn() });
  return { html: renderToStaticMarkup(tree), buttons: nodes(tree).filter((node) => node.type === "button") };
}
const click = (result: ReturnType<typeof view>, label: string) => result.buttons.find((button) => button.props.children === label)!.props.onClick!();

beforeEach(() => { fixture.admin = false; fixture.alwaysAllow = true; fixture.dispatch.mockReset(); });

describe("owner rule buttons", () => {
  it("answers a teammate's linked card from the human chat on its exact source thread", () => {
    const source = message({ requestId: "view-1", approvalOrigin: { threadId: "worker-thread", messageId: "original-card", requestId: "request-1" } });
    source.from = { botId: bot.id, name: bot.name, color: "blue" };
    const pending = pendingApprovals([source])[0]!;
    expect(pending).toMatchObject({ threadId: "worker-thread", askedBy: "Cora" });
    const tree = PendingApprovalActions({ pending, bot, threadId: "human-thread", onCancelTurn: vi.fn() });
    const allow = nodes(tree).find(node => node.type === "button" && node.props.children === "Always allow")!;
    allow.props.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ threadId: "worker-thread", requestId: "request-1", behavior: "allow", rule: "allow" }));
  });
  // 2026-10-21 (lot 1A): the organization turned Always allow off: the card
  // offers Deny and Allow once, and says why
  it("offers no Always allow when the organization turned it off", () => {
    fixture.alwaysAllow = false;
    const result = view();
    expect(result.buttons.map((button) => button.props.children)).not.toContain("Always allow");
    expect(result.html).toContain("data-org-always-allow-off");
  });

  // 2026-10-20 (owner, after the reference design): Deny, Always allow, Allow once; Always
  // deny and the rule's scope live in Settings > Security
  it("offers exactly Deny, Always allow and Allow once", () => {
    const result = view();
    const labels = result.buttons.map((button) => button.props.children);
    expect(labels).toEqual(["Deny", "Always allow", "Allow once"]);
    expect(result.html).not.toContain("Always allow keeps exactly");
    expect(result.html).not.toContain("Cancel turn");
  });

  it("Always allow saves the rule with the answer in one click; Allow once and Deny save nothing", () => {
    const result = view();
    click(result, "Always allow");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "allow", rule: "allow", alwaysAllow: undefined }));
    click(result, "Allow once");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "allow", rule: undefined }));
    click(result, "Deny");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "deny", rule: undefined }));
  });

  it("keeps the same three buttons on a destructive call, with no paragraph", () => {
    const result = view({ ownerRule: { ...ownerRule, destructive: "delete" } });
    expect(result.buttons.map((button) => button.props.children)).toEqual(["Deny", "Always allow", "Allow once"]);
    expect(result.html).not.toContain("only a rule made for it can allow it");
  });

  // 2026-10-26 (#1065): a file card offers this file and the whole folder
  it("offers this file and the whole folder when the card carries a folder rule", () => {
    const result = view({ ownerRuleFolder: { tool: ownerRule.tool, scope: { path_in: "/repo/docs" }, description: "Read files in /repo/docs and its subfolders" } });
    expect(result.buttons.map((button) => button.props.children)).toEqual(["Deny", "Always allow this file", "Always allow the whole folder", "Allow once"]);
    click(result, "Always allow this file");
    const exact = fixture.dispatch.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(exact).toMatchObject({ behavior: "allow", rule: "allow" });
    expect(exact.ruleScope).toBeUndefined();
    click(result, "Always allow the whole folder");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "allow", rule: "allow", ruleScope: "folder" }));
  });

  it("says the folder covers changes when the card is a write", () => {
    const result = view({ ownerRuleFolder: { tool: ownerRule.tool, scope: { path_in: "/repo/docs" }, description: "Write files in /repo/docs and its subfolders", writes: true } });
    expect(result.buttons.map((button) => button.props.children)).toEqual(["Deny", "Always allow changes to this file", "Always allow changes in the whole folder, deletions included", "Allow once"]);
    click(result, "Always allow changes in the whole folder, deletions included");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ rule: "allow", ruleScope: "folder" }));
  });

  it("offers no folder choice when the organization turned Always allow off", () => {
    fixture.alwaysAllow = false;
    const result = view({ ownerRuleFolder: { tool: ownerRule.tool, scope: { path_in: "/repo/docs" }, description: "x" } });
    expect(result.html).not.toContain("data-always-allow-folder");
    expect(result.buttons.map((button) => button.props.children)).not.toContain("Always allow the whole folder");
  });

  it("an admin card offers no rule, and its owner only waits", () => {
    const result = view({ adminApproval: true });
    expect(result.buttons.map((button) => button.props.children)).not.toContain("Always deny");
  });

  it("the receipt reads Always allowed or Always denied", () => {
    expect(approvalPill({ answered: "allow", ruleSaved: { id: "r", behavior: "allow", description: "x" } })?.label).toBe("Always allowed");
    expect(approvalPill({ answered: "deny", ruleSaved: { id: "r", behavior: "deny", description: "x" } })?.label).toBe("Always denied");
    expect(approvalPill({ answered: "deny" })?.label).toBe("Denied");
  });
});
