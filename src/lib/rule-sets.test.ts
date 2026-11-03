// The client half of the rule sets: the budgets kept equal to the server's,
// the total with unsaved drafts, and a move in the order.
import { describe, expect, it } from "vitest";

import * as server from "../../server/rules/rule-sets.ts";
import {
  RULE_SET_MAX_BYTES,
  RULE_SET_MAX_LINES,
  RULE_SET_NAME_MAX,
  RULE_SETS_MAX,
  RULES_TOTAL_MAX_BYTES,
  RULES_TOTAL_MAX_LINES,
  holdsRules,
  measureRules,
  moved,
  totalWithDrafts,
  type RuleSetWire,
} from "./rule-sets";

const set = (id: string, text: string, enabled = true): RuleSetWire => ({
  id, name: id, enabled, file: `rules/${id}.md`, text, hash: "h", exists: true, lines: 0, bytes: 0, over: false, loads: enabled,
});

describe("rule sets (client)", () => {
  it("keeps the budgets equal to the server's", () => {
    expect(RULE_SET_MAX_LINES).toBe(server.RULES_MAX_LINES);
    expect(RULE_SET_MAX_BYTES).toBe(server.RULES_MAX_BYTES);
    expect(RULES_TOTAL_MAX_LINES).toBe(server.RULES_TOTAL_MAX_LINES);
    expect(RULES_TOTAL_MAX_BYTES).toBe(server.RULES_TOTAL_MAX_BYTES);
    expect(RULE_SETS_MAX).toBe(server.RULE_SETS_MAX);
    expect(RULE_SET_NAME_MAX).toBe(server.RULE_SET_NAME_MAX);
  });

  it("measures what loads, like the server", () => {
    const raw = "# Emails\n\n<!-- note -->\n- Sign every email.\n";
    expect(measureRules(raw)).toEqual(server.measureRules(raw));
    expect(holdsRules(server.RULES_TEMPLATE)).toBe(false);
    expect(holdsRules(raw)).toBe(true);
  });

  it("adds up the sets that are on, drafts in place of what is saved", () => {
    const sets = [set("a", "- one\n- two\n"), set("b", "- three\n", false), set("c", "# Heading only\n")];
    expect(totalWithDrafts(sets, {}).lines).toBe(2);
    expect(totalWithDrafts(sets, { a: "- one\n" }).lines).toBe(1);
    expect(totalWithDrafts(sets, { c: "# Heading\n- rule\n" }).lines).toBe(4);
  });

  it("moves one set up or down, never past an end", () => {
    expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b"], 0, -1)).toBeNull();
    expect(moved(["a", "b"], 1, 1)).toBeNull();
  });
});
