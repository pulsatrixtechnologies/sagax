// #2080: filter chips and search over the unfolded approval rules list.
import { describe, expect, it } from "vitest";
import { myRulesInOrder, rulesPage } from "./MyApprovalRules";
import type { OwnerRuleRow } from "../bot-settings/OwnerPermissionsCard";

const rule = (partial: Partial<OwnerRuleRow> & Pick<OwnerRuleRow, "id" | "description" | "behavior">): OwnerRuleRow => ({
  tool: "files",
  scope: {},
  botId: null,
  ...partial,
});

describe("MyApprovalRules helpers (#2080)", () => {
  it("orders every-bot rules last", () => {
    const ordered = myRulesInOrder([
      rule({ id: "1", description: "B", behavior: "allow", botId: "b2" }),
      rule({ id: "2", description: "A", behavior: "deny", botId: null }),
      rule({ id: "3", description: "A", behavior: "ask", botId: "b1" }),
    ], (id) => id === "b1" ? "Alpha" : "Beta");
    expect(ordered.map((entry) => entry.id)).toEqual(["3", "1", "2"]);
  });

  it("pages a list for older callers", () => {
    expect(rulesPage([1, 2, 3, 4], 1, 2)).toEqual([2, 3]);
  });
});
