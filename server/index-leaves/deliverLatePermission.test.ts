import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ANSWER_NOT_DELIVERED } from "../../shared/restart-words.ts";
import { isPersistentQuestionCard } from "../../shared/ask-question.ts";
import { createAnswerRequest } from "./answerRequest.ts";
import { createDeliverLateQuestionAnswer } from "./deliverLateQuestionAnswer.ts";
import { createCloseOpenApprovals } from "./closeOpenApprovals.ts";
import { createInterruptDirectThread } from "./interruptDirectThread.ts";
import { allowSavedPermission } from "../turns/saved-permission-pass.ts";

type Row = { id: string; card: Record<string, unknown> };

/** The person who answers the card. */
const ANN = { kind: "session", session: { id: "s-ann", principalId: "pr_ann" } };

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
    // #4528: a fresh folder per host, as the saved allow is kept on disk
    DATA_DIR: mkdtempSync(join(tmpdir(), "sagax-approval-test-")),
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
    sendSequencer: { run: (_key: string, _print: unknown, work: () => unknown) => work() },
    messageSender: (auth: { session?: { principalId?: string } }) => ({ id: auth.session?.principalId, name: "Ann" }),
    usageTriggerFor: () => "chat",
    cfg: {},
    ...over,
  };
  host.store.taskByThread ??= () => ({ threadId: "t1" });
  host.store.groupByThread ??= () => undefined;
  host.deliverLateCardTurn ??= createDeliverLateQuestionAnswer(() => host).cardTurn;
  return { host, started, appended };
}

describe("a permission card answered after a restart (#4528)", () => {
  it("starts one turn with the verdict, keeps the card, and a second answer starts nothing", async () => {
    const rows = [card()];
    const { host, started, appended } = hostFor(rows);
    const answer = createAnswerRequest(() => host);

    expect(await answer("t1", "gone", "r1", "allow", undefined, { id: "b1", name: "Helper" }, false, false, ANN)).toBe("late-permission");
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

    expect(await answer("t1", "gone", "r1", "allow", undefined, { id: "b1", name: "Helper" }, false, false, ANN)).toBe("unavailable");
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
    expect(await answer("t1", "gone", "r1", "deny", "not this", undefined, false, false, ANN)).toBe("late-permission");
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("Do not do it.");
    expect(started[0]).toContain("not this");
    expect(rows[0]!.card.answered).toBe("deny");
    expect(allowSavedPermission(host, {
      threadId: "t1", tools: ["Bash"], summary: "ls memory", safety: "ok", alreadyApproved: false, canRespond: true,
    })).toBe("keep");
  });
});

describe("a permission card answered while a later turn runs (#4528 review)", () => {
  it("a safe-point cut keeps the card; Allow during the next turn is queued as one late turn, the card answered", async () => {
    const rows = [card()];
    // the engine of the person's new turn: it never saw r1
    const respond = vi.fn(async () => "unavailable");
    const queuedTurn = vi.fn(async (_botId: string, _threadId: string, _text: string) => ({ ok: true, queued: true }));
    const { host, appended } = hostFor(rows, {
      runningTurnEngines: new Map([["t1", { adapter: { respondToRequest: respond } }]]),
      startOrQueueDirectMessage: queuedTurn,
    });
    createCloseOpenApprovals(() => host)("t1", { keepPermissions: true });
    expect(rows[0]!.card.answered).toBeUndefined();

    const answer = createAnswerRequest(() => host);
    expect(await answer("t1", "inst", "r1", "allow", undefined, { id: "b1", name: "Helper" }, false, false, ANN)).toBe("late-permission");
    expect(respond).toHaveBeenCalledOnce();
    expect(queuedTurn).toHaveBeenCalledOnce();
    expect(rows[0]!.card).toMatchObject({ answered: "allow", dismissed: false });
    expect(appended).toEqual([]);
    expect(host.appendDecision).toHaveBeenCalledWith(host.DATA_DIR, expect.objectContaining({ requestId: "r1", decision: "user-approved", source: "user" }));

    // a second Allow is not a second turn
    expect(await answer("t1", "inst", "r1", "allow", undefined, { id: "b1", name: "Helper" }, false, false, ANN)).toBe("unavailable");
    expect(queuedTurn).toHaveBeenCalledOnce();
  });

  it("the late turn speaks for who answered: sender, trigger and speaker, through the late answer's own delivery", async () => {
    const rows = [card()];
    const { host } = hostFor(rows);
    const answer = createAnswerRequest(() => host);
    expect(await answer("t1", "gone", "r1", "allow", undefined, { id: "b1", name: "Helper" }, false, false, ANN)).toBe("late-permission");
    const args = host.startOrQueueDirectMessage.mock.calls[0]!;
    expect(args[5]).toEqual({ id: "pr_ann", name: "Ann" });
    expect(args[6]).toBe("chat");
    expect(args[7]).toEqual({ origin: "person", principalId: "pr_ann" });
  });

  it("a conversation that no longer exists starts nothing and keeps the old not-delivered path", async () => {
    const rows = [card()];
    const { host, appended } = hostFor(rows, {});
    host.store.taskByThread = () => null;
    const answer = createAnswerRequest(() => host);
    expect(await answer("t1", "gone", "r1", "allow", undefined, { id: "b1", name: "Helper" }, false, false, ANN)).toBe("unavailable");
    expect(host.startOrQueueDirectMessage).not.toHaveBeenCalled();
    expect(rows[0]!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    expect(appended).toEqual([{ role: "bot", kind: "activity", tool: { name: ANSWER_NOT_DELIVERED, ok: false } }]);
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
