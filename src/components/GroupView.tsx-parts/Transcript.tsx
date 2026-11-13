import { memo, useCallback, useEffect, useMemo } from "react";
import { pinnedJumpTarget, usePinnedHeld } from "@/lib/pinned-waiting";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { openThread, useStore, type Bot, type Group, type Message } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { PersonAvatar } from "../MessageAuthor";
import { withoutDeadThreadChips } from "@/lib/dead-thread-chips";
import { useLiveToolIds } from "@/hooks/use-live-tool-ids";
import { botNames } from "../ToolActivity";
import { roomActivityVisible } from "@/lib/room-activity";
import { viewerActorId } from "@/lib/viewer";
import { personDisplayName, personInitials, roomAuthor, continuesRun } from "@/lib/room-authors";
import { botIdOfParticipant, messageParticipant, seenRows, type ThreadReads } from "@/lib/read-receipts";
import { SEEN_AVATAR_SIZE, type SeenFace } from "../SeenBy";
import { reactionSelfIds } from "@/lib/reactions";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { showToolCallRows } from "@/lib/tool-activity-rows";
import { personAvatarSrc } from "@/lib/profile-management";
import type { MentionPeer } from "@/lib/mentions";
import { personMentionPeers } from "@/lib/person-mentions";
import { repeatedFailureIds } from "../../../shared/failure-dedup";
import { groupActivityRuns, isHiddenStatusActivity, roomTurnFolds, type ActivityTranscriptItem } from "@/lib/activity-runs";
import { collapseBotExchanges, startsNewStretch, visibleEdge, type ExchangeRun } from "@/lib/bot-exchange";
import { foldCollapsedEntry, voiceCallPlan, voiceCallVisibleSpan } from "@/lib/voice-call-transcript";
import { VoiceCallCard } from "../VoiceCallCard";
import { BotExchangeChip, TranscriptDate } from "../BotExchangeChip";
import { GotoGroupChip } from "../GotoGroupChip";
import { collapseGotoLines, gotoTargetOf, unifiedGotoTargetOf, type GotoGroup } from "@/lib/goto-lines";
import { ActivityRun } from "../ActivityRun";
import { StepBoundary, stepFallbackText } from "../MessageBoundary";
import { CwActivityWidgets, shownCwWidget } from "../cw/CwWidgetView";
import { ClusterLabel } from "../ClusterLabel";
import { isCancelledTranscriptRow } from "../../../shared/client-cancel";
import { roomRetryRequest } from "@/lib/room-retry";
import { isTransientChatNotice } from "../../../shared/transient-notices";
import { routineRunRowOutOfChat, routineRunsCounted } from "../../../shared/routine-repeat";
import { unreadMessageIds } from "@/lib/unread-divider";
import { NewMessagesDivider } from "../NewMessagesDivider";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { roomThreadWorking } from "@/lib/room-threads";
import { RoomToolChip } from "./RoomToolChip";
import { RoomMessageItem } from "./RoomMessageItem";
import { NO_PEOPLE } from "./RoomTextMessage";

type RoomItem =
  | ActivityTranscriptItem
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "voiceCall"; callId: string; messages: Message[] }
  | GotoGroup;

/** The messages one room item draws. */
function roomItemMessages(item: RoomItem): readonly Message[] {
  return item.kind === "message" ? [item.message] : item.kind === "exchange" ? item.run.messages : item.messages;
}

export const Transcript = memo(function Transcript({
  group,
  members,
  messages,
  transcript,
  emergingId,
  unreadDividerId = null,
  unreadDividerFading = false,
  onReply,
  people,
  reads,
  reader,
}: {
  group: Group;
  members: Bot[];
  /** Invalidate the memoized transcript when only the language changes. */
  locale: string;
  /** The windowed suffix of group.messages — the boundary lives in GroupView. */
  messages: Message[];
  /** Full room transcript, used to resolve quoted messages outside the mounted window. */
  transcript: Message[];
  emergingId?: string | null;
  /** The New divider goes above the row holding this message. */
  unreadDividerId?: string | null;
  unreadDividerFading?: boolean;
  onReply: (message: Message) => void;
  /** The organization's people (display names, avatars); empty elsewhere. */
  people?: ReadonlyMap<string, OrgDirectoryPerson>;
  /** Read positions this viewer may see (src/lib/read-receipts.ts). */
  reads?: ThreadReads;
  /** The viewer's own participant id: never drawn. */
  reader?: string | null;
}) {
  "use memo";
  const { state, dispatch } = useStore();
  const reactionSelfKey = reactionSelfIds(state.config, reader).join("\n");
  const reactionSelf = useMemo(() => reactionSelfKey.split("\n").filter(Boolean), [reactionSelfKey]);
  const showToolCalls = showToolCallRows(state.config);
  const owners = useMemo(() => ({ bots: state.bots, groups: state.groups }), [state.bots, state.groups]);
  const showThreads = useShowThreads();
  const memberOf = (id?: string) => members.find((b) => b.id === id);
  const mentionPeers = useMemo<MentionPeer[]>(
    () => [...members, ...personMentionPeers(group, people ?? new Map(), viewerActorId(state.config))],
    [members, group, people, state.config],
  );
  const pairChannel = Boolean(group.dm) && !group.peopleDm;
  // Bot-to-bot lines become one chip per run first. A shared room's replies
  // to people stay inline; only a pair channel, a peer line, or a room
  // request collapses.
  // A settled member turn reads as its final message: its working notes fold
  // into one reversible row above it, so teammates never take a note for the
  // answer.
  const folds = useMemo(() => roomTurnFolds(messages), [messages]);
  const showDigests = showToolCallsEnabled(state.config);
  // #3681: an ask the room's pinned card holds is drawn there only while it waits
  const held = usePinnedHeld();
  const items = useMemo(() => {
    const plan = voiceCallPlan(transcript);
    const seen = new Set<string>();
    // a failed routine run and a routine's access card pass as a banner
    // (TransientNotice), never a row (shared/transient-notices.ts)
    // one row per bot and failure since that bot last answered (shared/failure-dedup.ts)
    // A digest that draws nothing is no row either, so the reply after it
    // still opens its speaker's cluster and carries the name.
    const repeats = repeatedFailureIds(messages);
    // #4201: the first run a stored count names leaves with the count
    const counted = routineRunsCounted(transcript);
    const visible = withoutDeadThreadChips(messages, owners).filter((message) =>
      !repeats.has(message.id) &&
      !held.has(message.id) &&
      !isTransientChatNotice(message) &&
      // #3990: a run's row that only says how it went stays in the run log
      !routineRunRowOutOfChat(message, counted) &&
      !folds.hiddenIds.has(message.id) &&
      (message.kind !== "digest" || showDigests) &&
      // one conversation (#2081): with threads off an opened thread's receipt
      // is a plain "Messaged <session>" step, never a "Go to conversation" link
      (message.kind !== "activity" || (!isHiddenStatusActivity(message) && roomActivityVisible(message, showToolCalls))));
    const collapsed = collapseBotExchanges(visible, {
      pairChannel,
      members: members.map((member) => ({ id: member.id, name: member.name, color: member.color })),
      lookup: transcript,
    });
    const listed: RoomItem[] = [];
    let pending: Message[] = [];
    const flush = () => {
      if (!pending.length) return;
      listed.push(...groupActivityRuns(pending));
      pending = [];
    };
    for (const entry of collapsed) {
      for (const piece of foldCollapsedEntry(entry, plan, seen)) {
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
    // Two or more "Go to conversation" lines in a row become one chip. Hidden
    // tool steps are already out; a folded run with Tool calls off draws nothing.
    return collapseGotoLines(listed, (item) =>
      item.kind === "run" && !showToolCalls && !item.messages.some((step) => shownCwWidget(step.tool)),
      showThreads ? gotoTargetOf : unifiedGotoTargetOf) as RoomItem[];
  }, [messages, showToolCalls, showDigests, folds, pairChannel, members, transcript, owners, showThreads, held]);
  const windowIds = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  // Seen by: each participant once, under the last line they have read.
  const seen = useMemo(() => {
    if (!reads || !Object.keys(reads).length) return new Map<string, SeenFace[]>();
    const anchorable = new Set(items.flatMap((item) =>
      item.kind === "message" && item.message.kind === "text" && (item.message.text || item.message.attachments?.length) ? [item.message.id] : []));
    const byId = new Map(transcript.map((message) => [message.id, message]));
    const rows = seenRows({
      order: transcript,
      anchorable,
      reads,
      self: reader ?? null,
      authorOf: (id) => {
        const message = byId.get(id);
        return message ? messageParticipant(message) : null;
      },
    });
    const directory = people ?? NO_PEOPLE;
    const senderNames = new Map(transcript.flatMap((message) => message.sender?.id ? [[message.sender.id.trim().toLowerCase(), message.sender.name] as const] : []));
    const faces = new Map<string, SeenFace[]>();
    for (const [messageId, entries] of rows) {
      const row: SeenFace[] = [];
      for (const entry of entries) {
        const botId = botIdOfParticipant(entry.participantId);
        if (botId) {
          const bot = members.find((member) => member.id === botId);
          if (!bot) continue;
          row.push({ ...entry, name: bot.name, avatar: <BotAvatar bot={bot} state="happy" size={SEEN_AVATAR_SIZE} motion="none" motionKey={0} animated={false} /> });
          continue;
        }
        const person = directory.get(entry.participantId);
        const name = (person && personDisplayName(person)) || senderNames.get(entry.participantId) || t("seen.someone");
        row.push({ ...entry, name, avatar: <PersonAvatar avatarUrl={personAvatarSrc(person?.avatarUrl)} initials={personInitials(name)} size={SEEN_AVATAR_SIZE} /> });
      }
      if (row.length) faces.set(messageId, row);
    }
    return faces;
  }, [items, transcript, reads, reader, people, members]);
  const newestMessageId = messages.at(-1)?.id;
  const newestUserMessageId = [...messages].reverse().find((message) => message.role === "user")?.id;
  // the open thread's own turn: another thread working beside it leaves
  // this one free to retry
  const roomBusy = roomThreadWorking(group, group.threadId);
  const liveTools = useLiveToolIds(transcript, { busy: roomBusy, turnStartedAt: group.turnStartedAt });
  let retryableId: string | undefined;
  let retryableIndex = -1;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const candidate = transcript[index];
    if (candidate && candidate.kind !== "digest" && candidate.kind !== "compaction") {
      retryableId = candidate.id;
      retryableIndex = index;
      break;
    }
  }
  // Only the newest row can retry, and it resends the request its own turn
  // answered, files included.
  const retryRequest = useMemo(() => {
    const newest = transcript[retryableIndex];
    return newest && isCancelledTranscriptRow(newest) ? roomRetryRequest(transcript, retryableIndex) : null;
  }, [transcript, retryableIndex]);
  const retryRoom = useCallback(() => {
    if (!retryRequest || roomBusy) return;
    dispatch({
      type: "sendGroup",
      groupId: group.id,
      text: retryRequest.text,
      threadId: group.threadId,
      mode: retryRequest.mode,
      ...(retryRequest.replyToId ? { replyToId: retryRequest.replyToId } : {}),
    });
  }, [dispatch, group.id, group.threadId, retryRequest, roomBusy]);
  // Only the newest goal card of the task offers Resume or Run again; an
  // older receipt stays a record of what happened.
  const latestGoalRunMessageId = useMemo(
    () => [...transcript].reverse().find((message) => message.kind === "goal.run" && message.goalRun)?.id,
    [transcript],
  );
  const stopGoalRun = useCallback(() => {
    dispatch({ type: "interruptGroup", groupId: group.id, threadId: group.threadId });
  }, [dispatch, group.id, group.threadId]);
  const runGoalAgain = useCallback((goal: string) => {
    if (!goal.trim() || roomBusy) return;
    dispatch({ type: "sendGroup", groupId: group.id, text: goal, threadId: group.threadId, mode: "goal" });
  }, [dispatch, group.id, group.threadId, roomBusy]);
  const focus = state.focusMessage;
  const focusedId = focus && !focus.consumed && focus.threadId === group.threadId ? focus.messageId : null;
  // #3681: "See in the conversation" on a held ask lands where it was asked
  useEffect(() => {
    if (!focusedId || !held.has(focusedId)) return;
    const target = pinnedJumpTarget(transcript, focusedId, held);
    if (target !== focusedId) dispatch({ type: "focusMessage", threadId: group.threadId, messageId: target });
  }, [focusedId, held, transcript, group.threadId, dispatch]);
  // Who wrote each item, and whether it continues the run above it: one
  // name and avatar per run, tighter spacing inside it.
  const runs = useMemo(() => {
    const directory = people ?? NO_PEOPLE;
    const entries = items.map((item) => {
      if (item.kind === "gotoGroup") {
        return { first: item.messages[0]!, last: item.messages.at(-1)!, author: { kind: "none" as const, key: item.id } };
      }
      if (item.kind === "exchange" || item.kind === "voiceCall") {
        const edge = item.kind === "voiceCall" ? voiceCallVisibleSpan(item.messages, windowIds) : visibleEdge(item);
        const key = item.kind === "exchange" ? `exchange:${item.run.id}` : `voice:${item.callId}`;
        return { first: edge.first, last: edge.last, author: { kind: "none" as const, key } };
      }
      const first = item.kind === "run" ? item.messages[0] : item.message;
      const last = item.kind === "run" ? item.messages.at(-1)! : item.message;
      return { first, last, author: roomAuthor(first, state.config, directory) };
    });
    const joinsAbove = entries.map((entry, i) => {
      const prev = entries[i - 1];
      return continuesRun(prev && { at: prev.last.at, comm: prev.last.comm, author: prev.author }, { at: entry.first.at, author: entry.author });
    });
    return entries.map((entry, i) => ({ author: entry.author, joinsAbove: joinsAbove[i]!, joinsBelow: joinsAbove[i + 1] ?? false }));
  }, [items, people, state.config, windowIds]);
  // The divider sits above the first drawn row from its message on; hidden
  // tool lines are not items here.
  const unreadIds = useMemo(() => unreadMessageIds(messages, unreadDividerId), [messages, unreadDividerId]);
  // The New divider goes above the first item holding an unread message.
  const dividerIndex = useMemo(() => unreadIds
    ? items.findIndex((item) => roomItemMessages(item).some((row) => unreadIds.has(row.id)))
    : -1, [items, unreadIds]);
  const dividerAbove = (index: number) => index === dividerIndex ? <NewMessagesDivider fading={unreadDividerFading} /> : null;
  return (
    <>
      {items.map((item, i) => {
        const edgeOf = (entry: RoomItem) =>
          entry.kind === "voiceCall"
            ? voiceCallVisibleSpan(entry.messages, windowIds)
            : entry.kind === "gotoGroup"
              ? { first: entry.messages[0]!, last: entry.messages.at(-1)! }
              : visibleEdge(entry);
        const hiddenRun = (entry: RoomItem) => entry.kind === "run" && !showToolCalls;
        let prev: Message | undefined;
        for (let j = i - 1; j >= 0; j--) {
          const candidate = items[j]!;
          if (hiddenRun(candidate)) continue;
          prev = edgeOf(candidate).last;
          break;
        }
        const first = edgeOf(item).first;
        const newDay = startsNewStretch(prev?.at, first.at);
        const divider = dividerAbove(i);
        if (item.kind === "gotoGroup") {
          return (
            <div key={item.id} className="contents">
              {newDay && <TranscriptDate at={first.at} />}
              {divider}
              <div className="contents" data-mid={item.messages.find((message) => message.id === focusedId)?.id ?? item.messages[0]?.id}>
                <GotoGroupChip
                  group={item}
                  bots={state.bots}
                  groups={state.groups}
                  focusedId={focusedId}
                  // A room's exchange is read in this column, as its lone line is.
                  onSelect={(target) =>
                    target.kind === "thread" ? openThread(dispatch, target.message.threadRef!, state, showThreads) : false}
                />
              </div>
            </div>
          );
        }
        if (item.kind === "exchange") {
          return (
            <div key={item.run.id} className="contents">
              {newDay && <TranscriptDate at={first.at} />}
              {divider}
              <BotExchangeChip
                run={item.run}
                bots={members}
                forceOpen={item.run.messages.some((message) => message.id === focusedId)}
                onGo={() => false}
              />
            </div>
          );
        }
        if (item.kind === "run") {
          const hasWidget = item.messages.some((step) => shownCwWidget(step.tool));
          // Hidden steps still carry the divider: the reply under them is new.
          if (!showToolCalls && !hasWidget) return divider && <div key={item.id} className="contents">{divider}</div>;
          const cluster = !runs[i]!.joinsAbove;
          return (
            <div key={item.id} className="contents">
              {newDay && <TranscriptDate at={first.at} />}
              {divider}
              {first.from && cluster && (
                <ClusterLabel bot={memberOf(first.from.botId)} name={first.from.name} color={first.from.color} />
              )}
              <CwActivityWidgets messages={item.messages} threadId={group.threadId} botId={first.from?.botId} />
              {showToolCalls && (
                <StepBoundary stepId={item.id} fallbackText={stepFallbackText(item.messages[0])}>
                  <ActivityRun
                    messages={item.messages}
                    elapsedMs={item.elapsedMs}
                    focusedId={focusedId}
                    nameOf={botNames(state.bots)}
                    renderStep={(step) => (
                      <div className="contents" data-mid={step.id}>
                        <RoomToolChip message={step} live={liveTools.has(step.id)} />
                      </div>
                    )}
                  />
                </StepBoundary>
              )}
            </div>
          );
        }
        if (item.kind === "voiceCall") {
          const hit = item.messages.find((message) => message.id === focusedId);
          return (
            <div key={`voice:${item.callId}`} className="contents">
              {newDay && <TranscriptDate at={first.at} />}
              {divider}
              <div className="contents" data-mid={hit?.id ?? item.messages[0]?.id}>
                <VoiceCallCard
                  threadId={group.threadId}
                  botName={group.name}
                  callId={item.callId}
                  messages={item.messages}
                  forceOpen={Boolean(hit)}
                />
              </div>
            </div>
          );
        }
        return (
          <RoomMessageItem
            key={item.message.id}
            message={item.message}
            run={runs[i]!}
            newDay={newDay}
            divider={divider}
            group={group}
            members={members}
            mentionPeers={mentionPeers}
            transcript={transcript}
            emergingId={emergingId}
            newestMessageId={newestMessageId}
            newestUserMessageId={newestUserMessageId}
            onReply={onReply}
            reactionSelf={reactionSelf}
            seen={seen}
            retryableId={retryableId}
            retryRequest={retryRequest}
            roomBusy={roomBusy}
            liveTools={liveTools}
            retryRoom={retryRoom}
            stopGoalRun={stopGoalRun}
            latestGoalRunMessageId={latestGoalRunMessageId}
            runGoalAgain={runGoalAgain}
            showToolCalls={showToolCalls}
            memberOf={memberOf}
            state={state}
            dispatch={dispatch}
            fold={folds.byTerminalId.get(item.message.id)}
            focusedId={focusedId}
          />
        );
      })}
    </>
  );
});

