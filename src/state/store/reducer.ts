// Root client-store reducer: domain slices plus the panelOwner cleanup.
import type { Action, AppState } from "./model";
import { bumpThreadUpdatedAt } from "./model";
import { reduceHydrate } from "./reduce-hydrate";
import { reduceViews } from "./reduce-views";
import { reduceRoutines } from "./reduce-routines";
import { reduceGroups } from "./reduce-groups";
import { reduceConfig } from "./reduce-config";
import { reduceBots } from "./reduce-bots";
import { reduceMessages } from "./reduce-messages";
import { reduceUi } from "./reduce-ui";
import { reduceTasks } from "./reduce-tasks";

export type ReduceFn = (state: AppState, action: Action) => AppState;

function reduce(state: AppState, action: Action): AppState {
  if (action.type === "messageAdded" || action.type === "messagePatched" || action.type === "threadActive" || action.type === "optimisticMessageRemoved") {
    const owner = state.bots.find((bot) => (bot.threadId !== action.threadId || bot.awaitingThreadSnapshot) && bot.tasks?.some((task) => task.threadId === action.threadId));
    if (owner) {
      // ponytail: a bounded race buffer, not a second transcript store. The
      // server supplies complete history whenever this thread is reopened.
      const frames = [...(state.backgroundThreadEvents[action.threadId] ?? []), action].slice(-256);
      const buffered = { ...state, backgroundThreadEvents: { ...state.backgroundThreadEvents, [action.threadId]: frames } };
      return action.type === "messageAdded"
        ? bumpThreadUpdatedAt(buffered, action.threadId, action.message.at)
        : buffered;
    }
  }
  const fold: ReduceFn = (s, a) => reducer(s, a);
  return (
    reduceHydrate(state, action, fold) ??
    reduceViews(state, action, fold) ??
    reduceRoutines(state, action, fold) ??
    reduceGroups(state, action, fold) ??
    reduceConfig(state, action, fold) ??
    reduceBots(state, action, fold) ??
    reduceMessages(state, action, fold) ??
    reduceUi(state, action, fold) ??
    reduceTasks(state, action, fold) ??
    state
  );
}

export function reducer(state: AppState, action: Action): AppState {
  let next = reduce(state, action);
  // The bot profile page fills the main panel (#2136): navigating anywhere
  // else from the sidebar (another bot, the chat, a view, memory, plugins)
  // leaves it.
  if (state.personaEditor && next.personaEditor === state.personaEditor && leavesProfile(state, next, action)) {
    next = { ...next, personaEditor: null };
  }
  // A section's panel lasts as long as the panel: closed, it is gone.
  return next.panelOwner && !next.settingsOpen && !next.computerOpen ? { ...next, panelOwner: null } : next;
}

function leavesProfile(state: AppState, next: AppState, action: Action): boolean {
  return (
    action.type === "select" ||
    action.type === "showChat" ||
    next.activeView !== state.activeView ||
    next.selectedId !== state.selectedId ||
    (next.memoryManagerOpen && !state.memoryManagerOpen) ||
    (next.pluginsOpen && !state.pluginsOpen)
  );
}
