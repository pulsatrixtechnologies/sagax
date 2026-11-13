import { StepBoundary, stepFallbackText, stepIdOf } from "../MessageBoundary";
import { Fragment, memo, use, useEffect, useMemo, type ReactNode } from "react";
import { LiveTurnsContext } from "@/hooks/use-live-tool-ids";
import { useLiveLineNoteId } from "@/hooks/use-live-line-note";
import { CloudAgentsCard, cloudAgentAnchors, useThreadCloudAgents } from "../code/CloudAgentsCard";
import { type Bot, type InstanceInfo, type Message } from "@/state/store";
import { useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { equalRows, peerBots, peerGroups } from "@/state/view-slices";
import { useShowThreads } from "@/lib/thread-preferences";
import { isAppleMobileWebClient } from "@/lib/tool-activity-rows";
import { repeatedFailureIds } from "../../../shared/failure-dedup";
import { groupTranscript, isHiddenStatusActivity, isTurnStoppedNotice } from "@/lib/activity-runs";
import { inputRequestsDrawnElsewhere } from "@/lib/pending-question";
import { pinnedJumpTarget, usePinnedHeld } from "@/lib/pinned-waiting";
import { collapseBotExchanges } from "@/lib/bot-exchange";
import { foldCollapsedEntry, voiceCallPlan } from "@/lib/voice-call-transcript";
import { withoutDeadThreadChips } from "@/lib/dead-thread-chips";
import { isTransientChatNotice } from "../../../shared/transient-notices";
import { routineRunRowOutOfChat } from "../../../shared/routine-repeat";
import { BotConversationLine, conversationAnchors, splitLeadingConversations, visibleConversationRows } from "../BotConversations";
import { GotoGroupChip } from "../GotoGroupChip";
import { collapseGotoLines, gotoGroupFromConversations, gotoTargetOf, silentChatItem, unifiedGotoTargetOf } from "@/lib/goto-lines";
import { collapseMessagedLines } from "@/lib/messaged-line";
import { collapseAskLines } from "@/lib/ask-line";
import { collapseIncomingLines } from "@/lib/incoming-line";
import { NewMessagesDivider } from "../NewMessagesDivider";
import { unreadMessageIds } from "@/lib/unread-divider";
import type { EffectivePlace } from "@/lib/place";
import type { TranscriptLookups } from "@/lib/transcript-derivations";
import type { SeenFace } from "../SeenBy";
import { useChatRows, type ListedItem } from "./types";
import { listedItemMessages, MessagesListItem, TRANSCRIPT_ROW_ESTIMATE, transcriptRowKey } from "./MessagesListItem";
import { eagerTailStart } from "../VirtualRow";

export const MessagesList = memo(function MessagesList({
  messages,
  transcript,
  lookups,
  place,
  pinnedMessageId,
  editingId,
  lastBotTextId,
  emergingId,
  canRetryLast,
  engine,
  unreadDividerId,
  unreadDividerFading,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onReply,
  seen,
  confidential = false,
}: {
  messages: Message[];
  /** Active-branch messages, including ones outside the mounted window. */
  transcript: Message[];
  lookups: TranscriptLookups;
  /** Where this conversation works, for the place icon on screen and page tools. */
  place: EffectivePlace;
  pinnedMessageId?: string;
  editingId: string | null;
  lastBotTextId: string | undefined;
  emergingId?: string | null;
  canRetryLast: boolean;
  /** This bot's engine, for rendering setup help on a `setup` error. */
  engine: InstanceInfo | undefined;
  /** The New divider goes above the row holding this message. */
  unreadDividerId: string | null;
  unreadDividerFading: boolean;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  onRegenerate: () => void;
  onReply: (message: Message) => void;
  /** The bot's "Seen" caption, under the last message it consumed. */
  seen?: { messageId: string; faces: SeenFace[] } | null;
  /** A confidential thread: the cloud agent card says its run is not. */
  confidential?: boolean;
}) {
  "use memo";
  // Sagax's extras below (access cards, bot-to-bot exchange chips, who is
  // viewing) read slices of the store, so an unrelated dispatch (an unread
  // mark, a notice) leaves the list alone; the rows inside stay memoized on
  // ChatRows.
  const storeBots = useStoreSelector(peerBots, equalRows);
  const storeGroups = useStoreSelector(peerGroups, equalRows);
  const config = useStoreSelector((current) => current.config);
  // read when a chip is clicked, so a store event does not render the list
  const getState = useStoreGetter();
  const { botId, threadId, botName, hasMore, bots, focus, showToolCalls, locale, dispatch, botDmIds } = useChatRows();
  const showThreads = useShowThreads();
  // #3696: a live turn's text is drawn where it stays (live-text-place.ts)
  const liveTurns = use(LiveTurnsContext);
  const lineNoteId = useLiveLineNoteId(transcript, liveTurns, threadId);
  const appleMobileWeb = isAppleMobileWebClient();
  // #3681: an ask the pinned card over the box holds is drawn there only
  const held = usePinnedHeld();
  const selfColor = bots.find((candidate) => candidate.id === botId)?.color;
  const owners = useMemo(() => ({ bots: storeBots, groups: storeGroups }), [storeBots, storeGroups]);
  // Newest page version named in this transcript: mounted v1 cards refresh when v2 arrives.
  const latestPageVersionById = useMemo(() => {
    const map = new Map<string, number>();
    for (const message of messages) {
      const ref = message.pagePublish;
      if (!ref) continue;
      const current = map.get(ref.pageId);
      if (current === undefined || ref.version > current) map.set(ref.pageId, ref.version);
    }
    return map;
  }, [messages]);
  // Bot-to-bot lines become one chip per run first, so a tool fold never
  // swallows them. Person lines and replies to the person stay in the groups.
  // The locale refreshes the turn labels when the language changes.
  const items = useMemo(() => {
    // The turn labels are catalog strings: read the locale here so a
    // language change derives them again (the React Compiler keys this
    // memo on what the callback reads).
    void locale;
    // The plan reads the whole transcript. A tail window still hides every
    // spoken line of a call that started above it.
    const plan = voiceCallPlan(transcript);
    const seenIds = new Set<string>();
    // A stop the person asked for leaves no row, stored ones included.
    // Nor does the "On your computer" line, so it never splits a bot exchange.
    // Threads off (the threads toggle): a thread receipt stays a plain
    // "Messaged <session>" step (ThreadChip), never a link, and a run of them
    // never folds into a "N conversations" group (collapseBotExchanges gets
    // showThreads false).
    // The same failure of this bot, repeated since it last answered, is
    // drawn once: the last one (shared/failure-dedup.ts).
    const repeats = repeatedFailureIds(messages, botId);
    // #3438: one card per request: a hand-off's question card and the parked
    // work's input request ask the same thing; the card is the one drawn
    const drawnElsewhere = inputRequestsDrawnElsewhere(transcript);
    const shown = withoutDeadThreadChips(messages, owners).filter((message) =>
      !repeats.has(message.id) && !drawnElsewhere.has(message.id) && !held.has(message.id) && !isTurnStoppedNotice(message) && !isHiddenStatusActivity(message)
      // a failed routine run and a routine's access card pass as a banner
      // (TransientNotice), never a row (shared/transient-notices.ts)
      && !isTransientChatNotice(message)
      // #3990: a routine run's row that only says how it went (with
      // problems, works again, nothing to report), stored ones included,
      // stays in the routine's run log, never the chat
      && !routineRunRowOutOfChat(message));
    const collapsed = collapseBotExchanges(shown, {
      selfBotId: botId,
      self: { id: botId, name: botName, color: selfColor },
      lookup: transcript,
    });
    const listed: ListedItem[] = [];
    let pending: Message[] = [];
    const flush = () => {
      if (!pending.length) return;
      listed.push(...groupTranscript(pending, { liveTurns, lineNoteId }));
      pending = [];
    };
    for (const entry of collapsed) {
      for (const piece of foldCollapsedEntry(entry, plan, seenIds)) {
        if (piece.kind === "message") {
          pending.push(piece.message);
          continue;
        }
        flush();
        if (piece.kind === "card") {
          listed.push({ kind: "voiceCall", callId: piece.card.callId, messages: piece.card.messages });
        } else {
          listed.push(piece);
        }
      }
    }
    flush();
    // A run of "Messaged" chips of one turn is one centered line, Tool
    // calls hidden or not (#3270): the only trace of the send.
    const messaged = collapseMessagedLines(listed, botDmIds, (item) => silentChatItem(item, showToolCalls)) as ListedItem[];
    // The unified chat (threads off): a run of hand-offs to teammates is
    // one centered "Asking / Asked" line too (#3289), Tool calls hidden or
    // not, each teammate's answer folded into it.
    const asked = showThreads ? messaged : collapseAskLines(messaged, {
      selfBotId: botId, lookup: transcript, bots: storeBots, silent: (item) => silentChatItem(item, showToolCalls),
    }) as ListedItem[];
    // #3581: what came in from another bot or an AI client is one centered
    // "Asked by / Message from / Answer from" line too, never a quote. With
    // threads on, a received hand-off and a notice keep their links; a
    // stored copy of a request still folds.
    const incoming = collapseIncomingLines(asked, {
      selfBotId: botId,
      lookup: transcript,
      silent: (item) => silentChatItem(item, showToolCalls),
      ...(showThreads ? { copiesOnly: true } : {}),
    }) as ListedItem[];
    // Two or more "Go to conversation" lines in a row become one chip.
    return collapseGotoLines(incoming, (item) => silentChatItem(item, showToolCalls),
      showThreads ? gotoTargetOf : unifiedGotoTargetOf) as ListedItem[];
  }, [messages, transcript, botId, botName, selfColor, locale, owners, showToolCalls, showThreads, botDmIds, storeBots, held, liveTurns, lineNoteId]);
  const windowIds = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const newestMessageId = messages.at(-1)?.id;
  let newestUserMessageId: string | undefined;
  for (let i = messages.length - 1; i >= 0 && !newestUserMessageId; i--) {
    if (messages[i]!.role === "user") newestUserMessageId = messages[i]!.id;
  }
  // A search hit inside a folded run has to open it: the fold keeps the
  // row out of the DOM, and there is nothing for the scroll to land on.
  const focusedId = focus && !focus.consumed ? focus.messageId : null;
  // #3681: "See in the conversation" on an ask the pinned card holds lands
  // where the bot asked, since the ask has no row while it waits
  useEffect(() => {
    if (!focusedId || !held.has(focusedId)) return;
    const target = pinnedJumpTarget(transcript, focusedId, held);
    if (target !== focusedId) dispatch({ type: "focusMessage", threadId, messageId: target });
  }, [focusedId, held, transcript, threadId, dispatch]);
  const unreadIds = useMemo(() => unreadMessageIds(messages, unreadDividerId), [messages, unreadDividerId]);
  // The New divider goes above the first item holding an unread message.
  const dividerIndex = useMemo(() => unreadIds
    ? items.findIndex((item) => listedItemMessages(item).some((row) => unreadIds.has(row.id)))
    : -1, [items, unreadIds]);
  // Virtualized rows (#2755): the tail that fills the pane and a half draws
  // in the first frame of a switch (remembered heights make the count exact
  // for a conversation seen before); the rows above draw as the reader
  // scrolls toward them, and drop again far away.
  const eagerFrom = eagerTailStart(items.map(transcriptRowKey), (typeof window === "undefined" ? 900 : window.innerHeight) * 1.5, TRANSCRIPT_ROW_ESTIMATE);
  const dividerAbove = (index: number) => index === dividerIndex ? <NewMessagesDivider fading={unreadDividerFading} /> : null;
  // "Cloud agents (N)" under the row that launched them (code/CloudAgentsCard.tsx).
  const cloudAgents = useThreadCloudAgents(botId, threadId);
  const cloudAnchors = useMemo(
    () => cloudAgentAnchors(items.map((item) => listedItemMessages(item)[0]?.at ?? 0), cloudAgents),
    [items, cloudAgents],
  );
  // A bot-to-bot conversation named on this bot (either end) is a quiet
  // line at its place in time, in the main chat only, unless the transcript
  // already holds its line (the origin's "Go to conversation" receipt).
  const selfBot = storeBots.find((candidate) => candidate.id === botId);
  const conversationRows = useMemo(() => {
    const visible = visibleConversationRows(selfBot, threadId, transcript);
    // The rows older than the first line fold behind "Earlier topics".
    return splitLeadingConversations(visible, messages[0]?.at, hasMore).inline;
  }, [selfBot, threadId, transcript, messages, hasMore]);
  const conversationAt = useMemo(
    () => conversationAnchors(conversationRows, items.map((item) => listedItemMessages(item)[0]?.at ?? 0), hasMore),
    [conversationRows, items, hasMore],
  );
  const conversationLines = (rows: readonly NonNullable<Bot["botConversations"]>[number][] | undefined) => {
    if (!selfBot || !rows?.length) return null;
    const group = gotoGroupFromConversations(rows, selfBot);
    if (group) {
      return (
        <GotoGroupChip
          group={group}
          bots={storeBots}
          groups={storeGroups}
          onSelect={() => false}
        />
      );
    }
    return rows.map((row) => (
      <BotConversationLine key={`conversation:${row.threadId}`} self={selfBot} row={row} bots={storeBots} />
    ));
  };
  // Every row is wrapped the same way, keyed by its first message, so a card
  // appearing under a row never remounts that row.
  const withCloudAgents = (index: number, node: ReactNode): ReactNode => {
    const group = cloudAnchors.get(index);
    const item = items[index]!;
    const first = listedItemMessages(item)[0];
    return (
      <Fragment key={`row:${item.kind}:${first?.id ?? index}`}>
        {conversationLines(conversationAt.before.get(index))}
        <StepBoundary stepId={stepIdOf(first)} fallbackText={stepFallbackText(first)}>
          {node}
        </StepBoundary>
        {group && <div className="flex justify-start"><CloudAgentsCard records={group} botId={botId} confidential={confidential} /></div>}
      </Fragment>
    );
  };
  return (
    <>
      {items.map((item, i) => withCloudAgents(i, (
        <MessagesListItem
          item={item}
          index={i}
          eager={i >= eagerFrom || i === dividerIndex || (focusedId !== null && listedItemMessages(item).some((row) => row.id === focusedId))}
          items={items}
          windowIds={windowIds}
          focusedId={focusedId}
          divider={dividerAbove(i)}
          place={place}
          showToolCalls={showToolCalls}
          bots={bots}
          storeGroups={storeGroups}
          botId={botId}
          threadId={threadId}
          botName={botName}
          hasMore={hasMore}
          engine={engine}
          lookups={lookups}
          canRetryLast={canRetryLast}
          pinnedMessageId={pinnedMessageId}
          editingId={editingId}
          emergingId={emergingId}
          lastBotTextId={lastBotTextId}
          newestMessageId={newestMessageId}
          newestUserMessageId={newestUserMessageId}
          transcript={transcript}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSubmitEdit={onSubmitEdit}
          onRegenerate={onRegenerate}
          onReply={onReply}
          seen={seen}
          config={config}
          appleMobileWeb={appleMobileWeb}
          showThreads={showThreads}
          getState={getState}
          dispatch={dispatch}
          latestPageVersionById={latestPageVersionById}
        />
      )))}
      {conversationLines(conversationAt.after)}
    </>
  );
});
