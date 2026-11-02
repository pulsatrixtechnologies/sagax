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
import { noteBackAtBot, noteLeftBot, setOnScreenBot } from "@/lib/fresh-topic";
import { t, activeLocale } from "@/lib/i18n";
import { stepUpApprovals } from "@/lib/step-up-client";
import { createBotPatchQueue } from "./bot-patch-queue";
import { useChatErrorClear } from "./chat-error";
import { migrateInstalledVoiceSettings } from "@/lib/voice-mode/settings";
import { StoreSourceContext, usePublishedStoreSource } from "./store-source";
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
const StreamContext = createContext<StreamState>(EMPTY_STREAM);

type PendingDelta = { text: string; reasoning: string };

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
  const withHidden = { ...state, sidebarHiddenKeys: hiddenKeySet(readSidebarHidden()) };
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
  // per-frame stream-delta batching (see the "runtime" SSE case); stream
  // state is intentionally OUTSIDE the reducer so token frames re-render
  // only StreamContext consumers
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


  // The app opens the bot it remembers as that bot's row would (openBot):
  // with threads hidden at its main thread, not at a thread an activity row
  // or a notification left it on, where the person's next words would make
  // that thread theirs and leave their own conversation behind. Once, at the
  // first snapshot. With threads shown the bot stays where it was.
  const launched = useRef(false);
  useEffect(() => {
    if (!state.hydrated) return;
    const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
    const first = !launched.current;
    launched.current = true;
    if (!bot || state.activeView !== "chat") return;
    // With one conversation the thread on screen is always the conversation
    // (shared/single-stream.ts): at launch, after a reconnect that adopted
    // the server's selection, and when another device or a routine started
    // a newer topic, the window follows it (the reference design: one
    // transcript per bot, on every device). Never while a switch is under
    // way. With threads shown the bot stays where it was, once checked.
    if ((first || !showThreads) && !bot.switchingTo && botOpensTo(bot, showThreads) !== bot.threadId) openBot(dispatch, bot, showThreads, first ? {} : { landing: false });
    // Launching the app is a return too: after the threshold (since the
    // conversation went quiet, or since the app closed) a fresh topic.
    else if (first && !showThreads) landOnBot(dispatch, bot, bot.threadId, { force: true });
  }, [state.hydrated, state.bots, state.selectedId, state.activeView, showThreads, dispatch]);

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
  return (
    <StoreSourceContext.Provider value={source}>
      <StoreContext.Provider value={value}>
        <ThreadPrefetchContext.Provider value={threadPrefetch}>
          <StreamContext.Provider value={stream}>{children}</StreamContext.Provider>
        </ThreadPrefetchContext.Provider>
      </StoreContext.Provider>
    </StoreSourceContext.Provider>
  );
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
  return (
    <StoreSourceContext.Provider value={source}>
      <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
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

