import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { ApprovalCard, toolLabel } from "./ApprovalCard";
import { RiskChip, TechnicalDetails } from "./ApprovalParts";
import { PendingApprovalPanel, pendingApprovals, readOnlyApprovals, spokenApprovalPrompt, stepperIndex } from "./PendingApproval";

beforeAll(() => {
  process.env.TZ = "America/Toronto";
});
afterEach(() => setLocale("en"));

const TOOL = "mcp__perspicax_pulsatrix_flow_jc__cw_psa_schedule__query";
const ARGS = JSON.stringify({
  conditions: "member/identifier='jcproulx' and dateStart >= [2026-10-02T04:00:00Z] and dateStart < [2026-10-04T04:00:00Z]",
  orderBy: "dateStart asc",
}, null, 2);
const bot = { id: "bot-1", name: "Cryptic" } as never as Bot;

function ask(id: string, tool: string, input: string, extra: Record<string, unknown> = {}): Message {
  return {
    id,
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: JSON.stringify(JSON.parse(input)).slice(0, 200),
      toolInput: input,
      options: ["Allow", "Deny"],
      requestId: `req-${id}`,
      tool,
      allowSession: true,
      ...extra,
    },
  };
}

describe("human approval card", () => {
  it("never names Sagax's own server as a product: no 'Computer select dans Sagax Computer' (prod 0.5.27)", () => {
    setLocale("fr");
    expect(toolLabel("sagax-computer__computer_select")).not.toMatch(/Sagax Computer/);
    expect(toolLabel("mcp__sagax-environment__run_command")).not.toMatch(/Sagax Environment/);
  });

  it("shows a plain title, summary and risk chip in the composer's box, and hides the raw id and JSON", () => {
    setLocale("fr");
    const [pending] = pendingApprovals([ask("a", TOOL, ARGS)]);
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, bot }));
    expect(html).toContain("Cryptic veut consulter l&#x27;horaire dans ConnectWise PSA");
    expect(html).toContain("jcproulx");
    expect(html).toContain("Lecture seule");
    expect(html).not.toContain(TOOL);
    expect(html).not.toContain("conditions");
    expect(html).not.toContain("mcp perspicax");
  });

  it("leaves one quiet waiting line in the thread while the box above the composer asks (JC, 2026-10-15)", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: ask("a", TOOL, ARGS) }));
    expect(html).toContain("En attente de votre autorisation");
    expect(html).toContain("data-step-row");
    expect(html).toContain('data-tour="approval"');
    // the request is not shown a second time
    expect(html).not.toContain("Autoriser Cryptic");
    expect(html).not.toContain("Lecture seule");
    expect(html).not.toContain("Voir la demande complète");
    expect(html).not.toContain("<button");
  });

  it("reads as a one-line receipt once settled, with the details behind it", () => {
    const message = ask("a", TOOL, ARGS);
    message.card!.answered = "allow";
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(html).toContain('data-testid="approval-receipt"');
    expect(html).toContain("Allowed once");
    expect(html).toContain("View the schedule in ConnectWise PSA");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("conditions");
  });

  it("keeps a command readable in the composer's box: it is what runs", () => {
    const message: Message = {
      id: "cmd", role: "bot", kind: "options", at: 1,
      card: { title: "Approval needed", subtitle: "pnpm test", options: ["Allow", "Deny"], requestId: "req-cmd", tool: "Bash" },
    };
    const [pending] = pendingApprovals([message]);
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, bot }));
    expect(html).toContain("Cryptic wants to run a command");
    expect(html).toContain("pnpm test");
    expect(html).toContain("Runs an action");
  });
});

describe("risk chips", () => {
  it("labels each level in both languages", () => {
    const en = ["read", "write", "execute", "destructive"].map((risk) => renderToStaticMarkup(createElement(RiskChip, { risk: risk as never })));
    expect(en.join("")).toContain("Read-only");
    expect(en.join("")).toContain("Makes changes");
    expect(en.join("")).toContain("Runs an action");
    expect(en.join("")).toContain("Destructive");
    expect(en[3]).toContain('data-risk="destructive"');
    setLocale("fr");
    expect(renderToStaticMarkup(createElement(RiskChip, { risk: "read" }))).toContain("Lecture seule");
    expect(renderToStaticMarkup(createElement(RiskChip, { risk: "destructive" }))).toContain("Destructif");
  });
});

describe("technical details toggle", () => {
  it("is collapsed by default and shows tool, server and colored JSON when open", () => {
    const closed = renderToStaticMarkup(createElement(TechnicalDetails, { tool: TOOL, server: "perspicax_pulsatrix_flow_jc", args: ARGS }));
    expect(closed).toContain("View the full request");
    expect(closed).toContain('data-technical-details="closed"');
    expect(closed).not.toContain(TOOL);

    const open = renderToStaticMarkup(createElement(TechnicalDetails, { tool: TOOL, server: "perspicax_pulsatrix_flow_jc", args: ARGS, defaultOpen: true }));
    expect(open).toContain("Hide the full request");
    expect(open).toContain(TOOL);
    expect(open).toContain("perspicax_pulsatrix_flow_jc");
    expect(open).toContain('<span class="text-accent">&quot;conditions&quot;</span>');
    expect(open).toContain("Copy");
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(TechnicalDetails, { tool: TOOL, args: ARGS }));
    expect(html).toContain("Voir la demande complète");
  });
});

describe("composer panel and stepper", () => {
  const messages = [
    ask("a", TOOL, ARGS),
    ask("b", "mcp__perspicax_pulsatrix_flow_jc__cw_psa__write", JSON.stringify({ resource: "time/entries", operation: "create" })),
    ask("c", "mcp__claude_ai_Connectwise_PSA__cw_psa__query", JSON.stringify({ resource: "tickets" })),
  ];

  it("shows one request with a 1 of 3 stepper and the details collapsed", () => {
    setLocale("fr");
    const approvals = pendingApprovals(messages);
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: approvals[0]!, count: 3, index: 0, bot, onNext: () => {} }));
    expect(html).toContain("Cryptic veut consulter l&#x27;horaire dans ConnectWise PSA");
    expect(html).toContain("1 sur 3");
    expect(html).toContain('aria-label="Demande précédente"');
    // 2026-10-20 (JC): the details are folded under one short line
    expect(html).toContain('data-approval-preview="closed"');
    expect(html).not.toContain("Voir la demande complète");
    expect(html).not.toContain("conditions");
    expect(html).not.toContain("PENDING");
  });

  it("offers Allow all only for the read-only requests", () => {
    const approvals = pendingApprovals(messages);
    expect(readOnlyApprovals(approvals).map((pending) => pending.requestId)).toEqual(["req-a", "req-c"]);
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, {
      pending: approvals[1]!, count: 3, index: 1, bot,
      allowAllReadOnly: { count: 2, onAllow: () => {} },
    }));
    expect(html).toContain("2 of 3");
    expect(html).toContain("Allow all read-only (2)");
    expect(html).toContain("Makes changes");
  });

  it("never counts an admin-only or proposal card as read-only", () => {
    const admin = ask("d", TOOL, ARGS, { adminApproval: true });
    expect(readOnlyApprovals(pendingApprovals([admin]))).toEqual([]);
  });

  it("follows the picked request by id and falls back to the oldest", () => {
    const approvals = pendingApprovals(messages);
    expect(stepperIndex(approvals, "req-c")).toBe(2);
    expect(stepperIndex(approvals, "req-gone")).toBe(0);
    expect(stepperIndex(approvals, undefined)).toBe(0);
  });

  it("speaks the summary, never the raw JSON", () => {
    const [pending] = pendingApprovals([messages[0]!]);
    const spoken = spokenApprovalPrompt(pending!, "Cryptic");
    expect(spoken).toContain("Cryptic wants to view the schedule in ConnectWise PSA");
    expect(spoken).toContain("jcproulx");
    expect(spoken).not.toContain("conditions");
  });
});
