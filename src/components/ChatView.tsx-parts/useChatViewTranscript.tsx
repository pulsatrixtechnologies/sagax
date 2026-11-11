import { useLiveToolIds, useLiveTurnIds } from "@/hooks/use-live-tool-ids";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from "react";
import {
  visibleMessages,
  type Action,
  type AppState,
  type Bot,
  type ConfigStatus,
  type InstanceInfo,
} from "@/state/store";
import { shallowEqual, useStoreSelector } from "@/state/store-selector";
import { botSeenCaption, messageParticipant } from "@/lib/read-receipts";
import { useReportRead, useThreadReads } from "@/lib/read-receipts-feed";
import { BotAvatar } from "../Avatar";
import { SEEN_AVATAR_SIZE, type SeenFace } from "../SeenBy";
import { runSteps, runSummary, showRun } from "@/lib/verify-steps";
import { useShowRunCard } from "@/lib/run-card-preferences";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { showToolCallRows } from "@/lib/tool-activity-rows";
import { useActiveLocale, useLocalSystemVoice } from "@/lib/render-reads";
import { reactionSelfIds } from "@/lib/reactions";
import { useTranscriptViewport } from "@/hooks/use-transcript-viewport";
import { useOffscreenRowAnchor } from "@/hooks/use-offscreen-row-anchor";
import { useUnreadDivider } from "@/hooks/use-unread-divider";
import { transcriptLookups } from "@/lib/transcript-derivations";
import { effectivePlace } from "@/lib/place";
import { useColorUserBubbles } from "@/lib/user-bubble-preference";
import { userBubbleStyle } from "@/lib/user-bubble-tone";
import { useDrawnBots, useSeenFaceBot, type ChatRows } from "./types";

export function useChatViewTranscript({
  bot,
  state,
  storeBots,
  engine,
  focus,
  dispatch,
  composerDockPad,
  sideLoadOlder,
  sideLoadingOlder,
  preview,
}: {
  bot: Bot;
  state: {
    config: ConfigStatus | null | undefined;
  };
  storeBots: readonly Bot[];
  engine: InstanceInfo | undefined;
  focus: AppState["focusMessage"];
  dispatch: Dispatch<Action>;
  composerDockPad: string | number;
  sideLoadOlder?: () => void;
  sideLoadingOlder?: boolean;
  preview: unknown;
}) {
  // only the active branch is rendered; forks stay reachable via ‹ › nav.
  // Keyed on the transcript alone: a bot frame that leaves it untouched
  // keeps this array, and the rows memoized on it.
  const { messages: allMessages, activeLeafId } = bot;
  const messages = useMemo(() => visibleMessages({ messages: allMessages, activeLeafId }), [allMessages, activeLeafId]);
  // edit versions, reply targets, the Retry row: once per list, not per row
  const lookups = useMemo(() => transcriptLookups(allMessages, messages), [allMessages, messages]);
  // Seen (src/lib/read-receipts.ts): under the last message this bot's turn
  // consumed, until it answers; and this person's own position while the
  // window has focus.
  const threadReads = useThreadReads(bot.threadId);
  const seenPlace = useMemo(() => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const anchorable = new Set(messages.filter((message) => message.role === "user" && message.kind === "text").map((message) => message.id));
    const place = botSeenCaption({
      order: messages,
      anchorable,
      reads: threadReads.reads,
      botId: bot.id,
      authorOf: (id) => {
        const message = byId.get(id);
        return message ? messageParticipant(message, bot.id) : null;
      },
    });
    return place && byId.has(place.messageId) ? place : null;
  }, [messages, threadReads.reads, bot.id]);
  // "Seen by" and the bot's face; its name and the time in the tooltip.
  // Rebuilt when the place or the bot's look changes, not on every bot frame.
  const seenBot = useSeenFaceBot(bot);
  const seenRow = useMemo(() => seenPlace ? {
    messageId: seenPlace.messageId,
    faces: [{
      participantId: `bot:${seenBot.id}`,
      name: seenBot.name,
      at: seenPlace.at,
      avatar: <BotAvatar bot={seenBot} state="happy" size={SEEN_AVATAR_SIZE} motion="none" motionKey={0} animated={false} />,
    } satisfies SeenFace],
  } : null, [seenPlace, seenBot]);
  // The bot's run in the current ask — every command it ran, the control-CLI
  // ones verified — for the run card. Saving mirrors the /learn gate: the
  // flag, an engine with the agents tools, and a bot that can take a message
  // now — plus a run with something to keep. Incomplete tools only count as
  // running while they belong to the live turn.
  const liveTools = useLiveToolIds(messages, bot);
  const liveTurns = useLiveTurnIds(messages, bot);
  const recordedRun = useMemo(() => runSteps(messages, liveTools), [messages, liveTools]);
  const recordedRunCounts = runSummary(recordedRun);
  const engineSupportsAgents = Boolean(
    engine?.capabilities?.agentsMcp,
  );
  const canSaveRun =
    skillAuthoringEnabled(state.config) && engineSupportsAgents && recordedRunCounts.passed > 0 && recordedRunCounts.running === 0 && recordedRunCounts.unverified === 0 && !bot.busy;
  // A dismissal is pinned to the run's last step, per thread: the card comes
  // back when the bot runs another command, not merely when a step settles,
  // and stays away across a switch to another thread and back.
  const [runDismissed, setRunDismissed] = useState<ReadonlyMap<string, string>>(() => new Map());
  const lastRunStep = recordedRun.at(-1);
  const showRunCard = useShowRunCard();

  // Only a tail of the thread mounts; everything derived below (lastBotTextId,
  // lastUserMessage, working dots) stays computed from the FULL list.
  const {
    scrollRef,
    transcriptRef,
    topSentinelRef,
    transcriptKey,
    following,
    followRef,
    stopFollowing,
    windowedMessages,
    hiddenCount,
    laterCount,
    olderPending,
    showLater,
    jumpToLatest,
    scrollHandlers,
  } = useTranscriptViewport({
    ownerId: bot.id,
    threadId: bot.threadId,
    messages,
    pinOn: [bot.busy, composerDockPad],
    hasMore: bot.hasMore,
    ...(sideLoadOlder ? { onLoadOlder: sideLoadOlder, loadingOlder: sideLoadingOlder } : {}),
  });
  // The run card sits in the right rail, over the transcript. It is not part
  // of the measured dock: folding it into the pad scrolls the thread by the
  // card's height each time the card appears or closes.
  const runOverlayRef = useRef<HTMLDivElement>(null);
  const runCardOpen = Boolean(
    lastRunStep && showRun(recordedRun) && showRunCard && runDismissed.get(transcriptKey) !== lastRunStep.id,
  );
  // Rows drawn for the first time above the viewport (.transcript-row) keep
  // the reader still.
  useOffscreenRowAnchor(scrollRef, transcriptRef, followRef, transcriptKey);
  // Seen (src/lib/read-receipts.ts): this person's own position while the window has focus.
  // Never for a cached page: the switch is what opens (and reads) the thread.
  useReportRead(preview ? undefined : bot.threadId, scrollRef, messages.at(-1)?.id);

  const lastBotTextId = useMemo(
    () => [...messages].reverse().find((m) => m.role === "bot" && m.kind === "text")?.id,
    [messages],
  );
  const unreadDivider = useUnreadDivider({ threadId: bot.threadId, messages, following });

  // What the rows read besides their own message (see ChatRows).
  const bots = useDrawnBots(storeBots);
  const mentionPeers = useMemo(() => bots.filter((peer) => peer.id !== bot.id), [bots, bot.id]);
  const showToolCalls = showToolCallRows(state.config);
  const tts = state.config?.tts;
  const localVoice = useLocalSystemVoice();
  const locale = useActiveLocale();
  const viewerName = state.config?.profile?.name?.trim() || undefined;
  const busy = Boolean(bot.busy);
  // read when a citation is clicked, so the rows need not change per message
  const branch = useRef(messages);
  useLayoutEffect(() => { branch.current = messages; }, [messages]);
  const onBranch = useCallback((messageId: string) => branch.current.some((m) => m.id === messageId), []);
  const colorMine = useColorUserBubbles();
  const coloredUserBubble = useMemo(() => (colorMine ? userBubbleStyle(bot.color) : undefined), [colorMine, bot.color]);
  const hasMore = Boolean(bot.hasMore);
  const reactionSelfKey = reactionSelfIds(state.config, threadReads.self).join("\n");
  const reactionSelf = useMemo(() => reactionSelfKey.split("\n").filter(Boolean), [reactionSelfKey]);
  const dmIds = useStoreSelector((current) => current.groups.filter((group) => group.dm && !group.peopleDm).map((group) => group.id), shallowEqual);
  const botDmIds = useMemo(() => new Set(dmIds), [dmIds]);
  const rows = useMemo<ChatRows>(
    () => ({ botId: bot.id, threadId: bot.threadId, botName: bot.name, viewerName, voiceId: bot.voice, tts, localVoice, hasMore, bots, mentionPeers, focus, showToolCalls, locale, dispatch, onBranch, reactionSelf, botDmIds, bubbleStyle: coloredUserBubble }),
    [bot.id, bot.threadId, bot.name, viewerName, bot.voice, tts, localVoice, hasMore, bots, mentionPeers, focus, showToolCalls, locale, dispatch, onBranch, reactionSelf, botDmIds, coloredUserBubble],
  );
  // Where this conversation works, for the place icon on screen and page tools.
  const place = effectivePlace(bot, bot.tasks?.find((task) => task.threadId === bot.threadId));

  return {
    messages, lookups, threadReads, seenPlace, seenBot, seenRow,
    recordedRun, recordedRunCounts, canSaveRun, runDismissed, setRunDismissed, lastRunStep, showRunCard,
    scrollRef, transcriptRef, topSentinelRef, transcriptKey, following, followRef, stopFollowing,
    windowedMessages, hiddenCount, laterCount, olderPending, showLater, jumpToLatest, scrollHandlers,
    runOverlayRef, runCardOpen, liveTools, liveTurns,
    lastBotTextId, unreadDivider,
    bots, mentionPeers, showToolCalls, tts, localVoice, locale, viewerName, busy, hasMore,
    reactionSelf, botDmIds, rows, place, branch, onBranch,
  };
}
