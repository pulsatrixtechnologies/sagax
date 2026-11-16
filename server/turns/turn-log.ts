// The line the harness prints when a turn starts (stderr, which the desktop
// app keeps in server.log). Loi 25: never log incoming message text or a
// person's display name. Counts and ids only. Words spoken on a Live call
// show `text=(spoken)`. A confidential thread shows `text=(confidential)`.

import { isStreamSegment, type StreamTaskFacts } from "../../shared/single-stream.ts";

/** #4394: which kind of conversation a turn runs in, so the turn-latency
 * lines of one server say which turns are a person's own messages in a bot's
 * one conversation (chat) and which open a conversation of their own: a
 * routine run, an AI client's hidden conversation, a thread a bot opened (a
 * teammate's job or a pair conversation), a parallel task, a confidential
 * thread. Each of those starts its own engine and opening block by design. */
export type ConversationKind = "chat" | "routine" | "hidden" | "opened" | "parallel" | "confidential" | "closed" | "unknown";

export function conversationKind(task: StreamTaskFacts | undefined): ConversationKind {
  if (!task) return "unknown";
  if (isStreamSegment(task)) return "chat";
  if (task.confidential === true) return "confidential";
  if (task.routineRunId || task.routineResults === true) return "routine";
  if (task.hidden === true) return "hidden";
  if (task.openedBy) return "opened";
  if (task.parallelOf) return "parallel";
  return "closed";
}

export interface TurnStartLog {
  botId: string;
  text: string;
  images: number;
  depth: number;
  card: boolean;
  /** some of the turn's words were spoken on a Live call */
  spoken: boolean;
  /** the turn's thread is confidential */
  confidential?: boolean;
  /** #4394: the turn's thread, short, and its conversation kind */
  threadId?: string;
  conversation?: ConversationKind;
}

export function turnStartLogLine(turn: TurnStartLog): string {
  const text = turn.confidential
    ? "(confidential)"
    : turn.spoken
      ? "(spoken)"
      : `chars=${turn.text.length}`;
  const thread = turn.threadId ? ` thread=${turn.threadId.slice(0, 8)}` : "";
  const conversation = turn.conversation ? ` conv=${turn.conversation}` : "";
  return `[omb-turn] bot=${turn.botId}${thread}${conversation} text=${text} images=${turn.images} depth=${turn.depth} card=${turn.card}`;
}

/** Loi 25: auto-recall progress with ids and counts only, never a display name. */
export function autoRecallLogLine(botId: string, notes: number, conversations: number, threadId: string): string {
  return `auto-recall: bot=${botId} notes=${notes} conversations=${conversations} thread=${threadId}`;
}
