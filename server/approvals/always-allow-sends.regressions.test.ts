// 2026-11-06 (an owner, a bot posting on X: "I have chosen always allow it does not
// respect it and my bot is even in bypass mode"). Blocking regressions:
// a send tool's "Always allow" rule answers the next call, Bypass shows no
// card, an organization rule Demander d'abord still shows it, and every card
// offers "Always allow".
import { describe, expect, it } from "vitest";
import { autoVerdict } from "./auto-approve.ts";
import {
  cardRuleCandidate,
  destructiveKindOf,
  matchOwnerRule,
  ownerDecision,
  ownerVerdictOver,
  RULE_SITUATIONS,
  type OwnerRule,
  type RuleCall,
} from "./owner-approval.ts";

const OWNER = "owner@example.test";
const BOT = "bot-poster";
const POST = "mcp__X__create_posts";
const post = (text: string) => JSON.stringify({ text, reply: { in_reply_to_tweet_id: String(text.length * 7919) } });
const callOf = (input: string): RuleCall => ({ ownerId: OWNER, botId: BOT, tool: POST, input });

function savedFrom(input: string, situation: { from?: (typeof RULE_SITUATIONS)[number]; held?: boolean } = {}): OwnerRule {
  const candidate = cardRuleCandidate({ tool: POST, input }, situation);
  return {
    id: "r-always",
    ownerId: OWNER,
    botId: BOT,
    tool: candidate.tool,
    scope: candidate.scope,
    ...(candidate.destructive ? { destructive: candidate.destructive } : {}),
    ...(candidate.from ? { from: candidate.from } : {}),
    behavior: "allow",
    description: candidate.description,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("Always allow on a send tool (2026-11-06)", () => {
  it("the rule saved on the card answers the next post with other text, with no card", () => {
    // the engine connector flags the post as outward (connector-ask.ts):
    // the level's outbound guard holds it, the card offers Always allow
    const rule = savedFrom(post("first"));
    expect(rule.scope).toEqual({});
    expect(rule.destructive).toBe(destructiveKindOf({ tool: POST, input: post("first") }));
    const next = callOf(post("a different second post"));
    expect(matchOwnerRule([rule], next)?.id).toBe("r-always");
    for (const mode of ["approval", "auto", "bypass"] as const) {
      const decision = ownerDecision({ mode, rules: [rule], call: next });
      expect(decision).toMatchObject({ kind: "allow" });
      // the outbound guard of the level does not take the card back
      expect(ownerVerdictOver({ approve: null, source: "outbound-guard" }, decision, POST)?.approve).toBeTruthy();
    }
  });

  it("a rule saved on a held card or a turn that is not the person's own answers the next one of that kind", () => {
    for (const situation of [{ held: true, from: "hold" as const }, { from: "origin" as const }]) {
      const rule = savedFrom(post("first"), situation);
      const decision = ownerDecision({
        mode: "auto",
        rules: [rule],
        call: callOf(post("another")),
        ...(situation.from === "hold" ? { personMustAnswer: true } : { autonomyRefused: true }),
      });
      expect(decision).toMatchObject({ kind: "allow", source: "owner-rule" });
    }
  });

  it("the rule stays on this bot and this tool", () => {
    const rule = savedFrom(post("first"));
    expect(matchOwnerRule([rule], { ...callOf(post("x")), botId: "another-bot" })).toBeUndefined();
    expect(matchOwnerRule([rule], { ...callOf(post("x")), tool: "mcp__X__delete_posts" })).toBeUndefined();
  });

  it("the saved command or tool grant answers a send ahead of the outbound guard", () => {
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, POST, { outbound: true, toolAllowed: true }).approve).toBeTruthy();
      expect(autoVerdict(mode, POST, { outbound: true }).source).toBe("outbound-guard");
      expect(autoVerdict(mode, "mcp__gmail__send_email", { commandAllowed: true }).approve).toBeTruthy();
    }
  });
});

describe("Bypass shows no card (2026-11-06)", () => {
  it("a send on the person's behalf runs with no rule", () => {
    const decision = ownerDecision({ mode: "bypass", rules: [], call: callOf(post("hello")) });
    expect(decision).toEqual({ kind: "allow", source: "owner-bypass" });
    expect(ownerVerdictOver({ approve: null, source: "outbound-guard" }, decision, POST)).toMatchObject({ source: "owner-bypass" });
    expect(autoVerdict("full", POST, { outbound: true }).source).toBe("full-access");
    // a send a third party receives (mail, SMS) runs in Bypass too
    expect(ownerDecision({ mode: "bypass", rules: [], call: { ...callOf("{}"), tool: "mcp__gmail__send_email" } })).toEqual({ kind: "allow", source: "owner-bypass" });
  });
});

describe("an organization rule Demander d'abord still shows the card", () => {
  it("over Bypass, Full access and an Always allow", () => {
    const ask = { behavior: "ask" as const, id: "orule_ask" };
    const base = autoVerdict("full", POST, { outbound: true, customRule: ask, toolAllowed: true });
    expect(base).toEqual({ approve: null, source: "custom-rule-ask" });
    const bypass = ownerDecision({ mode: "bypass", rules: [savedFrom(post("first"))], call: callOf(post("next")) });
    expect(ownerVerdictOver(base, bypass, POST)).toEqual(base);
    const deny = autoVerdict("full", POST, { outbound: true, customRule: { behavior: "deny", id: "orule_deny" }, toolAllowed: true });
    expect(ownerVerdictOver(deny, bypass, POST)).toEqual(deny);
  });
});

describe("every card offers Always allow", () => {
  it("a send tool's card always has a rule candidate, in every situation", () => {
    const inputs = [post("hello"), "{}", "", JSON.stringify({ to: "a@b.c", body: "x" })];
    const tools = [POST, "mcp__gmail__send_email", "mcp__teams__send_message", "mcp__stripe__create_payment", "mcp__composio__GMAIL_SEND_DRAFT"];
    for (const tool of tools) {
      for (const input of inputs) {
        for (const situation of [{}, { held: true, from: "hold" as const }, { from: "origin" as const }, { from: "admin" as const }]) {
          const candidate = cardRuleCandidate({ tool, input }, situation);
          expect(candidate, `${tool} ${input} ${JSON.stringify(situation)}`).toBeDefined();
          expect(candidate.tool.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
