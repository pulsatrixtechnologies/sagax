import { describe, expect, it, vi } from "vitest";

const problems = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../org/org-problem-log.ts", () => ({
  appendProblem: async (_dir: string, row: Record<string, unknown>) => { problems.push(row); },
  problemReason: () => "failed",
}));

import { createReportIncident } from "./reportIncident.ts";

/** #3581: who hears of a failed turn depends on whose the thread is. */
function world(via?: "mcp" | "teammate" | "proactive" | "routine") {
  const nova = { id: "nova", name: "Nova", section: "team", threadId: "nova-main" };
  const chief = { id: "chief", name: "Chief", section: "team", threadId: "chief-main", chiefOfStaff: true };
  const turns: Array<{ botId: string; text: string }> = [];
  const appended: Array<{ threadId: string }> = [];
  const host = {
    store: {
      bots: [nova, chief],
      taskByThread: () => undefined,
      groupByThread: () => undefined,
      tasks: (botId: string) => botId === "chief" ? [{ threadId: "chief-incidents", title: "Team incidents" }] : [],
      createTask: () => ({ threadId: "chief-incidents" }),
      appendMessage: (threadId: string) => { appended.push({ threadId }); },
    },
    IDENTITY: { kind: "reference" },
    effectiveBotOwner: () => "person-1",
    latestFailedTurnCause: () => null,
    incidentContext: () => ({}),
    incidentLedger: { note: () => ({ muted: false, count: 1 }) },
    delegationWatch: new Set<string>(),
    coordinator: { assignerOf: () => undefined },
    threadBusy: () => false,
    botAtThreadCapacity: () => false,
    activeGroupTurnForBot: () => undefined,
    relayViaOf: (_botId: string, threadId: string) => threadId !== "nova-main" ? via : undefined,
    notify: vi.fn(),
    startTurn: async (botId: string, text: string) => { turns.push({ botId, text }); },
    incidentRefused: vi.fn(),
  };
  const reportIncident = createReportIncident(() => host);
  return { reportIncident, host, turns, appended, nova };
}

describe("reportIncident: who hears of a failure (#3581)", () => {
  it("a failed or stalled turn of an AI client's conversation starts no Primary Bot report; the problem log keeps it", () => {
    for (const kind of ["failed", "stalled"] as const) {
      problems.length = 0;
      const { reportIncident, host, turns, appended, nova } = world("mcp");
      reportIncident({ kind, bot: nova, threadId: "client-thread", detail: "the run ended without a result" });
      expect(turns).toEqual([]);
      expect(appended).toEqual([]);
      expect(host.notify).not.toHaveBeenCalled();
      expect(problems.map((row) => row.kind)).toEqual([kind]);
    }
  });

  it("a failed routine, a failed wake and a failed job a bot opened on itself still reach the Primary Bot", () => {
    const routine = world("routine");
    routine.reportIncident({ kind: "routine-failed", bot: routine.nova, threadId: "run-thread", detail: "Daily check: timeout", routine: { routineId: "r1" }, run: "routine" });
    expect(routine.turns.map((turn) => turn.botId)).toEqual(["chief"]);
    const wake = world("proactive");
    wake.reportIncident({ kind: "failed", bot: wake.nova, threadId: "wake-thread", detail: "the run ended without a result" });
    expect(wake.turns.map((turn) => turn.botId)).toEqual(["chief"]);
    const job = world("teammate");
    job.reportIncident({ kind: "failed", bot: job.nova, threadId: "job-thread", detail: "the run ended without a result" });
    expect(job.turns.map((turn) => turn.botId)).toEqual(["chief"]);
  });

  it("a failed turn in the person's own conversation still reports", () => {
    const { reportIncident, turns, nova } = world("mcp");
    reportIncident({ kind: "failed", bot: nova, threadId: "nova-main", detail: "the run ended without a result" });
    expect(turns.map((turn) => turn.botId)).toEqual(["chief"]);
  });
});
