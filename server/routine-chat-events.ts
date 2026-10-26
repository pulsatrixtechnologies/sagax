// Routines turned on or off, as one line in the conversation (2026-10-15,
// JC, after Grok Bot's "Disabled · 5 routines"). When a turn changes whether
// routines are on (a routine card the person confirmed, a change the bot
// applied to itself, its Undo, or the person's own switch in the app while
// this conversation is open) the thread gets ONE compact line per action
// and per turn: "Disabled · 5 routines", "Enabled · 1 routine". A second
// routine turned off in the same turn joins the line already there instead
// of writing another. The line opens the list of the routines it names.
//
// Durable: the line is an ordinary transcript row (kind "routines"), so it
// stays after a reload. Never model context: delta-context keeps text,
// widget, digest and compaction rows only.
//
// Private: each viewer receives only the routines they can see
// (routineSeenBy, the rule of the Automations page: the person signed in),
// and a line with none of theirs is not sent at all. The fallback `text`
// for clients that do not know the kind is recounted per viewer and never
// names a routine.
//
// Pure: server/index.ts hands in the store and the visibility predicate.

import type { RoutineToggleEvent, WireMessage as Message } from "../shared/wire.ts";

export type RoutineToggleAction = RoutineToggleEvent["action"];
export type RoutineToggleItem = RoutineToggleEvent["routines"][number];

/** What recording needs from the transcript store. */
export interface RoutineToggleStore {
  activePath(threadId: string): Message[];
  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
}

/** The fallback line: no routine names, only the count. */
export function routineToggleText(action: RoutineToggleAction, count: number): string {
  const verb = action === "disabled" ? "Disabled" : "Enabled";
  return `${verb} ${count} ${count === 1 ? "routine" : "routines"}`;
}

/** The user message that started the turn a change belongs to: the last
 * person's line at or before `atMessageId` (a routine card), else before the
 * end of the thread. "" when nobody spoke first. */
export function routineToggleTurnKey(path: readonly Message[], atMessageId?: string): string {
  let end = path.length - 1;
  if (atMessageId) {
    const at = path.findIndex((message) => message.id === atMessageId);
    if (at !== -1) end = at;
  }
  for (let index = end; index >= 0; index -= 1) {
    const message = path[index];
    if (message.role === "user" && message.kind === "text" && !message.peerAsk) return message.id;
  }
  return "";
}

/** The line of this turn and action, if one is already in the thread. Only
 * lines after the turn's request count: an older turn keeps its own line. */
function lineOfTurn(path: readonly Message[], turnKey: string, action: RoutineToggleAction): Message | undefined {
  const start = turnKey ? path.findIndex((message) => message.id === turnKey) : -1;
  for (let index = path.length - 1; index > start; index -= 1) {
    const message = path[index];
    if (message.kind === "routines" && message.routineToggle?.turnKey === turnKey && message.routineToggle.action === action) return message;
  }
  return undefined;
}

/** Record one routine turned on or off in `threadId`. The line of the same
 * turn and action gets it (one line per action and per turn); the opposite
 * line of the same turn lets it go, since the last word is this one. Returns
 * the line written or updated. */
export function recordRoutineToggle(
  store: RoutineToggleStore,
  input: { threadId: string; action: RoutineToggleAction; routine: RoutineToggleItem; atMessageId?: string },
): Message {
  const path = store.activePath(input.threadId);
  const turnKey = routineToggleTurnKey(path, input.atMessageId);
  const opposite = lineOfTurn(path, turnKey, input.action === "disabled" ? "enabled" : "disabled");
  if (opposite?.routineToggle?.routines.some((routine) => routine.id === input.routine.id)) {
    const routines = opposite.routineToggle.routines.filter((routine) => routine.id !== input.routine.id);
    store.patchMessage(input.threadId, opposite.id, {
      routineToggle: { ...opposite.routineToggle, routines },
      text: routineToggleText(opposite.routineToggle.action, routines.length),
    });
  }
  const item = cleanItem(input.routine);
  const existing = lineOfTurn(path, turnKey, input.action);
  if (existing?.routineToggle) {
    const routines = [...existing.routineToggle.routines.filter((routine) => routine.id !== item.id), item];
    return store.patchMessage(input.threadId, existing.id, {
      routineToggle: { ...existing.routineToggle, routines },
      text: routineToggleText(input.action, routines.length),
    }) ?? existing;
  }
  return store.appendMessage(input.threadId, {
    role: "bot",
    kind: "routines",
    text: routineToggleText(input.action, 1),
    routineToggle: { action: input.action, turnKey, routines: [item] },
  });
}

/** Verbs for a routine's definition changing. A singular chip per routine. */
export type RoutineChangeAction = "created" | "updated" | "deleted";

/** The fallback line for clients that do not know the kind: no routine name,
 * so an old client never shows a name the viewer filter would have withheld. */
export function routineChangeText(action: RoutineChangeAction): string {
  return action === "created" ? "Created a routine" : action === "deleted" ? "Deleted a routine" : "Updated a routine";
}

/** Record one routine a bot created, updated or deleted in `threadId`, as one
 * named line ("Updated routine · <name>"). One line per routine, action and
 * turn: a retry of the same change does not write a second. Returns the line. */
export function recordRoutineChange(
  store: RoutineToggleStore,
  input: { threadId: string; action: RoutineChangeAction; routine: RoutineToggleItem; atMessageId?: string },
): Message {
  const path = store.activePath(input.threadId);
  const turnKey = routineToggleTurnKey(path, input.atMessageId);
  const item = cleanItem(input.routine);
  const start = turnKey ? path.findIndex((message) => message.id === turnKey) : -1;
  for (let index = path.length - 1; index > start; index -= 1) {
    const message = path[index];
    if (message.kind === "routines" && message.routineToggle?.turnKey === turnKey &&
      message.routineToggle.action === input.action && message.routineToggle.routines.some((routine) => routine.id === item.id)) {
      return message;
    }
  }
  return store.appendMessage(input.threadId, {
    role: "bot",
    kind: "routines",
    text: routineChangeText(input.action),
    routineToggle: { action: input.action, turnKey, routines: [item] },
  });
}

function cleanItem(routine: RoutineToggleItem): RoutineToggleItem {
  return {
    id: routine.id,
    name: routine.name.slice(0, 200),
    ...(routine.botId ? { botId: routine.botId } : {}),
    ...(routine.groupId ? { groupId: routine.groupId } : {}),
    ...(routine.runAs ? { runAs: routine.runAs } : {}),
  };
}

/** A routines line as one viewer receives it: only the routines they can
 * see, the fallback text recounted. Null when none is theirs (the row is
 * then not sent). Any other row comes back unchanged. */
export function routineToggleForViewer<T>(message: T, canSee: (routine: RoutineToggleItem) => boolean): T | null {
  const row = message as { kind?: unknown; routineToggle?: RoutineToggleEvent } | null;
  if (!row || typeof row !== "object" || row.kind !== "routines") return message;
  const event = row.routineToggle;
  if (!event || !Array.isArray(event.routines)) return null;
  const routines = event.routines.filter((routine) => {
    try {
      return canSee(routine);
    } catch {
      return false;
    }
  });
  if (!routines.length) return null;
  if (routines.length === event.routines.length) return message;
  return { ...message, routineToggle: { ...event, routines }, text: routineToggleText(event.action, routines.length) } as T;
}
