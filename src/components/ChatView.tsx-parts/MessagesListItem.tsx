import { StepBoundary, stepFallbackText } from "../MessageBoundary";
import type { ReactNode } from "react";
import { openBot, openThread, type Action, type Bot, type ConfigStatus, type Group, type InstanceInfo, type Message } from "@/state/store";
import { isCancelledTranscriptRow } from "../../../shared/client-cancel";
import { isPureLeakedSystemHarnessMessage } from "../../../shared/system-message-guard.ts";
import { failedTurnCause, isEngineLimitFailure, isPreSendRefusal } from "@/lib/failed-turn";
import { peerLine, peerRequest } from "@/lib/peer-message";
import { exchangeJumpStays, startsNewStretch, visibleEdge } from "@/lib/bot-exchange";
import { voiceCallVisibleSpan } from "@/lib/voice-call-transcript";
import { VoiceCallCard } from "../VoiceCallCard";
import { BotExchangeChip, TranscriptDate } from "../BotExchangeChip";
import { GotoGroupChip } from "../GotoGroupChip";
import type { GotoTarget } from "@/lib/goto-lines";
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
import { MessageBoundary, UnknownMessageCard, isUnknownMessageKind } from "../MessageBoundary";
import { WidgetMessage } from "../widget/WidgetMessage";
import { AppMessage } from "../AppMessage";
import { ConversationRoutineToggle } from "../RoutineToggleLine";
import { CallRecordRow } from "../CallRecordRow";
import { DataResultChip } from "../DataResultChip";
import { ParallelResultLabel, ParallelTaskCard } from "../ParallelTaskCard";
import { CompactionChip, DigestChip } from "../DigestChip";
import { ScreenFrame } from "../ScreenFrame";
import { VideoPlayerWidget } from "../video/VideoPlayerWidget";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { isStatusActivity, isTurnStoppedNotice } from "@/lib/activity-runs";
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
  busy,
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
  eager,
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
  busy: boolean;
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
      : entry.kind === "gotoGroup"
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
  const newDay = startsNewStretch(prev?.at, first.at);
  const rowKey = transcriptRowKey(item);
  const rowClass = index >= items.length - DRAWN_TAIL_ROWS || listedItemMessages(item).some((row) => row.id === focusedId)
    ? "contents" : "transcript-row";
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
    // Tool calls off: the steps go, a turn's narration stays folded.
    const shown = showToolCalls ? item.messages : item.messages.filter((step) => step.kind !== "activity");
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
              bare={!showToolCalls}
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
    // 2026-11-05: what a bot's turn elsewhere left for the person (src/components/AttentionCard.tsx)
    if (m.attention && m.role === "bot" && m.kind === "text") {
      return <MessageBoundary fallbackText={m.text ?? ""}><AttentionRow message={m} /></MessageBoundary>;
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
        return optionsCardRow({ message: m, transcript, botId, botName, threadId });
      case "widget":
        // bot-authored and persisted: one that throws while drawing falls back to its text
        return <MessageBoundary fallbackText={m.text ?? ""}><WidgetMessage botId={botId} threadId={threadId} message={m} /></MessageBoundary>;
      case "app":
        // a bot-authored live HTML surface, drawn in the sandboxed app frame
        return <MessageBoundary fallbackText={m.text ?? ""}><AppMessage message={m} /></MessageBoundary>;
      case "routine.run":
        return <RoutineRunRow message={m} botId={botId} />;
      case "routines":
        return <ConversationRoutineToggle message={m} />;
      case "call":
        // a finished Live call's record; its spoken lines stay inline
        return m.call ? <CallRecordRow message={m} transcript={transcript} botName={botName} busy={busy} hasMore={hasMore} /> : null;
      case "activity": {
        // a Data receipt first: its title is a person's words, never a status or error marker
        if (m.dataResult) return <DataResultChip message={m} />;
        if (isStatusActivity(m)) return <StatusActivityRow message={m} />;
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
        if (!showToolCalls && !m.threadRef && !m.dataResult && !m.inputRequest && !keepComm) return null;
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
        return (
          <>
          {m.parallelTask?.role === "result" && <ParallelResultLabel message={m} />}
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
