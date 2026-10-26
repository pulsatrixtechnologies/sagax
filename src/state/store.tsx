// Server-backed store. The React app holds no transports of its own:
// it dispatches typed commands over HTTP and folds the one SSE event
// stream from the harness server into local state. The reducer stays
// pure; everything async lives in the wrapped dispatch + SSE fold.
//
// Types, pure helpers and the sliced reducer live under ./store/.
// This file re-exports the public API and hosts StoreProvider.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { forgetConversation, readLastConversation, rememberConversation } from "@/lib/last-conversation";
import { selectionListed } from "@/lib/selection-fallback";
import { hiddenKeySet, readSidebarHidden, useSidebarHidden } from "@/lib/sidebar-hidden";
import { readLastBotSection, rememberBotSection } from "@/lib/last-bot-section";
import { useShowThreads } from "@/lib/thread-preferences";
import { noteBackAtBot, noteLeftBot, readNewChats, setOnScreenBot, writeNewChats } from "@/lib/fresh-topic";
import { isEarlierSegment } from "@/lib/single-stream";
import { t, activeLocale } from "@/lib/i18n";
import { stepUpApprovals } from "@/lib/step-up-client";
import { createBotPatchQueue } from "./bot-patch-queue";
import { useChatErrorClear } from "./chat-error";
import { migrateInstalledVoiceSettings } from "@/lib/voice-mode/settings";
import { StoreCommandsContext, StoreSourceContext, usePublishedStoreSource } from "./store-source";
import { ThreadPrefetchContext } from "./thread-prefetch";
import { createThreadPrefetcher, ThreadPageCache } from "@/lib/thread-page-cache";
import { PERSON_THREADS_HEADER, currentTaskBot, visibleMessages, configStatusFromFrame, pinBotThreadAction, openRoutineRun, continueRoutineRunInConversation, routineRunOfThread, visibleNotificationThread, openNotificationTarget, opensBesideStream, sendsToFreshTopic, freshTopicCovers, botOpensTo, awayFromMainThread, openBot, landOnBot, startNewTopic, openBotThread, openThread, threadsReadOnScreen, folderOwnerPath, personThreadKept, peopleDmReadTarget, panelFollowsSelection, openBotCatalog, closeBotCatalog, dataTablesFromResponse, dataSheetFromResponse, initialState, liveCallFromFrame, nextLiveCallLookup, ApiError, taskPatchFields, type OptionCardData, type SecretRequestCardData, type Message, type GroupDefaultResponder, type Group, type GroupTask, type ModelSelection, type Task, type ThreadOpener, type ThreadCloser, type TaskUsage, type Bot, type BotProject, type ProjectUpdatePatch, type FolderOwnerKind, type GroupTaskUpdatePatch, type TaskUpdatePatch, type ConfigStatus, type ConfigViewer, type ManagedPolicySummary, type BrowserEngineSummary, type BrowserProfile, type ConfigStatusFrame, type EngineInstall, type InstanceInfo, type AchievementsCategory, type ModelVariantSession, type AppState, type BotAnnouncement, type Action, type ThreadTarget, type BotCatalogTarget, type PanelOwner } from "./store/model";
import { reducer } from "./store/reducer";
import { createStoreDispatch } from "./store/create-store-dispatch";
import { useStoreLive } from "./store/use-store-live";
import { MESSAGE_PAGE_SIZE, api, createBotWithRole, persistTaskApproval, persistBotUpdate, requestConfirmedBotDeletion, loadSnapshotBoundary, runtimeFrameAction, type PeripheralSnapshotLoad } from "./store/api";

export type { PeripheralSnapshotLoad };

export type { MausColor } from "@/lib/mascot";
export type { RoutineRunCardData } from "../../shared/routine-run";
export type { AppSettingsSection, BotSettingsSection } from "./settings-section";

export {
  PERSON_THREADS_HEADER,
  currentTaskBot,
  visibleMessages,
  configStatusFromFrame,
  pinBotThreadAction,
  openRoutineRun,
  continueRoutineRunInConversation,
  routineRunOfThread,
  visibleNotificationThread,
  openNotificationTarget,
  opensBesideStream,
  sendsToFreshTopic,
  freshTopicCovers,
  botOpensTo,
  awayFromMainThread,
  openBot,
  landOnBot,
  startNewTopic,
  openBotThread,
  openThread,
  threadsReadOnScreen,
  folderOwnerPath,
  personThreadKept,
  peopleDmReadTarget,
  panelFollowsSelection,
  openBotCatalog,
  closeBotCatalog,
  reducer,
  dataTablesFromResponse,
  dataSheetFromResponse,
  initialState,
  liveCallFromFrame,
  nextLiveCallLookup,
  ApiError,
  MESSAGE_PAGE_SIZE,
  api,
  createBotWithRole,
  persistTaskApproval,
  persistBotUpdate,
  requestConfirmedBotDeletion,
  loadSnapshotBoundary,
  runtimeFrameAction,
};

export type {
  OptionCardData,
  SecretRequestCardData,
  Message,
  GroupDefaultResponder,
  Group,
  GroupTask,
  ModelSelection,
  Task,
  ThreadOpener,
  ThreadCloser,
  TaskUsage,
  Bot,
  BotProject,
  ProjectUpdatePatch,
  FolderOwnerKind,
  GroupTaskUpdatePatch,
  TaskUpdatePatch,
  ConfigStatus,
  ConfigViewer,
  ManagedPolicySummary,
  BrowserEngineSummary,
  BrowserProfile,
  ConfigStatusFrame,
  EngineInstall,
  InstanceInfo,
  AchievementsCategory,
  ModelVariantSession,
  AppState,
  BotAnnouncement,
  Action,
  ThreadTarget,
  BotCatalogTarget,
  PanelOwner,
};


/** Per-frame stream state lives in its OWN context: token frames update only
 * the components that read this hook (the Live call's spoken reply and the
 * floating bots' balloons), while every useStore consumer (sidebar, mascots,
 * pickers, the settled transcript) keeps its render tree untouched during a
 * stream. */
interface StreamState {
  /** in-flight assistant text per threadId */
  streaming: Record<string, string>;
  /** in-flight extended thinking per threadId (ephemeral) */
  reasoning: Record<string, string>;
}
const EMPTY_STREAM: StreamState = { streaming: {}, reasoning: {} };
/** How long a newer topic must hold before the chat on screen follows it
 * (the follow effect in StoreProvider). */
export const FOLLOW_SETTLE_MS = 600;
const StreamContext = createContext<StreamState>(EMPTY_STREAM);

type PendingDelta = { text: string; reasoning: string };

/** Stream APIs the SSE fold calls. Owned by StreamRoot so a delta's setState
 * re-renders only StreamContext consumers, not StoreProvider's tree. */
type StreamApi = {
  clearStream: (threadId: string) => void;
  flushDeltas: () => void;
  resetStreams: () => void;
  deltaBuffer: ReturnType<typeof createStreamDeltaBuffer>;
};

/** Paint once per frame, but keep draining when a hidden tab pauses rAF.
 * Flush pending chunks at 64 Ki UTF-16 characters or a 100ms fallback timer.
 * Accumulated output remains intact and unbounded; this is not a memory cap. */
export function createStreamDeltaBuffer(onFlush: (entries: Array<[string, PendingDelta]>) => void) {
  const buffer = new Map<string, PendingDelta>();
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let characters = 0;
  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    cancel();
    if (!buffer.size) return;
    const entries = [...buffer];
    buffer.clear();
    characters = 0;
    onFlush(entries);
  };
  /** Drop every pending thread. A non-resumable hydrate must call this so a
   * truncated answer cannot flush after the live map was emptied. */
  const reset = () => {
    cancel();
    buffer.clear();
    characters = 0;
  };
  return {
    push(threadId: string, kind: string, delta: string) {
      if (kind !== "assistant_text" && kind !== "reasoning_text") return;
      const entry = buffer.get(threadId) ?? { text: "", reasoning: "" };
      if (kind === "assistant_text") entry.text += delta;
      else entry.reasoning += delta;
      buffer.set(threadId, entry);
      characters += delta.length;
      if (characters >= 64 * 1024) flush();
      else if (frame === null) {
        frame = requestAnimationFrame(flush);
        timer = setTimeout(flush, 100);
      }
    },
    clear(threadId: string) {
      const entry = buffer.get(threadId);
      if (entry) characters -= entry.text.length + entry.reasoning.length;
      buffer.delete(threadId);
      if (!buffer.size) cancel();
    },
    reset,
    flush,
    dispose: reset,
  };
}

export function useStreaming() {
  return useContext(StreamContext);
}

/** The in-flight text a gallery or a test draws, without the whole store. */
export function StreamingPreview({ streaming, children }: { streaming: Record<string, string>; children?: ReactNode }) {
  const value = useMemo(() => ({ streaming, reasoning: {} }), [streaming]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Commit any debounced profile edits before an operation reads the bot. */
  flushBotPatches: (botId: string) => Promise<BotAnnouncement | null>;
  /** Re-fetch engine availability — after an install, without a restart. */
  refreshInstances: (options?: { reportErrors?: boolean }) => Promise<void>;
  /** Explicit provider/network model discovery. */
  refreshModels: (instanceId: string) => Promise<void>;
} | null>(null);

/** Lazy useReducer init: adopt the section this device last viewed once per
 * launch, so a bare open starts there. The exported initialState stays
 * "overview"/false and the reducer never touches localStorage. */
function restoreBotSettingsSection(state: AppState): AppState {
  const section = readLastBotSection();
  // An asked-for New chat outlives a reload (src/lib/fresh-topic.ts).
  const newChats = readNewChats();
  const freshTopic = Object.keys(newChats).length > 0
    ? { ...state.freshTopic, ...Object.fromEntries(Object.entries(newChats).map(([botId, threadId]) => [botId, { threadId, auto: false }])) }
    : state.freshTopic;
  const withHidden = { ...state, freshTopic, sidebarHiddenKeys: hiddenKeySet(readSidebarHidden()) };
  return section ? { ...withHidden, botSettingsSection: section, botSettingsSectionStored: true } : withHidden;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const taskWrites = useRef(new Map<string, { botId: string; updatesDefault: boolean; promise: Promise<BotAnnouncement>; execution: Promise<unknown>; patch: TaskUpdatePatch }>()).current;
  const withTaskWrites = (bot: BotAnnouncement): BotAnnouncement => ({
    ...bot,
    tasks: bot.tasks?.map((task) => ({ ...task, ...taskPatchFields(taskWrites.get(task.threadId)?.patch ?? {}) })),
  });
  const [state, rawDispatch] = useReducer(reducer, initialState, restoreBotSettingsSection);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (state.hydrated && state.config && !state.config.personalSettings) migrateInstalledVoiceSettings(state.config.tts, state.bots);
  }, [state.hydrated, state.config, state.bots]);
  const showThreads = useShowThreads();
  const showThreadsRef = useRef(showThreads);
  showThreadsRef.current = showThreads;
  // Stream state lives in StreamRoot (below): a delta's setState must not
  // re-render StoreProvider, or ChatView / the sidebar / the composer run
  // again on every token even though they do not read the stream.
  const streamApiRef = useRef<StreamApi | null>(null);
  const clearStream = useCallback((threadId: string) => {
    streamApiRef.current?.clearStream(threadId);
  }, []);
  const flushDeltas = useCallback(() => {
    streamApiRef.current?.flushDeltas();
  }, []);
  const resetStreams = useCallback(() => {
    streamApiRef.current?.resetStreams();
  }, []);
  const deltaBuffer = useMemo(() => ({
    push: (threadId: string, kind: string, delta: string) => {
      streamApiRef.current?.deltaBuffer.push(threadId, kind, delta);
    },
    dispose: () => {
      streamApiRef.current?.deltaBuffer.dispose();
    },
  }), []);
  const clearChatError = useCallback(() => {
    rawDispatch({ type: "error", message: null });
  }, []);
  useChatErrorClear(state.error, clearChatError);
  // Every selection path lands on state.selectedId, so one effect is the
  // whole remember; an empty selection must never overwrite it.
  useEffect(() => {
    if (state.selectedId) rememberConversation(state.selectedId);
  }, [state.selectedId]);
  // A remembered conversation that no longer resolves to a listed one
  // (deleted, hidden, closed) is forgotten once the snapshot says nothing
  // is open, so the next launch does not try to resume it.
  useEffect(() => {
    if (!state.hydrated || state.selectedId) return;
    const remembered = readLastConversation();
    if (remembered && !selectionListed(state.bots, state.groups, remembered, state.sidebarHiddenKeys)) forgetConversation();
  }, [state.hydrated, state.selectedId, state.bots, state.groups, state.sidebarHiddenKeys]);
  // The sidebar hidden list lives in a synced preference; the reducer gets
  // it as data so a restored or fallback selection can respect it.
  const sidebarHidden = useSidebarHidden();
  useEffect(() => {
    const keys = hiddenKeySet(sidebarHidden);
    const current = stateRef.current.sidebarHiddenKeys;
    if (keys.size === current.size && [...keys].every((key) => current.has(key))) return;
    rawDispatch({ type: "sidebarHidden", keys });
  }, [sidebarHidden]);
  // Rail clicks, deep links and remembered openings all carry the accordion
  // flag, so only a section actually viewed is written; a bare open that
  // stays collapsed never is.
  useEffect(() => {
    if (state.settingsOpen && state.botSettingsExpandAccordion) rememberBotSection(state.botSettingsSection);
  }, [state.settingsOpen, state.botSettingsExpandAccordion, state.botSettingsSection]);
  const botPatchQueue = useMemo(
    () =>
      createBotPatchQueue<BotAnnouncement>({
        send: (botId, patch, signal, currentBot) =>
          persistBotUpdate(botId, patch, signal, api, stepUpApprovals(window.ogb?.approvals), currentBot),
        reconcile: async (botId, signal) => {
          const result: { bots: BotAnnouncement[] } = await api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`, { signal });
          return result.bots.find((candidate) => candidate.id === botId) ?? null;
        },
        onAuthoritative: (bot, optimisticOverlay) => {
          rawDispatch({ type: "botPatched", bot: withTaskWrites({ ...bot, ...optimisticOverlay }) });
        },
        onError: (error) => {
          rawDispatch({ type: "error", message: error.message });
        },
      }),
    [],
  );

  useEffect(() => {
    // StrictMode's dev probe runs this cleanup once against the same memoized
    // queue; revive undoes it so profile saves survive development mounts.
    botPatchQueue.revive();
    return () => botPatchQueue.dispose();
  }, [botPatchQueue]);

  // The last pages of recently seen threads, and the sidebar's read-only
  // prefetch into them (src/lib/thread-page-cache.ts): a switch draws the
  // cached page at once, then takes the page its own request answers.
  const threadPages = useMemo(() => new ThreadPageCache<Message>(), []);
  const threadPrefetch = useMemo(() => createThreadPrefetcher({
    cache: threadPages,
    // GET, a pure read: the switch (POST) is what moves the selection
    fetchPage: async (threadId, signal) => {
      const page = await api<{ messages?: Message[]; hasMore?: boolean; activeLeafId?: string | null }>(
        `/api/threads/${encodeURIComponent(threadId)}/messages?limit=${MESSAGE_PAGE_SIZE}`, { signal });
      return { messages: page.messages ?? [], hasMore: Boolean(page.hasMore), activeLeafId: page.activeLeafId };
    },
  }), [threadPages]);

  const dispatch = useMemo(
    () =>
      createStoreDispatch({
        stateRef,
        rawDispatch,
        botPatchQueue,
        threadPages,
        withTaskWrites,
        showThreadsRef,
        taskWrites,
      }),
    [botPatchQueue],
  );

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

    const wrapped: React.Dispatch<Action> = (action) => {
      // Deferred folder creation may select its bot only while it is still
      // the latest navigation intent, even if the person went away and back.
      if (["select", "newTask", "switchTask", "newGroupTask", "switchGroupTask", "showChat", "showRoutines", "showTeamMap", "showCode", "showApprovals", "showRemoteSessions"].includes(action.type)) selectionRevision++;
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
      switch (action.type) {
        case "loadOlderMessages": {
          // The reducer's flag is for the UI; this set is the guard, because
          // `stateRef` still holds the state from before this dispatch.
          if (olderPagesInFlight.has(action.threadId)) break;
          olderPagesInFlight.add(action.threadId);
          const current = stateRef.current;
          const owner = [...current.bots, ...current.groups].find((candidate) => candidate.threadId === action.threadId);
          const before = owner?.messages[0]?.id;
          // The transcript this page is being asked about. `loadOlderMessages`
          // does not move it, so the value here is the one the reducer will
          // compare against when the answer lands.
          const generation = current.transcriptGeneration[action.threadId] ?? 0;
          // Nothing to page back from: the reducer's loading flag would never
          // be cleared by a response that is not coming.
          if (!before) {
            olderPagesInFlight.delete(action.threadId);
            rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: false });
            break;
          }
          api<{ messages: Message[]; hasMore?: boolean }>(
            `/api/threads/${action.threadId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
          )
            .finally(() => olderPagesInFlight.delete(action.threadId))
            .then((page) => rawDispatch({
              type: "olderMessages",
              threadId: action.threadId,
              generation,
              messages: page.messages ?? [],
              hasMore: Boolean(page.hasMore),
            }))
            .catch((error) => {
              // Clear the flag on the way out, or the pill stays disabled for
              // the rest of the session after one failed page.
              rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: true });
              showError(error);
            });
          break;
        }
        case "notice":
          if (action.notice) setTimeout(() => rawDispatch({ type: "notice", notice: null }), 6000);
          break;
        case "createRoutine":
          api("/api/routines", { method: "POST", body: JSON.stringify(action.input) }).catch(showError);
          break;
        case "updateRoutine": {
          // Switched on or off while its bot's conversation is open: that
          // conversation gets the "Disabled · 1 routine" line (the server
          // checks the routine is that bot's and the thread the person's).
          const open = stateRef.current.bots.find((candidate) => candidate.id === stateRef.current.selectedId);
          const conversation = action.patch.enabled !== undefined && open?.threadId ? open.threadId : null;
          api(`/api/routines/${action.routineId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
            ...(conversation ? { headers: { "content-type": "application/json", [PERSON_THREADS_HEADER]: "1", [ROUTINE_CONVERSATION_HEADER]: conversation } } : {}),
          }).catch(showError);
          break;
        }
        case "deleteRoutine":
          api(`/api/routines/${action.routineId}`, { method: "DELETE" }).catch(showError);
          break;
        case "runRoutine":
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/routines/${action.routineId}/run`, { method: "POST" }))
            .then(({ run }) => action.onStarted?.(run))
            .catch((error) => {
              if (action.onError) action.onError(error);
              else showError(error);
            })
            .finally(() => action.onSettled?.());
          break;
        case "cancelRoutineRun":
          api(`/api/routine-runs/${action.runId}/cancel`, { method: "POST" }).catch(showError);
          break;
        // The Data tab's sheet. The panel runs and cancels SQL itself (it
        // owns the request to abort); those answer through the server's
        // `data` frame (the whole sheet), so every window sees the same
        // cards. A panel-local onError keeps a server without the surface
        // from raising the app-wide error line.
        case "loadDataSheet":
          api(withDataThread(DATA_ROUTES.sheet(action.botId), action.threadId))
            .then((body) => rawDispatch({ type: "dataSheet", sheet: dataSheetFromResponse(body, action.botId), tables: dataTablesFromResponse(body), ...(action.threadId ? { threadId: action.threadId } : {}) }))
            .catch((error) => (action.onError ?? showError)(error instanceof Error ? error.message : String(error)));
          break;
        case "markRoutineRunSeen":
          api(`/api/routine-runs/${action.runId}/seen`, { method: "POST" }).catch(showError);
          break;
        case "markAllRoutineRunsSeen":
          api("/api/routine-runs/seen-all", { method: "POST" }).catch(showError);
          break;
        case "clearRoutineRuns":
          api("/api/routine-runs", { method: "DELETE" })
            .then(({ removed }) => rawDispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] }))
            .catch(showError);
          break;
        case "cancelQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}`, { method: "DELETE", body: JSON.stringify({ threadId: action.threadId }) })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}/steer`, { method: "POST", body: JSON.stringify({ threadId: action.threadId }) })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              } else if (body?.queued === true && body.blockedBy === "images") {
                // Pressed Steer, but the engine cannot take pictures mid-turn:
                // say why the message is still queued instead of nothing.
                wrapped({ type: "notice", notice: { kind: "steer-images", botName: null } });
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "cancelGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}`, { method: "DELETE" })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}/steer`, {
            method: "POST",
            body: JSON.stringify({ threadId: action.threadId }),
          })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              } else if (body?.queued === true && body.blockedBy === "images") {
                // Pressed Steer, but the engine cannot take pictures mid-turn:
                // say why the message is still queued instead of nothing.
                wrapped({ type: "notice", notice: { kind: "steer-images", botName: null } });
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "send": {
          // persist through the existing card route so an older server that
          // does not auto-dismiss still hides the quiz on this client
          if (quizBeforeSend) persistCard(action.botId, quizBeforeSend.id, { dismissed: true });
          // The first message of a fresh topic (src/lib/fresh-topic.ts): the
          // server creates the topic now, then the message goes there. No
          // empty topic is ever made ahead of it.
          if (freshSendBefore) {
            const { replyToId: _reply, ...rest } = action;
            // A second message typed while the topic is being made waits
            // for it and goes there too: one topic, never two.
            let creating = freshTopicsCreating.get(action.botId);
            if (!creating) {
              const revision = (navigation.get(action.botId) ?? 0) + 1;
              navigation.set(action.botId, revision);
              creating = botPatchQueue.flush(action.botId)
                .then(() => api<{ bot: Bot; task?: { threadId?: string } }>(`/api/bots/${action.botId}/tasks`, { method: "POST", body: JSON.stringify({ stream: true }) }))
                .then((r) => {
                  const created = r?.task?.threadId ?? r?.bot?.threadId;
                  if (!r?.bot || !created) throw new Error(t("stream.freshFailed"));
                  if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
                  if (navigation.get(action.botId) === revision) dispatch({ type: "taskSwitched", bot: r.bot });
                  rawDispatch({ type: "freshTopic", botId: action.botId, threadId: null });
                  return created;
                })
                .finally(() => freshTopicsCreating.delete(action.botId));
              freshTopicsCreating.set(action.botId, creating);
            }
            creating
              .then((threadId) => dispatch({ ...rest, threadId }))
              .catch((error) => {
                showError(error);
                action.onError?.();
              });
            break;
          }
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          beginLocalSend(sendId);
          // words typed to a bot that is on a voice call are a call turn too:
          // its answer is read aloud like the rest of the call
          const liveCallId = voiceCallId(action.botId);
          const voiceCall = action.voiceCall ?? (liveCallId ? { callId: liveCallId } : undefined);
          // on a call, words said or typed while the bot works join its turn
          const busyMode = voiceCall ? undefined : action.busyMode;
          void waitForExecutionSettings(botBeforeSend ? [botBeforeSend] : [], threadId)
            .then(() => {
              if (!claimInFlightSend(sendId)) {
                if (threadId) rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
                restoreComposerDraft(`bot:${action.botId}:${threadId ?? ""}`, { text: action.text, attachments: [] });
                return null;
              }
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.text, replyToId: action.replyToId, threadId, sendId, ...(voiceCall ? { voiceCall } : {}), ...(busyMode === "auto" ? { routeWhileBusy: true } : busyMode ? { busyMode } : {}), ...(action.dataContext ? { dataContext: action.dataContext } : {}), ...devPodsTurnField(), ...singleStreamTurnField() }),
              });
            })
            .then((body) => {
              if (body === null) return;
              action.onSent?.();
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                  reason: body.reason === "capacity" || body.reason === "group-turn" ? body.reason : undefined,
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            })
            .finally(() => finishSend(sendId));
          break;
        }
        case "stopParallelTask":
          api(`/api/bots/${action.botId}/parallel/${action.threadId}/stop`, { method: "POST", body: "{}" }).catch(showError);
          break;
        case "editMessage": {
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction, threadId)
            .then(() => api(`/api/bots/${action.botId}/messages/${action.messageId}/edit`, {
              method: "POST",
              body: JSON.stringify({ text: action.text.trim(), threadId, sendId, ...devPodsTurnField(), ...singleStreamTurnField() }),
            }))
            .then((body) => {
              // the POST may beat its SSE frames; fold the fork either way
              if (body?.message && threadId) {
                rawDispatch({ type: "messageAdded", threadId, message: body.message });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId, restoreLeafId: leafBeforeEdit });
              }
              showError(error);
            });
          break;
        }
        case "switchBranch":
          api(`/api/bots/${action.botId}/active-branch`, {
            method: "POST",
            body: JSON.stringify({ messageId: action.messageId, threadId: action.threadId }),
          }).catch(showError);
          break;
        case "decideRequest": {
          const respond = () =>
            api(`/api/threads/${action.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: action.requestId,
                behavior: action.behavior,
                message: action.message,
                reviewedSha256: action.reviewedSha256,
                always: action.always,
                rememberCommand: action.rememberCommand,
                rule: action.rule,
              }),
            });
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(async () => {
              if (action.alwaysAllow) {
                const bot = stateRef.current.bots.find((candidate) => candidate.id === action.alwaysAllow?.botId);
                // a bot-to-bot conversation (even one left out of tasks) keeps
                // its grant on that thread, never the whole bot
                const owner = bot?.tasks?.some((task) => task.threadId === action.threadId)
                  || bot?.waitingApprovals?.some((row) => row.threadId === action.threadId);
                const next = [...new Set([...(bot ? currentTaskBot(bot, action.threadId).alwaysAllow ?? [] : []), action.alwaysAllow.key])];
                // Save the grant BEFORE releasing the bot: it may ask again
                // within milliseconds. A failed preference save must still
                // let this one response through, but the person should see it.
                try {
                  await api(owner ? `/api/bots/${action.alwaysAllow.botId}/always-allow` : `/api/bots/${action.alwaysAllow.botId}`, {
                    method: owner ? "POST" : "PATCH",
                    body: JSON.stringify(owner ? { threadId: action.threadId, allowKey: action.alwaysAllow.key } : { alwaysAllow: next }),
                  });
                } catch (error) {
                  showError(error);
                }
              }
              const response = await respond();
              if (response?.settlementPending && typeof response.message === "string") {
                showError(new Error(response.message));
              }
            })
            .catch((error) => {
              // settled already, elsewhere: the card shows the real outcome
              const settled = teamMemorySettled(error);
              if (settled) {
                rawDispatch({ type: "cardSettled", threadId: action.threadId, requestId: action.requestId, patch: settled.card });
                showError(settled.text);
                action.onError?.(settled.text);
                return;
              }
              // A settings flush failure deliberately stops the response;
              // otherwise it could resume work under a stale approval level.
              showError(error);
              action.onError?.(error instanceof Error ? error.message : String(error));
            });
          break;
        }
        case "answerCard": {
          const { host, card, inRoom } = cardTarget(action);
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(() => {
              if (card?.requestId && host) {
                // allow/deny for a permission, the chosen text for a question
                // — decided from the card, never from the label (see
                // card-answer.ts). By THREAD, so a card raised inside a room
                // answers the same way a 1:1 one does.
                const response = card.skillRequest
                  ? { behavior: skillRequestBehavior(action.answer) }
                  : card.terminalRequest
                    ? { behavior: terminalRequestBehavior(action.answer) }
                    : card.meetingRequest
                      ? { behavior: meetingRequestBehavior(action.answer) }
                      : answerResponse(card, action.answer);
                return api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
                  method: "POST",
                  body: JSON.stringify({
                    requestId: card.requestId,
                    ...response,
                    reviewedSha256: response.behavior === "allow" && card.skillRequest
                      ? reviewedSkillSha256(card.skillRequest)
                      : undefined,
                    ...(card.terminalRequest && response.behavior === "allow" && action.terminalDestination
                      ? { terminalDestination: action.terminalDestination }
                      : {}),
                  }),
                });
              }
              if (inRoom) return;
              persistCard(action.botId, action.messageId, { answered: action.answer, dismissed: true });
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.answer, threadId: action.threadId }),
              });
            })
            .catch((error) => {
              // settled already, elsewhere: the card shows the real outcome
              const settled = teamMemorySettled(error);
              const threadId = action.threadId ?? host?.threadId;
              if (settled && card?.requestId && threadId) {
                rawDispatch({ type: "cardSettled", threadId, requestId: card.requestId, patch: settled.card });
                showError(settled.text);
                return;
              }
              showError(error);
            });
          break;
        }
        case "dismissCard": {
          const { host, card, inRoom } = cardTarget(action);
          if (card?.requestId && host) {
            // a question is DECLINED rather than denied — the broker refuses
            // a deny on one (see card-answer.ts)
            api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({ requestId: card.requestId, ...dismissResponse(card) }),
            }).catch(() => {});
          } else if (!inRoom) {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
        case "newBot": {
          // The picker can close/remount before React paints pending state.
          if (creatingBot) break;
          creatingBot = true;
          rawDispatch({ type: "botCreationPending", on: true });
          void createBotWithRole(action.role, api, action.visibility, action.section)
            .then(({ bot, profileError }) => {
              rawDispatch({ type: "botAdded", bot, preserveSelection: action.preserveSelection });
              action.onCreated?.(bot);
              if (profileError) {
                showError(t("newBot.profileFailed", { error: profileError }));
                rawDispatch({ type: "toggleSettings", open: true, section: "soul" });
              }
            })
            .catch((error) => {
              if (action.onError) action.onError(error instanceof Error ? error.message : String(error));
              else showError(error);
            })
            .finally(() => {
              creatingBot = false;
              rawDispatch({ type: "botCreationPending", on: false });
            });
          break;
        }
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          const duplicateProfile = {
            name: `${source.name} copy`,
            title: source.title,
            description: source.description,
            soul: source.soul,
            notifications: source.notifications,
            modelSelection: source.modelSelection,
            computer: source.computer,
            cloudBackend: source.cloudBackend,
            autoStartVps: source.autoStartVps,
            avatarUrl: source.avatarUrl,
            avatarCrop: source.avatarCrop,
            avatarZoom: source.avatarZoom,
            avatarFocusX: source.avatarFocusX,
            avatarFocusY: source.avatarFocusY,
            // a private bot's copy stays private; anything else is the default
            ...(source.teamMemorySharing !== undefined && source.teamMemorySharing !== "shared" ? { teamMemorySharing: "private" as const } : {}),
          };
          // A copy of a restricted bot is restricted from its first moment.
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify({
              ...(source.visibility && source.visibility !== "everyone" ? { visibility: source.visibility } : {}),
              ...(Object.hasOwn(source, "toolScope") ? { settings: { toolScope: source.toolScope } } : {}),
            }),
          })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                // JSON.stringify omits undefined optional fields while preserving
                // an explicit null avatar clear, so duplication mirrors the source.
                body: JSON.stringify(duplicateProfile),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          rawDispatch({ type: "botDeletionPending", botId: action.botId, on: true });
          void requestConfirmedBotDeletion(
            action.botId,
            async (botId) => {
              // Preserve edits when lifecycle guards refuse deletion, while
              // preventing an older debounced PATCH from landing after a
              // successful DELETE.
              await botPatchQueue.flush(botId);
              return api(`/api/bots/${botId}`, { method: "DELETE" });
            },
            (botId) => {
              botPatchQueue.cancel(botId);
              rawDispatch({ type: "deleteBot", botId });
            },
          )
            .catch(showError)
            .finally(() => rawDispatch({ type: "botDeletionPending", botId: action.botId, on: false }));
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const id = action.id;
          const bot = stateRef.current.bots.find((b) => b.id === id);
          const group = stateRef.current.groups.find((g) => g.id === id);
          if (bot?.unread) {
            api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) }).catch(() => {});
          } else if (group?.peopleDm) {
            // per thread: the one open, or the whole conversation when only
            // the conversation itself was marked unread
            const read = peopleDmReadTarget(group);
            if (read) api(`/api/groups/${id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
          } else if (group?.unread) {
            api(`/api/groups/${id}/read`, { method: "POST" }).catch(() => {});
          }
          break;
        }
        case "createGroup":
          api(`/api/groups`, {
            method: "POST",
            body: JSON.stringify({
              memberIds: action.memberIds,
              name: action.name,
              section: action.section,
              ...(window.ogb?.remoteClient?.active
                ? { setup: { bulletin: "", defaultResponder: { kind: "mentions" } } }
                : {}),
            }),
          })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "openPeopleDm":
          api(`/api/people-dms`, { method: "POST", body: JSON.stringify({ principalId: action.principalId }) })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "nudgePerson":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ principalId: action.principalId, ...(action.threadId ? { threadId: action.threadId } : {}) }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "nudgeGroup":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ groupId: action.groupId }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "sendGroup": {
          const threadId =
            action.threadId ?? stateRef.current.groups.find((group) => group.id === action.groupId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/groups/${action.groupId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                text: action.text,
                replyToId: action.replyToId,
                threadId,
                sendId,
                mode: action.mode ?? "chat",
              }),
            }))
            .then((body) => {
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            });
          break;
        }
        case "patchGroup":
          api(`/api/groups/${action.groupId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "deleteGroup":
          api(`/api/groups/${action.groupId}`, { method: "DELETE" }).catch(showError);
          break;
        case "setModel":
          if (action.threadId) {
            persistTaskPatch(action.botId, action.threadId, {
              modelSelection: action.selection,
              ...(action.updateBotDefault ? { updateBotDefault: true } : {}),
            });
            break;
          }
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(
              action.botId,
              { modelSelection: action.selection, threadId: botBeforeUpdate.switchingTo ?? botBeforeUpdate.threadId },
              botBeforeUpdate,
            );
          }
          break;
        case "updateTask":
          persistTaskPatch(action.botId, action.threadId, action.patch);
          break;
        case "makeTaskConfidential":
          void api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(makeConfidentialBody()),
          }).then((result) => {
            if (result?.bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(result.bot) });
            rawDispatch({ type: "taskMadeConfidential", botId: action.botId, threadId: action.threadId });
            action.onDone?.();
          }).catch((error: unknown) => {
            if (action.onError) action.onError(error instanceof Error ? error.message : String(error));
            else showError(error);
          });
          break;
        case "refreshTaskPermissions": {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          const task = bot?.tasks?.find((candidate) => candidate.threadId === action.threadId);
          if (!bot || !task) {
            showError(new Error("That thread is no longer available"));
            break;
          }
          const mode = approvalModeFor(bot);
          const current = approvalModeFor(currentTaskBot(bot, action.threadId));
          const acknowledgeLocalAuto = action.acknowledgeLocalAuto === true;
          // Full, Custom, and leaving Custom stay on the private desktop
          // channel. Ask, Edits, and Auto can use the thread settings route.
          const needsDesktop = mode === "full" || mode === "custom" || current === "custom";
          const refreshed = needsDesktop
            ? window.ogb?.approvals
              ? stepUpApprovals(window.ogb.approvals)!.setMode(action.botId, mode, {
                threadId: action.threadId, threadOnly: true, refreshPermissions: true, acknowledgeLocalAuto,
              })
              : Promise.reject(new Error("This approval change requires the packaged desktop app"))
            : api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
              method: "PATCH",
              body: JSON.stringify({ refreshPermissions: true, ...(acknowledgeLocalAuto ? { acknowledgeLocalAuto: true } : {}) }),
            }).then((result) => result.bot);
          void refreshed.then((updated) => {
            if (updated) rawDispatch({ type: "botPatched", bot: withTaskWrites(updated) });
          }).catch(showError);
          break;
        }
        case "followBotModel":
          void api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/threads/follow-model`, { method: "POST", body: "{}" })
            .then(({ bot }) => rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) }))
            .catch(showError);
          break;
        case "createProject":
          api(`${folderOwnerPath(action)}/projects`, { method: "POST", body: JSON.stringify({ name: action.name, emoji: action.emoji }) })
            .then((answer) => {
              applyFolderOwner(dispatch, action, answer);
              action.onCreated?.(answer.project);
            }).catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "updateProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "PATCH", body: JSON.stringify(action.patch) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "deleteProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "DELETE" })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onDeleted?.(); })
            .catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "reorderProjects":
          api(`${folderOwnerPath(action)}/projects/order`, { method: "PATCH", body: JSON.stringify({ projectIds: action.projectIds }) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "interrupt": {
          const interruptBody = {
            ...(action.threadId ? { threadId: action.threadId } : {}),
            ...(action.expectedUtteranceId ? { expectedUtteranceId: action.expectedUtteranceId } : {}),
          };
          api(`/api/bots/${action.botId}/interrupt`, {
            method: "POST",
            body: Object.keys(interruptBody).length ? JSON.stringify(interruptBody) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        }
        // tasks: the server answers with the bot AND the live transcript,
        // because switching changes which conversation is on screen
        case "newTask":
        case "switchTask": {
          // Opening a task from a notification or the sidebar reads THAT
          // thread, once the switch is under way: the server announces it
          // (the "bot" frame reads Bot.switchingTo) and taskSwitched marks it
          // here. Never before: a switch that fails (a thread deleted
          // meanwhile) leaves the thread it was on, and its unread, as they were.
          const revision = (navigation.get(action.botId) ?? 0) + 1;
          navigation.set(action.botId, revision);
          const selectedAtStart = selectionRevision;
          const ready = action.type === "newTask"
            ? botPatchQueue.flush(action.botId)
            : Promise.resolve();
          // A new task's thread is empty, so only the switch needs a page.
          void ready.then(() => api<{ bot: Bot }>(action.type === "newTask"
            ? `/api/bots/${action.botId}/tasks`
            : `/api/bots/${action.botId}/tasks/${action.threadId}${action.whole ? "" : `?messages=${MESSAGE_PAGE_SIZE}`}`, { method: "POST", body: JSON.stringify(action.type === "newTask" ? { projectId: action.projectId, cwd: action.cwd, ...(action.confidential !== undefined ? { confidential: action.confidential } : {}), ...(action.stream ? { stream: true } : {}) } : {}) }))
            .then((r) => {
              if (action.type === "newTask") action.onCreated?.();
              if (!r?.bot || navigation.get(action.botId) !== revision) return;
              const selectsAfterCreation = action.type === "newTask" && action.cwd !== undefined;
              if (selectsAfterCreation && selectionRevision !== selectedAtStart) return;
              if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
              dispatch({ type: "taskSwitched", bot: r.bot });
              if (selectsAfterCreation) rawDispatch({ type: "select", id: action.botId });
            })
            .catch((error) => {
              // The latest switch, failed, leaves the thread it was on on screen.
              if (action.type === "switchTask" && navigation.get(action.botId) === revision) {
                rawDispatch({ type: "switchTaskFailed", botId: action.botId, threadId: action.threadId });
              }
              if (action.type === "newTask" && action.onError) action.onError(error instanceof Error ? error.message : String(error));
              else showError(error);
            });
          break;
        }
        case "renameTask":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "regenerateTaskTitle":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}/title`, { method: "POST" })
            .then(() => action.onSettled?.(true))
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        case "deleteTask":
          threadPages.delete(action.threadId);
          api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.bot && dispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        // Channel tasks mirror bot tasks, but hydrate the whole channel so
        // switching atomically replaces its transcript, folder and pin.
        case "newGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks`, { method: "POST", body: JSON.stringify(action.projectId ? { projectId: action.projectId } : {}) })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "switchGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}?messages=${MESSAGE_PAGE_SIZE}`, { method: "POST" })
            .then((r) => {
              if (!r?.group) return;
              dispatch({ type: "groupPatched", group: r.group });
              // A person conversation: opening an unread thread reads it,
              // for this person only (server/people-dms.ts).
              const read = peopleDmReadTarget(r.group);
              if (read) api(`/api/groups/${action.groupId}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            })
            .catch(showError);
          break;
        case "updateGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "renameGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "pinGroupTask":
          // title is echoed so an older server rewrites the same title
          // instead of blanking a pin-only body into "Untitled".
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: action.pinned, title: action.title }),
          }).catch(showError);
          break;
        case "setConversationTurnLimit":
          api(action.dm ? `/api/groups/${action.groupId}` : `/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ turnTimeoutMinutes: action.minutes }),
          }).catch(showError);
          break;
        case "deleteGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "setGroupHold":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/holds`, {
            method: "POST",
            body: JSON.stringify({ botId: action.botId, held: action.held }),
          })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "interruptGroup":
          api(`/api/groups/${action.groupId}/interrupt`, {
            method: "POST",
            body: action.threadId ? JSON.stringify({ threadId: action.threadId }) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        case "updateBot": {
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(action.botId, action.patch, botBeforeUpdate);
          }
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, [botPatchQueue]);

  // The app opens the bot it remembers as that bot's row would (openBot):
  // with threads hidden at its main thread, not at a thread an activity row
  // or a notification left it on, where the person's next words would make
  // that thread theirs and leave their own conversation behind. Once, at the
  // first snapshot. With threads shown the bot stays where it was.
  const launched = useRef(false);
  // A follow waits until the newer topic has held for FOLLOW_SETTLE_MS
  // (2026-11-03): a thread that is the newest plain one for a frame or two
  // (a routine run's task before its tag, a frame racing a switch) made the
  // chat switch to it and back, a flicker on every run.
  const follow = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelFollow = () => {
    if (follow.current) clearTimeout(follow.current.timer);
    follow.current = null;
  };
  useEffect(() => cancelFollow, []);
  useEffect(() => {
    if (!state.hydrated) return;
    const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
    const first = !launched.current;
    launched.current = true;
    if (!bot || state.activeView !== "chat") {
      cancelFollow();
      return;
    }
    // With one conversation the thread on screen is always the conversation
    // (shared/single-stream.ts): at launch, after a reconnect that adopted
    // the server's selection, and when another device or a routine started
    // a newer topic, the window follows it (the reference design: one
    // transcript per bot, on every device). Never while a switch is under
    // way. With threads shown the bot stays where it was, once checked.
    const target = botOpensTo(bot, showThreads);
    if (first) {
      cancelFollow();
      if (!bot.switchingTo && target !== bot.threadId) openBot(dispatch, bot, showThreads);
      // Launching the app is a return too: after the threshold (since the
      // conversation went quiet, or since the app closed) a fresh topic.
      else if (!showThreads) landOnBot(dispatch, bot, bot.threadId, { force: true });
      return;
    }
    if (showThreads || bot.switchingTo || target === bot.threadId) {
      cancelFollow();
      return;
    }
    const key = `${bot.id}\u0000${bot.threadId}\u0000${target}`;
    if (follow.current?.key === key) return;
    cancelFollow();
    follow.current = {
      key,
      timer: setTimeout(() => {
        follow.current = null;
        const now = stateRef.current;
        const live = now.bots.find((candidate) => candidate.id === bot.id);
        if (!live || now.selectedId !== bot.id || now.activeView !== "chat" || live.switchingTo || showThreadsRef.current) return;
        if (botOpensTo(live, false) === target && target !== live.threadId) openBot(dispatch, live, false, { landing: false });
      }, FOLLOW_SETTLE_MS),
    };
  }, [state.hydrated, state.bots, state.selectedId, state.activeView, showThreads, dispatch]);

  // An asked-for New chat is kept on this device (src/lib/fresh-topic.ts)
  // while it still covers the bot's conversation: a newer topic made
  // elsewhere, or a bot gone, lets it go.
  useEffect(() => {
    if (!state.hydrated) return;
    const kept: Record<string, string> = {};
    for (const [botId, draft] of Object.entries(state.freshTopic)) {
      if (draft.auto) continue;
      const bot = state.bots.find((candidate) => candidate.id === botId);
      if (!bot || !bot.tasks?.some((task) => task.threadId === draft.threadId)) continue;
      if (isEarlierSegment(bot.tasks, draft.threadId, bot.threadId)) continue;
      kept[botId] = draft.threadId;
    }
    writeNewChats(kept);
  }, [state.hydrated, state.freshTopic, state.bots]);

  // Fresh topic on return (src/lib/fresh-topic.ts): which bot is on screen,
  // when the person left it (another bot or view, the window hidden, the app
  // closing) and, when the window comes back after the threshold, a fresh
  // topic over the conversation at rest.
  const onScreenId = state.hydrated && state.activeView === "chat" && state.bots.some((bot) => bot.id === state.selectedId) ? state.selectedId : null;
  useEffect(() => {
    if (!onScreenId) return;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    if (visible()) {
      setOnScreenBot(onScreenId);
      noteBackAtBot(onScreenId);
    }
    // Hidden or minimized, or another app in front (blur): away. Focus moving
    // into a frame of this page (the built-in browser) is not leaving.
    const onVisibility = (event?: Event) => {
      if (event?.type === "blur" && document.hasFocus()) return;
      if (event?.type === "blur" && document.activeElement instanceof HTMLIFrameElement) return;
      if (!visible() || event?.type === "blur") {
        setOnScreenBot(null);
        noteLeftBot(onScreenId, Date.now());
        return;
      }
      const bot = stateRef.current.bots.find((candidate) => candidate.id === onScreenId);
      if (bot && !showThreads && stateRef.current.freshTopic[onScreenId]?.threadId !== bot.threadId) {
        landOnBot(dispatch, bot, bot.threadId, { force: true });
      }
      setOnScreenBot(onScreenId);
      noteBackAtBot(onScreenId);
    };
    const onPageHide = () => noteLeftBot(onScreenId, Date.now());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // Another bot, another view: this one is left now, and a fresh topic
      // coming back put there goes (the next return asks the rule again).
      if (visible()) noteLeftBot(onScreenId, Date.now());
      setOnScreenBot(null);
      if (stateRef.current.freshTopic[onScreenId]?.auto) dispatch({ type: "freshTopic", botId: onScreenId, threadId: null });
    };
  }, [onScreenId, showThreads, dispatch]);

  useStoreLive({
    stateRef,
    rawDispatch,
    dispatch,
    clearStream,
    flushDeltas,
    resetStreams,
    deltaBuffer,
    withTaskWrites,
    botPatchQueue,
    showThreadsRef,
  });

    // A snapshot and the live fold have to meet at a defined boundary. Start
    // hydration only after the stream says hello, queue frames that arrive
    // while the REST snapshot is in flight, then apply them on top. Otherwise
    // a late hydrate can overwrite a newer event, or an event can land between
    // an eager request and the stream opening and disappear entirely.
    let hydrated = false;
    let hydrationPromise: Promise<boolean> | null = null;
    let rehydrateRequested = false;
    const pendingFrames: ServerFrame[] = [];
    let handleFrame: (frame: ServerFrame) => void;
    const hydrate = (): Promise<boolean> => {
      if (hydrationPromise) {
        // A second non-resumable hello means this snapshot may have started
        // before another connection gap. Run one more after it settles.
        rehydrateRequested = true;
        return hydrationPromise;
      }
      hydrated = false;
      hydrationPromise = (async () => {
        let loaded = false;
        do {
          rehydrateRequested = false;
          loaded = await loadAll();
        } while (alive && rehydrateRequested);
        if (!alive || !loaded) return false;
        hydrated = true;
        for (const frame of pendingFrames.splice(0)) handleFrame(frame);
        return true;
      })().finally(() => {
        hydrationPromise = null;
      });
      return hydrationPromise;
    };
    // If SSE is unavailable, the app should still show its saved state. A
    // later first hello hydrates again because it cannot prove there was no
    // gap before that connection opened.
    const hydrationFallback = setTimeout(hydrate, 1_000);

    // The hydrate decision belongs to the hello frame, not to onopen: the
    // server replays what we missed when it can, and re-downloading every
    // transcript on a reconnect it already covered is pure waste.
    handleFrame = (frame) => {
      if (frame.kind === "config") bumpPeripheralVersion("config", "instances");
      else if (frame.kind === "routine" || frame.kind === "routine.deleted" || frame.kind === "routine.run") {
        bumpPeripheralVersion("routines");
      } else if (
        frame.kind === "webhook" ||
        frame.kind === "webhook.attempt" ||
        frame.kind === "webhook.deleted"
      ) {
        bumpPeripheralVersion("webhooks");
      }
      switch (frame.kind) {
        case "sections":
          rawDispatch({ type: "sections", sections: frame.sections });
          break;
        case "bot.queued":
          rawDispatch({ type: "botQueues", queues: frame.queues });
          break;
        case "message": {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message as Message });
          if (frame.message?.role === "user" && typeof frame.message.queueId === "string") {
            rawDispatch({
              type: "consumePendingQueued",
              threadId: frame.threadId,
              queueId: frame.message.queueId,
            });
          }
          // a settled assistant bubble replaces the in-flight stream
          if (frame.message?.role === "bot" && frame.message?.kind === "text") {
            clearStream(frame.threadId);
            // Auto-speak lives HERE rather than in the chat view so a bot
            // you switched away from still reads its answer out — which is
            // the whole point of listening while you do something else. A
            // Auto-speak is disabled during any call. Call mode owns both the
            // singleton speaker and microphone ordering for its whole lifetime.
            const owner = stateRef.current.bots.find((b) => b.threadId === frame.threadId || b.tasks?.some((task) => task.threadId === frame.threadId));
            const live = stateRef.current.liveCall;
            const onLiveCall = Boolean(live && live.status !== "ended" && live.botId === owner?.id);
            if (owner?.speakReplies && currentCall() === null && !onLiveCall && frame.message.text?.trim()) {
              void speaker.speak(frame.message.text, {
                botId: owner.id,
                messageId: frame.message.id,
                voiceId: owner.voice,
              });
            }
          }
          break;
        }
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message as Message });
          break;
        case "thread":
          rawDispatch({ type: "threadActive", threadId: frame.threadId, activeLeafId: frame.activeLeafId });
          // a rewind also invalidates any half-streamed text from the old branch
          clearStream(frame.threadId);
          break;
        case "bot": {
          const bot = frame.bot as BotAnnouncement;
          // reading the selected chat clears its badge immediately: the
          // thread on screen, the one a switch is opening while it is under
          // way (this frame may be its own announcement), never one it leaves
          const selected = stateRef.current.bots.find((candidate) => candidate.id === bot.id);
          const shown = selected?.switchingTo ?? selected?.threadId;
          const selectedTask = bot.tasks?.find((task) => task.threadId === shown);
          // Under a fresh topic the thread is not on screen: its answer stays
          // unread, so the topic gives way and shows it (ChatView).
          const covered = stateRef.current.freshTopic[bot.id]?.threadId === shown;
          if (!covered && bot.id === stateRef.current.selectedId && stateRef.current.activeView === "chat" &&
              (selectedTask?.unread || (!bot.tasks && bot.unread))) {
            if (selectedTask) selectedTask.unread = false;
            // Hidden routine runs must not put the dot back on the next frame.
            // No task list: the bot flag is the unread signal.
            bot.unread = botShowsUnread(bot);
            fetch(`/api/bots/${bot.id}/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: shown }) }).catch(() => {});
          }
          rawDispatch({
            type: "botPatched",
            bot: withTaskWrites({ ...bot, ...botPatchQueue.overlayFor(bot.id) }),
          });
          break;
        }
        case "group": {
          const group = frame.group as Partial<Group> & { id: string };
          const held = stateRef.current.groups.find((candidate) => candidate.id === group.id);
          if (group.peopleDm || held?.peopleDm) {
            // A person conversation: the frame names its default thread;
            // this client keeps the one it has open (groupPatched), and
            // reads that thread only, so a sibling's dot stays.
            const open = held && personThreadKept(held, group) ? held.threadId : group.threadId;
            if (group.id === stateRef.current.selectedId && open) {
              const read = peopleDmReadTarget({ ...group, threadId: open, tasks: group.tasks ?? held?.tasks });
              if (read) api(`/api/groups/${group.id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            }
            rawDispatch({ type: "groupPatched", group });
            // the thread on screen was deleted (by the other person): open
            // the default one with its messages
            if (held && group.tasks && !group.tasks.some((task) => task.threadId === held.threadId) && typeof group.threadId === "string") {
              dispatch({ type: "switchGroupTask", groupId: group.id, threadId: group.threadId });
            }
            break;
          }
          // reading the selected room clears its badge immediately
          if (group.unread && group.id === stateRef.current.selectedId) {
            group.unread = false;
            fetch(`/api/groups/${group.id}/read`, { method: "POST" }).catch(() => {});
          }
          rawDispatch({ type: "groupPatched", group });
          break;
        }
        // the harness decided this was worth interrupting for; the toggle
        // in each bot's settings is what gates it, server-side
        case "notify":
          // the wrapped dispatch, not rawDispatch: `select` clears the badge
          // in local state either way, but only the wrapper PATCHes
          // unread:false back. Opening a bot from its own notification and
          // watching the badge return on the next hydration is exactly the
          // bug that makes notifications feel broken. Opened as the sidebar
          // shows threads when it is clicked.
          showNotification(
            frame.notification,
            (target) => openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current),
            stateRef.current.bots.find((bot) => bot.id === frame.notification.botId)?.avatarUrl,
            visibleNotificationThread(stateRef.current),
          );
          break;
        case "notify-withdraw":
          withdrawNotification(approvalWithdrawKey(frame.threadId, frame.requestId));
          break;
        case "group.deleted":
          rawDispatch({ type: "groupDeleted", groupId: frame.groupId });
          break;
        case "routine":
          rawDispatch({ type: "routinePatched", routine: frame.routine });
          break;
        case "routine.deleted":
          rawDispatch({ type: "routineDeleted", routineId: frame.routineId });
          break;
        // a person's own unlocks (server/achievements.ts sends them to their streams only)
        case "achievements":
          receiveAchievementsFrame(frame);
          break;
        // a person's preferences saved on another device (or this one): the
        // sync module applies them to this page (src/lib/user-preferences-sync.ts)
        case "preferences":
          announceServerPreferences(frame);
          break;
        case "routine.run":
          rawDispatch({ type: "routineRunPatched", run: frame.run });
          break;
        case "webhook":
          rawDispatch({ type: "webhookPatched", webhook: frame.webhook });
          break;
        case "webhook.attempt":
          rawDispatch({ type: "webhookAttempted", attempt: frame.attempt });
          break;
        case "webhook.deleted":
          rawDispatch({ type: "webhookDeleted", webhookId: frame.webhookId });
          break;
        case "runtime": {
          const event = frame.event;
          const action = runtimeFrameAction(event);
          if (action) rawDispatch(action);
          if (event.type === "content.delta") {
            deltaBuffer.push(event.threadId, event.streamKind, event.delta);
          } else if (event.type === "turn.completed") {
            // flush any buffered tail before clearing so no tokens are lost
            flushDeltas();
            clearStream(event.threadId);
          }
          break;
        }
        case "screen":
          // The picture went to the Computer panel (publishLiveFrame). For
          // the store, a first frame only means the computer is set up.
          if (stateRef.current.computerStarts[frame.botId]) {
            rawDispatch({ type: "computerStart", botId: frame.botId, start: null });
          }
          break;
        case "computer":
          rawDispatch({ type: "computerStart", botId: frame.botId,
            start: { state: frame.state, ...(frame.place ? { place: frame.place } : {}) } });
          break;
        case "computer-control":
          rawDispatch({
            type: "computerControl",
            botId: frame.botId,
            held: frame.held === true,
            helpReason: typeof frame.helpReason === "string" ? frame.helpReason : null,
            help: parseComputerHelp(frame.help),
          });
          break;
        case "data":
          rawDispatch({ type: "dataSheet", sheet: frame.sheet, ...(typeof frame.threadId === "string" && frame.threadId ? { threadId: frame.threadId } : {}) });
          break;
        case "bot.deleted":
          botPatchQueue.cancel(frame.botId);
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        case "cloud.agent":
          window.dispatchEvent(new CustomEvent("sagax-cloud-agent", { detail: { botId: frame.botId, item: frame.item } }));
          break;
        case "artifacts":
          // Ids only (server/artifacts.ts): the Files tab and the palette fetch again.
          window.dispatchEvent(new CustomEvent(ARTIFACTS_EVENT, { detail: { botId: frame.botId, artifactId: frame.artifactId, deleted: frame.deleted === true } }));
          break;
        case "live.call": {
          const framed = liveCallFromFrame(frame);
          // Rendered at once: a bot message frame right behind this one
          // decides auto-speak from stateRef, which must know the call by then.
          if (framed) flushSync(() => rawDispatch({ type: "liveCall", call: framed.call }));
          break;
        }
        case "bot-act": {
          const command = uiCommandToAction(frame.action, frame.input);
          // a preference on this device (sagax_settings): written where its
          // module reads it, then announced like another tab's change
          if (command && command.action.type === "setPreference") {
            applyBotPreference(String(command.action.key), String(command.action.value));
            break;
          }
          if (command) dispatch(command.action as Action);
          break;
        }
        // addressed to this person only (server/nudge.ts): front, shake, ring, notify
        case "nudge":
          void onNudgeReceived(frame, (target) => openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current));
          break;
        case "voice.opener":
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("sagax-voice-opener", { detail: frame }));
          }
          break;
        case "voice.call.ended":
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(VOICE_CALL_ENDED_EVENT, { detail: frame }));
          }
          break;
        // a nudge this person sent, on each of their windows: front, shake, ring
        case "nudge.sent":
          void onNudgeSentEcho(frame);
          break;
        case "presence.changed":
          applyPresenceFrame(frame);
          break;
        // organization admins only: the approvals waiting for an admin
        case "org.approvals":
          receiveOrgApprovalsFrame(frame, () => dispatch({ type: "toggleAppSettings", open: true, section: "organization" }));
          break;
        case "person.label":
          applyPersonLabel(frame.principalId, frame.label);
          break;
        // a person changed their own photo (src/lib/person-avatars.ts)
        case "person.avatar": {
          const change = { principalId: frame.principalId, avatarUrl: frame.avatarUrl };
          const config = stateRef.current.config;
          const next = config ? withViewerAvatar(config, change) : config;
          if (next && next !== config) rawDispatch({ type: "configStatus", config: next });
          announcePersonAvatar(change);
          break;
        }
        // a read position moved (src/lib/read-receipts-feed.ts)
        case "thread.read":
          receiveThreadReadFrame(frame);
          break;
        // a key changed and the fleet hot-reloaded — refresh the picker so
        // newly available providers un-dim immediately
        case "config":
          rawDispatch({
            type: "configStatus",
            config: configStatusFromFrame(frame as unknown as ConfigStatusFrame),
          });
          {
            const instances = partByKey.get("instances");
            if (instances) {
              void loadPeripheral(instances, true).catch((error) =>
                schedulePeripheralRetry(instances, error),
              );
            }
          }
          break;
      }
    };
    const stopLive = openLiveEvents({
      onOpen: () => rawDispatch({ type: "connected", value: true }),
      onError: () => rawDispatch({ type: "connected", value: false }),
      onSnapshotRequired: () => {
        clearTimeout(hydrationFallback);
        publishMissedFrames();
        // Frames buffered before this non-resumable stream belong to an
        // abandoned generation. Keep the new generation behind hydrate().
        pendingFrames.splice(0);
        return hydrate();
      },
      onFrame: (frame) => {
        // Open panels read what the store does not keep (live screens, raw
        // runtime events) from this same stream.
        publishLiveFrame(frame as ServerFrame);
        if (hydrated) handleFrame(frame as ServerFrame);
        else pendingFrames.push(frame as ServerFrame);
      },
    });
    return () => {
      alive = false;
      deltaBuffer.dispose();
      clearTimeout(hydrationFallback);
      for (const refresh of peripheralRefresh.values()) {
        if (refresh.timer) clearTimeout(refresh.timer);
      }
      stopLive();
    };
  }, []);

  // Re-probe the engines on demand. A CLI installed while the app is running
  // is invisible until something asks again — the setup screens expose this
  // as "Check again" so the user isn't told to restart when a refresh will do.
  const instanceProbe = useRef<Promise<void> | null>(null);
  const refreshInstances = useCallback(async (options?: { reportErrors?: boolean }) => {
    // Focus and an explicit Check again can arrive together. Share the probe,
    // but let the explicit caller display failure without breaking background callers.
    const probe = instanceProbe.current ??= api("/api/instances", { timeoutMs: 120_000 }).then(({ instances }) => {
      // Keep the last usable list if a proxy returns an empty/non-JSON 200.
      if (!Array.isArray(instances)) throw new Error(t("engineSetup.invalidStatus"));
      rawDispatch({ type: "instances", instances });
    });
    try {
      await probe;
    } catch (error) {
      if (options?.reportErrors) throw error;
      // Offline: retain the existing list for background callers.
    } finally {
      if (instanceProbe.current === probe) instanceProbe.current = null;
    }
  }, []);

  const refreshModels = useCallback(async (instanceId: string) => {
    const { instances } = await api(`/api/instances/${encodeURIComponent(instanceId)}/refresh-models`, {
      method: "POST",
    });
    rawDispatch({ type: "instances", instances });
  }, []);

  // Installing a CLI or signing one in happens in a terminal, outside this
  // window — so the moment the user comes back is exactly when our engine
  // snapshot is most likely stale. Re-probe on focus, throttled so that
  // ordinary alt-tabbing doesn't spawn a `--version` call per switch.
  const lastFocusProbe = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusProbe.current < 3000) return;
      lastFocusProbe.current = now;
      void refreshInstances();
    };
    window.addEventListener("focus", onFocus);
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshInstances]);

  const flushBotPatches = useCallback(
    (botId: string) => botPatchQueue.flush(botId),
    [botPatchQueue],
  );
  const value = useMemo(
    () => ({ state, dispatch, flushBotPatches, refreshInstances, refreshModels }),
    [state, dispatch, flushBotPatches, refreshInstances, refreshModels],
  );
  // The isolated UI preview (scripts/testing/preview-fixture.ts) sets this
  // flag so a harness can open the catalogue. The packaged app never does.
  useEffect(() => {
    const host = window as Window & { __sagaxUiHarness?: boolean; __sagaxDispatch?: typeof dispatch };
    if (!host.__sagaxUiHarness) return;
    host.__sagaxDispatch = dispatch;
    return () => {
      if (host.__sagaxDispatch === dispatch) delete host.__sagaxDispatch;
    };
  }, [dispatch]);
  // Selector reads (store-selector.ts): the same state, for components that
  // render only when the slice they read changes.
  const source = usePublishedStoreSource(state, dispatch);
  const commands = useMemo(() => ({ flushBotPatches, refreshInstances, refreshModels }), [flushBotPatches, refreshInstances, refreshModels]);
  return (
    <StoreSourceContext.Provider value={source}>
      <StoreCommandsContext.Provider value={commands}>
        <StoreContext.Provider value={value}>
          <ThreadPrefetchContext.Provider value={threadPrefetch}>
            <StreamRoot apiRef={streamApiRef}>{children}</StreamRoot>
          </ThreadPrefetchContext.Provider>
        </StoreContext.Provider>
      </StoreCommandsContext.Provider>
    </StoreSourceContext.Provider>
  );
}

/** Owns the in-flight stream map and the per-frame delta buffer. Keeping
 * setState here (not in StoreProvider) means a content.delta only re-renders
 * useStreaming consumers — LiveReply, TurnPresence, a floating bot — while
 * ChatView and the rest of the tree keep their last commit. children is the
 * element App passed in; when only this root updates, React reuses that
 * element and skips the non-consumers. */
function StreamRoot({
  apiRef,
  children,
}: {
  apiRef: { current: StreamApi | null };
  children: ReactNode;
}) {
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);
  const deltaBuffer = useMemo(() => createStreamDeltaBuffer((entries) => {
    setStream((prev) => {
      const streaming = { ...prev.streaming };
      const reasoning = { ...prev.reasoning };
      for (const [threadId, d] of entries) {
        if (d.text) streaming[threadId] = (streaming[threadId] ?? "") + d.text;
        if (d.reasoning) reasoning[threadId] = (reasoning[threadId] ?? "") + d.reasoning;
      }
      return { streaming, reasoning };
    });
  }), []);
  const flushDeltas = deltaBuffer.flush;
  const clearStream = (threadId: string) => {
    // Drop the thread's un-flushed deltas too: the settled message that
    // triggered this clear already contains them. Without this, the pending
    // rAF re-creates a "ghost" stream holding the tail fragment, and the
    // next block's deltas append onto the duplicated tail instead of
    // starting fresh.
    deltaBuffer.clear(threadId);
    setStream((prev) => {
      if (!(threadId in prev.streaming) && !(threadId in prev.reasoning)) return prev;
      const { [threadId]: _s, ...streaming } = prev.streaming;
      const { [threadId]: _r, ...reasoning } = prev.reasoning;
      return { streaming, reasoning };
    });
  };
  // A non-resumable hello hydrates from REST and never replays the missed
  // turn.completed / final message frames, so any half-written live text must
  // go: otherwise LiveReply keeps the truncated bubble under the settled
  // transcript and the next turn's deltas prepend onto it (#1749).
  const resetStreams = () => {
    deltaBuffer.reset();
    setStream(EMPTY_STREAM);
  };
  apiRef.current = { clearStream, flushDeltas, resetStreams, deltaBuffer };
  return <StreamContext.Provider value={stream}>{children}</StreamContext.Provider>;
}

/** The store when there is one; null outside a provider (static renders, tests). */
export function useStoreOptional() {
  return useContext(StoreContext);
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

/** Scoped state for an unsaved editor. The parent workspace remains intact. */
export function BotEditorStore({ value, children }: { value: ReturnType<typeof useStore>; children: ReactNode }) {
  // Selector reads inside the editor see its scoped state, not the workspace's.
  const source = usePublishedStoreSource(value.state, value.dispatch);
  const { flushBotPatches, refreshInstances, refreshModels } = value;
  const commands = useMemo(() => ({ flushBotPatches, refreshInstances, refreshModels }), [flushBotPatches, refreshInstances, refreshModels]);
  return (
    <StoreSourceContext.Provider value={source}>
      <StoreCommandsContext.Provider value={commands}>
        <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
      </StoreCommandsContext.Provider>
    </StoreSourceContext.Provider>
  );
}

// Building a formatter costs far more than formatting with one, and every
// row shows a time: build it once per app language (the person's choice in
// Settings, not the system's, #1077).
let timeFormat: { locale: string; format: Intl.DateTimeFormat } | undefined;
function timeFormatter(): Intl.DateTimeFormat {
  const locale = activeLocale();
  if (timeFormat?.locale !== locale) timeFormat = { locale, format: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }) };
  return timeFormat.format;
}

export function formatTime(at: number) {
  const date = new Date(at);
  // what toLocaleTimeString says, where a formatter would throw
  return Number.isNaN(date.getTime()) ? "Invalid Date" : timeFormatter().format(date);
}

