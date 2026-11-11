// What the earlier topics of a bot's one conversation wait on from the
// person (#3438). The store holds the topic on screen only (the live one),
// so a question asked two days ago in an earlier topic, though the bot's row
// says "Waiting for you", never reached the pinned card over the composer.
// The topics that may hold one (src/lib/pending-question.ts, topicsToScan)
// are read here as the stream reads them (use-segment-transcript.ts): the
// newest page of each, then its live frames, so an answer given in the
// pinned card or in the topic itself settles both at once. A topic that
// held an open card stays read until the card settles, even once its
// "waiting" or unread flag is gone.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, MESSAGE_PAGE_SIZE, visibleMessages, type Bot, type Message } from "@/state/store";
import { listenLiveFrames } from "@/lib/live-events";
import { applySideFrame, applySidePage, EMPTY_SIDE_TRANSCRIPT, type SideTranscript } from "@/lib/side-thread";
import { segmentsAbove } from "@/lib/single-stream";
import { pendingOffers, pendingQuestions, pendingRequests, topicsToScan, type TopicPending } from "@/lib/pending-question";
import { pendingApprovals } from "@/components/PendingApproval";

type Page = { messages?: Message[]; activeLeafId?: string | null };

/** The open cards of one topic's transcript: its questions, its questions
 * in words and its approvals. An approval's decision goes to the topic it
 * was asked in (a relayed card keeps the thread it came from). */
export function topicPending(threadId: string, transcript: SideTranscript): TopicPending {
  const messages = visibleMessages({ messages: transcript.messages, activeLeafId: transcript.activeLeafId });
  const approvals = pendingApprovals(messages).map((pending) => ({ ...pending, threadId: pending.threadId ?? threadId }));
  return { threadId, questions: pendingQuestions(messages), requests: pendingRequests(messages), approvals, offers: pendingOffers(messages) };
}

/** How often the threads the server says wait are read again while a
 * conversation is open (a change of the bot's waiting state reads at once). */
export const WAITING_THREADS_POLL_MS = 60_000;

/** #3512: the threads of this bot's conversations where something waits on
 * the person, as the server's one list of waiting items names them (GET
 * /api/approvals?waiting=1&botId=, shared/waiting-items.ts): the same list
 * Today and the organization's connector read. A topic is read because an
 * item waits there, never because a flag guessed it. */
export function useServerWaitingThreads(botId: string | undefined, stamp: string): string[] {
  const [threads, setThreads] = useState<string[]>([]);
  useEffect(() => {
    if (!botId) {
      setThreads([]);
      return;
    }
    let live = true;
    const load = () => {
      api<{ waiting?: Array<{ threadId?: unknown }> }>(`/api/approvals?waiting=1&botId=${encodeURIComponent(botId)}`)
        .then((body) => {
          if (!live) return;
          const next = [...new Set((body.waiting ?? []).flatMap((item) => (typeof item.threadId === "string" ? [item.threadId] : [])))].sort();
          setThreads((current) => (current.join("\u0000") === next.join("\u0000") ? current : next));
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, WAITING_THREADS_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [botId, stamp]);
  return threads;
}

/** What changes when a card is posted or settled in one of the bot's
 * threads: its waiting state, unread marks and the activity of its topics. */
function waitingStamp(bot: Pick<Bot, "threadId" | "tasks" | "waitingOn"> | undefined): string {
  if (!bot) return "";
  const tasks = (bot.tasks ?? []).map((task) => `${task.threadId}:${task.activity ?? ""}:${task.unread ? 1 : 0}`).join(",");
  return `${bot.threadId}|${bot.waitingOn?.threadId ?? ""}|${tasks}`;
}

export function useTopicPending(bot: Pick<Bot, "id" | "threadId" | "tasks" | "waitingOn"> | undefined): TopicPending[] {
  const [transcripts, setTranscripts] = useState<Readonly<Record<string, SideTranscript>>>({});
  const held = useRef<Set<string>>(new Set());
  const earlier = useMemo(() => new Set(bot ? segmentsAbove(bot.tasks, bot.threadId).map((task) => task.threadId) : []), [bot?.tasks, bot?.threadId]);
  const waiting = useServerWaitingThreads(bot?.id, waitingStamp(bot));
  const scan = bot ? topicsToScan(bot.tasks, bot.threadId, bot.waitingOn?.threadId) : [];
  // #3512: every other thread of this bot where the server lists an item
  for (const threadId of waiting) if (bot && threadId !== bot.threadId && !scan.includes(threadId)) scan.push(threadId);
  for (const threadId of held.current) if (earlier.has(threadId) && !scan.includes(threadId)) scan.push(threadId);
  const key = scan.join("\u0000");
  useEffect(() => {
    const threads = key ? key.split("\u0000") : [];
    if (!threads.length) {
      setTranscripts({});
      return;
    }
    let cancelled = false;
    const load = (threadId: string, fresh: boolean) => {
      api<Page>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${MESSAGE_PAGE_SIZE}`)
        .then((page) => {
          if (cancelled) return;
          setTranscripts((current) => ({ ...current, [threadId]: applySidePage(fresh ? EMPTY_SIDE_TRANSCRIPT : current[threadId] ?? EMPTY_SIDE_TRANSCRIPT, page) }));
        })
        .catch(() => undefined);
    };
    setTranscripts((current) => Object.fromEntries(threads.flatMap((threadId) => current[threadId] ? [[threadId, current[threadId]!]] : [])));
    for (const threadId of threads) load(threadId, false);
    const stop = listenLiveFrames({
      onFrame: (frame) => {
        const threadId = "threadId" in frame && typeof frame.threadId === "string" ? frame.threadId : undefined;
        if (!threadId || !threads.includes(threadId)) return;
        setTranscripts((current) => {
          const before = current[threadId] ?? EMPTY_SIDE_TRANSCRIPT;
          const after = applySideFrame(before, frame as Parameters<typeof applySideFrame>[1], threadId);
          return after === before ? current : { ...current, [threadId]: after };
        });
      },
      onMissedFrames: () => {
        for (const threadId of threads) load(threadId, true);
      },
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [key]);
  const topics = useMemo(() => (key ? key.split("\u0000") : []).flatMap((threadId) => {
    const transcript = transcripts[threadId];
    return transcript ? [topicPending(threadId, transcript)] : [];
  }), [key, transcripts]);
  // a topic that holds an open card keeps being read until it settles
  useEffect(() => {
    const next = new Set(topics.filter((topic) => topic.questions.length || topic.requests.length || topic.approvals?.length || topic.offers?.length).map((topic) => topic.threadId));
    held.current = next;
  }, [topics]);
  return topics;
}
