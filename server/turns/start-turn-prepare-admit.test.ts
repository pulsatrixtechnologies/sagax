import { describe, expect, it, vi } from "vitest";
import { effortForModel } from "../../shared/model-capabilities.ts";
import { routineTurnEffort } from "../../shared/routine-effort.ts";
import { effortAcceptedByEngine, resolveEngineTurnEffort } from "../../shared/ultracode-effort.ts";
import { createConnectorPlanForTurn } from "../connectors/turn-plan.ts";
import { createPrepareAdmitStartTurn } from "./start-turn-prepare-admit.ts";
import { createDispatchStartTurn } from "./start-turn-dispatch.ts";
import { createTurnState } from "./start-turn-state.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { SendTurnInput } from "../contracts.ts";

describe("routine effort at turn admission and dispatch", () => {
  function fixture(driverKind = "codex") {
    const selection = { instanceId: "engine", model: "chat-model", effort: "high" as const };
    const bot = { id: "bot", name: "Runner", modelSelection: selection as typeof selection & { fast?: { instanceId: string; model: string } } };
    const sendTurn = vi.fn(async (_input: SendTurnInput) => ({}));
    const instance = { instanceId: "engine", driverKind, models: { options: [{ id: "chat-model" }, { id: "routine-model" }] },
      adapter: { capabilities: { effortLevels: ["low", "high"] }, sendTurn } };
    let routine = true;
    let takenOver = false;
    let routineSubagent: string | null = null;
    const receipt = new Map();
    const noOp = vi.fn();
    // Turn setup gives every turn its connector plan (start-turn-setup.ts,
    // #3368); this fixture skips setup, so it computes the plan the same way.
    const connectorPlanForTurn = createConnectorPlanForTurn<typeof bot & { toolScope?: unknown }, typeof instance>({
      accountConnectorInput: (_bot, engine, speaker) => ({ identity: "solo", restrictedByPolicy: false, driver: engine.driverKind, instanceId: engine.instanceId, speaker, ownerPrincipalId: "", localPrincipalId: "" }),
      withholdHostToolsFor: () => false,
    });
    const values: Record<string, unknown> = {
      IDENTITY: { kind: "solo" }, cfg: {}, turnStartLogLine: () => "fixture turn", voiceLatency: { mark: noOp },
      extractTurnImages: (text: string) => ({ text, images: [], videos: [] }), promptWithDataContext: (text: string) => text,
      quietTurnThreads: new Set(), autoTurnsByThread: new Map(), turnRunByThread: receipt, turnModelRequested: new Map(), turnRunFor: (value: unknown) => value,
      effortAcceptedByEngine, effortForModel, resolveEngineTurnEffort,
      routineModelForTurn: () => routine && !takenOver ? { model: "routine-model" } : null,
      routineSubagentModelForTurn: () => routineSubagent && !takenOver ? { model: routineSubagent } : null,
      routineEffortForTurn: (_botId: string, _threadId: string, engine: typeof instance) => routineTurnEffort({
        effort: routine ? "low" : undefined, botInstanceId: "engine", turnInstanceId: engine.instanceId,
        takenOver, levels: ["low", "high"],
      }),
      store: { activePath: () => [], appendMessage: noOp, isConfidentialThread: () => false },
      coordinator: { answer: () => false }, voiceCalls: { active: () => false }, resolveTurnSpeaker: () => ({ origin: "owner-routine" }),
      remoteComputerForTurn: () => ({}), turnWorksOn: () => ({}), decideWorkplace: () => ({ principal: "person" }),
      workplaceTurnText: (text: string) => ({ text }), withWorkplaceNote: (text: string) => text,
      handoffs: { dispatching: noOp }, directTurnClaimIsCurrent: () => true, directTurnClaimExists: () => true,
      fitTurnImagesForModel: async () => [], botRecoveryBackups: () => [],
      withDesktopModelPerson: (_person: unknown, work: () => unknown) => work(), runAsBotEngine: (_botId: string, work: () => unknown) => work(),
      guardTurnDispatch: (work: unknown) => work, withRecalled: (_recalled: unknown, text: string) => text,
      savedSteps: { dispatch: { sendTurn: (_engine: unknown, _replay: unknown, input: SendTurnInput, dispatch: (input: SendTurnInput) => unknown) => dispatch(input) } },
      managedPolicy: { restrictsMcp: () => false }, connectorPlanForTurn,
    };
    const host = new Proxy(values, { get: (target, key: string) => target[key] ?? noOp }) as unknown as StartTurnHost;
    async function turn() {
      const state = createTurnState({ botId: bot.id, text: "Do the task", opts: { cardContinuation: true }, startTurn: async () => {} });
      Object.assign(state, { bot, instance, threadId: "thread", answer: {}, plan: {}, activeMessages: [], transcript: [], tagged: [], contextOrder: [],
        integrations: {}, dispatchContext: { turnText: "Do the task", handoff: {} }, prompt: { text: "", stable: "", volatile: "" } });
      state.connectorPlan = connectorPlanForTurn(bot, instance, { origin: "owner-routine" }, "thread");
      const claim = vi.fn(() => ({ kind: "continue" as const }));
      await createPrepareAdmitStartTurn(host, claim)(state);
      expect(claim).toHaveBeenCalledOnce();
      await createDispatchStartTurn(host)(state);
      return sendTurn.mock.calls.at(-1)![0];
    }
    return {
      turn, bot, selection, receipt,
      setRoutine: (value: boolean) => { routine = value; },
      setRoutineSubagent: (value: string | null) => { routineSubagent = value; },
      takeover: () => { takenOver = true; },
    };
  }

  it.each(["codex", "claudeAgent"])("sends low routine effort to %s and its sub-agents; chat keeps the bot's settings", async (driver) => {
    const f = fixture(driver);
    expect(await f.turn()).toMatchObject({ model: "routine-model", effort: "low", subagentEffort: "low", subagentModel: "routine-model" });
    expect(f.receipt.get("thread")).toMatchObject({ model: "routine-model", effort: "low" });
    expect(f.bot.modelSelection).toBe(f.selection);
    f.setRoutine(false);
    const chat = await f.turn();
    expect(chat).toMatchObject({ model: "chat-model", effort: "high" });
    expect(chat.subagentEffort).toBeUndefined();
    expect(chat.subagentModel).toBeUndefined();
    expect(f.bot.modelSelection).toEqual({ instanceId: "engine", model: "chat-model", effort: "high" });
  });

  it("leaves the takeover's settings in place", async () => {
    const f = fixture();
    f.takeover();
    expect(await f.turn()).toMatchObject({ model: "chat-model", effort: "high" });
  });

  it("derives Claude subagentModel from the bot's fast model when no routine model is set (#2038)", async () => {
    const f = fixture("claudeAgent");
    f.setRoutine(false);
    f.bot.modelSelection = {
      ...f.selection,
      fast: { instanceId: "engine", model: "haiku-fast" },
    };
    const chat = await f.turn();
    expect(chat).toMatchObject({ model: "chat-model", effort: "high", subagentModel: "haiku-fast" });
  });

  it("lets a per-routine subagentModel override the fast model without changing the main model (#2038)", async () => {
    const f = fixture("claudeAgent");
    f.setRoutine(false);
    f.setRoutineSubagent("sonnet-workers");
    f.bot.modelSelection = {
      ...f.selection,
      fast: { instanceId: "engine", model: "haiku-fast" },
    };
    const chat = await f.turn();
    expect(chat).toMatchObject({ model: "chat-model", subagentModel: "sonnet-workers" });
  });
});
