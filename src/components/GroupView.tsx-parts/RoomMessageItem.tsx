import { viewerOwnsBot } from "@/lib/bot-capabilities";
import type { ReactNode } from "react";
import { formatTime, openRoutineRun, useStore, type Bot, type Group, type Message } from "@/state/store";
import type { RoomRetryRequest } from "@/lib/room-retry";
import { ClusterLabel } from "../ClusterLabel";
import { RoomPersonLabel } from "../MessageAuthor";
import { SeenByRow, type SeenFace } from "../SeenBy";
import { TranscriptDate } from "../BotExchangeChip";
import { CancelledTurnRow } from "../CancelledTurnRow";
import { OwnerSettled, OwnerWait } from "../OwnerWait";
import { SecretRequestCard } from "../SecretRequestCard";
import { SignInRequestCard } from "../SignInRequestCard";
import { MessageBoundary } from "../MessageBoundary";
import { QuestionCard } from "../QuestionCard";
import { ApprovalCard, approvalCardStaysInChat } from "../ApprovalCard";
import { OptionCard } from "../OptionCard";
import { AccessCard } from "../AccessCard";
import { GoalRunCard, goalRunPlace } from "../GoalRunCard";
import { RoutineRunCard } from "../RoutineRunCard";
import { CwWidgetView, shownCwWidget } from "../cw/CwWidgetView";
import { RoomToolChip } from "./RoomToolChip";
import { roomActivityVisible } from "@/lib/room-activity";
import { DataResultChip } from "../DataResultChip";
import { StatusActivityRow } from "../StatusActivityRow";
import { isStatusActivity, type TurnFold } from "@/lib/activity-runs";
import { ScreenFrame } from "../ScreenFrame";
import { VideoPlayerWidget } from "../video/VideoPlayerWidget";
import { CompactionChip, DigestChip } from "../DigestChip";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { NudgeLine } from "../NudgeLine";
import { RosterLine } from "../RosterLine";
import { ConversationRoutineToggle } from "../RoutineToggleLine";
import { isPureLeakedSystemHarnessMessage } from "../../../shared/system-message-guard.ts";
import { RoomTextMessage } from "./RoomTextMessage";
import { isCancelledTranscriptRow } from "../../../shared/client-cancel";
import type { MentionPeer } from "@/lib/mentions";
import { roomAuthor } from "@/lib/room-authors";
import { ActivityRun } from "../ActivityRun";
import { botNames } from "../ToolActivity";

type RunMeta = {
  author: ReturnType<typeof roomAuthor>;
  joinsAbove: boolean;
  joinsBelow: boolean;
};

export function RoomMessageItem({
  message: m,
  run,
  newDay,
  divider,
  group,
  members,
  mentionPeers,
  transcript,
  emergingId,
  newestMessageId,
  newestUserMessageId,
  onReply,
  reactionSelf,
  seen,
  retryableId,
  retryRequest,
  roomBusy,
  liveTools,
  retryRoom,
  stopGoalRun,
  latestGoalRunMessageId,
  runGoalAgain,
  showToolCalls,
  memberOf,
  state,
  dispatch,
  fold,
  focusedId,
}: {
  message: Message;
  run: RunMeta;
  newDay: boolean;
  divider: ReactNode;
  group: Group;
  members: Bot[];
  mentionPeers: MentionPeer[];
  transcript: Message[];
  emergingId?: string | null;
  newestMessageId?: string;
  newestUserMessageId?: string;
  onReply: (message: Message) => void;
  reactionSelf: readonly string[];
  seen: Map<string, SeenFace[]>;
  retryableId?: string;
  retryRequest: RoomRetryRequest | null;
  roomBusy: boolean;
  liveTools: ReadonlySet<string>;
  retryRoom: () => void;
  stopGoalRun: () => void;
  latestGoalRunMessageId?: string;
  runGoalAgain: (goal: string) => void;
  showToolCalls: boolean;
  memberOf: (id?: string) => Bot | undefined;
  state: ReturnType<typeof useStore>["state"];
  dispatch: ReturnType<typeof useStore>["dispatch"];
  fold?: TurnFold;
  focusedId?: string | null;
}): ReactNode {
  const user = m.role === "user";
  const { author, joinsAbove, joinsBelow } = run;
  const newCluster = !joinsAbove;
  const mine = author.kind === "self";
  const person = author.kind === "person" ? author : null;
  const routineRunRef = m.kind === "routine.run" && m.routineRun?.runId ? m.routineRun : undefined;
  const canRetryRoom = m.id === retryableId && retryRequest !== null && !roomBusy;

  const row = isCancelledTranscriptRow(m) ? (
    // A client abort is a stop, not a failure. Rooms have no edit
    // fork, so Retry is the room's own send.
    <CancelledTurnRow onRetry={canRetryRoom ? retryRoom : undefined} />
  ) :
    // Someone who is not the owner sees the wait, not an approval.
    m.state === "waiting-on-owner" ? (
      <div className="flex justify-start">
        {(() => {
          // #2042: only the person whose bot started this wait can
          // Cancel; Allow/Deny stay on the admin's card.
          const speaker = memberOf(m.from?.botId) ?? memberOf(group.busyBotId ?? undefined);
          const onCancel = speaker && viewerOwnsBot(state.config, speaker)
            ? () => dispatch({ type: "interruptGroup", groupId: group.id, threadId: group.threadId })
            : undefined;
          return <OwnerWait ownerName={m.ownerName ?? ""} onCancel={onCancel} />;
        })()}
      </div>
    ) : m.state === "owner-settled" ? (
      <div className="flex justify-start">
        <OwnerSettled message={m} />
      </div>
    ) : m.kind === "secret" && m.secret && m.from?.botId ? (
      <SecretRequestCard botId={m.from.botId} threadId={group.threadId} message={m} />
    ) : m.kind === "signin" && m.signIn && m.from?.botId ? (
      <SignInRequestCard botId={m.from.botId} botName={m.from.name} threadId={group.threadId} message={m} />
    ) : m.kind === "options" && m.card?.requestId && m.card.questionRequest ? (
      <div className="flex justify-start">
        <MessageBoundary fallbackText={m.card.subtitle || m.card.title || ""}>
          <QuestionCard threadId={group.threadId} bot={memberOf(m.from?.botId)} message={m} />
        </MessageBoundary>
      </div>
    ) : m.kind === "options" && m.card?.requestId && m.card.tool ? (
      approvalCardStaysInChat(m.card) ? (
        <div className="flex justify-start">
          <MessageBoundary fallbackText={m.card.subtitle || m.card.title || ""}>
            <ApprovalCard bot={memberOf(m.from?.botId)} message={m} threadId={group.threadId} />
          </MessageBoundary>
        </div>
      ) : null
    ) : m.kind === "options" && m.card && m.from?.botId ? (
      // a QUESTION from a member. Without this branch the card fell
      // through to null: invisible on screen, and the asking bot sat
      // there until its 15-minute timeout answered for you
      <div className="flex justify-start">
        <MessageBoundary fallbackText={m.card.subtitle || m.card.title || ""}>
          <OptionCard botId={m.from.botId} threadId={group.threadId} groupId={group.id} message={m} />
        </MessageBoundary>
      </div>
    ) : m.kind === "access" && m.access ? (
      <div className="flex justify-start">
        <AccessCard
          access={m.access}
          viewer={{ principalId: state.config?.viewer?.principalId ?? null, admin: state.config?.viewer?.role === "admin" || state.config?.viewer?.role === "owner" }}
          onSignIn={() => dispatch({ type: "toggleAppSettings", open: true, section: "providers" })}
        />
      </div>
    ) : m.kind === "goal.run" ? (
      <div className="flex justify-start">
        <GoalRunCard
          message={m}
          history={goalRunPlace(group.messages, m.id)}
          onStop={stopGoalRun}
          onRunAgain={m.id === latestGoalRunMessageId && m.goalRun?.goal && !roomBusy
            ? () => runGoalAgain(m.goalRun!.goal)
            : undefined}
        />
      </div>
    ) : m.kind === "routine.run" ? (
      <div className="flex justify-start">
        <RoutineRunCard
          message={m}
          bot={state.bots.find((candidate) => candidate.id === m.from?.botId)}
          botOf={(id) => state.bots.find((candidate) => candidate.id === id)}
          onOpen={routineRunRef
            ? () => openRoutineRun(dispatch, { runId: routineRunRef.runId, routineId: routineRunRef.routineId })
            : undefined}
        />
      </div>
    ) : m.kind === "activity" && shownCwWidget(m.tool) ? (
      <div className="flex flex-col gap-2">
        <CwWidgetView widget={m.tool!.widget!} brand={m.tool!.product} threadId={group.threadId} botId={m.from?.botId} />
        {roomActivityVisible(m, showToolCalls) ? <RoomToolChip message={m} roomId={group.id} live={liveTools.has(m.id)} /> : null}
      </div>
    ) : m.kind === "activity" && m.tool ? (
      roomActivityVisible(m, showToolCalls) ? (
        m.dataResult ? <DataResultChip message={m} /> : isStatusActivity(m) ? <StatusActivityRow message={m} /> : <RoomToolChip message={m} roomId={group.id} live={liveTools.has(m.id)} />
      ) : null
    ) : m.kind === "screen" ? (
      // views on request only (shared/requested-views.ts)
      m.requested ? <ScreenFrame threadId={group.threadId} message={m} /> : null
    ) : m.kind === "video" && m.video ? (
      m.requested ? (
        <div className="flex justify-start">
          <VideoPlayerWidget video={m.video} />
        </div>
      ) : null
    ) : m.kind === "compaction" ? (
      m.compaction?.by === "harness" ? null : <CompactionChip message={m} />
    ) : m.kind === "digest" ? (
      showToolCallsEnabled(state.config) ? <DigestChip message={m} /> : null
    ) : m.kind === "nudge" && m.nudge ? (
      <NudgeLine note={m.nudge} />
    ) : m.kind === "roster" && m.roster ? (
      <RosterLine note={m.roster} />
    ) : m.kind === "routines" && m.routineToggle ? (
      <ConversationRoutineToggle message={m} />
    ) : m.kind === "text" && (m.text || m.attachments?.length) ? (
      !user && isPureLeakedSystemHarnessMessage(m.text) && !m.attachments?.length ? null : (
        <RoomTextMessage
          group={group}
          message={m}
          members={members}
          mentionPeers={mentionPeers}
          transcript={transcript}
          emerging={m.id === emergingId}
          eager={m.id === newestMessageId || m.id === newestUserMessageId}
          mine={mine}
          joinsAbove={joinsAbove}
          joinsBelow={joinsBelow}
          onReply={onReply}
          reactionSelf={reactionSelf}
        />
      )
    ) : null;
  if (!row) return divider && <div key={m.id} className="contents">{divider}</div>;
  return (
    <div key={m.id} className="contents">
      {newDay && <TranscriptDate at={m.at} />}
      {divider}
      <div className="contents" data-mid={m.id}>
        {!user && m.from && newCluster && !(m.kind === "activity" && m.comm) && (
          <ClusterLabel bot={memberOf(m.from.botId)} name={m.from.name} color={m.from.color} />
        )}
        {person && newCluster && <RoomPersonLabel name={person.name} initials={person.initials} avatarUrl={person.avatarUrl} personId={person.personId} onOpen={(personId) => dispatch({ type: "openPersonPanel", personId })} />}
        {fold && (
          <ActivityRun
            messages={fold.messages}
            elapsedMs={fold.elapsedMs}
            focusedId={focusedId}
            nameOf={botNames(state.bots)}
            renderStep={() => null}
            renderMessage={(note) => (
              <div className="contents" data-mid={note.id}>
                <RoomTextMessage
                  group={group}
                  message={note}
                  members={members}
                  mentionPeers={mentionPeers}
                  transcript={transcript}
                  emerging={false}
                  eager={false}
                  mine={false}
                  joinsAbove={false}
                  joinsBelow={false}
                  onReply={onReply}
                  reactionSelf={reactionSelf}
                />
              </div>
            )}
          />
        )}
        {row}
        {seen.has(m.id) && <SeenByRow faces={seen.get(m.id)!} end={mine} time={formatTime} />}
      </div>
    </div>
  );
}
