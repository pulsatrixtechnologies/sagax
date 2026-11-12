// A side thread (the reference design's "open threads beside the main chat"): one bot
// thread shown in a resizable column to the right of the main chat, so the
// person reads or answers it without leaving the conversation on screen.
// One at a time; opening another replaces it. The open thread is this
// window's own (a module store, never the app store or the server); only its
// width is remembered (DockedPanelResize, its own key).
//
// The column holds its own copy of the thread's messages: the store keeps
// the transcript of the selected thread only. It loads the newest page
// (`GET /api/threads/:id/messages`, the same route scrollback reads), older
// pages on demand (`?before=`), and then follows the live stream's
// `message`, `message.patch` and `thread` frames for that thread
// (listenLiveFrames), so it works the same on a remote client, whose
// requests and stream go to its server.
import { useSyncExternalStore } from "react";
import type { Message } from "@/state/store";

export type SideThread = { botId: string; threadId: string };

export const SIDE_THREAD_WIDTH_KEY = "sagax.sideThread.width.v1";
export const SIDE_THREAD_MIN_WIDTH = 360;
export const SIDE_THREAD_MAX_WIDTH = 900;
export const SIDE_THREAD_DEFAULT_WIDTH = 480;

let current: SideThread | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function currentSideThread(): SideThread | null {
  return current;
}

/** Show this thread beside the main chat; replaces any side thread open. */
export function openSideThread(target: SideThread): void {
  if (current?.botId === target.botId && current.threadId === target.threadId) return;
  current = { botId: target.botId, threadId: target.threadId };
  notify();
}

export function closeSideThread(): void {
  if (!current) return;
  current = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSideThread(): SideThread | null {
  return useSyncExternalStore(subscribe, currentSideThread, currentSideThread);
}

/** Whether the side column has nothing to add: the main chat already shows
 * that very thread (the person opened it there), or its bot or thread is
 * gone. The column closes itself then. */
export function sideThreadRedundant(
  side: SideThread,
  main: { selectedId: string | null; activeView: string; bots: ReadonlyArray<{ id: string; threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }> },
): boolean {
  const bot = main.bots.find((candidate) => candidate.id === side.botId);
  if (!bot) return true;
  const known = bot.threadId === side.threadId || (bot.tasks ?? []).some((task) => task.threadId === side.threadId);
  if (!known) return true;
  return main.activeView === "chat" && main.selectedId === side.botId && bot.threadId === side.threadId;
}

/** The side column's copy of its thread. `loaded` turns true with the
 * first page; live frames that arrive before it are kept. */
export type SideTranscript = {
  messages: Message[];
  activeLeafId: string | null;
  loaded: boolean;
};

export const EMPTY_SIDE_TRANSCRIPT: SideTranscript = { messages: [], activeLeafId: null, loaded: false };

/** Older messages in front of the ones already held, without duplicates. */
export function prependOlder(transcript: SideTranscript, older: readonly Message[]): SideTranscript {
  const known = new Set(transcript.messages.map((message) => message.id));
  return { ...transcript, messages: [...older.filter((message) => !known.has(message.id)), ...transcript.messages] };
}

type SideFrame =
  | { kind: "message"; threadId: string; message: Message }
  | { kind: "message.patch"; threadId: string; message: Message }
  | { kind: "message.removed"; threadId: string; messageId: string }
  | { kind: "thread"; threadId: string; activeLeafId: string }
  | { kind: string; threadId?: string };

/** The newest page from the server. A message the stream delivered while
 * the page was on its way stays, after the page's own. */
export function applySidePage(
  transcript: SideTranscript,
  page: { messages?: Message[]; activeLeafId?: string | null },
): SideTranscript {
  const messages = page.messages ?? [];
  const known = new Set(messages.map((message) => message.id));
  const later = transcript.messages.filter((message) => !known.has(message.id));
  const last = later.at(-1);
  return {
    messages: [...messages, ...later],
    activeLeafId: last && transcript.activeLeafId === last.id ? last.id : page.activeLeafId ?? transcript.activeLeafId,
    loaded: true,
  };
}

/** One live frame. Frames of other threads, and kinds the column does not
 * keep, return the same object so a listener can skip the render. The
 * leaf follows the store's rule: a message that chains onto the leaf
 * becomes the leaf, one parented elsewhere leaves it where it is. */
export function applySideFrame(transcript: SideTranscript, frame: SideFrame, threadId: string): SideTranscript {
  if (frame.threadId !== threadId) return transcript;
  if (frame.kind === "message" && "message" in frame && frame.message) {
    const message = frame.message;
    if (transcript.messages.some((existing) => existing.id === message.id)) return transcript;
    const adoptsLeaf = (message.parentId ?? null) === (transcript.activeLeafId ?? null) || transcript.activeLeafId === null;
    return {
      ...transcript,
      messages: [...transcript.messages, message],
      activeLeafId: adoptsLeaf ? message.id : transcript.activeLeafId,
    };
  }
  if (frame.kind === "message.patch" && "message" in frame && frame.message) {
    const message = frame.message;
    const index = transcript.messages.findIndex((existing) => existing.id === message.id);
    if (index < 0) return transcript;
    const messages = transcript.messages.slice();
    messages[index] = message;
    return { ...transcript, messages };
  }
  if (frame.kind === "message.removed" && "messageId" in frame && typeof frame.messageId === "string") {
    const gone = transcript.messages.find((existing) => existing.id === frame.messageId);
    if (!gone) return transcript;
    return {
      ...transcript,
      messages: transcript.messages.filter((existing) => existing.id !== gone.id),
      activeLeafId: transcript.activeLeafId === gone.id ? gone.parentId ?? null : transcript.activeLeafId,
    };
  }
  if (frame.kind === "thread" && "activeLeafId" in frame && typeof frame.activeLeafId === "string") {
    if (frame.activeLeafId === transcript.activeLeafId) return transcript;
    return { ...transcript, activeLeafId: frame.activeLeafId };
  }
  return transcript;
}

/** Alt (Option on a Mac) and a click on a thread row opens it beside the
 * main chat instead of in it. */
export function wantsSideThread(event: Pick<MouseEvent, "altKey" | "metaKey" | "ctrlKey" | "shiftKey">): boolean {
  return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
}
