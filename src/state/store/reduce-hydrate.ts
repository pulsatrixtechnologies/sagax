// Domain slice of the client store reduce(hydrate).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {mergeTaskStamps, reconcileSnapshotQueues, replaceBotQueues, type Message} from "./model";
import {fallbackSelection, selectionListed} from "@/lib/selection-fallback";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceHydrate(state: AppState, action: Action, reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "provisionalExpired":
      return state.provisional
        ? { ...state, provisional: undefined, bots: [], groups: [], sections: [], selectedId: "" }
        : state;
    case "hydrate": {
      // A stored drawing (ui-snapshot.ts) is replaced, never merged: none of
      // its stamps, selection or rows outlive the server's snapshot.
      if (state.provisional) {
        return reduce({ ...state, provisional: undefined, bots: [], groups: [], sections: [], selectedId: "" }, action);
      }
      // A snapshot with a missing list (a gallery page whose /api/bots is not
      // answered, an older server) hydrates as an empty one, never a crash.
      const snapshotBots = action.bots ?? [];
      const snapshotGroups = action.groups ?? [];
      const known = (id: string) => snapshotBots.some((b) => b.id === id) || snapshotGroups.some((g) => g.id === id);
      const resume = action.resumeId;
      // A remembered conversation only counts while it still resolves to a
      // conversation the sidebar lists; a deleted, hidden or closed one
      // falls back, and the fallback is listed too or nothing at all.
      const hidden = state.sidebarHiddenKeys;
      const resumed = resume && selectionListed(snapshotBots, snapshotGroups, resume, hidden) ? resume : "";
      const selectedId =
        state.selectedId && known(state.selectedId) ? state.selectedId : resumed || fallbackSelection(snapshotBots, snapshotGroups, hidden);
      const hydrated = {
        ...state,
        bots: snapshotBots.map((bot) => {
          const previous = state.bots.find((candidate) => candidate.id === bot.id);
          return previous ? { ...bot, tasks: mergeTaskStamps(previous.tasks, bot.tasks) } : bot;
        }),
        groups: snapshotGroups.map((group) => {
          const previous = state.groups.find((candidate) => candidate.id === group.id);
          return previous ? { ...group, tasks: mergeTaskStamps(previous.tasks, group.tasks) } : group;
        }),
        sections: action.sections ?? [],
        computerControl: action.computerControl,
        selectedId,
        hydrated: true as const,
        backgroundThreadEvents: {},
        loadingOlder: {},
        transcriptGeneration: {},
        modelVariantSessions: {},
      };
      return reconcileSnapshotQueues(
        action.botQueuedMessages ? replaceBotQueues(hydrated, action.botQueuedMessages) : hydrated,
        [...snapshotBots, ...snapshotGroups],
      );
    }
    case "loadOlderMessages":
      return state.loadingOlder[action.threadId]
        ? state
        : { ...state, loadingOlder: { ...state.loadingOlder, [action.threadId]: true } };
    case "olderMessages": {
      const { [action.threadId]: _done, ...loadingOlder } = state.loadingOlder;
      // The page describes the transcript as it was when it was asked for.
      // If that transcript has since been replaced or rewound, the rows it
      // carries may belong to an abandoned branch — drop them, but never
      // leave the pill spinning.
      if ((state.transcriptGeneration[action.threadId] ?? 0) !== action.generation) {
        return { ...state, loadingOlder };
      }
      const prepend = <T extends { messages: Message[]; threadId: string; hasMore?: boolean }>(owner: T): T => {
        const held = new Set(owner.messages.map((message) => message.id));
        return {
          ...owner,
          // A page that raced an edit or a branch switch can overlap what is
          // already held; the held copy is the newer one.
          messages: [...action.messages.filter((message) => !held.has(message.id)), ...owner.messages],
          hasMore: action.hasMore,
        };
      };
      return {
        ...state,
        loadingOlder,
        bots: state.bots.map((bot) => (bot.threadId === action.threadId ? prepend(bot) : bot)),
        groups: state.groups.map((group) => (group.threadId === action.threadId ? prepend(group) : group)),
      };
    }
    case "sectionDeleted":
      return {
        ...state, sections: action.sections,
        bots: state.bots.map(bot => bot.section === action.section ? { ...bot, section: undefined } : bot),
        groups: state.groups.map(group => group.section === action.section ? { ...group, section: undefined } : group),
      };
    case "sections":
      return { ...state, sections: action.sections };
    case "botQueues":
      return reconcileSnapshotQueues(replaceBotQueues(state, action.queues), [...state.bots, ...state.groups]);
  }
  return undefined;
}
