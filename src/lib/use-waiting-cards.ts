// What a task waits on from the person, read off the threads that wait
// (2026-10-29, task sheet): the task's own open approvals and questions and
// those of its sub-agents, so the sheet puts them at its head instead of
// leaving them for the person to find in a list or in a conversation.
// Same reading as the conversation's approval box (parallelPendings,
// pendingQuestions), so an answer given here is the same answer.
import { useEffect, useState } from "react";

import type { Message } from "@/state/store";
import { pendingQuestions } from "@/lib/pending-question";
import { threadHeadPage } from "@/lib/thread-head-page";
import { parallelPendings } from "@/components/parallel-approvals";
import type { Pending } from "@/components/PendingApproval";

/** A thread to read: the task's own (no `from`) or a sub-agent's. */
export interface WaitingSource {
  threadId: string;
  botId: string;
  /** The sub-agent's title, when the thread is one. */
  from?: string;
}

export type WaitingItem =
  | { kind: "approval"; pending: Pending; threadId: string; botId: string; from?: string }
  | { kind: "question"; message: Message; threadId: string; botId: string; from?: string };

export function waitingItemsOf(messages: Message[], source: WaitingSource): WaitingItem[] {
  const tag = source.from ? { from: source.from } : {};
  const pendings = source.from
    ? parallelPendings(messages, { threadId: source.threadId, title: source.from })
    : parallelPendings(messages, { threadId: source.threadId, title: "" }).map(({ parallelTitle: _title, ...pending }) => pending);
  return [
    ...pendings.map((pending): WaitingItem => ({ kind: "approval", pending, threadId: source.threadId, botId: source.botId, ...tag })),
    ...pendingQuestions(messages).map((message): WaitingItem => ({ kind: "question", message, threadId: source.threadId, botId: source.botId, ...tag })),
  ];
}

/** The open cards of `sources`, fetched again whenever `stamp` changes (the
 * sheet passes its poll tick while the task runs). Empty until read. */
export function useWaitingCards(sources: readonly WaitingSource[], stamp: string | number): WaitingItem[] {
  const key = sources.length ? `${sources.map((source) => `${source.threadId}:${source.botId}:${source.from ?? ""}`).join("|")}@${stamp}` : "";
  const [found, setFound] = useState<{ key: string; items: WaitingItem[] }>({ key: "", items: [] });
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.allSettled(sources.map(async (source) => {
      const page = await threadHeadPage(source.threadId, stamp);
      return waitingItemsOf(page.messages ?? [], source);
    })).then((lists) => {
      if (live) setFound({ key, items: lists.flatMap((list) => list.status === "fulfilled" ? list.value : []) });
    });
    return () => {
      live = false;
    };
    // `sources` is derived from `key`'s inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A stale read stays on screen until the next one lands, so the head
  // never blinks between two polls.
  return key ? found.items : [];
}
