// #3703: the composer's warm (its cache prime) is still waiting for its
// engine when the person's message takes the thread's dispatch claim. When
// that warm's setup then returns, it must not stop the turn now running on
// the thread: that turn is the person's message.
import { describe, expect, it, vi } from "vitest";
import { createDispatchStartTurn } from "./start-turn-dispatch.ts";
import { createTurnState } from "./start-turn-state.ts";
import { guardTurnDispatch } from "./turn-dispatch-guard.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { SendTurnInput } from "../contracts.ts";

function warmDispatch(claims: Map<string, unknown>) {
  const bot = { id: "bot", name: "Runner", modelSelection: { instanceId: "engine", model: "chat-model" } };
  const interruptTurn = vi.fn(async () => {});
  const releaseWarmSession = vi.fn();
  const sendTurn = vi.fn(async (_input: SendTurnInput) => ({ turnId: "warm-turn", reused: true }));
  const instance = { instanceId: "engine", driverKind: "claudeAgent", models: { options: [{ id: "chat-model" }] },
    adapter: { capabilities: { effortLevels: [] }, sendTurn, interruptTurn, releaseWarmSession } };
  const noOp = vi.fn();
  const values: Record<string, unknown> = {
    IDENTITY: { kind: "solo" }, cfg: {}, voiceLatency: { mark: noOp },
    store: new Proxy({ activePath: () => [], taskByThread: () => undefined } as Record<string, unknown>, { get: (target, key: string) => target[key] ?? noOp }),
    connectorPlanForTurn: () => ({}), resolveEngineTurnEffort: () => undefined,
    handoffs: { dispatching: noOp }, directTurnClaimIsCurrent: () => true,
    // the person's message replaced the warm's claim while the warm waited
    directTurnClaimExists: () => false, directTurnDispatchClaims: claims,
    fitTurnImagesForModel: async () => [], botRecoveryBackups: () => [],
    withDesktopModelPerson: (_person: unknown, work: () => unknown) => work(), runAsBotEngine: (_botId: string, work: () => unknown) => work(),
    guardTurnDispatch, withRecalled: (_recalled: unknown, text: string) => text,
    savedSteps: { dispatch: { sendTurn: (_engine: unknown, _replay: unknown, input: SendTurnInput, dispatch: (input: SendTurnInput) => unknown) => dispatch(input) } },
    managedPolicy: { restrictsMcp: () => false },
  };
  const host = new Proxy(values, { get: (target, key: string) => target[key] ?? noOp }) as unknown as StartTurnHost;
  const state = createTurnState({ botId: bot.id, text: "", opts: { warmOnly: true }, startTurn: async () => {} });
  Object.assign(state, { bot, instance, threadId: "thread", warmOnly: true, answer: {}, plan: {}, activeMessages: [], transcript: [], tagged: [], contextOrder: [],
    integrations: {}, prompt: { text: "", stable: "", volatile: "" }, userMessage: { id: "warm", role: "user", kind: "text", text: "" },
    turnPlace: { principal: "person" }, dispatchContext: { turnText: "", recoveryText: "", handoff: {} } });
  return { run: () => createDispatchStartTurn(host)(state), interruptTurn, releaseWarmSession };
}

describe("a warm whose claim a message took over (#3703)", () => {
  it("leaves the message's turn running on the thread", async () => {
    const { run, interruptTurn, releaseWarmSession } = warmDispatch(new Map([["thread", { id: "message-claim", botId: "bot", threadId: "thread", phase: "setup" }]]));
    await run();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(releaseWarmSession).not.toHaveBeenCalled();
  });

  // A duplex voice interrupt or a Stop removes a warm's claim with no other
  // claim taking its place: the warm keeps its idle process for the first
  // words (hangup aborts the warm signal and is what closes it).
  it("keeps the process a cancelled warm set up", async () => {
    const { run, interruptTurn, releaseWarmSession } = warmDispatch(new Map());
    await run();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(releaseWarmSession).not.toHaveBeenCalled();
  });
});
