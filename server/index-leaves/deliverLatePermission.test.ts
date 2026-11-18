import { describe, expect, it, vi } from "vitest";
import { ANSWER_NOT_DELIVERED } from "../../shared/restart-words.ts";
import { isPersistentQuestionCard } from "../../shared/ask-question.ts";
import { createAnswerRequest } from "./answerRequest.ts";
import { createCloseOpenApprovals } from "./closeOpenApprovals.ts";
import { createInterruptDirectThread } from "./interruptDirectThread.ts";
import { allowSavedPermission } from "../turns/saved-permission-pass.ts";

type Row = { id: string; card: Record<string, unknown> };

function card(extra: Record<string, unknown> = {}): Row {
  return {
    id: "m1",
    card: {
      requestId: "r1",
      requestType: "permission",
      tool: "Bash",
      subtitle: "ls memory",
      options: ["Allow", "Deny"],
      ...extra,
    },
  };
}

function hostFor(rows: Row[], over: Record<string, any> = {}) {
  const started: string[] = [];
  const appended: Array<Record<string, unknown>> = [];
  const host: Record<string, any> = {
    DATA_DIR: "/tmp/sagax-approval-test",
    appendDecision: vi.fn(),
    machineApprovals: new Map(),
    askMessageByRequest: new Map(),
    pendingCommandRules: new Map(),
    runningTurnEngines: new Map(),
    registry: new Map(),
    memberOwnedInOrg: () => false,
    isPersistentQuestionCard,
    grantRemoteExecApproval: vi.fn(),
    languageOfPerson: () => "en",
    cardTurnSettled: vi.fn(),
    store: {
      messagesFor: () => rows,
      bot: (id: string) => (id === "b1" ? { id: "b1", name: "Helper", threadId: "t1" } : null),
      botByThread: () => ({ id: "b1", name: "Helper", threadId: "t1" }),
      patchMessage: (_threadId: string, id: string, patch: { card?: Record<string, unknown> }) => {
        const index = rows.findIndex((candidate) => candidate.id === id);
        if (index >= 0 && patch.card) rows[index] = { ...rows[index], card: patch.card };
      },
      appendMessage: (_threadId: string, message: Record<string, unknown>) => { appended.push(message); },
    },
    startOrQueueDirectMessage: vi.fn(async (_botId: string, _threadId: string, text: string) => {
      started.push(text);
      return { ok: true, queued: false };
    }),
    ...over,
  };
  return { host, started, appended };
}

describe("a permission card answered after a restart (#4528)", () => {
  it("starts one turn with the verdict, keeps the card, and a second answer starts nothing", async () => {
    const rows = [card()];
    const { host, started, appended } = hostFor(rows);
    const answer = createAnswerRequest(() => host);

    expect(await answer("t1", "gone", "r1", "allow", undefined, { id: "b1", name: "Helper" })).toBe("late-permission");
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("Bash");
    expect(started[0]).toContain("ls memory");
    expect(started[0]).toContain("Do it now, once");
    expect(rows[0]!.card.answered).toBe("allow");
    expect(rows[0]!.card.dismissed).toBe(false);
    expect(appended).toEqual([]);
    expect(allowSavedPermission(host, {
      threadId: "t1", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("allow");

    expect(await answer("t1", "gone", "r1", "allow", undefined, { id: "b1", name: "Helper" })).toBe("unavailable");
    expect(started).toHaveLength(1);
    expect(rows[0]!.card.answered).toBe("allow");
    expect(appended).toEqual([]);
  });

  it("a live engine still takes the answer, and a throw is not a second turn", async () => {
    const respond = vi.fn(async () => "allowed-once");
    const liveRows = [card()];
    const live = hostFor(liveRows, { runningTurnEngines: new Map([["t1", { adapter: { respondToRequest: respond } }]]) });
    const answer = createAnswerRequest(() => live.host);
    expect(await answer("t1", "inst", "r1", "allow")).toBe("allowed-once");
    expect(respond).toHaveBeenCalledOnce();
    expect(live.started).toEqual([]);
    expect(liveRows[0]!.card.answered).toBeUndefined();

    const thrown = vi.fn(async () => { throw new Error("engine gone"); });
    const deadRows = [card()];
    const dead = hostFor(deadRows, { runningTurnEngines: new Map([["t1", { adapter: { respondToRequest: thrown } }]]) });
    const answerDead = createAnswerRequest(() => dead.host);
    expect(await answerDead("t1", "inst", "r1", "allow")).toBe("unavailable");
    expect(dead.started).toEqual([]);
    expect(deadRows[0]!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    expect(dead.appended).toEqual([{ role: "bot", kind: "activity", tool: { name: ANSWER_NOT_DELIVERED, ok: false } }]);
  });

  it("a deny starts one turn and saves no pass", async () => {
    const rows = [card()];
    const { host, started } = hostFor(rows);
    const answer = createAnswerRequest(() => host);
    expect(await answer("t1", "gone", "r1", "deny", "not this")).toBe("late-permission");
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("Do not do it.");
    expect(started[0]).toContain("not this");
    expect(rows[0]!.card.answered).toBe("deny");
    expect(allowSavedPermission(host, {
      threadId: "t1", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("keep");
  });
});

describe("closeOpenApprovals", () => {
  it("a safe-point cut keeps the permission card; Stop still dismisses it", () => {
    const rows = [card(), card({ requestId: "q1", requestType: "question", tool: undefined, subtitle: "Which one?" })];
    const { host } = hostFor(rows);
    const close = createCloseOpenApprovals(() => host);
    close("t1", { keepPermissions: true });
    expect(rows[0]!.card.answered).toBeUndefined();
    expect(rows[0]!.card.dismissed).toBeUndefined();
    expect(rows[1]!.card.answered).toBeUndefined();

    const stopped = [card()];
    const stopHost = hostFor(stopped).host;
    createCloseOpenApprovals(() => stopHost)("t1");
    expect(stopped[0]!.card).toMatchObject({ answered: "unavailable", dismissed: true });
  });

  it("only a safe-point interrupt asks to keep the permission card", async () => {
    const calls: unknown[][] = [];
    const host: Record<string, any> = {
      pendingComputerResumes: new Map(),
      store: { taskByThread: () => null, patchMessage() {} },
      directRequestOwners: new Map(),
      liveTurnByThread: new Map(),
      cancelledVoiceTurns: new Map(),
      interruptKeepsTeammates: () => true,
      botForThread: () => null,
      directTurnGenerationByThread: new Map([["t1", 1]]),
      cancelDirectTurnDispatch() {},
      revokeInternalCapabilitiesForThread() {},
      closeOpenApprovals: (...args: unknown[]) => { calls.push(args); },
    };
    const interrupt = createInterruptDirectThread(() => host);
    await interrupt("b1", "t1", { cause: "safe-point" });
    await interrupt("b1", "t1", { cause: "stop" });
    expect(calls).toEqual([["t1", { keepPermissions: true }], ["t1", undefined]]);
  });
});
