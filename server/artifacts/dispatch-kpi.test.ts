import { describe, expect, it } from "vitest";

import {
  computeDispatchKpi, createDispatchKpiService, dispatchKpiDocument, dispatchRoutineMatches, localDate, localIso,
  parseDispatchKpiArgs, previousDate, snapshotFromDoc, type DispatchKpiArgs, type PerspicaxCall,
} from "./dispatch-kpi.ts";

// 2026-11-04 17:25 UTC = 12:25 in Toronto
const NOW = Date.UTC(2026, 10, 4, 17, 25, 0);

function args(over: Record<string, unknown> = {}): DispatchKpiArgs {
  const parsed = parseDispatchKpiArgs({ place: "team:team01", profile: "dispatch-view", time_zone: "America/Toronto", ...over });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** A fake Perspicax: answers by tool and records every call. */
function perspicax(options: { journal?: boolean; slaError?: boolean } = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const call: PerspicaxCall = async (tool, input) => {
    calls.push({ tool, args: input });
    if (tool === "identity_switch") return { isError: false, value: { profile: input.profile } };
    if (tool === "memory_find") {
      const tags = input.tags as string[];
      if (tags.includes("journal:2026-11-04")) return { isError: false, value: { entries: [{ id: "a", date: "2026-11-04" }, { id: "b", date: "2026-11-04" }] } };
      if (tags.includes("journal:2026-11-03")) return { isError: false, value: { entries: [{ id: "c", date: "2026-11-03" }] } };
      return { isError: false, value: { entries: [{ date: "2026-11-04" }, { date: "2026-10-14" }, { date: "2026-11-03" }] } };
    }
    if (tool === "flow") {
      if (!options.journal) return { isError: true, value: "params_invalid: command is catalog, describe or run_status" };
      const date = (input.args as { date: string }).date;
      if (input.command === "journal_summary") {
        return { isError: false, value: { status: "ok", command: "journal_summary", output: { ok: true, lines: date === "2026-11-04" ? 5 : 2, passes: { count: 1 }, changes_live_ok: { count: 3 }, anomalies: ["x"], days_with_journal: [date], revision: "r" } } };
      }
      return { isError: false, value: { status: "ok", output: { count: 2, lines: date === "2026-11-04" ? [{ ticket: 300 }, { ticket: 100 }] : [{ ticket: 100 }, { type: "pass" }] } } };
    }
    if (tool === "cw_psa_query") {
      if (input.resource === "calculateSla") {
        if (options.slaError) return { error: "Perspicax is unavailable" };
        return { isError: false, value: { items: [{ id: 100, isInSla: true }, { id: 300, isInSla: false }, { id: 299521, isInSla: true }], next: null } };
      }
      return { isError: false, value: { items: [{ id: 100, closedFlag: false, board: { id: 24 } }], next: null } };
    }
    return { error: `unexpected ${tool}` };
  };
  return { call, calls };
}

describe("dispatch KPI: args", () => {
  it("takes the place and defaults the rest", () => {
    const parsed = parseDispatchKpiArgs({ place: "team:abc" }, "America/Toronto");
    expect(parsed).toEqual({ ok: true, value: { place: "team:abc", timeZone: "America/Toronto", journalTag: "journal-dispatch", lessonsTag: "kb:dispatch", lessonsLimit: 20, doc: "docs/dispatch-kpi.md", refreshAfter: ["morning-dispatch", "dispatch"] } });
  });
  it("refuses what it cannot read", () => {
    expect(parseDispatchKpiArgs({})).toMatchObject({ ok: false });
    expect(parseDispatchKpiArgs({ place: "team:a", time_zone: "Mars/Base" })).toMatchObject({ ok: false });
    expect(parseDispatchKpiArgs({ place: "team:a", lessons_limit: 50 })).toMatchObject({ ok: false });
    expect(parseDispatchKpiArgs({ place: "team:a", doc: "../secrets.md" })).toMatchObject({ ok: false });
    expect(parseDispatchKpiArgs({ place: "team:a", extra: 1 })).toMatchObject({ ok: false, error: expect.stringContaining("extra") });
  });
  it("matches dispatch routines by prefix, never the old KPI routine", () => {
    expect(dispatchRoutineMatches("morning-dispatch-board-24-tn", ["morning-dispatch", "dispatch"])).toBe(true);
    expect(dispatchRoutineMatches("dispatch-midday", ["morning-dispatch", "dispatch"])).toBe(true);
    expect(dispatchRoutineMatches("dispatch-kpi-refresh", ["morning-dispatch", "dispatch"])).toBe(false);
    expect(dispatchRoutineMatches("hourly-new-tickets", ["morning-dispatch", "dispatch"])).toBe(false);
  });
  it("dates in the zone", () => {
    expect(localDate(NOW, "America/Toronto")).toBe("2026-11-04");
    expect(localDate(Date.UTC(2026, 10, 5, 3, 0), "America/Toronto")).toBe("2026-11-04");
    expect(previousDate("2026-03-01")).toBe("2026-02-28");
    expect(localIso(NOW, "America/Toronto")).toBe("2026-11-04T12:25:00-05:00");
    expect(localIso(Date.UTC(2026, 6, 1, 12, 0), "America/Toronto")).toBe("2026-07-01T08:00:00-04:00");
  });
});

describe("dispatch KPI: the snapshot", () => {
  it("counts from the Flow journal and checks SLA of the tickets it cites", async () => {
    const { call, calls } = perspicax({ journal: true });
    const snapshot = await computeDispatchKpi({ args: args(), call, now: NOW });
    expect(calls[0]).toEqual({ tool: "identity_switch", args: { profile: "dispatch-view" } });
    expect(snapshot).toMatchObject({
      generatedAt: "2026-11-04T12:25:00-05:00",
      profile: "dispatch-view",
      journalFlow: true,
      journalReason: null,
      journalCounts: { today: { lines: 5, anomalies: 1, days_with_journal: 1 }, yesterday: { lines: 2 } },
      memoryJournalToday: 2,
      memoryJournalYesterday: 1,
      lessonsListed: 3,
      lessonsPeriod: 2,
      lessonsLimitReached: false,
      period: { today: "2026-11-04", yesterday: "2026-11-03", timezone: "America/Toronto" },
      tickets: [100, 300],
      ticketsSource: "journal",
      slaCited: 2,
      slaCitedInSla: 1,
      ticketSla: [{ id: 100, isInSla: true, closed: false, board: 24 }, { id: 300, isInSla: false }],
    });
    expect(snapshot.journalCounts?.today).not.toHaveProperty("revision");
    // reads only, by id, minimal fields
    expect(calls.every((c) => ["identity_switch", "memory_find", "flow", "cw_psa_query"].includes(c.tool))).toBe(true);
    expect(calls.find((c) => c.args.resource === "calculateSla")?.args).toEqual({ resource: "calculateSla", filter: { id: { in: [100, 300] } }, fields: ["id", "isInSla"], limit: 2 });
  });

  it("leaves the journal KPIs null with the reason when Flow has no journal summary, and reuses the previous tickets", async () => {
    const { call } = perspicax({ journal: false });
    const snapshot = await computeDispatchKpi({ args: args(), call, now: NOW, previous: { tickets: [299521] } });
    expect(snapshot.journalFlow).toBe(false);
    expect(snapshot.journalCounts).toBeNull();
    expect(snapshot.journalReason).toContain("journal summary indisponible");
    expect(snapshot.tickets).toEqual([299521]);
    expect(snapshot.ticketsSource).toBe("previous");
    expect(snapshot.ticketSla).toEqual([{ id: 299521, isInSla: true }]);
  });

  it("never turns a failed read into 0", async () => {
    const { call } = perspicax({ journal: true, slaError: true });
    const failing: PerspicaxCall = async (tool, input) => tool === "memory_find" || tool === "identity_switch" ? { error: "denied" } : call(tool, input);
    const snapshot = await computeDispatchKpi({ args: args(), call: failing, now: NOW });
    expect(snapshot).toMatchObject({ profile: null, profileReason: expect.stringContaining("denied"), memoryJournalToday: null, lessonsListed: null, lessonsPeriod: null, slaCited: null, slaCitedInSla: null });
    expect(snapshot.slaCountReason).toContain("calculateSla");
  });

  it("round-trips through its document", async () => {
    const { call } = perspicax({ journal: true });
    const snapshot = await computeDispatchKpi({ args: args(), call, now: NOW });
    expect(snapshotFromDoc(dispatchKpiDocument(snapshot))).toEqual(snapshot);
    expect(snapshotFromDoc("# no block")).toBeNull();
  });
});

describe("dispatch KPI: the service", () => {
  it("caches, shares one computation, writes the doc only when the numbers change", async () => {
    let now = NOW;
    let sessions = 0;
    const writes: string[] = [];
    let doc = "";
    const { call } = perspicax({ journal: true });
    const service = createDispatchKpiService({
      session: async (_input, work) => { sessions += 1; return work(call); },
      readDoc: () => doc,
      writeDoc: (_bot, _path, text) => { writes.push(text); doc = text; },
      now: () => now,
      cacheMs: 60_000,
    });
    const input = { botId: "bot-a", principalId: "p1", args: args() };
    const [a, b] = await Promise.all([service.snapshot(input), service.snapshot(input)]);
    expect(a).toEqual(b);
    expect(sessions).toBe(1);
    expect(writes).toHaveLength(1);
    now += 30_000;
    await service.snapshot(input);
    expect(sessions).toBe(1);
    now += 60_000;
    await service.snapshot(input);
    expect(sessions).toBe(2);
    // same numbers, later time: no rewrite
    expect(writes).toHaveLength(1);
    await service.snapshot({ ...input, force: true });
    expect(sessions).toBe(3);
  });

  it("answers the session's error", async () => {
    const service = createDispatchKpiService({ session: async () => ({ error: "Perspicax is not available to this bot." }), readDoc: () => "", writeDoc: () => {} });
    expect(await service.snapshot({ botId: "b", principalId: "p", args: args() })).toEqual({ ok: false, error: "Perspicax is not available to this bot." });
  });
});
