import {voiceCallId} from "@/lib/call";
import type {Action, AppState} from "./model";
import {bumpThreadUpdatedAt, bumpTranscriptGeneration, clearThreadReturnIfHome, dismissOnboardingCard, openedUnreadDivider, optimisticUserMessage, readOnScreen, reconcileModelVariantSessions, reconcileSnapshotQueues, rememberConsumedQueueId, sendsToFreshTopic, updateBot, visibleMessages, withMascotMotion} from "./model";
import {dataSheetKey} from "../../../shared/data-surface";
import {threadOpensUnread, threadReadCursor} from "@/lib/unread-divider";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceTasks(state: AppState, action: Action, reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "threadActive": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      // The visible branch moved (an edit, a rewind, another client's switch).
      return updateBot(bumpTranscriptGeneration(state, action.threadId), bot.id, (b) => ({
        ...b,
        activeLeafId: action.activeLeafId,
      }));
    }
    // optimistic leaf move; the server's thread frame confirms it later
    case "switchBranch": {
      const bot = state.bots.find((b) => b.id === action.botId);
      if (!bot) return state;
      let cur = action.messageId;
      for (;;) {
        const children = bot.messages.filter((m) => m.parentId === cur);
        if (!children.length) break;
        cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
      }
      return updateBot(bumpTranscriptGeneration(state, bot.threadId), action.botId, (b) => ({ ...b, activeLeafId: cur }));
    }
    // optimistic room edits; the server's group frame confirms them later
    case "pendingQueued": {
      if (state.consumedQueueIds[action.queueId]) {
        const consumedQueueIds = { ...state.consumedQueueIds };
        delete consumedQueueIds[action.queueId];
        return { ...state, consumedQueueIds };
      }
      const prev = state.pendingQueued[action.threadId] ?? [];
      if (prev.some((entry) => entry.queueId === action.queueId)) return state;
      return {
        ...state,
        pendingQueued: {
          ...state.pendingQueued,
          [action.threadId]: [...prev, { queueId: action.queueId, text: action.text, ...(action.reason ? { reason: action.reason } : {}) }],
        },
      };
    }
    case "consumePendingQueued": {
      const prev = state.pendingQueued[action.threadId] ?? [];
      const at = prev.findIndex((entry) => entry.queueId === action.queueId);
      if (at < 0) {
        return {
          ...state,
          consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId),
        };
      }
      const rest = prev.filter((_, i) => i !== at);
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[action.threadId] = rest;
      else delete pendingQueued[action.threadId];
      return { ...state, pendingQueued, consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId) };
    }
    case "stopParallelTask":
      return state;
    case "cancelQueued": {
      const bot = state.bots.find((candidate) => candidate.id === action.botId);
      if (!bot) return state;
      const threadId = action.threadId ?? bot.threadId;
      const prev = state.pendingQueued[threadId] ?? [];
      const rest = prev.filter((entry) => entry.queueId !== action.queueId);
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[threadId] = rest;
      else delete pendingQueued[threadId];
      return { ...state, pendingQueued, consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId) };
    }
    case "steerQueued":
      // API-only: the effect folds in messageAdded/consumePendingQueued on
      // success, so the chips clear exactly when the words truly landed.
      return state;
    case "cancelGroupQueued": {
      const prev = state.pendingQueued[action.threadId] ?? [];
      const rest = prev.filter((entry) => entry.queueId !== action.queueId);
      if (rest.length === prev.length) return state;
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[action.threadId] = rest;
      else delete pendingQueued[action.threadId];
      return { ...state, pendingQueued };
    }
    case "send": {
      const animated = withMascotMotion(
        dismissOnboardingCard(state, action.botId),
        action.botId,
        "working",
      );
      if (!action.sendId) return animated;
      const bot = animated.bots.find((candidate) => candidate.id === action.botId);
      const threadId = action.threadId ?? bot?.threadId;
      if (!bot || threadId !== bot.threadId) return animated;
      // The first message of a fresh topic lands in that topic once the
      // server created it (the send effect), never in the one under it.
      if (sendsToFreshTopic(animated, action)) return animated;
      if (bot.messages.some((message) => message.sendId === action.sendId)) return animated;
      const liveCallId = voiceCallId(action.botId);
      const voiceCall = action.voiceCall ?? (liveCallId ? { callId: liveCallId } : undefined);
      const message = optimisticUserMessage(
        action.text,
        action.sendId,
        action.replyToId,
        bot.activeLeafId,
        undefined,
        voiceCall,
      );
      // sent from an open page: its chip shows at once (the server's row keeps it)
      if (action.dataContext?.page) message.dataContext = { page: action.dataContext.page };
      return bumpThreadUpdatedAt(updateBot(animated, bot.id, (current) => ({
        ...current,
        messages: [...current.messages, message],
        activeLeafId: message.id,
      })), threadId, message.at);
    }
    case "editMessage": {
      // The edit replaces its message on screen the moment it is submitted:
      // an optimistic sibling becomes the leaf, which hides the old question
      // and its old answer. The server's fork carries the same sendId and
      // takes this row's place; a failed request restores the old branch.
      const animated = withMascotMotion(state, action.botId, "working");
      if (!action.sendId) return animated;
      const bot = animated.bots.find((candidate) => candidate.id === action.botId);
      const threadId = action.threadId ?? bot?.threadId;
      if (!bot || threadId !== bot.threadId) return animated;
      if (bot.messages.some((message) => message.sendId === action.sendId)) return animated;
      const source = bot.messages.find((message) => message.id === action.messageId);
      if (!source || source.role !== "user" || source.kind !== "text") return animated;
      const message = optimisticUserMessage(
        action.text.trim(),
        action.sendId,
        source.replyToId,
        source.parentId ?? null,
      );
      return updateBot(animated, bot.id, (current) => ({
        ...current,
        messages: [...current.messages, message],
        activeLeafId: message.id,
      }));
    }
    case "taskMadeConfidential":
      return updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? []).map((task) => task.threadId === action.threadId ? { ...task, confidential: true as const } : task),
      }));
    case "makeTaskConfidential":
      return state;
    case "deleteTask":
      return state;
    case "regenerateTaskTitle":
      return state;
    case "newTask":
      // A chosen folder may fail validation. Keep the conversation beneath
      // its dialog in place until the server confirms the new thread.
      return action.cwd !== undefined ? state : { ...state, selectedId: action.botId, activeView: "chat" };
    case "switchTask": {
      // Older background frames are already represented by the next server
      // snapshot. Only frames racing that request need replaying over it.
      const { [action.threadId]: _old, ...backgroundThreadEvents } = state.backgroundThreadEvents;
      return updateBot({ ...state, backgroundThreadEvents, selectedId: action.botId, activeView: "chat" }, action.botId,
        (bot) => ({ ...bot, switchingTo: action.threadId, switchPreview: undefined }));
    }
    case "previewThread":
      // Only for the switch still under way; a later switch has its own.
      return updateBot(state, action.botId, (bot) => bot.switchingTo === action.threadId
        ? { ...bot, switchPreview: { threadId: action.threadId, messages: action.page.messages, hasMore: action.page.hasMore, activeLeafId: action.page.activeLeafId } }
        : bot);
    case "switchTaskFailed":
      return updateBot(state, action.botId, (bot) => bot.switchingTo === action.threadId ? { ...bot, switchingTo: undefined, switchPreview: undefined } : bot);
    case "renameTask":
      return updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? []).map((task) =>
          task.threadId === action.threadId ? { ...task, title: action.title } : task,
        ),
      }));
    case "taskSwitched": {
      let switched = updateBot(bumpTranscriptGeneration(state, action.bot.threadId), action.bot.id, (bot) => ({
        ...bot,
        ...action.bot,
        computer: action.bot.computer,
        toolScope: action.bot.toolScope,
        messages: action.bot.messages ?? [],
        // The snapshot decides whether this thread has scrollback. Merging
        // would carry the previous thread's answer onto a new one.
        hasMore: action.bot.hasMore,
        awaitingThreadSnapshot: false,
        switchingTo: undefined,
        switchPreview: undefined,
      }));
      for (const frame of state.backgroundThreadEvents[action.bot.threadId] ?? []) switched = reduce(switched, frame);
      const { [action.bot.threadId]: _settled, ...backgroundThreadEvents } = switched.backgroundThreadEvents;
      switched = { ...switched, backgroundThreadEvents };
      // Only the conversation on screen draws a divider; a bot in the
      // background moving to another thread leaves it alone.
      const opened = switched.bots.find((bot) => bot.id === action.bot.id);
      if (opened && opened.id === switched.selectedId) {
        switched = { ...switched, unreadDivider: openedUnreadDivider(switched, opened.threadId, threadOpensUnread(opened), visibleMessages(opened), threadReadCursor(opened)) };
        // …and on screen it is read, as `select` reads the thread it opens. The
        // snapshot predates the switch's own announcement, which told the
        // server so (the "bot" frame), and must not put the dot back.
        if (switched.activeView === "chat") switched = updateBot(switched, opened.id, (bot) => readOnScreen(bot, bot.threadId));
      }
      return clearThreadReturnIfHome(reconcileModelVariantSessions(reconcileSnapshotQueues(switched, [action.bot])));
    }
    case "createRoutine":
      return state;
    case "updateRoutine":
      return state;
    case "deleteRoutine":
      return state;
    case "runRoutine":
      return state;
    case "cancelRoutineRun":
      return state;
    case "markRoutineRunSeen":
      return state;
    case "markAllRoutineRunsSeen":
      return state;
    case "clearRoutineRuns":
      return state;
    case "loadDataSheet":
      return state;
    case "dataSheet": {
      const key = dataSheetKey(action.sheet.botId, action.threadId);
      return {
        ...state,
        dataSheets: { ...state.dataSheets, [key]: action.sheet },
        ...(action.tables ? { dataTables: { ...state.dataTables, [key]: action.tables } } : {}),
      };
    }
    case "dataView":
      return { ...state, dataView: action.view };
  }
  return undefined;
}
