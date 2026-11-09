// @vitest-environment happy-dom
// #3021: PendingApprovalBox renders the panel and the actions as siblings;
// both were keyed by the request id and React warned "two children with the
// same key". Each sibling now has its own key.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

import { setLocale } from "@/lib/i18n";

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: vi.fn() }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/org-approval-policy", () => ({ useOrgApprovalPolicy: () => ({ alwaysAllow: true, orgRules: 0 }), noteOrgAlwaysAllowOff: () => {} }));

const { pendingApprovals, PendingApprovalBox } = await import("./PendingApproval");

const bot = { id: "bot-1", name: "Cora" } as Bot;
const message = {
  id: "approval-1", at: 1, role: "bot", kind: "options",
  card: { title: "Approval needed", subtitle: "{}", options: ["Allow", "Deny"], tool: "mcp__files__send", requestId: "req-2" },
} as Message;

afterEach(() => { vi.restoreAllMocks(); });

describe("PendingApprovalBox keys", () => {
  it("renders the panel and the actions without a duplicate key warning", () => {
    setLocale("fr");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
    const approvals = pendingApprovals([message]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => root.render(createElement(PendingApprovalBox, { approvals, threadId: "thread-1", botFor: () => bot, onCancelTurn: () => {} })));
    expect(host.innerHTML.length).toBeGreaterThan(0);
    root.unmount();
    host.remove();
    expect(errors.filter((e) => /same key/i.test(e))).toEqual([]);
  });
});
