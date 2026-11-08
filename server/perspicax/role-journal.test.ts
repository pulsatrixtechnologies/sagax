import { describe, expect, it } from "vitest";
import { readSwitchFingerprints } from "./role-events.ts";
import { RoleJournal } from "./role-journal.ts";

describe("role journal", () => {
  it("keeps a composer pick for its person and turn only", () => {
    let now = 1_000;
    const journal = new RoleJournal(null, () => now);
    journal.pick("t", "alice", "service-desk");
    expect(journal.takePick("t", "bob")).toBeUndefined();
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

  it("keeps each person's held roles and the ids learned, never across people", () => {
    const journal = new RoleJournal(null);
    journal.noteRoles("pr_alex", [{ slug: "service-desk", name: "Service Desk", id: "prof-desk" }]);
    journal.noteRoles("pr_alex", [{ slug: "service-desk", name: "Service Desk" }, { slug: "full-access", name: "Full Access" }]);
    journal.noteRoles("pr_sam", [{ slug: "full-access", name: "Full Access", id: "prof-full" }]);
    expect(journal.rolesOf("pr_alex").map((role) => [role.slug, role.id])).toEqual([["service-desk", "prof-desk"], ["full-access", undefined]]);
    expect(journal.rolesOf("pr_sam").map((role) => role.id)).toEqual(["prof-full"]);
    expect(journal.rolesOf("pr_nobody")).toEqual([]);
  });

  // #2581: a rule answers only for the role it names; a role refused for a
  // path is not offered for it again
  it("matches a read rule to its target role and remembers refused reads", () => {
    const journal = new RoleJournal(null);
    journal.addRule("bot", { from: { slug: "", name: "" }, to: { slug: "full-access", name: "Full Access" }, path: "time/entries", ownerId: "owner" });
    const base = { threadId: "t", botId: "bot", principalId: "owner", ownerId: "owner", from: "", path: "time/entries" };
    expect(journal.fallbackFor({ ...base, to: "full-access" })).toBe("rule");
    expect(journal.fallbackFor({ ...base, to: "service-desk" })).toBe("fallback");
    journal.logRefusal({ principalId: "owner", botId: "bot", threadId: "t", role: { slug: "service-desk", name: "Service Desk" }, tool: "cw_psa_find_time_entries", kind: "read", permission: { module: "Time & Expense", func: "Time Entries", path: "time/entries", operation: "Inquire" } });
    expect(journal.refusedRead({ principalId: "owner", botId: "bot", slug: "service-desk", path: "time/entries" })).toBe(true);
    expect(journal.refusedRead({ principalId: "owner", botId: "bot", slug: "full-access", path: "time/entries" })).toBe(false);
    expect(journal.refusedRead({ principalId: "alice", botId: "bot", slug: "service-desk", path: "time/entries" })).toBe(false);
  });

  // #2960: rules, journal entries and kept cards saved under a dotted path
  // (before 2026-11-08) still match the slashed path Sagax names now
  it("matches rules, refusals and kept cards saved under the older dotted path", () => {
    const journal = new RoleJournal(null);
    journal.addRule("bot", { from: { slug: "", name: "" }, to: { slug: "full-access", name: "Full Access" }, path: "service.tickets", ownerId: "owner" });
    const base = { threadId: "t", botId: "bot", principalId: "owner", ownerId: "owner", from: "" };
    expect(journal.fallbackFor({ ...base, path: "service/tickets", to: "full-access" })).toBe("rule");
    expect(journal.fallbackFor({ ...base, path: "service/tickets/notes", to: "full-access" })).toBe("rule");
    journal.logRefusal({ principalId: "owner", botId: "bot", threadId: "t", role: { slug: "service-desk", name: "Service Desk" }, tool: "cw_psa_query", kind: "read", permission: { module: "Service Desk", func: "Service Tickets", path: "service.tickets", operation: "Inquire" } });
    expect(journal.refusedRead({ principalId: "owner", botId: "bot", slug: "service-desk", path: "service/tickets" })).toBe(true);
    expect(journal.refusedRead({ principalId: "owner", botId: "bot", slug: "service-desk", path: "Service.Tickets" })).toBe(true);
    expect(readSwitchFingerprints("", "full-access", "service/tickets")).toEqual(["role-read-switch::full-access:service/tickets", "role-read-switch::full-access:service.tickets"]);
    expect(readSwitchFingerprints("", "full-access", "")).toEqual(["role-read-switch::full-access:"]);
  });
});
