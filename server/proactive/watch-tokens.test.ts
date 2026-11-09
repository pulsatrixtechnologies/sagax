// Template tokens of Pulsatrix Flow watches, resolved by the host (Flow #186).
import { describe, expect, it } from "vitest";

import { factTopics, factsOfReference, resolveWatchTokens, tokenValue, type WatchTokenContext } from "./watch-tokens.ts";

// Monday 2026-11-09 15:30:00 in Montreal (20:30 UTC)
const NOW = Date.UTC(2026, 10, 9, 20, 30, 0);
const facts: Record<string, unknown> = { "team.operator_login": "pat", "team.hr_board_id": 42, "team.urgent_priority_ids": [7, 8] };
const ctx: WatchTokenContext = { now: NOW, timeZone: "America/New_York", fact: (topic, key) => facts[`${topic}.${key}`] };

describe("watch tokens", () => {
  it("dates are local, without an offset", () => {
    expect(tokenValue("days_ago:1", ctx)).toBe("2026-11-08T00:00:00");
    expect(tokenValue("days_ahead:30", ctx)).toBe("2026-12-09T00:00:00");
    expect(tokenValue("months_ago:1", ctx)).toBe("2026-10-09T00:00:00");
    expect(tokenValue("hours_ago:4", ctx)).toBe("2026-11-09T11:30:00");
    expect(tokenValue("hours_ahead:2", ctx)).toBe("2026-11-09T17:30:00");
    expect(tokenValue("today_date_only", ctx)).toBe("2026-11-09T00:00:00Z");
  });

  it("the local day, not the UTC day, near midnight", () => {
    // 2026-11-10 02:00 UTC is still 2026-11-09 in Montreal
    const late = { ...ctx, now: Date.UTC(2026, 10, 10, 2, 0) };
    expect(tokenValue("days_ago:0", late)).toBe("2026-11-09T00:00:00");
  });

  it("a whole-token fact keeps its type; inside text a list is comma-separated", () => {
    const out = resolveWatchTokens({ board: "{{fact:team.hr_board_id}}", ids: { in: "{{fact:team.urgent_priority_ids}}" }, note: "by {{fact:team.operator_login}} ({{fact:team.urgent_priority_ids}})" }, ctx);
    expect(out).toEqual({ ok: true, value: { board: 42, ids: { in: [7, 8] }, note: "by pat (7, 8)" } });
  });

  it("tokens inside a JMESPath condition", () => {
    const out = resolveWatchTokens("length(items[?lastSeen <= '{{days_ago:30}}']) > `0`", ctx);
    expect(out).toEqual({ ok: true, value: "length(items[?lastSeen <= '2026-10-10T00:00:00']) > `0`" });
  });

  it("an unset fact or an unknown token is unresolved, never sent raw", () => {
    const out = resolveWatchTokens({ a: "{{fact:team.missing}}", b: "x {{company}}", c: "{{values:open_statuses.id}}" }, ctx);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.unresolved.sort()).toEqual(["{{company}}", "{{fact:team.missing}}", "{{values:open_statuses.id}}"]);
  });

  it("finds the fact topics a watch needs", () => {
    expect(factTopics([{ a: "{{fact:team.x}}", b: "{{fact:finance.y}}" }, "{{days_ago:1}}"])).toEqual(["finance", "team"]);
  });

  it("reads facts from a reference topic's tables; STOP is no fact", () => {
    const body = "# Team\n\n| Field | Value |\n| --- | --- |\n| operator login | `pat` |\n| hr_board_id | 42 |\n| urgent_priority_ids | 7, 8 |\n| status_waiting_name | STOP: not set |\n";
    const read = factsOfReference(body);
    expect(read.get("operator_login")).toBe("pat");
    expect(read.get("hr_board_id")).toBe(42);
    expect(read.get("urgent_priority_ids")).toEqual([7, 8]);
    expect(read.has("status_waiting_name")).toBe(false);
  });
});
