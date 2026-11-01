import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineRunExchangeMessages, routineRunExchangeMeta, routineRunToExchange } from "./routine-run-exchange";

setLocale("en");

const bot = { id: "atlas", name: "Atlas", color: "blue" };
const routine = {
  id: "r1", botId: "atlas", name: "Morning brief", prompt: "Summarise overnight alerts.",
  target: "bot", runOn: "maus", durationMinutes: 30, enabled: true, createdAt: 1, updatedAt: 1,
  schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
} as Routine;
const run = {
  id: "run-1", routineId: "r1", routineName: "Morning brief", botId: "atlas", target: "bot",
  runOn: "maus", scheduledFor: Date.UTC(2026, 10, 1, 14, 0), createdAt: Date.UTC(2026, 10, 1, 14, 0),
  startedAt: Date.UTC(2026, 10, 1, 14, 0), finishedAt: Date.UTC(2026, 10, 1, 14, 2),
  status: "completed", manual: false, output: "Two alerts, both cleared.", cost: 0.02,
} as RoutineRun;

describe("routineRunToExchange", () => {
  it("builds a routine <-> bot header and opens with the instruction", () => {
    const exchange = routineRunToExchange({ run, routine, bot, detail: { steps: [], stepsTruncated: false, files: [], children: [], canStop: false } as never });
    expect(exchange.ends.map((party) => party.name)).toEqual(["Morning brief", "Atlas"]);
    expect(exchange.party.name).toBe("Atlas");
    expect(exchange.messages[0]?.text).toBe("Summarise overnight alerts.");
    expect(exchange.messages.at(-1)?.text).toBe("Two alerts, both cleared.");
    expect(JSON.stringify(exchange)).not.toMatch(/routine:r1|run-1/);
    expect(exchange.messages[0]?.from?.name).toBe("Morning brief");
    expect(exchange.messages[0]?.from?.botId).toBeUndefined();
  });

  it("keeps failed tool steps in the transcript", () => {
    const messages = routineRunExchangeMessages({
      run, routine, bot,
      detail: {
        steps: [{ id: "s1", name: "search", ok: false, at: run.startedAt!, summary: "timed out" }],
        stepsTruncated: false, files: [], children: [], canStop: false,
      } as never,
    });
    expect(messages.some((message) => message.kind === "activity" && message.tool?.ok === false)).toBe(true);
  });

  it("writes a quiet meta line without raw ids", () => {
    const meta = routineRunExchangeMeta(run, run.finishedAt);
    expect(meta).toContain("Completed");
    expect(meta).toMatch(/\$0\.02|0\.02/);
    expect(meta).not.toMatch(/run-1|r1|atlas/i);
  });
});
