import { describe, expect, it } from "vitest";

import { carryAutoComputerMoves, selectAutoComputer, type AutoComputerState } from "./auto-computer.ts";
import { createAutoComputerStateFor } from "../index-leaves/autoComputerStateFor.ts";
import { createContinueComputerSelection } from "../index-leaves/continueComputerSelection.ts";
import { createInternalEnvironmentsRoutes } from "../routes/internal-environments.ts";

// #2763: the move ceiling of #2736 holds per request, whatever the tool
// (computer_select in Auto, or select_computer that ends the turn and
// continues the same request in a new one), and starts over on a new request.

const stateFor = createAutoComputerStateFor(() => ({
  IDENTITY: { kind: "perspicax" },
  workplacePreference: () => ({ routines: false }),
  desktopBridges: { connected: () => true },
  userSandbox: {},
}));
const freshTurn = (): AutoComputerState => stateFor(
  { principal: "pr_a", reason: "auto", target: "user-sandbox" }, { auto: true }, false, null, true,
);

const move = (state: AutoComputerState, target: string) => {
  const answer = selectAutoComputer(state, { target }, true);
  return { answer, state: answer.ok && answer.changed ? { ...state, selected: answer.target!, switches: (state.switches ?? 0) + 1 } : state };
};

describe("computer moves per request (#2763)", () => {
  it("every new request starts with no moves", () => {
    const first = freshTurn();
    expect(first.switches).toBeUndefined();
    let s = move(first, "this_computer").state;
    s = move(s, "cloud").state;
    expect(move(s, "this_computer").answer.ok).toBe(false);
    // the next request builds a new state: two moves again
    const next = freshTurn();
    expect(move(next, "this_computer").answer.ok).toBe(true);
  });

  it("a continuation turn keeps the moves already made: the third is refused", () => {
    const continuation = carryAutoComputerMoves(freshTurn(), 2);
    const third = move(continuation, "this_computer");
    expect(third.answer.ok).toBe(false);
    expect(third.answer.text).toContain("You already moved 2 times");
    const afterOne = carryAutoComputerMoves(freshTurn(), 1);
    const second = move(afterOne, "this_computer");
    expect(second.answer.ok).toBe(true);
    expect(move(second.state, "cloud").answer.ok).toBe(false);
  });

  it("ignores a missing or bogus carried count", () => {
    const base = freshTurn();
    expect(carryAutoComputerMoves(base, undefined)).toBe(base);
    expect(carryAutoComputerMoves(base, "3")).toBe(base);
    expect(carryAutoComputerMoves({ ...base, switches: 2 }, 1).switches).toBe(2);
  });

  it("select_computer counts as a move and is refused after two", async () => {
    const source: { generation: string; mounted: string; selected?: string; moves?: number } = { generation: "g1", mounted: "cloud" };
    let switches = 1;
    const selected: string[] = [];
    const deps = {
      bot: () => ({ id: "b1", threadId: "b1-t", computer: "auto" }),
      projectBotForTask: () => ({ id: "b1", threadId: "b1-t", computer: "auto" }),
      requireActive: () => undefined,
      computerSelection: () => source,
      selectionStillCurrent: () => true,
      setComputerSelected: (_t: string, _b: string, surface: string) => { source.selected = surface; selected.push(surface); },
      autoVmClaim: () => undefined,
      selectableComputers: async () => [
        { surface: "cloud", label: "Cloud", available: true, ready: true },
        { surface: "local", label: "This computer", available: true, ready: true },
      ],
      computerPreviewSurface: async () => "cloud",
      turnWorkplace: () => ({ generation: "g1", decision: { principal: "pr_a" }, auto: { ...freshTurn(), switches } }),
    };
    const route = createInternalEnvironmentsRoutes(deps as never);
    const post = async () => {
      const sent: { status: number; body: { error?: string; status?: string } }[] = [];
      await route({
        res: {} as never, path: "/api/internal/computer/select", method: "POST", url: new URL("http://x/"),
        json: ((_r: unknown, status: number, body: never) => { sent.push({ status, body }); }) as never,
        capability: { botId: "b1", threadId: "t1", generation: "g1" } as never,
        readBody: async () => ({ surface: "local" }),
      } as never);
      return sent[0]!;
    };
    const ok = await post();
    expect(ok.body.status).toBe("pending");
    expect(source.moves).toBe(2);

    source.selected = undefined;
    switches = 2;
    const refused = await post();
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("You already moved 2 times for this request");
    expect(selected).toEqual(["local"]);
  });

  it("the continuation turn is started with the request's moves", async () => {
    const selection = { generation: "g1", botId: "b1", selected: "local", moves: 2, previousSurface: "cloud", source: { id: "m1" }, text: "do it" };
    const turns = new Map([["t1", selection]]);
    const started: { opts: { computerMovesSoFar?: number; computerSelectionContinuation?: boolean } }[] = [];
    const host = {
      hasQueuedSteeredMessages: () => false,
      computerSelectionTurns: turns,
      computerSelectionMoves: new Map(),
      directTurnGenerationByThread: new Map([["t1", "g1"]]),
      store: {
        projectBotForTask: () => ({ id: "b1", computer: "auto" }),
        taskByThread: () => ({ surface: "cloud" }),
        activePath: () => [{ id: "m1", role: "user", kind: "text" }],
      },
      threadBusy: () => false,
      surfaceLabel: (s: string) => s,
      turnSpeakers: new Map(),
      startTurn: async (_bot: string, _text: string, opts: never) => { started.push({ opts }); },
    };
    const continueSelection = createContinueComputerSelection(() => host);
    expect(continueSelection("t1", "g1", true)).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toHaveLength(1);
    expect(started[0]!.opts.computerSelectionContinuation).toBe(true);
    expect(started[0]!.opts.computerMovesSoFar).toBe(2);
  });
});
