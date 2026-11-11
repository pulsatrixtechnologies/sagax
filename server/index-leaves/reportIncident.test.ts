import { describe, expect, it, vi } from "vitest";

const problems = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../org/org-problem-log.ts", () => ({
  appendProblem: async (_dir: string, row: Record<string, unknown>) => { problems.push(row); },
  problemReason: () => "failed",
}));

import { createReportIncident } from "./reportIncident.ts";

/** #3480: a quiet bot's failed routine reaches the person through nothing. */
function world(quiet: boolean) {
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
    botQuietMode: (botId: string) => quiet && botId === "nova",
    notify: vi.fn(),
    startTurn: async (botId: string, text: string) => { turns.push({ botId, text }); },
    incidentRefused: vi.fn(),
  };
  const reportIncident = createReportIncident(() => host);
  return { reportIncident, host, turns, appended, nova };
}

describe("reportIncident and quiet mode (#3480)", () => {
  it("a quiet bot's failed routine starts no Primary Bot turn and rings nothing; the problem log keeps it", () => {
    problems.length = 0;
    const { reportIncident, host, turns, appended, nova } = world(true);
    reportIncident({ kind: "routine-failed", bot: nova, threadId: "run-thread", detail: "Daily check: timeout", routine: { routineId: "r1" }, run: "routine" });
    expect(turns).toEqual([]);
    expect(appended).toEqual([]);
    expect(host.notify).not.toHaveBeenCalled();
    expect(problems.map((row) => row.kind)).toEqual(["routine-failed"]);
  });

  it("quiet mode off, the Primary Bot hears of the failed routine as before", () => {
    problems.length = 0;
    const { reportIncident, turns, nova } = world(false);
    reportIncident({ kind: "routine-failed", bot: nova, threadId: "run-thread", detail: "Daily check: timeout", routine: { routineId: "r1" }, run: "routine" });
    expect(turns.map((turn) => turn.botId)).toEqual(["chief"]);
  });
});
