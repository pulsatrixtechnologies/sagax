import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalCard, approvalPill, heldByRuleLine } from "./ApprovalCard";
import { BotEditorStore, type Message } from "@/state/store";
import { CustomRuleSavedInset } from "./CustomRuleNotice";
import { humanizeToolIds } from "../../shared/tool-display-name";

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
    expect(approvalPill({ answered: "deny", alwaysAllowed: card.allowKey })?.label).toBe("Denied");
  });
  // #4200 point 6: the person chose Always allow, which saved an Allow rule
  // from the card (customRuleSaved, "Added to your Allow rules"): the row
  // says what was chosen, from that one stored answer.
  it("says Always allowed, Allowed once or Denied, as chosen", () => {
    const saved = { id: "rule-1", when: "reading with `mcp__desk__view_schedule`" };
    expect(approvalPill({ answered: "allow", customRuleSaved: saved })?.label).toBe("Always allowed");
    expect(approvalPill({ answered: "allow" })?.label).toBe("Allowed once");
    expect(approvalPill({ answered: "deny" })?.label).toBe("Denied");
    const message = { id: "m2", role: "bot", kind: "options", card: { ...card, answered: "allow", customRuleSaved: saved } } as unknown as Message;
    const html = render(createElement(ApprovalCard, { bot: { name: "Dispatch" }, message }));
    expect(html).toContain("Always allowed");
    expect(html).not.toContain("Allowed once");
  });
  // #4200: the rule shown names the product and the tool's plain name, never
  // an id with a double underscore.
  it("shows the saved rule without a double underscore", () => {
    // the one helper the step rows and routine lines use (2026-11-03)
    expect(humanizeToolIds("reading with `mcp__desk__view_schedule`")).toBe("reading with `View schedule`");
    const line = heldByRuleLine({ customRule: { outcome: "held", when: "reading with `mcp__desk__view_schedule`" } } as never);
    expect(line?.target).toBe("« reading with `View schedule` »");
    const saved = { id: "rule-1", when: "reading with `mcp__desk__view_schedule`" };
    const html = render(createElement(CustomRuleSavedInset, { rule: saved, botId: "b1" }));
    expect(html).toContain("View schedule");
    expect(html).not.toContain("__");
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
