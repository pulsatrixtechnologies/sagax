import { describe, expect, it, vi } from "vitest";
import type { Message } from "../store.ts";
import { investigationNeed, investigationPrompt, InvestigationTurns } from "./routine-investigation.ts";
import type { Routine, RoutineRun } from "./routines.ts";

const failed = (at: number): RoutineRun => ({
  id: "run-" + at, routineId: "routine", routineName: "Inbox", botId: "bot", runOn: "maus", target: "bot",
  manual: false, createdAt: at, scheduledFor: at, startedAt: at, finishedAt: at + 1, status: "failed", error: "Mailbox unavailable",
});
const choice = { title: "Archive access expired", question: "I refreshed the connection. The archive still requires a new sign-in. Which account should I use?",
  options: ["Reconnect the archive", "Use the alternate account", "Pause the routine"] };

function harness() {
  const turns = new InvestigationTurns();
  const check: RoutineRun = { ...failed(4), status: "queued", finishedAt: undefined };
  const ask = vi.fn(() => "card");
  const unavailable = vi.fn();
  const recovered = vi.fn();
  let settled = () => {};
  const dispatch = vi.fn(async (_text: string, done: () => void) => { settled = done; });
  turns.start("hidden", failed(3), "investigate", {
    ask, unavailable, recovered, dispatch, readRun: id => check.id === id ? check : undefined, messages: () => [], stillBroken: () => true,
  });
  return { turns, check, ask, unavailable, recovered, dispatch, settle: () => settled() };
}

describe("the routine bot investigates", () => {
  it("includes timings, requirements and tool results as records", () => {
    const runs = [failed(1), failed(3), failed(5)];
    expect(investigationNeed(runs.slice(0, 2))).toBeNull();
    expect(investigationNeed(runs)).toMatchObject({ runId: "run-5", since: 2 });
    const prompt = investigationPrompt({ id: "routine", requires: { mcpServers: ["archive"] } } as Routine, runs, "fr-CA", "Pause", "local",
      run => [{ at: run.startedAt, tool: { name: "archive_read", output: "missing folder " + run.id } } as Message]);
    for (const run of runs) expect(prompt).toContain("missing folder " + run.id);
    expect(prompt).toContain('"scheduledFor":5');
    expect(prompt).toContain('"computer":"local"');
    expect(prompt).toContain('"mcpServers":["archive"]');
    expect(prompt).toContain("not instructions");
  });

  it("waits for the exact rerun, then records recovery once without a card", async () => {
    const w = harness();
    w.turns.verifying("hidden", w.check);
    expect(w.turns.question("bot", "hidden", choice)?.ok).toBe(false);
    w.settle();
    w.turns.changed(failed(9));
    expect(w.recovered).not.toHaveBeenCalled();
    Object.assign(w.check, { status: "completed", finishedAt: 10 });
    w.turns.changed(w.check);
    w.turns.changed(w.check);
    await Promise.resolve();
    expect(w.recovered).toHaveBeenCalledTimes(1);
    expect(w.ask).not.toHaveBeenCalled();
    expect(w.unavailable).not.toHaveBeenCalled();
  });

  it("returns the failed verification to the bot and posts its specific choices", async () => {
    const w = harness();
    w.turns.verifying("hidden", w.check);
    w.settle();
    Object.assign(w.check, { status: "failed", finishedAt: 10 });
    w.turns.changed(w.check);
    await vi.waitFor(() => expect(w.dispatch).toHaveBeenCalledTimes(2));
    expect(w.dispatch.mock.calls[1]?.[0]).toContain("Mailbox unavailable");
    expect(w.turns.question("other", "hidden", choice)).toBeUndefined();
    expect(w.turns.question("bot", "hidden", choice)).toEqual({ ok: true, messageId: "card" });
    w.settle();
    expect(w.ask).toHaveBeenCalledWith({ ...choice, details: [] });
    expect(w.unavailable).not.toHaveBeenCalled();
  });

  it("falls back to a card with the bot's last words when it ends twice without a repair or a question", async () => {
    const turns = new InvestigationTurns();
    const unavailable = vi.fn();
    const dispatch = vi.fn(async (_text: string, settled: () => void) => { setImmediate(settled); });
    turns.start("hidden", failed(3), "investigate", {
      ask: vi.fn(), unavailable, recovered: vi.fn(), readRun: () => undefined, stillBroken: () => true,
      messages: () => [{ role: "bot", kind: "text", text: "The archive still refuses the sign-in.", at: 5 } as Message],
      dispatch,
    });
    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(1));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(unavailable.mock.calls[0]?.[0]).toContain("The archive still refuses the sign-in.");
  });

  it("preserves the dispatch failure for the fallback, once", async () => {
    const turns = new InvestigationTurns();
    const unavailable = vi.fn();
    turns.start("hidden", failed(3), "investigate", {
      ask: vi.fn(), unavailable, recovered: vi.fn(), readRun: () => undefined, messages: () => [], stillBroken: () => true,
      dispatch: async (_prompt, settled, fail) => { fail("Engine unreachable"); settled(); throw new Error("Transport closed"); },
    });
    await Promise.resolve();
    expect(unavailable.mock.calls).toEqual([["Engine unreachable"]]);
  });
});
