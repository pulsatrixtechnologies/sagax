import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from "react";
import { downloadBotZip, showBotZipExport } from "@/lib/bot-zip";
import { TeammatesWorkingChip } from "./TeammatesWorkingChip";
import { ThreadLinkContext } from "@/components/ThreadLinkMenu";
import { useShowThreads } from "@/lib/thread-preferences";
import { isStreamSegment, segmentsAbove, segmentsToReach } from "@/lib/single-stream";
import { useSegmentTranscript } from "@/lib/use-segment-transcript";
import { useFocusMessage } from "@/lib/focus-message";
import { citationAttachment } from "@/lib/citations";
import { useCopyFeedback } from "@/lib/copy-text";
import { botSeenCaption, messageParticipant } from "@/lib/read-receipts";
import { useReportRead, useThreadReads } from "@/lib/read-receipts-feed";
import { SeenByRow, SEEN_AVATAR_SIZE, type SeenFace } from "./SeenBy";
import { ReactionChips } from "./Reactions";
import { myReactions, reactionSelfIds, useToggleReaction } from "@/lib/reactions";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,

  Code,
  Eye,
  Pencil,
  SquarePen,
  Pin,
  PinOff,
  RefreshCw,
  Reply,
  Webhook,
  X,
} from "lucide-react";
import { WorkingDots } from "@/components/WorkingIndicator";
import { TerminalChatEmbed } from "@/components/terminal/TerminalChatEmbed";
import { MessageBar, MessageMenuItem } from "./MessageBar";
import { HOVER_ICON } from "./MessageHoverActions";
import { messageActionClass } from "@/components/MessageActions";
import { TurnRunLine } from "./TurnRunLine";
import { useHoverDwell } from "@/hooks/use-hover-dwell";
import { useSpeech } from "@/lib/tts/useSpeech";
import { useActiveLocale, useLocalSystemVoice, useRemoteClient } from "@/lib/render-reads";
import { computerStartLine } from "@/lib/computer-start";
import { useCaptionChrome, useDesktopCapabilities, useMacInsetChrome } from "@/components/DesktopCapabilities";
import {
  api,
  currentTaskBot,
  useStore,
  formatTime,
  openNotificationTarget,
  openThread,
  startNewTopic,
  freshTopicCovers,
  visibleMessages,
  type Action,
  type AppState,
  type Bot,
  type ConfigStatus,
  type InstanceInfo,
  type Message,
  type Task,
} from "@/state/store";
import { useAdvancedMode } from "@/lib/interface-mode";
import { EngineSetup } from "./EngineSetup";
import { CHATGPT_USAGE_URL } from "./ChatGptPlanStatus";
import { openExternalLink } from "@/lib/app-links";
import { ClaudeUpdatePrompt } from "./ClaudeUpdatePrompt";
import { MacCuaRecoveryActions } from "./MacCuaRecoveryActions";
import { macCuaPermissionMessage, missingMacCuaPermissions } from "@/lib/mac-cua-permissions";
import { failedTurnCause, signedOutEngine } from "@/lib/failed-turn";
import { plainErrorLine } from "@/lib/plain-error";
import { openPlaceAction, placeRowViewFor, usePlaceSeat, worksOnSimpleLabel } from "@/lib/place-view";
import type { PlaceRow } from "../../shared/place-view";
import { isPureLeakedSystemHarnessMessage, stripLeakedSystemHarnessMessages } from "../../shared/system-message-guard.ts";
import { isProviderSafetyBlock, PROVIDER_SAFETY_GUIDANCE, PROVIDER_SAFETY_HELP_URL } from "../../shared/provider-safety";
import { isCancelledTranscriptRow } from "../../shared/client-cancel";
import { BotAvatar } from "./Avatar";
import { BotHeaderPill, botPillActions } from "./BotHeaderPill";
import { TurnPresence } from "./TurnPresence";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { showToolCallsEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { showToolCallRows } from "@/lib/tool-activity-rows";
import { normalizeState, stateForBot } from "@/lib/mascot";
import { mascotRowAnimated } from "@/lib/mascot-animate";
import { peerLine, peerRequest, type PeerLine } from "@/lib/peer-message";
import { autoWorkerLine } from "@/lib/auto-model";
import { showWorkingDots } from "@/lib/turn-tail";
import { lastNonReceipt } from "@/lib/receipts";
import { liveActivityPhrases } from "@/lib/live-activity";
import { ChatMarkdown } from "./ChatMarkdown";
import { VideoPlayerWidget } from "./video/VideoPlayerWidget";
import { VoiceNoteBubble, type VoiceNoteAttachment } from "./VoiceNoteBubble";
import { RawMarkdownView } from "./RawMarkdownToggle";
import { ParallelResultLabel, ParallelTaskCard } from "./ParallelTaskCard";
import { ThreadChip } from "./ThreadChip";
import { withoutDeadThreadChips } from "@/lib/dead-thread-chips";
import { VerifyCard } from "./VerifyCard";
import { askText, runSkill, runSteps, runSummary, showRun, skillPrompt } from "@/lib/verify-steps";
import { useShowRunCard } from "@/lib/run-card-preferences";
import { sendsMessage, useSendKey } from "@/lib/send-key";
import { ToolActivity, botNames } from "./ToolActivity";
import { StepRow } from "./StepRow";
import { stepLabel } from "@/lib/step-label";
import { useColorUserBubbles } from "@/lib/user-bubble-preference";
import { userBubbleStyle } from "@/lib/user-bubble-tone";
import { DataResultChip } from "./DataResultChip";
import { useDataWindowItem } from "./DataWindowButton";
import { ThreadRefText } from "./ThreadRefs";
import { optionsCardRow } from "./OptionsCardRow";
import { MessageBoundary } from "./MessageBoundary";
import { WidgetMessage } from "./widget/WidgetMessage";
import { PagePublishCard } from "./PublishedPages";
import { OwnerSettled, OwnerWait } from "./OwnerWait";
import { Composer } from "./Composer";
import { BackgroundEffectLayer, useBackgroundEffectShown } from "./BackgroundEffectLayer";
import { ChatErrorBanner, ChatNotice } from "./ChatErrorBanner";
import { ChatFindBar } from "./ChatFindBar";
import { ReplyQuote } from "./ReplyQuote";
import { ConnectorCard } from "./ConnectorCard";
import { SecretRequestCard } from "./SecretRequestCard";
import { SignInRequestCard } from "./SignInRequestCard";
import { hasRoutineExecutionTask, RoutineRunCard } from "./RoutineRunCard";
import { CallRecordRow } from "./CallRecordRow";
import { AttachmentGallery, collectMessageFiles, replyAttachmentGroup, splitMessageAttachments } from "./AttachmentGallery";
import { ConversationGalleryProvider } from "./ConversationGallery";
import { prefersWideBubble } from "@/lib/rich-blocks";
import { CHAT_BUBBLE_WIDTH_CLASS, chatBubbleWidth } from "@/lib/chat-bubble-width";
import { ScreenFrame } from "./ScreenFrame";
import { CompactionChip, DigestChip } from "./DigestChip";
import { RenameTitle } from "./RenameTitle";
import { BotActivityPicker, TaskPicker, ThreadReturnLink, ThreadsOffReturnLink } from "./TaskPicker";

import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { CitationSelectionToolbar, SentCitations } from "./CitationUI";

import { SpeakMenuItem } from "./SpeakButton";
import { CallOverlay, VoiceCallDock } from "./CallView";
import { effectivePlace, toolPlace, type EffectivePlace } from "@/lib/place";
import { cn } from "@/lib/cn";
import { useShowInspectorButton } from "@/lib/inspector-preferences";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { showPrivateConversationHint } from "@/lib/private-threads";
import { viewerActorId } from "@/lib/viewer";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { groupTranscript, isHiddenStatusActivity, isStatusActivity, isTurnStoppedNotice, type TranscriptItem } from "@/lib/activity-runs";
import { collapseBotExchanges, exchangeJumpStays, startsNewStretch, visibleEdge, type ExchangeRun } from "@/lib/bot-exchange";
import { foldCollapsedEntry, voiceCallPlan, voiceCallVisibleSpan } from "@/lib/voice-call-transcript";
import { VoiceCallCard } from "./VoiceCallCard";
import { BotExchangeChip, ExchangeColumnProvider, TranscriptDate, useExchangeColumn } from "./BotExchangeChip";
import { GotoGroupChip } from "./GotoGroupChip";
import { collapseGotoLines, silentChatItem, type GotoGroup, type GotoTarget } from "@/lib/goto-lines";
import { StatusActivityRow } from "@/components/StatusActivityRow";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { DevPods, DevPodsToggle } from "./dev-pods/DevPods";
import { ActivityRun } from "./ActivityRun";
import { CwActivityWidgets, CwWidgetView } from "./cw/CwWidgetView";
import { webhookMessageView } from "@/lib/webhook-message";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { useComposerDockPad } from "@/lib/composer-dock";
import { useTranscriptViewport } from "@/hooks/use-transcript-viewport";
import { offscreenAnchorShift, useOffscreenRowAnchor } from "@/hooks/use-offscreen-row-anchor";
import { claimMessageEntrance } from "@/lib/message-entrance";
import { useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { useUnreadDivider } from "@/hooks/use-unread-divider";
import { NewMessagesDivider } from "./NewMessagesDivider";
import { unreadMessageIds } from "@/lib/unread-divider";
import { appendComposerDraft, appendDraftAttachments, useReplyDraft } from "@/lib/drafts";
import { OtherAuthorLabel } from "./MessageAuthor";
import { ConversationRoutineToggle } from "./RoutineToggleLine";
import { ConversationConnectApps } from "./ConnectAppsPill";
import { AccessCard } from "./AccessCard";
import { transcriptLookups, type TranscriptLookups } from "@/lib/transcript-derivations";
import { citationPreviewText, splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { highlightCitationSource } from "@/lib/citations-dom";
import { useCanWriteIn } from "@/lib/cloud-guest";
import { latestFailure, latestReply, type TranscriptSnapshot } from "@/lib/transcript-announcer";
import { pendingApprovals } from "./PendingApproval";
import { TranscriptAnnouncer } from "./TranscriptAnnouncer";
import { ConfidentialBanner, useConfidentialDocumentTitle } from "./ConfidentialBanner";
import { openThreadConfidential } from "@/lib/confidential-thread";

/** Long user messages collapse behind a fade so pasted walls of text don't
 * bury the conversation; bots get full markdown. */
const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;

type ListedItem =
  | TranscriptItem
  | { kind: "exchange"; run: ExchangeRun }
  | { kind: "voiceCall"; callId: string; messages: Message[] }
  | GotoGroup;

/** What every row of the open chat reads besides its own message. The value
 * changes only when one of these does, so the memoized rows skip store
 * events that are not theirs: another bot's frame, a tool chip elsewhere in
 * the thread. The rosters keep their identity until a field a row draws
 * changes, the way ThreadRefsProvider keeps the thread list. */
interface ChatRows {
  botId: string;
  threadId: string;
  botName: string;
  /** The person's own name, for the Hibou 98 skin's log author line. */
  viewerName?: string;
  voiceId?: string;
  /** Speech settings, for the read-aloud button. */
  tts: ConfigStatus["tts"];
  /** A paired Mac reads aloud with its own voices. That choice lives on the
   * device, not in the store, so it is read here once per store event. */
  localVoice: boolean;
  /** Editing, regenerating and switching versions wait for the turn. */
  busy: boolean;
  /** Older messages remain on the server, beyond the page the thread holds. */
  hasMore: boolean;
  /** Every bot, for who wrote a relayed line or sits across a bot⇄bot chip. */
  bots: readonly Bot[];
  /** Every other bot, for @mentions. */
  mentionPeers: readonly Bot[];
  /** A search hit or jump target in this thread. */
  focus: AppState["focusMessage"];
  showToolCalls: boolean;
  /** Rows show catalog strings, so a language change re-renders them. */
  locale: string;
  /** Set when the person's messages take this bot's color. Absent leaves the skin bubble. */
  bubbleStyle?: ReturnType<typeof userBubbleStyle>;
  dispatch: Dispatch<Action>;
  /** Whether a message is on the branch shown now (citation links). */
  onBranch: (messageId: string) => boolean;
  /** Who "I" am on a reaction chip (src/lib/reactions.ts). */
  reactionSelf: readonly string[];
  /** Bot-to-bot channel ids. A Messaged chip targeting one stays here. */
  botDmIds: ReadonlySet<string>;
}

const ChatRowsContext = createContext<ChatRows | null>(null);

function useChatRows(): ChatRows {
  const rows = useContext(ChatRowsContext);
  if (!rows) throw new Error("a chat row outside ChatView");
  return rows;
}

/** The fields of a bot that rows draw: its name and colour for @mentions,
 * its avatar for relayed lines and bot⇄bot chips. */
const drawnBot = (bot: Bot) =>
  [bot.id, bot.name, bot.hidden, bot.color, bot.mascotBody, bot.mascotExpression, bot.avatarUrl, bot.avatarCrop, bot.avatarZoom, bot.avatarFocusX, bot.avatarFocusY].join("\u0001");

/** `bots`, holding the same array until a drawn field of one of them changes. */
function useDrawnBots(bots: readonly Bot[]): readonly Bot[] {
  const signature = bots.map(drawnBot).join("\u0002");
  const cache = useRef({ signature, bots });
  if (cache.current.signature !== signature) cache.current = { signature, bots };
  return cache.current.bots;
}

/** The fields of a bot its "Seen" face draws. */
const seenFaceKey = (bot: Bot) =>
  [bot.id, bot.name, bot.color, bot.mascotLook, bot.mascotSkin, bot.avatarUrl, bot.avatarCrop, bot.avatarZoom, bot.avatarFocusX, bot.avatarFocusY].join("\u0001");

/** `bot`, holding the same object until a field its Seen face draws changes,
 * so the caption is not rebuilt on every bot frame. */
function useSeenFaceBot(bot: Bot): Bot {
  const key = seenFaceKey(bot);
  const cache = useRef({ key, bot });
  if (cache.current.key !== key) cache.current = { key, bot };
  return cache.current.bot;
}

/** Reply to one message: the curved back arrow beside the bubble, in a
 * room and in a 1:1 chat alike (JC, 2026-10-14). */
export function ReplyAction({ onReply, className = messageActionClass }: { onReply: () => void; className?: string }) {
  return (
    <button type="button" onClick={onReply} aria-label={t("chat.replyToMessage")} title={t("chat.reply")} className={className}>
      <Reply size={14} aria-hidden="true" />
    </button>
  );
}

/** Hover/focus-revealed copy control shared by user + bot bubbles. Rooms use
 * the same button beside a message. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { state, copy } = useCopyFeedback(text);
  const label = t(state === "copied" ? "chat.copyMessageDone" : state === "failed" ? "chat.copyMessageFailed" : "chat.copyMessage");
  return (
    <button
      onClick={copy}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
        state !== "idle" && "opacity-100",
        className,
      )}
    >
      {state === "copied" ? <Check size={14} className="text-success" /> : state === "failed" ? <X size={14} className="text-danger" /> : <Copy size={14} />}
    </button>
  );
}

/** A failed turn: a real error block with a retry, not a truncated pill.
 *
 * A `setup` error — CLI missing, or installed but not signed in — shows what
 * to do instead of a Retry, because retrying hits the same wall every time.
 * Once the engine reports itself fixed the card flips back to Retry, which
 * (with the on-focus re-probe) happens by itself when the user returns from
 * the terminal. When the headline is a plain sentence instead of the
 * engine's words (a signed-out engine, a Mac permission), those words stay
 * one click away under it. */
export function ErrorRow({
  message,
  headline: plainHeadline,
  onRetry,
  action,
  setupInstance,
  claudeUpdateInstance,
}: {
  message: string;
  /** A plain sentence to open with instead of `message` (FailedTurnRow's
   * signed-out line, or the plain line for a technical cause from
   * src/lib/plain-error.ts); `message` then moves under Details. */
  headline?: string;
  onRetry?: () => void;
  /** The one next action a failed place names (shared/place-view.ts), in
   * place of Retry; null for a place with nothing to do here. */
  action?: { label: string; onClick: () => void } | null;
  setupInstance?: InstanceInfo;
  /** The Claude engine to update when this turn failed because its Claude
   * Code is too old for the model. */
  claudeUpdateInstance?: InstanceInfo;
}) {
  "use memo";
  const { capabilities, ready } = useDesktopCapabilities();
  const failedPermissions = missingMacCuaPermissions(message);
  const currentPermissions = missingMacCuaPermissions(capabilities.localComputer.message);
  const macCuaReason = ready && capabilities.host.platform === "darwin" &&
    capabilities.localComputer.available === false && capabilities.localComputer.reasonCode !== "remote-server" &&
    message.startsWith("CUA Driver is not ready for this computer — ") &&
    failedPermissions.length > 0 && failedPermissions.join(",") === currentPermissions.join(",")
    ? macCuaPermissionMessage(currentPermissions)
    : null;
  const headline = macCuaReason ?? plainHeadline ?? message;
  return (
    <div className="flex justify-start">
      <div className="w-fit max-w-[min(42rem,78%)] rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-5 text-danger">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{headline}</span>
        </div>
        {headline !== message && <details className="mt-2 text-[12px] text-ink-secondary"><summary className="cursor-pointer">{macCuaReason ? t("computer.mac.permission.driverDetail") : t("chat.error.details")}</summary><p className="mt-1 break-words">{message}</p></details>}
        {macCuaReason &&
          <MacCuaRecoveryActions reason={message} />}
        {message.includes("subscription_sharing_usage_limit_exceeded") ? (
          <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" className="ui-button ui-button-md mt-2 border-transparent bg-ink text-app hover:brightness-110" onClick={(event) => {
            if (window.ogb?.openExternal) { event.preventDefault(); void openExternalLink(CHATGPT_USAGE_URL); }
          }}>{t("engineSetup.chatgpt.manageUsage")}</a>
        ) : claudeUpdateInstance ? (
          <ClaudeUpdatePrompt instance={claudeUpdateInstance} onRetry={onRetry} />
        ) : isProviderSafetyBlock(message) ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">
            {PROVIDER_SAFETY_GUIDANCE}{" "}
            <a href={PROVIDER_SAFETY_HELP_URL} target="_blank" rel="noreferrer" className="underline">About provider safety checks</a>
          </p>
        ) : setupInstance &&
        !(setupInstance.snapshot.state === "available" && setupInstance.snapshot.authenticated !== false) ? (
          <EngineSetup instance={setupInstance} className="mt-2 text-ink-secondary" />
        ) : action !== undefined ? (
          action && (
            <button
              type="button"
              onClick={action.onClick}
              className="ui-button ui-button-md mt-1.5 rounded-full border-danger/30 bg-transparent text-danger hover:bg-danger/15"
            >
              {action.label}
            </button>
          )
        ) : (
          onRetry && (
            <button
              onClick={onRetry}
              className="ui-button ui-button-md mt-1.5 rounded-full border-danger/30 bg-transparent text-danger hover:bg-danger/15"
            >
              <RefreshCw size={12} /> {t("chat.retry")}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** A place that could not be used: its one line and its one next action
 * (shared/place-view.ts), never the provider's raw words or a second
 * button. Try again is the conversation's own retry, offered only where a
 * retry exists. */
function PlaceFailedRow({ place, botId, threadId, onRetry }: {
  place: PlaceRow;
  botId: string;
  threadId?: string;
  onRetry?: () => void;
}) {
  "use memo";
  const dispatch = useStoreDispatch();
  const config = useStoreSelector((current) => current.config);
  const computer = useStoreSelector((current) => current.bots.find((candidate) => candidate.id === botId)?.computer);
  const { capabilities } = useDesktopCapabilities();
  const seat = usePlaceSeat(config, capabilities.host.platform);
  const view = placeRowViewFor(place, seat, worksOnSimpleLabel(computer, capabilities.host.platform));
  const id = view.action?.id;
  const onClick = !id ? undefined
    : id === "try-again" ? onRetry
    : () => { openPlaceAction(id, { botId, threadId }, dispatch); };
  return <ErrorRow message={view.line} action={view.action && onClick ? { label: view.action.label, onClick } : null} />;
}

/** Only a local, editable Claude Code engine can be updated from chat; a
 * company-managed one is the organisation's to update. */
export function claudeUpdateTarget(engine: InstanceInfo | undefined): InstanceInfo | undefined {
  return engine?.driverKind === "claudeAgent" && !engine.readOnly ? engine : undefined;
}

/** A failed turn's stored row ("error: …", src/lib/failed-turn.ts), shown
 * the same in a 1:1 chat and a room: the server writes the same row for both,
 * so both read it here. `engine` is the one the turn ran on — what its
 * sign-in or update card acts on. A place that could not be used is worded
 * again from its stored state, in this reader's language and role. */
export function FailedTurnRow({ tool, engine, onRetry, botId, threadId }: {
  tool: NonNullable<Message["tool"]>;
  engine: InstanceInfo | undefined;
  onRetry?: () => void;
  /** The bot the turn ran as, and its conversation: where a place's next action goes. */
  botId?: string;
  threadId?: string;
}) {
  "use memo";
  if (tool.place && botId) return <PlaceFailedRow place={tool.place} botId={botId} threadId={threadId} onRetry={onRetry} />;
  const signedOut = signedOutEngine(tool, engine);
  // A signed-out engine: its sign-in card is the whole answer, no error row or
  // Details above it. Without a card to show, the row below stays.
  if (signedOut && tool.setup && engine && !(engine.snapshot.state === "available" && engine.snapshot.authenticated !== false)) {
    return <div className="flex justify-start"><EngineSetup instance={engine} className="text-ink-secondary" /></div>;
  }
  const cause = failedTurnCause(tool.name) ?? tool.name;
  return (
    <ErrorRow
      message={cause}
      headline={signedOut ? t("chat.error.signedOut", { name: signedOut.displayName }) : plainErrorLine(cause)}
      onRetry={onRetry}
      setupInstance={tool.setup ? engine : undefined}
      claudeUpdateInstance={tool.claudeUpdate ? claudeUpdateTarget(engine) : undefined}
    />
  );
}

/** The text fallback for a row that will not draw. Rooms import it from here. */
export { MessageBoundary };

/** Inline editor a user bubble turns into: the send key sends (forking the
 * conversation), Esc cancels. Any other Enter is a newline, like the composer. */
function BubbleEditor({
  initial,
  onCancel,
  onSubmit,
  bubbleStyle,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
  bubbleStyle?: ReturnType<typeof userBubbleStyle>;
}) {
  const [draft, setDraft] = useState(initial);
  const sendKey = useSendKey();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const submit = () => {
    if (draft.trim()) onSubmit(draft.trim());
  };
  return (
    <div className={cn("w-full max-w-[min(42rem,78%)] rounded-2xl border border-hairline/40 bg-bubble-user px-4 py-3", bubbleStyle && "user-bubble-colored")} style={bubbleStyle}>
      <textarea
        ref={ref}
        dir="auto"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (sendsMessage(e.nativeEvent, sendKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={Math.min(10, Math.max(2, draft.split("\n").length))}
        className="chat-input-text w-full resize-none bg-transparent text-ink focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink disabled:opacity-40"
        >
          {t("chat.send")}
        </button>
      </div>
    </div>
  );
}

/** One message. Memoized: it renders when its own props change (the
 * message, whether it is pinned or being edited) or the chat's ChatRows do,
 * never for the rest of the store. The callbacks take the message they act
 * on, so every row shares the same ones. */
const Bubble = memo(function Bubble({
  message,
  emerging = false,
  eagerAttachments = false,
  editing,
  pinned,
  versions,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  replyTarget,
  onReply,
}: {
  message: Message;
  emerging?: boolean;
  eagerAttachments?: boolean;
  editing: boolean;
  pinned: boolean;
  /** Every version of an edited question, oldest first; absent when it was never edited. */
  versions?: readonly Message[];
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (messageId: string, text: string) => void;
  /** Given to the last answer only. */
  onRegenerate?: () => void;
  replyTarget?: Message;
  onReply: (message: Message) => void;
}) {
  "use memo";
  const { botId, threadId, botName, viewerName, voiceId, tts, localVoice, busy, bots, mentionPeers, focus, dispatch, onBranch, reactionSelf, bubbleStyle } = useChatRows();
  // Emoji reactions (src/components/Reactions.tsx): the smiley of the hover
  // row and the head of its "…" menu, the chips under the bubble.
  const toggleReactionOn = useToggleReaction(threadId, dispatch);
  const reactable = message.kind === "text" && !message.id.startsWith("optimistic-");
  const react = reactable ? {
    onPick: (emoji: string) => toggleReactionOn(message.id, emoji),
    mine: myReactions(message.reactions, reactionSelf),
  } : undefined;
  const remoteClient = useRemoteClient();
  // A user-role line another bot delivered (ask_bot, delegate_bot,
  // start_thread) is that bot speaking, not the person: it takes the
  // bot side of the chat under the peer's name, with the model-facing
  // provenance note stripped from what the reader sees. A coordinate_bots
  // request is stored bot-role and gets the same label.
  const peer = peerLine(message) ?? peerRequest(message, botId);
  const user = message.role === "user" && !peer;
  // The entrance plays only for a genuinely new line, decided once at mount:
  // never for rows drawn by opening or switching threads (message-entrance.ts).
  const [entering] = useState(() => user && claimMessageEntrance(message));
  const [expanded, setExpanded] = useState(false);
  const focusedSearch = focus?.messageId === message.id && Boolean(focus.matchText);
  const [viewRaw, setViewRaw] = useState(false);
  const speech = useSpeech();
  const speaking = speech.messageId === message.id && speech.status !== "idle";
  // a quiet model/effort line once the pointer rests on a bot reply
  const dwell = useHoverDwell(!user && !peer && Boolean(message.turnRun));
  const rawText = peer ? peer.body : (message.text ?? "");
  // a bot's leaked internal system lines never reach the reader
  const text = user ? rawText : stripLeakedSystemHarnessMessages(rawText);
  const wideBubble = useMemo(() => !user && Boolean(text) && prefersWideBubble(text), [user, text]);
  const attached = useMemo(() => splitMessageAttachments(message.attachments), [message.attachments]);
  const generatedPaths = attached.images;
  const linkedFiles = useMemo(
    () => user ? [] : [...attached.files, ...collectMessageFiles(text, [...attached.images, ...attached.files.map((file) => file.path)])],
    [user, text, attached],
  );
  // a reply with text lists its files under the text, without the ones it links inline
  const group = useMemo(
    () => !user && text.trim() ? replyAttachmentGroup(text, message.attachments) : null,
    [user, text, message.attachments],
  );
  const voiceNotes = useMemo(
    () => message.attachments?.filter((attachment): attachment is VoiceNoteAttachment => attachment.kind === "audio") ?? [],
    [message.attachments],
  );
  const webhookView = user ? webhookMessageView(text) : null;
  const cited = user && !webhookView ? splitTranscriptCitations(text) : null;
  const attachments = user && !webhookView ? splitTranscriptAttachments(cited?.display ?? text) : null;
  const visibleText = webhookView?.task ?? attachments?.display ?? text;
  const hasAttachments = Boolean(cited?.citations.length || (attachments && (attachments.images.length || attachments.files.length)));
  // A message that is only attachments is just the files: no bubble around them.
  const attachmentsOnly = !webhookView && !replyTarget && !visibleText.trim() &&
    (user ? hasAttachments : generatedPaths.length + linkedFiles.length > 0);
  const collapsible =
    user && !webhookView && !expanded && (visibleText.length > USER_COLLAPSE_CHARS || visibleText.split("\n").length > USER_COLLAPSE_LINES);
  useEffect(() => {
    if (focusedSearch && collapsible) setExpanded(true);
  }, [focusedSearch, collapsible, focus?.nonce]);

  if (user && editing && !webhookView && !hasAttachments) {
    return (
      <div className="flex w-full justify-end">
        <BubbleEditor initial={text} bubbleStyle={bubbleStyle} onCancel={onCancelEdit} onSubmit={(edited) => onSubmitEdit(message.id, edited)} />
      </div>
    );
  }

  // "‹ 2/3 ›" under an edited message — every fork it belongs to
  const forks = user && versions ? versions : [message];
  const versionIndex = forks.findIndex((v) => v.id === message.id);
  const switchTo = (v: Message | undefined) => {
    // an edit still waiting for its server fork has no branch to switch to yet
    if (v && !busy && !v.id.startsWith("optimistic-")) dispatch({ type: "switchBranch", botId, threadId, messageId: v.id });
  };
  const togglePin = () =>
    dispatch({ type: "updateTask", botId, threadId, patch: { pinnedMessageId: pinned ? "" : message.id } });

  return (
    <div
      className={cn("group flex w-full flex-col", user ? "items-end" : "items-start", entering && "animate-msg-in")}
      // Read only by the Hibou 98 skin, which lays the chat out as a log with
      // the author and time above each line; invisible everywhere else.
      data-retro-author={user ? viewerName || t("retro.chat.you") : peer?.name ?? botName}
      data-retro-time={formatTime(message.at)}
      data-retro-role={user ? "user" : "bot"}
      {...dwell.handlers}
    >
      {peer && <PeerLabel peer={peer} autoModel={message.autoModel} />}
      {user && <OtherAuthorLabel message={message} />}
      <div className={cn("flex w-full items-center gap-1.5", user ? "justify-end" : "justify-start")}>
        {user && (
          <MessageBar
            side="user"
            time={formatTime(message.at)}
            copy={visibleText.trim() ? visibleText : undefined}
            onReply={() => onReply(message)}
            requestId={message.id.startsWith("optimistic-") ? undefined : message.id}
            react={react}
          >
            {/* editing rewinds the thread, so it waits for the turn to end —
                same rule as the version switcher below */}
            {message.kind === "text" && !webhookView && !hasAttachments && !busy && !message.id.startsWith("optimistic-") && (
              <MessageMenuItem label={t("chat.editMessage")} icon={<Pencil {...HOVER_ICON} />} onSelect={() => onStartEdit(message.id)} />
            )}
            <MessageMenuItem
              label={pinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
              icon={pinned ? <PinOff {...HOVER_ICON} /> : <Pin {...HOVER_ICON} />}
              onSelect={togglePin}
              hidden={remoteClient}
            />
          </MessageBar>
        )}
        <div
          data-chat-bubble
          className={cn(
            "rounded-[18px] text-[13px] leading-5",
            CHAT_BUBBLE_WIDTH_CLASS[chatBubbleWidth({ terminal: !user && Boolean(message.terminalEmbed), wide: wideBubble })],
            emerging && "turn-answer",
            user && webhookView
              ? "overflow-hidden border border-accent/25 bg-card text-ink shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
              : attachmentsOnly
                ? "text-ink"
                : user
                  ? cn("bg-bubble-user px-3 py-[7px] whitespace-pre-wrap text-ink", bubbleStyle && "user-bubble-colored")
                  : "bg-card px-3 py-[7px] text-ink",
          )}
          style={user && !webhookView && !attachmentsOnly ? bubbleStyle : undefined}
          title={new Date(message.at).toLocaleString()}
        >
          {replyTarget && (
            <div className="mb-2">
              <ReplyQuote
                message={replyTarget}
                fallbackName={botName}
                compact
                onJump={() =>
                  dispatch({ type: "focusMessage", threadId, messageId: replyTarget.id })
                }
              />
            </div>
          )}
          {user && webhookView ? (
            <div className="min-w-[300px] max-w-[520px]">
              <div className="flex items-center gap-2 border-b border-accent/15 bg-accent/[0.055] px-4 py-2.5 text-[11.5px] font-medium text-accent">
                <Webhook size={13} />
                <span>{t("chat.webhookTask")}</span>
              </div>
              <div className="chat-text px-4 py-3 whitespace-pre-wrap">{webhookView.task}</div>
              {webhookView.payload && (
                <details className="border-t border-hairline/30 bg-inset/25 px-4 py-2.5 text-[11.5px] text-ink-secondary">
                  <summary className="cursor-pointer select-none hover:text-ink">{t("chat.viewPayload")}</summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-hairline/25 bg-black/25 p-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-secondary">{webhookView.payload}</pre>
                </details>
              )}
            </div>
          ) : user ? (
            <>
              {attachments && <AttachmentGallery images={attachments.images} files={attachments.files} message={{ threadId, messageId: message.id }} eager={eagerAttachments} className={!visibleText ? "mb-0" : undefined} />}
              {visibleText && (
                <div
                  className={cn("chat-text", collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
                  data-citation-source={message.id}
                  data-citation-owner-type="bot"
                  data-citation-owner={botId}
                  data-citation-thread={threadId}
                >
                  <ThreadRefText text={visibleText} peers={mentionPeers} />
                </div>
              )}
              {cited && <SentCitations
                citations={cited.citations}
                onNavigate={async (citation: CitationAttachment) => {
                  if (citation.source.ownerType !== "bot" || !onBranch(citation.source.messageId)) return false;
                  dispatch({ type: "focusMessage", threadId, messageId: citation.source.messageId });
                  return highlightCitationSource(citation);
                }}
              />}
              {message.steered && (
                <div className="mt-1 text-[11px] text-ink-tertiary" title={t("chat.sentMidTurnHint")}>
                  {t("chat.sentMidTurn")}
                </div>
              )}
              {message.via === "call" && (
                <span className="mt-1 text-[11px] text-ink-tertiary" title={t("chat.viaCall")}>
                  {t("chat.viaCall")}
                </span>
              )}
              {collapsible && (
                <button onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showFull")}
                </button>
              )}
              {expanded && (
                <button onClick={() => setExpanded(false)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showLess")}
                </button>
              )}
            </>
          ) : (
            <MessageBoundary key={viewRaw ? "raw" : "rendered"} fallbackText={text || t("chat.generatedImage")}>
              {voiceNotes.length > 0 && (
                <div className={cn("flex flex-col", (text || generatedPaths.length > 0 || linkedFiles.length > 0) && "mb-2")}>
                  {voiceNotes.map((note) => (
                    <VoiceNoteBubble key={note.path} attachment={note} />
                  ))}
                </div>
              )}
              {message.terminalEmbed && <TerminalChatEmbed embed={message.terminalEmbed} />}
              {!group && <AttachmentGallery images={generatedPaths} files={linkedFiles} message={{ threadId, messageId: message.id }} className={text ? undefined : "mb-0"} eager={eagerAttachments} />}
              {viewRaw && text ? (
                <div data-citation-source={message.id} data-citation-owner-type="bot" data-citation-owner={botId} data-citation-thread={threadId}><RawMarkdownView text={text} /></div>
              ) : text ? (
                <div data-citation-source={message.id} data-citation-owner-type="bot" data-citation-owner={botId} data-citation-thread={threadId}>
                  <ChatMarkdown
                    text={text}
                    botId={botId}
                    mentionPeers={mentionPeers}
                    message={{ threadId, messageId: message.id }}
                    youtubeSendToBot={(body) => dispatch({ type: "send", botId, threadId, text: body })}
                    delivered={group?.delivered}
                  />
                </div>
              ) : null}
              {group && <AttachmentGallery images={group.images} files={group.files} message={{ threadId, messageId: message.id }} eager={eagerAttachments} beneath />}
            </MessageBoundary>
          )}
        </div>
        {!user && (
          <MessageBar
            side="bot"
            time={formatTime(message.at)}
            visible={viewRaw || speaking}
            copy={text || undefined}
            onReply={() => onReply(message)}
            requestId={message.id.startsWith("optimistic-") ? undefined : message.id}
            react={react}
            view={<>
              {message.kind === "text" && text && !peer && (
                <SpeakMenuItem text={text} botId={botId} messageId={message.id} voiceId={voiceId} tts={tts} localVoice={localVoice} />
              )}
              {text && (
                <MessageMenuItem
                  label={t(viewRaw ? "chat.showRenderedMarkdown" : "chat.showRawMarkdown")}
                  icon={viewRaw ? <Eye {...HOVER_ICON} /> : <Code {...HOVER_ICON} />}
                  active={viewRaw}
                  onSelect={() => setViewRaw((r) => !r)}
                />
              )}
            </>}
          >
            {!busy && onRegenerate && (
              <MessageMenuItem label={t("chat.regenerate")} icon={<RefreshCw {...HOVER_ICON} />} onSelect={onRegenerate} />
            )}
            <MessageMenuItem
              label={pinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
              icon={pinned ? <PinOff {...HOVER_ICON} /> : <Pin {...HOVER_ICON} />}
              onSelect={togglePin}
              hidden={remoteClient}
            />
          </MessageBar>
        )}
      </div>
      <ReactionChips reactions={message.reactions} selfIds={reactionSelf} bots={bots} end={user} onToggle={(emoji) => toggleReactionOn(message.id, emoji)} />
      {/* always laid out, only faded in: the answer above never moves (JC, 2026-10-15) */}
      {!user && !peer && message.turnRun && <TurnRunLine run={message.turnRun} visible={dwell.shown} />}
      {forks.length > 1 && (
        <div className="mt-1 flex items-center gap-0.5 pr-1 text-[12px] text-ink-secondary">
          <button
            onClick={() => switchTo(forks[versionIndex - 1])}
            disabled={versionIndex <= 0 || busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title={t("chat.previousVersion")}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">
            {versionIndex + 1}/{forks.length}
          </span>
          <button
            onClick={() => switchTo(forks[versionIndex + 1])}
            disabled={versionIndex >= forks.length - 1 || busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title={t("chat.nextVersion")}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
});

/** Who wrote a relayed line and how it arrived, above the bubble — the
 * same shape as a room's cluster label. Looked up by id, then by name for
 * rows that predate Message.peerAsk; a peer since renamed or deleted still
 * shows the name the line carries. Renders with its bubble. */
function PeerLabel({ peer, autoModel }: { peer: PeerLine; autoModel?: Message["autoModel"] }) {
  "use memo";
  const { bots } = useChatRows();
  const author =
    bots.find((b) => b.id === peer.botId) ?? bots.find((b) => b.name === peer.name);
  const how =
    peer.delivery === "delegate_bot"
      ? t("chat.peer.delegated")
      : peer.delivery === "start_thread"
        ? t("chat.peer.openedThread")
        : peer.delivery === "coordinate_bots"
          ? t("chat.peer.requested")
          : t("chat.peer.asked");
  return (
    <div className="mb-1 flex items-center gap-1.5 pl-0.5" data-testid="peer-label">
      <BotAvatar
        bot={author ?? { name: peer.name, color: "blue" }}
        state={normalizeState(author?.mascotExpression) ?? "happy"}
        size={16}
        motion="none"
        motionKey={0}
        animated={false}
      />
      <span className="text-[11px] font-medium text-ink-secondary">{peer.name}</span>
      <span className="text-[11px] text-ink-tertiary">· {how}</span>
      {/* Auto: the model this delegated work runs on, and its class. */}
      {autoModel?.role === "worker" && (
        <span data-peer-auto-model className="min-w-0 truncate text-[11px] text-ink-tertiary">· {autoWorkerLine(autoModel)}</span>
      )}
    </div>
  );
}

/** A tool run as a quiet step row (StepRow), or a receipt that opens a conversation. */
const ActivityChip = memo(function ActivityChip({ message, place = "auto" }: { message: Message; place?: EffectivePlace }) {
  "use memo";
  const { bots, dispatch, botDmIds } = useChatRows();
  const tool = message.tool;
  if (!tool) return null;
  if (message.threadRef) return <ThreadChip message={message} />;
  // bot⇄bot comm chip: a DM is read in this column (the exchange sheet), not
  // by selecting that channel. A Posted-in-room receipt still opens the room.
  const comm = message.comm;
  if (comm) {
    const withBot = bots.find((b) => b.id === comm.withBotId);
    const stay = botDmIds.has(comm.groupId);
    return (
      <div className="flex justify-start">
        <StepRow
          testId="bot-comm-chip"
          label={stepLabel(tool, botNames(bots))}
          phase={tool.ok === false ? "failed" : "done"}
          icon={<BotAvatar bot={withBot ?? { name: comm.withName, color: comm.withColor }} state="happy" size={14} animated={false} />}
          title={stay ? undefined : t("chat.openConversationWith", { name: comm.withName })}
          onActivate={stay ? undefined : () => dispatch({ type: "select", id: comm.groupId })}
        />
      </div>
    );
  }
  return <ToolActivity tool={tool} place={toolPlace(tool.name, place)} nameOf={botNames(bots)} />;
});

/** A routine run's receipt. It opens the run's own thread, so it follows
 * the bots to know whether that thread is still there. */
function RoutineRunRow({ message, botId }: { message: Message; botId: string }) {
  "use memo";
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const showThreads = useShowThreads();
  const executionThreadId = message.routineRun?.executionThreadId;
  const canOpen = useStoreSelector((current) => Boolean(executionThreadId) && current.bots.some((candidate) =>
    candidate.threadId === executionThreadId || hasRoutineExecutionTask(candidate.tasks, executionThreadId!)
  ));
  return (
    <RoutineRunCard
      message={message}
      onOpen={canOpen && executionThreadId
        ? () => openNotificationTarget(dispatch, { botId, threadId: executionThreadId }, getState(), showThreads)
        : undefined}
    />
  );
}

/** A conversation with nothing in it yet: its name and a prompt. */
function EmptyChat({ bot }: { bot: Bot }) {
  const dispatch = useStoreDispatch();
  const advanced = useAdvancedMode();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      {/* No mascot here: the header already shows the bot (JC 2026-10-16).
          Simple mode renames in the bot's settings only. */}
      {!advanced ? <div className="text-[17px] font-semibold text-ink">{bot.name}</div> : <RenameTitle
        value={bot.name}
        onCommit={(name) => {
          if (window.ogb?.remoteClient?.active) {
            void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
              .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
              .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
          } else {
            dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
          }
        }}
        className="text-[17px] font-semibold text-ink"
        inputClassName="rounded bg-inset px-1.5 py-0.5 text-center text-[17px] font-semibold"
      />}
      <div className="max-w-[360px] text-[14px] text-ink-secondary">
        {bot.description || t("chat.emptyPrompt")}
      </div>
    </div>
  );
}

/** The settled transcript, memoized as one unit: it renders when any
 * message on the branch or the chat's ChatRows change. Each row inside is
 * memoized on its own message, so a patched tool chip renders that chip and
 * nothing else. */
/** The newest transcript rows, always laid out and painted. */
const DRAWN_TAIL_ROWS = 3;

/** The messages one listed item draws. */
function listedItemMessages(item: ListedItem): readonly Message[] {
  return item.kind === "message" ? [item.message] : item.kind === "exchange" ? item.run.messages : item.messages;
}

const MessagesList = memo(function MessagesList({
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
}) {
  "use memo";
  // Sagax's extras below (access cards, bot-to-bot exchange chips, who is
  // viewing) read slices of the store, so an unrelated dispatch (an unread
  // mark, a notice) leaves the list alone; the rows inside stay memoized on
  // ChatRows.
  const storeBots = useStoreSelector((current) => current.bots);
  const storeGroups = useStoreSelector((current) => current.groups);
  const config = useStoreSelector((current) => current.config);
  // read when a chip is clicked, so a store event does not render the list
  const getState = useStoreGetter();
  const { botId, threadId, botName, busy, hasMore, bots, focus, showToolCalls, locale, dispatch } = useChatRows();
  const showThreads = useShowThreads();
  const selfColor = bots.find((candidate) => candidate.id === botId)?.color;
  const owners = useMemo(() => ({ bots: storeBots, groups: storeGroups }), [storeBots, storeGroups]);
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
    const seen = new Set<string>();
    // A stop the person asked for leaves no row, stored ones included.
    // Nor does the "On your computer" line, so it never splits a bot exchange.
    const shown = withoutDeadThreadChips(messages, owners).filter((message) => !isTurnStoppedNotice(message) && !isHiddenStatusActivity(message));
    const collapsed = collapseBotExchanges(shown, {
      selfBotId: botId,
      self: { id: botId, name: botName, color: selfColor },
      lookup: transcript,
    });
    const listed: ListedItem[] = [];
    let pending: Message[] = [];
    const flush = () => {
      if (!pending.length) return;
      listed.push(...groupTranscript(pending));
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
    // Two or more "Go to conversation" lines in a row become one chip.
    return collapseGotoLines(listed, (item) => silentChatItem(item, showToolCalls)) as ListedItem[];
  }, [messages, transcript, botId, botName, selfColor, locale, owners, showToolCalls]);
  const windowIds = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const newestMessageId = messages.at(-1)?.id;
  let newestUserMessageId: string | undefined;
  for (let i = messages.length - 1; i >= 0 && !newestUserMessageId; i--) {
    if (messages[i]!.role === "user") newestUserMessageId = messages[i]!.id;
  }
  // A search hit inside a folded run has to open it: the fold keeps the
  // row out of the DOM, and there is nothing for the scroll to land on.
  const focusedId = focus && !focus.consumed ? focus.messageId : null;
  const unreadIds = useMemo(() => unreadMessageIds(messages, unreadDividerId), [messages, unreadDividerId]);
  // The New divider goes above the first item holding an unread message.
  const dividerIndex = useMemo(() => unreadIds
    ? items.findIndex((item) => listedItemMessages(item).some((row) => unreadIds.has(row.id)))
    : -1, [items, unreadIds]);
  const dividerAbove = (index: number) => index === dividerIndex ? <NewMessagesDivider fading={unreadDividerFading} /> : null;
  return (
    <>
      {items.map((item, i) => {
        const edgeOf = (entry: ListedItem) =>
          entry.kind === "voiceCall"
            ? voiceCallVisibleSpan(entry.messages, windowIds)
            : entry.kind === "gotoGroup"
              ? { first: entry.messages[0]!, last: entry.messages.at(-1)! }
              : visibleEdge(entry);
        const hiddenRun = (entry: ListedItem) => entry.kind === "run" && !showToolCalls && entry.messages.every((step) => step.kind === "activity");
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
        // Rows far from the viewport skip layout and paint (styles.css
        // .transcript-row); the newest rows and a search hit stay drawn.
        const rowClass = i >= items.length - DRAWN_TAIL_ROWS || listedItemMessages(item).some((row) => row.id === focusedId)
          ? "contents" : "transcript-row";
        if (item.kind === "gotoGroup") {
          return (
            <div key={item.id} className={rowClass}>
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
                    // Same rule as the lone line: another bot would leave this 1:1.
                    if (!exchangeJumpStays(target.run.party.id, botId)) return false;
                    const bot = bots.find((candidate) => candidate.id === target.run.party.id);
                    if (!bot) return false;
                    return openThread(dispatch, { botId: bot.id, threadId: bot.threadId }, getState(), showThreads);
                  }}
                />
              </div>
            </div>
          );
        }
        if (item.kind === "exchange") {
          return (
            <div key={item.run.id} className={rowClass}>
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
                  return openThread(dispatch, { botId: target.id, threadId: target.threadId }, getState(), showThreads);
                }}
              />
            </div>
          );
        }
        if (item.kind === "voiceCall") {
          const hit = item.messages.find((message) => message.id === focusedId);
          return (
            <div key={`voice:${item.callId}`} className={rowClass}>
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
            </div>
          );
        }
        if (item.kind === "run") {
          const hasWidget = item.messages.some((step) => step.tool?.widget);
          // Tool calls off: the steps go, a turn's narration stays folded.
          const shown = showToolCalls ? item.messages : item.messages.filter((step) => step.kind !== "activity");
          // Hidden steps still carry the divider: the reply under them is new.
          if (!shown.length && !hasWidget) return divider && <div key={item.id} className="contents">{divider}</div>;
          return (
            <div key={item.id} className={rowClass}>
              {newDay && <TranscriptDate at={first.at} />}
              {divider}
              <CwActivityWidgets messages={item.messages} threadId={threadId} botId={botId} />
              {shown.length > 0 && (
                <ActivityRun
                  messages={shown}
                  elapsedMs={item.elapsedMs}
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
              )}
            </div>
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
          if (m.state === "waiting-on-owner") return <OwnerWait ownerName={m.ownerName ?? ""} />;
          if (m.state === "owner-settled") return <OwnerSettled message={m} />;
          // a bot's page proposal: its approval card (src/components/PublishedPages.tsx)
          if (m.pagePublish && m.role === "bot") {
            return <MessageBoundary fallbackText={m.text ?? ""}><PagePublishCard message={m} /></MessageBoundary>;
          }
          // a widget row whose tree never arrived still reads as its text
          switch (m.kind === "widget" && !m.widget ? "text" : m.kind) {
            case "access":
              return m.access ? (
                <AccessCard
                  access={m.access}
                  viewer={{ principalId: config?.viewer?.principalId ?? null, admin: config?.viewer?.role === "admin" || config?.viewer?.role === "owner" }}
                  onSignIn={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}
                />
              ) : null;
            case "secret":
              return m.secret ? <SecretRequestCard botId={botId} threadId={threadId} message={m} /> : null;
            case "signin":
              return m.signIn ? <SignInRequestCard botId={botId} botName={botName} threadId={threadId} message={m} /> : null;
            case "connector":
              return m.connector ? <ConnectorCard botId={botId} threadId={threadId} message={m} /> : null;
            case "options":
              return optionsCardRow({ message: m, transcript, botId, botName, threadId });
            case "widget":
              // bot-authored and persisted: one that throws while drawing falls back to its text
              return <MessageBoundary fallbackText={m.text ?? ""}><WidgetMessage botId={botId} threadId={threadId} message={m} /></MessageBoundary>;
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
              if (m.tool?.widget) {
                return (
                  <>
                    <CwWidgetView widget={m.tool.widget} threadId={threadId} botId={botId} />
                    {showToolCalls ? <ActivityChip message={m} place={place} /> : null}
                  </>
                );
              }
              if (!showToolCalls && !m.comm && !m.threadRef && !m.dataResult) return null;
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
              return <ScreenFrame threadId={threadId} message={m} />;
            case "video":
              return m.video ? (
                <div className="flex justify-start">
                  <VideoPlayerWidget video={m.video} />
                </div>
              ) : null;
            default: {
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
          <div key={m.id} className={rowClass}>
            {newDay && <TranscriptDate at={m.at} />}
            {divider}
            <div className="contents" data-mid={m.id}>
              {row}
              {seen?.messageId === m.id && <SeenByRow faces={seen.faces} end time={formatTime} />}
            </div>
          </div>
        );
      })}
    </>
  );
});

/** The one pinned message, above the transcript: sender, one line, click to
 * jump, X to unpin. Resolves the pin id against the full message list; a
 * pin that no longer resolves renders nothing (edited away or deleted). */
function PinnedBanner({
  bot,
  pinnedId,
  messages,
  onJump,
  onUnpin,
}: {
  bot: Bot;
  pinnedId?: string;
  messages: Message[];
  onJump: (messageId: string) => void;
  onUnpin?: () => void;
}) {
  "use memo";
  const pinned = messages.find((m) => m.id === pinnedId);
  if (!pinned || pinned.kind !== "text") return null;
  const pinnedPeer = peerLine(pinned);
  const sender =
    pinned.role === "user" ? (pinnedPeer?.name ?? t("chat.you")) : (pinned.from?.name ?? bot.name);
  const text = citationPreviewText(pinnedPeer?.body ?? pinned.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return (
    <div className="w-full px-5">
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-1.5">
        <Pin size={12} className="shrink-0 text-accent" />
        <button
          onClick={() => onJump(pinned.id)}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          title={t("chat.pinnedJump")}
        >
          <span className="shrink-0 text-[11.5px] font-medium text-accent">{sender}</span>
          <span dir="auto" className="truncate text-[12.5px] text-ink-secondary">{text}</span>
        </button>
        {onUnpin && <button
          onClick={onUnpin}
          aria-label={t("chat.unpinMessage")}
          title={t("chat.unpin")}
          className="shrink-0 rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={13} />
        </button>}
      </div>
    </div>
  );
}

/** The compact chat of a side thread (SideThreadPanel): its own header in
 * place of the bot pill and controls, and none of the window-wide parts
 * (calls, ⌘F, the app's error and notice banners), which stay with the
 * main chat. */
export type SideChat = { header: ReactNode; label: string };

// ── single stream (Show threads off, docs/single-stream-orchestration.md) ──

const noop = () => {};

/** The line that opens a topic of the single stream. */
function TopicDivider({ task }: { task: Pick<Task, "threadId" | "title" | "createdAt"> }) {
  return (
    <div className="my-2 flex items-center gap-3 text-[11.5px] text-ink-tertiary" role="separator" data-topic-divider={task.threadId}>
      <span className="h-px flex-1 bg-hairline/60" />
      <span className="max-w-[70%] truncate" title={task.title}>{t("stream.divider", { title: task.title })} · {formatTime(task.createdAt)}</span>
      <span className="h-px flex-1 bg-hairline/60" />
    </div>
  );
}

/** The line that opens a fresh topic not created yet (src/lib/fresh-topic.ts),
 * under the earlier topics once they are shown. */
function FreshTopicDivider({ onResume }: { onResume: () => void }) {
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
 * for (JC 2026-10-18: less on screen; ⌘F still searches them). */
function PreviousTopicsLine({ open, onToggle }: { open: boolean; onToggle: () => void }) {
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

/** "New topic" in the chat header while threads are off: a fresh context in
 * the same conversation; the topic it closes stays on screen above. */
function NewTopicButton({ bot }: { bot: Bot }) {
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
function StreamSegment({ task, first, rows, place, engine, aroundId, onQuote, onLoaded }: {
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
  const focusAll = useStoreSelector((current) => current.focusMessage);
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
function StreamEarlierTopics({ bot, rows, place, engine, scrollRef, followRef, reach, onReached, onQuote, includeCurrent = false }: {
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
  useEffect(() => {
    if (!focusSegment || !focus) return;
    const needed = segmentsToReach(bot.tasks, bot.threadId, focusSegment);
    if (needed <= 0) return;
    setCount((current) => Math.max(current, needed));
    setAround((current) => current[focusSegment] === focus.messageId ? current : { ...current, [focusSegment]: focus.messageId });
  }, [focusSegment, focus?.nonce, focus?.messageId, bot.tasks, bot.threadId]);
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

/** How far above its end a topic may grow and still move the reader with
 * it: a reader whose view starts within this band of the topic's end (the
 * top of the live topic, or a topic's last lines) reads below the growth. */
export const STREAM_ANCHOR_BAND = 120;

/** The earlier topics load and grow above the live one, and the scroller
 * has the browser's scroll anchoring off (the transcript anchors its own
 * prepends): a topic that grows (its first page, an older page, a late
 * answer) while the reader is below it moves scrollTop by the growth, so the
 * rows being read stay still. The reader following the bottom is pinned by
 * bottom-follow already. */
function useStreamAnchor(
  scrollRef: React.RefObject<HTMLElement | null>,
  wrapperRef: React.RefObject<HTMLElement | null>,
  followRef: React.RefObject<boolean>,
  active: boolean,
) {
  useEffect(() => {
    const scroller = scrollRef.current;
    const wrapper = wrapperRef.current;
    if (!active) return;
    if (!scroller || !wrapper || typeof ResizeObserver === "undefined") return;
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      const changes: Array<{ top: number; previousHeight: number; height: number }> = [];
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previousHeight = heights.get(entry.target);
        heights.set(entry.target, height);
        if (previousHeight === undefined || previousHeight === height) continue;
        changes.push({ top: entry.target.getBoundingClientRect().top - origin, previousHeight, height });
      }
      if (!changes.length || followRef.current) return;
      const shift = offscreenAnchorShift(changes, scroller.scrollTop + STREAM_ANCHOR_BAND);
      if (shift) scroller.scrollTop += shift;
    });
    const watch = (node: Node) => {
      if (node instanceof Element && node.matches("[data-stream-segment], [data-stream-earlier]")) resize.observe(node);
    };
    wrapper.childNodes.forEach(watch);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(watch);
        record.removedNodes.forEach((node) => { if (node instanceof Element) resize.unobserve(node); });
      }
    });
    mutations.observe(wrapper, { childList: true });
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [scrollRef, wrapperRef, followRef, active]);
}

/** An earlier topic of the stream has something new (a late answer, a card):
 * one pill that brings it on screen and reads it. */
function EarlierTopicActivity({ bot, onReach, includeCurrent = false }: { bot: Bot; onReach: (threadId: string) => void; includeCurrent?: boolean }) {
  const current = includeCurrent ? bot.tasks?.find((task) => task.threadId === bot.threadId) : undefined;
  const above = current ? [current, ...segmentsAbove(bot.tasks, bot.threadId)] : segmentsAbove(bot.tasks, bot.threadId);
  const active = above.find((task) => task.unread || task.activity === "waiting-on-you");
  if (!active) return null;
  return (
    <div className="mx-5 mb-2 flex justify-center" data-earlier-topic-activity={active.threadId}>
      <button type="button" onClick={() => onReach(active.threadId)} className="ui-pill max-w-full truncate">
        {t("stream.newActivity", { title: active.title })}
      </button>
    </div>
  );
}

export function ChatView({ bot: stored, side }: { bot: Bot; side?: SideChat }) {
  "use memo";
  const showInspector = useShowInspectorButton();
  const advanced = useAdvancedMode();
  // A switch under way with a cached page of its thread (Bot.switchPreview)
  // draws that thread at once: its page, its composer (locked, as while any
  // snapshot is awaited) and its controls. The transcript is inert until the
  // switch's own page lands and replaces it.
  // The main chat only: a side thread shows its own thread, never the main one's switch.
  const preview = !side && stored.switchPreview && stored.switchPreview.threadId === stored.switchingTo ? stored.switchPreview : null;
  const profile = useMemo(() => preview
    ? { ...stored, threadId: preview.threadId, messages: preview.messages, hasMore: preview.hasMore, activeLeafId: preview.activeLeafId ?? null, awaitingThreadSnapshot: true }
    : stored, [stored, preview]);
  const bot = useMemo(() => currentTaskBot(profile), [profile]);
  const dataItem = useDataWindowItem(bot);
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const remoteClient = useRemoteClient();
  // Without a native title bar (macOS inset lights, frameless Windows) this
  // header is the window drag region. On Windows the icon row also shifts
  // below the 26px-tall corner the renderer-drawn caption buttons occupy.
  const { dragProps: headerDragProps, noDragStyle: headerNoDragStyle, controlsShiftStyle } = useCaptionChrome();
  // Pulsatrix Light's navy top band mirrors the sidebar's own macOS-inset
  // strip, so the two stay vertically aligned; every other skin ignores it.
  const { macInset, browser } = useMacInsetChrome();
  const panelOpen = !remoteClient && (state.settingsOpen || state.computerOpen);
  // The pill toggles whichever right panel is showing, the remote one too.
  const pillPanelOpen = state.settingsOpen || state.computerOpen;
  // A shared bot on an organization server: each person's conversation is
  // their own; several people talk together in a group.
  const perspicaxOrg = usePerspicaxOrg();
  // A confidential thread wears its classification band, top and bottom,
  // for as long as it lives (src/lib/confidential-thread.ts).
  const confidential = openThreadConfidential(profile);
  useConfidentialDocumentTitle(confidential && !side);
  const privateHint = showPrivateConversationHint({ org: perspicaxOrg !== null, viewerId: viewerActorId(state.config), bot });
  const { node: exchangeColumnNode, ref: exchangeColumnRef } = useExchangeColumn();
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerDock = useComposerDockPad(composerDockRef);
  // Settings > Appearance > Background effects (main conversation only)
  const shownEffect = useBackgroundEffectShown();
  const backgroundEffect = side ? null : shownEffect;
  // A guest on an OMB Cloud home writes only in conversations it opened.
  const canWrite = useCanWriteIn(bot.threadId);

  const computerStarting = computerStartLine(state.computerStarts[bot.id], bot.name);
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const [findOpen, setFindOpen] = useState(false);
  const { replyTo, selectReply, clearReply, consumeReply, restoreReply } = useReplyDraft(
    bot.threadId,
    `bot:${bot.id}:${bot.threadId}`,
    bot.messages,
  );
  useEffect(() => setFindOpen(false), [bot.threadId]);
  useEffect(() => {
    if (side) return;
    const onFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, [side]);

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
  // now — plus a run with something to keep.
  const recordedRun = useMemo(() => runSteps(messages), [messages]);
  const recordedRunCounts = runSummary(recordedRun);
  const engineSupportsAgents = Boolean(
    state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp,
  );
  const canSaveRun =
    skillAuthoringEnabled(state.config) && engineSupportsAgents && recordedRunCounts.passed > 0 && recordedRunCounts.running === 0 && !bot.busy;
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
    pinOn: [bot.busy, composerDock.pad],
    hasMore: bot.hasMore,
  });
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
  const bots = useDrawnBots(state.bots);
  const mentionPeers = useMemo(() => bots.filter((peer) => peer.id !== bot.id), [bots, bot.id]);
  const focus = state.focusMessage?.threadId === bot.threadId ? state.focusMessage : null;
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
  const bubbleStyle = useMemo(() => (colorMine ? userBubbleStyle(bot.color) : undefined), [colorMine, bot.color]);
  const hasMore = Boolean(bot.hasMore);
  const reactionSelfKey = reactionSelfIds(state.config, threadReads.self).join("\n");
  const reactionSelf = useMemo(() => reactionSelfKey.split("\n").filter(Boolean), [reactionSelfKey]);
  const botDmIds = useMemo(
    () => new Set(state.groups.filter((group) => group.dm && !group.peopleDm).map((group) => group.id)),
    [state.groups],
  );
  const rows = useMemo<ChatRows>(
    () => ({ botId: bot.id, threadId: bot.threadId, botName: bot.name, viewerName, voiceId: bot.voice, tts, localVoice, busy, hasMore, bots, mentionPeers, focus, showToolCalls, locale, dispatch, onBranch, reactionSelf, botDmIds, bubbleStyle }),
    [bot.id, bot.threadId, bot.name, viewerName, bot.voice, tts, localVoice, busy, hasMore, bots, mentionPeers, focus, showToolCalls, locale, dispatch, onBranch, reactionSelf, botDmIds, bubbleStyle],
  );
  // Where this conversation works, for the place icon on screen and page tools.
  const place = effectivePlace(bot, bot.tasks?.find((task) => task.threadId === bot.threadId));
  // The single stream (Show threads off): the live topic is this thread; the
  // topics before it are drawn above, under their dividers, once this one is
  // read back to its start (docs/single-stream-orchestration.md).
  const currentTask = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const streamOn = !side && !showThreads && Boolean(currentTask && isStreamSegment(currentTask));
  const streamHasEarlier = streamOn && segmentsAbove(bot.tasks, bot.threadId).length > 0;
  // A fresh topic drawn over this one (src/lib/fresh-topic.ts): an empty
  // topic, created on the server with its first message; this topic and the
  // earlier ones sit folded behind "Earlier topics".
  const freshDraft = useStoreSelector((current) => current.freshTopic[bot.id]);
  const fresh = streamOn && !preview && freshDraft?.threadId === bot.threadId && freshTopicCovers(bot, bot.threadId);
  const [previousOpenFor, setPreviousOpenFor] = useState<string | null>(null);
  const previousKey = `${bot.threadId}:${fresh ? "fresh" : "live"}`;
  const previousOpen = previousOpenFor === previousKey;
  const togglePrevious = useCallback(() => setPreviousOpenFor((current) => current === previousKey ? null : previousKey), [previousKey]);
  const resumeTopic = useCallback(() => dispatch({ type: "freshTopic", botId: bot.id, threadId: null }), [bot.id, dispatch]);
  // Coming back put the fresh topic there: it gives way the moment the topic
  // under it comes alive (another device's turn, an approval), never hiding
  // a live conversation. A New topic the person started stays.
  const queuedUnder = (state.pendingQueued[bot.threadId]?.length ?? 0) > 0;
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
  const streamFocus = useStoreSelector((current) => current.focusMessage);
  const streamFocusEarlier = streamHasEarlier && Boolean(streamFocus && !streamFocus.consumed && segmentsAbove(bot.tasks, bot.threadId).some((task) => task.threadId === streamFocus.threadId));
  const [streamShownFor, setStreamShownFor] = useState<string | null>(null);
  const reachEarlierTopic = useCallback((threadId: string) => {
    // Under a fresh topic, the activity it points at is shown as it is.
    dispatch({ type: "freshTopic", botId: bot.id, threadId: null });
    if (threadId === bot.threadId) {
      api(`/api/bots/${bot.id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
      return;
    }
    setStreamReach((current) => ({ threadId, nonce: (current?.nonce ?? 0) + 1 }));
    api(`/api/bots/${bot.id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
  }, [bot.id, bot.threadId, dispatch]);
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
  const streamEngine = state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId);
  const streamReadBack = streamHasEarlier && !olderPending && hiddenCount === 0 && !bot.hasMore;
  // Earlier topics are folded behind one "Earlier topics" line at the top of
  // the live topic, once it is read back to its start (JC 2026-10-18); the
  // line, a link, a search hit or the activity pill draws them.
  const streamDrawn = !fresh && streamHasEarlier && (previousOpen || streamFocusEarlier || streamReach !== null || streamShownFor === bot.threadId);
  const showPreviousLine = fresh || (streamHasEarlier && (streamDrawn || streamReadBack));
  // A link, a search hit or the activity pill into an earlier topic is a
  // jump up: bottom-follow would pull the pane back at the next growth.
  useEffect(() => {
    if (streamFocusEarlier || streamReach) stopFollowing();
  }, [streamFocusEarlier, streamReach, stopFollowing]);
  useEffect(() => {
    if (streamDrawn) setStreamShownFor(bot.threadId);
  }, [streamDrawn, bot.threadId]);
  // Leaving the topic (another bot, another thread) forgets it: coming back
  // waits for the live topic to be read back again.
  useEffect(() => () => setStreamShownFor(null), [bot.id, bot.threadId]);

  // one message at a time may be in edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => setEditingId(null), [bot.id, bot.threadId]);
  // stable handler identities — MessagesList is memo'd on them
  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const submitEdit = useCallback(
    (messageId: string, text: string) => {
      setEditingId(null); // closes the editor first — a double Enter can't fork twice
      dispatch({ type: "editMessage", botId: bot.id, threadId: bot.threadId, messageId, text });
    },
    [bot.id, bot.threadId, dispatch],
  );
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user" && m.kind === "text" && !peerLine(m)),
    [messages],
  );
  const lastUserMessageHasAttachments = useMemo(() => {
    if (!lastUserMessage?.text) return false;
    const cited = splitTranscriptCitations(lastUserMessage.text);
    const attached = splitTranscriptAttachments(cited.display);
    return cited.citations.length > 0 || attached.images.length > 0 || attached.files.length > 0;
  }, [lastUserMessage]);

  // Mascot while the turn works. Streaming stays invisible — when the reply
  // is finished, the whole bubble pops in above the mascot.
  // The working line reads the last real message: a finished call's record
  // (and a turn's receipts) can trail a turn that is still working.
  const lastMessage = lastNonReceipt(messages);
  const toolInFlight = lastMessage?.kind === "activity" && lastMessage.tool?.ok === undefined;
  const activity = liveActivityPhrases(lastMessage);
  const waiting = Boolean(
    bot.busy &&
      bot.activity !== "waiting-on-you" &&
      showWorkingDots(bot.busy, lastMessage),
  );
  const wasWaiting = useRef(false);
  const [popping, setPopping] = useState<string | null>(null);
  const poppingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
  }, []);
  useLayoutEffect(() => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = null;
    wasWaiting.current = false;
    setPopping(null);
  }, [bot.id]);
  useEffect(() => {
    if (waiting) wasWaiting.current = true;
  }, [waiting]);
  useLayoutEffect(() => {
    if (lastMessage?.role !== "bot" || lastMessage.kind !== "text" || !wasWaiting.current) return;
    wasWaiting.current = false;
    const messageId = lastMessage.id;
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    setPopping(messageId);
    poppingTimer.current = setTimeout(() => {
      poppingTimer.current = null;
      setPopping((current) => current === messageId ? null : current);
    }, 520);
  }, [lastMessage?.id, lastMessage?.role, lastMessage?.kind]);
  const presenceVisible = waiting || popping !== null;
  const announcement = useMemo((): TranscriptSnapshot => {
    const approval = pendingApprovals(messages)[0];
    return {
      busy: Boolean(bot.busy),
      reply: latestReply(messages, () => bot.name),
      failure: latestFailure(messages, () => bot.name),
      approval: approval ? { id: approval.requestId, name: bot.name } : undefined,
    };
  }, [messages, bot.busy, bot.name]);
  // Wall-clock anchor for the working row's elapsed readout — the server
  // stamps the turn's real start (turnStartedAt), so switching threads keeps
  // the count truthful; Date.now() only covers servers without the stamp.
  const [busySince, setBusySince] = useState<number | null>(null);
  useEffect(() => {
    setBusySince(bot.busy ? bot.turnStartedAt ?? Date.now() : null);
  }, [bot.busy, bot.id, bot.threadId, bot.turnStartedAt]);

  // regenerate = fork the last user message with the same text — reuses the
  // existing branch machinery, so the old answer stays reachable via ‹ ›
  const regenerate = useCallback(() => {
    if (lastUserMessage?.text && !bot.busy && !lastUserMessage.id.startsWith("optimistic-")) {
      dispatch({ type: "editMessage", botId: bot.id, threadId: bot.threadId, messageId: lastUserMessage.id, text: lastUserMessage.text });
    }
  }, [lastUserMessage, bot.busy, bot.id, bot.threadId, dispatch]);

  const currentLink = profile.tasks?.find((task) => task.threadId === bot.threadId)?.link;
  const threadLink = useMemo(() => canWrite !== false
    ? { link: currentLink, assign: (link: string | null) => dispatch({ type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { link } }) }
    : null, [canWrite, currentLink, bot.id, bot.threadId, dispatch]);

  const routineExecution = state.routineRuns.find((run) => run.target === "bot" && run.botId === bot.id && run.threadId === bot.threadId);
  const resultsThreadId = routineExecution?.resultsThreadId ?? routineExecution?.sourceThreadId;
  const canOpenResults = resultsThreadId && [...state.bots, ...state.groups].some((owner) => owner.threadId === resultsThreadId || owner.tasks?.some((task) => task.threadId === resultsThreadId));

  const Root = side ? "section" : "main";
  return (
    <ThreadLinkContext value={threadLink}>
    <ExchangeColumnProvider node={exchangeColumnNode}>
    <Root ref={exchangeColumnRef} aria-label={side?.label} data-side-chat={side ? "" : undefined} className="app-glow relative isolate flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* The older call mode covers the thread while the bot is on the line;
          a voice mode call docks at the top of the banner stack below */}
      {!side && <>
      <CallOverlay bot={bot} />
      {(macInset || browser) && <div className="content-topbar-strip" />}
      </>}
      {/* Header */}
      {side ? side.header : <div
        {...headerDragProps}
        className={cn(
          "content-topbar",
          // @container so the chips on the right can fold to icon bubbles
          // when the column is narrow (side panel open, small window)
          // Grok-style: no bar. The header floats over the transcript, which
          // scrolls under it; only the bot pill and the controls show.
          // Pulsatrix Light overrides `position` to `relative` (see
          // styles.css): a normal band, not a float, but still the
          // containing block the centered pill below needs.
          "@container/chathead absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center justify-end px-5 py-2.5",
          // Room for the drawer button, which overlays this corner below md.
          "pl-11 md:pl-5",
        )}
      >
        <div className="absolute left-1/2 top-1/2 flex max-w-[50%] -translate-x-1/2 -translate-y-1/2 items-center gap-2" style={headerNoDragStyle}>
          <BotHeaderPill
            name={bot.name}
            panelOpen={pillPanelOpen}
            onToggle={() => { for (const action of botPillActions(pillPanelOpen)) dispatch(action); }}
            avatar={
              <BotAvatar
                bot={bot}
                primary={isViewersPrimaryBot(bot, viewerActorId(state.config))}
                primaryRingClassName="ring-elevated"
                state={stateForBot({ ...bot, messages })}
                size={24}
                motion={mascotMotion?.kind ?? "none"}
                motionKey={mascotMotion?.nonce ?? 0}
                animated={mascotRowAnimated(bot, state.pendingQueued, mascotMotion?.kind)}
              />
            }
          />
          <TeammatesWorkingChip
            busy={bot.busy}
            waitingForTeammates={bot.waitingForTeammates}
            panelOpen={panelOpen}
            onOpen={() => dispatch({ type: "toggleSettings", open: true })}
          />
        </div>
        <div
          data-chathead-controls
          className="flex shrink-0 items-center gap-2 @max-[30rem]/chathead:ml-auto @max-[30rem]/chathead:flex-wrap @max-[30rem]/chathead:justify-end @min-[30rem]/chathead:col-start-3 @min-[30rem]/chathead:justify-self-end"
          // The caption buttons sit over the header's right end; drop this
          // icon row 16px (visual only — the header keeps its height) so the
          // buttons clear the 26px overlay while the rest of the layout stays.
          style={controlsShiftStyle}
        >
          {/* One "..." for the conversation: share and export, then the
              Inspector (Advanced) and Data (Experimental). The pill opens
              the bot's panel; while the panel is open its top bar carries
              this same menu. */}
          {!panelOpen && <ExportTranscriptMenu
            title={bot.name}
            messages={messages}
            botName={bot.name}
            onExportBot={showBotZipExport(state.config, bot) ? () => downloadBotZip(bot.id, { conversations: false, sharing: false }) : undefined}
            confidential={confidential}
            {...(!remoteClient && showInspector && advanced ? { onToggleInspector: () => dispatch({ type: "toggleInspector" }), inspectorOpen: state.inspectorOpen } : {})}
            {...(dataItem ? { data: dataItem } : {})}
          />}
          <DevPodsToggle bot={bot} />
          {!showThreads && <NewTopicButton bot={bot} />}
          <TaskPicker bot={bot} />
        </div>
      </div>}

      <div className="content-card-body flex min-h-0 flex-1 flex-col">
      {/* Banners sit below the floating header; the wrapper vanishes when
          none is showing so the transcript can run to the top. */}
      <div className="chat-banners pt-[52px] empty:hidden">
      {confidential && <ConfidentialBanner position="top" className="mb-2" />}
      {/* Voice mode's call pill: first in the stack, centered right under
          the name chip; collapsed it keeps its own small row, expanded its
          card hangs over the thread */}
      <VoiceCallDock bot={bot} />
      {!side && <>
      <BotActivityPicker bot={bot} />
      <ThreadsOffReturnLink bot={bot} />
      {streamOn && <EarlierTopicActivity bot={bot} onReach={reachEarlierTopic} includeCurrent={fresh} />}
      <ThreadReturnLink ownerId={bot.id} threadId={bot.threadId} />
      </>}
      {privateHint && <p data-private-conversation-hint className="mx-5 mb-2 text-[11.5px] text-ink-secondary">{t("chat.privateConversation")}</p>}
      {routineExecution && <div className="mx-5 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[11.5px] text-ink-secondary">
        <span className="min-w-0 flex-1 truncate">{t("routines.executionDetails", { name: routineExecution.routineName })}</span>
        {canOpenResults && resultsThreadId && <button type="button" onClick={() => openNotificationTarget(dispatch, { botId: bot.id, threadId: resultsThreadId }, state, showThreads)} className="rounded px-2 py-1 text-accent hover:bg-raised">{t("routines.results.back")}</button>}
        <button type="button" onClick={() => dispatch({ type: "showRoutines", section: "logs", routineId: routineExecution.routineId, botId: bot.id })} className="rounded px-2 py-1 hover:bg-raised hover:text-ink">{t("routines.logs")}</button>
      </div>}
      {findOpen && <ChatFindBar threadId={bot.threadId} {...(streamOn ? { threadIds: [bot.threadId, ...segmentsAbove(bot.tasks, bot.threadId).map((task) => task.threadId)] } : {})} onClose={() => setFindOpen(false)} />}

      {!side && <ChatErrorBanner message={state.error} onDismiss={() => dispatch({ type: "error", message: null })} />}
      {!side && <ChatNotice notice={state.notice} />}

      {/* Pinned message banner */}
      <PinnedBanner
        bot={bot}
        pinnedId={bot.pinnedMessageId}
        messages={messages}
        onJump={(messageId) =>
          dispatch({ type: "focusMessage", threadId: bot.threadId, messageId })
        }
        onUnpin={remoteClient ? undefined : () =>
          dispatch({ type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { pinnedMessageId: "" } })
        }
      />
      </div>


      {/* Messages + composer share one pane so bubbles scroll into the pill
          instead of dying on a rectangular clip above a black dock. */}
      <div className="relative min-h-0 flex-1">
      {/* Behind the transcript, which is positioned only while the field is
          on so it paints over the canvas (BackgroundEffectLayer.tsx). */}
      <BackgroundEffectLayer paneRef={scrollRef} effect={backgroundEffect} />
      <div
        ref={scrollRef}
        className={cn("h-full overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 [overflow-anchor:none]", backgroundEffect && "relative")}
        {...scrollHandlers}
      >
        <div
          ref={transcriptRef}
          inert={preview ? true : undefined}
          aria-busy={preview ? true : undefined}
          className="mx-auto flex w-full max-w-[960px] flex-col gap-3 pt-14"
          style={{ paddingBottom: composerDock.pad }}
          role="log"
          // off: a polite log re-reads every tick and chip while the bot
          // works; TranscriptAnnouncer below speaks once when it is done
          aria-live="off"
          aria-label={t("chat.conversationWith", { name: bot.name })}
        >
          {/* The single stream: earlier topics above the live one, once the
              live one is read back to its first message. */}
          {showPreviousLine && <PreviousTopicsLine open={fresh ? previousOpen : streamDrawn} onToggle={fresh || !streamDrawn ? togglePrevious : () => { setPreviousOpenFor(null); setStreamShownFor(null); clearStreamReach(); }} />}
          {streamDrawn && (
            <>
              <StreamEarlierTopics bot={bot} rows={rows} place={place} engine={streamEngine} scrollRef={scrollRef} followRef={followRef} reach={streamReach} onReached={clearStreamReach} onQuote={quoteEarlier} />
              {currentTask && <TopicDivider task={currentTask} />}
            </>
          )}
          {fresh && previousOpen && (
            <>
              <StreamEarlierTopics bot={bot} rows={rows} place={place} engine={streamEngine} scrollRef={scrollRef} followRef={followRef} reach={null} onReached={clearStreamReach} onQuote={quoteEarlier} includeCurrent />
              <FreshTopicDivider onResume={resumeTopic} />
            </>
          )}
          {fresh && !previousOpen && <EmptyChat bot={bot} />}
          {!fresh && <>
          {/* Reverse infinite scroll sentinel and smooth loading indicator */}
          {olderPending ? (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-ink-tertiary">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span>{t("chat.loadingEarlier")}</span>
            </div>
          ) : hiddenCount > 0 || bot.hasMore ? (
            <div ref={topSentinelRef} className="h-2 w-full pointer-events-none" aria-hidden="true" />
          ) : null}
          {windowedMessages.length === 0 && !bot.busy && (!streamHasEarlier || !streamDrawn) && <EmptyChat bot={bot} />}
          <ChatRowsContext.Provider value={rows}>
            <ConversationGalleryProvider>
            <MessagesList
              messages={windowedMessages}
              transcript={messages}
              lookups={lookups}
              place={place}
              pinnedMessageId={bot.pinnedMessageId}
              editingId={editingId}
              lastBotTextId={lastBotTextId}
              emergingId={popping}
              canRetryLast={!bot.busy && Boolean(lastUserMessage)}
              engine={state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId)}
              unreadDividerId={unreadDivider.messageId}
              unreadDividerFading={unreadDivider.fading}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSubmitEdit={submitEdit}
              onRegenerate={regenerate}
              onReply={selectReply}
              seen={seenRow}
            />
            </ConversationGalleryProvider>
          </ChatRowsContext.Provider>
          {laterCount > 0 && (
            <div className="flex justify-center">
              <button
                onClick={showLater}
                className="ui-pill"
              >
                {t("chat.showLater", { count: laterCount })}
              </button>
            </div>
          )}
          {/* The latest turn needed an app that is not connected
              (src/lib/connect-apps-signal.ts): Connect apps, on those apps. */}
          <ConversationConnectApps botId={bot.id} messages={messages} busy={Boolean(bot.busy)} />
          </>}
          {computerStarting && (
            <div className="flex justify-start">
              <div className="ui-pill">
                <WorkingDots size={3.5} />
                {computerStarting}
              </div>
            </div>
          )}
          <TurnPresence
            ultracode={ultracodeFromSelection(bot.modelSelection)}
            avatar={
              // BotAvatar, not a bare MausAvatar: an uploaded profile image
              // (and a chosen mascot body) must match the sidebar row.
              <BotAvatar
                bot={bot}
                state={toolInFlight ? "working" : "thinking"}
                size={36}
                forward={false}
                lookAround={1}
                trackPointer={false}
              />
            }
            visible={presenceVisible}
            phrases={activity.phrases}
            phase={activity.phase}
            seed={`${bot.id}:${bot.threadId ?? ""}:${busySince ?? ""}`}
            answering={popping !== null}
            since={busySince}
          />
        </div>
      </div>

      <TranscriptAnnouncer threadKey={transcriptKey} snapshot={announcement} />

      {/* Dev context pods (Settings > Experimental): an overlay in the
          pane's top-right corner; the transcript above never moves. */}
      <DevPods bot={bot} messages={messages} composerHeight={composerDock.height} computerStart={state.computerStarts[bot.id]} dispatch={dispatch} />

      {/* Reading scrollback — one tap back to the end, streaming or not */}
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

      {/* Keyed by task: each conversation keeps its own draft and a failed
          request can restore the old task without spilling into the newly
          selected one. ArrowUp-to-edit stays gated on busy because editing
          rewinds the thread, which a live turn forbids (the server 409s it). */}
      <div ref={composerDockRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
      {/* The bot's run in this ask as a checklist, once it is worth one (a
          verified step, or more than one command). Save fills this thread's
          composer with the run and the person's request and hands the caret
          over; the person adds context and sends — nothing is sent from
          here. In the dock so its height is measured with the composer's:
          the transcript pad, the jump pill and bottom-follow all move with
          it. */}
      {lastRunStep && showRun(recordedRun) && showRunCard && runDismissed.get(transcriptKey) !== lastRunStep.id && (
        <div className="flex justify-end px-5 pb-2">
          <VerifyCard
            key={transcriptKey}
            steps={recordedRun}
            canSave={canSaveRun}
            skill={runSkill(messages, recordedRun)}
            onDismiss={() => setRunDismissed((current) => new Map(current).set(transcriptKey, lastRunStep.id))}
            onSave={() => {
              appendComposerDraft(`bot:${bot.id}:${bot.threadId}`, skillPrompt(recordedRun, askText(messages)));
              composerDockRef.current?.querySelector("textarea")?.focus();
            }}
          />
        </div>
      )}
      {confidential && <ConfidentialBanner position="bottom" className="mb-1" />}
      {canWrite === false ? (
        <NewConversationInstead onNew={() => dispatch({ type: "newTask", botId: bot.id })} />
      ) : (
      <Composer
        key={bot.threadId}
        bot={profile}
        replyTo={replyTo}
        onClearReply={clearReply}
        onConsumeReply={consumeReply}
        onRestoreReply={restoreReply}
        onEditLast={lastUserMessage && !lastUserMessageHasAttachments && !bot.busy && !lastUserMessage.id.startsWith("optimistic-")
          ? () => setEditingId(lastUserMessage.id)
          : undefined}
      />
      )}
      {canWrite !== false && (
      <CitationSelectionToolbar
        key={`${bot.id}:${bot.threadId}`}
        viewportRef={scrollRef}
        onAdd={(citation) => appendDraftAttachments(`bot:${citation.source.ownerId}:${citation.source.threadId}`, [citation])}
      />
      )}
      </div>
      </div>
      </div>

    </Root>
    </ExchangeColumnProvider>
    </ThreadLinkContext>
  );
}

/** In place of the composer, for a guest on an OMB Cloud home in a
 * conversation it did not open: it can only start its own. One click, no
 * dialog. */
export function NewConversationInstead({ onNew }: { onNew: () => void }) {
  return (
    <div className="pointer-events-auto mx-5 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-hairline/60 bg-raised px-4 py-3" data-testid="cloud-guest-composer">
      <p className="text-[13px] text-ink-secondary">{t("chat.cloudGuest.notYours")}</p>
      <button type="button" onClick={onNew} className="shrink-0 rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink">
        {t("chat.cloudGuest.newConversation")}
      </button>
    </div>
  );
}

