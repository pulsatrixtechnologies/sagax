// #3511: a turn's clock note says the time the engine takes the turn, after
// every wait (workspace, engine slot), not the time the message arrived.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrepareAdmitStartTurn } from "./start-turn-prepare-admit.ts";
import { createDispatchStartTurn } from "./start-turn-dispatch.ts";
import { createTurnState } from "./start-turn-state.ts";
import { turnClockNote, withTurnClock } from "./turn-clock.ts";
import { withoutTurnClock } from "../testing/turn-clock-text.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { SendTurnInput } from "../contracts.ts";

afterEach(() => vi.useRealTimers());

describe("turn clock at the engine hand-off", () => {
  it("carries the time the engine takes the turn, not the time the message arrived", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const zone = "America/Toronto";
    const asked = new Date("2026-11-11T01:08:58Z");
    const handed = new Date("2026-11-11T01:11:58Z");
    vi.setSystemTime(asked);
    const bot = { id: "bot", name: "Runner", modelSelection: { instanceId: "engine", model: "chat-model" } };
    const sendTurn = vi.fn(async (_input: SendTurnInput) => ({}));
    const instance = { instanceId: "engine", driverKind: "claudeAgent", models: { options: [{ id: "chat-model" }] },
      adapter: { capabilities: { effortLevels: [] }, sendTurn } };
    const noOp = vi.fn();
    const values: Record<string, unknown> = {
      IDENTITY: { kind: "solo" }, cfg: {}, turnStartLogLine: () => "fixture turn", voiceLatency: { mark: noOp },
      extractTurnImages: (text: string) => ({ text, images: [], videos: [] }), promptWithDataContext: (text: string) => text,
      quietTurnThreads: new Set(), autoTurnsByThread: new Map(), turnRunByThread: new Map(), turnModelRequested: new Map(), turnRunFor: (value: unknown) => value,
      effortAcceptedByEngine: () => true, effortForModel: () => undefined, resolveEngineTurnEffort: () => undefined,
      routineModelForTurn: () => null, routineSubagentModelForTurn: () => null, routineEffortForTurn: () => undefined,
      store: new Proxy({ activePath: () => [], isConfidentialThread: () => false, messagesFor: () => [] } as Record<string, unknown>, { get: (target, key: string) => target[key] ?? noOp }),
      connectorPlanForTurn: () => ({}), typedCommandForTurn: async () => ({ kind: "none" }), bundledKnowledgeIndex: async () => null, releaseVersion: () => "0.0.0",
      coordinator: { answer: () => false }, voiceCalls: { active: () => false }, resolveTurnSpeaker: () => ({ origin: "owner" }),
      remoteComputerForTurn: () => ({}), turnWorksOn: () => ({}), decideWorkplace: () => ({ principal: "person" }),
      workplaceTurnText: (text: string) => ({ text }), withWorkplaceNote: (text: string) => text,
      turnClockEnabled: () => true, turnZoneFor: () => zone, withTurnClock, isSmallTalk: () => false, routineLineage: () => false,
      officeTurnText: (text: string) => ({ text, images: [] }),
      handoffs: { dispatching: noOp }, directTurnClaimIsCurrent: () => true, directTurnClaimExists: () => true,
      fitTurnImagesForModel: async () => [], botRecoveryBackups: () => [],
      withDesktopModelPerson: (_person: unknown, work: () => unknown) => work(), runAsBotEngine: (_botId: string, work: () => unknown) => work(),
      guardTurnDispatch: (work: unknown) => work, withRecalled: (_recalled: unknown, text: string) => text,
      savedSteps: { dispatch: { sendTurn: (_engine: unknown, _replay: unknown, input: SendTurnInput, dispatch: (input: SendTurnInput) => unknown) => dispatch(input) } },
      managedPolicy: { restrictsMcp: () => false },
    };
    const host = new Proxy(values, { get: (target, key: string) => target[key] ?? noOp }) as unknown as StartTurnHost;
    const state = createTurnState({ botId: bot.id, text: "Quelle heure est-il?", opts: { userMessage: { id: "m1", at: asked.getTime(), role: "user", kind: "text", text: "Quelle heure est-il?" } }, startTurn: async () => {} });
    Object.assign(state, { bot, instance, threadId: "thread", answer: {}, plan: {}, activeMessages: [], transcript: [], tagged: [], contextOrder: [],
      integrations: {}, prompt: { text: "", stable: "", volatile: "" } });
    await createPrepareAdmitStartTurn(host, vi.fn(() => ({ kind: "continue" as const })))(state);
    expect(state.providerText).toContain(turnClockNote(asked, zone));
    // setup carries the text on; the workspace, the mount and an engine slot
    // then hold the turn three minutes before its engine takes it
    state.dispatchContext = { turnText: state.providerText, recoveryText: state.providerText, handoff: {} };
    vi.setSystemTime(handed);
    await createDispatchStartTurn(host)(state);
    const input = sendTurn.mock.calls.at(-1)![0];
    expect(input.text).toContain(turnClockNote(handed, zone));
    expect(input.text).not.toContain(turnClockNote(asked, zone));
    expect(input.recoveryText).toContain(turnClockNote(handed, zone));
    expect(input.turnClock).toEqual({ timeZone: zone, note: turnClockNote(handed, zone) });
    expect(withoutTurnClock(input.text)).toBe("Quelle heure est-il?");
  });
});
