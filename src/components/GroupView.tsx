// A room: several bots + you in one shared thread. The sidebar and call view
// carry the personality; avatars inside the room stay still so a busy group
// does not become a wall of competing motion. Plain messages go to the room's
// default responder; @mentions override that routing.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { ArrowDown, ChevronDown, FolderOpen, Pause, Pin, Square, X } from "lucide-react";
import {
  api,
  useStore,
  formatTime,
  openNotificationTarget,
  openThread,
  type Bot,
  type Group,
  type GroupDefaultResponder,
  type Message,
} from "@/state/store";
import { BotAvatar } from "./Avatar";
import { PlaceIcon } from "./PlaceIcon";
import { ScreenFrame } from "./ScreenFrame";
import { effectivePlace, placeLabelKey } from "@/lib/place";
import { ThreadChip } from "./ThreadChip";
import { InputRequestCard } from "./InputRequestCard";
import { withoutDeadThreadChips } from "@/lib/dead-thread-chips";
import { ToolActivity, botNames } from "./ToolActivity";
import { StepRow } from "./StepRow";
import { stepLabel } from "@/lib/step-label";
import { ThreadRefText } from "./ThreadRefs";
import { TurnPresence } from "./TurnPresence";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { showToolCallRows } from "@/lib/tool-activity-rows";
import { CompactionChip, DigestChip } from "./DigestChip";
import { roomActivityVisible } from "@/lib/room-activity";
import { viewerActorId, viewerCan } from "@/lib/viewer";
import { permissionMissingText } from "@/lib/permissions";
import { viewerIsOrgAdmin, viewerOwnsGroup } from "@/lib/group-owner";
import { PersonAvatar, RoomPersonLabel } from "./MessageAuthor";
import { peopleDmPeer } from "@/lib/people-dm";
import { PersonLabelTag } from "./LabelTag";
import { groupNudgeTarget } from "@/lib/group-nudge";
import { continuesRun, personDisplayName, personInitials, roomAuthor, runCorners } from "@/lib/room-authors";
import { botIdOfParticipant, messageParticipant, seenRows, type ThreadReads } from "@/lib/read-receipts";
import { useReportRead, useThreadReads } from "@/lib/read-receipts-feed";
import { SeenByRow, SEEN_AVATAR_SIZE, type SeenFace } from "./SeenBy";
import { ReactionChips } from "./Reactions";
import { myReactions, reactionSelfIds, useToggleReaction } from "@/lib/reactions";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { StatusActivityRow } from "@/components/StatusActivityRow";
import { MAUS_COLOR_NAMES, mausInk, normalizeState } from "@/lib/mascot";
import { defaultResponderName, effectiveDefaultResponder, groupResponseHint, jevRoomRoutingOn } from "@/lib/group-routing";
import { openSettings } from "@/lib/settings-link";
import { ChatMarkdown } from "./ChatMarkdown";
import { VideoPlayerWidget } from "./video/VideoPlayerWidget";
import { FailedTurnRow, MessageBoundary } from "./ChatView";
import { MESSAGE_ROW, MessageActions, messageActionClass } from "./MessageActions";
import { useBotMessageMenu, userMessageMenu, type PinAction } from "./message-menu";
import { RawMarkdownView, RawToggleAction } from "./RawMarkdownToggle";
import { SpeakButton } from "./SpeakButton";
import { useSpeech } from "@/lib/tts/useSpeech";
import { useActiveLocale, useLocalSystemVoice, useRemoteClient } from "@/lib/render-reads";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { isCancelledTranscriptRow } from "../../shared/client-cancel";
import { roomRetryRequest } from "@/lib/room-retry";
import { botEngine, failedTurnCause } from "@/lib/failed-turn";
import { CitationSelectionToolbar, SentCitations } from "./CitationUI";
import { Composer } from "./Composer";
import { ChatErrorBanner, ChatNotice, ChatStaleBanner } from "./ChatErrorBanner";
import { GroupCostNotice, WeeklyLimitNotice } from "./ChatUsageNotices";
import { ChatFindBar } from "./ChatFindBar";
import { ConversationTurnLimit } from "./ConversationTurnLimit";
import { GroupTaskPicker, PersonThreadPicker, ThreadReturnLink } from "./TaskPicker";
import { isPureLeakedSystemHarnessMessage, stripLeakedSystemHarnessMessages } from "../../shared/system-message-guard.ts";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { ReplyQuote } from "./ReplyQuote";
import { SecretRequestCard } from "./SecretRequestCard";
import { SignInRequestCard } from "./SignInRequestCard";
import { hasRoutineExecutionTask, RoutineRunCard } from "./RoutineRunCard";
import { GoalRunCard, GoalRunHeaderChip, goalRunPlace } from "./GoalRunCard";
import { AccessCard } from "./AccessCard";
import { AttachmentGallery, MessageAttachmentGallery, replyAttachmentGroup } from "./AttachmentGallery";
import { ConversationGalleryProvider } from "./ConversationGallery";
import { VoiceNoteBubble, type VoiceNoteAttachment } from "./VoiceNoteBubble";
import { OptionCard } from "./OptionCard";
import { GroupCallOverlay } from "./GroupCallView";

import { ApprovalCard, approvalCardStaysInChat } from "./ApprovalCard";
import { OwnerSettled, OwnerWait } from "./OwnerWait";
import { QuestionCard } from "./QuestionCard";
import { ChannelMembers, channelRosterActions } from "./ChannelMembers";
import { GroupPeoplePicker, useOrgDirectory } from "./GroupPeoplePicker";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { groupHumanLabel } from "@/lib/private-threads";
import { ManageMembersPanel } from "./ManageMembersPanel";
import { GroupAvatarStack, GroupPanel, PanelSection } from "./GroupPanel";
import { NudgeLine } from "./NudgeLine";
import { ConversationRoutineToggle } from "./RoutineToggleLine";
import { groupActivityRuns, isHiddenStatusActivity, isStatusActivity, type ActivityTranscriptItem } from "@/lib/activity-runs";
import { collapseBotExchanges, commIsBotDm, startsNewStretch, visibleEdge, type ExchangeRun } from "@/lib/bot-exchange";
import { foldCollapsedEntry, voiceCallPlan, voiceCallVisibleSpan } from "@/lib/voice-call-transcript";
import { VoiceCallCard } from "./VoiceCallCard";
import { BotExchangeChip, ExchangeColumnProvider, TranscriptDate, useExchangeColumn } from "./BotExchangeChip";
import { GotoGroupChip } from "./GotoGroupChip";
import { collapseGotoLines, type GotoGroup } from "@/lib/goto-lines";
import { ActivityRun } from "./ActivityRun";
import { CwActivityWidgets, CwWidgetView, shownCwWidget } from "./cw/CwWidgetView";
import { useDesktopCapabilities, useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { cn } from "@/lib/cn";
import { shortPath } from "@/lib/short-path";
import { useComposerDockPad } from "@/lib/composer-dock";
import { awaitedMemberId, showWorkingDots } from "@/lib/turn-tail";
import { liveActivityPhrases } from "@/lib/live-activity";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { useTranscriptViewport } from "@/hooks/use-transcript-viewport";
import { useUnreadDivider } from "@/hooks/use-unread-divider";
import { unreadMessageIds } from "@/lib/unread-divider";
import { NewMessagesDivider } from "./NewMessagesDivider";
import { appendDraftAttachments, useReplyDraft } from "@/lib/drafts";
import { citationPreviewText, splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { botLabel } from "@/lib/human-label";
import { highlightCitationSource } from "@/lib/citations-dom";
import { latestFailure, latestReply, type TranscriptSnapshot } from "@/lib/transcript-announcer";
import { pendingApprovals } from "./PendingApproval";
import { DataResultChip } from "./DataResultChip";
import { TranscriptAnnouncer } from "./TranscriptAnnouncer";
import { channelHumanRow, useOrgPeople } from "@/lib/perspicax-org";
import { Switch } from "./SettingsPrimitives";
import { groupMemberBots } from "@/lib/group-members";
import { botPublicProfile } from "../../shared/bot-public-profile";
import { personAvatarSrc } from "@/lib/profile-management";
import { roomSpeakerIds, roomThreadSpeakerId, roomThreadWorking } from "@/lib/room-threads";

type RoomItem =
  | ActivityTranscriptItem
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "voiceCall"; callId: string; messages: Message[] }
  | GotoGroup;

/** One finished tool step in a room: the same quiet step row the 1:1 chat
 * uses (StepRow). A row
 * that links somewhere ("Posted in #Standup", a bot⇄bot exchange) opens it,
 * as it would in a 1:1 — a receipt the person cannot follow is only half a
 * receipt. When the linked channel IS this room (an ask made from here is
 * mirrored back into it) there is nowhere to go, so it stays a plain,
 * visible row. A member's failed turn is not a step at all: it is the row a
 * 1:1 chat shows for the same failure, sign-in card and all, for the engine
 * that member ran on. */
export function RoomToolChip({ message, roomId }: { message: Message; roomId?: string }) {
  "use memo";
  const dispatch = useStoreDispatch();
  const storeBots = useStoreSelector((current) => current.bots);
  const instances = useStoreSelector((current) => current.instances);
  const storeGroups = useStoreSelector((current) => current.groups);
  const tool = message.tool;
  if (!tool) return null;
  if (message.inputRequest) return <InputRequestCard message={message} />;
  if (message.threadRef) return <ThreadChip message={message} />;
  if (failedTurnCause(tool.name) !== null) {
    return <FailedTurnRow tool={tool} engine={botEngine(storeBots.find((b) => b.id === message.from?.botId), instances)} botId={message.from?.botId} />;
  }
  const comm = message.comm;
  const nameOf = botNames(storeBots);
  if (!comm) return <ToolActivity tool={tool} nameOf={nameOf} />;
  const withBot = storeBots.find((b) => b.id === comm.withBotId);
  const avatar = <BotAvatar bot={withBot ?? { name: comm.withName, color: comm.withColor }} state="happy" size={14} animated={false} />;
  // A bot-to-bot DM is read in this column. Selecting it would leave the
  // room, and a chip about this very room has nowhere to go.
  const goes = comm.groupId !== roomId && !commIsBotDm(comm, storeGroups ?? []);
  return (
    <div className="flex justify-start">
      <StepRow
        label={stepLabel(tool, nameOf)}
        phase={tool.ok === false ? "failed" : "done"}
        icon={avatar}
        title={goes ? t("room.openBot", { name: comm.withName }) : undefined}
        onActivate={goes ? () => {
          dispatch({ type: "select", id: comm.groupId });
          const destination = storeGroups.find(g => g.id === comm.groupId);
          if (comm.threadId && destination?.tasks?.some(task => task.threadId === comm.threadId)) {
            dispatch({ type: "switchGroupTask", groupId: comm.groupId, threadId: comm.threadId });
          }
        } : undefined}
      />
    </div>
  );
}

/** A palette color: every skin carries its readable tone (--identity-<color>). */
function isPaletteColor(color: string): boolean {
  return (MAUS_COLOR_NAMES as readonly string[]).includes(color);
}

/** 16px profile avatar + name, shown once per sender cluster. The name uses
 * that bot's color, deepened or lightened per skin so it stays readable. */
function ClusterLabel({ bot, name, color }: { bot?: Bot; name: string; color: string }) {
  "use memo";
  const ownColor = bot?.color ?? color;
  // A palette color wears the skin's identity tone (styles.css
  // .bot-identity, 4.5:1 on the thread in every skin); anything else (an
  // older stored value) keeps its readable ink.
  const identity = isPaletteColor(ownColor);
  const tint = identity ? undefined : mausInk(ownColor) ?? color;
  return (
    <div className="-mb-1.5 ms-1.5 mt-3 flex items-center gap-1.5 px-1.5">
      <BotAvatar
        bot={bot ?? { name, color: color as Bot["color"] }}
        state={normalizeState(bot?.mascotExpression) ?? "happy"}
        size={16}
        motion="none"
        motionKey={0}
        animated={false}
      />
      <span
        className={cn("text-[12px] font-normal leading-4", identity && "bot-identity")}
        data-bot-color={identity ? ownColor : undefined}
        style={tint ? { color: tint } : undefined}
      >{name}</span>
    </div>
  );
}

/** Pin for one room message, one pin per room, patchGroup path. */
function roomPin(group: Group, message: Message, dispatch: ReturnType<typeof useStore>["dispatch"]): PinAction | undefined {
  if (window.ogb?.remoteClient?.active) return undefined;
  const pinned = group.pinnedMessageId === message.id;
  return {
    pinned,
    hint: t("room.pinHint"),
    onToggle: () => dispatch({ type: "patchGroup", groupId: group.id, patch: { pinnedMessageId: pinned ? "" : message.id } }),
  };
}

const NO_PEOPLE: ReadonlyMap<string, OrgDirectoryPerson> = new Map();

/** Same limits as a 1:1 user bubble (ChatView). */
const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;

/** One room text message: the same actions as a 1:1 bubble, and a boundary
 * so a bad markdown node stays inside this row. */
function RoomTextMessage({
  group,
  message: m,
  members,
  transcript,
  emerging,
  eager,
  mine,
  joinsAbove,
  joinsBelow,
  onReply,
  reactionSelf,
}: {
  group: Group;
  message: Message;
  members: Bot[];
  transcript: Message[];
  emerging: boolean;
  eager: boolean;
  /** Your own line: the end side, in your bubble (src/lib/room-authors.ts). */
  mine: boolean;
  /** Part of a run of lines by one author: the corners join. */
  joinsAbove: boolean;
  joinsBelow: boolean;
  onReply: (message: Message) => void;
  /** Who "I" am on a reaction chip (src/lib/reactions.ts). */
  reactionSelf: readonly string[];
}) {
  "use memo";
  const dispatch = useStoreDispatch();
  const focus = useStoreSelector((current) => current.focusMessage);
  const tts = useStoreSelector((current) => current.config?.tts);
  const localVoice = useLocalSystemVoice();
  const user = m.role === "user";
  // Emoji reactions (src/components/Reactions.tsx): the smiley of the hover
  // row and the head of its "…" menu; the chips sit under the bubble.
  const toggleReactionOn = useToggleReaction(group.threadId, dispatch);
  const reactable = !m.id.startsWith("optimistic-");
  const react = reactable ? { mine: myReactions(m.reactions, reactionSelf), onPick: (emoji: string) => toggleReactionOn(m.id, emoji) } : undefined;
  const requestId = m.id.startsWith("optimistic-") ? undefined : m.id;
  // a bot's leaked internal system lines never reach the reader
  const rawText = user ? (m.text ?? "") : stripLeakedSystemHarnessMessages(m.text ?? "");
  const cited = user && m.text ? splitTranscriptCitations(m.text) : null;
  const attachments = user && m.text ? splitTranscriptAttachments(cited?.display ?? m.text) : null;
  const display = attachments?.display ?? rawText;
  const [expanded, setExpanded] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);
  const speech = useSpeech();
  const speaking = speech.messageId === m.id && speech.status !== "idle";
  const focusedSearch = focus?.messageId === m.id && Boolean(focus.matchText) && focus.threadId === group.threadId;
  const collapsible = user && !expanded && (display.length > USER_COLLAPSE_CHARS || display.split("\n").length > USER_COLLAPSE_LINES);
  useEffect(() => {
    if (focusedSearch && collapsible) setExpanded(true);
  }, [focusedSearch, collapsible, focus?.nonce]);
  const speakerBot = members.find((member) => member.id === m.from?.botId);
  const botText = rawText;
  const pin = roomPin(group, m, dispatch);
  const botMenu = useBotMessageMenu({
    text: botText,
    botId: speakerBot?.id,
    messageId: m.id,
    voiceId: speakerBot?.voice,
    tts: tts,
    localVoice,
    canSpeak: true,
    viewRaw,
    onToggleRaw: () => setViewRaw((raw) => !raw),
    pin,
  });
  // a reply with text lists its files under the text, without the ones it links inline
  // (memoized by the React Compiler on the text and the attachments)
  const replyGroup = !user && botText.trim() ? replyAttachmentGroup(botText, m.attachments) : null;
  return (
    <div
      data-author={mine ? "self" : user ? "person" : "bot"}
      className={cn("group flex w-full flex-col", mine ? "items-end" : "items-start", joinsAbove && "-mt-2")}
      // the whole row reveals its actions on hover, focus or a tap (MessageActions)
      {...{ [MESSAGE_ROW]: "" }}
    >
      <div className={cn("relative flex w-full items-end gap-1.5", mine ? "justify-end" : "justify-start")}>
        {mine && (
          <MessageActions side="user" menu={userMessageMenu({ pin })} onReply={() => onReply(m)} copy={display.trim() ? display : undefined} requestId={requestId} react={react} />
        )}
        <div
          data-chat-bubble
          className={cn(
            "text-[13px] leading-5",
            !user && emerging && "turn-answer",
            !user
              // A bot reads flat like Grok Bot: no card, the column's measure,
              // aligned to the rail; its name labels the run above (RoomBotLabel).
              // An attachments-only line keeps its tighter fit.
              ? (!m.text?.trim() && !m.replyToId && m.attachments?.length
                  ? "w-fit max-w-[min(80%,560px,calc(100%-82px))] text-ink"
                  : "w-full max-w-[calc(100%-82px)] text-ink")
              // A person (you or another) keeps a rounded bubble.
              : cn(
                  "rounded-[18px] w-fit max-w-[min(80%,560px,calc(100%-82px))]",
                  mine
                    ? "chat-text whitespace-pre-wrap bg-bubble-user px-3 py-[7px] text-ink"
                    : "chat-text whitespace-pre-wrap bg-raised px-3 py-[7px] text-ink ring-1 ring-inset ring-hairline/40",
                  runCorners(mine ? "end" : "start", joinsAbove, joinsBelow),
                ),
          )}
          title={new Date(m.at).toLocaleString()}
        >
          {m.replyToId && (() => {
            const target = transcript.find((candidate) => candidate.id === m.replyToId);
            return target ? (
              <div className="mb-2">
                <ReplyQuote
                  message={target}
                  fallbackName={t("room.fallbackBot")}
                  compact
                  onJump={() =>
                    dispatch({ type: "focusMessage", threadId: group.threadId, messageId: target.id })
                  }
                />
              </div>
            ) : null;
          })()}
          {user ? (
            <>
              {attachments && <AttachmentGallery images={attachments.images} files={attachments.files} message={{ threadId: group.threadId, messageId: m.id }} eager={eager} className={!attachments.display ? "mb-0" : undefined} />}
              <div
                className={cn(collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
                data-citation-source={m.id}
                data-citation-owner-type="group"
                data-citation-owner={group.id}
                data-citation-thread={group.threadId}
              >
                <ThreadRefText text={display} peers={members} everyone={!group.dm} />
              </div>
              {cited && <SentCitations
                citations={cited.citations}
                onNavigate={async (citation: CitationAttachment) => {
                  if (citation.source.ownerType !== "group" || !group.messages.some((candidate) => candidate.id === citation.source.messageId)) return false;
                  dispatch({ type: "focusMessage", threadId: group.threadId, messageId: citation.source.messageId });
                  return highlightCitationSource(citation);
                }}
              />}
              {m.via === "api" && (
                <div className="mt-1 text-[11px] text-ink-secondary">Sent through the API, not typed here</div>
              )}
              {collapsible && (
                <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showFull")}
                </button>
              )}
              {expanded && (
                <button type="button" onClick={() => setExpanded(false)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showLess")}
                </button>
              )}
            </>
          ) : (
            <MessageBoundary key={viewRaw ? "raw" : "rendered"} fallbackText={botText || t("chat.generatedImage")}>
              {(m.attachments ?? []).some((attachment) => attachment.kind === "audio") && (
                <div className={cn("flex flex-col", (m.text || (m.attachments ?? []).some((attachment) => attachment.kind === "image")) && "mb-2")}>
                  {m.attachments!.filter((attachment): attachment is VoiceNoteAttachment => attachment.kind === "audio").map((note) => (
                    <VoiceNoteBubble key={note.path} attachment={note} />
                  ))}
                </div>
              )}
              {!botText.trim() && <MessageAttachmentGallery text={botText} attachments={m.attachments} message={{ threadId: group.threadId, messageId: m.id }} className={m.text ? undefined : "mb-0"} eager={eager} />}
              {viewRaw && botText ? (
                <div data-citation-source={m.id} data-citation-owner-type="group" data-citation-owner={group.id} data-citation-thread={group.threadId}><RawMarkdownView text={botText} /></div>
              ) : botText ? (
                <div data-citation-source={m.id} data-citation-owner-type="group" data-citation-owner={group.id} data-citation-thread={group.threadId}>
                  <ChatMarkdown
                    text={botText}
                    botId={m.from?.botId}
                    emailDrafts={speakerBot?.emailDrafts !== false}
                    mentionPeers={members}
                    everyone={!group.dm}
                    message={{ threadId: group.threadId, messageId: m.id }}
                    youtubeSendToBot={(body) => dispatch({ type: "sendGroup", groupId: group.id, threadId: group.threadId, text: body })}
                    delivered={replyGroup?.delivered}
                  />
                </div>
              ) : null}
              {replyGroup && <AttachmentGallery images={replyGroup.images} files={replyGroup.files} message={{ threadId: group.threadId, messageId: m.id }} eager={eager} beneath />}
            </MessageBoundary>
          )}
        </div>
        {!mine && user && (
          <MessageActions side="bot" menu={userMessageMenu({ pin })} onReply={() => onReply(m)} copy={display.trim() ? display : undefined} requestId={requestId} react={react} />
        )}
        {!user && (
          <MessageActions
            side="bot"
            forceOpen={viewRaw || speaking}
            menu={botMenu}
            onReply={() => onReply(m)}
            copy={botText || undefined}
            requestId={requestId}
            react={react}
            persistent={
              // a state the person turned on keeps its switch in view
              <>
                {botText && viewRaw && <RawToggleAction active onToggle={() => setViewRaw(false)} className={messageActionClass} />}
                {botText && speaking && (
                  <SpeakButton text={botText} botId={speakerBot?.id} messageId={m.id} voiceId={speakerBot?.voice} tts={tts} localVoice={localVoice} className={cn(messageActionClass, "text-accent")} />
                )}
              </>
            }
          />
        )}
        <span className="self-end pb-1 text-[11px] tabular-nums text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100">
          {formatTime(m.at)}
        </span>
      </div>
      <ReactionChips reactions={m.reactions} selfIds={reactionSelf} bots={members} end={mine} onToggle={(emoji) => toggleReactionOn(m.id, emoji)} />
      {!user && m.routedBy && <RoutedByLine routedBy={m.routedBy} />}
    </div>
  );
}

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
  const pairChannel = Boolean(group.dm) && !group.peopleDm;
  // Bot-to-bot lines become one chip per run first. A shared room's replies
  // to people stay inline; only a pair channel, a peer line, or a room
  // request collapses.
  const items = useMemo(() => {
    const plan = voiceCallPlan(transcript);
    const seen = new Set<string>();
    const visible = withoutDeadThreadChips(messages, owners).filter((message) =>
      message.kind !== "activity" || (!isHiddenStatusActivity(message) && roomActivityVisible(message, showToolCalls)));
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
      item.kind === "run" && !showToolCalls && !item.messages.some((step) => shownCwWidget(step.tool))) as RoomItem[];
  }, [messages, showToolCalls, pairChannel, members, transcript, owners]);
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
                  showToolCalls={showToolCalls}
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
                showToolCalls={showToolCalls}
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
                <ActivityRun
                  messages={item.messages}
                  elapsedMs={item.elapsedMs}
                  focusedId={focusedId}
                  nameOf={botNames(state.bots)}
                  renderStep={(step) => (
                    <div className="contents" data-mid={step.id}>
                      <RoomToolChip message={step} />
                    </div>
                  )}
                />
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
        const m = item.message;
        const user = m.role === "user";
        const { author, joinsAbove, joinsBelow } = runs[i]!;
        const newCluster = !joinsAbove;
        // Your own lines sit on the end side; everyone else's on the start side.
        const mine = author.kind === "self";
        const person = author.kind === "person" ? author : null;
        const routineOwner = m.kind === "routine.run" ? memberOf(m.from?.botId) : undefined;
        const routineExecutionThreadId = m.routineRun?.executionThreadId;
        const routineTarget = routineOwner && hasRoutineExecutionTask(routineOwner.tasks, routineExecutionThreadId)
          ? { botId: routineOwner.id, threadId: routineExecutionThreadId }
          : undefined;
        const canRetryRoom = m.id === retryableId && retryRequest !== null && !roomBusy;
        // a member can hit a permission ask mid-turn; without this the
        // card never rendered here and the bot waited out its timeout.
        // `tool` distinguishes a permission from a QUESTION — a question
        // only accepts an "answer", so routing it to the approval box
        // would offer an Allow the broker rejects. A structured ask is
        // one of those questions, and answers in its own card.
        const row = isCancelledTranscriptRow(m) ? (
          // A client abort is a stop, not a failure. Rooms have no edit
          // fork, so Retry is the room's own send.
          <CancelledTurnRow onRetry={canRetryRoom ? retryRoom : undefined} />
        ) :
          // Someone who is not the owner sees the wait, not an approval.
          m.state === "waiting-on-owner" ? (
            <div className="flex justify-start">
              <OwnerWait ownerName={m.ownerName ?? ""} />
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
                onSignIn={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}
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
                onOpen={routineTarget
                  ? () => openNotificationTarget(dispatch, routineTarget, state, showThreads)
                  : undefined}
              />
            </div>
          ) : m.kind === "activity" && shownCwWidget(m.tool) ? (
            <div className="flex flex-col gap-2">
              <CwWidgetView widget={m.tool!.widget!} threadId={group.threadId} botId={m.from?.botId} />
              {roomActivityVisible(m, showToolCalls) ? <RoomToolChip message={m} roomId={group.id} /> : null}
            </div>
          ) : m.kind === "activity" && m.tool ? (
            roomActivityVisible(m, showToolCalls) ? (
              m.dataResult ? <DataResultChip message={m} /> : isStatusActivity(m) ? <StatusActivityRow message={m} /> : <RoomToolChip message={m} roomId={group.id} />
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
          ) : m.kind === "routines" && m.routineToggle ? (
            <ConversationRoutineToggle message={m} />
          ) : m.kind === "text" && (m.text || m.attachments?.length) ? (
            !user && isPureLeakedSystemHarnessMessage(m.text) && !m.attachments?.length ? null : (
              <RoomTextMessage
                group={group}
                message={m}
                members={members}
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
              {row}
              {seen.has(m.id) && <SeenByRow faces={seen.get(m.id)!} end={mine} time={formatTime} />}
            </div>
          </div>
        );
      })}
    </>
  );
});

/** The room's held members ("stop @Bot", or a member's own Stop): one line
 * that says who is paused and how to bring each back. */
export function RoomHoldsBanner({ group, members }: { group: Group; members: Bot[] }) {
  const { dispatch } = useStore();
  const held = members.filter((member) => group.holds?.[member.id]);
  if (!held.length) return null;
  return (
    <div className="w-full px-5">
      <div data-testid="room-holds" className="mb-1 flex flex-wrap items-center gap-1.5 px-2 text-[12px] text-ink-secondary">
        <Pause size={12} aria-hidden="true" />
        <span>{t("room.holds.banner", { names: held.map((member) => member.name).join(", ") })}</span>
        {held.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => dispatch({ type: "setGroupHold", groupId: group.id, botId: member.id, held: false })}
            className="cursor-pointer text-accent hover:underline"
          >
            {t("room.holds.resume", { name: member.name })}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Under a reply in an Auto room: the decision model chose this speaker. */
export function RoutedByLine({ routedBy }: { routedBy: NonNullable<Message["routedBy"]> }) {
  const percent = Math.round(Math.min(1, Math.max(0, routedBy.probability)) * 100);
  return (
    <div data-testid="routed-by" className="mt-1 px-1 text-[11px] text-ink-secondary">
      {t("room.routedBy", { percent: String(percent) })}
    </div>
  );
}

export function DefaultResponderSelect({ group, members, disabled = false }: { group: Group; members: Bot[]; disabled?: boolean }) {
  const { state, dispatch } = useStore();
  const jevOn = jevRoomRoutingOn(state.config);
  const responder = effectiveDefaultResponder(group, members);
  const value = responder.kind === "member" ? `member:${responder.botId}` : responder.kind;
  const lead = responder.kind === "member" ? members.find((member) => member.id === responder.botId) : undefined;
  const title =
    responder.kind === "everyone"
      ? t("room.responder.everyone")
      : responder.kind === "mentions"
        ? t("room.responder.mentions")
        : responder.kind === "auto"
          ? jevOn
            ? t("room.responder.auto")
            : t("room.responder.autoOff", { name: defaultResponderName(group, members) ?? t("room.responder.leadFallback") })
          : t("room.responder.lead", { name: lead?.name ?? t("room.responder.leadFallback") });

  const change = (nextValue: string) => {
    let next: GroupDefaultResponder;
    if (nextValue === "everyone") next = { kind: "everyone" };
    else if (nextValue === "mentions") next = { kind: "mentions" };
    // The lead a room had stays on as Auto's fallback.
    else if (nextValue === "auto") next = responder.kind === "member" ? { kind: "auto", fallbackBotId: responder.botId } : { kind: "auto" };
    else next = { kind: "member", botId: nextValue.slice("member:".length) };
    dispatch({ type: "patchGroup", groupId: group.id, patch: { defaultResponder: next } });
  };

  return (
    <div className="relative rounded-xl bg-card p-3" title={title}>
      <select
        aria-label={t("room.responder.aria")}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
        className="h-8 w-full appearance-none truncate rounded-lg border border-hairline/40 bg-raised/60 py-1 pl-3 pr-7 text-[12.5px] font-medium text-ink outline-none hover:bg-raised focus:border-accent"
      >
        <optgroup label={t("room.responder.groupLead")}>
          {members.map((member) => (
            <option key={member.id} value={`member:${member.id}`}>
              {t("room.responder.leadOption", { name: member.name })}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("room.responder.groupBehavior")}>
          <option value="auto">{jevOn ? t("room.responder.autoOption") : t("room.responder.autoOptionOff")}</option>
          <option value="everyone">{t("room.responder.everyoneOption")}</option>
          <option value="mentions">{t("room.responder.mentionsOption")}</option>
        </optgroup>
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary"
      />
    </div>
  );
}

/** Whether @all notifies every person in the room (server/room-mentions.ts).
 * A person tagged by name is notified either way. The owner's setting. */
function RoomMentionAll({ group, disabled = false }: { group: Group; disabled?: boolean }) {
  const { dispatch } = useStore();
  const on = group.mentionAll === true;
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">{t("room.mentionAll.label")}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{on ? t("room.mentionAll.on") : t("room.mentionAll.off")}</p>
      </div>
      <Switch
        checked={on}
        disabled={disabled}
        aria-label={t("room.mentionAll.label")}
        onClick={() => dispatch({ type: "patchGroup", groupId: group.id, patch: { mentionAll: !on } })}
      />
    </div>
  );
}

/** The room's shared desk: where every member's shell and file tools run,
 * overriding each bot's own folder for room turns. The room pins its own
 * copy on its first turn (the server does the pinning — engines key their
 * sessions to the folder a thread starts in, so a folder must not move
 * under a room that already worked somewhere). The PATCH is made directly
 * rather than through patchGroup: the server validates the path and a
 * rejected folder must not stick in local state. */
function RoomWorkingFolder({ group, disabled = false, adminOnlyNote = false }: { group: Group; disabled?: boolean; adminOnlyNote?: boolean }) {
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host.homeDir;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canPick = Boolean(window.ogb?.pickFolder);
  const pinned = group.pinnedCwd; // undefined = not yet, null = each bot's own, string = folder
  const locked = pinned !== undefined;
  const shownCwd = locked ? (pinned ?? undefined) : group.cwd;

  const save = async (cwd: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const pick = async () => {
    const chosen = await window.ogb?.pickFolder?.(group.cwd);
    if (chosen) void save(chosen);
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("room.folder.title")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("room.folder.detail")}</div>
      {locked || disabled ? (
        <div className="mt-3">
          <div className="truncate rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12.5px] text-ink" title={shownCwd}>
            {shownCwd ? shortPath(shownCwd, home) : <span className="text-ink-secondary">{t("room.folder.own")}</span>}
          </div>
          {!locked && adminOnlyNote && (
            <div className="mt-2 text-[12px] text-ink-secondary">{permissionMissingText("folders.roomWorkingFolder")}</div>
          )}
          {locked && (
            <div className="mt-2 text-[12px] text-ink-secondary">
              {t("room.folder.locked")}
            </div>
          )}
        </div>
      ) : canPick ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12.5px] text-ink" title={group.cwd}>
            {group.cwd ? shortPath(group.cwd, home) : <span className="text-ink-secondary">{t("room.folder.own")}</span>}
          </div>
          <button onClick={() => void pick()} disabled={saving} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
            <FolderOpen size={14} /> {t("room.folder.choose")}
          </button>
          {group.cwd && (
            <button onClick={() => void save(null)} disabled={saving} className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-ink-secondary hover:text-ink disabled:opacity-50">
              {t("keys.clear")}
            </button>
          )}
        </div>
      ) : (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // an emptied field clears the folder — the server wants null
            void save((draft ?? group.cwd ?? "").trim() || null);
          }}
        >
          <input
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 font-mono text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
            placeholder={t("room.folder.placeholder")}
            value={draft ?? group.cwd ?? ""}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" disabled={saving || draft === null} className="shrink-0 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
            {t("common.save")}
          </button>
        </form>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

/** Who the remote client is signed in as, and their role in the organization;
 * no one when either request fails. */
async function loadRemoteActor(): Promise<{ id: string; role: "owner" | "admin" | "member" | null }> {
  try {
    const session = await api<{ email?: string }>("/api/auth/session");
    const org = await api<{ people?: { id: string; role: "owner" | "admin" | "member" }[] }>("/api/org");
    const id = typeof session.email === "string" ? session.email.trim().toLowerCase() : "";
    const role = org.people?.find((person) => person.id.trim().toLowerCase() === id)?.role ?? null;
    return { id, role };
  } catch {
    return { id: "", role: null };
  }
}

export function GroupView({ group: stored }: { group: Group }) {
  "use memo";
  // A direct conversation between two people (server/people-dms.ts) runs on
  // the single-thread path of a bot-to-bot channel: no panel, no tasks. It
  // reads as the other person.
  const group = useMemo(() => (stored.peopleDm ? { ...stored, dm: true } : stored), [stored]);
  const { state, dispatch } = useStore();
  const directPeople = useOrgPeople();
  const viewerId = viewerActorId(state.config);
  const peer = peopleDmPeer(stored, viewerId, directPeople);
  const roomNudge = groupNudgeTarget(stored, viewerId, state.config?.profile?.email);
  const remoteClient = useRemoteClient();
  const locale = useActiveLocale();
  const [remoteActor, setRemoteActor] = useState<{ id: string; role: "owner" | "admin" | "member" | null }>({ id: "", role: null });
  useEffect(() => {
    if (!remoteClient) return;
    let cancelled = false;
    void loadRemoteActor().then((actor) => { if (!cancelled) setRemoteActor(actor); });
    return () => { cancelled = true; };
  }, [remoteClient]);
  // Same caption handling as ChatView: drag on the header (macOS and
  // Windows), and on Windows shift the right-hand controls below the
  // renderer-drawn caption buttons.
  const { dragProps: headerDragProps, noDragStyle: headerNoDragStyle, controlsShiftStyle } = useCaptionChrome();
  // Pulsatrix Light's navy top band mirrors the sidebar's own macOS-inset
  // strip, so the two stay vertically aligned; every other skin ignores it.
  const { macInset, browser } = useMacInsetChrome();
  const { node: exchangeColumnNode, ref: exchangeColumnRef } = useExchangeColumn();
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerDock = useComposerDockPad(composerDockRef);
  const [bulletinOpen, setBulletinOpen] = useState(false);
  const [bulletinDraft, setBulletinDraft] = useState(group.bulletin);
  const [membersOpen, setMembersOpen] = useState(false);
  // The group panel shares the bot panel's slot: one open flag in the store.
  const panelOpen = state.settingsOpen && !group.dm;
  // Organization server: a group's people come from the Perspicax directory
  // (by principal id) and read by their names.
  const perspicaxOrg = usePerspicaxOrg();
  const orgDirectory = useOrgDirectory(perspicaxOrg !== null && !group.dm);
  const [pickingPeople, setPickingPeople] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const { replyTo, selectReply, clearReply, consumeReply, restoreReply } = useReplyDraft(
    group.threadId,
    `group:${group.id}:${group.threadId}`,
    group.messages,
  );
  const membersTriggerRef = useRef<HTMLButtonElement>(null);
  const closeMembers = useCallback(() => setMembersOpen(false), []);
  useEffect(() => setFindOpen(false), [group.threadId]);
  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, []);

  // Every bot in the room, someone else's included (its public profile).
  const members = useMemo(() => groupMemberBots(group, state.bots), [group, state.bots]);
  const orgPeople = useOrgPeople();
  // Seen by (src/lib/read-receipts-feed.ts): who has read what, live, and
  // this person's own position while the window has focus.
  const threadReads = useThreadReads(group.threadId);
  const viewerEmail = state.config?.profile?.email?.trim().toLowerCase() || "";
  const viewerName = state.config?.profile?.name?.trim() || viewerEmail || "Vous";
  // The server's word on who is looking, when it gives one; before that,
  // the remote client's own lookup, else the operator.
  const viewer = state.config?.viewer;
  // Organization server: only the group's owner edits its settings; the
  // others read them and may leave (src/lib/group-owner.ts).
  const ownsRoom = viewerOwnsGroup(group, state.config);
  const editable = !remoteClient && ownsRoom;
  // The task's goal, while it runs: the header carries a reminder that
  // brings its card into view.
  const activeGoalMessage = useMemo(() => {
    const latest = [...group.messages].reverse().find((message) => message.kind === "goal.run" && message.goalRun);
    return latest?.goalRun?.status === "working" ? latest : undefined;
  }, [group.messages]);
  // The working folder touches the host or sandbox filesystem: on an
  // organization server it stays an admin's, even for the group's owner.
  const folderEditable = group.ownerId === undefined || viewerIsOrgAdmin(state.config) || viewerCan(state.config, "folders.roomWorkingFolder");
  const viewerListed = (group.humanIds ?? []).some((id) => {
    const entry = id.trim().toLowerCase();
    return entry === viewerId || (Boolean(viewerEmail) && entry === viewerEmail);
  });
  const leaveGroup = () => {
    const humanIds = (group.humanIds ?? []).filter((id) => {
      const entry = id.trim().toLowerCase();
      return entry !== viewerId && !(viewerEmail && entry === viewerEmail);
    });
    dispatch({ type: "patchGroup", groupId: group.id, patch: { humanIds } });
  };
  // On an organization server each person reads as their Perspicax display
  // name with their avatar (the directory); elsewhere the stored id, as before.
  const viewerAvatar = personAvatarSrc(state.config?.profile?.avatarUrl);
  const channelHumans = [
    { id: viewerId, label: viewerName, detail: viewerEmail && viewerName !== viewerEmail ? viewerEmail : undefined, ...(viewerAvatar ? { avatarUrl: viewerAvatar } : {}), removable: false as boolean },
    ...(group.humanIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id && id !== viewerId && id !== viewerEmail)
      .map((id) => {
        // The Perspicax person (display name, email, avatar) when the people
        // list knows them; otherwise the directory label (teams, user: ids).
        const row = channelHumanRow(id.replace(/^user:/, ""), orgPeople);
        const known = row.label !== row.id;
        return { ...row, id, label: known ? row.label : groupHumanLabel(id, orgDirectory), removable: ownsRoom };
      }),
  ];
  const actorId = viewer ? viewerId : remoteClient ? remoteActor.id : viewerId;
  const roster = channelRosterActions({
    actorRole: viewer ? viewer.role : remoteClient ? remoteActor.role : "owner",
    actorId,
    bots: state.bots,
    ownsRoom,
    memberIds: group.memberIds,
  });
  // Your own bots: a member who does not own the room still brings them in
  // and takes them out (server/group-ownership.ts).
  const ownBotIds = new Set(state.bots.filter((bot) => actorId !== "" && (bot.ownerUserId ?? "").trim().toLowerCase() === actorId).map((bot) => bot.id));
  const speaker = members.find((b) => b.id === group.busyBotId);
  // The room's threads run side by side: what this view shows working is the
  // open thread; members busy in another thread are marked apart below.
  const threadWorking = roomThreadWorking(group, group.threadId);
  const speakersElsewhere = new Set(roomSpeakerIds(group).filter((id) => id !== group.busyBotId));
  // The member working in the open thread: the one its Stop holds.
  const threadSpeakerId = roomThreadSpeakerId(group, group.threadId);
  const threadSpeaker = threadSpeakerId ? members.find((b) => b.id === threadSpeakerId) : undefined;

  // Mascot stays while a member works; the finished reply pops in above it.
  const lastGroupMessage = group.messages.at(-1);
  const activity = liveActivityPhrases(lastGroupMessage);
  // A member busy elsewhere takes its turn when free; until then the room
  // works with no speaker, and the presence row names who it is waiting on.
  const awaited = members.find(
    (b) => b.id === awaitedMemberId(threadWorking, group.busyBotId, lastGroupMessage),
  );
  const waiting =
    Boolean(speaker && showWorkingDots(true, group.messages.at(-1), speaker.id)) || awaited !== undefined;
  const wasWaiting = useRef(false);
  const [popping, setPopping] = useState<{ id: string; botId?: string } | null>(null);
  const poppingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
  }, []);
  useLayoutEffect(() => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = null;
    wasWaiting.current = false;
    setPopping(null);
  }, [group.id, group.threadId]);
  useEffect(() => {
    if (waiting) wasWaiting.current = true;
  }, [waiting]);
  useLayoutEffect(() => {
    if (lastGroupMessage?.role !== "bot" || lastGroupMessage.kind !== "text" || !wasWaiting.current) return;
    wasWaiting.current = false;
    setPopping({
      id: lastGroupMessage.id,
      botId: lastGroupMessage.from?.botId,
    });
    const messageId = lastGroupMessage.id;
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = setTimeout(() => {
      poppingTimer.current = null;
      setPopping((current) => current?.id === messageId ? null : current);
    }, 520);
  }, [
    lastGroupMessage?.id,
    lastGroupMessage?.role,
    lastGroupMessage?.kind,
    lastGroupMessage?.from?.botId,
  ]);
  const presenceVisible = waiting || popping !== null;
  const announcement = useMemo((): TranscriptSnapshot => {
    const approval = pendingApprovals(group.messages)[0];
    return {
      busy: threadWorking,
      reply: latestReply(group.messages, (m) => m.from?.name ?? group.name),
      failure: latestFailure(group.messages, (m) => m.from?.name ?? group.name),
      approval: approval
        ? { id: approval.requestId, name: approval.message.from?.name ?? speaker?.name ?? group.name }
        : undefined,
    };
  }, [group.messages, threadWorking, group.name, speaker?.name]);
  const presenceSpeaker =
    speaker ?? awaited ?? members.find((member) => member.id === popping?.botId) ?? members[0];

  // Only a tail of the room mounts; working dots above stay on the FULL list.
  const {
    scrollRef,
    transcriptRef,
    topSentinelRef,
    transcriptKey,
    following,
    windowedMessages,
    hiddenCount,
    laterCount,
    olderPending,
    showLater,
    jumpToLatest,
    scrollHandlers,
  } = useTranscriptViewport({
    ownerId: group.id,
    threadId: group.threadId,
    messages: group.messages,
    pinOn: [group.busyBotId, group.working, composerDock.pad],
    hasMore: group.hasMore,
  });
  // Seen (src/lib/read-receipts.ts): this person's own position while the window has focus.
  useReportRead(group.threadId, scrollRef, group.messages.at(-1)?.id);
  const unreadDivider = useUnreadDivider({ threadId: group.threadId, messages: group.messages, following });

  useEffect(() => setBulletinDraft(group.bulletin), [group.id, group.bulletin]);
  useEffect(() => setMembersOpen(false), [group.id]);
  const saveBulletin = () => {
    setBulletinOpen(false);
    if (bulletinDraft !== group.bulletin) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin: bulletinDraft } });
    }
  };

  // Static profile avatars: one per member, a ring + dot on whoever is
  // working. A member actively driving a computer/browser session for this
  // room gets the place icon instead of the plain dot, matching the 1:1
  // composer's PlaceChip live indicator.
  const memberMauses = members.map((b) => {
    const busy = group.busyBotId === b.id;
    const busyElsewhere = !busy && speakersElsewhere.has(b.id);
    const held = !group.dm && Boolean(group.holds?.[b.id]);
    const task = b.tasks?.find((candidate) => candidate.threadId === group.threadId);
    const effective = busy ? effectivePlace(b, task) : "off";
    const showPlace = busy && effective !== "off" && effective !== "auto";
    return (
      <span
        key={b.id}
        data-held={held || undefined}
        title={
          held
            ? t("room.holds.avatarHeld", { name: b.name })
            : busyElsewhere
              ? t("room.memberWorkingElsewhere", { name: b.name })
              : `${b.name}${busy ? " — working…" : ""}`
        }
        className={cn(
          "relative inline-flex rounded-full",
          busy && "ring-2 ring-accent/50 ring-offset-1 ring-offset-app",
          busyElsewhere && "ring-1 ring-hairline ring-offset-1 ring-offset-app",
        )}
      >
        <span className={cn("inline-flex", held && "opacity-50 grayscale")}>
          <BotAvatar bot={b} state={normalizeState(b.mascotExpression) ?? "happy"} size={24} animated={false} />
        </span>
        {held && !busy && (
          <span
            className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-app bg-raised text-ink-secondary"
            role="img"
            aria-label={t("room.holds.avatarHeld", { name: b.name })}
          >
            <Pause size={8} strokeWidth={3} aria-hidden="true" />
          </span>
        )}
        {busy && (
          showPlace ? (
            <span
              className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-app bg-accent text-white"
              role="img"
              aria-label={t("place.chipAria", { place: t(placeLabelKey(effective)) })}
            >
              <PlaceIcon place={effective} size={9} strokeWidth={2.5} aria-hidden="true" />
            </span>
          ) : (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-app bg-accent" />
          )
        )}
      </span>
    );
  });

  return (
    <main className="app-glow relative flex h-full min-w-0 flex-1 bg-app">
      <ExchangeColumnProvider node={exchangeColumnNode}>
      <div ref={exchangeColumnRef} className="relative isolate flex min-w-0 flex-1 flex-col">
      <GroupCallOverlay group={group} members={members} />
      {membersOpen && !remoteClient && !group.dm && (
        <ManageMembersPanel group={group} onClose={closeMembers} triggerRef={membersTriggerRef} />
      )}
      {(macInset || browser) && <div className="content-topbar-strip" />}
      {/* Header: laid out like a bot chat's. The centered chip (stacked
          member faces + name) opens the group panel; the right-hand
          controls move into the panel's top bar while it is open. */}
      <div
        {...headerDragProps}
        className={cn(
          "content-topbar",
          "@container/chathead relative flex min-h-[52px] items-center justify-end px-5 py-2.5",
          // Room for the drawer button, which overlays this corner below md.
          "pl-11 md:pl-5",
        )}
      >
        <div className="absolute left-1/2 top-1/2 flex max-w-[50%] -translate-x-1/2 -translate-y-1/2 items-center gap-2" style={headerNoDragStyle}>
          {peer ? (
            // A person: their name opens their panel, the way a bot's does.
            <button
              type="button"
              data-open-person={peer.id}
              onClick={() => dispatch({ type: "openPersonPanel", personId: state.personPanelId === peer.id ? null : peer.id })}
              className="flex min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[13.5px] transition-colors duration-[120ms] hover:bg-elevated-hover"
              title={t("personPanel.open", { name: peer.name })}
              aria-label={t("personPanel.open", { name: peer.name })}
            >
              <PersonAvatar avatarUrl={peer.avatarUrl} initials={peer.initials} size={24} presenceId={peer.id} presenceRing="border-elevated" />
              <span className="truncate text-[14px] font-medium leading-5 text-ink">{peer.name}</span>
              <PersonLabelTag principalId={peer.id} tone="surface" className="max-w-[40%] shrink" />
            </button>
          ) : group.dm ? (
            <span className="flex min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[13.5px]">
              <GroupAvatarStack members={members} size={24} />
              <span className="truncate text-[14px] font-medium leading-5 text-ink">{group.name}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleSettings", open: true })}
              className="flex min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[13.5px] transition-colors duration-[120ms] hover:bg-elevated-hover"
              title={t("chat.openGroupPanel")}
              aria-label={t("chat.openPanelAria", { name: group.name })}
            >
              <GroupAvatarStack members={members} size={24} />
              <span className="truncate text-[14px] font-medium leading-5 text-ink">{group.name}</span>
            </button>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          // The caption buttons sit over the header's right end; drop this
          // control row 16px (visual only) below the 26px overlay.
          style={controlsShiftStyle}
        >
          {activeGoalMessage?.goalRun && (
            <GoalRunHeaderChip
              run={activeGoalMessage.goalRun}
              onShow={() => dispatch({ type: "focusMessage", threadId: group.threadId, messageId: activeGoalMessage.id })}
            />
          )}
          {!panelOpen && <ExportTranscriptMenu
            title={group.name}
            messages={group.messages}
            isGroup
          />}
          {!group.dm && <GroupTaskPicker group={group} />}
          {stored.peopleDm && <PersonThreadPicker group={stored} />}
          {group.dm && memberMauses}
          {/* A group's pill opens its panel: no second button for it. */}
        </div>
      </div>

      <div className="content-card-body flex min-h-0 flex-1 flex-col">
      <ThreadReturnLink ownerId={group.id} threadId={group.threadId} />
      {findOpen && <ChatFindBar threadId={group.threadId} onClose={() => setFindOpen(false)} />}
      <ChatErrorBanner message={state.error} onDismiss={() => dispatch({ type: "error", message: null })} />
      <ChatNotice notice={state.notice} />
      <ChatStaleBanner />
      {!remoteClient && <><GroupCostNotice group={group} /><WeeklyLimitNotice /></>}

      {/* An Auto room answers like lead mode while the decision model is off: say so, once. */}
      {!group.dm && !remoteClient && state.config && group.defaultResponder.kind === "auto" && !jevRoomRoutingOn(state.config) && (
        <div className="w-full px-5">
          <p data-testid="room-jev-off" className="mb-1 px-2 text-[12px] text-ink-secondary">
            {t("room.responder.jevOffHint", { name: defaultResponderName(group, members) ?? t("room.responder.leadFallback") })}{" "}
            <button
              type="button"
              onClick={() => openSettings(dispatch, "decisionModel")}
              className="cursor-pointer text-accent hover:underline"
            >
              {t("room.responder.jevOffOpen")}
            </button>
          </p>
        </div>
      )}

      {/* Members the person stopped: who is held, and how to bring them back. */}
      {!group.dm && <RoomHoldsBanner group={group} members={members} />}

      {/* Bulletin: one pinned line; click to edit */}
      {!stored.peopleDm && <div className="w-full px-5">
        {bulletinOpen ? (
          <div className="mb-1 rounded-lg border border-hairline/40 bg-panel p-2">
            <textarea
              autoFocus
              dir="auto"
              value={bulletinDraft}
              onChange={(e) => setBulletinDraft(e.target.value)}
              onBlur={saveBulletin}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveBulletin();
                if (e.key === "Escape") {
                  setBulletinDraft(group.bulletin);
                  setBulletinOpen(false);
                }
              }}
              placeholder={t("room.bulletin.placeholder")}
              rows={4}
              className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
        ) : (
          <button
            disabled={!editable}
            onClick={() => { if (editable) setBulletinOpen(true); }}
            className={cn("mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", editable && "hover:bg-raised/40")}
            title={t("room.bulletin.title")}
          >
            <Pin size={12} className="shrink-0 text-ink-secondary" />
            <span dir="auto" className={cn("truncate text-[12.5px]", group.bulletin ? "text-ink-secondary" : "text-ink-tertiary")}>
              {group.bulletin.split("\n")[0] || (remoteClient ? t("room.bulletin.none") : t("room.bulletin.add"))}
            </span>
          </button>
        )}
      </div>}


      {/* Pinned message banner — resolves against the room's full transcript */}
      {(() => {
        const pinned = group.messages.find((m) => m.id === group.pinnedMessageId && m.kind === "text");
        const text = pinned ? citationPreviewText(pinned.text ?? "").replace(/\s+/g, " ").trim() : "";
        if (!pinned || !text) return null;
        const sender = pinned.role === "user" ? t("chat.you") : (pinned.from?.name ?? t("room.aBot"));
        return (
          <div className="w-full px-5">
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-1.5">
              <Pin size={12} className="shrink-0 text-accent" />
              <button
                onClick={() => dispatch({ type: "focusMessage", threadId: group.threadId, messageId: pinned.id })}
                className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                title={t("chat.pinnedJump")}
              >
                <span className="shrink-0 text-[11.5px] font-medium text-accent">{sender}</span>
                <span dir="auto" className="truncate text-[12.5px] text-ink-secondary">{text}</span>
              </button>
              <button
                onClick={() => dispatch({ type: "patchGroup", groupId: group.id, patch: { pinnedMessageId: "" } })}
                aria-label={t("chat.unpinMessage")}
                title={t("chat.unpin")}
                className={cn("shrink-0 rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink", remoteClient && "hidden")}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })()}

      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full overflow-x-hidden overflow-y-auto px-5 [overflow-anchor:none]"
        {...scrollHandlers}
      >
        <div
          ref={transcriptRef}
          className="flex w-full flex-col gap-3"
          style={{ paddingBottom: composerDock.pad }}
          role="log"
          // off, as in ChatView: TranscriptAnnouncer speaks once per reply
          aria-live="off"
          aria-label={t("room.aria", { name: group.name })}
        >
          <ConversationGalleryProvider>
          {group.messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex -space-x-2">
                {members.slice(0, 3).map((b) => (
                  <BotAvatar
                    key={b.id}
                    bot={b}
                    state="happy"
                    size={44}
                    motion="none"
                    motionKey={0}
                    animated={false}
                  />
                ))}
              </div>
              <div className="text-[17px] font-semibold text-ink">{group.name}</div>
              <div className="max-w-[380px] text-[14px] text-ink-secondary">
                {groupResponseHint(group, members, { jevOn: jevRoomRoutingOn(state.config) })}
              </div>
            </div>
          )}
          {/* Reverse infinite scroll sentinel and smooth loading indicator */}
          {olderPending ? (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-ink-secondary">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span>{t("chat.loadingEarlier")}</span>
            </div>
          ) : hiddenCount > 0 || group.hasMore ? (
            <div ref={topSentinelRef} className="h-2 w-full pointer-events-none" aria-hidden="true" />
          ) : null}
          <Transcript
            group={group}
            members={members}
            locale={locale}
            messages={windowedMessages}
            transcript={group.messages}
            emergingId={popping?.id}
            unreadDividerId={unreadDivider.messageId}
            unreadDividerFading={unreadDivider.fading}
            onReply={selectReply}
            people={orgPeople}
            reads={threadReads.reads}
            reader={threadReads.self}
          />
          {laterCount > 0 && (
            <div className="flex justify-center">
              <button
                onClick={showLater}
                className="rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                {t("chat.showLater", { count: laterCount })}
              </button>
            </div>
          )}
          {(speaker || presenceVisible) && (
            <TurnPresence
              // the speaker's colour and mascot, as in ChatView
              bot={presenceSpeaker ?? { color: "green" }}
              // a bot the room waits on (busy elsewhere) is not typing here
              streamThreadId={speaker ? group.threadId : null}
              visible={presenceVisible}
              phrases={activity.phrases}
              phase={activity.phase}
              seed={`${group.id}:${group.turnStartedAt ?? ""}:${speaker?.id ?? ""}`}
              answering={popping !== null}
            />
          )}
          {/* Stop only the member that is working; the room carries on. */}
          {threadSpeaker && !group.dm && members.length > 1 && !group.holds?.[threadSpeaker.id] && (
            <div className="flex justify-start pl-12">
              <button
                type="button"
                data-testid="room-stop-member"
                onClick={() => dispatch({ type: "setGroupHold", groupId: group.id, botId: threadSpeaker.id, held: true })}
                title={t("room.holds.stopTitle", { name: threadSpeaker.name })}
                className="ui-pill"
              >
                <Square size={11} aria-hidden="true" />
                <span>{t("room.holds.stop", { name: threadSpeaker.name })}</span>
              </button>
            </div>
          )}
          </ConversationGalleryProvider>
        </div>
      </div>

      <TranscriptAnnouncer threadKey={transcriptKey} snapshot={announcement} />

      {!following && (
        <button
          onClick={jumpToLatest}
          aria-label={t("chat.jumpToLatestAria")}
          className="animate-pop-in absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-hairline/40 bg-raised px-3 py-1.5 text-[12.5px] text-ink shadow-lg hover:bg-raised-hover"
          style={{ bottom: composerDock.height + 16 }}
        >
          <ArrowDown size={13} /> {t("chat.jumpToLatest")}
        </button>
      )}

      <div ref={composerDockRef} className="absolute inset-x-0 bottom-0 z-[2]">
      <Composer
        key={group.threadId}
        group={group}
        members={members}
        nudgePeer={peer ? { ...peer, threadId: stored.threadId } : peer}
        nudgeGroup={roomNudge}
        replyTo={replyTo}
        onClearReply={clearReply}
        onConsumeReply={consumeReply}
        onRestoreReply={restoreReply}
      />
      <CitationSelectionToolbar
        key={`${group.id}:${group.threadId}`}
        viewportRef={scrollRef}
        onAdd={(citation) => appendDraftAttachments(`group:${citation.source.ownerId}:${citation.source.threadId}`, [citation])}
      />
      </div>
      </div>
      </div>
      </div>
      </ExchangeColumnProvider>
      {panelOpen && (
        <GroupPanel
          key={`panel:${group.id}`}
          group={group}
          members={members}
          canEdit={editable}
          readOnlyNote={!remoteClient && !ownsRoom}
          details={
            <>
              <PanelSection title={t("groupPanel.people")}>
                <ChannelMembers
                  part="humans"
                  humans={channelHumans}
                  bots={[]}
                  onOpenHuman={perspicaxOrg ? (id) => dispatch({ type: "openPersonPanel", personId: id.replace(/^user:/, "") }) : undefined}
                  {...roster}
                  onAddHuman={() => {
                    if (perspicaxOrg) {
                      setPickingPeople(true);
                      return;
                    }
                    const email = window.prompt("Adresse courriel")?.trim().toLowerCase() ?? "";
                    if (!email) return;
                    const humanIds = [...new Set([...(group.humanIds ?? []).map((id) => id.trim().toLowerCase()), email])];
                    dispatch({ type: "patchGroup", groupId: group.id, patch: { humanIds } });
                  }}
                  onRemoveHuman={(id) => {
                    dispatch({
                      type: "patchGroup",
                      groupId: group.id,
                      patch: { humanIds: (group.humanIds ?? []).filter((humanId) => humanId.trim().toLowerCase() !== id.trim().toLowerCase()) },
                    });
                  }}
                />
                {perspicaxOrg && pickingPeople && (
                  <GroupPeoplePicker
                    directory={orgDirectory}
                    taken={[viewerId, ...(group.humanIds ?? [])]}
                    onAdd={(principalId) => {
                      const humanIds = [...new Set([...(group.humanIds ?? []).map((id) => id.trim().toLowerCase()), principalId])];
                      dispatch({ type: "patchGroup", groupId: group.id, patch: { humanIds } });
                    }}
                    onDone={() => setPickingPeople(false)}
                  />
                )}
              </PanelSection>
              <PanelSection title="Bots">
                <ChannelMembers
                  part="bots"
                  humans={[]}
                  bots={group.memberIds.map((id) => {
                    const bot = members.find((item) => item.id === id);
                    // The owner removes any bot; anyone else only their own.
                    const removable = ownsRoom || ownBotIds.has(id);
                    return bot ? { ...botPublicProfile(bot), name: botLabel(bot.name, id), removable } : { id, name: botLabel(null, id), removable };
                  })}
                  {...roster}
                  addBotLabel={ownsRoom ? undefined : "Ajouter mon robot"}
                  onRemoveBot={(id) => {
                    dispatch({ type: "patchGroup", groupId: group.id, patch: { memberIds: group.memberIds.filter((memberId) => memberId !== id) } });
                  }}
                  onAddBot={() => {
                    const owned = state.bots.find((bot) => (bot.ownerUserId ?? "").trim().toLowerCase() === actorId && !group.memberIds.includes(bot.id));
                    dispatch({
                      type: "patchGroup",
                      groupId: group.id,
                      patch: { memberIds: owned ? [...group.memberIds, owned.id] : [...group.memberIds] },
                    });
                  }}
                />
                {editable && (
                  <button
                    ref={membersTriggerRef}
                    type="button"
                    onClick={() => setMembersOpen(true)}
                    className="mt-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    {t("room.members.manage")}
                  </button>
                )}
              </PanelSection>
              {!remoteClient && !ownsRoom && viewerListed && (
                <button
                  type="button"
                  onClick={leaveGroup}
                  className="self-start rounded-lg px-3 py-2 text-[13px] text-danger hover:bg-hover"
                >
                  {t("groupPanel.leave")}
                </button>
              )}
            </>
          }
          advanced={
            remoteClient ? null : (
              <>
                <PanelSection title={t("room.responder.aria")}>
                  <DefaultResponderSelect group={group} members={members} disabled={!ownsRoom} />
                </PanelSection>
                {(group.humanIds?.length ?? 0) > 0 && (
                  <PanelSection title={t("room.mentionAll.title")}>
                    <RoomMentionAll group={group} disabled={!ownsRoom} />
                  </PanelSection>
                )}
                <PanelSection title={t("room.turnLimit.aria")}>
                  <ConversationTurnLimit group={group} />
                </PanelSection>
                <PanelSection title={t("room.folder.title")}>
                  <RoomWorkingFolder group={group} disabled={!ownsRoom || !folderEditable} adminOnlyNote={ownsRoom && !folderEditable} />
                </PanelSection>
              </>
            )
          }
        />
      )}
    </main>
  );
}
