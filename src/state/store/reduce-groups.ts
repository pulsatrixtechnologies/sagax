// Domain slice of the client store reduce(groups).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {bumpThreadUpdatedAt, bumpTranscriptGeneration, clearThreadReturnIfHome, mergeTaskStamps, optimisticUserMessage, personThreadKept, type Group, type GroupTask} from "./model";
import {fallbackSelection, selectionNewlyHidden} from "@/lib/selection-fallback";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceGroups(state: AppState, action: Action, _reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "groupPatched": {
      // A payload carrying a transcript replaces what this client holds, so
      // pages asked for under the old one no longer describe it.
      const fenced = action.group.messages ? bumpTranscriptGeneration(state, action.group.threadId) : state;
      const exists = fenced.groups.some((g) => g.id === action.group.id);
      const groups = exists
        ? fenced.groups.map((g) => (g.id === action.group.id ? {
            ...g, ...action.group,
            // A person conversation: a frame names its default thread; the
            // thread this person has open stays open (server/people-dms.ts).
            threadId: personThreadKept(g, action.group) ? g.threadId : (action.group.threadId ?? g.threadId),
            section: typeof action.group.threadId === "string" || Object.hasOwn(action.group, "section") ? action.group.section : g.section,
            tasks: action.group.tasks ? mergeTaskStamps(g.tasks, action.group.tasks) : g.tasks,
            turnTimeoutMinutes: Object.hasOwn(action.group, "turnTimeoutMinutes")
              ? (action.group.turnTimeoutMinutes ?? undefined)
              : g.turnTimeoutMinutes,
            messages: action.group.messages ?? g.messages,
            // A payload that carries a transcript answers the scrollback
            // question with it: a bounded page says so, and a frame sent
            // without that marker is the whole thread.
            hasMore: action.group.messages ? Boolean(action.group.hasMore) : g.hasMore,
          } : g))
        : [{ ...(action.group as Group), messages: action.group.messages ?? [] }, ...fenced.groups];
      return clearThreadReturnIfHome({ ...fenced, groups });
    }
    case "groupDeleted": {
      const groups = state.groups.filter((g) => g.id !== action.groupId);
      const selectedId = state.selectedId === action.groupId ? fallbackSelection(state.bots, groups, state.sidebarHiddenKeys) : state.selectedId;
      return { ...state, groups, selectedId };
    }
    case "sidebarHidden": {
      const next = { ...state, sidebarHiddenKeys: action.keys };
      // Closing or hiding the open conversation (here or on another device)
      // leaves it: the next listed one opens, else the empty state.
      return selectionNewlyHidden(state.bots, state.groups, state.selectedId, state.sidebarHiddenKeys, action.keys)
        ? { ...next, selectedId: fallbackSelection(state.bots, state.groups, action.keys) }
        : next;
    }
    case "patchGroup":
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.groupId ? { ...g, ...action.patch } : g)),
      };
    // handled entirely by the async wrapper
    case "newGroupTask":
      return state;
    case "switchGroupTask":
      return state;
    case "deleteGroupTask":
      return state;
    case "renameGroupTask":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? {
                ...group,
                tasks: (group.tasks ?? []).map((task) =>
                  task.threadId === action.threadId ? { ...task, title: action.title } : task,
                ),
              }
            : group,
        ),
      };
    case "pinGroupTask":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? {
                ...group,
                tasks: (group.tasks ?? []).map((task) =>
                  task.threadId === action.threadId ? { ...task, pinned: action.pinned ? true : undefined } : task,
                ),
              }
            : group,
        ),
      };
    case "updateGroupTask":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? {
                ...group,
                tasks: (group.tasks ?? []).map((task) => {
                  if (task.threadId !== action.threadId) return task;
                  const next: GroupTask = { ...task };
                  for (const field of ["archivedAt", "snoozedUntil", "projectId"] as const) {
                    if (!(field in action.patch)) continue;
                    const value = action.patch[field];
                    if (value === null || value === undefined) delete next[field];
                    else Object.assign(next, { [field]: value });
                  }
                  if ("pinned" in action.patch) {
                    if (action.patch.pinned) next.pinned = true;
                    else delete next.pinned;
                  }
                  return next;
                }),
              }
            : group,
        ),
      };
    case "setConversationTurnLimit":
      return {
        ...state,
        groups: state.groups.map((group) => {
          if (group.id !== action.groupId) return group;
          if (action.dm) return { ...group, turnTimeoutMinutes: action.minutes ?? undefined };
          return {
            ...group,
            tasks: (group.tasks ?? []).map((task) =>
              task.threadId === action.threadId
                ? { ...task, turnTimeoutMinutes: action.minutes ?? undefined }
                : task,
            ),
          };
        }),
      };
    case "createGroup":
      return state;
    case "openPeopleDm":
      return state;
    case "nudgePerson":
      return state;
    case "nudgeGroup":
      return state;
    case "deleteGroup":
      return state;
    case "leaveGroup":
      return state;
    case "interruptGroup":
      return state;
    case "steerGroupQueued":
      return state;
    case "sendGroup": {
      if (!action.sendId) return state;
      const group = state.groups.find((candidate) => candidate.id === action.groupId);
      if (!group) return state;
      const threadId: string = action.threadId ?? group.threadId;
      if (threadId === group.threadId && group.messages.some((message) => message.sendId === action.sendId)) return state;
      const message = optimisticUserMessage(
        action.text,
        action.sendId,
        action.replyToId,
        null,
        action.mode ?? "chat",
      );
      const stamped = bumpThreadUpdatedAt(state, threadId, message.at);
      if (threadId !== group.threadId) return stamped;
      return {
        ...stamped,
        groups: stamped.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: [...candidate.messages, message] }
          : candidate),
      };
    }
  }
  return undefined;
}
