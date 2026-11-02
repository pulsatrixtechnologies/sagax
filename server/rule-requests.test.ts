import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CustomRuleStore } from "./custom-rules-store.ts";
import { RuleRequestError, RuleRequestService, type OptionCardLike, type RuleRequestStore } from "./rule-requests.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(opts?: { alwaysAllow?: boolean; autoApply?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "omb-rule-req-"));
  dirs.push(dir);
  const rules = new CustomRuleStore(join(dir, "custom-approval-rules.json"));
  if (opts?.alwaysAllow === false) rules.setOrgAlwaysAllow(false);

  const bots = new Map([
    ["bot_a", { id: "bot_a", name: "Ottoline", ownerUserId: "person_a", color: "#111" }],
    ["bot_b", { id: "bot_b", name: "Quasar", ownerUserId: "person_a", color: "#222" }],
    ["bot_other", { id: "bot_other", name: "Other", ownerUserId: "person_b", color: "#333" }],
  ]);
  const threads = new Map<string, Array<{ id: string; card?: OptionCardLike }>>();
  let seq = 0;
  const store: RuleRequestStore = {
    bot: (id) => bots.get(id) ?? null,
    messagesFor: (threadId) => threads.get(threadId) ?? [],
    appendMessage: (threadId, message) => {
      const id = `m${++seq}`;
      const row = { id, card: message.card };
      const list = threads.get(threadId) ?? [];
      list.push(row);
      threads.set(threadId, list);
      return { id };
    },
    patchMessage: (threadId, messageId, patch) => {
      const list = threads.get(threadId) ?? [];
      const row = list.find((item) => item.id === messageId);
      if (!row) return null;
      row.card = patch.card;
      return { id: messageId };
    },
  };

  const service = new RuleRequestService({
    store,
    rules,
    ownerOf: (botId) => bots.get(botId)?.ownerUserId,
    autoApply: opts?.autoApply ? () => "full-access" : () => null,
  });
  return { service, rules, store, threads };
}

describe("RuleRequestService", () => {
  it("proposes an add card; Confirm creates the person's custom rule", () => {
    const { service, rules } = harness();
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "send any external email",
      behavior: "ask",
      reason: "You asked me to stop before outbound mail.",
    });
    expect(proposed.state).toBe("pending");
    expect(rules.ownRulesOf("person_a")).toHaveLength(0);

    const resolved = service.resolve({
      botId: "bot_a",
      threadId: "t1",
      requestId: proposed.requestId,
      behavior: "allow",
      personId: "person_a",
    });
    expect(resolved).toMatchObject({ claimed: true, state: "applied", action: "add" });
    const saved = rules.ownRulesOf("person_a");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      when: "send any external email",
      behavior: "ask",
      botId: "bot_a",
      ownerId: "person_a",
    });
  });

  it("Cancel leaves no rule", () => {
    const { service, rules } = harness();
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "delete production dashboards",
      behavior: "deny",
      reason: "Protect production.",
    });
    expect(service.resolve({
      botId: "bot_a", threadId: "t1", requestId: proposed.requestId, behavior: "deny", personId: "person_a",
    })).toMatchObject({ claimed: true, state: "denied" });
    expect(rules.ownRulesOf("person_a")).toHaveLength(0);
  });

  it("isolates people: another person cannot confirm or see the rule", () => {
    const { service, rules } = harness();
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "run shell installs",
      behavior: "ask",
      reason: "Ask first on installs.",
    });
    expect(service.resolve({
      botId: "bot_a", threadId: "t1", requestId: proposed.requestId, behavior: "allow", personId: "person_b",
    })).toMatchObject({ claimed: true, state: "invalid", status: 403 });
    expect(rules.ownRulesOf("person_a")).toHaveLength(0);
    expect(rules.ownRulesOf("person_b")).toHaveLength(0);

    expect(service.resolve({
      botId: "bot_a", threadId: "t1", requestId: proposed.requestId, behavior: "allow", personId: "person_a",
    })).toMatchObject({ claimed: true, state: "applied" });
    expect(rules.ownRulesOf("person_b")).toHaveLength(0);
    expect(rules.ownRulesOf("person_a")).toHaveLength(1);
  });

  it("refuses a rule for another person's bot", () => {
    const { service } = harness();
    expect(() => service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "read the other inbox",
      behavior: "allow",
      scopeBotId: "bot_other",
      reason: "Should not cross people.",
    })).toThrow(RuleRequestError);
  });

  it("org Deny / Ask rules stay locked and still win at list time", () => {
    const { service, rules } = harness();
    const org = rules.addOrgRule({ when: "send any external email", behavior: "deny" });
    expect(() => service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "remove",
      ruleId: org.id,
      reason: "Try to drop the org rule.",
    })).toThrow(/administrator|organization/i);

    // Person can still add their own allow; org deny remains in rulesOf.
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "send any external email",
      behavior: "allow",
      reason: "I trust this bot with mail.",
      riskScope: ["external-send"],
    });
    service.resolve({
      botId: "bot_a", threadId: "t1", requestId: proposed.requestId, behavior: "allow", personId: "person_a",
    });
    const effective = rules.rulesOf("person_a", "bot_a");
    expect(effective.some((rule) => rule.org && rule.behavior === "deny")).toBe(true);
    expect(effective.some((rule) => !rule.org && rule.behavior === "allow")).toBe(true);
  });

  it("org Always allow off blocks a new Allow rule", () => {
    const { service } = harness({ alwaysAllow: false });
    expect(() => service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "read files in Documents",
      behavior: "allow",
      reason: "Speed up reading.",
    })).toThrow(/Always allow/i);
  });

  it("change and remove update the existing personal rule", () => {
    const { service, rules } = harness();
    const existing = rules.add({
      ownerId: "person_a",
      botId: "bot_a",
      when: "read files in Documents",
      behavior: "ask",
    });
    const changed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "change",
      ruleId: existing.id,
      changes: { behavior: "allow", riskScope: [] },
      reason: "You confirmed reading is fine.",
    });
    expect(changed.state).toBe("pending");
    service.resolve({
      botId: "bot_a", threadId: "t1", requestId: changed.requestId, behavior: "Confirm", personId: "person_a",
    });
    expect(rules.get("person_a", existing.id)?.behavior).toBe("allow");

    const removed = service.submit({
      botId: "bot_a",
      threadId: "t2",
      action: "remove",
      ruleId: existing.id,
      reason: "No longer needed.",
    });
    service.resolve({
      botId: "bot_a", threadId: "t2", requestId: removed.requestId, behavior: "allow", personId: "person_a",
    });
    expect(rules.get("person_a", existing.id)).toBeUndefined();
  });

  it("Primary Bot quote applies ask/deny at once with no pending card", () => {
    const { service, rules } = harness();
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "change production dashboards",
      behavior: "ask",
      reason: "You said ask first on production.",
      primaryAsked: true,
    });
    expect(proposed.state).toBe("applied");
    expect(rules.ownRulesOf("person_a")).toHaveLength(1);
  });

  it("Full access alone does not auto-apply an Allow rule", () => {
    const { service, rules } = harness({ autoApply: true });
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "run npm test in the workspace",
      behavior: "allow",
      reason: "Speed up tests.",
    });
    expect(proposed.state).toBe("pending");
    expect(rules.ownRulesOf("person_a")).toHaveLength(0);
  });

  it("card subtitle names Ask first / Allow / Refuse for the DOM", () => {
    const { service, threads } = harness();
    const proposed = service.submit({
      botId: "bot_a",
      threadId: "t1",
      action: "add",
      when: "send any external email",
      behavior: "ask",
      reason: "Outbound mail needs you.",
    });
    const card = threads.get("t1")!.find((row) => row.card?.requestId === proposed.requestId)!.card!;
    expect(card.title).toBe("Add this approval rule?");
    expect(card.subtitle).toContain("Ask first");
    expect(card.subtitle).toContain("send any external email");
    expect(card.options).toEqual(["Confirm", "Cancel"]);
    expect(card.ruleRequest?.operation.action).toBe("add");
    expect(card.tool).toBe("propose_rule");
  });
});
