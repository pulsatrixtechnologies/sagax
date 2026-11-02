// Domain slice of the client store reduce(messages).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {bumpThreadUpdatedAt, optimisticMessageId, rewindThreadUpdatedAt, updateBot, withMascotMotion, type Message} from "./model";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceMessages(state: AppState, action: Action, _reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "messageAdded": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) {
        // room thread — plain linear append, no branching/mascot machinery.
        // A message for a channel task that is not the one on screen still
        // moves that row; it must not be appended to the visible transcript.
        const group = state.groups.find((g) => g.threadId === action.threadId || g.tasks?.some((task) => task.threadId === action.threadId));
        if (!group) return state;
        if (group.threadId === action.threadId && group.messages.some((m) => m.id === action.message.id)) return state;
        const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at);
        if (group.threadId !== action.threadId) return stamped;
        const optimisticIndex = action.message.sendId
          ? group.messages.findIndex(
              (message) => message.id === optimisticMessageId(action.message.sendId!),
            )
          : -1;
        return {
          ...stamped,
          groups: stamped.groups.map((g) =>
            g.id === group.id
              ? {
                  ...g,
                  messages: optimisticIndex >= 0
                    ? g.messages.map((message, index) =>
                        index === optimisticIndex ? action.message : message
                      )
                    : [...g.messages, action.message],
                }
              : g,
          ),
        };
      }
      // The POST response and the canonical SSE frame may arrive in either
      // order. A repeated message is already folded; moving the active leaf
      // back to it can hide a newer assistant reply that won the race.
      if (bot.messages.some((message) => message.id === action.message.id)) return state;
      const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at);
      const optimisticId = action.message.sendId
        ? optimisticMessageId(action.message.sendId)
        : null;
      const optimisticIndex = optimisticId
        ? bot.messages.findIndex((message) => message.id === optimisticId)
        : -1;
      if (optimisticIndex >= 0) {
        return updateBot(stamped, bot.id, (current) => ({
          ...current,
          messages: current.messages.map((message, index) =>
            index === optimisticIndex ? action.message : message
          ),
          activeLeafId: current.activeLeafId === optimisticId
            ? action.message.id
            : current.activeLeafId,
        }));
      }
      // every server-side append chains onto (and becomes) the active leaf
      const next = updateBot(stamped, bot.id, (b) => {
        // A message chains onto the leaf → it becomes the leaf (the normal
        // append). A message parented elsewhere is a chain-insert of a late
        // turn artifact (settle-time screenshot) — the leaf must stay put,
        // or the follow-up send it raced would fall off the active branch.
        const adoptsLeaf = (action.message.parentId ?? null) === (b.activeLeafId ?? null);
        return { ...b, messages: [...b.messages, action.message], activeLeafId: adoptsLeaf ? action.message.id : b.activeLeafId };
      });
      const motion =
        action.message.role === "user" && action.message.kind === "text" && Boolean(action.message.queueId)
          ? "working"
          : action.message.kind === "options"
          ? "thinking"
          : action.message.kind === "activity"
            ? action.message.tool?.ok === false
              ? "failure"
              : action.message.tool?.ok === true
                ? "success"
                : "working"
            : action.message.role === "bot" && action.message.kind === "text"
              ? "blink"
              : null;
      const animated = motion ? withMascotMotion(next, bot.id, motion) : next;
      return animated;
    }
    case "optimisticMessageRemoved": {
      const id = optimisticMessageId(action.sendId);
      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);
      if (bot) {
        const optimistic = bot.messages.find((message) => message.id === id);
        if (!optimistic) return state;
        const cleared = updateBot(state, bot.id, (current) => ({
          ...current,
          messages: current.messages.filter((message) => message.id !== id),
          activeLeafId: current.activeLeafId === id
            ? (action.restoreLeafId !== undefined ? action.restoreLeafId : (optimistic.parentId ?? null))
            : current.activeLeafId,
        }));
        const task = bot.tasks?.find((candidate) => candidate.threadId === action.threadId);
        const kept = cleared.bots.find((candidate) => candidate.id === bot.id)?.messages ?? [];
        return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? 0);
      }
      const group = state.groups.find((candidate) => candidate.threadId === action.threadId);
      if (!group || !group.messages.some((message) => message.id === id)) return state;
      const cleared = {
        ...state,
        groups: state.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: candidate.messages.filter((message) => message.id !== id) }
          : candidate),
      };
      const task = group.tasks?.find((candidate) => candidate.threadId === action.threadId);
      const kept = cleared.groups.find((candidate) => candidate.id === group.id)?.messages ?? [];
      return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? group.createdAt);
    }
    case "cardSettled": {
      const settle = (messages: Message[]) => messages.map((m) =>
        m.card?.requestId === action.requestId ? { ...m, card: { ...m.card, ...action.patch } } : m);
      const group = state.groups.find((g) => g.threadId === action.threadId);
      if (group) return { ...state, groups: state.groups.map((g) => (g.id === group.id ? { ...g, messages: settle(g.messages) } : g)) };
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      return bot ? updateBot(state, bot.id, (b) => ({ ...b, messages: settle(b.messages) })) : state;
    }
    case "messagePatched": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) {
        const group = state.groups.find((g) => g.threadId === action.threadId);
        if (!group) return state;
        return {
          ...state,
          groups: state.groups.map((g) =>
            g.id === group.id
              ? { ...g, messages: g.messages.map((m) => (m.id === action.message.id ? action.message : m)) }
              : g,
          ),
        };
      }
      const motion =
        action.message.kind === "activity"
          ? action.message.tool?.ok === false
            ? "failure"
            : action.message.tool?.ok === true
              ? "success"
              : "working"
          : null;
      const next = motion ? withMascotMotion(state, bot.id, motion) : state;
      return updateBot(next, bot.id, (b) => ({
        ...b,
        messages: b.messages.map((m) => (m.id === action.message.id ? action.message : m)),
      }));
    }
  }
  return undefined;
}
