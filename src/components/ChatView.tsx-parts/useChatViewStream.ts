import { useCallback, useEffect, useMemo, useState, type Dispatch, type RefObject } from "react";
import { citationAttachment } from "@/lib/citations";
import { appendDraftAttachments } from "@/lib/drafts";
import { startedByNewChat } from "@/lib/fresh-topic";
import { isStreamSegment, segmentsAbove } from "@/lib/single-stream";
import { freshTopicCovers, type Bot, type Message } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { splitLeadingConversations, visibleConversationRows } from "../BotConversations";
import type { InstanceInfo } from "@/state/store";

export function useChatViewStream({
  bot,
  side,
  showThreads,
  preview,
  dispatch,
  pendingQueued,
  messages,
  windowedMessages,
  olderPending,
  hiddenCount,
  stopFollowing,
  composerDockRef,
  engine,
}: {
  bot: Bot;
  side?: unknown;
  showThreads: boolean;
  preview: unknown;
  dispatch: Dispatch<import("@/state/store").Action>;
  pendingQueued: Record<string, unknown[] | undefined>;
  messages: Message[];
  windowedMessages: Message[];
  olderPending: boolean;
  hiddenCount: number;
  stopFollowing: () => void;
  composerDockRef: RefObject<HTMLDivElement | null>;
  engine: InstanceInfo | undefined;
}) {
  // The single stream (Show threads off): the live topic is this thread; the
  // topics before it are drawn above, under their dividers, once this one is
  // read back to its start (docs/single-stream-orchestration.md).
  const currentTask = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const streamOn = !side && !showThreads && Boolean(currentTask && isStreamSegment(currentTask));
  const streamHasEarlier = streamOn && segmentsAbove(bot.tasks, bot.threadId).length > 0;
  // A fresh topic drafted over this one (src/lib/fresh-topic.ts): the next
  // message starts a fresh engine context (a topic created on the server
  // with that message). An asked-for "New topic" (header pencil) clears the
  // chat to the empty greeting; Back restores the previous topic in place.
  // An automatic one (back after a while) stays invisible on the timeline.
  const freshDraft = useStoreSelector((current) => current.freshTopic[bot.id]);
  const fresh = streamOn && !preview && freshDraft?.threadId === bot.threadId && freshTopicCovers(bot, bot.threadId);
  const askedFresh = Boolean(fresh && !freshDraft?.auto);
  const resumeTopic = useCallback(() => dispatch({ type: "freshTopic", botId: bot.id, threadId: null }), [bot.id, dispatch]);
  // Coming back put the fresh topic there: it gives way the moment the topic
  // under it comes alive (another device's turn, an approval), never hiding
  // a live conversation. A New topic the person started stays.
  const queuedUnder = (pendingQueued[bot.threadId]?.length ?? 0) > 0;
  const underAlive = Boolean(currentTask && (currentTask.busy || currentTask.activity === "working" || currentTask.activity === "waiting-on-you" || currentTask.unread || currentTask.waitingForTeammates || queuedUnder));
  useEffect(() => {
    if (fresh && freshDraft?.auto && underAlive) dispatch({ type: "freshTopic", botId: bot.id, threadId: null });
  }, [fresh, freshDraft?.auto, underAlive, bot.id, dispatch]);
  const [streamReach, setStreamReach] = useState<{ threadId: string; nonce: number } | null>(null);
  const clearStreamReach = useCallback(() => setStreamReach((current) => current && null), []);
  // Earlier topics stay drawn once shown for this live topic: a new message
  // that slides the live window, or an older live page loading, never drops
  // what was loaded above it. A link or a search hit into an earlier topic
  // draws them at once, above whatever of the live topic is loaded (its top
  // sentinel, between the divider and the live rows, fills the rest).
  const streamFocus = useStoreSelector((current) => segmentsAbove(bot.tasks, bot.threadId).some((task) => task.threadId === current.focusMessage?.threadId) ? current.focusMessage : null);
  const streamFocusEarlier = streamHasEarlier && Boolean(streamFocus && !streamFocus.consumed && segmentsAbove(bot.tasks, bot.threadId).some((task) => task.threadId === streamFocus.threadId));
  const [streamShownFor, setStreamShownFor] = useState<string | null>(null);
  // Reply on an earlier topic's message quotes it into the live composer.
  const quoteEarlier = useCallback((message: Message, threadId: string) => {
    const text = (message.text ?? "").trim();
    if (!text) return;
    try {
      const quote = text.slice(0, 2_000);
      appendDraftAttachments(`bot:${bot.id}:${bot.threadId}`, [citationAttachment(
        { ownerType: "bot", ownerId: bot.id, threadId, messageId: message.id },
        { text: quote, start: 0, end: quote.length, prefix: "", suffix: "" },
      )]);
    } catch {
      return;
    }
    composerDockRef.current?.querySelector("textarea")?.focus();
  }, [bot.id, bot.threadId]);
  const streamEngine = engine;
  // A topic started from New chat opens on its own (src/lib/fresh-topic.ts):
  // reading it back to its first line does not draw the earlier topics above
  // it; a link, a search hit or the activity pill still reaches them.
  const streamReadBack = streamHasEarlier && !olderPending && hiddenCount === 0 && !bot.hasMore && !startedByNewChat(bot.threadId);
  // One timeline for the live topic: earlier topics above once read back.
  // An asked-for New topic clears that view (empty greeting); scrolling up
  // does not reveal the covered topic until Back (or the topics list).
  const streamDrawn = !askedFresh && streamHasEarlier && (streamReadBack || streamFocusEarlier || streamReach !== null || streamShownFor === bot.threadId);
  // The bot-to-bot conversations older than the topic's first line fold
  // behind a line of their own, listed once per bot.
  const earlierConversations = useMemo(
    () => splitLeadingConversations(visibleConversationRows(bot, bot.threadId, messages), windowedMessages[0]?.at, Boolean(bot.hasMore)).leading,
    [bot, messages, windowedMessages],
  );
  const [conversationsOpenFor, setConversationsOpenFor] = useState<string | null>(null);
  const conversationsOpen = conversationsOpenFor === bot.threadId;
  const toggleConversations = useCallback(() => setConversationsOpenFor((current) => current === bot.threadId ? null : bot.threadId), [bot.threadId]);
  // A link, a search hit or the activity pill into an earlier topic is a
  // jump up: bottom-follow would pull the pane back at the next growth.
  useEffect(() => {
    if (streamFocusEarlier || streamReach) stopFollowing();
  }, [streamFocusEarlier, streamReach, stopFollowing]);
  // New topic is made on the server at once (#2312), so a routine's report
  // or a bot's message lands in it: the topic on screen keeps its Back while
  // the person has not written in it. Back on an empty one returns to the
  // topic before and drops the empty one; with something in it, the earlier
  // topics are drawn above and the view goes there.
  const previousTopic = streamHasEarlier ? segmentsAbove(bot.tasks, bot.threadId).at(-1)?.threadId : undefined;
  const newTopicBack = !askedFresh && !preview && Boolean(previousTopic) && !streamDrawn && startedByNewChat(bot.threadId)
    && !messages.some((message) => message.role === "user");
  const backFromNewTopic = useCallback(() => {
    if (!previousTopic) return;
    if (messages.length === 0 && !bot.busy) {
      const emptyTopic = bot.threadId;
      dispatch({ type: "switchTask", botId: bot.id, threadId: previousTopic });
      dispatch({ type: "deleteTask", botId: bot.id, threadId: emptyTopic });
      return;
    }
    setStreamReach((current) => ({ threadId: previousTopic, nonce: (current?.nonce ?? 0) + 1 }));
  }, [previousTopic, messages.length, bot.busy, bot.threadId, bot.id, dispatch]);
  useEffect(() => {
    if (streamDrawn) setStreamShownFor(bot.threadId);
  }, [streamDrawn, bot.threadId]);
  // Leaving the topic (another bot, another thread) forgets it: coming back
  // waits for the live topic to be read back again.
  useEffect(() => () => setStreamShownFor(null), [bot.id, bot.threadId]);

  return {
    currentTask, streamOn, streamHasEarlier, freshDraft, fresh, askedFresh, resumeTopic, newTopicBack, backFromNewTopic,
    queuedUnder, underAlive, streamReach, clearStreamReach, streamFocus, streamFocusEarlier,
    streamShownFor, quoteEarlier, streamEngine, streamReadBack, streamDrawn,
    earlierConversations, conversationsOpenFor, conversationsOpen, toggleConversations,
  };
}
