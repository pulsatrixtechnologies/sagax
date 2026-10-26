import { describe, expect, it } from "vitest";
import { rulesForBot, savedByLabel, type OwnerRuleRow } from "./OwnerPermissionsCard";

const row = (over: Partial<OwnerRuleRow>): OwnerRuleRow => ({ id: "r", botId: "bot-a", tool: "x__y", scope: {}, behavior: "allow", description: "d", ...over });

describe("the rules a bot meets", () => {
  it("lists the bot's own rules, then the ones for all my bots, never another bot's", () => {
    const rules = [
      row({ id: "all", botId: null, description: "a all" }),
      row({ id: "other", botId: "bot-b", description: "b" }),
      row({ id: "mine", botId: "bot-a", description: "z mine" }),
    ];
    expect(rulesForBot(rules, "bot-a").map((rule) => rule.id)).toEqual(["mine", "all"]);
  });
});

describe("a rule someone else kept on an admin's card of this bot", () => {
  it("names who saved it, never an id, and nothing for the person's own rule", () => {
    expect(savedByLabel(row({}))).toBeNull();
    expect(savedByLabel(row({ byOther: true, savedBy: "Alice" }))).toContain("Alice");
    const unnamed = savedByLabel(row({ byOther: true }));
    expect(unnamed).toBeTruthy();
    expect(unnamed).not.toMatch(/pr_|[0-9a-f]{8}-/);
  });
});
