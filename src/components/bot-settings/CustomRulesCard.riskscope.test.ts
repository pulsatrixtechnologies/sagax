// 2026-10-22: the rule editor sets an allow rule's risk scope to what its
// words name, and refuses to save an allow rule that names a risky action
// (an external send, a payment, a deletion) while its class is unticked, so
// the UI never produces an empty-scope rule the person thinks is broad.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { compileRule, type CustomRuleBehavior, type RiskClass } from "../../../shared/custom-rules";
import { CustomRuleForm, missingImpliedRisks, type CustomRuleDraft } from "./CustomRulesCard";

const draft = (when: string, behavior: CustomRuleBehavior, riskScope: RiskClass[] = []): CustomRuleDraft => ({ when, behavior, allBots: false, riskScope });
const render = (initial: CustomRuleDraft) =>
  renderToStaticMarkup(createElement(CustomRuleForm, { botName: "Cora", initial, onCancel: vi.fn(), onSave: vi.fn() }))
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

beforeEach(() => setLocale("fr"));

describe("missingImpliedRisks (pure authoring guard)", () => {
  it("flags the risk class a risky allow rule leaves unticked, and nothing for a read or a non-allow rule", () => {
    expect(missingImpliedRisks("allow", compileRule("l'envoi de courriels"), [])).toEqual(["external-send"]);
    expect(missingImpliedRisks("allow", compileRule("l'envoi de courriels"), ["external-send"])).toEqual([]);
    expect(missingImpliedRisks("allow", compileRule("supprimer des fichiers"), [])).toEqual(["destructive"]);
    expect(missingImpliedRisks("allow", compileRule("payer les factures"), [])).toEqual(["money"]);
    expect(missingImpliedRisks("allow", compileRule("la lecture de fichiers"), [])).toEqual([]);
    // a deny/ask rule never needs a risk scope
    expect(missingImpliedRisks("deny", compileRule("l'envoi de courriels"), [])).toEqual([]);
    expect(missingImpliedRisks("ask", compileRule("l'envoi de courriels"), [])).toEqual([]);
  });
});

describe("CustomRuleForm refuses an empty-scope risky allow rule", () => {
  it("warns and disables Save when an allow rule names an external send with no class ticked", () => {
    const html = render(draft("l'envoi de courriels", "allow"));
    expect(html).toContain("data-custom-rule-risk-missing");
    expect(html).toContain("les envois externes");
    expect(html).toMatch(/type="submit" disabled=""/);
  });

  it("allows Save once the class is ticked, and never blocks a read rule", () => {
    const sendTicked = render(draft("l'envoi de courriels", "allow", ["external-send"]));
    expect(sendTicked).not.toContain("data-custom-rule-risk-missing");
    expect(sendTicked).not.toMatch(/type="submit" disabled=""/);
    const read = render(draft("la lecture de fichiers dans ~/Documents", "allow"));
    expect(read).not.toContain("data-custom-rule-risk-missing");
    expect(read).not.toMatch(/type="submit" disabled=""/);
  });
});
