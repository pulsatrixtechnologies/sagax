import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalCard, approvalPill } from "./ApprovalCard";
import { BotEditorStore, type Message } from "@/state/store";

const store = { dispatch: () => {} } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(BotEditorStore, { value: store, children: el }));

const card = {
  title: "Approval needed",
  options: [],
  requestId: "r1",
  requestType: "permission" as const,
  tool: "other",
  mcpTool: "perspicax__cw_psa_write",
  allowKey: "mcp:perspicax__cw_psa_write",
};

describe("Allow rule receipt", () => {
  it("reads Always allowed only when the person saved the rule", () => {
    expect(approvalPill({ answered: "allow", alwaysAllowed: card.allowKey })?.label).toMatch(/always/i);
    expect(approvalPill({ answered: "allow" })?.label).toMatch(/once/i);
    expect(approvalPill({ answered: "deny", alwaysAllowed: card.allowKey })?.label).toMatch(/declined/i);
  });
  // 2026-10-28: an Always allow is not asked again; its receipt is the call's
  // ordinary step line, and "Always allowed" lives in its details only.
  it("reads as the call's step line, never Always allowed on the line; the rule opens under it", () => {
    const message = { id: "m1", role: "bot", kind: "options", card: { ...card, answered: "allow", alwaysAllowed: card.allowKey } } as unknown as Message;
    const html = render(createElement(ApprovalCard, { bot: { name: "Dispatch" }, message }));
    expect(html).toContain('data-testid="approval-receipt-quiet"');
    expect(html).not.toContain("Always allowed");
    expect(html).not.toContain('data-status-pill="success"');
    expect(html).toContain('aria-expanded="false"');
    const once = { ...message, card: { ...message.card!, alwaysAllowed: undefined } } as Message;
    expect(render(createElement(ApprovalCard, { bot: { name: "Dispatch" }, message: once }))).toContain("Allowed once");
    // the opened receipt (ApprovalCard.single-card.test.ts) shows the rule
  });
});
