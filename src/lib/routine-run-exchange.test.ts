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

  // #3581: Details opens the whole report, never the record's 2,000 characters
  it("ends with the whole report when the single-run read gave it", () => {
    const whole = `${"Line. ".repeat(500)}Closing line.`;
    const exchange = routineRunToExchange({ run: { ...run, output: whole.slice(0, 2_000), report: whole }, routine, bot });
    expect(exchange.messages.at(-1)?.text).toBe(whole);
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

  // #4437: "Pourquoi le texte de la bulle s'update ... ça devrait plutôt en
  // écrire plusieurs": each text the run's turn wrote is its own bubble
  describe("#4437: every text of the run is its own bubble, in order", () => {
    const t0 = run.startedAt!;
    const steps = [
      { id: "s1", name: "Read", ok: true, at: t0 + 2_000 },
      { id: "s2", name: "Grep", ok: true, at: t0 + 6_000 },
    ];
    const said = [
      { id: "m1", text: "Reading the overnight alerts first.", at: t0 + 1_000 },
      { id: "m2", text: "Two alerts, I am checking whether they cleared.", at: t0 + 4_000 },
    ];
    const detail = (extra: object = {}) => ({ steps, said, stepsTruncated: false, files: [], children: [], canStop: false, ...extra }) as never;
    const shape = (messages: ReturnType<typeof routineRunExchangeMessages>) =>
      messages.map((message) => message.kind === "activity" ? `step:${message.tool?.name}` : message.text);

    it("while the run goes: each text stays, the steps between them, never one bubble rewritten", () => {
      const live = { ...run, status: "running", finishedAt: undefined, output: said[1]!.text } as RoutineRun;
      expect(shape(routineRunExchangeMessages({ run: live, routine, bot, detail: detail() }))).toEqual([
        "Summarise overnight alerts.",
        said[0]!.text,
        "step:Read",
        said[1]!.text,
        "step:Grep",
      ]);
    });

    it("once it ends: the texts stay and the report closes the conversation once", () => {
      const final = { id: "m3", text: "Two alerts, both cleared.", at: t0 + 8_000, final: true };
      const messages = routineRunExchangeMessages({ run, routine, bot, detail: detail({ said: [...said, final] }) });
      expect(shape(messages)).toEqual([
        "Summarise overnight alerts.",
        said[0]!.text,
        "step:Read",
        said[1]!.text,
        "step:Grep",
        "Two alerts, both cleared.",
      ]);
      expect(JSON.stringify(messages)).not.toMatch(/"m1"|"m2"|"m3"/);
    });

    it("a finished run whose newest text has no final mark draws it once, as the report", () => {
      const last = { id: "m3", text: "Two alerts, both cleared.", at: t0 + 8_000 };
      const messages = routineRunExchangeMessages({ run, routine, bot, detail: detail({ said: [...said, last] }) });
      expect(messages.filter((message) => message.text === "Two alerts, both cleared.")).toHaveLength(1);
    });
  });

  it("writes a quiet meta line without raw ids", () => {
    const meta = routineRunExchangeMeta(run, run.finishedAt);
    expect(meta).toContain("Completed");
    expect(meta).toMatch(/\$0\.02|0\.02/);
    expect(meta).not.toMatch(/run-1|r1|atlas/i);
  });
});
