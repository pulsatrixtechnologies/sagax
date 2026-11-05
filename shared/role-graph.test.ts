import { describe, expect, it } from "vitest";

import { botClientName, buildRoleGraph, memberOfTarget, missingPermissions, type JournalRequestRow, type LocalTransition } from "./role-graph.ts";

const NOW = Date.UTC(2026, 10, 5, 18, 0);
const MIN = 60_000;
const desk = { slug: "service-desk", name: "Service Desk", id: "prof-desk" };
const full = { slug: "full-access", name: "Full Access", id: "prof-full" };
const iso = (at: number) => new Date(at).toISOString();
const row = (at: number, acting: string | null, extra: Partial<JournalRequestRow> = {}): JournalRequestRow => ({
  ts: iso(at), tool: "cw_psa_find_tickets", client_name: botClientName("nova"), mcp_session: "s1", acting_as: acting, outcome: "ok", ...extra,
});

describe("buildRoleGraph", () => {
  it("draws Moi and the held roles used, with seven-day transition counts from the journal", () => {
    const rows = [
      row(NOW - 50 * MIN, "prof-desk"),
      row(NOW - 49 * MIN, "prof-desk", { tool: "cw_psa_query", outcome: "error", error_code: "forbidden" }),
      row(NOW - 48 * MIN, null, { tool: "cw_psa_query" }),
      row(NOW - 47 * MIN, "prof-desk"),
      // another session: a second Service Desk to Moi
      row(NOW - 20 * MIN, "prof-desk", { mcp_session: "s2" }),
      row(NOW - 19 * MIN, null, { mcp_session: "s2" }),
    ];
    const graph = buildRoleGraph({ botId: "nova", roles: [desk, full], rows, local: [], now: NOW });
    expect(graph.journal).toBe("perspicax");
    expect(graph.nodes.map((node) => [node.slug, node.calls])).toEqual([["", 2], ["service-desk", 4]]);
    const toMe = graph.edges.find((edge) => edge.from === "service-desk" && edge.to === "")!;
    expect(toMe.count).toBe(2);
    expect(toMe.history[1]).toMatchObject({ source: "perspicax", refusedTool: "cw_psa_query" });
    expect(graph.edges.find((edge) => edge.from === "" && edge.to === "service-desk")!.count).toBe(1);
  });

  it("drops rows of another bot, of a profile not held, and older than the window", () => {
    const rows = [
      row(NOW - 10 * MIN, "prof-desk"),
      row(NOW - 9 * MIN, "prof-other"),
      row(NOW - 8 * MIN, null, { client_name: botClientName("atlas") }),
      row(NOW - 8 * 24 * 60 * MIN, null),
      row(NOW - 7 * MIN, "prof-desk"),
    ];
    const graph = buildRoleGraph({ botId: "nova", roles: [desk], rows, local: [], now: NOW });
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((node) => node.slug)).toEqual(["", "service-desk"]);
    expect(graph.nodes.find((node) => node.slug === "service-desk")!.calls).toBe(2);
    expect(JSON.stringify(graph)).not.toContain("prof-other");
  });

  it("merges Sagax's own transition (reason, thread) with the journal's within two minutes", () => {
    const rows = [row(NOW - 30 * MIN, "prof-desk"), row(NOW - 29 * MIN, null, { tool: "cw_psa_query" })];
    const local: LocalTransition[] = [
      { id: "t1", at: NOW - 29 * MIN + 20_000, threadId: "th-1", from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, reason: "fallback", refusedTool: "cw_psa_query" },
      { id: "t2", at: NOW - 5 * MIN, threadId: "th-2", from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, reason: "rule" },
    ];
    const graph = buildRoleGraph({ botId: "nova", roles: [desk], rows, local, now: NOW });
    const edge = graph.edges[0]!;
    expect(edge.count).toBe(1);
    expect(edge.history).toEqual([
      { at: NOW - 5 * MIN, source: "sagax", threadId: "th-2", reason: "rule" },
      { at: NOW - 29 * MIN + 20_000, source: "both", threadId: "th-1", reason: "fallback", refusedTool: "cw_psa_query", tool: "cw_psa_query" },
    ]);
  });

  it("uses the local journal alone when Perspicax did not answer", () => {
    const local: LocalTransition[] = [
      { id: "t1", at: NOW - 3 * MIN, threadId: "th-1", from: { slug: "", name: "" }, to: { slug: "full-access", name: "Full Access" }, reason: "switch" },
      { id: "t2", at: NOW - 2 * MIN, threadId: "th-1", from: { slug: "", name: "" }, to: { slug: "full-access", name: "Full Access" }, reason: "switch" },
    ];
    const graph = buildRoleGraph({ botId: "nova", roles: [], rows: null, local, now: NOW });
    expect(graph.journal).toBe("local");
    expect(graph.edges).toMatchObject([{ from: "", to: "full-access", count: 2 }]);
    expect(graph.nodes.map((node) => [node.slug, node.name])).toEqual([["", ""], ["full-access", "Full Access"]]);
  });
});

describe("missingPermissions", () => {
  it("groups by role and CW permission, newest first, member from cw_member", () => {
    const permission = { module: "Time & Expense", func: "Time Entry", path: "time/entries", operation: "Add" as const };
    const missing = missingPermissions([
      { id: "r1", at: 1, role: { slug: "service-desk", name: "Service Desk" }, tool: "cw_psa_log_time", kind: "write", permission, target: "cw_member:nova" },
      { id: "r2", at: 5, role: { slug: "service-desk", name: "Service Desk" }, tool: "cw_psa_write", kind: "write", permission },
      { id: "r3", at: 3, role: { slug: "", name: "" }, tool: "cw_psa_query", kind: "read", permission: { ...permission, operation: "Inquire" } },
    ]);
    expect(missing).toEqual([
      { id: "r2", role: { slug: "service-desk", name: "Service Desk" }, permission, kind: "write", member: "nova", tools: ["cw_psa_write", "cw_psa_log_time"], lastAt: 5, count: 2 },
      { id: "r3", role: { slug: "", name: "" }, permission: { ...permission, operation: "Inquire" }, kind: "read", tools: ["cw_psa_query"], lastAt: 3, count: 1 },
    ]);
    expect(memberOfTarget("cw_member:")).toBeUndefined();
    expect(memberOfTarget("other:1")).toBeUndefined();
  });
});
