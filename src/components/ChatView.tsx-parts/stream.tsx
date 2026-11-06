import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, SquarePen } from "lucide-react";
import { formatTime, startNewTopic, visibleMessages, type Bot, type InstanceInfo, type Message, type Task } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { segmentsAbove, segmentsToReach } from "@/lib/single-stream";
import { useSegmentTranscript } from "@/lib/use-segment-transcript";
import { useFocusMessage } from "@/lib/focus-message";
import { transcriptLookups } from "@/lib/transcript-derivations";
import type { EffectivePlace } from "@/lib/place";
import { t } from "@/lib/i18n";
import { ChatRowsContext, type ChatRows } from "./types";
import { MessagesList } from "./MessagesList";
import { noop } from "./sideChat";
import { useStreamAnchor } from "./useStreamAnchor";

/** The line that opens a topic of the single stream. Like Grok Bot, it is one
 * quiet "New topic" marker, the same label the fresh-topic divider carries:
 * the topic's own title and time are not stamped on the stream (they stayed
 * on the "Show the previous topic" pill and in search); the title rides along
 * as the hover tooltip so it is still reachable without crowding the line. */
/** Between two topics of the one conversation: a quiet time line, like a
 * day separator (the reference design draws one transcript; a topic is a
 * fresh engine context underneath, not a new place). The topic's title
 * stays in the tooltip. */
export function TopicDivider({ task }: { task: Pick<Task, "threadId" | "title" | "createdAt"> }) {
  return (
    <div className="my-1 flex items-center gap-3 text-[11px] text-ink-tertiary/80" role="separator" data-topic-divider={task.threadId}>
      <span className="h-px flex-1 bg-hairline/40" />
      <span className="truncate" title={`${t("stream.newTopic")} · ${task.title}`}>{formatTime(task.createdAt)}</span>
      <span className="h-px flex-1 bg-hairline/40" />
    </div>
  );
}

/** The line that opens a fresh topic not created yet (src/lib/fresh-topic.ts),
 * under the earlier topics once they are shown. */
export function FreshTopicDivider({ onResume }: { onResume: () => void }) {
  return (
    <div className="my-2 flex items-center gap-3 text-[11.5px] text-ink-tertiary" role="separator" data-fresh-topic-divider>
      <span className="h-px flex-1 bg-hairline/60" />
      <span className="truncate">{t("stream.newTopic")}</span>
      <button type="button" onClick={onResume} className="rounded px-1.5 py-0.5 text-ink-secondary hover:bg-raised hover:text-ink" data-fresh-topic-resume>
        {t("stream.resumeTopic")}
      </button>
      <span className="h-px flex-1 bg-hairline/60" />
    </div>
  );
}

/** One discreet line above a topic: the earlier topics, folded until asked
 * for (2026-10-18: less on screen; ⌘F still searches them). */
export function PreviousTopicsLine({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="flex justify-center" data-previous-topics={open ? "open" : "closed"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] text-ink-tertiary transition-colors hover:bg-raised hover:text-ink-secondary"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {t(open ? "stream.previousTopicsHide" : "stream.previousTopics")}
      </button>
    </div>
  );
}

/** "New topic" in the chat header while threads are off: a fresh empty
 * draft over the live topic; Back restores it, nothing is deleted. */
export function NewTopicButton({ bot }: { bot: Bot }) {
  const dispatch = useStoreDispatch();
  return (
    <button
      type="button"
      data-new-topic={bot.id}
      // a draft: the server creates the topic with its first message
      onClick={() => startNewTopic(dispatch, bot)}
      title={t("stream.newTopic")}
      aria-label={t("stream.newTopicAria", { name: bot.name })}
      className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-hairline-weak bg-elevated text-ink-secondary transition-colors hover:bg-elevated-hover hover:text-ink"
    >
      <SquarePen size={15} />
    </button>
  );
}

/** One earlier topic, read in place: its own copy of the thread and its own
 * rows context, so reactions, pins, attachments and cards act on that
 * thread. It is drawn as busy so edit, regenerate and version switches stay
 * with the live topic; Reply quotes the message into the live composer. */
export function StreamSegment({ task, first, rows, place, engine, aroundId, onQuote, onLoaded }: {
  task: Task;
  first: boolean;
  rows: ChatRows;
  place: EffectivePlace;
  engine: InstanceInfo | undefined;
  aroundId?: string;
  onQuote: (message: Message, threadId: string) => void;
  onLoaded: (threadId: string) => void;
}) {
  "use memo";
  const transcript = useSegmentTranscript(task.threadId, aroundId);
  const messages = useMemo(() => visibleMessages({ messages: transcript.messages, activeLeafId: transcript.activeLeafId }), [transcript.messages, transcript.activeLeafId]);
  const lookups = useMemo(() => transcriptLookups(transcript.messages, messages), [transcript.messages, messages]);
  const focusAll = useStoreSelector((current) => current.focusMessage?.threadId === task.threadId ? current.focusMessage : null);
  const focus = focusAll?.threadId === task.threadId ? focusAll : null;
  const ids = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const segmentRows = useMemo<ChatRows>(() => ({
    ...rows, threadId: task.threadId, busy: true, hasMore: transcript.hasMore, focus, onBranch: (messageId: string) => ids.has(messageId),
  }), [rows, task.threadId, transcript.hasMore, focus, ids]);
  const reply = useCallback((message: Message) => onQuote(message, task.threadId), [onQuote, task.threadId]);
  useFocusMessage(task.threadId, transcript.reached);
  useEffect(() => {
    if (transcript.loaded || transcript.failed) onLoaded(task.threadId);
  }, [transcript.loaded, transcript.failed, task.threadId, onLoaded]);
  return (
    <section data-stream-segment={task.threadId} aria-label={task.title} className="flex flex-col gap-3">
      {!first && <TopicDivider task={task} />}
      {transcript.hasMore && (
        <div className="flex justify-center">
          <button type="button" onClick={transcript.loadOlder} className="ui-pill">{t("stream.showEarlierInTopic")}</button>
        </div>
      )}
      {transcript.failed && <p className="text-center text-[12px] text-ink-tertiary">{t("stream.topicFailed")}</p>}
      <ChatRowsContext.Provider value={segmentRows}>
        <MessagesList
          messages={messages}
          transcript={messages}
          lookups={lookups}
          place={place}
          editingId={null}
          lastBotTextId={undefined}
          canRetryLast={false}
          engine={engine}
          unreadDividerId={null}
          unreadDividerFading={false}
          onStartEdit={noop}
          onCancelEdit={noop}
          onSubmitEdit={noop}
          onRegenerate={noop}
          onReply={reply}
          seen={null}
        />
      </ChatRowsContext.Provider>
    </section>
  );
}

/** The topics before the live one, loaded back one at a time: the previous
 * one at once (a new topic never hides what came before), older ones as the
 * person scrolls up or asks, and as far back as a link or a search hit needs. */
export function StreamEarlierTopics({ bot, rows, place, engine, scrollRef, followRef, reach, onReached, onQuote, includeCurrent = false }: {
  bot: Bot;
  /** Under a fresh topic: the topic it is drawn over is an earlier one too. */
  includeCurrent?: boolean;
  rows: ChatRows;
  place: EffectivePlace;
  engine: InstanceInfo | undefined;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the reader follows the bottom (useTranscriptViewport). */
  followRef: React.RefObject<boolean>;
  /** An earlier topic to bring on screen (the activity pill). */
  reach: { threadId: string; nonce: number } | null;
  /** The reach is taken: a remount never replays it. */
  onReached: () => void;
  onQuote: (message: Message, threadId: string) => void;
}) {
  "use memo";
  const above = useMemo(() => {
    const earlier = segmentsAbove(bot.tasks, bot.threadId);
    const current = includeCurrent ? bot.tasks?.find((task) => task.threadId === bot.threadId) : undefined;
    return current ? [current, ...earlier] : earlier;
  }, [bot.tasks, bot.threadId, includeCurrent]);
  const first = above.at(-1)?.threadId;
  const [count, setCount] = useState(1);
  // A link or a search hit in an earlier topic loads that topic around its
  // message, and keeps that page once the focus is consumed.
  const [around, setAround] = useState<Readonly<Record<string, string>>>({});
  // Topics whose first page is in (or failed): the next one loads on scroll
  // only after the oldest shown one did, so the top sentinel never loads
  // every topic at once while they are still empty.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const markLoaded = useCallback((threadId: string) => {
    setLoaded((current) => current.has(threadId) ? current : new Set(current).add(threadId));
  }, []);
  // The topic the activity pill asked for, scrolled to once it is drawn.
  const [pendingReach, setPendingReach] = useState<string | null>(null);
  useEffect(() => {
    setCount(1);
    setAround({});
    setPendingReach(null);
  }, [bot.id, bot.threadId]);
  const focus = useStoreSelector((current) => current.focusMessage);
  const focusSegment = focus && !focus.consumed ? focus.threadId : undefined;
  const dispatch = useStoreDispatch();
  useEffect(() => {
    if (!focusSegment || !focus) return;
    const needed = segmentsToReach(bot.tasks, bot.threadId, focusSegment);
    if (needed <= 0) return;
    setCount((current) => Math.max(current, needed));
    // a topic, not a message (a notification or an activity row about an
    // earlier topic): its start comes on screen once it is drawn
    if (focus.segment) {
      setPendingReach(focusSegment);
      dispatch({ type: "focusMessageConsumed", nonce: focus.nonce });
      return;
    }
    setAround((current) => current[focusSegment] === focus.messageId ? current : { ...current, [focusSegment]: focus.messageId });
  }, [focusSegment, focus?.nonce, focus?.messageId, focus?.segment, bot.tasks, bot.threadId, dispatch]);
  useEffect(() => {
    if (!reach) return;
    const needed = segmentsToReach(bot.tasks, bot.threadId, reach.threadId);
    if (needed > 0) setCount((current) => Math.max(current, needed));
    setPendingReach(reach.threadId);
    onReached();
  }, [reach?.nonce, reach?.threadId, bot.tasks, bot.threadId, onReached]);
  useEffect(() => {
    if (!pendingReach || !loaded.has(pendingReach)) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-stream-segment="${CSS.escape(pendingReach)}"]`)?.scrollIntoView({ block: "start" });
      setPendingReach(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingReach, loaded]);
  const next = above[count];
  const oldestShown = above[Math.min(count, above.length) - 1]?.threadId;
  const oldestReady = !oldestShown || loaded.has(oldestShown);
  const sentinel = useRef<HTMLDivElement>(null);
  // Scrolling up to the top of an overflowing stream loads the topic before.
  useEffect(() => {
    const node = sentinel.current;
    const root = scrollRef.current;
    if (!node || !root || !oldestReady || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && root.scrollHeight > root.clientHeight + 8) setCount((current) => current + 1);
    }, { root, rootMargin: "200px 0px 0px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [next?.threadId, oldestReady, scrollRef]);
  const wrapper = useRef<HTMLDivElement>(null);
  useStreamAnchor(scrollRef, wrapper, followRef, above.length > 0);
  if (!above.length) return null;
  const shown = above.slice(0, count).reverse();
  return (
    <div ref={wrapper} className="flex flex-col gap-3" data-stream-earlier-topics>
      {next && (
        <div ref={sentinel} className="flex justify-center" data-stream-earlier={next.threadId}>
          <button type="button" onClick={() => setCount((current) => current + 1)} className="ui-pill max-w-full truncate">
            {t("stream.showEarlierTopic", { title: next.title })}
          </button>
        </div>
      )}
      {shown.map((task) => (
        <StreamSegment
          key={task.threadId}
          task={task}
          first={task.threadId === first}
          rows={rows}
          place={place}
          engine={engine}
          {...(around[task.threadId] ? { aroundId: around[task.threadId] } : {})}
          onQuote={onQuote}
          onLoaded={markLoaded}
        />
      ))}
    </div>
  );
}
