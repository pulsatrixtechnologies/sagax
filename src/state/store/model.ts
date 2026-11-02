// Types, pure helpers and navigation action builders for the client store.
// Extracted from store.tsx for the #1383 reducer split. Keep this module
// free of React so slice reducers can import it without cycles.

import { appendDraftAttachments } from "@/lib/drafts";
import { citationAttachment, CITATION_MAX_QUOTE_LENGTH } from "@/lib/citations";
import type { AppSettingsSection, BotSettingsSection } from "../settings-section";
import type { BotUpdatePatch } from "../bot-patch-queue";
import type { BotVisibility, CardAnswerer, CloudBackend, EffortLevel, InstalledPackageMetadata, LiveCallState, LiveSettings, GroupThreadUsage, SteerQueueReason, VoiceCallMark, WireBotConversation, WireWaitingApproval } from "../../../shared/wire";
import { type DataSheet, type DataTable } from "../../../shared/data-surface";
import type { ModelListIssue } from "../../../shared/azure-openai";
import type { TurnDigest } from "../../../shared/digest";
import type { MessageReaction } from "../../../shared/reactions";
import type { AutoModelRecord } from "../../../shared/auto-model";
import type { BusySendRequest, ParallelTaskRef, TaskParallelOf } from "../../../shared/parallel-tasks";
import type { ToolScope } from "../../../shared/tool-scope";
import type { AchievementCategory } from "../../../shared/achievements";
import type { ViewerCapabilities } from "../../../shared/viewer-capabilities";
import type { ModelVariantOption, RuntimeEvent } from "../../../shared/runtime-events";
import type { MausColor, MausMotion } from "@/lib/mascot";
import type { BotAvatarCrop } from "../../../shared/bot-avatar";
import type { BotPublicProfile } from "../../../shared/bot-public-profile";
import { threadApprovalFields, type ApprovalMode } from "../../../shared/approval-mode";
import type { ProactiveMode } from "../../../shared/proactive-mode";
import type { MascotBodyId } from "../../../shared/mascot-bodies";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import type { QuestionRequestCardData } from "../../../shared/ask-question";
import type { ProfileRequestCardData } from "../../../shared/profile-request";
import type { ModelRequestCardData } from "../../../shared/model-request";
import type { RuleRequestCardData } from "../../../shared/rule-request";
import type { RoutineRequestCardData } from "../../../shared/routine-request";
import type { RoutineRunCardData } from "../../../shared/routine-run";
import type { GroupGoalRunCardData } from "../../../shared/group-goal-run";
import type { PlaceRow } from "../../../shared/place-view";
import { type SkillRequestCardData } from "../../../shared/skill-request";
import type { Routine, RoutineInput, RoutineRun, RoutineRunStatusFilter } from "@/lib/routines";
import type { WebhookAttempt, WebhookIngressStatus, WebhookTrigger } from "@/lib/webhooks";
import type { GraphConnectorOption } from "../../../shared/trigger-sources";
import { firstUnreadMessageId } from "@/lib/unread-divider";
import type { ComputerStart } from "@/lib/computer-start";
import { type NotificationTarget } from "@/lib/notify";
import { singleStreamTurnField } from "@/lib/thread-preferences";
import { isEarlierSegment, isStreamSegment, opensBesideConversation, streamHomeThread, streamUnreadReadWith } from "@/lib/single-stream";
import { openSideThread } from "@/lib/side-thread";
import { freshTopicLanding, onScreenBot } from "@/lib/fresh-topic";
import { type BotRole } from "@/lib/bot-roles";
import type { OnboardingStatus } from "@/lib/onboarding";
import { type ThreadPage } from "@/lib/thread-page-cache";

export const MAX_ROUTINE_RUNS = 2_000;
export const ACTIVE_ROUTINE_RUN_STATUSES = new Set<RoutineRun["status"]>(["queued", "running", "waiting"]);

export function trimRoutineRuns(runs: readonly RoutineRun[]): RoutineRun[] {
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
export type { RoutineRunCardData } from "../../../shared/routine-run";

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
  /** Persisted approval-rule proposal (propose_rule: add / change / remove). */
  ruleRequest?: RuleRequestCardData;
  teamSetupRequest?: import("../../../shared/team-setup").TeamSetupRequest;
  /** The model's own questions and options (Claude's AskUserQuestion), so
   * the card offers choices instead of an unanswerable Allow/Deny. */
  questionRequest?: QuestionRequestCardData;
  /** A bot action waiting for this person's Allow. The id matches requestId. */
  botActRequest?: { id: string };
  /** Shell terminal: opened only after the person taps Ouvrir un terminal. */
  terminalRequest?: import("../../../shared/terminal-request").TerminalRequestCardData;
  /** A meeting the bot asks to join as a notetaker (join_meeting). */
  meetingRequest?: import("../../../shared/meeting-request").MeetingRequestCardData;
  /** A change asked from a ConnectWise widget (shared/wire.ts). */
  cwActionRequest?: import("../../../shared/wire").OptionCardData["cwActionRequest"];
  /** 2026-10-16: custom rules (shared/custom-rules.ts) and email draft sends. */
  customRule?: import("../../../shared/wire").OptionCardData["customRule"];
  /** The model reviewer is still judging this card (lot A1b). */
  reviewing?: boolean;
  customRuleCandidate?: import("../../../shared/wire").OptionCardData["customRuleCandidate"];
  customRuleSaved?: import("../../../shared/wire").OptionCardData["customRuleSaved"];
  emailSendRequest?: import("../../../shared/wire").OptionCardData["emailSendRequest"];
}

export interface SecretRequestCardData {
  /** vaultLogin: a login request from the credential vault (carries `vault`). */
  target: import("../../../shared/credential-request").CredentialTargetId | import("../../../shared/credential-vault").VaultLoginTarget;
  vault?: import("../../../shared/credential-vault").VaultRequestCardData;
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

export interface Message extends Pick<import("../../../shared/wire").WireMessage, "widget" | "app" | "routineToggle" | "pagePublish" | "requested" | "outbound" | "dataContext" | "roster"> {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "video" | "secret" | "routine.run" | "goal.run" | "digest" | "compaction" | "access" | "nudge" | "call" | "widget" | "app" | "routines" | "roster";
  text?: string;
  /** An accepted nudge. Drawn per viewer from these names, not as a bubble.
   * `groupId` is set when the line belongs to that group chat. */
  nudge?: { fromId: string; fromName: string; toId: string; toName: string; groupId?: string };
  /** access messages: a turn that could not run on this organization server. */
  access?: import("../../../shared/wire").WireAccessCard;
  /** digest messages: what the turn did, rendered in `text` and structured here. */
  digest?: TurnDigest;
  compaction?: import("../../../shared/wire").WireMessage["compaction"];
  /** Files attached to this assistant response: provider-generated images, and
   * voice notes, documents, audio and video a bot attached with attach_file. */
  attachments?: import("../../../shared/wire").WireMessage["attachments"];
  card?: OptionCardData;
  /** Inline xterm session after a terminal request was allowed. */
  terminalEmbed?: import("../../../shared/terminal-resources").TerminalEmbed;
  /** Tailcat remote-support card. The tunnel address is never on this object. */
  remoteSession?: import("../../../shared/remote-session").RemoteSessionView;
  /** Live usage card (shared/resource-usage.ts), shown only when asked. */
  resourceUsage?: import("../../../shared/resource-usage").ResourceUsageView;
  /** "Connect Microsoft Teams" card (shared/connector-setup.ts). */
  connectorSetup?: import("../../../shared/connector-setup").ConnectorSetupView;
  secret?: SecretRequestCardData;
  /** Lifecycle mirror for a routine whose real work lives in a fresh task. */
  routineRun?: RoutineRunCardData;
  /** Durable lifecycle receipt for a goal-driven channel run. */
  goalRun?: GroupGoalRunCardData;
  /** call rows: one finished Live call (its id, times and length, and a
   * title when the bot's engine named it). Never anything said on it. */
  call?: import("../../../shared/wire").LiveCallRecord;
  /** How a channel user message should be handled. Absent means ordinary chat. */
  channelMode?: "chat" | "goal";
  /** activity messages: tool name + outcome. `spoken` is the server's
   * narration of the same chip ("reading a file"), used by call mode. */
  /** `setup` marks an error fixed by installing something, not by retrying.
   * `summary` is the call's input on one redacted line (the shell command). */
  tool?: { name: string; ok?: boolean; spoken?: string; setup?: boolean; claudeUpdate?: boolean; place?: PlaceRow; summary?: string; input?: string; output?: string ; durationMs?: number; /** The product the server declared for the tool, and the id its tool names start with (shared/wire.ts). */ product?: string; productId?: string; itemId?: string; outputPath?: string; fullResult?: boolean; /** Files the call wrote (shared/wire.ts). */ files?: string[]; widget?: import("../../../shared/cw-widgets/types").CwWidget; ruleNotice?: import("../../../shared/custom-rules").CustomRuleNotice; /** What answered the call's ask with no card (shared/wire.ts). */ autoApproval?: { source: string; rule?: string }; engineMove?: import("../../../shared/offered-engines").OrgEngineMove; limitFailover?: import("../../../shared/limit-failover").LimitFailoverLine; connectorSwitch?: { engine: string; connector: string }; soloGoal?: import("../../../shared/solo-goal-line").SoloGoalLine; finishUntil?: import("../../../shared/finish-until-line").FinishUntilLine; /** The step the working line names (shared/working-step.ts). */ step?: import("../../../shared/working-step").WorkingStep; /** Epoch ms when the usage limit that stopped this turn resets, when the engine said. */ limitResetsAt?: number };
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
  sender?: import("../../../shared/wire").WireMessage["sender"];
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
  video?: import("../../../shared/video-widget.ts").WireVideoWidget;
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
  inputRequest?: import("../../../shared/wire").WireMessage["inputRequest"];
  /** A parallel task this line belongs to (shared/parallel-tasks.ts). */
  parallelTask?: ParallelTaskRef;
  dataResult?: import("../../../shared/wire").WireMessage["dataResult"];
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
  routedBy?: import("../../../shared/wire").WireMessage["routedBy"];
}

export type GroupDefaultResponder = import("../../../shared/wire").GroupDefaultResponder;

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
  /** Prompt-cache keep-warm status (server-derived, never stored). */
  cacheKeepWarm?: import("../../../shared/wire").CacheKeepWarmStatus;
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
  approvalOwn?: import("../../../shared/approval-mode").ApprovalException;
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
  connectors?: import("../../../shared/turn-connectors").TurnConnectors;
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
  mascotLook?: import("../../../shared/mascot-look").MascotLook | null;
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
  approvalApplied?: import("../../../shared/approval-mode").AppliedApprovalLevel;
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
  /** whether this bot's turns use the loop guard (on unless switched off; workspace setting still applies) */
  loopGuard?: boolean;
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
  /** Prompt-cache keep-warm for this bot's Claude threads: true/false
   * overrides the workspace setting, absent follows it (null clears over PATCH). */
  cacheKeepWarm?: boolean | null;
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

export function taskPatchFields(patch: TaskUpdatePatch): Partial<Task> {
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
export function mergeTaskStamps<T extends { threadId: string; updatedAt?: number }>(previous: T[] | undefined, incoming: T[] | undefined): T[] | undefined {
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

export function bumpThreadUpdatedAt(state: AppState, threadId: string, at: number): AppState {
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

export function rewindThreadUpdatedAt(state: AppState, threadId: string, messages: { at: number }[], createdAt: number): AppState {
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
export function openedUnreadDivider(state: AppState, threadId: string, unread: boolean, messages: readonly Message[], lastReadMessageId?: string): AppState["unreadDivider"] {
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
  /** Prompt-cache keep-warm for idle Claude threads. Absent from older servers; on unless disabled. */
  cacheKeepWarm?: { enabled: boolean; windowMinutes: number };
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
  features?: { skillAuthoring: boolean; showToolCalls?: boolean; browser?: boolean; sharedComputers?: boolean; claudeUserMcp?: boolean; llmThreadTitles?: boolean; routinesInConversation?: boolean; connectedApps?: boolean; vpsComputer?: boolean; boatComputer?: boolean; decisionModel?: boolean; dataWindow?: boolean; meetingNotetaker?: boolean; routineGroupSettings?: boolean; skillsLibrary?: boolean; savedSteps?: boolean; autoRecall?: boolean };
  /** Loop guard: on by default; workspace can turn it off. */
  loopGuard?: { enabled: boolean; steerAt: number; stopAt?: number; correctiveRounds: number };
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
  "xai" | "mistral" | "cerebras" | "groq" | "anthropic" | "openai" | "openrouter" | "openaiCompat" | "fleet" | "box" | "vps" | "rooms" | "mcp" | "threads" | "automaticRecovery" | "cacheKeepWarm" | "localVm" | "opencodeGo" | "tts" | "decider" | "imageGen" | "live" | "profile" | "language" | "features" | "loopGuard" | "onboarding" | "browserEngine" | "browserProfiles" | "personalSettings" | "edition" | "budgets" | "billing" | "managedPolicy" | "viewer" | "allowedEngines" | "ownAccountsOutsideList" | "disabledModels" | "myDisabledModels" | "confidentialThreadsByDefault" | "orgCapabilities"
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
    cacheKeepWarm: frame.cacheKeepWarm,
    localVm: frame.localVm,
    opencodeGo: frame.opencodeGo,
    tts: frame.tts,
    decider: frame.decider,
    imageGen: frame.imageGen,
    live: frame.live,
    profile: frame.profile,
    language: frame.language,
    features: frame.features,
    loopGuard: frame.loopGuard,
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
  icon?: import("../../../shared/provider-icon").ProviderIcon;
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

export const MAX_CONSUMED_QUEUE_IDS = 64;

export function rememberConsumedQueueId(
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
export function reconcileSnapshotQueues(
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
export function replaceBotQueues(state: AppState, queues: AppState["pendingQueued"]): AppState {
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
      dataContext?: import("../../../shared/data-context").DataContext;
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
      terminalDestination?: import("../../../shared/terminal-request").TerminalDestinationPick }
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
export function reconcileModelVariantSessions(state: AppState): AppState {
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
export function withoutFreshTopicFor(state: Pick<AppState, "freshTopic" | "bots">, threadId: string): AppState["freshTopic"] {
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
export function threadReturnFor(state: ThreadOpeningState, targetThreadId: string): AppState["threadReturn"] {
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
export function bumpTranscriptGeneration(state: AppState, threadId: string | undefined | null): AppState {
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
export function readOnScreen(bot: Bot, shownThreadId: string): Bot {
  const read = new Set(threadsReadOnScreen(bot, shownThreadId));
  return { ...bot,
    unread: Boolean(bot.tasks?.some((task) => !read.has(task.threadId) && task.unread)),
    tasks: bot.tasks?.map((task) => read.has(task.threadId) ? { ...task, unread: false } : task) };
}

export function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot): AppState {
  return { ...state, bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)) };
}

export function withMascotMotion(
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

export function withPatchedCard(messages: Message[], messageId: string, patch: Partial<OptionCardData>): Message[] {
  return messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } } : m));
}

export function patchCard(state: AppState, botId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return updateBot(state, botId, (b) => ({ ...b, messages: withPatchedCard(b.messages, messageId, patch) }));
}

export function patchGroupCard(state: AppState, groupId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, messages: withPatchedCard(g.messages, messageId, patch) } : g,
    ),
  };
}

/** First-run quiz still sitting on this bot's thread. */
export function openOnboardingCard(bot: Bot): Message | undefined {
  return bot.messages.find(
    (message) => message.kind === "options" && message.card && !message.card.requestId && !message.card.dismissed,
  );
}

export function dismissOnboardingCard(state: AppState, botId: string): AppState {
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const quiz = bot ? openOnboardingCard(bot) : undefined;
  return quiz ? patchCard(state, botId, quiz.id, { dismissed: true }) : state;
}

export const optimisticMessageId = (sendId: string): string => `optimistic-${sendId}`;

export function optimisticUserMessage(
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
export function applyFolderOwner(
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
export function clearThreadReturnIfHome(state: AppState): AppState {
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
