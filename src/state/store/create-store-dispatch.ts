import type { StoreDispatchCtx, DispatchEnv, DispatchShared } from "./dispatch-types";
import { dispatchTasksEffects } from "./dispatch-tasks";
import { dispatchBotsEffects } from "./dispatch-bots";
import { dispatchSendEffects } from "./dispatch-send";
import { dispatchRoutinesEffects } from "./dispatch-routines";
import { startTransition } from "react";
import type { Action, Bot, OptionCardData, TaskUpdatePatch } from "./model";
import { openOnboardingCard, sendsToFreshTopic, pinBotThreadAction } from "./model";
import { MESSAGE_PAGE_SIZE, api, persistTaskApproval } from "./api";
import { shouldSuppressDeployOutageError } from "@/lib/deploy-reconnect";
import { readableError } from "@/lib/plain-error";
import { approvalModeFor } from "../../../shared/approval-mode";
import { stepUpApprovals } from "@/lib/step-up-client";

export type { StoreDispatchCtx } from "./dispatch-types";

// Async side-effect dispatch for StoreProvider (#1383). Handlers stay under 400 lines.

export function createStoreDispatch(ctx: StoreDispatchCtx): (action: Action) => void {
  const { rawDispatch, stateRef, threadPages, botPatchQueue, taskWrites, withTaskWrites } = ctx;
    const navigation = new Map<string, number>();
    // The fresh topics being made, per bot (the first message's send).
    const freshTopicsCreating = new Map<string, Promise<string>>();
    const shared: DispatchShared = { selectionRevision: 0, creatingBot: false };
    const olderPagesInFlight = new Set<string>();
    const showError = (e: unknown) => {
      // A short deploy restart: keep the transcript, show Reconnecting, no toast.
      const snap = stateRef.current;
      if (
        shouldSuppressDeployOutageError({
          failure: e,
          everConnected: snap.everConnected,
          connected: snap.connected,
          disconnectedAt: snap.disconnectedAt,
        })
      ) {
        return;
      }
      rawDispatch({ type: "error", message: readableError(e) });
    };
    /** Where a card action's message lives, and the card on it. A card asked
     * inside a room belongs to the room's list, never to one member's. */
    const cardTarget = (action: { botId: string; messageId: string; groupId?: string }) => {
      const host = action.groupId
        ? stateRef.current.groups.find((g) => g.id === action.groupId)
        : stateRef.current.bots.find((b) => b.id === action.botId);
      return { host, card: host?.messages.find((m) => m.id === action.messageId)?.card, inRoom: !!action.groupId };
    };
    // fire-and-forget card persistence; the route is optional server-side
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    const waitForExecutionSettings = async (expectedBots: Bot[], threadId?: string) => {
      // Capture this send's task save before waiting on slower profile saves.
      // Reconciliation may clear a failed lane meanwhile; that must not turn
      // an already-waiting send into work under reverted settings.
      const taskWrite = threadId ? taskWrites.get(threadId)?.execution : undefined;
      const defaultWrites = [...taskWrites.values()].filter((write) => write.updatesDefault && expectedBots.some((bot) => bot.id === write.botId));
      await Promise.all([taskWrite, ...defaultWrites.map((write) => write.execution), ...expectedBots.map(async (expected) => {
        const persisted = await botPatchQueue.flush(expected.id);
        if (!persisted) return;
        const expectedSelection = expected.modelSelection;
        if (
          approvalModeFor(persisted) !== approvalModeFor(expected) ||
          (persisted.memoryEnabled !== false) !== (expected.memoryEnabled !== false) ||
          persisted.modelSelection.instanceId !== expectedSelection.instanceId ||
          persisted.modelSelection.model !== expectedSelection.model ||
          persisted.modelSelection.effort !== expectedSelection.effort ||
          persisted.modelSelection.variant !== expectedSelection.variant
        ) {
          throw new Error("The approval level, memory setting, or model could not be saved, so this work was not started");
        }
      })]);
      if (threadId) await taskWrites.get(threadId)?.execution;
    };

    const persistTaskPatch = (botId: string, threadId: string, patch: TaskUpdatePatch) => {
      const previous = taskWrites.get(threadId);
      // A quick tab switch may queue two default changes on different threads.
      // Keep their order, and don't let a group send race either pending save.
      const defaults = patch.updateBotDefault || patch.approvalMode !== undefined
        ? [...taskWrites.values()].filter((write) => write.botId === botId) : [];
      const promise = Promise.all([previous?.promise, ...defaults.map((write) => write.promise)].map((save) => save?.catch(() => {})))
        .then(async () => {
          return persistTaskApproval(botId, threadId, patch, stepUpApprovals(window.ogb?.approvals));
        });
      // Later edits still get saved after an earlier failure, but a send
      // awaiting this batch must observe every rejected setting in it. A
      // successful folder move is not confirmation of a failed model change.
      const execution = Promise.all([previous?.execution, promise]);
      void execution.catch(() => {}); // handled by the write and send paths
      const pending = { botId, updatesDefault: Boolean(patch.updateBotDefault || previous?.updatesDefault), patch: { ...previous?.patch, ...patch }, promise, execution };
      taskWrites.set(threadId, pending);
      void pending.promise.then((bot) => {
        if (taskWrites.get(threadId) !== pending) return;
        taskWrites.delete(threadId);
        if (bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
      }).catch((error) => {
        showError(error);
        // Block sends until authoritative settings have been restored. Do
        // not clear the failed write if reconciliation also fails or a newer
        // write supersedes it: those settings are still unconfirmed.
        if (taskWrites.get(threadId) === pending) {
          pending.patch = {};
          void api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`).then(({ bots }) => {
            if (taskWrites.get(threadId) !== pending) return;
            const bot = bots.find((candidate: Bot) => candidate.id === botId);
            if (bot) {
              rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
              taskWrites.delete(threadId);
            }
          }).catch(() => {});
        }
      });
    };

    /** Resolve every bot whose execution context belongs to this thread. A
     * direct chat may name an inactive task, while a channel request belongs
     * to every member that could be selected to run it. Capture the result
     * before the optimistic reducer runs so approval/model writes cannot race
     * a response that resumes (or starts) work. */
    const executionBotsForThread = (threadId: string): Bot[] => {
      const snapshot = stateRef.current;
      const botIds = new Set<string>();
      for (const bot of snapshot.bots) {
        if (bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId)) {
          botIds.add(bot.id);
        }
      }
      for (const group of snapshot.groups) {
        if (group.threadId === threadId || group.tasks?.some((task) => task.threadId === threadId)) {
          for (const memberId of group.memberIds) botIds.add(memberId);
        }
      }
      return snapshot.bots.filter((bot) => botIds.has(bot.id));
    };

  const env: DispatchEnv = {
    ...ctx,
    navigation,
    freshTopicsCreating,
    shared,
    olderPagesInFlight,
    showError,
    cardTarget,
    persistCard,
    waitForExecutionSettings,
    persistTaskPatch,
    dispatch: (action) => wrapped(action),
    executionBotsBeforeAction: [],
    quizBeforeSend: undefined,
    freshSendBefore: false,
    botBeforeUpdate: undefined,
    botBeforeSend: undefined,
    leafBeforeEdit: null,
  };

  function wrapped(action: Action): void {
      // Deferred folder creation may select its bot only while it is still
      // the latest navigation intent, even if the person went away and back.
      if (["select", "newTask", "switchTask", "newGroupTask", "switchGroupTask", "showChat", "showRoutines", "showTeamMap", "showCode", "showApprovals", "showRemoteSessions", "showAchievements", "showArchivedBots", "showOrgImport"].includes(action.type)) shared.selectionRevision++;
      // Pin before any await or optimistic state change, including legacy
      // callers such as keyboard shortcuts and voice controls.
      action = pinBotThreadAction(action, stateRef.current.bots);
      if (action.type === "taskSwitched") action = { ...action, bot: withTaskWrites(action.bot) as Bot };
      if (action.type === "botPatched") action = { ...action, bot: withTaskWrites(action.bot) };
      // One identity drives the optimistic row, HTTP retry protection, and
      // canonical SSE reconciliation. Callers may omit it; the store may not.
      if ((action.type === "send" || action.type === "sendGroup" || action.type === "editMessage") && !action.sendId) {
        action = { ...action, sendId: crypto.randomUUID() };
      }
      const botBeforeUpdate =
        action.type === "updateBot" || action.type === "setModel"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      const botBeforeSend =
        action.type === "send"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      // the branch an edit replaces on screen, restored if the edit fails
      const leafBeforeEdit =
        action.type === "editMessage"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)?.activeLeafId ?? null
          : null;
      const executionBotsBeforeAction = (() => {
        if (action.type === "editMessage" || action.type === "answerCard") {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          return bot ? [bot] : [];
        }
        if (action.type === "decideRequest") {
          const bots = executionBotsForThread(action.threadId);
          if (!action.alwaysAllow || bots.some((bot) => bot.id === action.alwaysAllow?.botId)) {
            return bots;
          }
          const grantBot = stateRef.current.bots.find((bot) => bot.id === action.alwaysAllow?.botId);
          return grantBot ? [...bots, grantBot] : bots;
        }
        if (action.type === "sendGroup") {
          const memberIds = stateRef.current.groups.find((group) => group.id === action.groupId)?.memberIds ?? [];
          return stateRef.current.bots.filter((candidate) => memberIds.includes(candidate.id));
        }
        if (action.type === "runRoutine") {
          const routine = stateRef.current.routines.find((candidate) => candidate.id === action.routineId);
          if (!routine) return [];
          const ids = new Set([routine.botId]);
          if (routine.target === "room-goal" && routine.groupId) {
            const group = stateRef.current.groups.find((candidate) => candidate.id === routine.groupId);
            for (const memberId of group?.memberIds ?? []) ids.add(memberId);
          }
          return stateRef.current.bots.filter((candidate) => ids.has(candidate.id));
        }
        return [];
      })();
      // Read before the reducer runs: the send lands in a fresh topic.
      const freshSendBefore = action.type === "send" && sendsToFreshTopic(stateRef.current, action);
      const quizBeforeSend = (() => {
        if (action.type !== "send") return undefined;
        return botBeforeSend ? openOnboardingCard(botBeforeSend) : undefined;
      })();
      // A queued message is still real until the server confirms deletion.
      // Bot deletion is also server-authoritative: lifecycle guards may reject
      // it, and hiding the row first strands the computer the person must
      // remove. All other actions keep their existing optimistic behavior.
      if (action.type === "switchTask") {
        const switching = action;
        const leaving = stateRef.current.bots.find((candidate) => candidate.id === switching.botId);
        // The thread left behind, as it stands, for a switch back to it.
        if (leaving && leaving.threadId !== switching.threadId && !leaving.switchingTo && !leaving.awaitingThreadSnapshot && leaving.messages.length) {
          threadPages.set(leaving.threadId, { messages: leaving.messages, hasMore: leaving.hasMore, activeLeafId: leaving.activeLeafId, at: Date.now() });
        }
        const cached = switching.whole ? undefined : threadPages.get(switching.threadId);
        // The switch itself lands at once: the live frames and the read marks
        // read Bot.switchingTo from the latest state. Drawing the cached page
        // is a transition, so the click stays responsive while it renders.
        rawDispatch(switching);
        if (cached) startTransition(() => rawDispatch({ type: "previewThread", botId: switching.botId, threadId: switching.threadId, page: cached }));
      } else if (
        action.type !== "cancelQueued" &&
        action.type !== "cancelGroupQueued" &&
        action.type !== "deleteBot"
      ) rawDispatch(action);

    env.executionBotsBeforeAction = executionBotsBeforeAction;
    env.quizBeforeSend = quizBeforeSend;
    env.freshSendBefore = freshSendBefore;
    env.botBeforeUpdate = botBeforeUpdate;
    env.botBeforeSend = botBeforeSend;
    env.leafBeforeEdit = leafBeforeEdit;
    dispatchRoutinesEffects(action, env);
    dispatchSendEffects(action, env);
    dispatchBotsEffects(action, env);
    dispatchTasksEffects(action, env);
  }
  return wrapped;
}
