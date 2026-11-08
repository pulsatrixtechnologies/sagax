// #2911: the turn.completed branch that raises a routine or MCP turn's final
// question (#1984, #2901) through raiseHarnessQuestion. "A, or B?" must reach
// the person with its two paths, never Yes/No and never silence.
import { describe, expect, it, vi } from "vitest";
import { finalAlternative, finalConfirmation, finalConfirmationOptions } from "../approvals/final-confirmation.ts";
import { runRuntimeEventPreamble } from "./preamble.ts";

const THREAD = "t-task";
const BOT = { id: "bot-1", threadId: "t-bot" };

function hostFor(reply: string, opts: { routineRun?: boolean; mcpStarted?: boolean } = {}) {
  const raiseHarnessQuestion = vi.fn();
  const host = {
    shouldIgnoreProviderEvent: () => false,
    localVmThreadTargets: new Map(), groupGoalCoordinatorTurns: new Map(), retiredProviderTurns: new Set(),
    groupGoalCoordinatorTurnForEvent: () => undefined, removeGroupGoalCoordinatorTurn: () => {}, releaseLocalVmThread: () => {},
    directRequestOwners: new Map(), cancelledVoiceTurns: new Map(), relayStreams: new Map(), relayShown: new Set(), liveTurnByThread: new Map(),
    voiceLatency: { mark: () => {}, settled: () => {} },
    broadcast: () => {}, withoutPrivateFields: (event: unknown) => event, redactSecretsInText: (text: string) => text, clearRelayedStream: () => {},
    store: {
      botByThread: () => BOT, taskByThread: () => ({ threadId: THREAD, ownerPrincipalId: "p-1" }),
      groupByThread: () => undefined, messagesFor: () => [],
    },
    lastPersonMessage: () => undefined,
    lastReply: new Map([[THREAD, reply]]),
    routineRunThread: () => opts.routineRun ?? true,
    isAgentConversation: () => opts.mcpStarted ?? false, notificationInHiddenThread: () => false,
    stoppedTurns: new Set(), openPersonCard: () => undefined,
    finalConfirmation, finalAlternative, finalConfirmationOptions,
    languageOfPerson: () => "fr-CA", recordedBotOwner: () => "p-1",
    raiseHarnessQuestion,
    // Stop right after the confirmation branch: no bot row to append to.
    botForThread: () => null,
  };
  return { host, raiseHarnessQuestion };
}

const completed = { type: "turn.completed", threadId: THREAD, eventId: "e-1", turnId: "turn-1", ok: true };

describe("a final question at the end of a routine or MCP turn (#2911)", () => {
  const exact = "Veux-tu que je refasse la collecte à neuf, ou qu'on avance directement avec ta validation ?";

  it("raises an either/or question with its two paths, not Yes/No", () => {
    const text = `Voici le lot de la semaine.\n\n${exact}`;
    const { host, raiseHarnessQuestion } = hostFor(text);
    runRuntimeEventPreamble(completed, host);
    expect(raiseHarnessQuestion).toHaveBeenCalledTimes(1);
    expect(raiseHarnessQuestion).toHaveBeenCalledWith(THREAD, {
      title: "Your bot has a question", question: text,
      options: ["Que je refasse la collecte à neuf", "Qu'on avance directement avec ta validation"],
    }, "output");
  });

  it("does the same for an MCP-started turn, with a may-I lead stripped from the first path", () => {
    const { host, raiseHarnessQuestion } = hostFor("Puis-je fermer le billet, ou attendre le client?", { routineRun: false, mcpStarted: true });
    runRuntimeEventPreamble(completed, host);
    expect(raiseHarnessQuestion.mock.calls[0]?.[1].options).toEqual(["Fermer le billet", "Attendre le client"]);
  });

  it("keeps the person's translated Yes/No on a yes-or-no final question", () => {
    const { host, raiseHarnessQuestion } = hostFor("Le lot est prêt. Puis-je procéder aux écritures?");
    runRuntimeEventPreamble(completed, host);
    expect(raiseHarnessQuestion.mock.calls[0]?.[1].options).toEqual(["Oui", "Non"]);
  });

  it("stays quiet in an ordinary chat", () => {
    const { host, raiseHarnessQuestion } = hostFor(exact, { routineRun: false, mcpStarted: false });
    runRuntimeEventPreamble(completed, host);
    expect(raiseHarnessQuestion).not.toHaveBeenCalled();
  });
});
