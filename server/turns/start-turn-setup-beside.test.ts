// #4456: two network reads ran one after the other on the turn's path, after
// the mounts: the semantic recall query's embedding (the person's embedding
// endpoint, up to 1.5 s) and the Proactive alerts section (the person's
// watches, up to 2 s on every owner turn). Both start at setup now, beside
// context selection and the mounts (the embedding beside compaction too),
// and the turn awaits only what is left of them. The Proactive read starts
// only past the compaction-only return and the stop during context setup:
// when the person's first question is due, that call posts it.
import { describe, expect, it, vi } from "vitest";
import { createSetupStartTurn } from "./start-turn-setup.ts";

class Stop extends Error {}

function run(options: { endpoint: boolean; memoryEnabled?: boolean; agentsMounted?: boolean; compactOnly?: boolean; stoppedDuringContext?: boolean }) {
  const order: string[] = [];
  const prepareSemanticRecall = vi.fn(() => { order.push("embedding"); return new Promise<void>(() => {}); });
  const proactiveAskForTurn = vi.fn(() => { order.push("watches"); return new Promise<string>(() => {}); });
  const host = {
    store: { taskByThread: () => undefined },
    turnTrace: () => undefined,
    cfg: {},
    autoRecallEnabled: () => true,
    semanticEmbeddingEndpoint: () => (options.endpoint ? "http://embeddings.invalid" : undefined),
    recallQuery: (text: string) => text,
    prepareSemanticRecall,
    proactiveAskForTurn,
    connectorPlanForTurn: () => { order.push("connectors"); return {}; },
    compactConversation: async () => { order.push("compacted"); return undefined; },
    directTurnClaimIsCurrent: () => options.stoppedDuringContext !== true,
    DirectTurnSetupCancelled: Stop,
    // the compaction-only run's own return
    clearDirectTurnDispatch: () => {}, revokeInternalCapabilityGeneration: () => {}, settleDirectFollowup: () => {},
    releaseTurnResources: () => {}, watchdog: { settle: () => {} }, directTurnBots: new Map(), retryDelegationsWaitingOn: () => {},
    drainQueuedSends: () => {}, drainComputerResumes: () => {}, drainSecretResumes: () => {}, drainTeamSetupResumes: () => {}, drainDelegationWakes: () => {},
    IDENTITY: { kind: "local" },
  };
  // the step after the compaction-only return: stop the turn here
  (host.store as any).activePath = () => { order.push("context"); throw new Stop(); };
  (host.store as any).setTaskActivity = () => {};
  const setup = createSetupStartTurn(host as never);
  const state = {
    bot: { id: "bot-1", ...(options.memoryEnabled === false ? { memoryEnabled: false } : {}) },
    threadId: "thread-1", warmOnly: false, instance: { adapter: { capabilities: {} } }, opts: options.compactOnly ? { compactOnly: true } : {}, commsDepth: 0,
    userMessage: { id: "message-1" }, turnImages: [],
    agentsMounted: options.agentsMounted === true,
    resolvedImages: { text: "what did we decide yesterday?" },
    semanticRecallPrepared: undefined as Promise<void> | undefined,
    proactiveAskPrepared: undefined as Promise<string> | undefined,
  };
  return { order, prepareSemanticRecall, proactiveAskForTurn, state, done: setup(state as never).then(() => "returned", (error) => (error instanceof Stop ? "stopped" : error)) };
}

describe("the network reads a turn starts at setup (#4456)", () => {
  it("starts at setup, before the connectors, compaction and mounts, without holding them", async () => {
    const { order, prepareSemanticRecall, state, done } = run({ endpoint: true });
    // the embedding never answers here: setup still goes on to the next step
    expect(await done).toBe("stopped");
    expect(prepareSemanticRecall).toHaveBeenCalledWith("bot-1", "what did we decide yesterday?");
    expect(order).toEqual(["embedding", "connectors", "compacted", "context"]);
    expect(state.semanticRecallPrepared).toBeInstanceOf(Promise);
  });

  it("starts nothing without an embedding endpoint or with the bot's memory off", async () => {
    for (const options of [{ endpoint: false }, { endpoint: true, memoryEnabled: false }]) {
      const { prepareSemanticRecall, state, done } = run(options);
      expect(await done).toBe("stopped");
      expect(prepareSemanticRecall).not.toHaveBeenCalled();
      expect(state.semanticRecallPrepared).toBeUndefined();
    }
  });

  it("starts the Proactive alerts read after compaction, before context selection, without holding it", async () => {
    const { order, proactiveAskForTurn, state, done } = run({ endpoint: false, agentsMounted: true });
    expect(await done).toBe("stopped");
    expect(proactiveAskForTurn).toHaveBeenCalledWith(state.bot, "thread-1", 0, { warm: false });
    expect(order).toEqual(["connectors", "compacted", "watches", "context"]);
    expect(state.proactiveAskPrepared).toBeInstanceOf(Promise);
  });

  // the Proactive call posts the person's first question when it is due: a
  // run that never reaches the model must not post it nor use it up
  it("starts neither read on a compaction-only run", async () => {
    const { order, prepareSemanticRecall, proactiveAskForTurn, state, done } = run({ endpoint: true, agentsMounted: true, compactOnly: true });
    expect(await done).toBe("returned");
    expect(order).toEqual(["connectors", "compacted"]);
    expect(proactiveAskForTurn).not.toHaveBeenCalled();
    expect(prepareSemanticRecall).not.toHaveBeenCalled();
    expect(state.proactiveAskPrepared).toBeUndefined();
  });

  it("starts no Proactive read on a turn stopped during context setup", async () => {
    const { order, proactiveAskForTurn, state, done } = run({ endpoint: false, agentsMounted: true, stoppedDuringContext: true });
    expect(await done).toBe("stopped");
    expect(order).toEqual(["connectors", "compacted"]);
    expect(proactiveAskForTurn).not.toHaveBeenCalled();
    expect(state.proactiveAskPrepared).toBeUndefined();
  });

  it("reads no watches on a turn without the agents tools", async () => {
    const { proactiveAskForTurn, state, done } = run({ endpoint: false });
    expect(await done).toBe("stopped");
    expect(proactiveAskForTurn).not.toHaveBeenCalled();
    expect(state.proactiveAskPrepared).toBeUndefined();
  });
});
