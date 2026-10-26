import { describe, expect, it, vi } from "vitest";

import { callFacts, type CustomRule } from "../shared/custom-rules.ts";
import { createCustomRulesModelReviewer, type ModelReviewCard, type ModelReviewDeps } from "./custom-rules-model.ts";

let seq = 0;
function rule(when: string, behavior: CustomRule["behavior"], extra: Partial<CustomRule> = {}): CustomRule {
  seq += 1;
  return { id: `r${seq}`, ownerId: "jc", botId: null, when, behavior, riskScope: [], enabled: true, createdAt: seq, updatedAt: seq, ...extra };
}

const input = JSON.stringify({ resource: "tickets", id: 12, summary: "Sagax" });
const facts = callFacts({ tool: "mcp__perspicax_gox__cw_psa__write", input, home: "/Users/jc" });
const free = rule("tout ce qui touche au projet Sagax", "allow");
const freeDeny = rule("toucher aux factures du client Acme", "deny");
const freeAsk = rule("changer un billet fermé", "ask");

function card(rules: CustomRule[] = [free], extra: Partial<ModelReviewCard> = {}): ModelReviewCard {
  return { threadId: "t1", requestId: "q1", botId: "b1", instanceId: "claude", rules, local: { kind: "none" }, facts, call: { tool: facts.tool, input, summary: "Update ticket 12" }, language: "fr", ...extra };
}

function harness(reply: string | (() => Promise<string>), extra: Partial<ModelReviewDeps> = {}) {
  const review = vi.fn<(prompt: string, signal?: AbortSignal) => Promise<string>>(typeof reply === "string" ? async () => reply : reply);
  const deliver = vi.fn(async () => true);
  const settle = vi.fn();
  const deps: ModelReviewDeps = { reviewer: () => review, stillOpen: () => true, deliver, settle, ...extra };
  return { reviewer: createCustomRulesModelReviewer(deps), review, deliver, settle };
}

const allowReply = JSON.stringify({ decision: "allow", rule: "R1", reason: "Le billet est dans le projet Sagax." });

describe("the model reviewer of custom rules", () => {
  it("approves a card its rule covers, through the engine, with the reason on the card", async () => {
    const { reviewer, deliver, settle, review } = harness(allowReply);
    const verdict = await reviewer.reviewCard(card());
    expect(verdict).toMatchObject({ kind: "allow", rule: free, reason: "Le billet est dans le projet Sagax." });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ requestId: "q1" }), "allow", undefined);
    expect(settle).toHaveBeenCalledWith(expect.anything(), verdict, expect.objectContaining({ outcome: "approved", reviewer: "model", reason: "Le billet est dans le projet Sagax.", id: free.id }));
    // the prompt carries the rule and the call as untrusted data
    expect(review.mock.calls[0]![0]).toContain("R1 ALLOW: tout ce qui touche au projet Sagax");
    expect(review.mock.calls[0]![0]).toContain('<<<UNTRUSTED source="tool-call">>>');
  });

  it("refuses with its rule, and holds an ask without answering", async () => {
    const deny = harness(JSON.stringify({ decision: "deny", rule: "R1", reason: "Factures Acme." }));
    expect(await deny.reviewer.reviewCard(card([freeDeny]))).toMatchObject({ kind: "deny", rule: freeDeny });
    expect(deny.deliver).toHaveBeenCalledWith(expect.anything(), "deny", expect.stringContaining("automatic review"));
    const ask = harness(JSON.stringify({ decision: "ask", rule: "R1", reason: "Billet fermé." }));
    expect(await ask.reviewer.reviewCard(card([freeAsk]))).toMatchObject({ kind: "ask" });
    expect(ask.deliver).not.toHaveBeenCalled();
    expect(ask.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "ask" }), expect.objectContaining({ outcome: "held" }));
  });

  it("leaves the card alone when unsure, failing, slow, without a reviewer or rules", async () => {
    for (const reply of ['{"decision":"none"}', "not json", () => Promise.reject(new Error("down"))]) {
      const { reviewer, deliver, settle } = harness(reply as string);
      expect(await reviewer.reviewCard(card())).toEqual({ kind: "none" });
      expect(deliver).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    }
    const slow = harness((() => new Promise<string>(() => {})) as () => Promise<string>, { timeoutMs: 20 });
    expect(await slow.reviewer.reviewCard(card())).toEqual({ kind: "none" });
    const none = harness(allowReply, { reviewer: () => undefined });
    expect(await none.reviewer.reviewCard(card())).toEqual({ kind: "none" });
    const empty = harness(allowReply);
    expect(await empty.reviewer.reviewCard(card([]))).toEqual({ kind: "none" });
    expect(empty.review).not.toHaveBeenCalled();
  });

  it("never asks the model about a card the matcher decided", async () => {
    const { reviewer, review } = harness(allowReply);
    await reviewer.reviewCard(card([free], { local: { kind: "ask", rule: freeAsk } }));
    await reviewer.reviewCard(card([free], { local: { kind: "none", riskBlocked: { rule: free, missing: ["money"] } } }));
    expect(review).not.toHaveBeenCalled();
  });

  it("does not answer a card the person answered meanwhile, nor settle one the engine refused", async () => {
    const answered = harness(allowReply, { stillOpen: () => false });
    expect(await answered.reviewer.reviewCard(card())).toEqual({ kind: "none" });
    expect(answered.deliver).not.toHaveBeenCalled();
    const gone = harness(allowReply, { deliver: vi.fn(async () => false) });
    expect(await gone.reviewer.reviewCard(card())).toEqual({ kind: "none" });
    expect(gone.settle).not.toHaveBeenCalled();
  });

  it("reviews the same card text once (cache and one call in flight), and again when a rule changes", async () => {
    let now = 0;
    const { reviewer, review } = harness(allowReply, { now: () => now });
    await Promise.all([reviewer.judge(card()), reviewer.judge(card())]);
    await reviewer.judge(card([free], { requestId: "q2" }));
    expect(review).toHaveBeenCalledTimes(1);
    await reviewer.judge(card([{ ...free, when: "tout le projet Sagax" }]));
    expect(review).toHaveBeenCalledTimes(2);
    now = 11 * 60_000;
    await reviewer.judge(card());
    expect(review).toHaveBeenCalledTimes(3);
  });

  it("an organization rule is judged first and never allows", async () => {
    const orgAsk = rule("modifier des billets ConnectWise", "ask", { org: true, ownerId: "org" });
    const { reviewer, review, deliver } = harness(JSON.stringify({ decision: "allow", rule: "R1", reason: "x" }));
    expect(await reviewer.reviewCard(card([free, orgAsk]))).toEqual({ kind: "none" });
    expect(review.mock.calls[0]![0]).toMatch(/R1 ORG ASK[^\n]*\nR2 ALLOW/);
    expect(deliver).not.toHaveBeenCalled();
  });
});
