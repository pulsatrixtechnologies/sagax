import { describe, expect, it } from "vitest";
import { RoleJournal } from "./role-journal.ts";

describe("role journal", () => {
  it("keeps a composer pick for its person and turn only", () => {
    let now = 1_000;
    const journal = new RoleJournal(null, () => now);
    journal.pick("t", "alice", "service-desk");
    expect(journal.takePick("t", "bob")).toBeUndefined();
    journal.pick("t", "alice", "service-desk");
    expect(journal.takePick("t", "alice")).toBe("service-desk");
    expect(journal.takePick("t", "alice")).toBeUndefined();
    journal.pick("t", "alice", "");
    now += 11 * 60_000;
    expect(journal.takePick("t", "alice")).toBeUndefined();
  });

  it("applies a rule only for the bot owner, and stays when the thread said so", () => {
    const journal = new RoleJournal(null);
    journal.addRule("bot", { from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, path: "", ownerId: "owner" });
    expect(journal.fallbackFor({ threadId: "t", botId: "bot", principalId: "owner", ownerId: "owner", from: "service-desk", path: "time/entries" })).toBe("rule");
    // a bot delegated to someone else starts from the default
    expect(journal.fallbackFor({ threadId: "t", botId: "bot", principalId: "alice", ownerId: "owner", from: "service-desk", path: "time/entries" })).toBe("fallback");
    journal.stay("t", "service-desk");
    expect(journal.fallbackFor({ threadId: "t", botId: "bot", principalId: "owner", ownerId: "owner", from: "service-desk", path: "time/entries" })).toBe("stay");
    expect(journal.rulesFor("bot", "alice")).toEqual([]);
    expect(journal.removeRule("bot", "alice", journal.rulesFor("bot", "owner")[0]!.id)).toBe(false);
  });

  it("filters refusals and transitions to the asking person", () => {
    const journal = new RoleJournal(null);
    const permission = { path: "time/entries", module: "Time & Expense", func: "Time Entry", operation: "Inquire" as const };
    journal.logRefusal({ principalId: "alice", botId: "bot", threadId: "t", role: { slug: "service-desk", name: "Service Desk" }, tool: "x", kind: "read", permission });
    journal.logRefusal({ principalId: "bob", botId: "bot", threadId: "u", role: { slug: "service-desk", name: "Service Desk" }, tool: "x", kind: "read", permission });
    expect(journal.refusalsFor("alice", "bot")).toHaveLength(1);
    journal.logTransition({ principalId: "bob", botId: "bot", threadId: "u", from: { slug: "a", name: "A" }, to: { slug: "", name: "" }, reason: "fallback" });
    expect(journal.transitionsFor("alice", "bot", 7 * 86_400_000)).toEqual([]);
  });

  it("puts a step's role on its row, oldest first, within the turn", () => {
    const journal = new RoleJournal(null);
    const rows = [
      { id: "u", role: "user", kind: "text" },
      { id: "a", kind: "activity", tool: { name: "mcp__perspicax__cw_psa_find_tickets" } },
      { id: "b", kind: "activity", tool: { name: "mcp__perspicax__cw_psa_find_tickets" } },
    ];
    expect(journal.rowFor(rows, "cw_psa_find_tickets")?.id).toBe("a");
    journal.remember("t", "cw_psa_log_time", { slug: "", name: "", reason: "default" });
    expect(journal.takePending("t", "mcp__perspicax__cw_psa_log_time")).toMatchObject({ reason: "default" });
    expect(journal.advance("t", { slug: "", name: "" })).toBeUndefined();
    expect(journal.advance("t", { slug: "service-desk", name: "Service Desk" })).toEqual({ slug: "", name: "" });
  });
});
