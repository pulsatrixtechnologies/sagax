import { StepBoundary, stepFallbackText } from "../MessageBoundary";
import { use, type ReactNode } from "react";
import { ChatBusyContext } from "@/components/MessageActions";
import { openBot, openThread, type Action, type Bot, type ConfigStatus, type Group, type InstanceInfo, type Message } from "@/state/store";
import { isCancelledTranscriptRow } from "../../../shared/client-cancel";
import { isPureLeakedSystemHarnessMessage } from "../../../shared/system-message-guard.ts";
import { failedTurnCause, isEngineLimitFailure, isPreSendRefusal } from "@/lib/failed-turn";
import { peerLine, peerRelay, peerRequest } from "@/lib/peer-message";
import { exchangeJumpStays, startsNewStretch, visibleEdge } from "@/lib/bot-exchange";
import { voiceCallVisibleSpan } from "@/lib/voice-call-transcript";
import { VoiceCallCard } from "../VoiceCallCard";
import { BotExchangeChip, TranscriptDate } from "../BotExchangeChip";
import { GotoGroupChip } from "../GotoGroupChip";
import { MessagedLine } from "../MessagedLine";
import { AskLine } from "../AskLine";
import { TeamNoteLine } from "../TeamNoteLine";
import { QuietModeLine } from "../QuietModeLine";
import { teamNoteCount, teamNoteFolded } from "@/lib/team-work";
import { silentChatItem, type GotoTarget } from "@/lib/goto-lines";
import { StatusActivityRow } from "@/components/StatusActivityRow";
import { CancelledTurnRow } from "../CancelledTurnRow";
import { ActivityRun } from "../ActivityRun";
import { CwActivityWidgets, CwWidgetView, shownCwWidget } from "../cw/CwWidgetView";
import { OwnerSettled, OwnerWait } from "../OwnerWait";
import { PagePublishCard } from "../PublishedPages";
import { OutboundCard } from "../OutboundCard";
import { AccessCard } from "../AccessCard";
import { SecretRequestCard } from "../SecretRequestCard";
import { SignInRequestCard } from "../SignInRequestCard";
import { GithubConnectCard } from "../GithubConnectCard";
import { optionsCardRow } from "../OptionsCardRow";
import { BriefItemsFeedback } from "../WakeFeedback";
import { MessageBoundary, UnknownMessageCard, isUnknownMessageKind } from "../MessageBoundary";
import { WidgetMessage } from "../widget/WidgetMessage";
import { AppMessage } from "../AppMessage";
import { ConversationRoutineToggle } from "../RoutineToggleLine";
import { CallRecordRow } from "../CallRecordRow";
import { DataResultChip } from "../DataResultChip";
import { ParallelTaskCard, wholeStepTitle } from "../ParallelTaskCard";
import { RelayProvenance, RelayViaLabel } from "../RelayViaLabel";
import { IncomingLine } from "../HandoffRow";
import { StepRow } from "../StepRow";
import { BotAvatar } from "../Avatar";
import { reportBrief } from "../../../shared/routine-result";
import type { MausColor } from "@/lib/mascot";
import { CompactionChip, DigestChip } from "../DigestChip";
import { ScreenFrame } from "../ScreenFrame";
import { VideoPlayerWidget } from "../video/VideoPlayerWidget";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { isStatusActivity, isTurnStoppedNotice } from "@/lib/activity-runs";
import { foldsLiveTurn } from "@/lib/tool-liveness";
import { LiveTurnsContext } from "@/hooks/use-live-tool-ids";
import { isFailedTeammateStep } from "@/lib/step-label";
import { botNames } from "../ToolActivity";
import { SeenByRow, type SeenFace } from "../SeenBy";
import { formatTime } from "@/state/store";
import type { EffectivePlace } from "@/lib/place";
import type { TranscriptLookups } from "@/lib/transcript-derivations";
import type { Dispatch } from "react";
import type { AppState } from "@/state/store";
import { ActivityChip, AttentionRow, RoutineRunRow } from "./chips";
import { Bubble } from "./Bubble";
import { FailedTurnRow } from "./ErrorRows";
import type { ListedItem } from "./types";
import { VirtualRow } from "../VirtualRow";

/** A transcript row's height before it was ever drawn (VirtualRow). */
export const TRANSCRIPT_ROW_ESTIMATE = 160;

/** The key a transcript row is virtualized (and remembered) by. */
export function transcriptRowKey(item: ListedItem): string {
  return `${item.kind}:${listedItemMessages(item)[0]?.id ?? (item.kind === "voiceCall" ? item.callId : "")}`;
}

export function listedItemMessages(item: ListedItem): readonly Message[] {
  return item.kind === "message" ? [item.message] : item.kind === "exchange" ? item.run.messages : item.messages;
}

export const DRAWN_TAIL_ROWS = 3;

export function MessagesListItem({
  item,
  index,
  items,
  windowIds,
  focusedId,
  divider,
  place,
  showToolCalls,
  bots,
  storeGroups,
  botId,
  threadId,
  botName,
  hasMore,
  engine,
  lookups,
  canRetryLast,
  pinnedMessageId,
  editingId,
  emergingId,
  lastBotTextId,
  newestMessageId,
  newestUserMessageId,
  transcript,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onReply,
  seen,
  config,
  appleMobileWeb,
  showThreads,
  getState,
  dispatch,
  latestPageVersionById,
  eager: eagerAsked,
}: {
  /** Draws its content at once: the visible tail, the focused and the
   * unread rows. The others wait until the scroller brings them near. */
  eager: boolean;
  item: ListedItem;
  index: number;
  items: ListedItem[];
  windowIds: Set<string>;
  focusedId: string | null;
  divider: ReactNode;
  place: EffectivePlace;
  showToolCalls: boolean;
  bots: readonly Bot[];
  storeGroups: readonly Group[];
  botId: string;
  threadId: string;
  botName: string;
  hasMore: boolean;
  engine: InstanceInfo | undefined;
  lookups: TranscriptLookups;
  canRetryLast: boolean;
  pinnedMessageId?: string;
  editingId: string | null;
  emergingId?: string | null;
  lastBotTextId: string | undefined;
  newestMessageId?: string;
  newestUserMessageId?: string;
  transcript: Message[];
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  onRegenerate: () => void;
  onReply: (message: Message) => void;
  seen?: { messageId: string; faces: SeenFace[] } | null;
  config: ConfigStatus | null | undefined;
  appleMobileWeb: boolean;
  showThreads: boolean;
  getState: () => AppState;
  dispatch: Dispatch<Action>;
  latestPageVersionById: Map<string, number>;
}): ReactNode {
  const edgeOf = (entry: ListedItem) =>
    entry.kind === "voiceCall"
      ? voiceCallVisibleSpan(entry.messages, windowIds)
      : entry.kind === "gotoGroup" || entry.kind === "messagedLine" || entry.kind === "askLine" || entry.kind === "incomingLine"
        ? { first: entry.messages[0]!, last: entry.messages.at(-1)! }
        : visibleEdge(entry);
  const hiddenRun = (entry: ListedItem) => entry.kind === "run" && !showToolCalls && entry.messages.every((step) => step.kind === "activity");
  let prev: Message | undefined;
  for (let j = index - 1; j >= 0; j--) {
    const candidate = items[j]!;
    if (hiddenRun(candidate)) continue;
    prev = edgeOf(candidate).last;
    break;
  }
  const first = edgeOf(item).first;
  // The single-message rows right above this one, nearest first.
  const rowsAbove = () => {
    const rows: Message[] = [];
    for (let j = index - 1; j >= 0 && items[j]!.kind === "message"; j--) rows.push((items[j] as { message: Message }).message);
    return rows;
  };
  const newDay = startsNewStretch(prev?.at, first.at);
  const rowKey = transcriptRowKey(item);
  const rowClass = index >= items.length - DRAWN_TAIL_ROWS || listedItemMessages(item).some((row) => row.id === focusedId)
    ? "contents" : "transcript-row";
  // The drawn tail always holds its content: a row without a box cannot be
  // virtualized (VirtualRow's rowHasNoBox, #3122).
  const eager = eagerAsked || rowClass === "contents";
  if (item.kind === "gotoGroup") {
    return (
      <VirtualRow key={item.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <div className="contents" data-mid={item.messages.find((message) => message.id === focusedId)?.id ?? item.messages[0]?.id}>
          <GotoGroupChip
            group={item}
            bots={bots}
            groups={storeGroups}
            showToolCalls={showToolCalls}
            focusedId={focusedId}
            onSelect={(target: GotoTarget) => {
              if (target.kind === "thread") {
                return openThread(dispatch, target.message.threadRef!, getState(), showThreads);
              }
              if (target.kind !== "exchange") return false;
              // Same rule as the lone line: another bot would leave this 1:1.
              if (!exchangeJumpStays(target.run.party.id, botId)) return false;
              const bot = bots.find((candidate) => candidate.id === target.run.party.id);
              if (!bot) return false;
              // the other bot opens where its row would (its one conversation)
              openBot(dispatch, bot, showThreads, { landing: false });
              return true;
            }}
          />
        </div>
      </VirtualRow>
    );
  }
  if (item.kind === "messagedLine") {
    const self = bots.find((candidate) => candidate.id === botId);
    return (
      <VirtualRow key={item.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <MessagedLine line={item} self={self} bots={bots} groups={storeGroups} />
      </VirtualRow>
    );
  }
  if (item.kind === "askLine") {
    const self = bots.find((candidate) => candidate.id === botId);
    return (
      <VirtualRow key={item.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <AskLine asks={item.asks} self={self} bots={bots} mid={item.messages[0]?.id} />
      </VirtualRow>
    );
  }
  if (item.kind === "incomingLine") {
    const self = bots.find((candidate) => candidate.id === botId);
    return (
      <VirtualRow key={item.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <IncomingLine line={item} self={self} bots={bots} mid={item.messages[0]?.id} />
      </VirtualRow>
    );
  }
  if (item.kind === "exchange") {
    return (
      <VirtualRow key={item.run.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <BotExchangeChip
          run={item.run}
          bots={bots}
          showToolCalls={showToolCalls}
          forceOpen={item.run.messages.some((message) => message.id === focusedId)}
          onGo={() => {
            // Another bot would leave this 1:1. False keeps the sheet.
            if (!exchangeJumpStays(item.run.party.id, botId)) return false;
            const target = bots.find((candidate) => candidate.id === item.run.party.id);
            if (!target) return false;
            // the other bot opens where its row would (its one conversation)
            openBot(dispatch, target, showThreads, { landing: false });
            return true;
          }}
        />
      </VirtualRow>
    );
  }
  if (item.kind === "voiceCall") {
    const hit = item.messages.find((message) => message.id === focusedId);
    return (
      <VirtualRow key={`voice:${item.callId}`} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <div className="contents" data-mid={hit?.id ?? item.messages[0]?.id}>
          <VoiceCallCard
            threadId={threadId}
            botName={botName}
            callId={item.callId}
            messages={item.messages}
            forceOpen={Boolean(hit)}
          />
        </div>
      </VirtualRow>
    );
  }
  if (item.kind === "run") {
    const hasWidget = item.messages.some((step) => shownCwWidget(step.tool));
    // Tool calls off: the steps go, a turn's narration stays folded. A
    // failed hand-off to a teammate stays: it is why no answer came.
    const shown = showToolCalls ? item.messages : item.messages.filter((step) => step.kind !== "activity" || isFailedTeammateStep(step));
    // Hidden steps still carry the divider: the reply under them is new.
    if (!shown.length && !hasWidget) return divider && <div key={item.id} className="contents">{divider}</div>;
    return (
      <VirtualRow key={item.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
        {newDay && <TranscriptDate at={first.at} />}
        {divider}
        <CwActivityWidgets messages={item.messages} threadId={threadId} botId={botId} />
        {shown.length > 0 && (
          <StepBoundary stepId={item.id} fallbackText={stepFallbackText(shown[0])}>
            <ActivityRun
              messages={shown}
              elapsedMs={item.elapsedMs}
              live={foldsLiveTurn(item.messages, use(LiveTurnsContext))}
              focusedId={focusedId}
              nameOf={botNames(bots)}
              renderStep={(step) => (
                <div className="contents" data-mid={step.id}>
                  <ActivityChip message={step} place={place} />
                </div>
              )}
              renderMessage={(message) => (
                <div className="contents" data-mid={message.id}>
                  <Bubble
                    message={message}
                    editing={false}
                    pinned={message.id === pinnedMessageId}
                    onStartEdit={onStartEdit}
                    onCancelEdit={onCancelEdit}
                    onSubmitEdit={onSubmitEdit}
                    replyTarget={lookups.replyTarget(message)}
                    onReply={onReply}
                  />
                </div>
              )}
            />
          </StepBoundary>
        )}
      </VirtualRow>
    );
  }
  const m = item.message;
  /** A reply that folds into one step row, or null for one drawn whole. */
  const foldedReply = (message: Message): { kind: string; label: string; icon?: ReactNode; failed?: boolean } | null => {
    const task = message.parallelTask;
    // a task that failed says it in the danger ink, as a failed step does
    if (task?.role === "result") return message.replyToId ? null : { kind: "task", label: task.title, ...(task.state === "failed" ? { failed: true } : {}) };
    const relay = peerRelay(message, botId);
    if (!relay) return null;
    // the nearest drawn row on that side, past hidden tool steps
    const relayedNear = (step: 1 | -1) => {
      for (let j = index + step; j >= 0 && j < items.length; j += step) {
        const near = items[j]!;
        if (hiddenRun(near) || silentChatItem(near, showToolCalls)) continue;
        return near.kind === "message" && Boolean(peerRelay(near.message, botId));
      }
      return false;
    };
    if (!relayedNear(-1) && !relayedNear(1)) return null;
    const author = bots.find((bot) => bot.id === relay.botId) ?? bots.find((bot) => bot.name === relay.name);
    return {
      kind: "teammate",
      label: author?.name ?? relay.name,
      icon: <BotAvatar bot={author ?? { name: relay.name, color: "blue" as MausColor }} state="happy" size={14} animated={false} />,
    };
  };
  const row = (() => {
    // A client abort is a stop, not a failure. Legacy rows still store
    // the provider's sentence or an error row; both read as this line.
    if (isCancelledTranscriptRow(m)) {
      return (
        <CancelledTurnRow
          onRetry={m.id === lookups.retryableId && canRetryLast ? onRegenerate : undefined}
        />
      );
    }
    if (m.state === "waiting-on-owner") {
      // #2042: the member who started this turn can Cancel while an
      // admin still holds the card. Same interrupt path as Stop.
      return (
        <OwnerWait
          ownerName={m.ownerName ?? ""}
          onCancel={() => dispatch({ type: "interrupt", botId, threadId })}
        />
      );
    }
    if (m.state === "owner-settled") return <OwnerSettled message={m} />;
    // #2109: connect_github's sign-in card (code, Copy code, Open link)
    if (m.githubConnect && m.role === "bot" && m.kind === "text") {
      return <MessageBoundary fallbackText={m.text ?? ""}><GithubConnectCard card={m.githubConnect} /></MessageBoundary>;
    }
    // #3480: the bot's quiet mode went off: one quiet line that opens the runs
    if (m.quietSummary && m.role === "bot" && m.kind === "text") {
      return <MessageBoundary fallbackText={m.text ?? ""}><QuietModeLine kept={m.quietSummary} botId={m.from?.botId ?? botId} /></MessageBoundary>;
    }
    // #3462: the person wrote to a team bot in a step's chat: one quiet line,
    // a burst that still meets the next row folds into it
    if (m.teamNote) {
      const after = items[index + 1];
      const next = after?.kind === "message" ? after.message.teamNote : undefined;
      if (teamNoteFolded(m.teamNote, next)) return null;
      const before: NonNullable<Message["teamNote"]>[] = [];
      for (const row of rowsAbove()) {
        if (!row.teamNote) break;
        before.unshift(row.teamNote);
      }
      return <TeamNoteLine note={m.teamNote} count={teamNoteCount(m.teamNote, before)} orchestratorId={botId} bots={bots} mid={m.id} />;
    }
    // 2026-11-05: what a bot's turn elsewhere left for the person (src/components/AttentionCard.tsx)
    if (m.attention && m.role === "bot" && m.kind === "text") {
      return <MessageBoundary fallbackText={m.text ?? ""}><AttentionRow message={m} threadId={threadId} botId={botId} /></MessageBoundary>;
    }
    // a bot's page proposal: its approval card (src/components/PublishedPages.tsx)
    if (m.pagePublish && m.role === "bot") {
      return (
        <MessageBoundary fallbackText={m.text ?? ""}>
          <PagePublishCard
            message={m}
            threadLatestVersion={latestPageVersionById.get(m.pagePublish.pageId)}
          />
        </MessageBoundary>
      );
    }
    // a phone call or a purchase on its card (src/components/OutboundCard.tsx)
    if (m.outbound && m.role === "bot") {
      return <MessageBoundary fallbackText={m.text ?? ""}><OutboundCard message={m} /></MessageBoundary>;
    }
    // a widget row whose tree never arrived still reads as its text
    switch (m.kind === "widget" && !m.widget ? "text" : m.kind) {
      case "access":
        return m.access ? (
          <AccessCard
            access={m.access}
            viewer={{ principalId: config?.viewer?.principalId ?? null, admin: config?.viewer?.role === "admin" || config?.viewer?.role === "owner" }}
            onSignIn={() => dispatch({ type: "toggleAppSettings", open: true, section: "providers" })}
          />
        ) : null;
      case "secret":
        return m.secret ? <SecretRequestCard botId={botId} threadId={threadId} message={m} /> : null;
      case "signin":
        return m.signIn ? <SignInRequestCard botId={botId} botName={botName} threadId={threadId} message={m} /> : null;
      case "options":
        if (m.relayVia) {
          const card = optionsCardRow({ message: m, transcript, botId, botName, threadId });
          return card && <><RelayProvenance message={m} bots={bots} self={bots.find((candidate) => candidate.id === botId)} />{card}</>;
        }
        return optionsCardRow({ message: m, transcript, botId, botName, threadId });
      case "widget":
        // bot-authored and persisted: one that throws while drawing falls back to its text
        return <MessageBoundary fallbackText={m.text ?? ""}><WidgetMessage botId={botId} threadId={threadId} message={m} /></MessageBoundary>;
      case "app":
        // a bot-authored live HTML surface, drawn in the sandboxed app frame
        return <MessageBoundary fallbackText={m.text ?? ""}><AppMessage message={m} /></MessageBoundary>;
      case "routine.run":
        return <RoutineRunRow message={m} botId={botId} threadId={threadId} />;
      case "routines":
        return <ConversationRoutineToggle message={m} />;
      case "call":
        // a finished Live call's record; its spoken lines stay inline
        return m.call ? <BusyCallRecordRow message={m} transcript={transcript} botName={botName} hasMore={hasMore} /> : null;
      case "activity": {
        // a Data receipt first: its title is a person's words, never a status or error marker
        if (m.dataResult) return <DataResultChip message={m} />;
        if (isStatusActivity(m)) return <BusyStatusActivityRow message={m} transcript={transcript} />;
        // a failed turn is an error, not a tool run — render it as one.
        // bot⇄bot comm chips and opened-thread chips stay because they
        // link to another conversation.
        // plain tool runs stay out unless Settings → Tool calls is on.
        if (isTurnStoppedNotice(m)) return null;
        if (m.tool && failedTurnCause(m.tool.name) !== null) {
          // Limit/credit: the composer says so; hide the chat error row too.
          if (isEngineLimitFailure(m.tool)) return null;
          // #2013: refused before any prompt went out: the composer says it
          if (isPreSendRefusal(m.tool)) return null;
          return (
            <FailedTurnRow
              tool={m.tool}
              engine={engine}
              botId={botId}
              threadId={threadId}
              onRetry={m.id === lookups.retryableId && canRetryLast ? onRegenerate : undefined}
            />
          );
        }
        if (m.parallelTask?.role === "card") return <ParallelTaskCard message={m} botId={botId} />;
        if (shownCwWidget(m.tool)) {
          return (
            <>
              <CwWidgetView widget={m.tool!.widget!} brand={m.tool!.product} threadId={threadId} botId={botId} />
              {showToolCalls ? <ActivityChip message={m} place={place} /> : null}
            </>
          );
        }
        // Tool calls (the details toggle) off: a plain step goes, and
        // so does a bot-to-bot comm chip — verbose detail, not the
        // clean chat (2026-10-22). A thread receipt (ThreadChip, on
        // the threads toggle), a Data receipt and an input request stay.
        // A comm chip stays on Apple mobile web (the only trace there a
        // teammate was consulted) and whenever the send failed.
        const keepComm = Boolean(m.comm) && (appleMobileWeb || m.tool?.ok === false);
        if (!showToolCalls && !m.threadRef && !m.dataResult && !m.inputRequest && !keepComm && !isFailedTeammateStep(m)) return null;
        return <ActivityChip message={m} place={place} />;
      }
      case "digest":
        // the summary of the turn's tool chips: shown under the same
        // server setting. iPhone/iPad hide the chips, not this receipt.
        return showToolCallsEnabled(config) ? <DigestChip message={m} /> : null;
      case "compaction":
        // Sagax's own folds are invisible (older threads still hold
        // them as rows); only a fold the person asked for shows.
        return m.compaction?.by === "harness" ? null : <CompactionChip message={m} />;
      case "screen":
        // views on request only (shared/requested-views.ts)
        return m.requested ? <ScreenFrame threadId={threadId} message={m} /> : null;
      case "video":
        return m.video && m.requested ? (
          <div className="flex justify-start">
            <VideoPlayerWidget
              video={m.video}
              onRequestRefresh={(text) => dispatch({ type: "send", botId, threadId, text })}
            />
          </div>
        ) : null;
      default: {
        if (isUnknownMessageKind(m.kind)) return <UnknownMessageCard text={m.text} />;
        const peer = peerLine(m) ?? peerRequest(m, botId);
        const user = m.role === "user" && !peer;
        if (!user && isPureLeakedSystemHarnessMessage(m.text) && !m.attachments?.length) {
          return null;
        }
        // #2915: a routine's or a wake's turn that left nothing to copy: its
        // label says why (a teammate's or an AI client's is its names line)
        if (!user && m.relayVia && m.relayTrace) return <RelayViaLabel message={m} />;
        // #3581: a reply the bot's own work brought back is a step row that
        // unfolds to the whole reply: the answer of a task the bot opened
        // itself, and each of two or more teammates' replies relayed for one
        // request. An answer to the person's own message stays whole.
        const folded = foldedReply(m);
        if (folded) {
          return (
            <div className={wholeStepTitle("label")} data-step-whole="label">
              <StepRow
                testId="folded-reply"
                data={{ "data-folded-reply": folded.kind }}
                label={folded.label}
                target={reportBrief(m.text, "start") || undefined}
                icon={folded.icon}
                phase={folded.failed ? "failed" : "done"}
                wide
              >
                {() => (
                  <Bubble
                    message={m}
                    editing={false}
                    pinned={m.id === pinnedMessageId}
                    onStartEdit={onStartEdit}
                    onCancelEdit={onCancelEdit}
                    onSubmitEdit={onSubmitEdit}
                    replyTarget={lookups.replyTarget(m)}
                    onReply={onReply}
                  />
                )}
              </StepRow>
            </div>
          );
        }
        return (
          <>
          {!user && m.relayVia && <RelayViaLabel message={m} />}
          <Bubble
            message={m}
            emerging={m.id === emergingId}
            eagerAttachments={m.id === newestMessageId || m.id === newestUserMessageId}
            editing={editingId === m.id}
            pinned={m.id === pinnedMessageId}
            versions={lookups.editVersions(m)}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSubmitEdit={onSubmitEdit}
            // only the last answer offers Regenerate; the others keep
            // their props when this callback changes
            onRegenerate={m.id === lastBotTextId ? onRegenerate : undefined}
            replyTarget={lookups.replyTarget(m)}
            onReply={onReply}
          />
          {/* #2694: each point of a brief, rated where it was said */}
          {!user && m.briefItems?.length ? <BriefItemsFeedback message={m} botId={botId} threadId={threadId} /> : null}
          </>
        );
      }
    }
  })();
  if (!row) return divider && <div key={m.id} className="contents">{divider}</div>;
  return (
    <VirtualRow key={m.id} rowKey={rowKey} eager={eager} estimate={TRANSCRIPT_ROW_ESTIMATE} className={rowClass}>
      {newDay && <TranscriptDate at={m.at} />}
      {divider}
      <div className="contents" data-mid={m.id}>
        {row}
        {seen?.messageId === m.id && <SeenByRow faces={seen.faces} end time={formatTime} />}
      </div>
    </VirtualRow>
  );
}

// A call record and a status line follow the turn (a live call, a step still
// running): they read it themselves, so the other rows do not.
function BusyCallRecordRow(props: Omit<Parameters<typeof CallRecordRow>[0], "busy">) {
  return <CallRecordRow {...props} busy={use(ChatBusyContext)} />;
}

function BusyStatusActivityRow(props: Omit<Parameters<typeof StatusActivityRow>[0], "busy">) {
  return <StatusActivityRow {...props} busy={use(ChatBusyContext)} />;
}
