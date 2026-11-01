// Server-backed store. The React app holds no transports of its own:
// it dispatches typed commands over HTTP and folds the one SSE event
// stream from the harness server into local state. The reducer stays
// pure; everything async lives in the wrapped dispatch + SSE fold.
import { devPodsTurnField } from "@/components/dev-pods/prefs";
import { appendDraftAttachments, restoreComposerDraft } from "@/lib/drafts";
import { citationAttachment, CITATION_MAX_QUOTE_LENGTH } from "@/lib/citations";
import { beginLocalSend, claimInFlightSend, finishSend } from "@/lib/send-cancel";
import { receiveThreadReadFrame } from "@/lib/read-receipts-feed";
import { personaCategoryForSection } from "@/lib/persona-sections";
import { withPrimaryBot } from "@/lib/primary-bot";
import { currentSettingsSection } from "@/lib/settings-sections";
import type { AppSettingsSection, BotSettingsSection } from "./settings-section";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  startTransition,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { ROUTINE_CONVERSATION_HEADER } from "../../shared/wire";
import type { BotVisibility, CardAnswerer, CloudBackend, EffortLevel, InstalledPackageMetadata, LiveCallState, LiveSettings, ServerFrame, GroupThreadUsage, SteerQueueReason, VoiceCallMark, WireBotConversation, WireWaitingApproval } from "../../shared/wire";
import { DATA_ROUTES, dataSheetKey, withDataThread, type DataSheet, type DataTable } from "../../shared/data-surface";
import type { ModelListIssue } from "../../shared/azure-openai";
import type { TurnDigest } from "../../shared/digest";
import type { MessageReaction } from "../../shared/reactions";
import type { AutoModelRecord } from "../../shared/auto-model";
import type { BusySendRequest, ParallelTaskRef, TaskParallelOf } from "../../shared/parallel-tasks";
import type { ToolScope } from "../../shared/tool-scope";
import type { AchievementCategory } from "../../shared/achievements";
import type { ViewerCapabilities } from "../../shared/viewer-capabilities";
import type { ModelVariantOption, RuntimeEvent } from "../../shared/runtime-events";
import type { MausColor, MausMotion } from "@/lib/mascot";
import type { BotAvatarCrop } from "../../shared/bot-avatar";
import type { BotPublicProfile } from "../../shared/bot-public-profile";
import { approvalModeFor, botApprovalSetting, threadApprovalFields, type ApprovalMode } from "../../shared/approval-mode";
import type { ProactiveMode } from "../../shared/proactive-mode";
import { uiCommandToAction } from "../../shared/bot-act";
import { onNudgeReceived, onNudgeSent, onNudgeSentEcho } from "@/lib/desktop-nudge";
import { sameModelSelection } from "../../shared/thread-model";
import { applyPresenceFrame } from "@/lib/presence";
import { receiveOrgApprovalsFrame } from "@/lib/org-approvals";
import { VOICE_CALL_ENDED_EVENT } from "@/lib/voice-mode/call-end";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import type { MascotSkinId } from "../../shared/mascot-skins";
import type { QuestionRequestCardData } from "../../shared/ask-question";
import { proactiveProposalAccepts } from "../../shared/proactive-proposal";
import type { ProfileRequestCardData } from "../../shared/profile-request";
import type { ModelRequestCardData } from "../../shared/model-request";
import type { RoutineRequestCardData } from "../../shared/routine-request";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { GroupGoalRunCardData } from "../../shared/group-goal-run";
import type { PlaceRow } from "../../shared/place-view";
import {
  reviewedSkillSha256,
  skillRequestBehavior,
  type SkillRequestCardData,
} from "../../shared/skill-request";
import { terminalRequestBehavior } from "../../shared/terminal-request";
import { meetingRequestBehavior } from "../../shared/meeting-request";
import type { Routine, RoutineInput, RoutineRun, RoutineRunStatusFilter } from "@/lib/routines";
import { createAnswerErrorMessage, recoverCreatedRoutineAfterLostAnswer } from "@/lib/routine-save-recovery";
import type { WebhookAttempt, WebhookIngressStatus, WebhookTrigger } from "@/lib/webhooks";
import type { GraphConnectorOption } from "../../shared/trigger-sources";
import { botShowsUnread } from "@/lib/bot-unread";
import { firstUnreadMessageId, threadOpensUnread, threadReadCursor } from "@/lib/unread-divider";
import type { ComputerStart } from "@/lib/computer-start";
import { answerResponse, dismissResponse } from "@/lib/card-answer";
import { currentCall, voiceCallId } from "@/lib/call";
import { forgetConversation, readLastConversation, rememberConversation } from "@/lib/last-conversation";
import { fallbackSelection, selectionListed, selectionNewlyHidden } from "@/lib/selection-fallback";
import { hiddenKeySet, readSidebarHidden, useSidebarHidden } from "@/lib/sidebar-hidden";
import { readLastBotSection, rememberBotSection } from "@/lib/last-bot-section";
import { approvalWithdrawKey, showNotification, withdrawNotification, type NotificationTarget } from "@/lib/notify";
import { singleStreamTurnField, useShowThreads } from "@/lib/thread-preferences";
import { isEarlierSegment, isStreamSegment, opensBesideConversation, streamHomeThread, streamUnreadReadWith } from "@/lib/single-stream";
import { openSideThread } from "@/lib/side-thread";
import { freshTopicLanding, noteBackAtBot, noteLeftBot, onScreenBot, setOnScreenBot } from "@/lib/fresh-topic";
import { speaker } from "@/lib/tts";
import { roleProfilePatch, type BotRole } from "@/lib/bot-roles";
import { t, activeLocale } from "@/lib/i18n";
import { isNoRouteText, neutralNoRoute } from "@/lib/no-route";
import { loadServerFeatures, noteRoutinesListing } from "@/lib/server-features";
import { teamMemorySettled } from "@/lib/team-memory-settled";
import { forgetStepUp, recentStepUp, stepUp, stepUpApprovals } from "@/lib/step-up-client";
import type { StepUpTarget } from "../../shared/step-up";
import { permissionMissingMessage } from "@/lib/permissions";
import { engineErrorMessage } from "@/lib/engine-error-text";
import { teamSetupErrorMessage } from "@/lib/team-setup-error-text";
import { serverErrorMessage } from "@/lib/server-error-text";
import { createBotPatchQueue, type BotUpdatePatch } from "./bot-patch-queue";
import { useChatErrorClear } from "./chat-error";
import type { OnboardingStatus } from "@/lib/onboarding";
import { openLiveEvents, publishLiveFrame, publishMissedFrames } from "@/lib/live-events";
import { receiveAchievementsFrame } from "@/lib/achievements";
import { migrateInstalledVoiceSettings } from "@/lib/voice-mode/settings";
import { announceServerPreferences, applyBotPreference } from "@/lib/user-preferences-sync";
import { receiveDeviceSettingsFrame } from "@/lib/device-settings-app";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { applyPersonLabel } from "@/lib/person-labels";
import { announcePersonAvatar, withViewerAvatar } from "@/lib/person-avatars";
import { StoreSourceContext, usePublishedStoreSource } from "./store-source";
import { ThreadPrefetchContext } from "./thread-prefetch";
import { createThreadPrefetcher, ThreadPageCache, type ThreadPage } from "@/lib/thread-page-cache";
import { ARTIFACTS_EVENT } from "@/lib/artifact-events";
import { BOT_TASKS_EVENT } from "@/lib/bot-task-events";
import { makeConfidentialBody } from "@/lib/confidential-thread";
import { bindModerationApi, blockedDmSender, notifyReportsChanged } from "@/lib/moderation";
import { readableError } from "@/lib/plain-error";
import { shouldSuppressDeployOutageError } from "@/lib/deploy-reconnect";

bindModerationApi(api);

const MAX_ROUTINE_RUNS = 2_000;
const ACTIVE_ROUTINE_RUN_STATUSES = new Set<RoutineRun["status"]>(["queued", "running", "waiting"]);

function trimRoutineRuns(runs: readonly RoutineRun[]): RoutineRun[] {
  const sorted = [...runs].sort((a, b) => b.scheduledFor - a.scheduledFor);
  if (sorted.length <= MAX_ROUTINE_RUNS) return sorted;
  const activeCount = sorted.reduce(
    (count, run) => count + (ACTIVE_ROUTINE_RUN_STATUSES.has(run.status) ? 1 : 0),
    0,
  );
  let terminalSlots = Math.max(0, MAX_ROUTINE_RUNS - activeCount);
  return sorted.filter((run) => {
    if (ACTIVE_ROUTINE_RUN_STATUSES.has(run.status)) return true;
    if (terminalSlots === 0) return false;
    terminalSlots -= 1;
    return true;
  });
}

export type { MausColor } from "@/lib/mascot";
export type { RoutineRunCardData } from "../../shared/routine-run";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  /** 2026-10-30: a proactive proposal; answered through its own route
   * (shared/proactive-proposal.ts), options[0] accepts. */
  proactiveProposal?: { id: string };
  /** Organization server: only an organization admin can answer this card
   * (a server command asked by a member's bot). */
  adminApproval?: boolean;
  /** Who can answer an adminApproval card: the organization admins' names. */
  adminNames?: string[];
  /** Distinguishes a provider question from an approval after its live run ends. */
  requestType?: "permission" | "question";
  /** what each option means, keyed by its label — a question that came with
   * explanations (AskUserQuestion) shows them under the buttons. Kept beside
   * `options` rather than inside it so every existing reader of the plain
   * label list — the phone, call-mode narration, the sidebar preview — keeps
   * working untouched. */
  optionHints?: Record<string, string>;
  /** the question takes more than one option; `answered` is then the chosen
   * labels joined with ", ", which is the format the asking tool expects */
  multiSelect?: boolean;
  answered?: string;
  /** The words an answered question card was answered with — `answered`
   * only holds the behavior once the server settles a live ask. */
  answeredText?: string;
  /** Who settled the card; `via: "call"` when it was decided by voice on a Live call. */
  answeredBy?: CardAnswerer;
  dismissed?: boolean;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  /** permission asks: the tool being requested (drives the approval box) */
  tool?: string;
  /** why auto mode stopped to ask anyway */
  held?: string;
  /** Terminal: this proposal went stale while open (revision mismatch or
   * a superseding request). Nothing can answer it; a fresh proposal is
   * needed, and clients must not offer its options. */
  expired?: boolean;
  /** catalog key for `held` when it is a fixed note, so it reads in the
   * viewer's language; absent for free-text errors and older cards */
  heldCode?: string;
  /** the server's plain words for a permission card (shared/approval-describe.ts) */
  plain?: { title: string; line: string; risk?: "read" | "write" | "destructive" | "execute" };
  /** the engine's own `<server>__<tool>` when `tool` is only a kind */
  mcpTool?: string;
  /** declined by the server at this time when nobody answers */
  expiresAt?: number;
  /** the narrow grant "always allow" remembers, e.g. "Bash:git" */
  allowKey?: string;
  /** 2026-10-14 (bot owner permissions): the rule "Always allow" or
   * "Always deny" would save for the bot's owner: the tool, its target
   * read from the arguments, the destructive kind and plain words. */
  ownerRule?: { tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string; from?: "admin" | "hold" | "origin" };
  /** 2026-10-26 (#1065): the second "Always allow", the whole folder of the file this card reads (and its subfolders). */
  ownerRuleFolder?: { tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string; writes?: boolean; from?: "admin" | "hold" | "origin" };
  /** The person's own "Ask first" rule that kept this card (shared/wire.ts). */
  heldRule?: { description: string };
  /** The owner's rule saved when answering this card. */
  ruleSaved?: { id: string; behavior: "allow" | "ask" | "deny"; description: string };
  /** the Allow rule saved when this card was answered (server/index.ts) */
  alwaysAllowed?: string;
  allowSession?: boolean;
  /** A permission ask's full arguments as redacted JSON, shown only in
   * the card's collapsed technical details. */
  toolInput?: string;
  /** MCP tool annotations, when the provider passes them on. */
  toolHints?: { readOnly?: boolean; destructive?: boolean };
  /** Exact provider command eligible for a durable, folder-scoped allow. */
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  approvalScope?: "local-computer";
  /** The bot's change applied without a person (a change to itself, or Full
   * access): shown as one line with Undo instead of the approval box. */
  autoApplied?: boolean;
  /** A person undid that change. */
  undone?: boolean;
  /** Persisted proposal used by the server when the user confirms it. */
  routineRequest?: RoutineRequestCardData;
  /** Staged learned-skill change; applied only after the user confirms this card. */
  skillRequest?: SkillRequestCardData;
  /** calls: one per outbound call the card covers, in subtitle order. Absent
   * on cards from older computers. */
  outboundRequest?: { tool: string; app: string | null; calls?: Array<{ app: string | null; label: string }> };
  teamMemoryRequest?: { section: string; entryId: string; kind: string };
  /** Persisted profile proposal used by the server when the user confirms it. */
  profileRequest?: ProfileRequestCardData;
  /** Persisted default-model proposal used by the server when the user confirms it. */
  modelRequest?: ModelRequestCardData;
  teamSetupRequest?: import("../../shared/team-setup").TeamSetupRequest;
  /** The model's own questions and options (Claude's AskUserQuestion), so
   * the card offers choices instead of an unanswerable Allow/Deny. */
  questionRequest?: QuestionRequestCardData;
  /** A bot action waiting for this person's Allow. The id matches requestId. */
  botActRequest?: { id: string };
  /** Shell terminal: opened only after the person taps Ouvrir un terminal. */
  terminalRequest?: import("../../shared/terminal-request").TerminalRequestCardData;
  /** A meeting the bot asks to join as a notetaker (join_meeting). */
  meetingRequest?: import("../../shared/meeting-request").MeetingRequestCardData;
  /** A change asked from a ConnectWise widget (shared/wire.ts). */
  cwActionRequest?: import("../../shared/wire").OptionCardData["cwActionRequest"];
  /** 2026-10-16: custom rules (shared/custom-rules.ts) and email draft sends. */
  customRule?: import("../../shared/wire").OptionCardData["customRule"];
  /** The model reviewer is still judging this card (lot A1b). */
  reviewing?: boolean;
  customRuleCandidate?: import("../../shared/wire").OptionCardData["customRuleCandidate"];
  customRuleSaved?: import("../../shared/wire").OptionCardData["customRuleSaved"];
  emailSendRequest?: import("../../shared/wire").OptionCardData["emailSendRequest"];
}

export interface SecretRequestCardData {
  /** vaultLogin: a login request from the credential vault (carries `vault`). */
  target: import("../../shared/credential-request").CredentialTargetId | import("../../shared/credential-vault").VaultLoginTarget;
  vault?: import("../../shared/credential-vault").VaultRequestCardData;
  label: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  requestKey: string;
  provided?: boolean;
  dismissed?: boolean;
  /** A newer request for the same credential replaced this card; it no
   * longer offers entry and cannot be provided or dismissed. */
  superseded?: boolean;
  resumed?: boolean;
  error?: string;
}

export interface Message extends Pick<import("../../shared/wire").WireMessage, "widget" | "app" | "routineToggle" | "pagePublish" | "requested" | "outbound" | "dataContext" | "roster"> {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "video" | "secret" | "routine.run" | "goal.run" | "digest" | "compaction" | "access" | "nudge" | "call" | "widget" | "app" | "routines" | "roster";
  text?: string;
  /** An accepted nudge. Drawn per viewer from these names, not as a bubble.
   * `groupId` is set when the line belongs to that group chat. */
  nudge?: { fromId: string; fromName: string; toId: string; toName: string; groupId?: string };
  /** access messages: a turn that could not run on this organization server. */
  access?: import("../../shared/wire").WireAccessCard;
  /** digest messages: what the turn did, rendered in `text` and structured here. */
  digest?: TurnDigest;
  compaction?: import("../../shared/wire").WireMessage["compaction"];
  /** Files attached to this assistant response: provider-generated images, and
   * voice notes, documents, audio and video a bot attached with attach_file. */
  attachments?: import("../../shared/wire").WireMessage["attachments"];
  card?: OptionCardData;
  /** Inline xterm session after a terminal request was allowed. */
  terminalEmbed?: import("../../shared/terminal-resources").TerminalEmbed;
  /** Tailcat remote-support card. The tunnel address is never on this object. */
  remoteSession?: import("../../shared/remote-session").RemoteSessionView;
  /** Live usage card (shared/resource-usage.ts), shown only when asked. */
  resourceUsage?: import("../../shared/resource-usage").ResourceUsageView;
  /** "Connect Microsoft Teams" card (shared/connector-setup.ts). */
  connectorSetup?: import("../../shared/connector-setup").ConnectorSetupView;
  secret?: SecretRequestCardData;
  /** Lifecycle mirror for a routine whose real work lives in a fresh task. */
  routineRun?: RoutineRunCardData;
  /** Durable lifecycle receipt for a goal-driven channel run. */
  goalRun?: GroupGoalRunCardData;
  /** call rows: one finished Live call (its id, times and length, and a
   * title when the bot's engine named it). Never anything said on it. */
  call?: import("../../shared/wire").LiveCallRecord;
  /** How a channel user message should be handled. Absent means ordinary chat. */
  channelMode?: "chat" | "goal";
  /** activity messages: tool name + outcome. `spoken` is the server's
   * narration of the same chip ("reading a file"), used by call mode. */
  /** `setup` marks an error fixed by installing something, not by retrying.
   * `summary` is the call's input on one redacted line (the shell command). */
  tool?: { name: string; ok?: boolean; spoken?: string; setup?: boolean; claudeUpdate?: boolean; place?: PlaceRow; summary?: string; input?: string; output?: string ; durationMs?: number; /** The product the server declared for the tool, and the id its tool names start with (shared/wire.ts). */ product?: string; productId?: string; itemId?: string; outputPath?: string; fullResult?: boolean; /** Files the call wrote (shared/wire.ts). */ files?: string[]; widget?: import("../../shared/cw-widgets/types").CwWidget; ruleNotice?: import("../../shared/custom-rules").CustomRuleNotice; /** What answered the call's ask with no card (shared/wire.ts). */ autoApproval?: { source: string; rule?: string }; engineMove?: import("../../shared/offered-engines").OrgEngineMove; limitFailover?: import("../../shared/limit-failover").LimitFailoverLine; connectorSwitch?: { engine: string; connector: string }; soloGoal?: import("../../shared/solo-goal-line").SoloGoalLine; finishUntil?: import("../../shared/finish-until-line").FinishUntilLine; /** The step the working line names (shared/working-step.ts). */ step?: import("../../shared/working-step").WorkingStep };
  /** user messages sent into a running turn — the model saw it mid-turn */
  steered?: boolean;
  /** a user message that did not come from typing here: through the
   * server's API, spoken during a Live call, or texted from the person's
   * own number. */
  via?: "api" | "call" | "sms";
  /** Words said on a voice call. The thread draws every turn of one callId
   * as a single card; the send itself stays an ordinary message. */
  voiceCall?: VoiceCallMark;
  /** user messages: the signed-in person who sent it. Absent for the
   * operator's own sends (see shared/wire.ts). */
  sender?: import("../../shared/wire").WireMessage["sender"];
  /** user lines spoken on a Live call: which call (only with via "call"). */
  callId?: string;
  /** The user line whose turn produced this message (activity, cards and
   * answers), when the server could prove it. */
  requestMessageId?: string;
  /** Provider turn that produced this message. */
  turnId?: string;
  /** What the turn that wrote this reply ran on; no effort = engine default. */
  turnRun?: { instanceId: string; model: string; effort?: EffortLevel; requested?: { instanceId: string; model: string } };
  /** Last assistant text item from a settled provider turn. */
  turnTerminal?: boolean;
  /** screen messages: the server holds a frame of the bot's computer,
   * served by `/api/threads/:threadId/messages/:id/image`. */
  hasImage?: boolean;
  /** screen messages in the full (unpaged) shape: the same frame, inline as
   * base64. Shown through the image route all the same. */
  png?: string;
  mime?: string;
  /** kind "video": inline player payload. */
  video?: import("../../shared/video-widget.ts").WireVideoWidget;
  at: number;
  /** the message this one follows; null = thread root. Edited messages
   * share a parentId with the version they replace — that's a fork. */
  parentId?: string | null;
  /** Flat reply reference for an inline quote; unrelated to branch ancestry. */
  replyToId?: string;
  /** Stable client identity for at-most-once chat POST retries. */
  sendId?: string;
  /** rooms: which member said this (sender attribution). */
  from?: { botId: string; name: string; color: MausColor };
  /** a user-role line another bot delivered into this conversation
   * (ask_bot, delegate_bot, start_thread): the words are that bot's, not
   * the person's. Rendered as the peer speaking — see lib/peer-message. */
  peerAsk?: { botId: string; name: string; unattended?: boolean };
  /** #291: a line a person's AI client sent (send_prompt): not the person
   * typing. Folded with the bot's answer into one exchange chip. */
  aiClient?: true;
  /** Auto: the model this delivered work ran on (the delegation card and the
   * worker's activity row). */
  autoModel?: AutoModelRecord;
  /** coordinate_bots delivery identity, as stored: the request a teammate
   * sent into this thread, or the result it reported back. */
  roomRequest?: { id: string; phase: "request" | "result" };
  /** Emoji reactions, one entry per emoji with who put it there
   * (shared/reactions.ts; read through normalizeReactions). */
  reactions?: MessageReaction[];
  /** comm chips: "Messaged @X" linking to the bot⇄bot channel. */
  comm?: { groupId: string; threadId?: string; withBotId: string; withName: string; withColor: MausColor; gone?: boolean; direction?: "sent" | "received"; text?: string };
  /** thread chips: "Opened thread #Title on Bot" linking to that thread */
  threadRef?: { botId: string; threadId: string; title: string; gone?: boolean };
  /** A teammate parked on a question for the person (WireMessage.inputRequest). */
  inputRequest?: import("../../shared/wire").WireMessage["inputRequest"];
  /** A parallel task this line belongs to (shared/parallel-tasks.ts). */
  parallelTask?: ParallelTaskRef;
  dataResult?: import("../../shared/wire").WireMessage["dataResult"];
  /** sent while the bot was mid-turn; auto-sends when the turn settles.
   * Rendered only while the bot is busy, so a flag stranded by a server
   * restart never shows a promise nothing will keep. */
  queued?: boolean;
  /** steer-queue entry this drained user line came from. Pending chips
   * match on this id, not on equal text. Absent on ordinary sends. */
  queueId?: string;
  /** Projected for someone who is not the approval audience. */
  state?: "waiting-on-owner" | "owner-settled";
  ownerName?: string;
  /** A dropped worker, or a person or bot removed during the turn. */
  status?: "failed";
  /** Auto rooms: the decision model picked this reply's speaker. */
  routedBy?: import("../../shared/wire").WireMessage["routedBy"];
}

export type GroupDefaultResponder = import("../../shared/wire").GroupDefaultResponder;

/** A room: several bots + you in one shared thread. */
export interface Group {
  usage?: GroupThreadUsage | null;
  id: string;
  threadId: string;
  name: string;
  memberIds: string[];
  /** People in this channel, beside the bots. Absent on a bot-to-bot dm. */
  humanIds?: string[];
  defaultResponder: GroupDefaultResponder;
  bulletin: string;
  unread: boolean;
  /** Kept in the home's pinned row, like a bot. Only true is a pin. */
  pinned?: boolean;
  /** The newest message on screen the last time the person read this
   * conversation. The New divider goes after it. */
  lastReadMessageId?: string;
  createdAt: number;
  /** auto-created bot⇄bot channel (ask_bot exchanges mirror here) */
  dm?: boolean;
  /** A direct conversation between two people (server/people-dms.ts). */
  peopleDm?: boolean;
  /** The group's shared memory; absent = on. */
  memoryEnabled?: boolean;
  /** A room: @all notifies every person in it (server/room-mentions.ts). */
  mentionAll?: boolean;
  /** #1137: per bot of this room, who pays for its replies here. */
  botPayers?: Record<string, "owner" | "speaker">;
  busyBotId?: string | null;
  /** when the busy member's turn started — the group-side twin of a task's
   * turnStartedAt; stamped by the server when the speaker claims the turn */
  turnStartedAt?: number | null;
  /** A direct conversation keeps its turn numbers here. A channel keeps them on the task. */
  turnTiming?: { queueMs?: number; firstResponseMs?: number };
  /** True for the whole orchestrated run, including hand-offs between members. */
  working?: boolean;
  /** Every bot in the room as each person in it sees it, whoever owns it
   * (shared/bot-public-profile.ts): read through groupMemberBots. */
  memberProfiles?: BotPublicProfile[];
  /** the room's shared desk — where member turns run their shell tools,
   * overriding each member's own folder; absent = each member's own */
  cwd?: string;
  /** folder the room's turns actually run in, pinned on the first turn;
   * null = each member's own default; absent = not pinned yet */
  pinnedCwd?: string | null;
  /** the one message pinned to the top of this room's transcript */
  pinnedMessageId?: string;
  /** sidebar section heading this room is filed under (shared with bots) */
  section?: string;
  /** Organization server: who owns the settings (null: its admins). Absent
   * on a solo server (src/lib/group-owner.ts). */
  ownerId?: string | null;
  /** Set at creation: rooms have no pending setup step any more. */
  setupCompletedAt?: number | null;
  setupSkippedAt?: number | null;
  /** A direct-message conversation's turn ceiling. Null or absent uses the
   * global group limit. Channel conversations store theirs on each task. */
  turnTimeoutMinutes?: number | null;
  /** Separate conversations in this channel. DMs deliberately stay on one
   * thread and omit this collection. A conversation with a person has them
   * like a bot (server/people-dms.ts). */
  tasks?: GroupTask[];
  /** Folders of a person conversation's threads, in sidebar order. */
  projects?: BotProject[];
  messages: Message[];
  /** The server answered a bounded page and older messages remain in storage.
   * Absent on an unpaged response, which always carries the whole thread. */
  hasMore?: boolean;
}

/** One of a channel's independent conversations. The channel's threadId
 * points at the active one; folder and pin state belong to the task. */
export interface GroupTask {
  threadId: string;
  title: string;
  createdAt: number;
  pinnedCwd?: string | null;
  pinnedMessageId?: string;
  /** The person pinned this channel thread. Only true is a pin. */
  pinned?: boolean;
  /** Newest message time, or createdAt. Server-derived. */
  updatedAt?: number;
  /** This conversation's turn ceiling, in whole minutes. Absent uses the
   * global group limit. */
  turnTimeoutMinutes?: number;
  /** Archived, snoozed and filed, as a bot thread is (a person
   * conversation's threads use these). */
  archivedAt?: number;
  snoozedUntil?: number;
  projectId?: string;
  /** A person conversation: this thread is unread for the viewer. */
  unread?: boolean;
  /** A person conversation: the thread it was before threads ("General"). */
  general?: true;
  /** Whether a turn is actively running in this thread. */
  working?: boolean;
  /** The member bot currently speaking or generating in this thread, if any. */
  busyBotId?: string | null;
  turnTiming?: { queueMs?: number; firstResponseMs?: number };
}

export interface ModelSelection {
  instanceId: string;
  model: string;
  effort?: EffortLevel;
  variant?: string;
  /** Auto (docs/plans/2026-10-08-auto-model.md): each turn picks its model;
   * instanceId and model stay the bot's engine and fallback. */
  auto?: true;
  fast?: { instanceId: string; model: string };
}

/** One of a bot's separate contexts: its own thread, transcript and
 * provider session. The bot's threadId points at the active one. */
export interface Task {
  waitingForTeammates?: boolean;
  threadId: string;
  /** Internal routine execution; reachable through its run receipt, not history menus. */
  routineRunId?: string;
  /** An automatic "<routine> · Results" thread: listed with threads shown,
   * never a stream segment, a row under the bot or a dot (2026-10-22). */
  routineResults?: true;
  /** An AI client's hidden conversation (#291): the server lists it only
   * while it is the open thread; never a dot, a preview or typing dots. */
  hidden?: true;
  /** A confidential thread (src/lib/confidential-thread.ts): never
   * remembered, exported or shared beyond its owner. Permanent once set. */
  confidential?: true;
  projectId?: string;
  title: string;
  createdAt: number;
  /** The person pinned this thread above the update-ordered list. */
  pinned?: boolean;
  link?: string;
  /** Newest message time, or createdAt. Server-derived; local bumps use max. */
  updatedAt?: number;
  /** Wait before send, and wait until the first answer text. Not message text. */
  turnTiming?: { queueMs?: number; firstResponseMs?: number };
  /** what this task has spent, banked once per settled turn */
  usage?: TaskUsage;
  /** folder this task's turns run in, pinned on its first turn; null =
   * legacy home-folder session; absent = not pinned yet */
  cwd?: string | null;
  /** The model this thread runs on: its own when a person picked one here,
   * else its bot's (followsBotModel). */
  modelSelection?: ModelSelection;
  /** Auto: the model the last turn here ran on, and why. Server-derived. */
  autoModel?: AutoModelRecord;
  /** true: runs on its bot's model and moves with it; false: a model a person
   * picked in this thread. Absent from servers older than the field. */
  followsBotModel?: boolean;
  /** Present only with approvalOwn: the thread follows its bot's level, live (#1169). */
  approvalMode?: ApprovalMode;
  autoApprove?: boolean;
  alwaysAllow?: string[];
  /** Why this thread keeps its own approval level (WireTask.approvalOwn). */
  approvalOwn?: import("../../shared/approval-mode").ApprovalException;
  activity?: Bot["activity"];
  busy?: boolean;
  /** Epoch ms when this task's current turn became busy; the chat's elapsed
   * readout anchors here so it survives thread switches. Absent while idle. */
  turnStartedAt?: number;
  unread?: boolean;
  /** The newest message on screen the last time the person read this
   * conversation. The New divider goes after it. */
  lastReadMessageId?: string;
  pinnedMessageId?: string;
  /** where this conversation works, when pinned: by the person from the
   * composer, or by its first Auto turn to the place it reached. Wins over
   * the bot's Works on (except Off); absent = follows the bot. */
  surface?: "cloud" | "vm" | "local" | "browser";
  /** true when that pin is the machine's own record (an Auto turn's landing
   * place or the bot's select_computer choice), which the next Works on
   * change moves; absent on a person's pin or one older than the server's
   * record of who set it. Server-derived. */
  surfaceAuto?: true;
  /** set when a bot (not the person) started this thread — its own or a
   * teammate's; the sidebar shows a quiet "opened by <name>" under the title */
  openedBy?: ThreadOpener;
  /** A parallel task: the conversation and request it answers. */
  parallelOf?: TaskParallelOf;
  /** What the last direct turn could reach, by source (shared/turn-connectors.ts). */
  connectors?: import("../../shared/turn-connectors").TurnConnectors;
  /** set when a bot closed this thread with close_thread; the sidebar folds
   * it out of the default list (still under "show all", never deleted) and
   * the server clears it when a new turn starts there */
  closedBy?: ThreadCloser;
  /** when the person archived this thread: out of the default list, still
   * under show-all and search, and back the moment it needs them again;
   * absent = never archived. Syncs like every other task field. */
  archivedAt?: number;
  /** when the person snoozed this thread: 0 = until new activity (the
   * server clears it on the first wake), a future epoch ms = until then
   * (the server drops it from reads once past); absent = awake */
  snoozedUntil?: number;
}

/** The bot that opened a thread on itself or a teammate. */
export interface ThreadOpener {
  botId: string;
  name: string;
  delegationId?: string;
  at: number;
}

/** The bot that closed a thread it opened (or one of its own). */
export interface ThreadCloser {
  botId: string;
  name: string;
  at: number;
}

export interface TaskUsage {
  input: number;
  output: number;
  /** cached share of `input` (context the model re-read); absent on records
   * from builds before it was tracked */
  cachedInput?: number;
  /** null until any turn reported a cost — most engines never do; records
   * from builds before cost existed lack the field entirely */
  costUsd: number | null;
  turns: number;
  /** the most recent settled turn on its own */
  lastTurn?: { input: number; output: number; cachedInput?: number; costUsd: number | null };
  /** what filled the model's window on the last model call, and the window's size when known.
   * promptBytes is the assembled system prompt, in bytes, when that turn measured it.
   * buckets are the sizes that turn could measure (a message count, and bytes:
   * messageBytes is the size of those messages). */
  context?: {
    tokens: number;
    window?: number;
    promptBytes?: number;
    buckets?: Partial<Record<"messages" | "messageBytes" | "tools" | "memory" | "skills" | "agents" | "prompt", number>>;
  };
}

export interface Bot {
  /** A bot the viewer knows only from a room it is in (groupMemberBots):
   * its name and look, nothing else; it cannot be opened. */
  publicProfile?: true;
  /** Owner selection, independent of engine approval mode. */
  toolScope?: ToolScope;
  waitingForTeammates?: boolean;
  /** Bot-to-bot conversations waiting on the viewer's approval
   * (WireBot.waitingApprovals): never listed, their cards join the open
   * conversation's approval box (parallel-approvals.ts). */
  waitingApprovals?: WireWaitingApproval[];
  /** Conversations with another bot, both ends (WireBot.botConversations). */
  botConversations?: WireBotConversation[];
  id: string;
  threadId: string;
  /** The bot's main thread, worked out by the server (WireBot.mainThreadId). */
  mainThreadId?: string;
  /** every context this bot has, newest first */
  tasks?: Task[];
  projects?: BotProject[];
  name: string;
  title: string;
  description: string;
  /** Standing instructions (SOUL.md). Canonical on the server; the file is a mirror. */
  soul?: string;
  /** The SOUL.md mirror on disk differs from the record; the Soul editor offers apply/discard. */
  soulDrift?: boolean;
  notifications: boolean;
  color: MausColor;
  mascotExpression?: string | null;
  /** Which body the bot wears. Unknown/absent values fall back to the cursor. */
  mascotBody?: MascotBodyId | null;
  /** Special-edition skin. Unknown/absent values wear none. */
  mascotSkin?: MascotSkinId | null;
  /** The bot's character and its look (shared/mascot-look.ts); absent means the owl. */
  mascotLook?: import("../../shared/mascot-look").MascotLook | null;
  /** App-owned image attachment used for this bot's profile. */
  avatarUrl?: string | null;
  /** Mascot, or the crop applied to avatarUrl. */
  avatarCrop?: BotAvatarCrop;
  /** Zoom of a custom image. Absent means 1. */
  avatarZoom?: number;
  /** Horizontal point of the image kept in the crop, 0–1. Absent means center. */
  avatarFocusX?: number;
  /** Vertical point of the image kept in the crop, 0–1. Absent means center. */
  avatarFocusY?: number;
  unread: boolean;
  busy?: boolean;
  /** what the bot is doing, as the harness sees it; busy is derived from it */
  activity?: "working" | "waiting-on-you" | "idle" | "no-signal" | "dead" | "parked.computer";
  /** The selected thread's turn-start anchor (epoch ms) while busy, else null;
   * fed to the Thinking timer so elapsed time survives thread switches. */
  turnStartedAt?: number | null;
  modelSelection: ModelSelection;
  /** Where this bot's turns run. Absent means the server (the fleet). */
  host?: { kind: "fleet" } | { kind: "machine"; userId: string; deviceId: string };
  /** Where this bot works: a computer, only the built-in browser tab, or
   * nowhere; unset = auto (cloud boat if one exists, else local). */
  computer?: "cloud" | "vm" | "local" | "browser" | "off";
  /** Enrolled unattended hosts attached from the Computer tab so this bot
   * has access by default (2026-11-01). Absent = none. */
  remoteHosts?: string[];
  /** Which cloud computer backs `computer: "cloud"`; absent means Boat. */
  cloudBackend?: CloudBackend;
  /** Allow Auto to prepare/start the managed VPS container. Off by default. */
  autoStartVps?: boolean;
  /** where new tasks run their shell tools; absent = the private bot workspace */
  cwd?: string;
  /** auto mode: the bot approves its own tool permissions */
  autoApprove?: boolean;
  /** Explicit approval level; absent records use the legacy autoApprove bit. */
  approvalMode?: ApprovalMode;
  /** The bot's own level as its owner chose it, never a conversation's (WireBot.approvalSetting). */
  approvalSetting?: ApprovalMode;
  /** The level the open conversation really runs at, with why, when it is not approvalSetting (WireBot.approvalApplied). */
  approvalApplied?: import("../../shared/approval-mode").AppliedApprovalLevel;
  /** how autonomously this bot may act on its own (shared/proactive-mode.ts); "off" = never, absent = the default (proactiveModeFor) */
  proactiveMode?: ProactiveMode;
  /** tools this bot may always use without asking */
  alwaysAllow?: string[];
  /** speak this bot's replies aloud as they settle */
  speakReplies?: boolean;
  /** #1329: the person's "do not finish until" sentence; absent = off */
  finishUntil?: string;
  /** #1329: relaunches Sagax starts on its own while it is not met; absent = 5 */
  finishUntilMaxRounds?: number;
  /** this bot's own voice id (falls back to the app-wide one) */
  voice?: string;
  /** whether this bot may send voice notes (on unless switched off) */
  voiceNotes?: boolean;
  /** whether this bot may write email draft cards (on unless switched off) */
  emailDrafts?: boolean;
  /** whether this bot uses native memory (on unless switched off) */
  memoryEnabled?: boolean;
  /** who gets this bot's team-memory cards: its section (absent, "shared") or only those who see the bot and the conversation ("private") */
  teamMemorySharing?: "shared" | "private";
  pinned?: boolean;
  hidden?: boolean;
  /** Sidebar section this bot renders under; absent = unsectioned. */
  section?: string;
  /** the one message pinned to the top of this bot's active thread */
  pinnedMessageId?: string;
  /** This sidebar section's primary coordinator. */
  /** The owner's Primary Bot (one per person), under its former wire name. */
  chiefOfStaff?: boolean;
  /** Additional teams the owner explicitly lets this Primary Bot work with. */
  managedSections?: string[];
  /** When this bot wants to talk to another bot (ask_bot/delegate_bot),
   * pause and ask the user first. Off by default. */
  approvePeerComms?: boolean;
  /** Explicit peer allow-list (bot ids); absent = every bot in its section,
   * `[]` = none. Read-only on the web today; here so the settings dialog can
   * refetch the overview when the server changes it. */
  peers?: string[];
  /** 2026-10-21 (parité 1C): who it writes to without a card
   * (shared/allowed-recipients.ts). */
  allowedRecipients?: string[];
  outbound?: { policy: "ask" | "allow"; dailyCap: number };
  fallback?: Array<{ instanceId: string; model: string }>;
  /** Per bot since 2026-10-15 (server/bot-runtime-settings.ts), edited in
   * the bot editor. Absent: the server default (or, for busySend, the
   * person's own earlier default). */
  maxConcurrentThreads?: number;
  maxParallelPerPerson?: number;
  busySend?: "ask" | "steer" | "parallel" | "after";
  automaticRecovery?: { enabled: boolean; backup?: ModelSelection };
  /** #1098: per-turn anti-loop limits its owner set (shared/turn-limits.ts). */
  turnLimits?: { roomPosts?: number; threadsOpened?: number; roomsCreated?: number };
  /** #1137, organization server: who pays for this bot's replies (its own
   * choice; absent: `turnPayerDefault`, which the server computes). */
  turnPayer?: "owner" | "speaker";
  turnPayerDefault?: "owner" | "speaker";
  /** Whether this bot gets the app's built-in browser (Browser tab). On unless switched off. */
  browser?: boolean;
  /** Memory upkeep (Bot settings → Memory): background capture and the
   * nightly tidy-up. On unless explicitly false. */
  memoryUpkeep?: boolean;
  /** Which app-wide MCP servers (Plugins → MCP servers) this bot mounts, by
   * name. Absent = every enabled server; [] = none (null clears over PATCH). */
  mcpServers?: string[] | null;
  /** The account each MCP server signs in with for this bot (absent: the
   * server's default account; null clears over PATCH). */
  mcpAccounts?: Record<string, string> | null;
  /** Named browser profile id (config.browserProfiles); absent/null = the
   * bot's own session (null is how a clear travels over PATCH). */
  browserProfile?: string | null;
  /** Who may see this bot on a shared workspace; only admins receive it. */
  visibility?: BotVisibility;
  /** Lowercased user id of the person who created this bot. */
  ownerUserId?: string;
  /** Who confirmed the Full access warning for this bot, once
   * (server/org-full-access.ts). */
  fullAccessConsent?: { principalId: string; at: number };
  directGrants?: string[];
  /** Slice 4: grants with levels (user: or team: targets). */
  grants?: { target: string; level: "use" | "run" | "edit" | "manage"; by: string; at: number }[];
  /** Where a shared or organization package put this bot (its provenance line). */
  installedPackage?: InstalledPackageMetadata;
  messages: Message[];
  /** The server answered a bounded page and older messages remain in storage.
   * Absent on an unpaged response, which always carries the whole thread. */
  hasMore?: boolean;
  /** Renderer-only: a deleted selection moved to a thread whose full
   * transcript has not arrived yet. Never carry the deleted chat into it. */
  awaitingThreadSnapshot?: boolean;
  /** Renderer-only: the thread a switch in this window is opening, until its
   * snapshot lands (taskSwitched). The server announces the switch before it
   * answers it, so meanwhile this is the thread on screen, never threadId:
   * the one left behind is not read by being left (the "bot" frame). */
  switchingTo?: string;
  /** Renderer-only: the page of `switchingTo` this window last read
   * (src/lib/thread-page-cache.ts), drawn while the switch is under way and
   * replaced by the switch's own page (taskSwitched). Read-only on screen. */
  switchPreview?: { threadId: string; messages: Message[]; hasMore?: boolean; activeLeafId?: string | null };
  /** leaf of the visible conversation branch (see visibleMessages) */
  activeLeafId?: string | null;
}

export interface BotProject {
  id: string;
  name: string;
  emoji?: string;
}

export type ProjectUpdatePatch = { name?: string; emoji?: string | null };
/** Who owns a set of thread folders: a bot (the default) or a group. */
export type FolderOwnerKind = "bot" | "group";
/** The organization fields of a person conversation's thread; null clears. */
export type GroupTaskUpdatePatch = { archivedAt?: number | null; snoozedUntil?: number | null; projectId?: string | null; pinned?: boolean };
/** Sent on every API request: this client knows a conversation with a
 * person has threads, so the server answers with the thread this person has
 * open (server/people-dms.ts). */
export const PERSON_THREADS_HEADER = "x-sagax-person-threads";

/** A conversation uses its own execution settings; the sidebar keeps the
 * original bot's aggregate presence and profile defaults. */
export function currentTaskBot(bot: Bot, threadId = bot.threadId): Bot {
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  if (!task) return bot;
  return {
    ...bot,
    threadId,
    modelSelection: task.modelSelection ?? bot.modelSelection,
    // the bot's level, live, unless this thread holds an exception (#1169)
    ...threadApprovalFields(bot, task),
    activity: task.activity ?? bot.activity,
    busy: task.busy ?? (task.activity === "working" || task.activity === "waiting-on-you"),
    unread: task.unread ?? bot.unread,
    pinnedMessageId: task.pinnedMessageId,
    turnStartedAt: task.turnStartedAt ?? null,
    waitingForTeammates: task.waitingForTeammates ?? false,
  };
}

export type TaskUpdatePatch = Partial<Pick<Task, "modelSelection" | "approvalMode" | "autoApprove" | "pinnedMessageId">> & {
  confirmFullAccess?: boolean;
  /** Organization server: the owner grants Full over HTTP; the server
   * checks the policy, the owner and the one-time confirmation. */
  organizationFullAccess?: boolean;
  acknowledgeLocalAuto?: boolean;
  updateBotDefault?: boolean;
  projectId?: string | null;
  archivedAt?: number | null;
  snoozedUntil?: number | null;
  /** null = follow the bot's Works on again */
  surface?: Task["surface"] | null;
  /** false clears the pin */
  pinned?: boolean;
  link?: string | null;
};

function taskPatchFields(patch: TaskUpdatePatch): Partial<Task> {
  const { confirmFullAccess: _fullConsent, organizationFullAccess: _orgFull, acknowledgeLocalAuto: _localAck, updateBotDefault: _modelDefault, projectId, archivedAt, snoozedUntil, surface, pinned, link, ...fields } = patch;
  return { ...fields,
    ...(projectId === undefined ? {} : { projectId: projectId ?? undefined }),
    ...(archivedAt === undefined ? {} : { archivedAt: archivedAt ?? undefined }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil: snoozedUntil ?? undefined }),
    // A person's pin or unpin is never the machine's record.
    ...(surface === undefined ? {} : { surface: surface ?? undefined, surfaceAuto: undefined }),
    ...(pinned === undefined ? {} : { pinned: pinned ? true : undefined }),
    ...(link === undefined ? {} : { link: link ?? undefined }) };
}

/** A snapshot must not move a thread backwards in the list. Local bumps can
 * race an older bot frame that was built before the message landed. */
function mergeTaskStamps<T extends { threadId: string; updatedAt?: number }>(previous: T[] | undefined, incoming: T[] | undefined): T[] | undefined {
  if (!incoming) return previous;
  const prior = new Map((previous ?? []).map((task) => [task.threadId, task.updatedAt]));
  return incoming.map((task) => {
    const local = prior.get(task.threadId);
    if (typeof local !== "number") return task;
    const remote = task.updatedAt;
    const updatedAt = typeof remote === "number" ? Math.max(local, remote) : local;
    return updatedAt === task.updatedAt ? task : { ...task, updatedAt };
  });
}

function bumpThreadUpdatedAt(state: AppState, threadId: string, at: number): AppState {
  if (!Number.isFinite(at)) return state;
  const advance = <T extends { threadId: string; updatedAt?: number }>(tasks: T[] | undefined) =>
    tasks?.some((task) => task.threadId === threadId)
      ? tasks.map((task) => task.threadId === threadId ? { ...task, updatedAt: Math.max(task.updatedAt ?? 0, at) } : task)
      : tasks;
  return {
    ...state,
    bots: state.bots.map((bot) => {
      const tasks = advance(bot.tasks);
      return tasks === bot.tasks ? bot : { ...bot, tasks };
    }),
    groups: state.groups.map((group) => {
      const tasks = advance(group.tasks);
      return tasks === group.tasks ? group : { ...group, tasks };
    }),
  };
}

function rewindThreadUpdatedAt(state: AppState, threadId: string, messages: { at: number }[], createdAt: number): AppState {
  const at = messages.reduce((max, message) => Math.max(max, message.at || 0), createdAt);
  const apply = <T extends { threadId: string; updatedAt?: number }>(tasks: T[] | undefined) =>
    tasks?.map((task) => task.threadId === threadId ? { ...task, updatedAt: at } : task);
  return {
    ...state,
    bots: state.bots.map((bot) => bot.tasks?.some((task) => task.threadId === threadId) ? { ...bot, tasks: apply(bot.tasks) } : bot),
    groups: state.groups.map((group) => group.tasks?.some((task) => task.threadId === threadId) ? { ...group, tasks: apply(group.tasks) } : group),
  };
}

/** The New divider for a conversation being opened. One that opens unread
 * gets a fresh one; opening the same conversation again keeps its divider,
 * and any other conversation has none. */
function openedUnreadDivider(state: AppState, threadId: string, unread: boolean, messages: readonly Message[], lastReadMessageId?: string): AppState["unreadDivider"] {
  if (!unread) return state.unreadDivider?.threadId === threadId ? state.unreadDivider : null;
  const messageId = firstUnreadMessageId(messages, lastReadMessageId);
  return messageId ? { threadId, messageId } : null;
}

/** The visible conversation: walk parentId links from the active leaf back
 * to the root. Falls back to the flat list for pre-branching payloads. */
export function visibleMessages(bot: Pick<Bot, "messages" | "activeLeafId">): Message[] {
  const leafId = bot.activeLeafId;
  if (!leafId) return bot.messages;
  const byId = new Map(bot.messages.map((m) => [m.id, m]));
  if (!byId.has(leafId)) return bot.messages;
  const path: Message[] = [];
  let cur = byId.get(leafId);
  while (cur) {
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

/** GET /api/config — configured flags only; secrets are never echoed. */
export interface ConfigStatus {
  xai?: { configured: boolean };
  mistral?: { configured: boolean };
  cerebras?: { configured: boolean };
  groq?: { configured: boolean };
  /** Legacy status field, retained for older servers. New servers return false. */
  anthropic?: { configured: boolean; everyClaudeBot?: boolean };
  openai?: { configured: boolean };
  openrouter?: { configured: boolean };
  openaiCompat?: { configured: boolean; url?: string; model?: string };
  /** 2026-10-30: the named OpenAI-compatible servers (never their keys). */
  openaiCompatServers?: Array<{ instanceId: string; name: string; url: string; configured: boolean }>;
  /** Capabilities lot 4: changes when the organization's declarations do
   * (Plugins reads its capabilities again). */
  orgCapabilities?: { revision: string };
  /** what this server is entitled to; Settings shows only what works here.
   * `license` reaches admins only, and only while the key is inside its
   * warning window or grace period. */
  edition?: {
    edition: "oss" | "enterprise";
    features: string[];
    license?: { expiresAt: string; expiresInDays: number; graceEndsAt?: string };
  };
  /** a fleet agent exists on this server (Settings → Workspaces) */
  fleet?: { available: boolean };
  budgets?: { monthlyUsd?: number; warnAtPercent?: number };
  billing?: { currency?: string; prices?: Record<string, { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number }> };
  /** `included`: cloud computers come with Cloud Pro, no key is saved. */
  box: { configured: boolean; included?: boolean };
  vps: { configured: boolean; sshAlias: string };
  rooms: { turnTimeoutMinutes: number };
  /** Per-call ceiling (minutes) for a bot's MCP tools. Absent from servers
   * older than the setting; read it with mcpCallTimeoutMinutes(). */
  mcp?: { callTimeoutMinutes: number };
  /** Visible slice of the new-bot template. Absent effort means no level is sent. */
  newBotDefaults?: {
    profile?: {
      modelSelection?: ModelSelection;
      approvalMode?: "ask" | "auto" | "full" | "custom";
      computer?: "cloud" | "vm" | "local" | "browser" | "off" | null;
    };
  };
  threads?: { maxConcurrentPerBot: number; maxParallelPerPerson?: number; eventLogMaxBytes?: number; eventLogRetentionDays?: number };
  automaticRecovery?: { enabled: boolean; backup?: ModelSelection };
  localVm: { mode: "shared" | "per-bot" | "pool"; maxInstances: number; idleTimeoutMinutes?: number };
  /** `providerKeys`: names of the keys saved for OpenCode's other
   * providers, never the keys. */
  opencodeGo?: { configured: boolean; providerKeys?: string[] };
  /** Voice. `configured` = the engine has what it needs (an ElevenLabs or
   * Fish Audio key, or a Chatterbox server address); `ready` = that AND a voice, which is
   * what it takes to actually speak. The key itself is never echoed back;
   * `baseUrl`/`model` are Chatterbox settings, not credentials. */
  tts?: {
    configured: boolean;
    ready: boolean;
    voice: string;
    provider?: "elevenlabs" | "fish" | "system" | "chatterbox" | "xai";
    baseUrl?: string;
    model?: string;
    /** Fish Audio speech model; present only while Fish is the provider. */
    fishModel?: "s2.1-pro" | "s2.1-pro-free";
    /** ElevenLabs voice comes with Cloud Pro; no key is saved. */
    included?: boolean;
    /** Which voice keys are saved, whatever the engine (2026-10-14). Grok
     * voice uses the xAI key (`xai.configured`). Absent on older servers. */
    keys?: { elevenlabs: boolean; fish: boolean };
  };
  /** The decision model: switches and whether a key is on file. The key
   * itself never comes back. `enabled` is the switch as it takes effect
   * (off while no key is saved). `included`: Cloud Pro's decisions, no key
   * saved. */
  decider?: {
    provider: "jev";
    configured: boolean;
    included?: boolean;
    enabled: boolean;
    jobs: { roomRouting: boolean };
  };
  /** Live calls (OpenAI GPT-Live): configured-or-not, never the key. */
  live?: LiveSettings;
  /** Shared write-only credential for on-demand GPT Image avatars. */
  imageGen?: {
    configured: boolean;
    provider?: "openai" | "xai" | "custom";
    model?: string;
    customUrl?: string;
    customModel?: string;
    openaiConfigured?: boolean;
    xaiConfigured?: boolean;
    customKeyConfigured?: boolean;
  };
  /** who's using the app: collected in onboarding, shown in the sidebar.
   * For someone signed in to another person's server, the server fills it
   * with their own identity (see `viewer`). */
  profile?: { name: string; email: string; aboutMe?: string; avatarUrl?: string };
  /** Who is looking, as the server knows them. Absent from older servers. */
  viewer?: ConfigViewer;
  /** UI language override; "" (or absent) follows the system language. */
  language?: string;
  /** Opt-in flags. Absent means off. */
  features?: { skillAuthoring: boolean; showToolCalls?: boolean; browser?: boolean; sharedComputers?: boolean; claudeUserMcp?: boolean; llmThreadTitles?: boolean; routinesInConversation?: boolean; connectedApps?: boolean; vpsComputer?: boolean; boatComputer?: boolean; decisionModel?: boolean; dataWindow?: boolean; meetingNotetaker?: boolean; routineGroupSettings?: boolean; skillsLibrary?: boolean };
  /** First-run progress: whether the welcome tour was finished and which
   * one-time hints were dismissed. Server-owned so it follows the workspace. */
  onboarding?: OnboardingStatus;
  /** Which browser this server can give bots: the desktop app's surface, the
   * agent-browser engine, or nothing yet (with the reason). */
  browserEngine?: BrowserEngineSummary;
  /** Named browser sessions any bot can be pointed at. */
  browserProfiles?: BrowserProfile[];
  /** Organization server (#1098): the viewer sets their own Experimental
   * switches and browser profiles (/api/me/experimental). */
  personalSettings?: boolean;
  /** The enrolled organisation's read-only desktop policy; null when this
   * desktop is not enrolled or its Admin sends no policy. */
  managedPolicy?: ManagedPolicySummary | null;
  /** Organization server: the model providers (engine instance ids) its
   * admin allows in Perspicax; null or absent means every provider
   * (shared/org-allowed-engines.ts). Refreshed by the config frame. */
  allowedEngines?: string[] | null;
  /** 2026-10-30: a person's own subscription or key may run an engine
   * outside `allowedEngines` (Perspicax, off by default). */
  ownAccountsOutsideList?: boolean;
  /** 2026-10-30 (lot 2): the models the organization turned off in
   * Perspicax, `<engine>/<model>` (shared/offered-models.ts). */
  disabledModels?: string[];
  /** The models the signed-in person turned off (Settings > Models); on a
   * solo server, the installation's own. */
  myDisabledModels?: string[];
  /** Organization server: new threads start confidential unless the person
   * picks an ordinary one (Settings > Organisation). */
  confidentialThreadsByDefault?: boolean;
  /** An OMB Cloud home in the upstream project. Sagax runs no Cloud, so no
   * server of ours sets it; kept optional so the shared place logic
   * (src/lib/place-view.ts) reads it as absent. */
  cloudHome?: boolean;
}

/** Mirrors ViewerIdentity in server/viewer-identity.ts. */
export interface ConfigViewer {
  /** The operator at the server's computer, or a device they paired. */
  operator: boolean;
  principalId: string | null;
  email: string;
  name: string;
  role: "owner" | "admin" | "member" | null;
  /** The server lets this viewer create a bot. */
  canCreateBots: boolean;
  /** Organization server: a Perspicax admin lets this person use shared
   * bots only (no creating, editing or owning a bot). */
  botsReadOnly?: true;
  /** Why (2026-10-09): `permission` when their profile lacks bots.create;
   * absent when the person sheet says use only. */
  botsReadOnlyReason?: "permission";
  /** The operator's name, for their lines that carry no sender. */
  operatorName?: string;
  /** Organization server: Perspicax owns this person's name and email
   * (read-only here; src/lib/profile-management.ts). */
  profileManagedBy?: "perspicax";
  profileManageUrl?: string;
  /** Their Perspicax avatar as this server serves it. */
  avatarUrl?: string;
  /** Which installation screens this viewer may change. Absent on an older server. */
  capabilities?: ViewerCapabilities;
  /** Organization server (2026-10-09): the permissions this person holds
   * (shared/permissions.ts); every key for an admin. Absent elsewhere and
   * on an older server (src/lib/viewer.ts viewerCan falls back). */
  permissions?: string[];
  permissionsSource?: "admin" | "perspicax" | "defaults";
}

export interface ManagedPolicySummary {
  organizationName: string;
  version: number;
  companyModelsOnly: boolean;
  allowedEngines: "all" | string[];
  mcp: { allowCustom: boolean; allowlist: string[] };
  computers: { thisComputer: boolean; localVm: boolean; box: boolean; vps: boolean };
  remoteAccess: boolean;
}

export interface BrowserEngineSummary {
  kind: "engine" | "unavailable";
  reason?: string;
  installable?: boolean;
  version?: string;
  installing?: boolean;
  installError?: string;
}

export interface BrowserProfile {
  id: string;
  name: string;
  /** Read-only durable Electron routing inherited from legacy profiles.
   * Config PATCH payloads must omit it. */
  partitionId?: string;
  /** The viewer's own profile on an organization server (#1098,
   * shared/person-settings.ts): set through /api/me/experimental, never in a
   * config PATCH. */
  personal?: boolean;
}

// Every section the server's config frame carries. A section left out here
// is wiped from state.config whenever a live frame lands, so whichever of a
// save's own response and its broadcast frame arrives last decides what
// Settings shows (a saved key's Test button used to vanish that way).
export type ConfigStatusFrame = Pick<
  ConfigStatus,
  "xai" | "mistral" | "cerebras" | "groq" | "anthropic" | "openai" | "openrouter" | "openaiCompat" | "fleet" | "box" | "vps" | "rooms" | "mcp" | "threads" | "automaticRecovery" | "localVm" | "opencodeGo" | "tts" | "decider" | "imageGen" | "live" | "profile" | "language" | "features" | "onboarding" | "browserEngine" | "browserProfiles" | "personalSettings" | "edition" | "budgets" | "billing" | "managedPolicy" | "viewer" | "allowedEngines" | "ownAccountsOutsideList" | "disabledModels" | "myDisabledModels" | "confidentialThreadsByDefault" | "orgCapabilities"
>;

export function configStatusFromFrame(frame: ConfigStatusFrame): ConfigStatus {
  return {
    xai: frame.xai,
    mistral: frame.mistral,
    cerebras: frame.cerebras,
    groq: frame.groq,
    anthropic: frame.anthropic,
    openai: frame.openai,
    openrouter: frame.openrouter,
    openaiCompat: frame.openaiCompat,
    fleet: frame.fleet,
    box: frame.box,
    vps: frame.vps,
    rooms: frame.rooms,
    mcp: frame.mcp,
    threads: frame.threads,
    automaticRecovery: frame.automaticRecovery,
    localVm: frame.localVm,
    opencodeGo: frame.opencodeGo,
    tts: frame.tts,
    decider: frame.decider,
    imageGen: frame.imageGen,
    live: frame.live,
    profile: frame.profile,
    language: frame.language,
    features: frame.features,
    onboarding: frame.onboarding,
    browserEngine: frame.browserEngine,
    browserProfiles: frame.browserProfiles,
    personalSettings: frame.personalSettings,
    edition: frame.edition,
    budgets: frame.budgets,
    billing: frame.billing,
    managedPolicy: frame.managedPolicy,
    viewer: frame.viewer,
    allowedEngines: frame.allowedEngines,
    ownAccountsOutsideList: frame.ownAccountsOutsideList,
    disabledModels: frame.disabledModels,
    myDisabledModels: frame.myDisabledModels,
    confidentialThreadsByDefault: frame.confidentialThreadsByDefault,
    orgCapabilities: frame.orgCapabilities,
  };
}

/** How an engine gets installed — declared by its driver, mirrors
 * EngineInstall in server/contracts.ts. Absent for engines that need no
 * local binary. `command` omits platforms that have no one-liner. */
export interface EngineInstall {
  /** The server's platform, not the browser device's operating system. */
  platform?: "darwin" | "win32" | "linux";
  command?: Partial<Record<"darwin" | "win32" | "linux", string>>;
  docsUrl?: string;
  signInCommand?: string;
  needsNode?: boolean;
  managed?: { label: string; downloadBytes: number };
  /** the server can install or update this engine itself, no terminal */
  server?: { package: string };
  /** configured with a key in Settings → API keys, not in a terminal */
  settings?: "connections";
  /** the setup card takes a masked access key */
  apiKey?: boolean;
}

/** One row of GET /api/instances — the model picker's data. */
export interface InstanceInfo {
  instanceId: string;
  /** Metadata of this viewer's own compatible server. Never a credential. */
  providerAccount?: { provider: string; serverId: string };
  driverKind: string;
  displayName: string;
  /** Optional presentation override belonging to this instance, independent
   * of the driver that runs it. */
  icon?: import("../../shared/provider-icon").ProviderIcon;
  /** Company instances are owned by the desktop parent, never editable here. */
  readOnly?: boolean;
  /** This server's image pins the engine (engines.lock.json): do not update it in place. */
  pinned?: boolean;
  managed?: { organizationId: string; organizationName: string };
  /** The enrolled organisation's desktop policy does not allow bots to run on
   * this instance: shown, but disabled, with the server's reason. */
  policy?: { organizationName: string; reason: string };
  snapshot: {
    state: "available" | "unavailable";
    reason?: string;
    authenticated?: boolean;
    chatgptPlan?: boolean;
    authenticationUnavailableReason?: string;
    account?: { email?: string; organization?: string; method?: "login" | "api-key" };
    version?: string | null;
    /** A newer provider version unlocks capabilities, but this installed
     * version and its current models remain usable. */
    update?: {
      title: string;
      message: string;
      command: string;
    };
    /** a reported cost on a subscription is notional; the UI says so */
    billing?: "metered" | "subscription";
    /** a standing condition worth a look, with nothing to run */
    warning?: {
      title: string;
      message: string;
    };
  };
  models: { default: string; issue?: ModelListIssue; options: Array<{ id: string; label: string; custom?: boolean; loaded?: boolean; local?: boolean; anthropic?: boolean; server?: string; sharedBy?: string; provider?: string; contextWindow?: number; variants?: ModelVariantOption[];
    /** Per-model reasoning levels and default (shared/model-capabilities.ts). */
    effortLevels?: EffortLevel[]; defaultEffort?: EffortLevel }> };
  capabilities?: {
    computerMcp?: boolean;
    agentsMcp?: boolean;
    browserMcp?: boolean;
    images?: boolean;
    effortLevels?: readonly EffortLevel[];
    modelVariants?: boolean;
    /** the engine keeps a live session and takes a message mid-turn */
    queueing?: boolean;
    localComputerMcp?: boolean;
    /** This engine can answer a bounded review prompt without changing the
     * bot's active conversation. */
    approvalReview?: boolean;
    /** Its own shell, file and web tools stay off the Sagax server. An
     * organization server offers only these engines. */
    withholdsHostTools?: boolean;
  };
  /** `custom` agents sit below the rail divider — no subscription catalog. */
  access?: "subscription" | "custom" | "api";
  /** `signOut`: the browser may remove the stored sign-in to switch accounts. */
  authentication?: { method: "device-code" | "paste-code" | "browser" | "browser-pkce" | "open-link"; signOut?: boolean };
  install?: EngineInstall;
  /** Configured CLI path override — set ONLY when the user overrode it;
   * absent means the driver default is in effect. */
  cli?: string;
  /** Driver's default binary name (e.g. "claude"). */
  cliDefault?: string;
  /** Absolute paths of every default binary found on PATH, PATH order. */
  cliCandidates?: string[];
  /** Server-owned Claude profile; a saved directory does not prove sign-in. */
  claudeAccount?: { configDir: string; signInCommand: string; signInShell: "powershell" | "sh"; isDefault: boolean };
  /** This engine can leave large temporary files behind on this server
   * (Antigravity on Windows); Settings offers to clear them. */
  freeUpSpace?: boolean;
}

/** A category of the Achievements page: one of the catalog, All, or the shared settings. */
export type AchievementsCategory = AchievementCategory | "all" | "settings";

export type { AppSettingsSection, BotSettingsSection };

export interface ModelVariantSession {
  instanceId: string;
  model: string;
  turnId: string;
  startedAt: string;
  acceptingUpdates: boolean;
  variants?: { options: ModelVariantOption[]; currentValue?: string };
}

export interface AppState {
  bots: Bot[];
  groups: Group[];
  /** Persisted named teams; older servers omit this, so clients also derive labels. */
  sections?: string[];
  instances: InstanceInfo[];
  /** Session discoveries stay with their conversation and never enter persisted settings. */
  modelVariantSessions: Record<string, ModelVariantSession>;
  /** Per thread: the model the engine really ran, when it is not the one picked (the person's own session does not offer the pick). Cleared when the next turn starts. */
  /** #1154: what the last turn of a thread ran on when it is not the pick;
   * `actualInstanceId` when it ran on another engine the person pays for. */
  modelFallbacks?: Record<string, { instanceId: string; requested: string; actual: string; actualInstanceId?: string }>;
  config: ConfigStatus | null;
  /** The Live call the harness is running, including a call that has just
   * ended; null when no call is known. Follows `live.call` SSE frames and
   * the initial `/api/live/call` snapshot. */
  liveCall: LiveCallState | null;
  /** Counts the `live.call` frames folded in, so a `/api/live/call` lookup
   * that was out while one landed is known to be older news. */
  liveCallVersion: number;
  /** The request order of the newest lookup answer applied: an earlier
   * lookup that comes back after it is older news too. */
  liveCallLookupSeq: number;
  /** selected chat — a bot id OR a group id */
  selectedId: string;
  /** The person's sidebar hidden keys (src/lib/sidebar-hidden.ts): a
   * restored or fallback selection never lands on one of them. */
  sidebarHiddenKeys: ReadonlySet<string>;
  activeView: "chat" | "team-map" | "routines" | "code" | "approvals" | "remote-sessions" | "achievements";
  routines: Routine[];
  routineRuns: RoutineRun[];
  routinesLoadState: "loading" | "ready" | "error";
  /** 2026-10-28: each bot's routine folders in order (shared/routine-folders.ts). */
  routineFolders: Record<string, string[]>;
  routinesFocus: { section?: "schedule" | "logs" | "webhooks"; view?: "calendar" | "list"; botId?: string; routineId?: string; runStatus?: RoutineRunStatusFilter; runId?: string; nonce: number };
  /** The Code section (src/components/code/CodePage.tsx): the run it opens,
   * or the list when none. */
  codeFocus: { runId?: string; nonce: number };
  webhooks: WebhookTrigger[];
  webhookAttempts: WebhookAttempt[];
  webhookIngress: WebhookIngressStatus | null;
  /** Signed-in Microsoft connectors a typed trigger can subscribe through. */
  webhookGraphConnectors: GraphConnectorOption[];
  settingsOpen: boolean;
  /** The panel opened from a split-view section's pill: that section's bot
   * (settings or computer) or group, always at the window's right edge.
   * null: the panel is the main chat's. One panel at a time; it clears when
   * the panel closes. */
  panelOwner: PanelOwner | null;
  /** The person whose details fill the right panel (principal id), or null.
   * Shares the right slot with bot settings, the computer and app settings. */
  personPanelId: string | null;
  pluginsOpen: boolean;
  /** Which tab the Plugins panel opens on; "mcp" when a bot's tools
   * sent the user there to add a server. */
  pluginsSurface: "apps" | "mcp";
  /** The bot Connect apps opens on, in its "For this bot" scope (a bot
   * panel sent the person there); null: the workspace scope. */
  pluginsBotId: string | null;
  /** 2026-10-15: the apps a conversation needs (its Connect apps pill,
   * src/lib/connect-apps-signal.ts): Connect apps opens with them first. */
  pluginsFocusApps: string[] | null;
  /** 2026-10-15: a routine to show on its page in the bot panel (a routine
   * line in the conversation was clicked); RoutinesSection opens it once. */
  routineFocus: { botId: string; routineId: string } | null;
  /** 2026-11-01: a routine run open as an exchange sheet over the chat
   * column (same place as Melonie <-> Katarina). ChatView renders it. */
  routineRunSheet: { runId: string; routineId?: string } | null;
  /** a link that opens Connect apps on one tab: Pages (the published
   * pages), Providers (once My accounts: the old name "accounts" still
   * leads there, see the togglePlugins action), Sources or Bots (Browse
   * Bots, 2026-10-29: openBotCatalog leads there) */
  pluginsPage: "pages" | "providers" | "sources" | "bots" | null;
  /** The Triggers pop-up (webhooks, as a sentence: when this happens, that
   * bot should…). */
  triggersOpen: boolean;
  /** The "New bot" role picker. */
  newBotOpen: boolean;
  /** The bot creation wizard (src/components/bot-wizard/BotWizard.tsx):
   * `botId` null opens on the mode choice of a new bot; a bot's id resumes
   * its draft or redoes the wizard on it. */
  botWizard: { botId: string | null; redo?: boolean } | null;
  /** Creation continues even when the role picker is dismissed. */
  botCreationPending: boolean;
  computerOpen: boolean;
  /** the per-thread event inspector (runtime stream + native protocol tee) */
  inspectorOpen: boolean;
  activityOpen: boolean;
  appSettingsOpen: boolean;
  appSettingsSection: AppSettingsSection;
  /** Where the Achievements page opens (activeView "achievements",
   * src/components/achievements/AchievementsScreen.tsx): the category a link
   * names, "all" otherwise. `nonce` changes on every open, so a second link
   * to another category re-selects it on a page already showing. */
  achievementsFocus: { category: AchievementsCategory; nonce: number };
  /** The organisation bot catalogue ("Browse Bots"), opened from the sidebar
   * row (Settings > Experimental features), New bot and Connect apps. Use dispatch(openBotCatalog()) and
   * dispatch(closeBotCatalog()). */
  botCatalogOpen: boolean;
  /** Where the catalogue opens: its Templates section (New bot, Connect apps,
   * an install link carrying a team's address), or
   * null for the home view. A new object on every request, so an open
   * catalogue follows a later one. */
  botCatalogTarget: BotCatalogTarget | null;
  /** The persona editor (src/components/persona/PersonaEditorModal.tsx): one
   * bot's whole profile in a modal shaped like Achievements, opened from the
   * mascot's menu in the bot panel. Null when closed. */
  personaEditor: { botId: string; section: BotSettingsSection } | null;
  /** A settings sub-page pushed inside the section (src/components/
   * SettingsSubPage.tsx), e.g. General > About me; null shows the section.
   * Any toggleAppSettings that names none (another section, closing) clears it. */
  appSettingsSubPage: string | null;
  /** Counts up each time Settings opens on the phone pairing ("Connect your
   * phone"): Remote access scrolls to the pairing that fits this window and
   * focuses the button that shows the code. Any other toggleAppSettings sets 0. */
  appSettingsPhonePairing: number;
  shortcutsOpen: boolean;
  /** the first-run welcome tour, also replayable from Settings → General */
  welcomeOpen: boolean;
  /** the launch screen (no server or server), opened from Settings or the
   * tour; on a first run it opens by itself (src/lib/launch.ts) */
  launchOpen: boolean;
  /** which mode the launch screen opens on */
  launchMode: "solo" | "server";
  /** the guided tour on the live interface that follows the welcome flow */
  tourOpen: boolean;
  botSettingsSection: BotSettingsSection;
  /** True only when the open action named a section — accordion expands that row. */
  botSettingsExpandAccordion: boolean;
  /** A Coding activity item the bot panel opens once (openBotActivity);
   * cleared by the panel when it shows it. */
  botActivityTarget: { botId: string; itemId: string } | null;
  /** True when this device has a section choice to restore (lib/last-bot-section). */
  botSettingsSectionStored: boolean;
  /** True only on an opening that expanded the remembered section; a deep
   * link is never it, so it can never force the Simple panel's full view. */
  botSettingsExpandRemembered: boolean;
  /** bots whose computer is starting for a turn (src/lib/computer-start.ts) */
  computerStarts: Record<string, ComputerStart>;
  /** Bot removals waiting for the server to verify that no persistent
   * computer would be orphaned. The bot stays visible until that succeeds. */
  deletingBots: Record<string, true>;
  /** who is driving each bot's computer: held = the person has the wheel
   * (the bot's hands are refused server-side); helpReason = the bot's open
   * plea for the person to take over */
  computerControl: Record<string, { held: boolean; helpReason: string | null }>;
  /** Each bot's data sheet (cards and loaded tables, never rows), loaded
   * when its Data tab first opens and replaced whole by every `data` frame.
   * The grid pages rows itself, so a sheet stays small. */
  dataSheets: Record<string, DataSheet>;
  /** The bot's table catalog as GET /data last reported it: DuckDB's own
   * list, not a copy on the sheet, so a load and a CREATE agree. */
  dataTables: Record<string, DataTable[]>;
  /** The result in view in this bot's Data window (src/lib/data-window.ts),
   * sent with the next message to that bot and thread. */
  dataView: import("@/lib/composer-attachments").DataViewContext | null;
  /** a search hit to scroll to once its thread is on screen; nonce lets the
   * same message be focused twice in a row */
  /** A message to land on (a search hit, a link); with `segment`, the
   * start of that earlier topic of the one conversation (no message). */
  focusMessage: { threadId: string; messageId: string; matchText?: string; segment?: true; nonce: number; consumed: boolean } | null;
  /** Fresh topic drafts (single stream, src/lib/fresh-topic.ts): per bot,
   * the topic a new, empty one is drawn over until the first message
   * creates it on the server. `auto` when coming back put it there (it
   * gives way as soon as that topic comes alive); New topic sets it too. */
  freshTopic: Readonly<Record<string, { threadId: string; auto: boolean }>>;
  /** The New divider: the first message of the open conversation that came
   * in while the person was away. Taken from its unread flag when it opens,
   * so it holds still while that conversation stays open. */
  unreadDivider: { threadId: string; messageId: string } | null;
  connected: boolean;
  /** True after the live stream has opened at least once this session. */
  everConnected: boolean;
  /** When the live stream last dropped after being up; null while connected. */
  disconnectedAt: number | null;
  /** Bots and rooms have loaded once: a link opened at launch can resolve. */
  hydrated?: true;
  error: string | null;
  /** a quiet, non-error line above the transcript; clears itself */
  notice: { kind: "thread-gone" | "bot-gone"; botName: string | null } | null;
  /** a thread the person asked to open (chip or #Title link): the sidebar
   * expands its bot and scrolls the row into view once it is current */
  revealThread: { threadId: string; nonce: number } | null;
  /** The conversation on screen before a thread chip (or #Title) opened
   * another one. Threads are hidden by default, and the opened thread is
   * the newest, so the ordinary "back" link never appears. This is the way
   * out, until the person returns or picks a different conversation. */
  threadReturn: { ownerId: string; threadId: string } | null;
  mascotMotion: {
    botId: string;
    nonce: number;
    kind: Exclude<MausMotion, "none">;
  } | null;
  /** Queued follow-up lines waiting for drain; keyed by threadId.
   * Each entry is identified by the server queueId, not by text. */
  pendingQueued: Record<string, Array<{ queueId: string; text: string; reason?: SteerQueueReason }>>;
  /** queueIds whose drain frame beat the POST continuation. One-shot and
   * bounded to a short event window so other clients cannot grow it forever. */
  consumedQueueIds: Record<string, true>;
  /** Frames arriving outside the visible thread, including the small gap
   * between a switch snapshot and its HTTP response. */
  backgroundThreadEvents: Record<string, Array<Extract<Action, { type: "messageAdded" | "messagePatched" | "threadActive" | "optimisticMessageRemoved" }>>>;
  /** Threads with a scrollback page in flight, so one click cannot ask the
   * server for the same page twice. */
  loadingOlder: Record<string, true>;
  /** Bumped whenever a thread's transcript is replaced or its visible branch
   * moves. A scrollback page carries the value it was asked under, so a page
   * that was in flight across an edit, a branch switch or a thread swap is
   * discarded instead of prepending rows from the branch it left behind.
   * Ordinary appends do not bump it: a page must still land over new
   * messages arriving while it was on the wire. */
  transcriptGeneration: Record<string, number>;
}

const MAX_CONSUMED_QUEUE_IDS = 64;

function rememberConsumedQueueId(
  consumed: AppState["consumedQueueIds"],
  queueId: string,
): AppState["consumedQueueIds"] {
  const next = { ...consumed, [queueId]: true as const };
  const overflow = Object.keys(next).length - MAX_CONSUMED_QUEUE_IDS;
  if (overflow > 0) {
    for (const id of Object.keys(next).slice(0, overflow)) delete next[id];
  }
  return next;
}

interface QueueReceiptSnapshot {
  messages?: Message[];
}

/** A replacement snapshot can contain the canonical user line after this
 * window missed its queue-drain frame. Remove any matching chip and retain a
 * short tombstone so a slower POST continuation cannot add the chip back. */
function reconcileSnapshotQueues(
  state: AppState,
  conversations: QueueReceiptSnapshot[],
): AppState {
  const landed: Array<{ queueId: string; at: number }> = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages ?? []) {
      if (message.queueId) landed.push({ queueId: message.queueId, at: message.at });
    }
  }
  if (landed.length === 0) return state;

  const landedIds = new Set(landed.map((entry) => entry.queueId));
  const pendingQueued: AppState["pendingQueued"] = {};
  for (const [threadId, entries] of Object.entries(state.pendingQueued)) {
    const waiting = entries.filter((entry) => !landedIds.has(entry.queueId));
    if (waiting.length > 0) pendingQueued[threadId] = waiting;
  }

  let consumedQueueIds: AppState["consumedQueueIds"] = {};
  // Preserve the newest receipts when a large historical snapshot contains
  // more than the bounded tombstone window.
  landed.sort((left, right) => left.at - right.at);
  for (const entry of landed) {
    consumedQueueIds = rememberConsumedQueueId(consumedQueueIds, entry.queueId);
  }
  // Live drain/cancel receipts are newer than loaded transcript history.
  // Re-reading an old transcript must not evict protection for a late POST.
  for (const queueId of Object.keys(state.consumedQueueIds)) {
    consumedQueueIds = rememberConsumedQueueId(consumedQueueIds, queueId);
  }
  return { ...state, pendingQueued, consumedQueueIds };
}

/** Direct-bot queues are server-owned. Restore them on reload, keeping the
 * separate group queue untouched. Remember removals so a late send response
 * cannot resurrect a message another window already cancelled or drained. */
function replaceBotQueues(state: AppState, queues: AppState["pendingQueued"]): AppState {
  const groupThreads = new Set(state.groups.flatMap((group) => [group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]));
  const liveIds = new Set(Object.values(queues).flatMap((entries) => entries.map((entry) => entry.queueId)));
  const pendingQueued = { ...queues };
  let consumedQueueIds = state.consumedQueueIds;
  for (const [threadId, entries] of Object.entries(state.pendingQueued)) {
    if (groupThreads.has(threadId)) pendingQueued[threadId] = entries;
    else for (const entry of entries) {
      if (!liveIds.has(entry.queueId)) consumedQueueIds = rememberConsumedQueueId(consumedQueueIds, entry.queueId);
    }
  }
  return { ...state, pendingQueued, consumedQueueIds };
}

export type BotAnnouncement = Omit<Bot, "messages"> & { messages?: Message[] };

export type Action =
  | {
      type: "hydrate";
      bots: Bot[];
      groups: Group[];
      sections?: string[];
      computerControl: Record<string, { held: boolean; helpReason: string | null }>;
      botQueuedMessages?: AppState["pendingQueued"];
      /** the conversation open on this device last launch, for the first hydrate */
      resumeId?: string;
    }
  | { type: "botQueues"; queues: AppState["pendingQueued"] }
  /** The person's sidebar hidden list changed (closed, hid, showed, or it
   * arrived from another device). */
  | { type: "sidebarHidden"; keys: ReadonlySet<string> }
  | { type: "sections"; sections: string[] }
  | { type: "sectionDeleted"; section: string; sections: string[] }
  | { type: "showRoutines"; section?: "schedule" | "logs" | "webhooks"; view?: "calendar" | "list"; botId?: string; routineId?: string; runStatus?: RoutineRunStatusFilter; runId?: string }
  | { type: "showTeamMap" }
  /** The Code section: the list, or one run when `runId` is set. */
  | { type: "showCode"; runId?: string }
  /** The Approvals screen (src/components/approvals/ApprovalsPage.tsx). */
  | { type: "showApprovals" }
  | { type: "showRemoteSessions" }
  /** The Achievements page, on `category` when a link names one. */
  | { type: "showAchievements"; category?: AchievementsCategory }
  | { type: "showChat" }
  | { type: "routinesHydrated"; routines: Routine[]; runs: RoutineRun[]; folders?: Record<string, string[]> }
  | { type: "routineFoldersPatched"; botId: string; folders: string[] }
  | { type: "routinesLoadFailed" }
  | { type: "routinePatched"; routine: Routine }
  | { type: "routineDeleted"; routineId: string }
  | { type: "routineRunPatched"; run: RoutineRun }
  | { type: "webhooksHydrated"; webhooks: WebhookTrigger[]; attempts: WebhookAttempt[]; ingress: WebhookIngressStatus; graphConnectors?: GraphConnectorOption[] }
  | { type: "webhookPatched"; webhook: WebhookTrigger }
  | { type: "webhookAttempted"; attempt: WebhookAttempt }
  | { type: "webhookDeleted"; webhookId: string }
  | { type: "createRoutine"; input: RoutineInput }
  | { type: "updateRoutine"; routineId: string; patch: Partial<RoutineInput> }
  | { type: "deleteRoutine"; routineId: string }
  | { type: "runRoutine"; routineId: string; onStarted?: (run: RoutineRun) => void; onError?: (error: unknown) => void; onSettled?: () => void }
  | { type: "cancelRoutineRun"; runId: string }
  | { type: "markRoutineRunSeen"; runId: string }
  | { type: "markAllRoutineRunsSeen" }
  | { type: "clearRoutineRuns" }
  | { type: "routineRunsRemoved"; ids: string[] }
  | { type: "groupPatched"; group: Partial<Group> & { id: string } }
  | { type: "groupDeleted"; groupId: string }
  | { type: "createGroup"; memberIds: string[]; humanIds?: string[]; name?: string; section?: string }
  /** Open (or create) the direct conversation with another person of the
   * organization (server/people-dms.ts). */
  | { type: "openPeopleDm"; principalId: string }
  /** Nudge that person (POST /api/nudges). The server enforces the cooldown. */
  /** `threadId`: the thread of the pair's conversation the line goes to. */
  | { type: "nudgePerson"; principalId: string; threadId?: string }
  /** Nudge the other people of a group chat (POST /api/nudges). */
  | { type: "nudgeGroup"; groupId: string }
  | {
      type: "sendGroup";
      groupId: string;
      text: string;
      sendId?: string;
      replyToId?: string;
      threadId?: string;
      mode?: "chat" | "goal";
      onError?: () => void;
      /** the server accepted the message or queued it durably */
      onSent?: () => void;
    }
  | {
      type: "patchGroup";
      groupId: string;
      patch: Partial<Pick<Group, "name" | "bulletin" | "memberIds" | "humanIds" | "defaultResponder" | "pinnedMessageId" | "section" | "unread" | "pinned" | "mentionAll">>;
    }
  | { type: "deleteGroup"; groupId: string }
  /** #1480: the viewer leaves a group they were added to (POST /leave). */
  | { type: "leaveGroup"; groupId: string }
  | { type: "newGroupTask"; groupId: string; projectId?: string }
  | { type: "switchGroupTask"; groupId: string; threadId: string }
  | { type: "renameGroupTask"; groupId: string; threadId: string; title: string }
  | { type: "pinGroupTask"; groupId: string; threadId: string; pinned: boolean; title: string }
  | { type: "setConversationTurnLimit"; groupId: string; threadId: string; minutes: number | null; dm: boolean }
  | { type: "deleteGroupTask"; groupId: string; threadId: string }
  /** Archive, snooze, pin or file one thread of a person conversation (the
   * same fields as a bot thread's updateTask). */
  | { type: "updateGroupTask"; groupId: string; threadId: string; patch: GroupTaskUpdatePatch }
  | { type: "interruptGroup"; groupId: string; threadId?: string; onError?: () => void }
  | { type: "instances"; instances: InstanceInfo[] }
  | { type: "configStatus"; config: ConfigStatus }
  | { type: "liveCall"; call: LiveCallState | null }
  /** A `GET /api/live/call` answer, requested at `since` (liveCallVersion)
   * as lookup number `seq`: applied only if no newer frame landed while it
   * was out, and no later lookup's answer came back first. */
  | { type: "liveCallLookup"; call: LiveCallState | null; since: number; seq: number }
  | { type: "profileSaved"; profile: Partial<NonNullable<ConfigStatus["profile"]>> }
  | { type: "select"; id: string }
  | {
      type: "send";
      botId: string;
      text: string;
      sendId?: string;
      replyToId?: string;
      threadId?: string;
      /** said on a voice call (Message.voiceCall): the turn is a phone turn */
      voiceCall?: VoiceCallMark;
      /** while the conversation works: join, run in parallel or wait
       * (shared/parallel-tasks.ts); absent = join (the server default) */
      busyMode?: BusySendRequest;
      /** A 1:1 /goal. The team path uses sendGroup. */
      mode?: "chat" | "goal";
      /** The Data result the person is viewing, for the model only; never part of the text. */
      dataContext?: import("../../shared/data-context").DataContext;
      onError?: () => void;
      /** the server took the message (its receipt came back) */
      onSent?: () => void;
    }
  | { type: "stopParallelTask"; botId: string; threadId: string }
  | { type: "pendingQueued"; threadId: string; queueId: string; text: string; reason?: SteerQueueReason }
  | { type: "consumePendingQueued"; threadId: string; queueId: string }
  | { type: "cancelQueued"; botId: string; queueId: string; threadId?: string; onCancelled?: () => void }
  | { type: "steerQueued"; botId: string; queueId: string; threadId?: string; onError?: () => void; onSettled?: () => void }
  | { type: "cancelGroupQueued"; groupId: string; threadId: string; queueId: string; onCancelled?: () => void }
  | { type: "steerGroupQueued"; groupId: string; queueId: string; threadId?: string; onError?: () => void; onSettled?: () => void }
  | { type: "editMessage"; botId: string; messageId: string; text: string; threadId?: string; sendId?: string }
  | { type: "switchBranch"; botId: string; messageId: string; threadId?: string }
  | { type: "threadActive"; threadId: string; activeLeafId: string }
  // scrollback: ask the server for the page before the oldest message held
  | { type: "loadOlderMessages"; threadId: string }
  | { type: "olderMessages"; threadId: string; generation: number; messages: Message[]; hasMore: boolean }
  // `threadId` is the thread the card was shown in; `groupId` when the card
  // is in a room: the message lives on the room's list, and the answer goes
  // to the room's thread
  | { type: "answerCard"; botId: string; messageId: string; answer: string; threadId?: string; groupId?: string;
      /** A terminal card: the destination the person picked (absent: the bot's). */
      terminalDestination?: import("../../shared/terminal-request").TerminalDestinationPick }
  | { type: "dismissCard"; botId: string; messageId: string; threadId?: string; groupId?: string }
  // permission cards answer by THREAD, so a request raised inside a room
  // can be answered the same way as one in a 1:1 chat
  | {
      type: "decideRequest";
      threadId: string;
      requestId: string;
      behavior: "allow" | "deny" | "answer";
      message?: string;
      /** Exact proposal hash displayed by a current learned-skill client. */
      reviewedSha256?: string;
      /** remember this exact grant (the server's allowKey) for the bot */
      alwaysAllow?: { botId: string; key: string };
      /** "Always allow this session": the provider keeps the allow */
      always?: boolean;
      /** Remember the server-validated exact command and answer atomically. */
      rememberCommand?: boolean;
      /** 2026-10-14: save the card's ownerRule as the owner's rule (Always
       * allow / Always deny), atomically with the answer. */
      rule?: "allow" | "deny";
      /** 2026-10-26 (#1065): "folder" keeps the card's folder rule (every
       * file of the folder and its subfolders) instead of the exact path. */
      ruleScope?: "folder";
      /** Local UI recovery hook for voice flows. Never sent to the server. */
      onError?: (message: string) => void;
    }
  | { type: "newTask"; botId: string; projectId?: string; cwd?: string; confidential?: boolean; /** "New topic" in the single stream */ stream?: boolean; onCreated?: () => void; onError?: (message: string) => void }
  /** One way only (src/lib/confidential-thread.ts): the server refuses any
   * change back, so the client has no action for it. */
  | { type: "makeTaskConfidential"; botId: string; threadId: string; onDone?: () => void; onError?: (message: string) => void }
  /** `whole`: the whole thread, not its newest page (a search hit can be older). */
  | { type: "switchTask"; botId: string; threadId: string; whole?: true }
  | { type: "switchTaskFailed"; botId: string; threadId: string }
  /** A cached page of the thread a switch is opening, drawn until its snapshot lands. */
  | { type: "previewThread"; botId: string; threadId: string; page: Pick<ThreadPage<Message>, "messages" | "hasMore" | "activeLeafId"> }
  | { type: "taskSwitched"; bot: Bot }
  | { type: "renameTask"; botId: string; threadId: string; title: string }
  /** Name the thread again from its conversation; the new title arrives with the bot event. */
  | { type: "regenerateTaskTitle"; botId: string; threadId: string; onSettled?: (ok: boolean) => void }
  | { type: "deleteTask"; botId: string; threadId: string }
  | { type: "newBot"; role?: BotRole; visibility?: BotVisibility; section?: string; settings?: Record<string, unknown>; preserveSelection?: boolean; onCreated?: (bot: Bot) => void; onError?: (message: string) => void }
  | { type: "botCreationPending"; on: boolean }
  | { type: "updateTask"; botId: string; threadId: string; patch: TaskUpdatePatch }
  /** The server confirmed a thread is now confidential. */
  | { type: "taskMadeConfidential"; botId: string; threadId: string }
  | { type: "refreshTaskPermissions"; botId: string; threadId: string; acknowledgeLocalAuto?: boolean }
  /** "Switch them too": every thread of this bot on a model of its own follows the bot's. */
  | { type: "followBotModel"; botId: string }
  // Folders: a bot's, or with `owner: "group"` a person conversation's
  // (botId is then that conversation's id). One set of actions for both.
  | { type: "createProject"; botId: string; owner?: FolderOwnerKind; name: string; emoji?: string | null; onCreated?: (project: BotProject) => void; onError?: (message: string) => void }
  | { type: "updateProject"; botId: string; owner?: FolderOwnerKind; projectId: string; patch: ProjectUpdatePatch; onSaved?: () => void; onError?: (message: string) => void }
  | { type: "deleteProject"; botId: string; owner?: FolderOwnerKind; projectId: string; onDeleted?: () => void; onError?: (message: string) => void }
  | { type: "reorderProjects"; botId: string; owner?: FolderOwnerKind; projectIds: string[]; onSaved?: () => void; onError?: (message: string) => void }
  | { type: "botAdded"; bot: Bot; preserveSelection?: boolean }
  | { type: "deleteBot"; botId: string }
  | { type: "botDeletionPending"; botId: string; on: boolean }
  | { type: "duplicateBot"; botId: string }
  | { type: "markUnread"; botId: string }
  /** Play a one-shot mascot motion on a bot, as the appearance card's moves do. */
  | { type: "playMascotMotion"; botId: string; kind: Exclude<MausMotion, "none"> }
  | { type: "botPatched"; bot: BotAnnouncement }
  | { type: "messageAdded"; threadId: string; message: Message }
  | { type: "messagePatched"; threadId: string; message: Message }
  /** A card the server already settled elsewhere (a late answer's 409):
   * show its real outcome, found by its request on that conversation. */
  | { type: "cardSettled"; threadId: string; requestId: string; patch: Partial<OptionCardData> }
  /** `restoreLeafId` puts back the branch an optimistic edit replaced; a
   * plain send falls back to the removed row's parent. */
  | { type: "optimisticMessageRemoved"; threadId: string; sendId: string; restoreLeafId?: string | null }
  | { type: "computerStart"; botId: string; start: ComputerStart | null }
  | { type: "computerControl"; botId: string; held: boolean; helpReason: string | null }
  /** A whole sheet from the server: a `data` frame or the first GET. */
  /** threadId: a confidential thread's own sheet (dataSheetKey). */
  | { type: "dataSheet"; sheet: DataSheet; tables?: DataTable[]; threadId?: string }
  | { type: "dataView"; view: AppState["dataView"] }
  | { type: "loadDataSheet"; botId: string; threadId?: string; onError?: (message: string) => void }
  | { type: "modelVariantRuntime"; event: RuntimeEvent }
  | { type: "setModel"; botId: string; selection: ModelSelection; threadId?: string; updateBotDefault?: boolean }
  | { type: "interrupt"; botId: string; threadId?: string; expectedUtteranceId?: string; onError?: () => void }
  | { type: "connected"; value: boolean }
  | { type: "error"; message: string | null }
  | { type: "notice"; notice: AppState["notice"] }
  | { type: "revealThread"; threadId: string }
  | { type: "setThreadReturn"; threadReturn: AppState["threadReturn"] }
  | { type: "toggleSettings"; open?: boolean; section?: BotSettingsSection; botId?: string; owner?: PanelOwner | null }
  | { type: "openRoutine"; botId: string; routineId: string }
  | { type: "routineFocused" }
  | { type: "openRoutineRunSheet"; runId: string; routineId?: string; botId?: string }
  | { type: "closeRoutineRunSheet" }
  | { type: "openPersonPanel"; personId: string | null }
  /** Open a bot's panel on Details with one Coding activity item shown
   * (`run:<routineRunId>` or `thread:<threadId>`), e.g. from the owner's
   * notification of a routine run refused in another person's thread. */
  | { type: "openBotActivity"; botId: string; itemId: string }
  | { type: "botActivityOpened" }
  | { type: "togglePlugins"; open?: boolean; surface?: "apps" | "mcp"; botId?: string | null; page?: "pages" | "providers" | "accounts" | "sources" | "bots" | null; focusApps?: string[] }
  | { type: "toggleTriggers"; open?: boolean }
  | { type: "toggleNewBot"; open?: boolean }
  | { type: "openBotWizard"; botId?: string | null; redo?: boolean }
  | { type: "closeBotWizard" }
  | { type: "toggleComputer"; open?: boolean }
  | { type: "toggleInspector"; open?: boolean }
  | { type: "toggleActivity"; open?: boolean }
  | { type: "focusMessage"; threadId: string; messageId: string; matchText?: string; segment?: true }
  /** Draw a fresh topic over `threadId` (null: show that topic again). */
  | { type: "freshTopic"; botId: string; threadId: string | null; auto?: boolean }
  | { type: "focusMessageConsumed"; nonce: number }
  | { type: "unreadDividerDone"; threadId: string }
  | { type: "toggleAppSettings"; open?: boolean; section?: AppSettingsSection; subPage?: string; phonePairing?: boolean }
  | { type: "openBotCatalog"; section?: "templates"; installUrl?: string }
  | { type: "closeBotCatalog" }
  | { type: "openPersonaEditor"; botId: string; section?: BotSettingsSection }
  | { type: "personaEditorSection"; section: BotSettingsSection }
  | { type: "closePersonaEditor" }
  | { type: "toggleShortcuts"; open?: boolean }
  | { type: "toggleWelcome"; open?: boolean }
  | { type: "toggleLaunch"; open?: boolean; mode?: "solo" | "server" }
  | { type: "toggleTour"; open?: boolean }
  | {
      type: "updateBot";
      botId: string;
      patch: BotUpdatePatch;
    };

/** Discard discoveries when their model/account is replaced or their thread disappears. */
function reconcileModelVariantSessions(state: AppState): AppState {
  const sessions = Object.entries(state.modelVariantSessions);
  const kept = sessions.filter(([threadId, session]) => {
    const owner = state.bots.find((bot) => bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId));
    if (!owner) return false;
    const selection = currentTaskBot(owner, threadId).modelSelection;
    return selection.instanceId === session.instanceId && selection.model === session.model;
  });
  return kept.length === sessions.length ? state : { ...state, modelVariantSessions: Object.fromEntries(kept) };
}

export function pinBotThreadAction(action: Action, bots: Bot[]): Action {
  if (!("botId" in action) || ("threadId" in action && action.threadId) ||
      !["send", "interrupt", "editMessage", "switchBranch", "answerCard", "dismissCard", "cancelQueued", "steerQueued"].includes(action.type)) return action;
  const botId = action.botId;
  const threadId = bots.find((bot) => bot.id === botId)?.threadId;
  return { ...action, threadId } as Action;
}

interface NotificationThreadOwner {
  id: string;
  threadId: string;
  /** A bot's main thread (WireBot.mainThreadId); a room has none. */
  mainThreadId?: string;
  /** The fields the single stream reads (src/lib/single-stream.ts) ride along
   * when the caller has them; a room's tasks need only their ids. */
  tasks?: Array<{ threadId: string; createdAt?: number; routineRunId?: unknown; routineResults?: unknown; hidden?: unknown; confidential?: unknown; openedBy?: unknown; parallelOf?: unknown;
    /** What a return reads (src/lib/fresh-topic.ts). */
    updatedAt?: number; busy?: boolean; activity?: string; unread?: boolean; waitingForTeammates?: boolean }>;
}

interface NotificationRoutingState {
  bots: NotificationThreadOwner[];
  groups: NotificationThreadOwner[];
  /** The runs this client knows; when given, a run it does not know opens
   * its thread as before instead of an empty Routines page. */
  routineRuns?: ReadonlyArray<{ id: string }>;
}

/** 2026-11-01: a routine run opens as an exchange sheet over the chat
 * column (header "<routine> <-> <bot>", bubbles, Close Chat), the same
 * place as a bot-to-bot exchange. Continue in the conversation stays a
 * footer action on that sheet. */
export function openRoutineRun(
  dispatch: (action: Action) => void,
  run: { runId: string; routineId?: string; botId?: string },
) {
  dispatch({
    type: "openRoutineRunSheet",
    runId: run.runId,
    ...(run.routineId ? { routineId: run.routineId } : {}),
    ...(run.botId ? { botId: run.botId } : {}),
  });
}

/** 2026-10-29 (maintainer: "we are in a unified chat"): Continue in the
 * conversation opens the bot's one conversation in the main pane, never a
 * column beside it (the run's own task stays in the run's detail and Run
 * logs). The run's report is scrolled to and quoted in the composer, ready
 * for a reply. A report that went to a thread outside the conversation (an
 * older version's results thread) opens the conversation all the same.
 * Returns the conversation it opened. */
export function continueRoutineRunInConversation(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId" | "mainThreadId" | "tasks"> & { messages?: readonly Message[] },
  run: Pick<RoutineRun, "id" | "output" | "resultsThreadId" | "sourceThreadId">,
  threadsShown: boolean,
): string {
  const home = botOpensTo(bot, false);
  const reported = run.resultsThreadId ?? run.sourceThreadId;
  const task = reported ? bot.tasks?.find((candidate) => candidate.threadId === reported) : undefined;
  const inConversation = Boolean(task && typeof task.createdAt === "number" && isStreamSegment({ ...task, createdAt: task.createdAt }));
  const target = reported && (reported === home || inConversation) ? reported : home;
  openBotThread(dispatch, bot, target, threadsShown);
  // The report itself, when this window holds it (the topic on screen).
  const report = target === bot.threadId
    ? bot.messages?.find((message) => message.kind === "routine.run" && message.routineRun?.runId === run.id)
    : undefined;
  if (report) dispatch({ type: "focusMessage", threadId: target, messageId: report.id });
  const quote = (report?.routineRun?.summary ?? run.output ?? "").trim().slice(0, CITATION_MAX_QUOTE_LENGTH);
  if (quote) {
    try {
      // the composer of the conversation now on screen
      const composerThread = threadsShown ? target : home;
      appendDraftAttachments(`bot:${bot.id}:${composerThread}`, [citationAttachment(
        { ownerType: "bot", ownerId: bot.id, threadId: target, messageId: report?.id ?? `routine-run:${run.id}` },
        { text: quote, start: 0, end: quote.length, prefix: "", suffix: "" },
      )]);
    } catch {
      // no quote: the conversation is open all the same
    }
  }
  return target;
}

/** The routine run a thread is the execution of, if any. */
export function routineRunOfThread(state: NotificationRoutingState, threadId: string | undefined): string | undefined {
  if (!threadId) return undefined;
  for (const owner of [...state.bots, ...state.groups]) {
    const task = owner.tasks?.find((candidate) => candidate.threadId === threadId);
    if (task && typeof task.routineRunId === "string" && task.routineRunId) return task.routineRunId;
  }
  return undefined;
}

/** The exact conversation currently on screen. A focused window is not
 * enough to suppress an alert when its actionable card is in another task. */
export function visibleNotificationThread(
  state: NotificationRoutingState & Pick<AppState, "activeView" | "selectedId">,
): string | null {
  if (state.activeView !== "chat") return null;
  return (
    state.bots.find((candidate) => candidate.id === state.selectedId)?.threadId ??
    state.groups.find((candidate) => candidate.id === state.selectedId)?.threadId ??
    null
  );
}

export function openNotificationTarget(
  dispatch: (action: Action) => void,
  target: NotificationTarget,
  state: NotificationRoutingState,
  threadsShown: boolean,
  options: { runDetail?: boolean } = {},
) {
  // A routine run refused in another person's private thread: the owner's
  // notification names no thread, only the run, which the bot's Coding
  // activity shows with its access card (shared/notification.ts).
  if (!target.threadId && target.routineRunId) {
    dispatch({ type: "openBotActivity", botId: target.botId, itemId: `run:${target.routineRunId}` });
    return;
  }
  // 2026-10-29: a run's notification, or a link to a run's own execution
  // thread (an Inbox entry, an activity line), opens the run detail, never
  // a conversation beside the chat. openThread asks for the thread itself.
  if (options.runDetail !== false) {
    const runId = target.routineRunId ?? routineRunOfThread(state, target.threadId);
    if (runId && (!state.routineRuns || state.routineRuns.some((run) => run.id === runId))) {
      openRoutineRun(dispatch, { runId });
      return;
    }
  }
  // A room's approval/question notification carries the asker bot with the
  // GROUP's thread id; asking the bot to switch to that thread would 404.
  // Open the room itself. Cross-bot routine receipts carry the executing
  // bot but report into the requesting bot's thread: resolve its actual
  // owner before selecting. An unknown/deleted thread falls back to the bot.
  const group = state.groups.find(
    (candidate) =>
      candidate.threadId === target.threadId ||
      (candidate.tasks ?? []).some((task) => task.threadId === target.threadId),
  ) ?? (target.groupId ? state.groups.find((candidate) => candidate.id === target.groupId) : undefined);
  if (group) {
    dispatch({ type: "select", id: group.id });
    if (target.threadId && group.threadId !== target.threadId && (group.tasks ?? []).some((task) => task.threadId === target.threadId)) {
      dispatch({ type: "switchGroupTask", groupId: group.id, threadId: target.threadId });
    }
    return;
  }
  const bot = state.bots.find((candidate) =>
    candidate.threadId === target.threadId || candidate.tasks?.some((task) => task.threadId === target.threadId)
  ) ?? state.bots.find((candidate) => candidate.id === target.botId);
  if (!bot) {
    dispatch({ type: "select", id: target.botId });
    return;
  }
  const known =
    bot.threadId === target.threadId ||
    (bot.tasks ?? []).some((task) => task.threadId === target.threadId);
  // One conversation: openBotThread is the gate (an earlier segment scrolls
  // the conversation back, a thread outside the stream opens beside it). A
  // notification always opens the topic it is about, never a fresh one.
  if (known && target.threadId) openBotThread(dispatch, bot, target.threadId, threadsShown);
  else openBot(dispatch, bot, threadsShown, { landing: false });
}

/** Threads hidden: whether `threadId` opens beside the one conversation
 * instead of in its place. A thread of the bot that is not part of its
 * stream (shared/single-stream.ts) while the bot has a stream to stay on,
 * and not the thread the bot already shows. */
export function opensBesideStream(bot: Pick<NotificationThreadOwner, "threadId" | "tasks">, threadId: string): boolean {
  if (threadId === bot.threadId || !streamHomeThread(bot.tasks, bot.threadId)) return false;
  const tasks = (bot.tasks ?? []).filter((task): task is typeof task & { createdAt: number } => typeof task.createdAt === "number");
  return opensBesideConversation(tasks, threadId);
}

/** The fresh topic drafts without the one of the bot that owns `threadId`. */
function withoutFreshTopicFor(state: Pick<AppState, "freshTopic" | "bots">, threadId: string): AppState["freshTopic"] {
  const drafts = state.freshTopic;
  const owner = Object.keys(drafts).find((botId) => drafts[botId]?.threadId === threadId
    || state.bots.some((bot) => bot.id === botId && (bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId))));
  if (!owner) return drafts;
  const { [owner]: _gone, ...rest } = drafts;
  return rest;
}

/** Whether a send is the first message of a fresh topic: typed in the
 * bot's conversation while a fresh topic is drawn over its live topic. A
 * voice call's words stay with the call's own thread. */
export function sendsToFreshTopic(state: Pick<AppState, "freshTopic" | "bots">, action: { botId: string; threadId?: string; voiceCall?: unknown }): boolean {
  const draft = state.freshTopic[action.botId];
  if (!draft || action.voiceCall) return false;
  const bot = state.bots.find((candidate) => candidate.id === action.botId);
  const threadId = action.threadId ?? bot?.threadId;
  return Boolean(bot && threadId === draft.threadId && freshTopicCovers(bot, draft.threadId));
}

/** Whether a fresh topic can cover `threadId` on this bot: threads hidden,
 * the bot on that thread, and a stream segment (never a confidential,
 * hidden, routine, bot-opened or parallel thread). ChatView, the send and
 * New topic all ask this one question. */
export function freshTopicCovers(bot: Pick<NotificationThreadOwner, "threadId" | "tasks">, threadId: string): boolean {
  if (!singleStreamTurnField().singleStream || bot.threadId !== threadId) return false;
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  return Boolean(task && typeof task.createdAt === "number" && isStreamSegment({ ...task, createdAt: task.createdAt }));
}

/** The thread opening a bot itself shows. With threads shown, the one it
 * was on. With threads hidden the bot is one conversation, its main thread
 * (WireBot.mainThreadId), so a thread a notification or an activity row
 * opened is left on the next open; one this window has no row for yet
 * keeps the selection. */
export function botOpensTo(bot: Pick<NotificationThreadOwner, "threadId" | "mainThreadId" | "tasks">, threadsShown: boolean): string {
  if (threadsShown) return bot.threadId;
  // The one conversation (shared/single-stream.ts): the server's answer
  // first (WireBot.mainThreadId, the same rule, worked out over every
  // thread it knows), else this window's over the threads it has.
  const main = bot.mainThreadId;
  const mainTask = main ? bot.tasks?.find((task) => task.threadId === main) : undefined;
  if (mainTask && typeof mainTask.createdAt === "number" && isStreamSegment({ ...mainTask, createdAt: mainTask.createdAt })) return main!;
  return streamHomeThread(bot.tasks, bot.threadId) ?? (main && mainTask ? main : bot.threadId);
}

/** With threads hidden the bot is one conversation, its main thread; a side
 * thread a notification, a chip or an activity row opened is a visit, so the
 * chat header offers the way back (ChatView). Never with threads shown. */
export function awayFromMainThread(bot: Pick<NotificationThreadOwner, "threadId" | "mainThreadId" | "tasks">, threadsShown: boolean): boolean {
  return !threadsShown && botOpensTo(bot, false) !== bot.threadId;
}

/** Open a bot itself: its row, its pinned circle, the palette, the + menu,
 * ⌘1–9, the team map, a link to the bot, the bot a dead thread link falls
 * back to, the bot the app reopens at launch, Edit profile on another bot,
 * a restored bot, the next one after archiving, its voice settings from a
 * room, or the chat a Cloud's setup job went to. It opens where botOpensTo
 * says. The bot on screen is selected again where it is (its computer from
 * the workspace view, its own Edit profile): the person sees that thread. */
export function openBot(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId" | "mainThreadId" | "tasks">,
  threadsShown: boolean,
  options: { landing?: boolean } = {},
) {
  const opened = botOpensTo(bot, threadsShown);
  if (opened === bot.threadId) dispatch({ type: "select", id: bot.id });
  else openBotThread(dispatch, bot, opened, threadsShown);
  // Coming back to the single stream after a while lands on a fresh topic
  // (src/lib/fresh-topic.ts). A notification or a link passes landing false.
  if (!threadsShown && options.landing !== false) landOnBot(dispatch, bot, opened);
  // a notification or a link: what it names is shown, never a draft over it
  else dispatch({ type: "freshTopic", botId: bot.id, threadId: null });
}

/** Coming back to `bot` at `threadId`: a fresh topic drawn over it when the
 * rule says so (shared/fresh-topic.ts), else that topic as it is. */
export function landOnBot(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "tasks">,
  threadId: string,
  options: { force?: boolean; now?: number } = {},
) {
  // Opening the bot already on screen is not a return: its draft stays.
  if (!options.force && onScreenBot() === bot.id) return;
  const decision = freshTopicLanding(bot, threadId, { now: options.now ?? Date.now(), ...(options.force ? { force: true } : {}) });
  if (decision.fresh) dispatch({ type: "freshTopic", botId: bot.id, threadId, auto: true });
  // Opening the bot by hand shows the topic it opens to; the window coming
  // back (force) keeps a New topic the person started.
  else if (!options.force) dispatch({ type: "freshTopic", botId: bot.id, threadId: null });
}

/** "New topic" (the chat header, the bot row menu): the bot's conversation
 * with a fresh, empty topic drawn over its newest one, created on the
 * server with the first message (src/lib/fresh-topic.ts). A topic nobody
 * wrote in yet already is a new topic: it opens as it is. */
export function startNewTopic(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId" | "mainThreadId" | "tasks">,
) {
  const opened = botOpensTo(bot, false);
  openBot(dispatch, bot, false, { landing: false });
  const task = bot.tasks?.find((candidate) => candidate.threadId === opened);
  const empty = !task || typeof task.updatedAt !== "number" || typeof task.createdAt !== "number" || task.updatedAt <= task.createdAt;
  // only over a topic of the stream: a confidential or routine thread never
  if (!empty && task && typeof task.createdAt === "number" && isStreamSegment({ ...task, createdAt: task.createdAt })) {
    dispatch({ type: "freshTopic", botId: bot.id, threadId: opened });
  }
}

/** Open one of a bot's threads, as a notification, a chip, a link or a
 * button names it: a switch, once the bot is selected. With threads hidden
 * another thread than the one the bot is on opens by the switch alone,
 * which selects the bot too, so the thread left behind keeps its unread
 * mark: only an activity row reaches it, and a reply there must not pass
 * as read unseen, nor while the switch is under way (Bot.switchingTo). */
export function openBotThread(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId" | "mainThreadId" | "tasks">,
  threadId: string,
  threadsShown: boolean,
) {
  // THE gate with one conversation (shared/single-stream.ts): every way
  // into one of a bot's threads (a notification, a chip, a link, a search
  // hit, an activity row, a routine's run, a bot's remote command) passes
  // here, so the conversation never gives way to another thread.
  // - An earlier segment is part of the one conversation: the bot opens at
  //   its newest segment and the timeline scrolls back to that topic.
  // - A thread outside the stream (a parallel task's detail, a bot's job, a
  //   run, a confidential thread) opens in the side column beside the
  //   conversation (SideThreadPanel); Close or Escape is the way back.
  // - The conversation itself, or a bot with no conversation: shown.
  if (!threadsShown) {
    // an earlier topic, even the one this window was left on: the
    // conversation opens at its end and scrolls back to it
    if (isEarlierSegment(bot.tasks, threadId, bot.threadId)) {
      dispatch({ type: "focusMessage", threadId, messageId: "", segment: true });
      openBot(dispatch, bot, false, { landing: false });
      return;
    }
    // 2026-10-29: a routine's report never opens a column beside the
    // conversation. A run's own task opens its detail (logs, approvals,
    // reply); an older version's results thread, read there and in Run
    // logs, opens the conversation its reports now go to.
    const task = threadId !== bot.threadId ? bot.tasks?.find((candidate) => candidate.threadId === threadId) : undefined;
    if (task && typeof task.routineRunId === "string" && task.routineRunId) {
      openRoutineRun(dispatch, { runId: task.routineRunId });
      return;
    }
    const home = task?.routineResults === true ? botOpensTo(bot, false) : undefined;
    if (home && home !== threadId) {
      openBotThread(dispatch, bot, home, false);
      return;
    }
    if (threadId !== bot.threadId && opensBesideStream(bot, threadId)) {
      openBot(dispatch, bot, false, { landing: false });
      openSideThread({ botId: bot.id, threadId });
      return;
    }
  }
  if (threadsShown || threadId === bot.threadId) dispatch({ type: "select", id: bot.id });
  dispatch({ type: "switchTask", botId: bot.id, threadId });
  // A thread opened by name is shown, never a fresh topic over it.
  dispatch({ type: "freshTopic", botId: bot.id, threadId: null });
}

/** A thread the person can open from a chip or a #Title link. */
export interface ThreadTarget {
  botId: string;
  threadId: string;
}

interface ThreadOpeningState extends NotificationRoutingState {
  bots: Array<NotificationThreadOwner & { name: string }>;
  /** The conversation on screen. Absent only in callers that have no view. */
  selectedId?: string;
}

/** Where a thread chip should return. Null when nothing is on screen, or
 * the chip opens the conversation already showing. */
function threadReturnFor(state: ThreadOpeningState, targetThreadId: string): AppState["threadReturn"] {
  const owner = state.bots.find((candidate) => candidate.id === state.selectedId)
    ?? state.groups.find((candidate) => candidate.id === state.selectedId);
  if (!owner || owner.threadId === targetThreadId) return null;
  return { ownerId: owner.id, threadId: owner.threadId };
}

/** Open a thread the person clicked: select its bot (or room) and switch
 * the VIEW to that thread — never the work; a turn running elsewhere keeps
 * running (the #981 rule). The sidebar then reveals the row. A thread this
 * client no longer knows (deleted, or not yet announced) falls back to the
 * bot with a quiet notice rather than a 404 or a crash. Returns whether the
 * thread was found. */
export function openThread(
  dispatch: (action: Action) => void,
  target: ThreadTarget,
  state: ThreadOpeningState,
  threadsShown: boolean,
): boolean {
  const owns = (owner: NotificationThreadOwner) =>
    owner.threadId === target.threadId || (owner.tasks ?? []).some((task) => task.threadId === target.threadId);
  if (state.groups.some(owns) || state.bots.some(owns)) {
    const threadReturn = threadReturnFor(state, target.threadId);
    openNotificationTarget(dispatch, target, state, threadsShown, { runDetail: false });
    dispatch({ type: "revealThread", threadId: target.threadId });
    // The way back is a thread chip: with threads hidden the switch alone opens it.
    if (threadReturn && threadsShown) dispatch({ type: "setThreadReturn", threadReturn });
    return true;
  }
  const bot = state.bots.find((candidate) => candidate.id === target.botId);
  if (bot) openBot(dispatch, bot, threadsShown);
  dispatch({ type: "notice", notice: { kind: "thread-gone", botName: bot?.name ?? null } });
  return false;
}

/** Retire the scrollback pages a thread has in flight: whatever they return
 * describes a transcript this client no longer holds. */
function bumpTranscriptGeneration(state: AppState, threadId: string | undefined | null): AppState {
  if (!threadId) return state;
  return {
    ...state,
    transcriptGeneration: {
      ...state.transcriptGeneration,
      [threadId]: (state.transcriptGeneration[threadId] ?? 0) + 1,
    },
  };
}

/** The threads read when `shownThreadId` is on screen: that one, and with
 * threads hidden every unread thread the one conversation holds besides it
 * (streamUnreadReadWith). The person reads the bot's conversation, not one
 * segment of it: none of them has a sidebar row to clear it later. */
export function threadsReadOnScreen(bot: Pick<Bot, "tasks">, shownThreadId: string): string[] {
  return [shownThreadId, ...(singleStreamTurnField().singleStream ? streamUnreadReadWith(bot.tasks, shownThreadId) : [])];
}

/** `bot` once what is on screen at `shownThreadId` is read. */
function readOnScreen(bot: Bot, shownThreadId: string): Bot {
  const read = new Set(threadsReadOnScreen(bot, shownThreadId));
  return { ...bot,
    unread: Boolean(bot.tasks?.some((task) => !read.has(task.threadId) && task.unread)),
    tasks: bot.tasks?.map((task) => read.has(task.threadId) ? { ...task, unread: false } : task) };
}

function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot): AppState {
  return { ...state, bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)) };
}

function withMascotMotion(
  state: AppState,
  botId: string,
  kind: Exclude<MausMotion, "none">,
): AppState {
  return {
    ...state,
    mascotMotion: {
      botId,
      nonce: (state.mascotMotion?.nonce ?? 0) + 1,
      kind,
    },
  };
}

function withPatchedCard(messages: Message[], messageId: string, patch: Partial<OptionCardData>): Message[] {
  return messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } } : m));
}

function patchCard(state: AppState, botId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return updateBot(state, botId, (b) => ({ ...b, messages: withPatchedCard(b.messages, messageId, patch) }));
}

function patchGroupCard(state: AppState, groupId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, messages: withPatchedCard(g.messages, messageId, patch) } : g,
    ),
  };
}

/** First-run quiz still sitting on this bot's thread. */
function openOnboardingCard(bot: Bot): Message | undefined {
  return bot.messages.find(
    (message) => message.kind === "options" && message.card && !message.card.requestId && !message.card.dismissed,
  );
}

function dismissOnboardingCard(state: AppState, botId: string): AppState {
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const quiz = bot ? openOnboardingCard(bot) : undefined;
  return quiz ? patchCard(state, botId, quiz.id, { dismissed: true }) : state;
}

const optimisticMessageId = (sendId: string): string => `optimistic-${sendId}`;

function optimisticUserMessage(
  text: string,
  sendId: string,
  replyToId?: string,
  parentId?: string | null,
  channelMode?: "chat" | "goal",
  voiceCall?: VoiceCallMark,
): Message {
  return {
    id: optimisticMessageId(sendId),
    role: "user",
    kind: "text",
    text,
    at: Date.now(),
    parentId: parentId ?? null,
    replyToId,
    sendId,
    channelMode,
    ...(voiceCall ? { voiceCall } : {}),
  };
}

/** Where a folder action goes: a bot's folders, or a group's. */
export function folderOwnerPath(action: { botId: string; owner?: FolderOwnerKind }): string {
  return action.owner === "group" ? `/api/groups/${action.botId}` : `/api/bots/${action.botId}`;
}

/** A folder answer carries its owner as it is now: the bot, or the group. */
function applyFolderOwner(
  dispatch: (action: Action) => void,
  action: { owner?: FolderOwnerKind },
  answer: { bot?: BotAnnouncement; group?: Partial<Group> & { id: string } },
): void {
  if (action.owner === "group") {
    if (answer.group) dispatch({ type: "groupPatched", group: answer.group });
  } else if (answer.bot) {
    dispatch({ type: "botPatched", bot: answer.bot });
  }
}

/** A person conversation: an update that names another thread than the one
 * this client has open keeps it open, unless the update carries a
 * transcript (the answer to a switch, a create or a fresh load) or that
 * thread is gone. A live frame always names the conversation's default
 * thread (server/people-dms.ts). */
export function personThreadKept(
  held: Pick<Group, "threadId" | "tasks"> & { peopleDm?: boolean },
  patch: Partial<Group>,
): boolean {
  if (!(held.peopleDm || patch.peopleDm) || patch.messages) return false;
  if (typeof patch.threadId !== "string" || patch.threadId === held.threadId) return false;
  return (patch.tasks ?? held.tasks ?? []).some((task) => task.threadId === held.threadId);
}

/** What reading a person conversation means now: the open thread when it
 * is unread, the whole conversation when only the conversation itself is
 * marked unread (Mark unread, or a record from before threads), else
 * nothing. Never a sibling thread: its dot stays until it is opened. */
export function peopleDmReadTarget(group: Partial<Pick<Group, "threadId" | "tasks" | "unread">>): { threadId?: string } | null {
  const tasks = group.tasks ?? [];
  const open = tasks.find((task) => task.threadId === group.threadId);
  if (open?.unread) return { threadId: open.threadId };
  if (group.unread && !tasks.some((task) => task.unread)) return {};
  return null;
}

/** The right panel follows the selection, the way the bot panel does: with
 * a person's or a bot's panel open, selecting a direct conversation with a
 * person shows that person, and selecting a bot or a group shows its own
 * panel. With no panel open, nothing opens. */
export function panelFollowsSelection(state: Pick<AppState, "personPanelId" | "settingsOpen" | "groups" | "config">, id: string): Partial<Pick<AppState, "personPanelId" | "settingsOpen">> {
  if (!state.personPanelId && !state.settingsOpen) return {};
  const group = state.groups.find((candidate) => candidate.id === id);
  if (group?.peopleDm) {
    const me = state.config?.viewer?.principalId?.trim().toLowerCase();
    const other = (group.humanIds ?? []).find((human) => human.trim().toLowerCase() !== me);
    return other ? { personPanelId: other, settingsOpen: false } : {};
  }
  return state.personPanelId ? { personPanelId: null, settingsOpen: !group?.dm } : {};
}

/** Drop the way-back once the remembered conversation is the one on screen. */
function clearThreadReturnIfHome(state: AppState): AppState {
  const back = state.threadReturn;
  if (!back || state.selectedId !== back.ownerId) return state;
  const owner = state.bots.find((candidate) => candidate.id === back.ownerId)
    ?? state.groups.find((candidate) => candidate.id === back.ownerId);
  return owner?.threadId === back.threadId ? { ...state, threadReturn: null } : state;
}

/** Where Browse Bots opens when it is not its home view. */
export interface BotCatalogTarget {
  section: "templates";
  /** An install link (openmaus://, a team's address): previewed in Import. */
  installUrl?: string;
}

/** Open the organisation bot catalogue ("Browse Bots"), on its home view or
 * on its Templates section. */
export function openBotCatalog(target?: BotCatalogTarget): Action {
  if (!target) return { type: "openBotCatalog" };
  return { type: "openBotCatalog", section: target.section, ...(target.installUrl ? { installUrl: target.installUrl } : {}) };
}

/** Close the organisation bot catalogue. */
export function closeBotCatalog(): Action {
  return { type: "closeBotCatalog" };
}

/** The split-view section whose bot or group owns the panel
 * (AppState.panelOwner). */
export type PanelOwner =
  | { leafId: string; botId: string; groupId?: undefined }
  | { leafId: string; groupId: string; botId?: undefined };

export function reducer(state: AppState, action: Action): AppState {
  const next = reduce(state, action);
  // A section's panel lasts as long as the panel: closed, it is gone.
  return next.panelOwner && !next.settingsOpen && !next.computerOpen ? { ...next, panelOwner: null } : next;
}

function reduce(state: AppState, action: Action): AppState {
  if (action.type === "messageAdded" || action.type === "messagePatched" || action.type === "threadActive" || action.type === "optimisticMessageRemoved") {
    const owner = state.bots.find((bot) => (bot.threadId !== action.threadId || bot.awaitingThreadSnapshot) && bot.tasks?.some((task) => task.threadId === action.threadId));
    if (owner) {
      // ponytail: a bounded race buffer, not a second transcript store. The
      // server supplies complete history whenever this thread is reopened.
      const frames = [...(state.backgroundThreadEvents[action.threadId] ?? []), action].slice(-256);
      const buffered = { ...state, backgroundThreadEvents: { ...state.backgroundThreadEvents, [action.threadId]: frames } };
      return action.type === "messageAdded"
        ? bumpThreadUpdatedAt(buffered, action.threadId, action.message.at)
        : buffered;
    }
  }
  switch (action.type) {
    case "hydrate": {
      const known = (id: string) => action.bots.some((b) => b.id === id) || action.groups.some((g) => g.id === id);
      const resume = action.resumeId;
      // A remembered conversation only counts while it still resolves to a
      // conversation the sidebar lists; a deleted, hidden or closed one
      // falls back, and the fallback is listed too or nothing at all.
      const hidden = state.sidebarHiddenKeys;
      const resumed = resume && selectionListed(action.bots, action.groups, resume, hidden) ? resume : "";
      const selectedId =
        state.selectedId && known(state.selectedId) ? state.selectedId : resumed || fallbackSelection(action.bots, action.groups, hidden);
      const hydrated = {
        ...state,
        bots: action.bots.map((bot) => {
          const previous = state.bots.find((candidate) => candidate.id === bot.id);
          return previous ? { ...bot, tasks: mergeTaskStamps(previous.tasks, bot.tasks) } : bot;
        }),
        groups: action.groups.map((group) => {
          const previous = state.groups.find((candidate) => candidate.id === group.id);
          return previous ? { ...group, tasks: mergeTaskStamps(previous.tasks, group.tasks) } : group;
        }),
        sections: action.sections ?? [],
        computerControl: action.computerControl,
        selectedId,
        hydrated: true as const,
        backgroundThreadEvents: {},
        loadingOlder: {},
        transcriptGeneration: {},
        modelVariantSessions: {},
      };
      return reconcileSnapshotQueues(
        action.botQueuedMessages ? replaceBotQueues(hydrated, action.botQueuedMessages) : hydrated,
        [...action.bots, ...action.groups],
      );
    }
    case "loadOlderMessages":
      return state.loadingOlder[action.threadId]
        ? state
        : { ...state, loadingOlder: { ...state.loadingOlder, [action.threadId]: true } };
    case "olderMessages": {
      const { [action.threadId]: _done, ...loadingOlder } = state.loadingOlder;
      // The page describes the transcript as it was when it was asked for.
      // If that transcript has since been replaced or rewound, the rows it
      // carries may belong to an abandoned branch — drop them, but never
      // leave the pill spinning.
      if ((state.transcriptGeneration[action.threadId] ?? 0) !== action.generation) {
        return { ...state, loadingOlder };
      }
      const prepend = <T extends { messages: Message[]; threadId: string; hasMore?: boolean }>(owner: T): T => {
        const held = new Set(owner.messages.map((message) => message.id));
        return {
          ...owner,
          // A page that raced an edit or a branch switch can overlap what is
          // already held; the held copy is the newer one.
          messages: [...action.messages.filter((message) => !held.has(message.id)), ...owner.messages],
          hasMore: action.hasMore,
        };
      };
      return {
        ...state,
        loadingOlder,
        bots: state.bots.map((bot) => (bot.threadId === action.threadId ? prepend(bot) : bot)),
        groups: state.groups.map((group) => (group.threadId === action.threadId ? prepend(group) : group)),
      };
    }
    case "sectionDeleted":
      return {
        ...state, sections: action.sections,
        bots: state.bots.map(bot => bot.section === action.section ? { ...bot, section: undefined } : bot),
        groups: state.groups.map(group => group.section === action.section ? { ...group, section: undefined } : group),
      };
    case "sections":
      return { ...state, sections: action.sections };
    case "botQueues":
      return reconcileSnapshotQueues(replaceBotQueues(state, action.queues), [...state.bots, ...state.groups]);
    case "showRoutines":
      return {
        ...state,
        activeView: "routines",
        routinesFocus: { section: action.section, view: action.view, botId: action.botId, routineId: action.routineId, runStatus: action.runStatus, runId: action.runId, nonce: state.routinesFocus.nonce + 1 },
        settingsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showChat":
      return state.activeView === "chat" ? state : { ...state, activeView: "chat" };
    case "showCode":
      return {
        ...state,
        activeView: "code",
        codeFocus: { ...(action.runId ? { runId: action.runId } : {}), nonce: state.codeFocus.nonce + 1 },
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showApprovals":
      return {
        ...state,
        activeView: "approvals",
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showRemoteSessions":
      return {
        ...state,
        activeView: "remote-sessions",
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showAchievements":
      return {
        ...state,
        activeView: "achievements",
        achievementsFocus: { category: action.category ?? "all", nonce: state.achievementsFocus.nonce + 1 },
        settingsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        appSettingsSubPage: null,
        pluginsOpen: false,
        triggersOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        personaEditor: null,
      };
    case "showTeamMap":
      return {
        ...state,
        activeView: "team-map",
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "routinesHydrated":
      return { ...state, routines: action.routines, routineRuns: trimRoutineRuns(action.runs), routinesLoadState: "ready", ...(action.folders ? { routineFolders: action.folders } : {}) };
    case "routineFoldersPatched":
      return { ...state, routineFolders: { ...state.routineFolders, [action.botId]: action.folders } };
    case "routinesLoadFailed":
      return { ...state, routinesLoadState: "error" };
    case "routinePatched": {
      const exists = state.routines.some((routine) => routine.id === action.routine.id);
      return {
        ...state,
        routines: exists
          ? state.routines.map((routine) => (routine.id === action.routine.id ? action.routine : routine))
          : [action.routine, ...state.routines],
      };
    }
    case "routineDeleted":
      return { ...state, routines: state.routines.filter((routine) => routine.id !== action.routineId) };
    case "routineRunsRemoved": {
      const gone = new Set(action.ids);
      return { ...state, routineRuns: state.routineRuns.filter((run) => !gone.has(run.id)) };
    }
    case "routineRunPatched": {
      const exists = state.routineRuns.some((run) => run.id === action.run.id);
      const runs = exists
        ? state.routineRuns.map((run) => (run.id === action.run.id ? action.run : run))
        : [action.run, ...state.routineRuns];
      return {
        ...state,
        routineRuns: trimRoutineRuns(runs),
      };
    }
    case "webhooksHydrated":
      return { ...state, webhooks: action.webhooks, webhookAttempts: action.attempts, webhookIngress: action.ingress, webhookGraphConnectors: action.graphConnectors ?? [] };
    case "webhookPatched": {
      const exists = state.webhooks.some((webhook) => webhook.id === action.webhook.id);
      return {
        ...state,
        webhooks: exists
          ? state.webhooks.map((webhook) => (webhook.id === action.webhook.id ? action.webhook : webhook))
          : [action.webhook, ...state.webhooks],
      };
    }
    case "webhookDeleted":
      return {
        ...state,
        webhooks: state.webhooks.filter((webhook) => webhook.id !== action.webhookId),
        webhookAttempts: state.webhookAttempts.filter((attempt) => attempt.webhookId !== action.webhookId),
      };
    case "webhookAttempted": {
      const attempts = state.webhookAttempts.some((attempt) => attempt.id === action.attempt.id)
        ? state.webhookAttempts.map((attempt) => attempt.id === action.attempt.id ? action.attempt : attempt)
        : [...state.webhookAttempts, action.attempt];
      return { ...state, webhookAttempts: attempts.slice(-2_000) };
    }
    case "groupPatched": {
      // A payload carrying a transcript replaces what this client holds, so
      // pages asked for under the old one no longer describe it.
      const fenced = action.group.messages ? bumpTranscriptGeneration(state, action.group.threadId) : state;
      const exists = fenced.groups.some((g) => g.id === action.group.id);
      const groups = exists
        ? fenced.groups.map((g) => (g.id === action.group.id ? {
            ...g, ...action.group,
            // A person conversation: a frame names its default thread; the
            // thread this person has open stays open (server/people-dms.ts).
            threadId: personThreadKept(g, action.group) ? g.threadId : (action.group.threadId ?? g.threadId),
            section: typeof action.group.threadId === "string" || Object.hasOwn(action.group, "section") ? action.group.section : g.section,
            tasks: action.group.tasks ? mergeTaskStamps(g.tasks, action.group.tasks) : g.tasks,
            turnTimeoutMinutes: Object.hasOwn(action.group, "turnTimeoutMinutes")
              ? (action.group.turnTimeoutMinutes ?? undefined)
              : g.turnTimeoutMinutes,
            messages: action.group.messages ?? g.messages,
            // A payload that carries a transcript answers the scrollback
            // question with it: a bounded page says so, and a frame sent
            // without that marker is the whole thread.
            hasMore: action.group.messages ? Boolean(action.group.hasMore) : g.hasMore,
          } : g))
        : [{ ...(action.group as Group), messages: action.group.messages ?? [] }, ...fenced.groups];
      return clearThreadReturnIfHome({ ...fenced, groups });
    }
    case "groupDeleted": {
      const groups = state.groups.filter((g) => g.id !== action.groupId);
      const selectedId = state.selectedId === action.groupId ? fallbackSelection(state.bots, groups, state.sidebarHiddenKeys) : state.selectedId;
      return { ...state, groups, selectedId };
    }
    case "sidebarHidden": {
      const next = { ...state, sidebarHiddenKeys: action.keys };
      // Closing or hiding the open conversation (here or on another device)
      // leaves it: the next listed one opens, else the empty state.
      return selectionNewlyHidden(state.bots, state.groups, state.selectedId, state.sidebarHiddenKeys, action.keys)
        ? { ...next, selectedId: fallbackSelection(state.bots, state.groups, action.keys) }
        : next;
    }
    case "instances":
      return { ...state, instances: action.instances };
    case "configStatus":
      return { ...state, config: action.config };
    case "liveCall":
      return { ...state, liveCall: action.call, liveCallVersion: state.liveCallVersion + 1 };
    case "liveCallLookup":
      return action.since === state.liveCallVersion && action.seq > state.liveCallLookupSeq
        ? { ...state, liveCall: action.call, liveCallLookupSeq: action.seq }
        : state;
    case "profileSaved":
      return state.config ? {
        ...state,
        config: { ...state.config, profile: { name: "", email: "", ...state.config.profile, ...action.profile } },
      } : state;
    case "select": {
      const leaving = Boolean(state.threadReturn) && action.id !== state.selectedId && action.id !== state.threadReturn?.ownerId;
      const base = leaving ? { ...state, threadReturn: null } : state;
      const room = base.groups.find((g) => g.id === action.id);
      if (room) {
        return clearThreadReturnIfHome({
          ...base,
          ...panelFollowsSelection(base, action.id),
          unreadDivider: openedUnreadDivider(base, room.threadId, Boolean(room.unread), room.messages, room.lastReadMessageId),
          activeView: "chat",
          selectedId: action.id,
          groups: base.groups.map((g) => (g.id === action.id ? { ...g, unread: false } : g)),
        });
      }
      const opened = base.bots.find((b) => b.id === action.id);
      return clearThreadReturnIfHome(updateBot(
        withMascotMotion(
          {
            ...base,
            ...panelFollowsSelection(base, action.id),
            unreadDivider: opened
              ? openedUnreadDivider(base, opened.threadId, threadOpensUnread(opened), visibleMessages(opened), threadReadCursor(opened))
              : base.unreadDivider,
            activeView: "chat",
            selectedId: action.id,
          },
          action.id,
          "switch",
        ),
        action.id,
        (b) => readOnScreen(b, b.threadId),
      ));
    }
    // optimistic card settle; the server's message.patch confirms it later
    case "answerCard": {
      if (action.groupId) return patchGroupCard(state, action.groupId, action.messageId, { answered: action.answer });
      const bot = state.bots.find((candidate) => candidate.id === action.botId);
      const card = bot?.messages.find((message) => message.id === action.messageId)?.card;
      return withMascotMotion(
        patchCard(state, action.botId, action.messageId, {
          answered: action.answer,
          // talking past the first-run quiz hides it; live asks and a
          // proactive proposal stay, with the pick marked
          ...(card?.requestId || card?.proactiveProposal ? {} : { dismissed: true }),
          ...(card?.proactiveProposal ? { answeredText: action.answer } : {}),
        }),
        action.botId,
        "working",
      );
    }
    case "dismissCard":
      if (action.groupId) return patchGroupCard(state, action.groupId, action.messageId, { dismissed: true });
      return patchCard(state, action.botId, action.messageId, { dismissed: true });
    case "decideRequest":
      return state; // the server's request.resolved patch settles the card
    case "botAdded":
      return withMascotMotion({
        ...state,
        // An HTTP create/import response and its SSE broadcast can race. Fold
        // both paths without ever showing the same bot twice.
        bots: [action.bot, ...state.bots.filter((bot) => bot.id !== action.bot.id)],
        ...(action.preserveSelection ? {} : { activeView: "chat" as const, selectedId: action.bot.id }),
      }, action.bot.id, "arrive");
    case "deleteBot": {
      const bots = state.bots.filter((b) => b.id !== action.botId);
      const selectedId =
        state.selectedId === action.botId ? fallbackSelection(bots, state.groups, state.sidebarHiddenKeys) : state.selectedId;
      const { [action.botId]: _deleted, ...deletingBots } = state.deletingBots;
      return reconcileModelVariantSessions({ ...state, bots, selectedId, deletingBots });
    }
    case "botDeletionPending": {
      if (action.on) {
        if (state.deletingBots[action.botId]) return state;
        return { ...state, deletingBots: { ...state.deletingBots, [action.botId]: true } };
      }
      if (!state.deletingBots[action.botId]) return state;
      const { [action.botId]: _settled, ...deletingBots } = state.deletingBots;
      return { ...state, deletingBots };
    }
    case "playMascotMotion":
      return withMascotMotion(state, action.botId, action.kind);
    case "markUnread":
      return updateBot(withMascotMotion(state, action.botId, "surprise"), action.botId, (b) => ({ ...b, unread: true }));
    case "botPatched": {
      const before = state.bots.find((b) => b.id === action.bot.id);
      // Bot frames are complete except for their transcript. An unknown one
      // was created by another client (the phone, another app window, or a
      // team import), so add it now; the following message frames will fill
      // its greeting without waiting for a full-page hydration.
      if (!before) {
        const added = {
          ...state,
          bots: [{ ...action.bot, messages: action.bot.messages ?? [] }, ...state.bots],
        };
        return reconcileSnapshotQueues(added, [action.bot]);
      }
      const kind =
        action.bot.unread && !before?.unread
          ? "surprise"
          : action.bot.busy === true && !before?.busy
            ? "working"
            : action.bot.busy === false && before?.busy
              ? "celebrate"
              : null;
      const motioned = kind ? withMascotMotion(state, action.bot.id, kind) : state;
      // A start that failed never sends a first frame: its line ends with the turn.
      const animated = action.bot.busy === false && before?.busy && motioned.computerStarts[action.bot.id]
        ? reducer(motioned, { type: "computerStart", botId: action.bot.id, start: null }) : motioned;
      // One Primary Bot per person, not per section.
      const next = action.bot.chiefOfStaff
        ? { ...animated, bots: withPrimaryBot(animated.bots, { ...before, ...action.bot } as Bot) }
        : animated;
      const switchedThread =
        typeof action.bot.threadId === "string" && action.bot.threadId !== before.threadId &&
        !action.bot.tasks?.some((task) => task.threadId === before.threadId);
      // As with explicit navigation, the snapshot already includes events
      // buffered while its thread was in the background. Replay only races
      // after this switch begins, not older approval patches.
      let switching = next;
      if (switchedThread) {
        const { [action.bot.threadId]: _stale, ...otherThreadEvents } = next.backgroundThreadEvents;
        switching = { ...next, backgroundThreadEvents: otherThreadEvents };
      }
      if ((switchedThread || (before.awaitingThreadSnapshot && action.bot.threadId === before.threadId)) &&
          Array.isArray(action.bot.messages)) {
        // The slim deletion broadcast can arrive before the full snapshot.
        // Finish that switch once, replaying any events received in between.
        // Later duplicate HTTP snapshots must not overwrite newer messages.
        return reducer(switching, { type: "taskSwitched", bot: { ...before, ...action.bot, computer: action.bot.computer, section: action.bot.section, toolScope: action.bot.toolScope, waitingApprovals: action.bot.waitingApprovals, botConversations: action.bot.botConversations, messages: action.bot.messages, browserProfile: action.bot.browserProfile } });
      }
      const patched = updateBot(switching, action.bot.id, (b) => ({
        ...b,
        ...action.bot,
        threadId: switchedThread ? action.bot.threadId : b.threadId,
        activeLeafId: switchedThread ? null : b.activeLeafId,
        awaitingThreadSnapshot: switchedThread || b.awaitingThreadSnapshot,
        // Complete bot frames omit this optional field after switching back
        // to Own browser (or deleting a shared profile). Do not retain the
        // previous profile's name and selection in another window.
        browserProfile: action.bot.browserProfile,
        // Resetting Works on to Auto removes the field from the complete
        // server frame; merging alone would keep the old target highlighted.
        computer: action.bot.computer,
        toolScope: action.bot.toolScope,
        // A complete frame omits section after another client moves the bot
        // into General. Retaining the old label strands an empty team in UI.
        section: action.bot.section,
        // A complete frame omits it once no bot-to-bot card waits.
        waitingApprovals: action.bot.waitingApprovals,
        botConversations: action.bot.botConversations,
        tasks: action.bot.tasks ? mergeTaskStamps(b.tasks, action.bot.tasks) : b.tasks,
        // Clear immediately on deletion: old approvals must never be sent
        // to the replacement thread while waiting for its transcript.
        messages: switchedThread ? [] : b.messages,
        // This branch keeps the transcript it holds, so it keeps that
        // transcript's scrollback answer too. A frame's hasMore describes
        // the page it carries (often another thread's); taskSwitched takes
        // it together with that page.
        hasMore: switchedThread ? undefined : b.hasMore,
      }));
      return reconcileModelVariantSessions(patched);
    }
    case "messageAdded": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) {
        // room thread — plain linear append, no branching/mascot machinery.
        // A message for a channel task that is not the one on screen still
        // moves that row; it must not be appended to the visible transcript.
        const group = state.groups.find((g) => g.threadId === action.threadId || g.tasks?.some((task) => task.threadId === action.threadId));
        if (!group) return state;
        if (group.threadId === action.threadId && group.messages.some((m) => m.id === action.message.id)) return state;
        const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at);
        if (group.threadId !== action.threadId) return stamped;
        const optimisticIndex = action.message.sendId
          ? group.messages.findIndex(
              (message) => message.id === optimisticMessageId(action.message.sendId!),
            )
          : -1;
        return {
          ...stamped,
          groups: stamped.groups.map((g) =>
            g.id === group.id
              ? {
                  ...g,
                  messages: optimisticIndex >= 0
                    ? g.messages.map((message, index) =>
                        index === optimisticIndex ? action.message : message
                      )
                    : [...g.messages, action.message],
                }
              : g,
          ),
        };
      }
      // The POST response and the canonical SSE frame may arrive in either
      // order. A repeated message is already folded; moving the active leaf
      // back to it can hide a newer assistant reply that won the race.
      if (bot.messages.some((message) => message.id === action.message.id)) return state;
      const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at);
      const optimisticId = action.message.sendId
        ? optimisticMessageId(action.message.sendId)
        : null;
      const optimisticIndex = optimisticId
        ? bot.messages.findIndex((message) => message.id === optimisticId)
        : -1;
      if (optimisticIndex >= 0) {
        return updateBot(stamped, bot.id, (current) => ({
          ...current,
          messages: current.messages.map((message, index) =>
            index === optimisticIndex ? action.message : message
          ),
          activeLeafId: current.activeLeafId === optimisticId
            ? action.message.id
            : current.activeLeafId,
        }));
      }
      // every server-side append chains onto (and becomes) the active leaf
      const next = updateBot(stamped, bot.id, (b) => {
        // A message chains onto the leaf → it becomes the leaf (the normal
        // append). A message parented elsewhere is a chain-insert of a late
        // turn artifact (settle-time screenshot) — the leaf must stay put,
        // or the follow-up send it raced would fall off the active branch.
        const adoptsLeaf = (action.message.parentId ?? null) === (b.activeLeafId ?? null);
        return { ...b, messages: [...b.messages, action.message], activeLeafId: adoptsLeaf ? action.message.id : b.activeLeafId };
      });
      const motion =
        action.message.role === "user" && action.message.kind === "text" && Boolean(action.message.queueId)
          ? "working"
          : action.message.kind === "options"
          ? "thinking"
          : action.message.kind === "activity"
            ? action.message.tool?.ok === false
              ? "failure"
              : action.message.tool?.ok === true
                ? "success"
                : "working"
            : action.message.role === "bot" && action.message.kind === "text"
              ? "blink"
              : null;
      const animated = motion ? withMascotMotion(next, bot.id, motion) : next;
      return animated;
    }
    case "optimisticMessageRemoved": {
      const id = optimisticMessageId(action.sendId);
      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);
      if (bot) {
        const optimistic = bot.messages.find((message) => message.id === id);
        if (!optimistic) return state;
        const cleared = updateBot(state, bot.id, (current) => ({
          ...current,
          messages: current.messages.filter((message) => message.id !== id),
          activeLeafId: current.activeLeafId === id
            ? (action.restoreLeafId !== undefined ? action.restoreLeafId : (optimistic.parentId ?? null))
            : current.activeLeafId,
        }));
        const task = bot.tasks?.find((candidate) => candidate.threadId === action.threadId);
        const kept = cleared.bots.find((candidate) => candidate.id === bot.id)?.messages ?? [];
        return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? 0);
      }
      const group = state.groups.find((candidate) => candidate.threadId === action.threadId);
      if (!group || !group.messages.some((message) => message.id === id)) return state;
      const cleared = {
        ...state,
        groups: state.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: candidate.messages.filter((message) => message.id !== id) }
          : candidate),
      };
      const task = group.tasks?.find((candidate) => candidate.threadId === action.threadId);
      const kept = cleared.groups.find((candidate) => candidate.id === group.id)?.messages ?? [];
      return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? group.createdAt);
    }
    case "cardSettled": {
      const settle = (messages: Message[]) => messages.map((m) =>
        m.card?.requestId === action.requestId ? { ...m, card: { ...m.card, ...action.patch } } : m);
      const group = state.groups.find((g) => g.threadId === action.threadId);
      if (group) return { ...state, groups: state.groups.map((g) => (g.id === group.id ? { ...g, messages: settle(g.messages) } : g)) };
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      return bot ? updateBot(state, bot.id, (b) => ({ ...b, messages: settle(b.messages) })) : state;
    }
    case "messagePatched": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) {
        const group = state.groups.find((g) => g.threadId === action.threadId);
        if (!group) return state;
        return {
          ...state,
          groups: state.groups.map((g) =>
            g.id === group.id
              ? { ...g, messages: g.messages.map((m) => (m.id === action.message.id ? action.message : m)) }
              : g,
          ),
        };
      }
      const motion =
        action.message.kind === "activity"
          ? action.message.tool?.ok === false
            ? "failure"
            : action.message.tool?.ok === true
              ? "success"
              : "working"
          : null;
      const next = motion ? withMascotMotion(state, bot.id, motion) : state;
      return updateBot(next, bot.id, (b) => ({
        ...b,
        messages: b.messages.map((m) => (m.id === action.message.id ? action.message : m)),
      }));
    }
    case "computerStart": {
      const { [action.botId]: _ended, ...others } = state.computerStarts;
      return {
        ...(action.start ? withMascotMotion(state, action.botId, "launch") : state),
        computerStarts: action.start ? { ...others, [action.botId]: action.start } : others,
      };
    }
    case "computerControl":
      return {
        ...state,
        computerControl: {
          ...state.computerControl,
          [action.botId]: { held: action.held, helpReason: action.helpReason },
        },
      };
    case "modelVariantRuntime": {
      const event = action.event;
      if (!event.turnId) return state;
      if (event.type === "session.model-fallback") {
        if (!event.providerInstanceId) return state;
        // A group: another person's turn ran on their own fallback, not this viewer's.
        const me = state.config?.viewer?.principalId?.trim().toLowerCase();
        if (event.principalId && me && event.principalId.trim().toLowerCase() !== me) return state;
        return { ...state, modelFallbacks: { ...state.modelFallbacks, [event.threadId]: {
          instanceId: event.providerInstanceId, requested: event.requested, actual: event.actual,
          ...(event.actualInstanceId ? { actualInstanceId: event.actualInstanceId } : {}),
        } } };
      }
      if (event.type === "turn.started" && state.modelFallbacks?.[event.threadId]) {
        const { [event.threadId]: _gone, ...rest } = state.modelFallbacks;
        state = { ...state, modelFallbacks: rest };
      }
      const owner = state.bots.find((bot) => bot.threadId === event.threadId || bot.tasks?.some((task) => task.threadId === event.threadId));
      if (!owner) return state;
      const selection = currentTaskBot(owner, event.threadId).modelSelection;
      if (selection.instanceId !== event.providerInstanceId ||
          !state.instances.find((instance) => instance.instanceId === selection.instanceId)?.capabilities?.modelVariants) return state;
      const previous = state.modelVariantSessions[event.threadId];
      if (event.type === "turn.started") {
        if (previous && (previous.turnId === event.turnId || Date.parse(previous.startedAt) > Date.parse(event.createdAt))) return state;
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: {
          instanceId: selection.instanceId, model: selection.model, turnId: event.turnId, startedAt: event.createdAt, acceptingUpdates: true,
        } } };
      }
      if (!previous?.acceptingUpdates || previous.turnId !== event.turnId || previous.instanceId !== selection.instanceId || previous.model !== selection.model) return state;
      if (event.type === "session.model-variants" && event.model === selection.model) {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, variants: event.variants } } };
      }
      if (event.type === "turn.completed") {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, acceptingUpdates: false } } };
      }
      return state;
    }
    case "setModel":
      if (action.threadId && action.updateBotDefault) {
        return reconcileModelVariantSessions(updateBot(state, action.botId, (bot) => ({ ...bot, modelSelection: action.selection,
          tasks: bot.tasks?.map((task) => ({ ...task, modelSelection: action.selection, followsBotModel: true })) })));
      }
      if (action.threadId) {
        const picked = reducer(state, { type: "updateTask", botId: action.botId, threadId: action.threadId,
          patch: { modelSelection: action.selection } });
        // Picking the bot's model, or making the pick the bot's, is following it.
        return updateBot(picked, action.botId, (bot) => ({ ...bot, tasks: bot.tasks?.map((task) => task.threadId !== action.threadId ? task
          : { ...task, followsBotModel: Boolean(action.updateBotDefault) || sameModelSelection(action.selection, bot.modelSelection) }) }));
      }
      return reconcileModelVariantSessions(updateBot(state, action.botId, (b) => ({ ...b, modelSelection: action.selection,
        tasks: b.tasks?.map((task) => ({ ...task, modelSelection: action.selection, followsBotModel: true })) })));
    case "updateTask": {
      const patch = taskPatchFields(action.patch);
      return reconcileModelVariantSessions(updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? [{ threadId: bot.threadId, title: "New thread", createdAt: Date.now() }]).map((task) =>
          task.threadId === action.threadId ? { ...task, ...patch } : task),
      })));
    }
    case "connected":
      if (action.value) {
        return { ...state, connected: true, everConnected: true, disconnectedAt: null };
      }
      return {
        ...state,
        connected: false,
        disconnectedAt: state.connected ? Date.now() : (state.disconnectedAt ?? Date.now()),
      };
    case "error":
      return {
        ...(action.message && state.selectedId
          ? withMascotMotion(state, state.selectedId, "alert")
          : state),
        // The banner's safety net: an older server's "no route" text, from
        // whatever path it came, reads as the neutral line.
        error: action.message ? neutralNoRoute(action.message) : action.message,
      };
    // bot settings, the computer panel, and app settings share the right slot
    case "openPersonPanel": {
      const personId = action.personId?.trim() || null;
      if (!personId) return state.personPanelId === null ? state : { ...state, personPanelId: null };
      return { ...state, personPanelId: personId, settingsOpen: false, computerOpen: false, inspectorOpen: false, appSettingsOpen: false };
    }
    case "toggleSettings": {
      // Only Details (and Routines) live in the bot panel. A deep link to any
      // other section opens the persona editor on that section's own page
      // over the panel.
      // A split-view section's pill names its bot or group as the owner: the
      // panel is that one's and the main chat stays as it is. A link for another bot
      // (or the main pill, owner null) gives the panel back to the main chat;
      // one without a bot, from inside the panel, stays with its owner.
      const owner = action.owner !== undefined
        ? action.owner
        : state.panelOwner && (action.botId === undefined || action.botId === state.panelOwner.botId) ? state.panelOwner : null;
      const category = action.open !== false && action.section !== undefined ? personaCategoryForSection(action.section) : null;
      if (category !== null) {
        const targetId = action.botId ?? owner?.botId ?? state.selectedId;
        if (!targetId) return state;
        const opened = reducer(state, { type: "toggleSettings", open: true, ...(owner ? { owner } : { botId: action.botId, owner: null }) });
        return reducer(opened, { type: "openPersonaEditor", botId: targetId, section: category });
      }
      if (action.botId !== undefined && !state.bots.some((bot) => bot.id === action.botId && !bot.hidden)) return state;
      if (owner?.botId !== undefined && !state.bots.some((bot) => bot.id === owner.botId && !bot.hidden)) return state;
      if (owner?.groupId !== undefined && !state.groups.some((group) => group.id === owner.groupId)) return state;
      const selectedId = owner ? state.selectedId : action.botId ?? state.selectedId;
      // A targeted settings link opens that bot without navigating to chat
      // or marking its conversations read, even when another panel is open.
      const open = action.open ?? (action.botId !== undefined || !state.settingsOpen);
      const freshOpen = open && !state.settingsOpen;
      const named = action.section !== undefined;
      return {
        ...state,
        selectedId,
        settingsOpen: open,
        panelOwner: open ? owner : null,
        activityOpen: open ? false : state.activityOpen,
        // The pointer persists across bots and rooms (select) and across
        // switches to another bot's profile; a deep link names its target.
        botSettingsSection: action.section ?? state.botSettingsSection,
        // A bare fresh open re-expands the section this device last viewed;
        // a deep link expands the row it names.
        botSettingsExpandAccordion: open ? named || (freshOpen && state.botSettingsSectionStored) : false,
        // Only an opening that expanded the remembered row sets this; a deep
        // link forces the full view for sections Simple skips.
        botSettingsExpandRemembered: open ? !named && freshOpen && state.botSettingsSectionStored : false,
        botSettingsSectionStored: named || state.botSettingsSectionStored,
        personPanelId: open ? null : state.personPanelId,
        // Settings and the computer panel share one slot. Opening settings
        // closes the computer view; its gear opens settings again.
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "openRoutine": {
      const opened = reducer(state, { type: "toggleSettings", open: true, section: "routines", botId: action.botId });
      if (opened === state) return state;
      return { ...opened, routineFocus: { botId: action.botId, routineId: action.routineId } };
    }
    case "routineFocused":
      return state.routineFocus ? { ...state, routineFocus: null } : state;
    case "openRoutineRunSheet": {
      const known = state.routineRuns.find((candidate) => candidate.id === action.runId);
      const botId = action.botId ?? known?.botId;
      const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
      const next: AppState = {
        ...state,
        activeView: "chat",
        routineRunSheet: { runId: action.runId, ...(action.routineId ?? known?.routineId ? { routineId: action.routineId ?? known?.routineId } : {}) },
        // Keep the bot panel if it was already open; otherwise land on chat.
        personPanelId: null,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
      if (bot && state.selectedId !== bot.id) {
        return { ...next, selectedId: bot.id };
      }
      return next;
    }
    case "closeRoutineRunSheet":
      return state.routineRunSheet ? { ...state, routineRunSheet: null } : state;
    case "openBotActivity": {
      const opened = reducer(state, { type: "toggleSettings", open: true, section: "routines", botId: action.botId });
      if (opened === state) return state;
      return { ...opened, botActivityTarget: { botId: action.botId, itemId: action.itemId } };
    }
    case "botActivityOpened":
      return state.botActivityTarget ? { ...state, botActivityTarget: null } : state;
    case "togglePlugins": {
      const open = action.open ?? !state.pluginsOpen;
      return {
        ...state,
        pluginsOpen: open,
        pluginsSurface: action.surface ?? state.pluginsSurface,
        // A bot panel opens it on that bot; a change of surface while it is
        // open keeps the bot it is on.
        pluginsBotId: !open ? null : action.page ? null : action.botId !== undefined ? action.botId : state.pluginsOpen ? state.pluginsBotId : null,
        pluginsPage: open ? (action.page === "accounts" ? "providers" : action.page ?? null) : null,
        pluginsFocusApps: !open ? null : action.focusApps?.length ? action.focusApps : state.pluginsOpen ? state.pluginsFocusApps : null,
        // where a link to Browse Bots asked it to open (its Templates) lasts
        // while Connect apps is open (2026-10-29)
        ...(!open && state.botCatalogTarget && !state.botCatalogOpen ? { botCatalogTarget: null } : {}),
        ...(open ? { settingsOpen: false, appSettingsOpen: false, newBotOpen: false, shortcutsOpen: false, triggersOpen: false } : {}),
      };
    }
    case "toggleTriggers": {
      const open = action.open ?? !state.triggersOpen;
      return {
        ...state,
        triggersOpen: open,
        ...(open ? { settingsOpen: false, appSettingsOpen: false, newBotOpen: false, shortcutsOpen: false, pluginsOpen: false } : {}),
      };
    }
    case "botCreationPending":
      return { ...state, botCreationPending: action.on };
    case "openBotWizard":
      // Its own screen over the app: what was open closes, as New bot does.
      // A new bot needs the right to create one (a bot's own Redo does not).
      if (!action.botId && state.config?.viewer?.canCreateBots === false) return state;
      return {
        ...state,
        botWizard: { botId: action.botId ?? null, ...(action.redo ? { redo: true } : {}) },
        newBotOpen: false, settingsOpen: false, appSettingsOpen: false, pluginsOpen: false, shortcutsOpen: false, triggersOpen: false,
      };
    case "closeBotWizard":
      return { ...state, botWizard: null };
    case "toggleNewBot": {
      const open = (action.open ?? !state.newBotOpen) && state.config?.viewer?.canCreateBots !== false;
      return {
        ...state, newBotOpen: open,
        ...(open ? { settingsOpen: false, appSettingsOpen: false, pluginsOpen: false, shortcutsOpen: false, triggersOpen: false } : {}),
      };
    }
    case "notice":
      return { ...state, notice: action.notice };
    case "revealThread":
      return { ...state, revealThread: { threadId: action.threadId, nonce: (state.revealThread?.nonce ?? 0) + 1 } };
    case "setThreadReturn":
      return { ...state, threadReturn: action.threadReturn };
    case "freshTopic": {
      const current = state.freshTopic[action.botId];
      if (!action.threadId) {
        if (!current) return state;
        const { [action.botId]: _gone, ...rest } = state.freshTopic;
        return { ...state, freshTopic: rest };
      }
      if (current?.threadId === action.threadId && current.auto === Boolean(action.auto)) return state;
      return { ...state, freshTopic: { ...state.freshTopic, [action.botId]: { threadId: action.threadId, auto: Boolean(action.auto) } } };
    }
    case "focusMessage":
      return {
        ...state,
        // A link or a search hit into a topic of a bot under a fresh topic
        // shows that topic: the fresh one gives way.
        freshTopic: withoutFreshTopicFor(state, action.threadId),
        focusMessage: {
          threadId: action.threadId,
          messageId: action.messageId,
          matchText: action.matchText,
          nonce: (state.focusMessage?.nonce ?? 0) + 1,
          consumed: false,
        },
      };
    case "focusMessageConsumed":
      if (!state.focusMessage || state.focusMessage.nonce !== action.nonce) return state;
      return { ...state, focusMessage: { ...state.focusMessage, consumed: true } };
    case "unreadDividerDone":
      return state.unreadDivider?.threadId === action.threadId ? { ...state, unreadDivider: null } : state;
    case "toggleComputer": {
      const open = action.open ?? !state.computerOpen;
      return {
        ...state,
        computerOpen: open,
        personPanelId: open ? null : state.personPanelId,
        settingsOpen: open ? false : state.settingsOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleInspector": {
      const open = action.open ?? !state.inspectorOpen;
      return {
        ...state,
        inspectorOpen: open,
        personPanelId: open ? null : state.personPanelId,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleActivity": {
      const open = action.open ?? !state.activityOpen;
      return {
        ...state,
        activityOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleAppSettings": {
      const open = action.open ?? !state.appSettingsOpen;
      return {
        ...state,
        appSettingsOpen: open,
        activityOpen: open ? false : state.activityOpen,
        appSettingsSection: action.section ? currentSettingsSection(action.section) : state.appSettingsSection,
        appSettingsSubPage: open ? action.subPage ?? null : null,
        personPanelId: open ? null : state.personPanelId,
        appSettingsPhonePairing: action.phonePairing && open ? state.appSettingsPhonePairing + 1 : 0,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        pluginsOpen: open ? false : state.pluginsOpen,
        triggersOpen: open ? false : state.triggersOpen,
        personaEditor: open ? null : state.personaEditor,
      };
    }
    case "openBotCatalog": {
      // Browse Bots is Connect apps' Bots tab (2026-10-29): every link to it
      // opens that tab, on its Templates when it asks (a new object, so an
      // open tab follows a later link). Its own window (botCatalogOpen) keeps
      // its content for a window that is already open.
      const target = action.section ? { section: action.section, ...(action.installUrl ? { installUrl: action.installUrl } : {}) } : null;
      if (state.botCatalogOpen) return action.section ? { ...state, botCatalogTarget: target } : state;
      const opened = reducer(state, { type: "togglePlugins", open: true, surface: "apps", page: "bots" });
      return { ...opened, botCatalogTarget: target };
    }
    case "closeBotCatalog":
      return state.botCatalogOpen ? { ...state, botCatalogOpen: false, botCatalogTarget: null } : state;
    case "openPersonaEditor":
      if (!state.bots.some((bot) => bot.id === action.botId)) return state;
      return {
        ...state,
        personaEditor: { botId: action.botId, section: action.section ?? "overview" },
        appSettingsOpen: false,
        appSettingsSubPage: null,
        pluginsOpen: false,
        triggersOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
      };
    case "personaEditorSection":
      return state.personaEditor && state.personaEditor.section !== action.section
        ? { ...state, personaEditor: { ...state.personaEditor, section: action.section } }
        : state;
    case "closePersonaEditor":
      return state.personaEditor ? { ...state, personaEditor: null } : state;
    case "toggleShortcuts": {
      const open = action.open ?? !state.shortcutsOpen;
      return {
        ...state,
        shortcutsOpen: open,
      };
    }
    case "toggleTour": {
      const open = action.open ?? !state.tourOpen;
      return { ...state, tourOpen: open, appSettingsOpen: open ? false : state.appSettingsOpen };
    }
    case "toggleLaunch": {
      const open = action.open ?? !state.launchOpen;
      // Full-screen like the welcome tour: Settings closes underneath it.
      return {
        ...state,
        launchOpen: open,
        launchMode: action.mode ?? state.launchMode,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        shortcutsOpen: open ? false : state.shortcutsOpen,
      };
    }
    case "toggleWelcome": {
      const open = action.open ?? !state.welcomeOpen;
      // The tour is a full-screen surface; nothing else should stay open
      // underneath it, and Settings closes so the replay lands on the tour.
      return {
        ...state,
        welcomeOpen: open,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        shortcutsOpen: open ? false : state.shortcutsOpen,
      };
    }
    case "updateBot": {
      const mascotChanged =
        Object.prototype.hasOwnProperty.call(action.patch, "color") ||
        Object.prototype.hasOwnProperty.call(action.patch, "mascotExpression");
      // a new skin is shown off with the wings open
      const skinChanged = Object.prototype.hasOwnProperty.call(action.patch, "mascotSkin");
      const animated = skinChanged
        ? withMascotMotion(state, action.botId, "spread-wings")
        : mascotChanged
          ? withMascotMotion(state, action.botId, "customize")
          : state;
      const target = animated.bots.find((bot) => bot.id === action.botId);
      // One Primary Bot per person, not per section.
      const next = action.patch.chiefOfStaff && target
        ? { ...animated, bots: withPrimaryBot(animated.bots, target) }
        : animated;
      const {
        acknowledgeLocalAuto: _localAck,
        confirmFullAccess: _fullConfirmation,
        applyToAllThreads: _allThreads,
        organizationFullAccess: _orgFull,
        threadId: _threadId,
        host,
        computer,
        ...rest
      } = action.patch;
      const botPatch: Partial<Bot> = { ...rest };
      const followMode = action.patch.approvalMode;
      if (computer === null) botPatch.computer = undefined;
      else if (computer !== undefined) botPatch.computer = computer;
      if (host === "fleet") botPatch.host = { kind: "fleet" };
      else if (host && typeof host === "object" && host.kind === "machine") {
        const userId = target?.host?.kind === "machine" ? target.host.userId : (target?.ownerUserId ?? "");
        botPatch.host = { kind: "machine", deviceId: host.deviceId, userId };
        if (host.model) botPatch.modelSelection = { ...(target?.modelSelection ?? { instanceId: host.model.instanceId, model: host.model.model }), instanceId: host.model.instanceId, model: host.model.model };
      }
      return updateBot(next, action.botId, (b) => {
        const updated: Bot = { ...b, ...botPatch };
        if (botPatch.modelSelection) updated.tasks = updated.tasks?.map((task) => ({
          ...task, modelSelection: botPatch.modelSelection!, followsBotModel: true,
        }));
        // #1169: a new bot level reaches every thread; none keeps its own
        if (followMode && updated.tasks) {
          updated.tasks = updated.tasks.map(({ approvalMode: _mode, autoApprove: _auto, approvalOwn: _own, ...task }) => task);
        }
        return updated;
      });
    }
    case "threadActive": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      // The visible branch moved (an edit, a rewind, another client's switch).
      return updateBot(bumpTranscriptGeneration(state, action.threadId), bot.id, (b) => ({
        ...b,
        activeLeafId: action.activeLeafId,
      }));
    }
    // optimistic leaf move; the server's thread frame confirms it later
    case "switchBranch": {
      const bot = state.bots.find((b) => b.id === action.botId);
      if (!bot) return state;
      let cur = action.messageId;
      for (;;) {
        const children = bot.messages.filter((m) => m.parentId === cur);
        if (!children.length) break;
        cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
      }
      return updateBot(bumpTranscriptGeneration(state, bot.threadId), action.botId, (b) => ({ ...b, activeLeafId: cur }));
    }
    // optimistic room edits; the server's group frame confirms them later
    case "patchGroup":
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.groupId ? { ...g, ...action.patch } : g)),
      };
    // handled entirely by the async wrapper
    case "pendingQueued": {
      if (state.consumedQueueIds[action.queueId]) {
        const consumedQueueIds = { ...state.consumedQueueIds };
        delete consumedQueueIds[action.queueId];
        return { ...state, consumedQueueIds };
      }
      const prev = state.pendingQueued[action.threadId] ?? [];
      if (prev.some((entry) => entry.queueId === action.queueId)) return state;
      return {
        ...state,
        pendingQueued: {
          ...state.pendingQueued,
          [action.threadId]: [...prev, { queueId: action.queueId, text: action.text, ...(action.reason ? { reason: action.reason } : {}) }],
        },
      };
    }
    case "consumePendingQueued": {
      const prev = state.pendingQueued[action.threadId] ?? [];
      const at = prev.findIndex((entry) => entry.queueId === action.queueId);
      if (at < 0) {
        return {
          ...state,
          consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId),
        };
      }
      const rest = prev.filter((_, i) => i !== at);
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[action.threadId] = rest;
      else delete pendingQueued[action.threadId];
      return { ...state, pendingQueued, consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId) };
    }
    case "stopParallelTask":
      return state;
    case "cancelQueued": {
      const bot = state.bots.find((candidate) => candidate.id === action.botId);
      if (!bot) return state;
      const threadId = action.threadId ?? bot.threadId;
      const prev = state.pendingQueued[threadId] ?? [];
      const rest = prev.filter((entry) => entry.queueId !== action.queueId);
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[threadId] = rest;
      else delete pendingQueued[threadId];
      return { ...state, pendingQueued, consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId) };
    }
    case "steerQueued":
      // API-only: the effect folds in messageAdded/consumePendingQueued on
      // success, so the chips clear exactly when the words truly landed.
      return state;
    case "cancelGroupQueued": {
      const prev = state.pendingQueued[action.threadId] ?? [];
      const rest = prev.filter((entry) => entry.queueId !== action.queueId);
      if (rest.length === prev.length) return state;
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[action.threadId] = rest;
      else delete pendingQueued[action.threadId];
      return { ...state, pendingQueued };
    }
    case "send": {
      const animated = withMascotMotion(
        dismissOnboardingCard(state, action.botId),
        action.botId,
        "working",
      );
      if (!action.sendId) return animated;
      const bot = animated.bots.find((candidate) => candidate.id === action.botId);
      const threadId = action.threadId ?? bot?.threadId;
      if (!bot || threadId !== bot.threadId) return animated;
      // The first message of a fresh topic lands in that topic once the
      // server created it (the send effect), never in the one under it.
      if (sendsToFreshTopic(animated, action)) return animated;
      if (bot.messages.some((message) => message.sendId === action.sendId)) return animated;
      const liveCallId = voiceCallId(action.botId);
      const voiceCall = action.voiceCall ?? (liveCallId ? { callId: liveCallId } : undefined);
      const message = optimisticUserMessage(
        action.text,
        action.sendId,
        action.replyToId,
        bot.activeLeafId,
        undefined,
        voiceCall,
      );
      // sent from an open page: its chip shows at once (the server's row keeps it)
      if (action.dataContext?.page) message.dataContext = { page: action.dataContext.page };
      return bumpThreadUpdatedAt(updateBot(animated, bot.id, (current) => ({
        ...current,
        messages: [...current.messages, message],
        activeLeafId: message.id,
      })), threadId, message.at);
    }
    case "editMessage": {
      // The edit replaces its message on screen the moment it is submitted:
      // an optimistic sibling becomes the leaf, which hides the old question
      // and its old answer. The server's fork carries the same sendId and
      // takes this row's place; a failed request restores the old branch.
      const animated = withMascotMotion(state, action.botId, "working");
      if (!action.sendId) return animated;
      const bot = animated.bots.find((candidate) => candidate.id === action.botId);
      const threadId = action.threadId ?? bot?.threadId;
      if (!bot || threadId !== bot.threadId) return animated;
      if (bot.messages.some((message) => message.sendId === action.sendId)) return animated;
      const source = bot.messages.find((message) => message.id === action.messageId);
      if (!source || source.role !== "user" || source.kind !== "text") return animated;
      const message = optimisticUserMessage(
        action.text.trim(),
        action.sendId,
        source.replyToId,
        source.parentId ?? null,
      );
      return updateBot(animated, bot.id, (current) => ({
        ...current,
        messages: [...current.messages, message],
        activeLeafId: message.id,
      }));
    }
    case "taskMadeConfidential":
      return updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? []).map((task) => task.threadId === action.threadId ? { ...task, confidential: true as const } : task),
      }));
    case "makeTaskConfidential":
    case "deleteTask":
    case "newGroupTask":
    case "switchGroupTask":
    case "deleteGroupTask":
    case "regenerateTaskTitle":
      return state;
    case "newTask":
      // A chosen folder may fail validation. Keep the conversation beneath
      // its dialog in place until the server confirms the new thread.
      return action.cwd !== undefined ? state : { ...state, selectedId: action.botId, activeView: "chat" };
    case "switchTask": {
      // Older background frames are already represented by the next server
      // snapshot. Only frames racing that request need replaying over it.
      const { [action.threadId]: _old, ...backgroundThreadEvents } = state.backgroundThreadEvents;
      return updateBot({ ...state, backgroundThreadEvents, selectedId: action.botId, activeView: "chat" }, action.botId,
        (bot) => ({ ...bot, switchingTo: action.threadId, switchPreview: undefined }));
    }
    case "previewThread":
      // Only for the switch still under way; a later switch has its own.
      return updateBot(state, action.botId, (bot) => bot.switchingTo === action.threadId
        ? { ...bot, switchPreview: { threadId: action.threadId, messages: action.page.messages, hasMore: action.page.hasMore, activeLeafId: action.page.activeLeafId } }
        : bot);
    case "switchTaskFailed":
      return updateBot(state, action.botId, (bot) => bot.switchingTo === action.threadId ? { ...bot, switchingTo: undefined, switchPreview: undefined } : bot);
    case "renameTask":
      return updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? []).map((task) =>
          task.threadId === action.threadId ? { ...task, title: action.title } : task,
        ),
      }));
    case "renameGroupTask":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? {
                ...group,
                tasks: (group.tasks ?? []).map((task) =>
                  task.threadId === action.threadId ? { ...task, title: action.title } : task,
                ),
              }
            : group,
        ),
      };
    case "pinGroupTask":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? {
                ...group,
                tasks: (group.tasks ?? []).map((task) =>
                  task.threadId === action.threadId ? { ...task, pinned: action.pinned ? true : undefined } : task,
                ),
              }
            : group,
        ),
      };
    case "updateGroupTask":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? {
                ...group,
                tasks: (group.tasks ?? []).map((task) => {
                  if (task.threadId !== action.threadId) return task;
                  const next: GroupTask = { ...task };
                  for (const field of ["archivedAt", "snoozedUntil", "projectId"] as const) {
                    if (!(field in action.patch)) continue;
                    const value = action.patch[field];
                    if (value === null || value === undefined) delete next[field];
                    else Object.assign(next, { [field]: value });
                  }
                  if ("pinned" in action.patch) {
                    if (action.patch.pinned) next.pinned = true;
                    else delete next.pinned;
                  }
                  return next;
                }),
              }
            : group,
        ),
      };
    case "setConversationTurnLimit":
      return {
        ...state,
        groups: state.groups.map((group) => {
          if (group.id !== action.groupId) return group;
          if (action.dm) return { ...group, turnTimeoutMinutes: action.minutes ?? undefined };
          return {
            ...group,
            tasks: (group.tasks ?? []).map((task) =>
              task.threadId === action.threadId
                ? { ...task, turnTimeoutMinutes: action.minutes ?? undefined }
                : task,
            ),
          };
        }),
      };
    case "taskSwitched": {
      let switched = updateBot(bumpTranscriptGeneration(state, action.bot.threadId), action.bot.id, (bot) => ({
        ...bot,
        ...action.bot,
        computer: action.bot.computer,
        toolScope: action.bot.toolScope,
        messages: action.bot.messages ?? [],
        // The snapshot decides whether this thread has scrollback. Merging
        // would carry the previous thread's answer onto a new one.
        hasMore: action.bot.hasMore,
        awaitingThreadSnapshot: false,
        switchingTo: undefined,
        switchPreview: undefined,
      }));
      for (const frame of state.backgroundThreadEvents[action.bot.threadId] ?? []) switched = reducer(switched, frame);
      const { [action.bot.threadId]: _settled, ...backgroundThreadEvents } = switched.backgroundThreadEvents;
      switched = { ...switched, backgroundThreadEvents };
      // Only the conversation on screen draws a divider; a bot in the
      // background moving to another thread leaves it alone.
      const opened = switched.bots.find((bot) => bot.id === action.bot.id);
      if (opened && opened.id === switched.selectedId) {
        switched = { ...switched, unreadDivider: openedUnreadDivider(switched, opened.threadId, threadOpensUnread(opened), visibleMessages(opened), threadReadCursor(opened)) };
        // …and on screen it is read, as `select` reads the thread it opens. The
        // snapshot predates the switch's own announcement, which told the
        // server so (the "bot" frame), and must not put the dot back.
        if (switched.activeView === "chat") switched = updateBot(switched, opened.id, (bot) => readOnScreen(bot, bot.threadId));
      }
      return clearThreadReturnIfHome(reconcileModelVariantSessions(reconcileSnapshotQueues(switched, [action.bot])));
    }
    case "newBot":
    case "duplicateBot":
    case "createProject":
    case "updateProject":
    case "deleteProject":
    case "reorderProjects":
    case "interrupt":
    case "createGroup":
    case "openPeopleDm":
    case "nudgePerson":
    case "nudgeGroup":
    case "deleteGroup":
    case "leaveGroup":
    case "interruptGroup":
    case "steerGroupQueued":
    case "createRoutine":
    case "updateRoutine":
    case "deleteRoutine":
    case "runRoutine":
    case "cancelRoutineRun":
    case "markRoutineRunSeen":
    case "markAllRoutineRunsSeen":
    case "clearRoutineRuns":
    case "refreshTaskPermissions":
    case "followBotModel":
    case "loadDataSheet":
      return state;
    case "dataSheet": {
      const key = dataSheetKey(action.sheet.botId, action.threadId);
      return {
        ...state,
        dataSheets: { ...state.dataSheets, [key]: action.sheet },
        ...(action.tables ? { dataTables: { ...state.dataTables, [key]: action.tables } } : {}),
      };
    }
    case "dataView":
      return { ...state, dataView: action.view };
    case "sendGroup": {
      if (!action.sendId) return state;
      const group = state.groups.find((candidate) => candidate.id === action.groupId);
      if (!group) return state;
      const threadId: string = action.threadId ?? group.threadId;
      if (threadId === group.threadId && group.messages.some((message) => message.sendId === action.sendId)) return state;
      const message = optimisticUserMessage(
        action.text,
        action.sendId,
        action.replyToId,
        null,
        action.mode ?? "chat",
      );
      const stamped = bumpThreadUpdatedAt(state, threadId, message.at);
      if (threadId !== group.threadId) return stamped;
      return {
        ...stamped,
        groups: stamped.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: [...candidate.messages, message] }
          : candidate),
      };
    }
  }
}

/** GET sheet answers with the sheet itself or wrapped as `{ sheet }`; an
 * empty answer (a bot that has never used data) is an empty sheet. */
/** GET /data answers `{ sheet, tables }`; a `data` frame carries only the sheet. */
export function dataTablesFromResponse(body: unknown): DataTable[] {
  const tables = body && typeof body === "object" && "tables" in body ? (body as { tables: unknown }).tables : undefined;
  return Array.isArray(tables) ? (tables as DataTable[]).filter((table) => table && typeof table.name === "string") : [];
}

export function dataSheetFromResponse(body: unknown, botId: string): DataSheet {
  const candidate = body && typeof body === "object" && "sheet" in body ? (body as { sheet: unknown }).sheet : body;
  if (candidate && typeof candidate === "object" && Array.isArray((candidate as DataSheet).cards)) {
    const sheet = candidate as DataSheet;
    return { ...sheet, botId: sheet.botId || botId, sources: Array.isArray(sheet.sources) ? sheet.sources : [] };
  }
  return { version: 1, botId, cards: [], sources: [], updatedAt: new Date(0).toISOString() };
}

export const initialState: AppState = {
  modelVariantSessions: {},
  backgroundThreadEvents: {},
  loadingOlder: {},
  transcriptGeneration: {},
  bots: [],
  groups: [],
  sections: [],
  instances: [],
  config: null,
  liveCall: null,
  liveCallVersion: 0,
  liveCallLookupSeq: 0,
  selectedId: "",
  sidebarHiddenKeys: new Set<string>(),
  activeView: "chat",
  routines: [],
  routineRuns: [],
  routinesLoadState: "loading",
  routineFolders: {},
  routinesFocus: { nonce: 0 },
  codeFocus: { nonce: 0 },
  achievementsFocus: { category: "all", nonce: 0 },
  webhooks: [],
  webhookAttempts: [],
  webhookIngress: null,
  webhookGraphConnectors: [],
  settingsOpen: false,
  panelOwner: null,
  personPanelId: null,
  pluginsOpen: false,
  pluginsSurface: "apps",
  pluginsBotId: null,
  pluginsFocusApps: null,
  routineFocus: null,
  routineRunSheet: null,
  pluginsPage: null,
  triggersOpen: false,
  newBotOpen: false,
  botWizard: null,
  botCreationPending: false,
  computerOpen: false,
  inspectorOpen: false,
  activityOpen: false,
  appSettingsOpen: false,
  appSettingsSection: "account",
  botCatalogOpen: false,
  botCatalogTarget: null,
  personaEditor: null,
  appSettingsSubPage: null,
  appSettingsPhonePairing: 0,
  shortcutsOpen: false,
  welcomeOpen: false,
  launchOpen: false,
  launchMode: "solo",
  tourOpen: false,
  botSettingsSection: "overview",
  botSettingsExpandAccordion: false,
  botActivityTarget: null,
  botSettingsSectionStored: false,
  botSettingsExpandRemembered: false,
  computerStarts: {},
  deletingBots: {},
  computerControl: {},
  dataSheets: {},
  dataTables: {},
  dataView: null,
  focusMessage: null,
  freshTopic: {},
  unreadDivider: null,
  connected: false,
  everConnected: false,
  disconnectedAt: null,
  error: null,
  notice: null,
  revealThread: null,
  threadReturn: null,
  mascotMotion: null,
  pendingQueued: {},
  consumedQueueIds: {},
};

// ── API client ─────────────────────────────────────────────────────────
/** The call a `live.call` frame (or a `GET /api/live/call` answer) carries,
 * or null for a malformed one, which is ignored. A missing `call` key is
 * malformed, never "the line is free": that reading would drop a running
 * call's bar on a broken frame. */
export function liveCallFromFrame(frame: unknown): { call: LiveCallState | null } | null {
  if (!frame || typeof frame !== "object" || !Object.prototype.hasOwnProperty.call(frame, "call")) return null;
  const call: unknown = Reflect.get(frame, "call");
  if (call === null) return { call: null };
  if (!call || typeof call !== "object") return null;
  const record = call as Record<string, unknown>; // SAFETY: the fields read below are checked before use
  if (typeof record.callId !== "string" || typeof record.botId !== "string" || typeof record.threadId !== "string" || typeof record.status !== "string") {
    return null;
  }
  return { call: call as LiveCallState };
}

let liveCallLookups = 0;
/** The next `GET /api/live/call` lookup's number, in request order (see
 * `liveCallLookupSeq`). Take it when the request leaves. */
export function nextLiveCallLookup(): number {
  liveCallLookups += 1;
  return liveCallLookups;
}

export class ApiError extends Error {
  readonly status: number;
  /** The refusal's JSON body, for callers that read more than `error`. */
  readonly body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Keep the created bot reachable even when applying its optional preset fails.
 * A restricted `visibility` rides the create itself, so the bot is never
 * announced to people who should not see it. */
export async function createBotWithRole(role?: BotRole, request: typeof api = api, visibility?: BotVisibility, section?: string, settings?: Record<string, unknown>): Promise<{ bot: Bot; profileError?: string }> {
  const restricted = visibility && visibility !== "everyone" ? { visibility } : {};
  const fields = { ...(role ? { name: role.name, title: role.title, description: role.description } : {}), ...restricted,
    ...(section !== undefined ? { section } : {}) };
  const { bot } = await request("/api/bots", {
    method: "POST",
    ...(Object.keys(fields).length ? { body: JSON.stringify(fields) } : {}),
  });
  const chosen = settings && Object.keys(settings).length ? settings : undefined;
  if (!role && !chosen) return { bot };
  try {
    // Settings the person's permissions open (#1076) ride the follow-up patch.
    const { bot: patched } = await request(`/api/bots/${bot.id}`, {
      method: "PATCH", body: JSON.stringify({ ...(role ? roleProfilePatch(role) : {}), ...chosen }),
    });
    return { bot: { ...bot, ...patched, messages: bot.messages } };
  } catch (error) {
    return { bot, profileError: readableError(error) };
  }
}

/** Messages per thread in a snapshot, and per scrollback page.
 *
 * An unbounded `/api/bots` serialises every message of every thread: a
 * long-running room reaches tens of megabytes, which a remote companion
 * cannot buffer and a phone should never be sent. The server has answered
 * bounded pages since the `?messages=` parameter was added; this client now
 * asks for one and pages back through `/api/threads/:id/messages?before=`.
 * Kept at the server's own page maximum so one page fills more than the
 * transcript window mounts. */
export const MESSAGE_PAGE_SIZE = 200;

export async function api<T = any>(path: string, init?: RequestInit & { timeoutMs?: number; stepUpTry?: "recent" | "fresh" }): Promise<T> {
  // timeoutMs races the fetch against AbortSignal.timeout, combined with any
  // caller signal so either can cancel. Omitted means no behavior change.
  const { timeoutMs, signal, stepUpTry, ...rest } = init ?? {};
  const res = await fetch(path, {
    headers: { "content-type": "application/json", [PERSON_THREADS_HEADER]: "1" },
    ...rest,
    signal: timeoutMs === undefined
      ? signal
      : signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An approval or a change that needs the person's security key
    // (shared/step-up.ts): ask the key for exactly what the server named,
    // then send the same request again with the step-up. A step-up made a
    // moment ago for the same card is tried first (one touch covers a
    // card's Always allow and its Allow).
    const target = res.status === 403 && (body?.code === "step_up_required" || body?.code === "step_up_failed") ? body?.target as StepUpTarget | undefined : undefined;
    const original = typeof rest.body === "string" ? (() => { try { return JSON.parse(rest.body as string); } catch { return null; } })() : rest.body === undefined || rest.body === null ? {} : null;
    if (target && stepUpTry !== "fresh" && original && typeof original === "object" && !Array.isArray(original)) {
      const reuse = stepUpTry === undefined ? recentStepUp(target) : undefined;
      if (stepUpTry === "recent") forgetStepUp(target);
      const id = reuse ?? await stepUp(target);
      return api<T>(path, { ...init, body: JSON.stringify({ ...original, stepUp: id }), stepUpTry: reuse ? "recent" : "fresh" });
    }
    const error = body?.error;
    // An older server's "no route: METHOD /path" is never shown: the
    // neutral, translated line takes its place (src/lib/no-route.ts). The
    // server's words stay in `body` for routeMissingOnServer.
    if (res.status === 404 && isNoRouteText(error)) throw new ApiError(t("serverRoute.needsUpdate"), res.status, body);
    // Prefer a sentence the person can read. status and body keep the
    // original for callers that diagnose beyond the line on screen (#1723).
    const raw = permissionMissingMessage(body)
      ?? teamSetupErrorMessage(body)
      ?? engineErrorMessage(body)
      ?? serverErrorMessage(body)
      ?? (typeof error === "string" ? error : typeof error?.message === "string" ? error.message : `${res.status} ${res.statusText}`);
    throw new ApiError(readableError(raw), res.status, body);
  }
  return body;
}

type TrustedApprovalBridge = {
  setMode(
    botId: string,
    mode: ApprovalMode,
    options?: { acknowledgeLocalAuto?: boolean; threadId?: string; threadOnly?: boolean; allThreads?: boolean; refreshPermissions?: boolean },
  ): Promise<BotAnnouncement>;
};

/** Composer changes use the same private bridge as bot settings, but never
 * change profile defaults. Confirmation is UI state, never an HTTP credential. */
export async function persistTaskApproval(
  botId: string, threadId: string, patch: TaskUpdatePatch,
  bridge: TrustedApprovalBridge | undefined,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }> = api,
): Promise<BotAnnouncement> {
  const { approvalMode, autoApprove, confirmFullAccess, organizationFullAccess, acknowledgeLocalAuto, ...ordinary } = patch;
  const mode = approvalMode ?? (autoApprove === undefined ? undefined : autoApprove ? "auto" : "ask");
  // #1674: no private desktop channel (the desktop app on a remote server,
  // a browser) is no reason to refuse Full here: the server decides. An
  // organization server grants it to the bot's owner; any other answers why.
  if (mode === "full" && (organizationFullAccess === true || !bridge)) {
    // Organization server: no desktop channel; the server decides (policy,
    // owner, the one-time confirmation it remembers for the bot).
    const result = await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH",
      body: JSON.stringify({ ...ordinary, approvalMode: "full", ...(confirmFullAccess === true ? { confirmFullAccess: true } : {}) }) });
    return result.bot;
  }
  if (mode === "full" && confirmFullAccess !== true) throw new Error("Confirm Full access for this thread first");
  if (mode === "custom" && !bridge) throw new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server");
  if (mode && bridge) {
    if (Object.keys(ordinary).length) await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH", body: JSON.stringify(ordinary) });
    return bridge.setMode(botId, mode, { threadId, threadOnly: true, acknowledgeLocalAuto: acknowledgeLocalAuto === true });
  }
  const result = await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH", body: JSON.stringify({ ...ordinary, approvalMode, autoApprove, acknowledgeLocalAuto }) });
  return result.bot;
}

/** Persist one coalesced bot edit without ever putting Full/Custom authority
 * on the bot-accessible HTTP surface. Entering a trusted mode writes ordinary
 * fields first, then grants authority. Leaving Custom reverses that order so a
 * coalesced provider switch is validated after the bot is back in Ask/Auto.
 * Exported for a small ordering/security contract test. */
export async function persistBotUpdate(
  botId: string,
  patch: BotUpdatePatch,
  signal: AbortSignal,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }> = api,
  trustedApprovals: TrustedApprovalBridge | undefined =
    typeof window === "undefined" ? undefined : stepUpApprovals(window.ogb?.approvals),
  currentBot?: BotAnnouncement,
): Promise<BotAnnouncement> {
  const {
    approvalMode,
    confirmFullAccess,
    applyToAllThreads,
    organizationFullAccess,
    ...withThread
  } = patch;
  // threadId rides the body with modelSelection only (the server pins the
  // shown conversation for a model switch). The organization Full grant also
  // names it, on its own request. Anywhere else it would be refused.
  const { threadId: openThreadId, ...withoutThread } = withThread;
  const ordinaryPatch: typeof withThread = withThread.modelSelection !== undefined ? withThread : withoutThread;
  // #1674: without the private desktop channel (a remote server) Full goes
  // to the server, which grants it on an organization server.
  if (approvalMode === "full" && (organizationFullAccess === true || !trustedApprovals)) {
    // Organization server: ordinary fields first, then the Full grant alone
    // (the server refuses anything riding along with it). The open
    // conversation is named so the level on screen is the one just saved.
    if (Object.keys(ordinaryPatch).length) {
      await request(`/api/bots/${botId}`, { method: "PATCH", body: JSON.stringify(ordinaryPatch), signal });
    }
    const result = await request(`/api/bots/${botId}`, { method: "PATCH", signal,
      body: JSON.stringify({
        approvalMode: "full",
        ...(confirmFullAccess === true ? { confirmFullAccess: true } : {}),
        ...(typeof openThreadId === "string" ? { threadId: openThreadId } : {}),
      }) });
    return result.bot;
  }
  const trustedMode = approvalMode === "full" || approvalMode === "custom"
    ? approvalMode
    : null;
  const leavesCustom = approvalMode !== undefined &&
    approvalModeFor(currentBot ?? {}) === "custom" &&
    approvalMode !== "custom";

  if (!trustedMode && !leavesCustom) {
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      // The Full confirmation is renderer-local and has already been removed
      // above, including when a rapid later Ask/Auto choice was coalesced.
      body: JSON.stringify(
        approvalMode === undefined ? ordinaryPatch : { ...ordinaryPatch, approvalMode },
      ),
      signal,
    });
    return result.bot;
  }

  if (approvalMode === "full" && confirmFullAccess !== true) {
    throw new Error("Confirm the Full access warning before enabling it");
  }
  if (!trustedApprovals || approvalMode === undefined) {
    throw new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server");
  }

  const trustedOptions = {
    acknowledgeLocalAuto: ordinaryPatch.acknowledgeLocalAuto === true,
    ...(applyToAllThreads ? { allThreads: true } : {}),
  };

  const rejectCancelledTrustedGrant = async () => {
    if (!signal.aborted) return;
    // IPC cannot cancel a grant that already reached the embedded server. If
    // a newer selection or an unmount aborted this operation while
    // Full/Custom was in flight, revoke it through the same private channel
    // before reporting cancellation. The server permits this one fail-closed
    // downgrade even if a turn happened to start in the response gap.
    if (approvalMode === "full" || approvalMode === "custom") {
      try {
        await trustedApprovals.setMode(botId, "ask", { acknowledgeLocalAuto: false, ...(applyToAllThreads ? { allThreads: true } : {}) });
      } catch (error) {
        throw new Error(
          `The cancelled ${approvalMode === "full" ? "Full access" : "Custom approval"} grant could not be revoked: ${
            readableError(error)
          }`,
        );
      }
    }
    throw new DOMException("The bot update was cancelled", "AbortError");
  };

  if (leavesCustom) {
    const modeBot = await trustedApprovals.setMode(botId, approvalMode, trustedOptions);
    await rejectCancelledTrustedGrant();
    if (Object.keys(ordinaryPatch).length === 0) return modeBot;
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(ordinaryPatch),
      signal,
    });
    return result.bot;
  }

  if (Object.keys(ordinaryPatch).length > 0) {
    await request(`/api/bots/${botId}`, {
      method: "PATCH",
      // Local-computer + Auto consent remains relevant when the approval
      // transition itself uses the private channel (for example, a coalesced
      // Auto -> Full edit). The HTTP computer update must retain that proof.
      body: JSON.stringify(ordinaryPatch),
      signal,
    });
  }
  if (signal.aborted) throw new DOMException("The bot update was cancelled", "AbortError");
  const modeBot = await trustedApprovals.setMode(botId, approvalMode, trustedOptions);
  await rejectCancelledTrustedGrant();
  return modeBot;
}

/** Bot removal is intentionally non-optimistic. The server first removes any
 * computer owned only by this bot, so local state changes only after that
 * durable cleanup and the bot deletion both succeed. */
const pendingBotDeletions = new Map<string, Promise<void>>();

export async function requestConfirmedBotDeletion(
  botId: string,
  requestDelete: (botId: string) => Promise<unknown>,
  onConfirmed: (botId: string) => void,
): Promise<void> {
  const existing = pendingBotDeletions.get(botId);
  if (existing) return existing;
  const deletion = (async () => {
    await requestDelete(botId);
    onConfirmed(botId);
  })();
  pendingBotDeletions.set(botId, deletion);
  try {
    await deletion;
  } finally {
    if (pendingBotDeletions.get(botId) === deletion) pendingBotDeletions.delete(botId);
  }
}

export interface PeripheralSnapshotLoad<Key extends string = string> {
  key: Key;
  load: () => Promise<void>;
}

function normalizeSnapshotFailure(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** A refused SSE resume needs the chat transcript snapshot before its cursor
 * can be acknowledged. The other panels should refresh at the same boundary,
 * but a broken optional endpoint must not hold every chat frame hostage. */
export async function loadSnapshotBoundary<Key extends string>(
  loadChat: () => Promise<void>,
  peripherals: readonly PeripheralSnapshotLoad<Key>[],
  onPeripheralFailure: (part: PeripheralSnapshotLoad<Key>, error: Error) => void,
): Promise<boolean> {
  const [chat, ...settledPeripherals] = await Promise.allSettled([
    loadChat(),
    ...peripherals.map((part) => part.load()),
  ]);
  settledPeripherals.forEach((result, index) => {
    if (result.status === "rejected") {
      onPeripheralFailure(peripherals[index]!, normalizeSnapshotFailure(result.reason));
    }
  });
  return chat.status === "fulfilled";
}

/** The chat shows a reply once it is finished (the turn's busy state is
 * what a reader sees while it works). Runtime frames feed the reducer only
 * through the model-variant fold; streamed deltas go to the stream buffer
 * below, which only Sagax's Live call and floating bots read. */
export function runtimeFrameAction(event: RuntimeEvent): Action | null {
  return event.type === "turn.started" || event.type === "session.model-variants" || event.type === "session.model-fallback" || event.type === "turn.completed"
    ? { type: "modelVariantRuntime", event }
    : null;
}

/** Per-frame stream state lives in its OWN context: token frames update only
 * the components that read this hook (the Live call's spoken reply and the
 * floating bots' balloons), while every useStore consumer (sidebar, mascots,
 * pickers, the settled transcript) keeps its render tree untouched during a
 * stream. */
interface StreamState {
  /** in-flight assistant text per threadId */
  streaming: Record<string, string>;
  /** in-flight extended thinking per threadId (ephemeral) */
  reasoning: Record<string, string>;
}
const EMPTY_STREAM: StreamState = { streaming: {}, reasoning: {} };
const StreamContext = createContext<StreamState>(EMPTY_STREAM);

type PendingDelta = { text: string; reasoning: string };

/** Paint once per frame, but keep draining when a hidden tab pauses rAF.
 * Flush pending chunks at 64 Ki UTF-16 characters or a 100ms fallback timer.
 * Accumulated output remains intact and unbounded; this is not a memory cap. */
export function createStreamDeltaBuffer(onFlush: (entries: Array<[string, PendingDelta]>) => void) {
  const buffer = new Map<string, PendingDelta>();
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let characters = 0;
  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    cancel();
    if (!buffer.size) return;
    const entries = [...buffer];
    buffer.clear();
    characters = 0;
    onFlush(entries);
  };
  /** Drop every pending thread. A non-resumable hydrate must call this so a
   * truncated answer cannot flush after the live map was emptied. */
  const reset = () => {
    cancel();
    buffer.clear();
    characters = 0;
  };
  return {
    push(threadId: string, kind: string, delta: string) {
      if (kind !== "assistant_text" && kind !== "reasoning_text") return;
      const entry = buffer.get(threadId) ?? { text: "", reasoning: "" };
      if (kind === "assistant_text") entry.text += delta;
      else entry.reasoning += delta;
      buffer.set(threadId, entry);
      characters += delta.length;
      if (characters >= 64 * 1024) flush();
      else if (frame === null) {
        frame = requestAnimationFrame(flush);
        timer = setTimeout(flush, 100);
      }
    },
    clear(threadId: string) {
      const entry = buffer.get(threadId);
      if (entry) characters -= entry.text.length + entry.reasoning.length;
      buffer.delete(threadId);
      if (!buffer.size) cancel();
    },
    reset,
    flush,
    dispose: reset,
  };
}

export function useStreaming() {
  return useContext(StreamContext);
}

/** The in-flight text a gallery or a test draws, without the whole store. */
export function StreamingPreview({ streaming, children }: { streaming: Record<string, string>; children?: ReactNode }) {
  const value = useMemo(() => ({ streaming, reasoning: {} }), [streaming]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Commit any debounced profile edits before an operation reads the bot. */
  flushBotPatches: (botId: string) => Promise<BotAnnouncement | null>;
  /** Re-fetch engine availability — after an install, without a restart. */
  refreshInstances: (options?: { reportErrors?: boolean }) => Promise<void>;
  /** Explicit provider/network model discovery. */
  refreshModels: (instanceId: string) => Promise<void>;
} | null>(null);

/** Lazy useReducer init: adopt the section this device last viewed once per
 * launch, so a bare open starts there. The exported initialState stays
 * "overview"/false and the reducer never touches localStorage. */
function restoreBotSettingsSection(state: AppState): AppState {
  const section = readLastBotSection();
  const withHidden = { ...state, sidebarHiddenKeys: hiddenKeySet(readSidebarHidden()) };
  return section ? { ...withHidden, botSettingsSection: section, botSettingsSectionStored: true } : withHidden;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const taskWrites = useRef(new Map<string, { botId: string; updatesDefault: boolean; promise: Promise<BotAnnouncement>; execution: Promise<unknown>; patch: TaskUpdatePatch }>()).current;
  const withTaskWrites = (bot: BotAnnouncement): BotAnnouncement => ({
    ...bot,
    tasks: bot.tasks?.map((task) => ({ ...task, ...taskPatchFields(taskWrites.get(task.threadId)?.patch ?? {}) })),
  });
  const [state, rawDispatch] = useReducer(reducer, initialState, restoreBotSettingsSection);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (state.hydrated && state.config && !state.config.personalSettings) migrateInstalledVoiceSettings(state.config.tts, state.bots);
  }, [state.hydrated, state.config, state.bots]);
  const showThreads = useShowThreads();
  const showThreadsRef = useRef(showThreads);
  showThreadsRef.current = showThreads;
  // per-frame stream-delta batching (see the "runtime" SSE case); stream
  // state is intentionally OUTSIDE the reducer so token frames re-render
  // only StreamContext consumers
  const [stream, setStream] = useState<StreamState>(EMPTY_STREAM);
  const deltaBuffer = useMemo(() => createStreamDeltaBuffer((entries) => {
    setStream((prev) => {
      const streaming = { ...prev.streaming };
      const reasoning = { ...prev.reasoning };
      for (const [threadId, d] of entries) {
        if (d.text) streaming[threadId] = (streaming[threadId] ?? "") + d.text;
        if (d.reasoning) reasoning[threadId] = (reasoning[threadId] ?? "") + d.reasoning;
      }
      return { streaming, reasoning };
    });
  }), []);
  const flushDeltas = deltaBuffer.flush;
  const clearStream = (threadId: string) => {
    // Drop the thread's un-flushed deltas too: the settled message that
    // triggered this clear already contains them. Without this, the pending
    // rAF re-creates a "ghost" stream holding the tail fragment, and the
    // next block's deltas append onto the duplicated tail instead of
    // starting fresh.
    deltaBuffer.clear(threadId);
    setStream((prev) => {
      if (!(threadId in prev.streaming) && !(threadId in prev.reasoning)) return prev;
      const { [threadId]: _s, ...streaming } = prev.streaming;
      const { [threadId]: _r, ...reasoning } = prev.reasoning;
      return { streaming, reasoning };
    });
  };
  // A non-resumable hello hydrates from REST and never replays the missed
  // turn.completed / final message frames, so any half-written live text must
  // go: otherwise LiveReply keeps the truncated bubble under the settled
  // transcript and the next turn's deltas prepend onto it (#1749).
  const resetStreams = () => {
    deltaBuffer.reset();
    setStream(EMPTY_STREAM);
  };
  const clearChatError = useCallback(() => {
    rawDispatch({ type: "error", message: null });
  }, []);
  useChatErrorClear(state.error, clearChatError);
  // Every selection path lands on state.selectedId, so one effect is the
  // whole remember; an empty selection must never overwrite it.
  useEffect(() => {
    if (state.selectedId) rememberConversation(state.selectedId);
  }, [state.selectedId]);
  // A remembered conversation that no longer resolves to a listed one
  // (deleted, hidden, closed) is forgotten once the snapshot says nothing
  // is open, so the next launch does not try to resume it.
  useEffect(() => {
    if (!state.hydrated || state.selectedId) return;
    const remembered = readLastConversation();
    if (remembered && !selectionListed(state.bots, state.groups, remembered, state.sidebarHiddenKeys)) forgetConversation();
  }, [state.hydrated, state.selectedId, state.bots, state.groups, state.sidebarHiddenKeys]);
  // The sidebar hidden list lives in a synced preference; the reducer gets
  // it as data so a restored or fallback selection can respect it.
  const sidebarHidden = useSidebarHidden();
  useEffect(() => {
    const keys = hiddenKeySet(sidebarHidden);
    const current = stateRef.current.sidebarHiddenKeys;
    if (keys.size === current.size && [...keys].every((key) => current.has(key))) return;
    rawDispatch({ type: "sidebarHidden", keys });
  }, [sidebarHidden]);
  // Rail clicks, deep links and remembered openings all carry the accordion
  // flag, so only a section actually viewed is written; a bare open that
  // stays collapsed never is.
  useEffect(() => {
    if (state.settingsOpen && state.botSettingsExpandAccordion) rememberBotSection(state.botSettingsSection);
  }, [state.settingsOpen, state.botSettingsExpandAccordion, state.botSettingsSection]);
  const botPatchQueue = useMemo(
    () =>
      createBotPatchQueue<BotAnnouncement>({
        send: (botId, patch, signal, currentBot) =>
          persistBotUpdate(botId, patch, signal, api, stepUpApprovals(window.ogb?.approvals), currentBot),
        reconcile: async (botId, signal) => {
          const result: { bots: BotAnnouncement[] } = await api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`, { signal });
          return result.bots.find((candidate) => candidate.id === botId) ?? null;
        },
        onAuthoritative: (bot, optimisticOverlay) => {
          rawDispatch({ type: "botPatched", bot: withTaskWrites({ ...bot, ...optimisticOverlay }) });
        },
        onError: (error) => {
          rawDispatch({ type: "error", message: error.message });
        },
      }),
    [],
  );

  useEffect(() => {
    // StrictMode's dev probe runs this cleanup once against the same memoized
    // queue; revive undoes it so profile saves survive development mounts.
    botPatchQueue.revive();
    return () => botPatchQueue.dispose();
  }, [botPatchQueue]);

  // The last pages of recently seen threads, and the sidebar's read-only
  // prefetch into them (src/lib/thread-page-cache.ts): a switch draws the
  // cached page at once, then takes the page its own request answers.
  const threadPages = useMemo(() => new ThreadPageCache<Message>(), []);
  const threadPrefetch = useMemo(() => createThreadPrefetcher({
    cache: threadPages,
    // GET, a pure read: the switch (POST) is what moves the selection
    fetchPage: async (threadId, signal) => {
      const page = await api<{ messages?: Message[]; hasMore?: boolean; activeLeafId?: string | null }>(
        `/api/threads/${encodeURIComponent(threadId)}/messages?limit=${MESSAGE_PAGE_SIZE}`, { signal });
      return { messages: page.messages ?? [], hasMore: Boolean(page.hasMore), activeLeafId: page.activeLeafId };
    },
  }), [threadPages]);

  const dispatch = useMemo(() => {
    const navigation = new Map<string, number>();
    // The fresh topics being made, per bot (the first message's send).
    const freshTopicsCreating = new Map<string, Promise<string>>();
    let selectionRevision = 0;
    const olderPagesInFlight = new Set<string>();
    let creatingBot = false;
    const showError = (e: unknown) => {
      // A short deploy restart: keep the transcript, show Reconnecting, no toast.
      const snap = stateRef.current;
      if (
        shouldSuppressDeployOutageError({
          failure: e,
          everConnected: snap.everConnected,
          connected: snap.connected,
          disconnectedAt: snap.disconnectedAt,
        })
      ) {
        return;
      }
      rawDispatch({ type: "error", message: readableError(e) });
    };
    /** Where a card action's message lives, and the card on it. A card asked
     * inside a room belongs to the room's list, never to one member's. */
    const cardTarget = (action: { botId: string; messageId: string; groupId?: string }) => {
      const host = action.groupId
        ? stateRef.current.groups.find((g) => g.id === action.groupId)
        : stateRef.current.bots.find((b) => b.id === action.botId);
      return { host, card: host?.messages.find((m) => m.id === action.messageId)?.card, inRoom: !!action.groupId };
    };
    // fire-and-forget card persistence; the route is optional server-side
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    const waitForExecutionSettings = async (expectedBots: Bot[], threadId?: string) => {
      // Capture this send's task save before waiting on slower profile saves.
      // Reconciliation may clear a failed lane meanwhile; that must not turn
      // an already-waiting send into work under reverted settings.
      const taskWrite = threadId ? taskWrites.get(threadId)?.execution : undefined;
      const defaultWrites = [...taskWrites.values()].filter((write) => write.updatesDefault && expectedBots.some((bot) => bot.id === write.botId));
      await Promise.all([taskWrite, ...defaultWrites.map((write) => write.execution), ...expectedBots.map(async (expected) => {
        const persisted = await botPatchQueue.flush(expected.id);
        if (!persisted) return;
        const expectedSelection = expected.modelSelection;
        if (
          approvalModeFor(persisted) !== approvalModeFor(expected) ||
          (persisted.memoryEnabled !== false) !== (expected.memoryEnabled !== false) ||
          persisted.modelSelection.instanceId !== expectedSelection.instanceId ||
          persisted.modelSelection.model !== expectedSelection.model ||
          persisted.modelSelection.effort !== expectedSelection.effort ||
          persisted.modelSelection.variant !== expectedSelection.variant
        ) {
          throw new Error("The approval level, memory setting, or model could not be saved, so this work was not started");
        }
      })]);
      if (threadId) await taskWrites.get(threadId)?.execution;
    };

    const persistTaskPatch = (botId: string, threadId: string, patch: TaskUpdatePatch) => {
      const previous = taskWrites.get(threadId);
      // A quick tab switch may queue two default changes on different threads.
      // Keep their order, and don't let a group send race either pending save.
      const defaults = patch.updateBotDefault || patch.approvalMode !== undefined
        ? [...taskWrites.values()].filter((write) => write.botId === botId) : [];
      const promise = Promise.all([previous?.promise, ...defaults.map((write) => write.promise)].map((save) => save?.catch(() => {})))
        .then(async () => {
          return persistTaskApproval(botId, threadId, patch, stepUpApprovals(window.ogb?.approvals));
        });
      // Later edits still get saved after an earlier failure, but a send
      // awaiting this batch must observe every rejected setting in it. A
      // successful folder move is not confirmation of a failed model change.
      const execution = Promise.all([previous?.execution, promise]);
      void execution.catch(() => {}); // handled by the write and send paths
      const pending = { botId, updatesDefault: Boolean(patch.updateBotDefault || previous?.updatesDefault), patch: { ...previous?.patch, ...patch }, promise, execution };
      taskWrites.set(threadId, pending);
      void pending.promise.then((bot) => {
        if (taskWrites.get(threadId) !== pending) return;
        taskWrites.delete(threadId);
        if (bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
      }).catch((error) => {
        showError(error);
        // Block sends until authoritative settings have been restored. Do
        // not clear the failed write if reconciliation also fails or a newer
        // write supersedes it: those settings are still unconfirmed.
        if (taskWrites.get(threadId) === pending) {
          pending.patch = {};
          void api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`).then(({ bots }) => {
            if (taskWrites.get(threadId) !== pending) return;
            const bot = bots.find((candidate: Bot) => candidate.id === botId);
            if (bot) {
              rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
              taskWrites.delete(threadId);
            }
          }).catch(() => {});
        }
      });
    };

    /** Resolve every bot whose execution context belongs to this thread. A
     * direct chat may name an inactive task, while a channel request belongs
     * to every member that could be selected to run it. Capture the result
     * before the optimistic reducer runs so approval/model writes cannot race
     * a response that resumes (or starts) work. */
    const executionBotsForThread = (threadId: string): Bot[] => {
      const snapshot = stateRef.current;
      const botIds = new Set<string>();
      for (const bot of snapshot.bots) {
        if (bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId)) {
          botIds.add(bot.id);
        }
      }
      for (const group of snapshot.groups) {
        if (group.threadId === threadId || group.tasks?.some((task) => task.threadId === threadId)) {
          for (const memberId of group.memberIds) botIds.add(memberId);
        }
      }
      return snapshot.bots.filter((bot) => botIds.has(bot.id));
    };

    const wrapped: React.Dispatch<Action> = (action) => {
      // Deferred folder creation may select its bot only while it is still
      // the latest navigation intent, even if the person went away and back.
      if (["select", "newTask", "switchTask", "newGroupTask", "switchGroupTask", "showChat", "showRoutines", "showTeamMap", "showCode", "showApprovals", "showRemoteSessions", "showAchievements"].includes(action.type)) selectionRevision++;
      // Pin before any await or optimistic state change, including legacy
      // callers such as keyboard shortcuts and voice controls.
      action = pinBotThreadAction(action, stateRef.current.bots);
      if (action.type === "taskSwitched") action = { ...action, bot: withTaskWrites(action.bot) as Bot };
      if (action.type === "botPatched") action = { ...action, bot: withTaskWrites(action.bot) };
      // One identity drives the optimistic row, HTTP retry protection, and
      // canonical SSE reconciliation. Callers may omit it; the store may not.
      if ((action.type === "send" || action.type === "sendGroup" || action.type === "editMessage") && !action.sendId) {
        action = { ...action, sendId: crypto.randomUUID() };
      }
      const botBeforeUpdate =
        action.type === "updateBot" || action.type === "setModel"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      const botBeforeSend =
        action.type === "send"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      // the branch an edit replaces on screen, restored if the edit fails
      const leafBeforeEdit =
        action.type === "editMessage"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)?.activeLeafId ?? null
          : null;
      const executionBotsBeforeAction = (() => {
        if (action.type === "editMessage" || action.type === "answerCard") {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          return bot ? [bot] : [];
        }
        if (action.type === "decideRequest") {
          const bots = executionBotsForThread(action.threadId);
          if (!action.alwaysAllow || bots.some((bot) => bot.id === action.alwaysAllow?.botId)) {
            return bots;
          }
          const grantBot = stateRef.current.bots.find((bot) => bot.id === action.alwaysAllow?.botId);
          return grantBot ? [...bots, grantBot] : bots;
        }
        if (action.type === "sendGroup") {
          const memberIds = stateRef.current.groups.find((group) => group.id === action.groupId)?.memberIds ?? [];
          return stateRef.current.bots.filter((candidate) => memberIds.includes(candidate.id));
        }
        if (action.type === "runRoutine") {
          const routine = stateRef.current.routines.find((candidate) => candidate.id === action.routineId);
          if (!routine) return [];
          const ids = new Set([routine.botId]);
          if (routine.target === "room-goal" && routine.groupId) {
            const group = stateRef.current.groups.find((candidate) => candidate.id === routine.groupId);
            for (const memberId of group?.memberIds ?? []) ids.add(memberId);
          }
          return stateRef.current.bots.filter((candidate) => ids.has(candidate.id));
        }
        return [];
      })();
      // Read before the reducer runs: the send lands in a fresh topic.
      const freshSendBefore = action.type === "send" && sendsToFreshTopic(stateRef.current, action);
      const quizBeforeSend = (() => {
        if (action.type !== "send") return undefined;
        return botBeforeSend ? openOnboardingCard(botBeforeSend) : undefined;
      })();
      // A queued message is still real until the server confirms deletion.
      // Bot deletion is also server-authoritative: lifecycle guards may reject
      // it, and hiding the row first strands the computer the person must
      // remove. All other actions keep their existing optimistic behavior.
      if (action.type === "switchTask") {
        const switching = action;
        const leaving = stateRef.current.bots.find((candidate) => candidate.id === switching.botId);
        // The thread left behind, as it stands, for a switch back to it.
        if (leaving && leaving.threadId !== switching.threadId && !leaving.switchingTo && !leaving.awaitingThreadSnapshot && leaving.messages.length) {
          threadPages.set(leaving.threadId, { messages: leaving.messages, hasMore: leaving.hasMore, activeLeafId: leaving.activeLeafId, at: Date.now() });
        }
        const cached = switching.whole ? undefined : threadPages.get(switching.threadId);
        // The switch itself lands at once: the live frames and the read marks
        // read Bot.switchingTo from the latest state. Drawing the cached page
        // is a transition, so the click stays responsive while it renders.
        rawDispatch(switching);
        if (cached) startTransition(() => rawDispatch({ type: "previewThread", botId: switching.botId, threadId: switching.threadId, page: cached }));
      } else if (
        action.type !== "cancelQueued" &&
        action.type !== "cancelGroupQueued" &&
        action.type !== "deleteBot"
      ) rawDispatch(action);
      switch (action.type) {
        case "loadOlderMessages": {
          // The reducer's flag is for the UI; this set is the guard, because
          // `stateRef` still holds the state from before this dispatch.
          if (olderPagesInFlight.has(action.threadId)) break;
          olderPagesInFlight.add(action.threadId);
          const current = stateRef.current;
          const owner = [...current.bots, ...current.groups].find((candidate) => candidate.threadId === action.threadId);
          const before = owner?.messages[0]?.id;
          // The transcript this page is being asked about. `loadOlderMessages`
          // does not move it, so the value here is the one the reducer will
          // compare against when the answer lands.
          const generation = current.transcriptGeneration[action.threadId] ?? 0;
          // Nothing to page back from: the reducer's loading flag would never
          // be cleared by a response that is not coming.
          if (!before) {
            olderPagesInFlight.delete(action.threadId);
            rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: false });
            break;
          }
          api<{ messages: Message[]; hasMore?: boolean }>(
            `/api/threads/${action.threadId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
          )
            .finally(() => olderPagesInFlight.delete(action.threadId))
            .then((page) => rawDispatch({
              type: "olderMessages",
              threadId: action.threadId,
              generation,
              messages: page.messages ?? [],
              hasMore: Boolean(page.hasMore),
            }))
            .catch((error) => {
              // Clear the flag on the way out, or the pill stays disabled for
              // the rest of the session after one failed page.
              rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: true });
              showError(error);
            });
          break;
        }
        case "notice":
          if (action.notice) setTimeout(() => rawDispatch({ type: "notice", notice: null }), 6000);
          break;
        case "createRoutine": {
          // #1753: /loop and other createRoutine callers share the #1522
          // lost-answer guard so a proxy cut never shows a raw status or
          // invites a duplicate create.
          const knownRoutineIds = new Set(stateRef.current.routines.map((routine) => routine.id));
          const wanted = { name: action.input.name, botId: action.input.botId, target: action.input.target };
          void api("/api/routines", { method: "POST", body: JSON.stringify(action.input) })
            .catch(async (error) => {
              const created = await recoverCreatedRoutineAfterLostAnswer(
                error,
                knownRoutineIds,
                wanted,
                () => api("/api/routines") as Promise<{ routines?: Routine[] }>,
              );
              if (created) {
                rawDispatch({ type: "routinePatched", routine: created });
                return;
              }
              showError(createAnswerErrorMessage(error, t("routineCalendar.saveAnswerLost")));
            });
          break;
        }
        case "updateRoutine": {
          // Switched on or off while its bot's conversation is open: that
          // conversation gets the "Disabled · 1 routine" line (the server
          // checks the routine is that bot's and the thread the person's).
          const open = stateRef.current.bots.find((candidate) => candidate.id === stateRef.current.selectedId);
          const conversation = action.patch.enabled !== undefined && open?.threadId ? open.threadId : null;
          api(`/api/routines/${action.routineId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
            ...(conversation ? { headers: { "content-type": "application/json", [PERSON_THREADS_HEADER]: "1", [ROUTINE_CONVERSATION_HEADER]: conversation } } : {}),
          }).catch(showError);
          break;
        }
        case "deleteRoutine":
          api(`/api/routines/${action.routineId}`, { method: "DELETE" }).catch(showError);
          break;
        case "runRoutine":
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/routines/${action.routineId}/run`, { method: "POST" }))
            .then(({ run }) => action.onStarted?.(run))
            .catch((error) => {
              if (action.onError) action.onError(error);
              else showError(error);
            })
            .finally(() => action.onSettled?.());
          break;
        case "cancelRoutineRun":
          api(`/api/routine-runs/${action.runId}/cancel`, { method: "POST" }).catch(showError);
          break;
        // The Data tab's sheet. The panel runs and cancels SQL itself (it
        // owns the request to abort); those answer through the server's
        // `data` frame (the whole sheet), so every window sees the same
        // cards. A panel-local onError keeps a server without the surface
        // from raising the app-wide error line.
        case "loadDataSheet":
          api(withDataThread(DATA_ROUTES.sheet(action.botId), action.threadId))
            .then((body) => rawDispatch({ type: "dataSheet", sheet: dataSheetFromResponse(body, action.botId), tables: dataTablesFromResponse(body), ...(action.threadId ? { threadId: action.threadId } : {}) }))
            .catch((error) => (action.onError ?? showError)(readableError(error)));
          break;
        case "markRoutineRunSeen":
          api(`/api/routine-runs/${action.runId}/seen`, { method: "POST" }).catch(showError);
          break;
        case "markAllRoutineRunsSeen":
          api("/api/routine-runs/seen-all", { method: "POST" }).catch(showError);
          break;
        case "clearRoutineRuns":
          api("/api/routine-runs", { method: "DELETE" })
            .then(({ removed }) => rawDispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] }))
            .catch(showError);
          break;
        case "cancelQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}`, { method: "DELETE", body: JSON.stringify({ threadId: action.threadId }) })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}/steer`, { method: "POST", body: JSON.stringify({ threadId: action.threadId }) })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "cancelGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}`, { method: "DELETE" })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}/steer`, {
            method: "POST",
            body: JSON.stringify({ threadId: action.threadId }),
          })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "send": {
          // persist through the existing card route so an older server that
          // does not auto-dismiss still hides the quiz on this client
          if (quizBeforeSend) persistCard(action.botId, quizBeforeSend.id, { dismissed: true });
          // The first message of a fresh topic (src/lib/fresh-topic.ts): the
          // server creates the topic now, then the message goes there. No
          // empty topic is ever made ahead of it.
          if (freshSendBefore) {
            const { replyToId: _reply, ...rest } = action;
            // A second message typed while the topic is being made waits
            // for it and goes there too: one topic, never two.
            let creating = freshTopicsCreating.get(action.botId);
            if (!creating) {
              const revision = (navigation.get(action.botId) ?? 0) + 1;
              navigation.set(action.botId, revision);
              creating = botPatchQueue.flush(action.botId)
                .then(() => api<{ bot: Bot; task?: { threadId?: string } }>(`/api/bots/${action.botId}/tasks`, { method: "POST", body: JSON.stringify({ stream: true }) }))
                .then((r) => {
                  const created = r?.task?.threadId ?? r?.bot?.threadId;
                  if (!r?.bot || !created) throw new Error(t("stream.freshFailed"));
                  if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
                  if (navigation.get(action.botId) === revision) dispatch({ type: "taskSwitched", bot: r.bot });
                  rawDispatch({ type: "freshTopic", botId: action.botId, threadId: null });
                  return created;
                })
                .finally(() => freshTopicsCreating.delete(action.botId));
              freshTopicsCreating.set(action.botId, creating);
            }
            creating
              .then((threadId) => dispatch({ ...rest, threadId }))
              .catch((error) => {
                showError(error);
                action.onError?.();
              });
            break;
          }
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          beginLocalSend(sendId);
          // words typed to a bot that is on a voice call are a call turn too:
          // its answer is read aloud like the rest of the call
          const liveCallId = voiceCallId(action.botId);
          const voiceCall = action.voiceCall ?? (liveCallId ? { callId: liveCallId } : undefined);
          // on a call, words said or typed while the bot works join its turn
          const busyMode = voiceCall ? undefined : action.busyMode;
          void waitForExecutionSettings(botBeforeSend ? [botBeforeSend] : [], threadId)
            .then(() => {
              if (!claimInFlightSend(sendId)) {
                if (threadId) rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
                restoreComposerDraft(`bot:${action.botId}:${threadId ?? ""}`, { text: action.text, attachments: [] });
                return null;
              }
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.text, replyToId: action.replyToId, threadId, sendId, ...(action.mode === "goal" ? { mode: "goal" } : {}), ...(voiceCall ? { voiceCall } : {}), ...(busyMode === "auto" ? { routeWhileBusy: true } : busyMode ? { busyMode } : {}), ...(action.dataContext ? { dataContext: action.dataContext } : {}), ...devPodsTurnField(), ...singleStreamTurnField() }),
              });
            })
            .then((body) => {
              if (body === null) return;
              action.onSent?.();
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                  reason: body.reason === "capacity" || body.reason === "group-turn" ? body.reason : undefined,
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            })
            .finally(() => finishSend(sendId));
          break;
        }
        case "stopParallelTask":
          api(`/api/bots/${action.botId}/parallel/${action.threadId}/stop`, { method: "POST", body: "{}" }).catch(showError);
          break;
        case "editMessage": {
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction, threadId)
            .then(() => api(`/api/bots/${action.botId}/messages/${action.messageId}/edit`, {
              method: "POST",
              body: JSON.stringify({ text: action.text.trim(), threadId, sendId, ...devPodsTurnField(), ...singleStreamTurnField() }),
            }))
            .then((body) => {
              // the POST may beat its SSE frames; fold the fork either way
              if (body?.message && threadId) {
                rawDispatch({ type: "messageAdded", threadId, message: body.message });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId, restoreLeafId: leafBeforeEdit });
              }
              showError(error);
            });
          break;
        }
        case "switchBranch":
          api(`/api/bots/${action.botId}/active-branch`, {
            method: "POST",
            body: JSON.stringify({ messageId: action.messageId, threadId: action.threadId }),
          }).catch(showError);
          break;
        case "decideRequest": {
          const respond = () =>
            api(`/api/threads/${action.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: action.requestId,
                behavior: action.behavior,
                message: action.message,
                reviewedSha256: action.reviewedSha256,
                always: action.always,
                rememberCommand: action.rememberCommand,
                rule: action.rule,
                ...(action.ruleScope ? { ruleScope: action.ruleScope } : {}),
              }),
            });
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(async () => {
              if (action.alwaysAllow) {
                const bot = stateRef.current.bots.find((candidate) => candidate.id === action.alwaysAllow?.botId);
                // a bot-to-bot conversation (even one left out of tasks) keeps
                // its grant on that thread, never the whole bot
                const owner = bot?.tasks?.some((task) => task.threadId === action.threadId)
                  || bot?.waitingApprovals?.some((row) => row.threadId === action.threadId);
                const next = [...new Set([...(bot ? currentTaskBot(bot, action.threadId).alwaysAllow ?? [] : []), action.alwaysAllow.key])];
                // Save the grant BEFORE releasing the bot: it may ask again
                // within milliseconds. A failed preference save must still
                // let this one response through, but the person should see it.
                try {
                  await api(owner ? `/api/bots/${action.alwaysAllow.botId}/always-allow` : `/api/bots/${action.alwaysAllow.botId}`, {
                    method: owner ? "POST" : "PATCH",
                    body: JSON.stringify(owner ? { threadId: action.threadId, allowKey: action.alwaysAllow.key } : { alwaysAllow: next }),
                  });
                } catch (error) {
                  showError(error);
                }
              }
              const response = await respond();
              if (response?.settlementPending && typeof response.message === "string") {
                showError(new Error(response.message));
              }
            })
            .catch((error) => {
              // settled already, elsewhere: the card shows the real outcome
              const settled = teamMemorySettled(error);
              if (settled) {
                rawDispatch({ type: "cardSettled", threadId: action.threadId, requestId: action.requestId, patch: settled.card });
                showError(settled.text);
                action.onError?.(settled.text);
                return;
              }
              // A settings flush failure deliberately stops the response;
              // otherwise it could resume work under a stale approval level.
              showError(error);
              action.onError?.(readableError(error));
            });
          break;
        }
        case "answerCard": {
          const { host, card, inRoom } = cardTarget(action);
          // 2026-10-30: a proactive proposal answers on its own route: yes
          // starts the bot's wake, no closes the card; never a typed message
          if (card?.proactiveProposal && !inRoom) {
            api(`/api/bots/${action.botId}/proactive/${card.proactiveProposal.id}`, {
              method: "POST",
              body: JSON.stringify({ accept: proactiveProposalAccepts(card, action.answer) }),
            }).catch(showError);
            break;
          }
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(() => {
              if (card?.requestId && host) {
                // allow/deny for a permission, the chosen text for a question
                // — decided from the card, never from the label (see
                // card-answer.ts). By THREAD, so a card raised inside a room
                // answers the same way a 1:1 one does.
                const response = card.skillRequest
                  ? { behavior: skillRequestBehavior(action.answer) }
                  : card.terminalRequest
                    ? { behavior: terminalRequestBehavior(action.answer) }
                    : card.meetingRequest
                      ? { behavior: meetingRequestBehavior(action.answer) }
                      : answerResponse(card, action.answer);
                return api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
                  method: "POST",
                  body: JSON.stringify({
                    requestId: card.requestId,
                    ...response,
                    reviewedSha256: response.behavior === "allow" && card.skillRequest
                      ? reviewedSkillSha256(card.skillRequest)
                      : undefined,
                    ...(card.terminalRequest && response.behavior === "allow" && action.terminalDestination
                      ? { terminalDestination: action.terminalDestination }
                      : {}),
                  }),
                });
              }
              if (inRoom) return;
              persistCard(action.botId, action.messageId, { answered: action.answer, dismissed: true });
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.answer, threadId: action.threadId }),
              });
            })
            .catch((error) => {
              // settled already, elsewhere: the card shows the real outcome
              const settled = teamMemorySettled(error);
              const threadId = action.threadId ?? host?.threadId;
              if (settled && card?.requestId && threadId) {
                rawDispatch({ type: "cardSettled", threadId, requestId: card.requestId, patch: settled.card });
                showError(settled.text);
                return;
              }
              showError(error);
            });
          break;
        }
        case "dismissCard": {
          const { host, card, inRoom } = cardTarget(action);
          if (card?.requestId && host) {
            // a question is DECLINED rather than denied — the broker refuses
            // a deny on one (see card-answer.ts)
            api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({ requestId: card.requestId, ...dismissResponse(card) }),
            }).catch(() => {});
          } else if (!inRoom) {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
        case "newBot": {
          // The picker can close/remount before React paints pending state.
          if (creatingBot) break;
          creatingBot = true;
          rawDispatch({ type: "botCreationPending", on: true });
          void createBotWithRole(action.role, api, action.visibility, action.section, action.settings)
            .then(({ bot, profileError }) => {
              rawDispatch({ type: "botAdded", bot, preserveSelection: action.preserveSelection });
              action.onCreated?.(bot);
              if (profileError) {
                showError(t("newBot.profileFailed", { error: profileError }));
                rawDispatch({ type: "toggleSettings", open: true, section: "soul" });
              }
            })
            .catch((error) => {
              if (action.onError) action.onError(readableError(error));
              else showError(error);
            })
            .finally(() => {
              creatingBot = false;
              rawDispatch({ type: "botCreationPending", on: false });
            });
          break;
        }
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          const duplicateProfile = {
            name: `${source.name} copy`,
            title: source.title,
            description: source.description,
            soul: source.soul,
            notifications: source.notifications,
            modelSelection: source.modelSelection,
            computer: source.computer,
            cloudBackend: source.cloudBackend,
            autoStartVps: source.autoStartVps,
            avatarUrl: source.avatarUrl,
            avatarCrop: source.avatarCrop,
            avatarZoom: source.avatarZoom,
            avatarFocusX: source.avatarFocusX,
            avatarFocusY: source.avatarFocusY,
            // a private bot's copy stays private; anything else is the default
            ...(source.teamMemorySharing !== undefined && source.teamMemorySharing !== "shared" ? { teamMemorySharing: "private" as const } : {}),
          };
          // A copy of a restricted bot is restricted from its first moment.
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify({
              ...(source.visibility && source.visibility !== "everyone" ? { visibility: source.visibility } : {}),
              ...(Object.hasOwn(source, "toolScope") ? { settings: { toolScope: source.toolScope } } : {}),
            }),
          })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                // JSON.stringify omits undefined optional fields while preserving
                // an explicit null avatar clear, so duplication mirrors the source.
                body: JSON.stringify(duplicateProfile),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          rawDispatch({ type: "botDeletionPending", botId: action.botId, on: true });
          void requestConfirmedBotDeletion(
            action.botId,
            async (botId) => {
              // Preserve edits when lifecycle guards refuse deletion, while
              // preventing an older debounced PATCH from landing after a
              // successful DELETE.
              await botPatchQueue.flush(botId);
              return api(`/api/bots/${botId}`, { method: "DELETE" });
            },
            (botId) => {
              botPatchQueue.cancel(botId);
              rawDispatch({ type: "deleteBot", botId });
            },
          )
            .catch(showError)
            .finally(() => rawDispatch({ type: "botDeletionPending", botId: action.botId, on: false }));
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const id = action.id;
          const bot = stateRef.current.bots.find((b) => b.id === id);
          const group = stateRef.current.groups.find((g) => g.id === id);
          if (bot?.unread) {
            api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) }).catch(() => {});
            // threads hidden: the one conversation's other unread threads too
            for (const threadId of threadsReadOnScreen(bot, bot.threadId).slice(1)) {
              api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          } else if (group?.peopleDm) {
            // per thread: the one open, or the whole conversation when only
            // the conversation itself was marked unread
            const read = peopleDmReadTarget(group);
            if (read) api(`/api/groups/${id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
          } else if (group?.unread) {
            api(`/api/groups/${id}/read`, { method: "POST" }).catch(() => {});
          }
          break;
        }
        case "createGroup":
          api(`/api/groups`, {
            method: "POST",
            body: JSON.stringify({
              memberIds: action.memberIds,
              ...(action.humanIds?.length ? { humanIds: action.humanIds } : {}),
              name: action.name,
              section: action.section,
              ...(window.ogb?.remoteClient?.active
                ? { setup: { bulletin: "", defaultResponder: { kind: "mentions" } } }
                : {}),
            }),
          })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "openPeopleDm":
          api(`/api/people-dms`, { method: "POST", body: JSON.stringify({ principalId: action.principalId }) })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "nudgePerson":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ principalId: action.principalId, ...(action.threadId ? { threadId: action.threadId } : {}) }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "nudgeGroup":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ groupId: action.groupId }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "sendGroup": {
          const threadId =
            action.threadId ?? stateRef.current.groups.find((group) => group.id === action.groupId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/groups/${action.groupId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                text: action.text,
                replyToId: action.replyToId,
                threadId,
                sendId,
                mode: action.mode ?? "chat",
              }),
            }))
            .then((body) => {
              action.onSent?.();
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            });
          break;
        }
        case "patchGroup":
          api(`/api/groups/${action.groupId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "deleteGroup":
          api(`/api/groups/${action.groupId}`, { method: "DELETE" }).catch(showError);
          break;
        case "leaveGroup":
          // the group leaves this client once the server took them out; their
          // other devices get "group.left"
          api(`/api/groups/${action.groupId}/leave`, { method: "POST" })
            .then(() => rawDispatch({ type: "groupDeleted", groupId: action.groupId }))
            .catch(showError);
          break;
        case "setModel":
          if (action.threadId) {
            persistTaskPatch(action.botId, action.threadId, {
              modelSelection: action.selection,
              ...(action.updateBotDefault ? { updateBotDefault: true } : {}),
            });
            break;
          }
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(
              action.botId,
              { modelSelection: action.selection, threadId: botBeforeUpdate.switchingTo ?? botBeforeUpdate.threadId },
              botBeforeUpdate,
            );
          }
          break;
        case "updateTask":
          persistTaskPatch(action.botId, action.threadId, action.patch);
          break;
        case "makeTaskConfidential":
          void api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(makeConfidentialBody()),
          }).then((result) => {
            if (result?.bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(result.bot) });
            rawDispatch({ type: "taskMadeConfidential", botId: action.botId, threadId: action.threadId });
            action.onDone?.();
          }).catch((error: unknown) => {
            if (action.onError) action.onError(readableError(error));
            else showError(error);
          });
          break;
        case "refreshTaskPermissions": {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          const task = bot?.tasks?.find((candidate) => candidate.threadId === action.threadId);
          if (!bot || !task) {
            showError(new Error("That thread is no longer available"));
            break;
          }
          // the bot's own setting, never the open conversation's level
          const mode = botApprovalSetting(bot);
          const current = approvalModeFor(currentTaskBot(bot, action.threadId));
          const acknowledgeLocalAuto = action.acknowledgeLocalAuto === true;
          // Full, Custom, and leaving Custom stay on the private desktop
          // channel. Ask, Edits, and Auto can use the thread settings route.
          const needsDesktop = mode === "full" || mode === "custom" || current === "custom";
          // #1674: without the private channel (the desktop app on a remote
          // server, a browser), Full comes back through the thread route:
          // an organization server grants it to the bot's owner, any other
          // says why. Custom stays on the desktop channel.
          const bridge = window.ogb?.approvals;
          const refreshed = needsDesktop && (bridge || mode === "custom" || current === "custom")
            ? bridge
              ? stepUpApprovals(bridge)!.setMode(action.botId, mode, {
                threadId: action.threadId, threadOnly: true, refreshPermissions: true, acknowledgeLocalAuto,
              })
              : Promise.reject(new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server"))
            : api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
              method: "PATCH",
              body: JSON.stringify({ refreshPermissions: true, ...(acknowledgeLocalAuto ? { acknowledgeLocalAuto: true } : {}) }),
            }).then((result) => result.bot);
          void refreshed.then((updated) => {
            if (updated) rawDispatch({ type: "botPatched", bot: withTaskWrites(updated) });
          }).catch(showError);
          break;
        }
        case "followBotModel":
          void api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/threads/follow-model`, { method: "POST", body: "{}" })
            .then(({ bot }) => rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) }))
            .catch(showError);
          break;
        case "createProject":
          api(`${folderOwnerPath(action)}/projects`, { method: "POST", body: JSON.stringify({ name: action.name, emoji: action.emoji }) })
            .then((answer) => {
              applyFolderOwner(dispatch, action, answer);
              action.onCreated?.(answer.project);
            }).catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "updateProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "PATCH", body: JSON.stringify(action.patch) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "deleteProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "DELETE" })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onDeleted?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "reorderProjects":
          api(`${folderOwnerPath(action)}/projects/order`, { method: "PATCH", body: JSON.stringify({ projectIds: action.projectIds }) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "interrupt": {
          const interruptBody = {
            ...(action.threadId ? { threadId: action.threadId } : {}),
            ...(action.expectedUtteranceId ? { expectedUtteranceId: action.expectedUtteranceId } : {}),
          };
          api(`/api/bots/${action.botId}/interrupt`, {
            method: "POST",
            body: Object.keys(interruptBody).length ? JSON.stringify(interruptBody) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        }
        // tasks: the server answers with the bot AND the live transcript,
        // because switching changes which conversation is on screen
        case "newTask":
        case "switchTask": {
          // Opening a task from a notification or the sidebar reads THAT
          // thread, once the switch is under way: the server announces it
          // (the "bot" frame reads Bot.switchingTo) and taskSwitched marks it
          // here. Never before: a switch that fails (a thread deleted
          // meanwhile) leaves the thread it was on, and its unread, as they were.
          const revision = (navigation.get(action.botId) ?? 0) + 1;
          navigation.set(action.botId, revision);
          const selectedAtStart = selectionRevision;
          const ready = action.type === "newTask"
            ? botPatchQueue.flush(action.botId)
            : Promise.resolve();
          // A new task's thread is empty, so only the switch needs a page.
          void ready.then(() => api<{ bot: Bot }>(action.type === "newTask"
            ? `/api/bots/${action.botId}/tasks`
            : `/api/bots/${action.botId}/tasks/${action.threadId}${action.whole ? "" : `?messages=${MESSAGE_PAGE_SIZE}`}`, { method: "POST", body: JSON.stringify(action.type === "newTask" ? { projectId: action.projectId, cwd: action.cwd, ...(action.confidential !== undefined ? { confidential: action.confidential } : {}), ...(action.stream ?? singleStreamTurnField().singleStream ? { stream: true } : {}) } : {}) }))
            .then((r) => {
              if (action.type === "newTask") action.onCreated?.();
              if (!r?.bot || navigation.get(action.botId) !== revision) return;
              const selectsAfterCreation = action.type === "newTask" && action.cwd !== undefined;
              if (selectsAfterCreation && selectionRevision !== selectedAtStart) return;
              if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
              dispatch({ type: "taskSwitched", bot: r.bot });
              if (selectsAfterCreation) rawDispatch({ type: "select", id: action.botId });
            })
            .catch((error) => {
              // The latest switch, failed, leaves the thread it was on on screen.
              if (action.type === "switchTask" && navigation.get(action.botId) === revision) {
                rawDispatch({ type: "switchTaskFailed", botId: action.botId, threadId: action.threadId });
              }
              if (action.type === "newTask" && action.onError) action.onError(readableError(error));
              else showError(error);
            });
          break;
        }
        case "renameTask":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "regenerateTaskTitle":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}/title`, { method: "POST" })
            .then(() => action.onSettled?.(true))
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        case "deleteTask":
          threadPages.delete(action.threadId);
          api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.bot && dispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        // Channel tasks mirror bot tasks, but hydrate the whole channel so
        // switching atomically replaces its transcript, folder and pin.
        case "newGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks`, { method: "POST", body: JSON.stringify(action.projectId ? { projectId: action.projectId } : {}) })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "switchGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}?messages=${MESSAGE_PAGE_SIZE}`, { method: "POST" })
            .then((r) => {
              if (!r?.group) return;
              dispatch({ type: "groupPatched", group: r.group });
              // A person conversation: opening an unread thread reads it,
              // for this person only (server/people-dms.ts).
              const read = peopleDmReadTarget(r.group);
              if (read) api(`/api/groups/${action.groupId}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            })
            .catch(showError);
          break;
        case "updateGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "renameGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "pinGroupTask":
          // title is echoed so an older server rewrites the same title
          // instead of blanking a pin-only body into "Untitled".
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: action.pinned, title: action.title }),
          }).catch(showError);
          break;
        case "setConversationTurnLimit":
          api(action.dm ? `/api/groups/${action.groupId}` : `/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ turnTimeoutMinutes: action.minutes }),
          }).catch(showError);
          break;
        case "deleteGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "interruptGroup":
          api(`/api/groups/${action.groupId}/interrupt`, {
            method: "POST",
            body: action.threadId ? JSON.stringify({ threadId: action.threadId }) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        case "updateBot": {
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(action.botId, action.patch, botBeforeUpdate);
          }
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, [botPatchQueue]);

  // The app opens the bot it remembers as that bot's row would (openBot):
  // with threads hidden at its main thread, not at a thread an activity row
  // or a notification left it on, where the person's next words would make
  // that thread theirs and leave their own conversation behind. Once, at the
  // first snapshot. With threads shown the bot stays where it was.
  const launched = useRef(false);
  useEffect(() => {
    if (!state.hydrated) return;
    const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
    const first = !launched.current;
    launched.current = true;
    if (!bot || state.activeView !== "chat") return;
    // With one conversation the thread on screen is always the conversation
    // (shared/single-stream.ts): at launch, after a reconnect that adopted
    // the server's selection, and when another device or a routine started
    // a newer topic, the window follows it (the reference design: one
    // transcript per bot, on every device). Never while a switch is under
    // way. With threads shown the bot stays where it was, once checked.
    if ((first || !showThreads) && !bot.switchingTo && botOpensTo(bot, showThreads) !== bot.threadId) openBot(dispatch, bot, showThreads, first ? {} : { landing: false });
    // Launching the app is a return too: after the threshold (since the
    // conversation went quiet, or since the app closed) a fresh topic.
    else if (first && !showThreads) landOnBot(dispatch, bot, bot.threadId, { force: true });
  }, [state.hydrated, state.bots, state.selectedId, state.activeView, showThreads, dispatch]);

  // Fresh topic on return (src/lib/fresh-topic.ts): which bot is on screen,
  // when the person left it (another bot or view, the window hidden, the app
  // closing) and, when the window comes back after the threshold, a fresh
  // topic over the conversation at rest.
  const onScreenId = state.hydrated && state.activeView === "chat" && state.bots.some((bot) => bot.id === state.selectedId) ? state.selectedId : null;
  useEffect(() => {
    if (!onScreenId) return;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    if (visible()) {
      setOnScreenBot(onScreenId);
      noteBackAtBot(onScreenId);
    }
    // Hidden or minimized, or another app in front (blur): away. Focus moving
    // into a frame of this page (the built-in browser) is not leaving.
    const onVisibility = (event?: Event) => {
      if (event?.type === "blur" && document.hasFocus()) return;
      if (event?.type === "blur" && document.activeElement instanceof HTMLIFrameElement) return;
      if (!visible() || event?.type === "blur") {
        setOnScreenBot(null);
        noteLeftBot(onScreenId, Date.now());
        return;
      }
      const bot = stateRef.current.bots.find((candidate) => candidate.id === onScreenId);
      if (bot && !showThreads && stateRef.current.freshTopic[onScreenId]?.threadId !== bot.threadId) {
        landOnBot(dispatch, bot, bot.threadId, { force: true });
      }
      setOnScreenBot(onScreenId);
      noteBackAtBot(onScreenId);
    };
    const onPageHide = () => noteLeftBot(onScreenId, Date.now());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // Another bot, another view: this one is left now, and a fresh topic
      // coming back put there goes (the next return asks the rule again).
      if (visible()) noteLeftBot(onScreenId, Date.now());
      setOnScreenBot(null);
      if (stateRef.current.freshTopic[onScreenId]?.auto) dispatch({ type: "freshTopic", botId: onScreenId, threadId: null });
    };
  }, [onScreenId, showThreads, dispatch]);

  // ── initial load + SSE fold ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    type PeripheralKey = "instances" | "config" | "routines" | "serverFeatures" | "webhooks";
    type PeripheralPart = {
      key: PeripheralKey;
      request: () => Promise<() => void>;
    };
    type PeripheralRefresh = {
      attempt: number;
      generation: number;
      timer: ReturnType<typeof setTimeout> | null;
      version: number;
    };
    const peripheralRefresh = new Map<PeripheralKey, PeripheralRefresh>();
    const refreshState = (key: PeripheralKey) => {
      let current = peripheralRefresh.get(key);
      if (!current) {
        current = { attempt: 0, generation: 0, timer: null, version: 0 };
        peripheralRefresh.set(key, current);
      }
      return current;
    };
    const peripheralParts: PeripheralPart[] = [
      {
        key: "instances",
        request: async () => {
          const { instances } = await api("/api/instances");
          return () => rawDispatch({ type: "instances", instances });
        },
      },
      {
        key: "config",
        request: async () => {
          const config = await api("/api/config");
          return () => rawDispatch({ type: "configStatus", config });
        },
      },
      {
        key: "routines",
        request: async () => {
          const listing = await api("/api/routines");
          const { routines, runs, folders } = listing;
          // A server from before routine folders sends no `folders`.
          noteRoutinesListing(listing);
          return () => rawDispatch({ type: "routinesHydrated", routines, runs, ...(folders && typeof folders === "object" ? { folders } : {}) });
        },
      },
      {
        // What this server serves (its descriptor's feature list), so a
        // newer app hides what an older server lacks (2026-10-28).
        key: "serverFeatures",
        request: async () => {
          await loadServerFeatures();
          return () => {};
        },
      },
      ...(window.ogb?.remoteClient?.active ? [] : [{
        key: "webhooks",
        request: async () => {
          const { webhooks, attempts, ingress, graphConnectors } = await api("/api/webhooks");
          return () =>
            rawDispatch({ type: "webhooksHydrated", webhooks, attempts: attempts ?? [], ingress, graphConnectors: graphConnectors ?? [] });
        },
      } satisfies PeripheralPart]),
    ];
    const partByKey = new Map(peripheralParts.map((part) => [part.key, part]));
    const schedulePeripheralRetry = (part: PeripheralPart, error?: Error) => {
      if (!alive) return;
      const refresh = refreshState(part.key);
      if (refresh.timer) return;
      if (error !== undefined) {
        if (part.key === "routines") rawDispatch({ type: "routinesLoadFailed" });
        console.warn(`snapshot: ${part.key} refresh failed; retrying`, error);
      }
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(refresh.attempt, 5));
      refresh.attempt += 1;
      refresh.timer = setTimeout(() => {
        refresh.timer = null;
        void loadPeripheral(part, true).catch((nextError) => schedulePeripheralRetry(part, nextError));
      }, delay);
    };
    const loadPeripheral = async (part: PeripheralPart, protectLiveFrames: boolean): Promise<void> => {
      const refresh = refreshState(part.key);
      if (refresh.timer) {
        clearTimeout(refresh.timer);
        refresh.timer = null;
      }
      const generation = ++refresh.generation;
      const version = refresh.version;
      try {
        const apply = await part.request();
        if (!alive || refresh.generation !== generation) return;
        // A background retry must never replace a live patch that arrived
        // after its request began. Discard that stale response and try again
        // from the newer event boundary instead.
        if (protectLiveFrames && refresh.version !== version) {
          schedulePeripheralRetry(part);
          return;
        }
        apply();
        refresh.attempt = 0;
      } catch (error) {
        // A newer refresh owns this lane now; its result will decide whether
        // another retry is needed.
        if (!alive || refresh.generation !== generation) return;
        throw normalizeSnapshotFailure(error);
      }
    };
    const bumpPeripheralVersion = (...keys: PeripheralKey[]) => {
      for (const key of keys) refreshState(key).version += 1;
    };
    const loadAll = async (): Promise<boolean> => {
      // The Live call snapshot is its own fire-and-forget request: a server
      // without the route answers 404, and the catch keeps that silent — a
      // running call still arrives moments later over the SSE `live.call`
      // frame, so this is only for the case where one was already live
      // before this window connected.
      // Applied only if no live.call frame lands while it is out (a frame
      // is newer news than this answer), and only if the answer to a later
      // lookup did not come back first. Rendered at once, like a frame.
      const since = stateRef.current.liveCallVersion;
      const seq = nextLiveCallLookup();
      void api<unknown>("/api/live/call")
        .then((body) => {
          const answer = liveCallFromFrame(body);
          if (alive && answer) flushSync(() => rawDispatch({ type: "liveCallLookup", call: answer.call, since, seq }));
        })
        .catch(() => {});
      const chat = () =>
        api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`).then(({ bots, groups, sections, computerControl, botQueuedMessages }) => {
          if (!alive) return;
          rawDispatch({
            type: "hydrate",
            bots,
            groups: groups ?? [],
            sections: sections ?? [],
            computerControl: computerControl ?? {},
            botQueuedMessages,
            resumeId: readLastConversation() ?? undefined,
          });
        });
      const peripherals = peripheralParts.map((part) => ({
        key: part.key,
        load: () => loadPeripheral(part, false),
      }));
      const chatReady = await loadSnapshotBoundary(chat, peripherals, (failed, error) => {
        const part = partByKey.get(failed.key);
        if (part) schedulePeripheralRetry(part, error);
      });
      return alive && chatReady;
    };

    // A snapshot and the live fold have to meet at a defined boundary. Start
    // hydration only after the stream says hello, queue frames that arrive
    // while the REST snapshot is in flight, then apply them on top. Otherwise
    // a late hydrate can overwrite a newer event, or an event can land between
    // an eager request and the stream opening and disappear entirely.
    let hydrated = false;
    let hydrationPromise: Promise<boolean> | null = null;
    let rehydrateRequested = false;
    const pendingFrames: ServerFrame[] = [];
    let handleFrame: (frame: ServerFrame) => void;
    const hydrate = (): Promise<boolean> => {
      if (hydrationPromise) {
        // A second non-resumable hello means this snapshot may have started
        // before another connection gap. Run one more after it settles.
        rehydrateRequested = true;
        return hydrationPromise;
      }
      hydrated = false;
      // Clear before the REST round-trip: the snapshot replaces transcripts
      // but never the out-of-reducer live map, and pending rAF deltas must
      // not resurrect the truncated answer after we emptied it (#1749).
      resetStreams();
      hydrationPromise = (async () => {
        let loaded = false;
        do {
          rehydrateRequested = false;
          loaded = await loadAll();
        } while (alive && rehydrateRequested);
        if (!alive || !loaded) return false;
        hydrated = true;
        for (const frame of pendingFrames.splice(0)) handleFrame(frame);
        return true;
      })().finally(() => {
        hydrationPromise = null;
      });
      return hydrationPromise;
    };
    // If SSE is unavailable, the app should still show its saved state. A
    // later first hello hydrates again because it cannot prove there was no
    // gap before that connection opened.
    const hydrationFallback = setTimeout(hydrate, 1_000);

    // The hydrate decision belongs to the hello frame, not to onopen: the
    // server replays what we missed when it can, and re-downloading every
    // transcript on a reconnect it already covered is pure waste.
    handleFrame = (frame) => {
      if (frame.kind === "config") bumpPeripheralVersion("config", "instances");
      else if (frame.kind === "routine" || frame.kind === "routine.deleted" || frame.kind === "routine.run" || frame.kind === "routine.folders") {
        bumpPeripheralVersion("routines");
      } else if (
        frame.kind === "webhook" ||
        frame.kind === "webhook.attempt" ||
        frame.kind === "webhook.deleted"
      ) {
        bumpPeripheralVersion("webhooks");
      }
      switch (frame.kind) {
        case "sections":
          rawDispatch({ type: "sections", sections: frame.sections });
          break;
        case "bot.queued":
          rawDispatch({ type: "botQueues", queues: frame.queues });
          break;
        case "message": {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message as Message });
          if (frame.message?.role === "user" && typeof frame.message.queueId === "string") {
            rawDispatch({
              type: "consumePendingQueued",
              threadId: frame.threadId,
              queueId: frame.message.queueId,
            });
          }
          // a settled assistant bubble replaces the in-flight stream
          if (frame.message?.role === "bot" && frame.message?.kind === "text") {
            clearStream(frame.threadId);
            // Auto-speak lives HERE rather than in the chat view so a bot
            // you switched away from still reads its answer out — which is
            // the whole point of listening while you do something else. A
            // Auto-speak is disabled during any call. Call mode owns both the
            // singleton speaker and microphone ordering for its whole lifetime.
            const owner = stateRef.current.bots.find((b) => b.threadId === frame.threadId || b.tasks?.some((task) => task.threadId === frame.threadId));
            const live = stateRef.current.liveCall;
            const onLiveCall = Boolean(live && live.status !== "ended" && live.botId === owner?.id);
            if (owner?.speakReplies && currentCall() === null && !onLiveCall && frame.message.text?.trim()) {
              void speaker.speak(frame.message.text, {
                botId: owner.id,
                messageId: frame.message.id,
                voiceId: owner.voice,
              });
            }
          }
          break;
        }
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message as Message });
          break;
        case "thread":
          rawDispatch({ type: "threadActive", threadId: frame.threadId, activeLeafId: frame.activeLeafId });
          // a rewind also invalidates any half-streamed text from the old branch
          clearStream(frame.threadId);
          break;
        case "bot": {
          const bot = frame.bot as BotAnnouncement;
          // reading the selected chat clears its badge immediately: the
          // thread on screen, the one a switch is opening while it is under
          // way (this frame may be its own announcement), never one it leaves
          const selected = stateRef.current.bots.find((candidate) => candidate.id === bot.id);
          const shown = selected?.switchingTo ?? selected?.threadId;
          const selectedTask = bot.tasks?.find((task) => task.threadId === shown);
          // Under a fresh topic the thread is not on screen: its answer stays
          // unread, so the topic gives way and shows it (ChatView).
          const covered = stateRef.current.freshTopic[bot.id]?.threadId === shown;
          const readWith = shown && !covered ? threadsReadOnScreen(bot as Pick<Bot, "tasks">, shown).slice(1) : [];
          if (!covered && bot.id === stateRef.current.selectedId && stateRef.current.activeView === "chat" &&
              (selectedTask?.unread || (!bot.tasks && bot.unread) || readWith.length > 0)) {
            const wasUnread = Boolean(selectedTask?.unread || (!bot.tasks && bot.unread));
            if (selectedTask) selectedTask.unread = false;
            // Threads hidden: a reply landing in another thread of the one
            // conversation on screen is read with it (threadsReadOnScreen).
            for (const task of bot.tasks ?? []) if (readWith.includes(task.threadId)) task.unread = false;
            // Hidden routine runs must not put the dot back on the next frame.
            // No task list: the bot flag is the unread signal.
            bot.unread = botShowsUnread(bot);
            for (const threadId of [...(wasUnread ? [shown] : []), ...readWith]) {
              fetch(`/api/bots/${bot.id}/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          }
          rawDispatch({
            type: "botPatched",
            bot: withTaskWrites({ ...bot, ...botPatchQueue.overlayFor(bot.id) }),
          });
          break;
        }
        case "group": {
          const group = frame.group as Partial<Group> & { id: string };
          const held = stateRef.current.groups.find((candidate) => candidate.id === group.id);
          if (group.peopleDm || held?.peopleDm) {
            // A person conversation: the frame names its default thread;
            // this client keeps the one it has open (groupPatched), and
            // reads that thread only, so a sibling's dot stays.
            const open = held && personThreadKept(held, group) ? held.threadId : group.threadId;
            if (group.id === stateRef.current.selectedId && open) {
              const read = peopleDmReadTarget({ ...group, threadId: open, tasks: group.tasks ?? held?.tasks });
              if (read) api(`/api/groups/${group.id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            }
            rawDispatch({ type: "groupPatched", group });
            // the thread on screen was deleted (by the other person): open
            // the default one with its messages
            if (held && group.tasks && !group.tasks.some((task) => task.threadId === held.threadId) && typeof group.threadId === "string") {
              dispatch({ type: "switchGroupTask", groupId: group.id, threadId: group.threadId });
            }
            break;
          }
          // reading the selected room clears its badge immediately
          if (group.unread && group.id === stateRef.current.selectedId) {
            group.unread = false;
            fetch(`/api/groups/${group.id}/read`, { method: "POST" }).catch(() => {});
          }
          rawDispatch({ type: "groupPatched", group });
          break;
        }
        // the harness decided this was worth interrupting for; the toggle
        // in each bot's settings is what gates it, server-side
        case "notify":
          // the wrapped dispatch, not rawDispatch: `select` clears the badge
          // in local state either way, but only the wrapper PATCHes
          // unread:false back. Opening a bot from its own notification and
          // watching the badge return on the next hydration is exactly the
          // bug that makes notifications feel broken. Opened as the sidebar
          // shows threads when it is clicked.
          // A direct message from someone this person blocked stays quiet
          // (src/lib/moderation.ts): their line is folded away anyway.
          if (frame.notification.kind === "message" && blockedDmSender(frame.notification.threadId, stateRef.current)) break;
          if (frame.notification.kind === "report") notifyReportsChanged();
          showNotification(
            frame.notification,
            (target) => frame.notification.kind === "report"
              // a report opens the admins' list (Settings > Notifications)
              ? dispatch({ type: "toggleAppSettings", open: true, section: "notifications" })
              : openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current),
            stateRef.current.bots.find((bot) => bot.id === frame.notification.botId)?.avatarUrl,
            visibleNotificationThread(stateRef.current),
          );
          break;
        case "notify-withdraw":
          withdrawNotification(approvalWithdrawKey(frame.threadId, frame.requestId));
          break;
        case "group.deleted":
          rawDispatch({ type: "groupDeleted", groupId: frame.groupId });
          break;
        case "group.left":
          rawDispatch({ type: "groupDeleted", groupId: frame.roomId });
          break;
        case "routine":
          rawDispatch({ type: "routinePatched", routine: frame.routine });
          break;
        case "routine.deleted":
          rawDispatch({ type: "routineDeleted", routineId: frame.routineId });
          break;
        case "routine.folders":
          rawDispatch({ type: "routineFoldersPatched", botId: frame.botId, folders: frame.folders });
          break;
        // a person's own unlocks (server/achievements.ts sends them to their streams only)
        case "achievements":
          receiveAchievementsFrame(frame);
          break;
        // a person's preferences saved on another device (or this one): the
        // sync module applies them to this page (src/lib/user-preferences-sync.ts)
        case "preferences":
          announceServerPreferences(frame);
          break;
        case "routine.run":
          rawDispatch({ type: "routineRunPatched", run: frame.run });
          break;
        case "webhook":
          rawDispatch({ type: "webhookPatched", webhook: frame.webhook });
          break;
        case "webhook.attempt":
          rawDispatch({ type: "webhookAttempted", attempt: frame.attempt });
          break;
        case "webhook.deleted":
          rawDispatch({ type: "webhookDeleted", webhookId: frame.webhookId });
          break;
        case "runtime": {
          const event = frame.event;
          const action = runtimeFrameAction(event);
          if (action) rawDispatch(action);
          if (event.type === "content.delta") {
            deltaBuffer.push(event.threadId, event.streamKind, event.delta);
          } else if (event.type === "turn.started") {
            // A new turn always starts empty. After a gap that missed
            // turn.completed, stale live text would otherwise prepend onto
            // this answer (#1749).
            clearStream(event.threadId);
          } else if (event.type === "turn.completed") {
            // flush any buffered tail before clearing so no tokens are lost
            flushDeltas();
            clearStream(event.threadId);
          }
          break;
        }
        case "screen":
          // The picture went to the Computer panel (publishLiveFrame). For
          // the store, a first frame only means the computer is set up.
          if (stateRef.current.computerStarts[frame.botId]) {
            rawDispatch({ type: "computerStart", botId: frame.botId, start: null });
          }
          break;
        case "computer":
          rawDispatch({ type: "computerStart", botId: frame.botId,
            start: { state: frame.state, ...(frame.place ? { place: frame.place } : {}) } });
          break;
        case "computer-control":
          rawDispatch({
            type: "computerControl",
            botId: frame.botId,
            held: frame.held === true,
            helpReason: typeof frame.helpReason === "string" ? frame.helpReason : null,
          });
          break;
        case "data":
          rawDispatch({ type: "dataSheet", sheet: frame.sheet, ...(typeof frame.threadId === "string" && frame.threadId ? { threadId: frame.threadId } : {}) });
          break;
        case "bot.deleted":
          botPatchQueue.cancel(frame.botId);
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        case "cloud.agent":
          window.dispatchEvent(new CustomEvent("sagax-cloud-agent", { detail: { botId: frame.botId, item: frame.item } }));
          break;
        case "artifacts":
          // Ids only (server/artifacts.ts): the Files tab and the palette fetch again.
          window.dispatchEvent(new CustomEvent(ARTIFACTS_EVENT, { detail: { botId: frame.botId, artifactId: frame.artifactId, deleted: frame.deleted === true } }));
          break;
        case "bot.tasks":
          // Ids only (server/bot-task-list.ts): the bot's Tasks section reads its list again.
          window.dispatchEvent(new CustomEvent(BOT_TASKS_EVENT, { detail: { botId: frame.botId } }));
          break;
        case "live.call": {
          const framed = liveCallFromFrame(frame);
          // Rendered at once: a bot message frame right behind this one
          // decides auto-speak from stateRef, which must know the call by then.
          if (framed) flushSync(() => rawDispatch({ type: "liveCall", call: framed.call }));
          break;
        }
        // #1545: a bot reads or changes a setting kept on this device
        case "device-settings":
          receiveDeviceSettingsFrame(() => {
            const now = stateRef.current;
            const viewer = viewerActorId(now.config);
            return { bots: now.bots, primary: now.bots.find((bot) => isViewersPrimaryBot(bot, viewer)) ?? null };
          });
          break;
        case "bot-act": {
          const command = uiCommandToAction(frame.action, frame.input);
          // a preference on this device (sagax_settings): written where its
          // module reads it, then announced like another tab's change
          if (command && command.action.type === "setPreference") {
            applyBotPreference(String(command.action.key), String(command.action.value));
            break;
          }
          // a bot's "open that thread" passes the one-conversation gate like
          // every other way in (openBotThread)
          const commanded = command?.action as Action | undefined;
          if (commanded && commanded.type === "switchTask") {
            const target = stateRef.current.bots.find((candidate) => candidate.id === commanded.botId);
            if (target) openBotThread(dispatch, target, commanded.threadId, !singleStreamTurnField().singleStream);
            break;
          }
          if (command) dispatch(command.action as Action);
          break;
        }
        // addressed to this person only (server/nudge.ts): front, shake, ring, notify
        case "nudge":
          void onNudgeReceived(frame, (target) => openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current));
          break;
        case "voice.opener":
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("sagax-voice-opener", { detail: frame }));
          }
          break;
        case "voice.call.ended":
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(VOICE_CALL_ENDED_EVENT, { detail: frame }));
          }
          break;
        // a nudge this person sent, on each of their windows: front, shake, ring
        case "nudge.sent":
          void onNudgeSentEcho(frame);
          break;
        case "presence.changed":
          applyPresenceFrame(frame);
          break;
        // organization admins only: the approvals waiting for an admin
        case "org.approvals":
          receiveOrgApprovalsFrame(frame, () => dispatch({ type: "toggleAppSettings", open: true, section: "organization" }));
          break;
        case "person.label":
          applyPersonLabel(frame.principalId, frame.label);
          break;
        // a person changed their own photo (src/lib/person-avatars.ts)
        case "person.avatar": {
          const change = { principalId: frame.principalId, avatarUrl: frame.avatarUrl };
          const config = stateRef.current.config;
          const next = config ? withViewerAvatar(config, change) : config;
          if (next && next !== config) rawDispatch({ type: "configStatus", config: next });
          announcePersonAvatar(change);
          break;
        }
        // a read position moved (src/lib/read-receipts-feed.ts)
        case "thread.read":
          receiveThreadReadFrame(frame);
          break;
        // a key changed and the fleet hot-reloaded — refresh the picker so
        // newly available providers un-dim immediately
        case "config":
          rawDispatch({
            type: "configStatus",
            config: configStatusFromFrame(frame as unknown as ConfigStatusFrame),
          });
          {
            const instances = partByKey.get("instances");
            if (instances) {
              void loadPeripheral(instances, true).catch((error) =>
                schedulePeripheralRetry(instances, error),
              );
            }
          }
          break;
      }
    };
    const stopLive = openLiveEvents({
      onOpen: () => rawDispatch({ type: "connected", value: true }),
      onError: () => rawDispatch({ type: "connected", value: false }),
      onSnapshotRequired: () => {
        clearTimeout(hydrationFallback);
        publishMissedFrames();
        // Frames buffered before this non-resumable stream belong to an
        // abandoned generation. Keep the new generation behind hydrate().
        pendingFrames.splice(0);
        return hydrate();
      },
      onFrame: (frame) => {
        // Open panels read what the store does not keep (live screens, raw
        // runtime events) from this same stream.
        publishLiveFrame(frame as ServerFrame);
        if (hydrated) handleFrame(frame as ServerFrame);
        else pendingFrames.push(frame as ServerFrame);
      },
    });
    return () => {
      alive = false;
      deltaBuffer.dispose();
      clearTimeout(hydrationFallback);
      for (const refresh of peripheralRefresh.values()) {
        if (refresh.timer) clearTimeout(refresh.timer);
      }
      stopLive();
    };
  }, []);

  // Re-probe the engines on demand. A CLI installed while the app is running
  // is invisible until something asks again — the setup screens expose this
  // as "Check again" so the user isn't told to restart when a refresh will do.
  const instanceProbe = useRef<Promise<void> | null>(null);
  const refreshInstances = useCallback(async (options?: { reportErrors?: boolean }) => {
    // Focus and an explicit Check again can arrive together. Share the probe,
    // but let the explicit caller display failure without breaking background callers.
    const probe = instanceProbe.current ??= api("/api/instances", { timeoutMs: 120_000 }).then(({ instances }) => {
      // Keep the last usable list if a proxy returns an empty/non-JSON 200.
      if (!Array.isArray(instances)) throw new Error(t("engineSetup.invalidStatus"));
      rawDispatch({ type: "instances", instances });
    });
    try {
      await probe;
    } catch (error) {
      if (options?.reportErrors) throw error;
      // Offline: retain the existing list for background callers.
    } finally {
      if (instanceProbe.current === probe) instanceProbe.current = null;
    }
  }, []);

  const refreshModels = useCallback(async (instanceId: string) => {
    const { instances } = await api(`/api/instances/${encodeURIComponent(instanceId)}/refresh-models`, {
      method: "POST",
    });
    rawDispatch({ type: "instances", instances });
  }, []);

  // Installing a CLI or signing one in happens in a terminal, outside this
  // window — so the moment the user comes back is exactly when our engine
  // snapshot is most likely stale. Re-probe on focus, throttled so that
  // ordinary alt-tabbing doesn't spawn a `--version` call per switch.
  const lastFocusProbe = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusProbe.current < 3000) return;
      lastFocusProbe.current = now;
      void refreshInstances();
    };
    window.addEventListener("focus", onFocus);
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshInstances]);

  const flushBotPatches = useCallback(
    (botId: string) => botPatchQueue.flush(botId),
    [botPatchQueue],
  );
  const value = useMemo(
    () => ({ state, dispatch, flushBotPatches, refreshInstances, refreshModels }),
    [state, dispatch, flushBotPatches, refreshInstances, refreshModels],
  );
  // The isolated UI preview (scripts/testing/preview-fixture.ts) sets this
  // flag so a harness can open the catalogue. The packaged app never does.
  useEffect(() => {
    const host = window as Window & { __sagaxUiHarness?: boolean; __sagaxDispatch?: typeof dispatch };
    if (!host.__sagaxUiHarness) return;
    host.__sagaxDispatch = dispatch;
    return () => {
      if (host.__sagaxDispatch === dispatch) delete host.__sagaxDispatch;
    };
  }, [dispatch]);
  // Selector reads (store-selector.ts): the same state, for components that
  // render only when the slice they read changes.
  const source = usePublishedStoreSource(state, dispatch);
  return (
    <StoreSourceContext.Provider value={source}>
      <StoreContext.Provider value={value}>
        <ThreadPrefetchContext.Provider value={threadPrefetch}>
          <StreamContext.Provider value={stream}>{children}</StreamContext.Provider>
        </ThreadPrefetchContext.Provider>
      </StoreContext.Provider>
    </StoreSourceContext.Provider>
  );
}

/** The store when there is one; null outside a provider (static renders, tests). */
export function useStoreOptional() {
  return useContext(StoreContext);
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

/** Scoped state for an unsaved editor. The parent workspace remains intact. */
export function BotEditorStore({ value, children }: { value: ReturnType<typeof useStore>; children: ReactNode }) {
  // Selector reads inside the editor see its scoped state, not the workspace's.
  const source = usePublishedStoreSource(value.state, value.dispatch);
  return (
    <StoreSourceContext.Provider value={source}>
      <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
    </StoreSourceContext.Provider>
  );
}

// Building a formatter costs far more than formatting with one, and every
// row shows a time: build it once per app language (the person's choice in
// Settings, not the system's, #1077).
let timeFormat: { locale: string; format: Intl.DateTimeFormat } | undefined;
function timeFormatter(): Intl.DateTimeFormat {
  const locale = activeLocale();
  if (timeFormat?.locale !== locale) timeFormat = { locale, format: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }) };
  return timeFormat.format;
}

export function formatTime(at: number) {
  const date = new Date(at);
  // what toLocaleTimeString says, where a formatter would throw
  return Number.isNaN(date.getTime()) ? "Invalid Date" : timeFormatter().format(date);
}

