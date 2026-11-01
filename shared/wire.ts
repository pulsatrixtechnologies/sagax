/** The client-visible wire model: the exact shapes the server serializes
 * for tasks, bots, messages, and rooms. One home so the server records, the
 * desktop client, and (later) the mobile trees cannot drift apart.
 *
 * Phase A rule: a field here is a promise that the server emits it, byte
 * for byte, in every response and SSE frame that carries the shape. Server
 * records extend these interfaces and keep their private extras in
 * server/store.ts; the wire projection is typed so a new server field
 * fails compilation until it is either declared here or explicitly listed
 * as server-private. */
import type { LimitFailoverLine } from "./limit-failover.ts";
import type { OrderTracking } from "./order-tracking.ts";
import type { SoloGoalLine } from "./solo-goal-line.ts";
import type { FinishUntilLine } from "./finish-until-line.ts";
import type { MeetingRequestCardData } from "./meeting-request.ts";
import type { ParallelTaskRef, TaskParallelOf } from "./parallel-tasks.ts";
import type { DataBroadcast } from "./data-surface.ts";
import type { AppliedApprovalLevel, ApprovalException, ApprovalMode } from "./approval-mode.ts";
import type { ProactiveMode } from "./proactive-mode.ts";
import type { ToolScope } from "./tool-scope.ts";
import type { WorkingStep } from "./working-step.ts";
import type { CommandAllowlistCandidate } from "./command-allowlist.ts";
import type { CustomRuleCandidate, CustomRuleNotice } from "./custom-rules.ts";
import type { OrgEngineMove } from "./offered-engines.ts";
import type { EmailSendRequestCard } from "./email-draft-send.ts";
import type { TurnDigest } from "./digest.ts";
import type { BotAvatarCrop } from "./bot-avatar.ts";
import type { MascotBodyId } from "./mascot-bodies.ts";
import type { MascotColorName } from "./mascot-colors.ts";
import type { MascotSkinId } from "./mascot-skins.ts";
import type { MascotLook } from "./mascot-look.ts";
import type { CwWidget } from "./cw-widgets/types.ts";
import type { CwAction } from "./cw-widgets/actions.ts";
import type { MessageReaction } from "./reactions.ts";
import type { BotCatalogListing } from "./bot-catalog.ts";
import type { RemoteSessionView } from "./remote-session.ts";
import type { ResourceUsageView } from "./resource-usage.ts";
import type { ConnectorSetupView } from "./connector-setup.ts";
import type { BotPublicProfile } from "./bot-public-profile.ts";
import type { CredentialTargetId } from "./credential-request.ts";
import type { VaultLoginTarget, VaultRequestCardData } from "./credential-vault.ts";
import type { TeamSetupRequest } from "./team-setup.ts";
import type { RoutineRequestCardData } from "./routine-request.ts";
import type { ProfileRequestCardData } from "./profile-request.ts";
import type { PlaceRow } from "./place-view.ts";
import type { ModelRequestCardData } from "./model-request.ts";
import type { SkillRequestCardData } from "./skill-request.ts";
import type { QuestionRequestCardData } from "./ask-question.ts";
import type { RoutineRunCardData } from "./routine-run.ts";
import type { WidgetPayload } from "./widget.ts";
import type { AppPayload } from "./app.ts";
import type { GroupGoalRunCardData } from "./group-goal-run.ts";
import type { RuntimeEvent } from "./runtime-events.ts";
import type { Notification } from "./notification.ts";
import type { Routine, RoutineRun } from "./routines.ts";
import type { WebhookAttempt, WebhookTrigger } from "./webhooks.ts";
import type { AutoModelRecord } from "./auto-model.ts";
import type { CloudAgentWireItem } from "./cloud-agents.ts";
import type { TerminalEmbed } from "./terminal-resources.ts";
import type { TerminalRequestCardData } from "./terminal-request.ts";
import type { WireVideoWidget } from "./video-widget.ts";
import type { ArtifactsFrame } from "./artifacts.ts";
import type { BotTasksFrame } from "./bot-task-list.ts";
import { EFFORT_LEVELS, isEffortLevel, type EffortLevel, type ModelSelection } from "./model-selection.ts";

export { EFFORT_LEVELS, isEffortLevel, type EffortLevel, type ModelSelection };

/** Which cloud computer backs computer: "cloud"; absent means Boat. */
export type CloudBackend = "box" | "vps";

/** A place a bot can act. cloud covers both cloud backends — from the
 * person's seat they are the same "cloud computer" panel. */
export type Surface = "cloud" | "vm" | "local" | "browser";

/** A bot color name: the palettes in shared/mascot-colors.ts. */
export type MausColor = MascotColorName;

/** The face a bot rests on, as one of the engine's state names. Kept as a
 * plain string rather than a union: bots saved under the app's earlier
 * ten-face vocabulary still carry those names. */
export type MausExpression = string;

/** What the bot is doing right now, as the harness sees it. `parked.computer`
 * is task-level only (ADR-2, #1651): a thread whose turn settled at the
 * computer wait ceiling and resumes when the seat frees. It never elevates
 * the bot-level activity and never counts as busy. */
export type BotActivity = "working" | "waiting-on-you" | "idle" | "no-signal" | "dead" | "parked.computer";

/** The bot that opened a thread on itself or a teammate. */
export interface TaskOpenedBy {
  botId: string;
  name: string;
  delegationId?: string;
  /** What kind of conversation the opener made this: "pair" is the one
   * durable conversation between two bots; "work" closes itself once its
   * result has been reported; "agent" is an outside agent's conversation
   * with this bot (a person's AI client over MCP, shared/agent-conversation.ts):
   * its botId is `agent:<slug>`, never a bot id. */
  kind?: "pair" | "work" | "agent";
  /** The opener's own conversation this "work" thread was opened from.
   * Everything that conversation later sends this bot continues here. */
  threadId?: string;
  at: number;
}

/** The bot that closed a thread it opened (or one of its own). */
export interface TaskClosedBy {
  botId: string;
  name: string;
  at: number;
}

/** What a task has spent, banked once per settled turn. */
export interface TaskUsage {
  input: number;
  output: number;
  /** cached share of input (context the model re-read); absent on records
   * from builds before it was tracked */
  cachedInput?: number;
  /** null until any turn reported a cost — most engines never do */
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

/** Accounting for the currently displayed room thread, across all speakers. */
export interface GroupThreadUsage extends TaskUsage {
  lastSpeaker?: { botId: string; name: string };
}

/** One task = one conversation with its own context, thread and provider
 * session. Wire form: no resumeCursors or lastInstanceId — the harness's
 * own bookkeeping that no client has ever used. */
export interface WireTask {
  /** Outstanding handoffs, not an active provider turn. */
  waitingForTeammates?: boolean;
  threadId: string;
  title: string;
  createdAt: number;
  /** The first message already drove a title attempt for this thread, so a
   * later one does not rename a thread the person may have retitled. */
  titleFromFirstMessage?: true;
  /** Organizational grouping only; never a directory or provider context. */
  projectId?: string;
  /** Detached routine execution, reachable through its visible results card. */
  routineRunId?: string;
  /** An automatic "<routine> · Results" thread (2026-10-22): kept and listed
   * with threads shown, but never a segment of the single stream, never a row
   * under the bot with threads hidden, never unread. New reports go to the
   * person's own conversation instead. Only `true` is stored. */
  routineResults?: true;
  /** A hidden conversation: an AI client (the Perspicax MCP `sagax_send`,
   * the member API) works with the bot here on the person's behalf, the way
   * the reference design keeps its subagents' conversations out of the chat (#291). Never
   * in the sidebar, previews, typing dots, unread or notifications; reached
   * from the bot's Activity panel or a thread link. Only `true` is stored. */
  hidden?: true;
  /** A confidential thread (server/confidential-threads.ts): nothing of it
   * is remembered, exported, logged or shared beyond its owner. Permanent
   * once set: only deleting the thread ends it. Only `true` is stored. */
  confidential?: true;
  /** Set when a bot, not a person, opened this thread. */
  openedBy?: TaskOpenedBy;
  /** A parallel task: the conversation and request it answers. */
  parallelOf?: TaskParallelOf;
  /** Organization server: the person this 1:1 thread belongs to (who
   * started it; a routine's runAs; else the bot owner when absent). Only
   * they read or write it (server/thread-privacy.ts). */
  ownerPrincipalId?: string;
  /** Set by close_thread; absent while the thread is open. */
  closedBy?: TaskClosedBy;
  /** When the person archived this thread. Absent = unarchived. */
  archivedAt?: number;
  /** The person pinned this thread above the update-ordered list. Only true
   * is stored; absence means unpinned. */
  pinned?: boolean;
  link?: string;
  linkAuto?: boolean;
  /** Epoch ms of the newest message, or createdAt when the thread has none.
   * Server-derived. Clients must not write it. */
  updatedAt?: number;
  /** When the person snoozed this thread. 0 means "until new activity" and
   * the store clears it the moment the thread wakes; a future epoch ms means
   * "until then" and reads treat an expired value as absent, so no timer or
   * migration is ever needed. Absent = not snoozed. */
  snoozedUntil?: number;
  /** The model this thread's turns run on: its own when a person picked one
   * in this thread, else its bot's (followsBotModel). The server stores none
   * for a thread that follows its bot, and always sends the effective one. */
  modelSelection?: ModelSelection;
  /** Auto: the model the last turn here ran on, and why. Server-derived. */
  autoModel?: AutoModelRecord;
  /** true: the thread runs on its bot's model and moves with it; false: a
   * person picked this thread's model. Derived at projection, never stored;
   * absent from servers older than this field. */
  followsBotModel?: boolean;
  /** The thread's own approval level, present only with approvalOwn: a
   * thread follows its bot's current level live (#1169, #1170), and stores
   * none. */
  approvalMode?: ApprovalMode;
  autoApprove?: boolean;
  /** Standing approvals saved in this thread. A thread that follows its bot
   * also gets the bot's own; an exception keeps only these. */
  alwaysAllow?: string[];
  /** Why this thread runs at its own approval level instead of its bot's:
   * a person chose it in this thread ("thread"), a Primary Bot delegated its
   * level ("delegated"), an engine change asks again ("engine"), or a safety
   * revocation ("safety"). Absent: the thread follows the bot, live. Any
   * change of the bot's level ends every exception (approval-levels.md). */
  approvalOwn?: ApprovalException;
  unread?: boolean;
  /** The newest message on screen the last time the person read this
   * conversation. The New divider goes after it. */
  lastReadMessageId?: string;
  /** true after an edit/branch-switch rewound the visible conversation. */
  rewound?: boolean;
  pinnedMessageId?: string;
  /** Runtime-only state, reset on load and never persisted. */
  activity?: BotActivity;
  busy?: boolean;
  /** Epoch ms when this task's current busy stretch began — the chat anchors
   * its elapsed readout here, so the count survives thread switches. Stamped
   * by setTaskActivity on an idle→busy transition; runtime-only like busy. */
  turnStartedAt?: number;
  /** Last turn: wait before the engine was sent, and wait until the first
   * answer text. Numbers only. Stored on the conversation, never in a message. */
  turnTiming?: { queueMs?: number; firstResponseMs?: number };
  /** What the last direct turn could reach, by source (shared/turn-connectors.ts):
   * names and states only. Absent before the first turn that recorded it. */
  connectors?: import("./turn-connectors.ts").TurnConnectors;
  /** Where this conversation works when pinned; absent = follow the bot. */
  surface?: Surface;
  /** The pin above is the machine's own record (where an Auto turn landed,
   * or the bot's select_computer choice), not a person's, so the next Works
   * on change moves it. Derived at projection from the server-private
   * provenance and never stored; absent on a person's pin and on a pin from
   * before the server recorded who set it. */
  surfaceAuto?: true;
  /** what this task has spent, banked once per turn */
  usage?: TaskUsage;
  /** the folder this task's turns run in, pinned on its first turn. */
  cwd?: string | null;
}

/** A lightweight organizational label within one bot. */
export interface BotProject {
  id: string;
  name: string;
  emoji?: string;
}

/** Public, package-authored playbooks installed for a bot. Process
 * guidance only — never executable code, credentials, or grants. */
export interface InstalledPlaybook {
  key: string;
  name: string;
  summary: string;
  triggers: string[];
  instructions: string;
}

/** Listing provenance and connector intent retained for package details
 * and future re-export. It never means the apps are authorized. Every field
 * after requiredApps is additive and optional: older records have none. */
export interface InstalledPackageMetadata {
  id: string;
  name: string;
  release: string;
  requiredApps: Array<{ slug: string; label: string; reason: string; optional?: boolean }>;
  /** Where it came from; absent on older records means "file". */
  source?: "file" | "org";
  /** file: a random id per import; org: derived from the organization and package. */
  installId?: string;
  /** This bot's key in the package, so a re-export keeps its identity. */
  agentKey?: string;
  /** Set when the bot was created from a package preset. */
  presetKey?: string;
  /** What the package suggested. Never applied: imported bots start on Ask. */
  suggestedApproval?: "ask" | "auto";
  /** org only */
  publisher?: { organizationId: string; slug: string; name: string };
  /** org only: "<publisher slug>/<package id>" */
  ref?: string;
  /** org only: the release bytes that were applied */
  sha256?: string;
}

/** One service's connector tool grant: `"*"` widens to every tool on the
 * service, an explicit list names exact tools. */
/** A bot as a client may see it. Wire form: no provider session
 * bookkeeping (resumeCursors), no elevation journal (approvalGrant), no
 * settlement receipts (lastProfileRequestId, lastTeamSetupReceipt); the
 * projected tasks are WireTask[] and avatarUrl is always present
 * (null when the bot has none). */
export interface WireBotGrant {
  target: string;
  level: "use" | "run" | "edit" | "manage";
  by: string;
  at: number;
}

/** A bot-to-bot conversation of this bot waiting on the person
 * (server/inter-bot-approvals.ts): never listed, its cards are answered from
 * the conversation the person has open. */
export interface WireWaitingApproval {
  threadId: string;
  /** The bot that opened it. */
  openedByName?: string;
  kind?: "pair" | "work";
  /** The conversation's last change (epoch ms): a new card refreshes it. */
  updatedAt?: number;
}

/** A conversation between this bot and another bot, named on both ends
 * (server/inter-bot-conversations.ts). The messages are read through
 * GET /api/threads/:threadId/messages. */
export interface WireBotConversation {
  threadId: string;
  otherBotId: string;
  otherName: string;
  /** "in": the other bot opened it here; "out": this bot opened it there. */
  direction: "in" | "out";
  /** "agent": the other end is an outside agent (a person's AI client over
   * MCP, shared/agent-conversation.ts), not a bot: otherBotId is its
   * `agent:<slug>` id and the apps draw a neutral icon. */
  kind?: "pair" | "work" | "agent";
  updatedAt?: number;
  /** When the conversation was opened: where its line sits in the chat. */
  startedAt?: number;
  /** The conversation is working now (a discreet indicator and a Stop). */
  running?: boolean;
}

export interface WireBot {
  waitingForTeammates?: boolean;
  /** Bot-to-bot conversations this viewer may read, both ends. Absent: none. */
  botConversations?: WireBotConversation[];
  /** Bot-to-bot conversations waiting on this viewer's approval. Absent:
   * none. Server-derived. */
  waitingApprovals?: WireWaitingApproval[];
  id: string;
  /** The task selected in the UI; running turns keep their own thread id. */
  threadId: string;
  /** The bot's main thread (server/main-thread.ts): where a routine without
   * a thread of its own reports, and what a bot opens to while threads are
   * hidden. Server-derived; absent only for a bot without threads. */
  mainThreadId?: string;
  /** every task this bot has, newest first, projected like wireTask */
  tasks?: WireTask[];
  /** Projects group this bot's threads; older bots have no projects. */
  projects?: BotProject[];
  name: string;
  title: string;
  description: string;
  /** Standing instructions — the persona body. */
  soul?: string;
  /** sha256 of soul, for spotting a SOUL.md edited outside the app. */
  soulHash?: string;
  /** The SOUL.md mirror differed from soul at the last turn dispatch. */
  soulDrift?: boolean;
  /** Server-computed: the first non-empty line of `soul` without heading
   * marks, at most 140 characters (shared/instructions-lead.ts). Absent when
   * the bot has no instructions. */
  instructionsLead?: string;
  notifications: boolean;
  color: MausColor;
  mascotExpression?: MausExpression | null;
  mascotBody?: MascotBodyId | null;
  /** Special-edition skin over the body and colour. Absent means none. */
  mascotSkin?: MascotSkinId | null;
  /** The bot's character (owl, original shape, Trombi) and its look; absent means the owl. */
  mascotLook?: MascotLook | null;
  /** App-owned attachment served as this bot's custom profile image;
   * always present on the wire, null when the bot has none. */
  avatarUrl: string | null;
  /** Mascot, or the crop applied to avatarUrl. */
  avatarCrop?: BotAvatarCrop;
  /** Zoom of a custom image. Absent means 1, the unzoomed cover crop. */
  avatarZoom?: number;
  /** Horizontal point of the image kept in the crop, 0–1. Absent means center. */
  avatarFocusX?: number;
  /** Vertical point of the image kept in the crop, 0–1. Absent means center. */
  avatarFocusY?: number;
  /** True when any task has unread output. */
  unread: boolean;
  /** The bot's model: every thread without a model of its own runs on it
   * and moves with it. Navigating tasks never changes this value. */
  modelSelection: ModelSelection;
  /** where the bot works ("Works on"). Unset = auto. */
  computer?: Surface | "off";
  /** Enrolled unattended hosts (`h_` + 32 hex) attached from the Computer
   * tab so this bot has access by default (2026-11-01). Absent = none. */
  remoteHosts?: string[];
  /** Which cloud computer backs computer: "cloud"; absent means Boat. */
  cloudBackend?: CloudBackend;
  /** Auto mode may prepare/start this bot's managed VPS container. */
  autoStartVps?: boolean;
  /** where NEW tasks run their shell tools; absent = home folder. */
  cwd?: string;
  /** Auto mode: the bot approves its own tool permissions. */
  autoApprove?: boolean;
  /** Canonical approval level. Missing resolves through autoApprove. */
  /** Who confirmed the Full access warning for this bot, once
   * (server/org-full-access.ts). Later grants by that person skip it. */
  fullAccessConsent?: { principalId: string; at: number };
  approvalMode?: ApprovalMode;
  /** 2026-10-28 (one source of truth): the bot's own approval level as its
   * owner chose it in Permissions, never a conversation's. `approvalMode`
   * above may carry the open conversation's level. Server-derived. */
  approvalSetting?: ApprovalMode;
  /** The level the open conversation (`threadId`) really runs at, as the
   * server judges its turns, with why, only when it is not
   * `approvalSetting`. Absent: the conversation runs the bot's setting. */
  approvalApplied?: AppliedApprovalLevel;
  /** Proactive on/off (shared/proactive-mode.ts): "off" = no wakes;
   * "proactive" = wakes on email, calendar, failed run, bot mention or
   * webhook and acts at its approval level and rules. Absent reads as the
   * default "proactive" (proactiveModeFor). Never a Chief orchestrator. */
  proactiveMode?: ProactiveMode;
  /** Tools this bot may always use without asking. */
  alwaysAllow?: string[];
  /** Speak this bot's replies aloud as they settle, without being asked. */
  speakReplies?: boolean;
  /** The person's own "do not finish until" sentence. Absent means off. Not a task list. */
  finishUntil?: string;
  /** #1329: how many turns Sagax starts on its own while `finishUntil` is
   * not met, before it waits for the person. Absent = 5
   * (shared/finish-until-line.ts). */
  finishUntilMaxRounds?: number;
  /** This bot's own voice id, so a room of bots doesn't sound like one person. */
  voice?: string;
  /** Whether this bot may send voice notes. Absent/true = allowed; false
   * hides the tool and refuses the route even with a voice configured. */
  voiceNotes?: boolean;
  /** Whether this bot may write email draft cards. Absent/true = allowed;
   * false refuses ```email fences in the prompt and the send route. */
  emailDrafts?: boolean;
  /** Whether this bot uses native memory. Absent/true = enabled. */
  memoryEnabled?: boolean;
  /** How far this bot's team-memory cards travel (shared/team-memory-sharing.ts):
   * absent or "shared", every member of its section; "private", only the
   * members who see this bot and the card's conversation or channel. */
  teamMemorySharing?: "shared" | "private";
  /** Queue direct-chat messages behind outstanding delegated work. */
  parkDirectMessages?: boolean;
  /** true after an edit/branch-switch rewound the visible conversation. */
  rewound?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  /** Published to the organisation bot catalogue (shared/bot-catalog.ts). */
  catalog?: BotCatalogListing;
  /** Optional labeled divider used to organize this bot in the sidebar. */
  section?: string;
  /** the one message pinned to the top of this bot's active thread */
  pinnedMessageId?: string;
  /** This is its owner's Primary Bot: their main contact, who coordinates
   * the other bots. At most one per person (one on a solo server), enforced
   * by the server. Stored and sent under its former name, Chief of Staff. */
  chiefOfStaff?: boolean;
  /** Owner-selected additional teams this Primary Bot may coordinate. */
  managedSections?: string[];
  /** Pause for human approval before this bot talks to a peer. */
  approvePeerComms?: boolean;
  /** #1276: on a local model, "full" sends the whole prompt as before;
   * absent or "compact" sends the compact, stable prompt. */
  localPrompt?: "compact" | "full";
  /** Bot ids this bot is allowed to contact. */
  peers?: string[];
  /** 2026-10-21 (parité 1C): who this bot writes to without a card:
   * `bot:<id>`, `email:<address>`, `phone:+<digits>`
   * (shared/allowed-recipients.ts). Anyone else keeps the card. */
  allowedRecipients?: string[];
  outbound?: { policy: "ask" | "allow"; dailyCap: number };
  /** Ordered backups used only by opt-in, pre-prompt startup recovery. */
  fallback?: Array<{ instanceId: string; model: string }>;
  /** Per bot since 2026-10-15 (server/bot-runtime-settings.ts): its
   * conversations that may work at once (1..10). Absent: the server default. */
  maxConcurrentThreads?: number;
  /** Parallel tasks one person may have running on this bot (1..10 on an
   * organization server, 1..16 on a solo server, #1098). */
  maxParallelPerPerson?: number;
  /** #1098: this bot's per-turn anti-loop limits, set by its owner
   * (shared/turn-limits.ts). Absent: the defaults. */
  turnLimits?: { roomPosts?: number; threadsOpened?: number; roomsCreated?: number };
  /** What a message sent while this bot works does by default. Absent: each
   * person's own default (shared/parallel-tasks.ts BusySendPreference). */
  busySend?: "ask" | "steer" | "parallel" | "after";
  /** Automatic recovery for this bot: on, and its backup model (its
   * `fallback` chain wins when it has one). Absent: the server default. */
  automaticRecovery?: { enabled: boolean; backup?: ModelSelection };
  /** #1137, organization server: who pays for this bot's replies to the
   * people it is shared with (shared/turn-payer.ts). Absent: the default. */
  turnPayer?: "owner" | "speaker";
  /** #1137: the default the server computes for this bot (the owner's local
   * model or own subscription: the owner; otherwise each person). Sent on
   * an organization server only, never stored. */
  turnPayerDefault?: "owner" | "speaker";
  /** Whether this bot gets the app's built-in browser. */
  browser?: boolean;
  /** Memory upkeep: the harness captures facts from finished chats into
   * MEMORY.md and topic files, adds facts about the person to About me and
   * tidies nightly. On unless explicitly false; every change is journaled
   * and can be undone. */
  memoryUpkeep?: boolean;
  /** Which of the app-wide MCP servers this bot mounts, by name. */
  mcpServers?: string[];
  /** The saved account each MCP server signs in with for this bot, by
   * server name; a server it does not name uses its default account. */
  mcpAccounts?: Record<string, string>;
  /** Owner-selected original tool identities. An empty allowlist permits none. */
  toolScope?: ToolScope;
  /** Id of a named browser profile; absent = the bot's own private session. */
  browserProfile?: string;
  /** Public, package-authored playbooks installed for this bot. */
  playbooks?: InstalledPlaybook[];
  /** Listing provenance for package details and future re-export. */
  installedPackage?: InstalledPackageMetadata;
  /** Aggregate of task and room activity; transient, reset on load. */
  busy?: boolean;
  /** What the bot is doing right now; transient like busy. */
  activity?: BotActivity;
  createdAt: number;
  /** Who may see this bot on a workspace several people share. Absent means
   * everyone. Sent to admins only; a member's copy of a bot never carries it. */
  visibility?: BotVisibility;
  /** User ids this bot's owner opened Direct to. Absent or empty: only the
   * owner sees the bot in Direct. */
  directGrants?: string[];
  /** Slice 4 (organization server): who may reach this bot and how far.
   * `target` is `user:<principal id>` or `team:<Perspicax team id>`;
   * `directGrants` mirrors the `user:` targets for older clients. */
  grants?: WireBotGrant[];
  /** Lowercased user id of the person who created the bot. Absent on older
   * records: the org owner is the owner. */
  ownerUserId?: string;
  /** Where this bot's turns run. Missing on older bots.json means fleet. */
  host?: { kind: "fleet" } | { kind: "machine"; userId: string; deviceId: string };
}

/** Who may see a bot: every signed-in person, admins only, or the listed
 * addresses (and `@domain` entries) plus admins. See server/bot-visibility.ts. */
export type BotVisibility = "everyone" | "admins" | { people: string[] };

/** The person a user message is from, as the server resolved it from their
 * own session. No request body can supply it. `name` is attribution only:
 * nothing may be allowed or refused because of it. `id` is an opaque key the
 * server derives from the authenticated session (the account email when
 * there is one, else the paired session), and decides one thing only: on a
 * workspace shared by several people, whose session may answer the card
 * this request raised. */
export interface ResolvedSender {
  name: string;
  id?: string;
}

/** Who answered a card: a signed-in person (named as their messages are), the
 * owner on this machine, or a session-less local caller on a shared server
 * (`worker`: the Slack worker, or any other process on that machine). */
export type CardAnswerer = (
  /** `person`: the answering session's opaque person key, recorded on an OMB
   * Cloud home only, where it decides whether an answer came from the owner
   * (server/cloud-lending.ts). */
  | { kind: "session"; name: string; person?: string }
  | { kind: "loopback" }
  | { kind: "worker" }
) & {
  /** "call": decided by voice on a Live call, not tapped. "ai-client": answered
   * from an AI client attached to Perspicax (Claude Code, claude.ai), through
   * the member API, by the person named (lot C.3). "primary-bot": answered
   * by a bot the person owns (`bot`, its name) at the person's own request
   * (sagax_approvals). The field name stays "primary-bot" (2026-10-20);
   * since 2026-10-27 any owned bot, not only the Primary Bot.
   * "auto-review": the model reviewer applied the person's rule (2026-10-21,
   * server/custom-rules-model.ts; the card's customRule says which and why). */
  via?: "call" | "ai-client" | "primary-bot" | "auto-review" | "reach-me";
  bot?: string;
  /** "reach-me" (2026-10-26): answered from the person's own "Me joindre"
   * channel (sms, teams, telegram) with the card's reply code. */
  channel?: string;
};

export interface WireAccessCard {
  /** `routine_delegation` (slice 6): an organization routine the server
   * paused, its person out or without `run` (`engine` is then ""). Since
   * 2026-10-08 never for lack of a delegation; an older card with a
   * delegation reason renders nothing. */
  reason: "engine_missing" | "no_access" | "key_refused" | "routine_delegation" | "sign_in";
  /** The engine's display name, e.g. Claude. */
  engine: string;
  botId: string;
  ownerPrincipalId: string;
  detail?: string;
  /** Slice 4: where a person sets their model keys (Perspicax console),
   * on a no_access card of an organization server. */
  keysUrl?: string;
  /** 2026-10-01, no_access: whose credentials the turn needed (the person
   * who spoke, or the bot's owner for its routines), and why none served. */
  payer?: "speaker" | "owner";
  payerPrincipalId?: string;
  /** `owner_model_offline` (#1137): the owner pays and the bot runs on the
   * local model of the owner's computer, which is not connected now.
   * `sign_in_expired` (#1533): the payer's own subscription sign-in was
   * refused and could not be refreshed: they reconnect it. */
  cause?: "payer_disabled" | "no_credentials" | "server_engine_not_allowed" | "owner_model_offline" | "sign_in_expired";
  /** The bot's routine: it runs on its owner's credentials only. */
  routine?: true;
  /** #1137: the bot's name, when the card was written. */
  botName?: string;
  /** #1137: the owner pays for this bot's replies (shared/turn-payer.ts); the
   * card is then also for the person who wrote (`speakerPrincipalId`). */
  ownerPays?: true;
  speakerPrincipalId?: string;
  /** #1137: the owner's display name, on an `owner_model_offline` card. */
  ownerName?: string;
  /** #1137: replies are paid by the person who writes, and the bot is not
   * theirs: the card offers to choose a model they can pay for. */
  speakerPays?: true;
  /** #1545, `sign_in`: the engine or account a bot asks the person to sign
   * in to (sagax_settings models.engineSignIn); the person signs in from
   * Settings > Models, the bot never sees it. */
  instanceId?: string;
  /** The engine takes a personal subscription sign-in (Claude, Codex):
   * the card offers Settings > Organization > My engines. */
  subscriptionSignIn?: true;
  /** Slice 6, routine_delegation: who the routine runs as, which routine,
   * and why it is paused. */
  runAsPrincipalId?: string;
  /** The person's display name when the card was written. */
  runAsName?: string;
  routineId?: string;
  routineName?: string;
  suspendReason?: "delegation_missing" | "delegation_ended" | "delegation_revoked" | "person_out" | "no_right";
}

/** One transcript line. Serialized as stored — the durable delivery
 * identity (roomRequest) rides the wire unchanged. */
/** WireMessage.voiceCall: a person's words said on a voice call. */
export interface VoiceCallMark {
  callId: string;
  /** the person cut the bot's previous answer to say this */
  interrupted?: boolean;
  /** the call's language when one is set */
  language?: string;
  /** one spoken utterance (idempotency across retries and the steer queue) */
  utteranceId?: string;
  /** on a barge-in: what the person actually heard of the cut answer */
  heard?: string;
  /** on a barge-in: what they did not hear (kept for the transcript) */
  unheard?: string;
  /** these words complete the previous utterance, which was cut short */
  continues?: boolean;
  /** full-duplex: replace the in-flight turn, never steer or queue */
  duplex?: boolean;
  /** STT partial sent before end-of-speech. Must not become a parallel task. */
  speculative?: boolean;
  /** The page's stages of this turn in ms (end of speech, speech to text,
   * send), for the Events lens (server/voice-timing.ts). Diagnostics only:
   * the server never stores it on the message. */
  timing?: { endpointMs?: number; sttMs?: number; dispatchMs?: number };
}

/** The header a client sends with a routine switched on or off while a
 * conversation is open: that conversation's thread id, where the server
 * writes its "Disabled · 1 routine" line (server/routine-chat-events.ts). */
export const ROUTINE_CONVERSATION_HEADER = "x-sagax-conversation";

/** WireMessage.routineToggle: a routine change this turn made, as one quiet
 * line in the conversation. `enabled`/`disabled` group every routine a turn
 * turned on or off into one count line ("Disabled · 5 routines"). `created`/
 * `updated`/`deleted` (2026-10-21) are a bot touching a routine's
 * definition: one named line each ("Updated routine · <name>"), the name never
 * a UUID (shared/human-id.ts). */
export interface RoutineToggleEvent {
  action: "enabled" | "disabled" | "created" | "updated" | "deleted";
  /** The user message that started the turn (the line groups by it); the
   * thread's first message id, or "", when no person spoke first. */
  turnKey: string;
  /** In the order they changed; the name as it was then. The created/updated/
   * deleted lines carry exactly one routine. */
  routines: Array<{ id: string; name: string; botId?: string; groupId?: string; runAs?: string }>;
}

/** A bot⇄bot chip's link to the channel. 2026-10-21 (parité 1C): which way
 * the message went (`sent` on the sender's note, `received` on the
 * recipient's) and, on the sender's note, the words it sent, cut short, so a
 * preview reads "Messaged @X: text". Older notes carry neither: clients read
 * a missing direction as sent unless the note says "Message from". */
export interface Comm {
  groupId: string;
  threadId?: string;
  withBotId: string;
  withName: string;
  withColor: string;
  gone?: boolean;
  direction?: "sent" | "received";
  text?: string;
}

export interface WireMessage {
  roomRequest?: { id: string; phase: "request" | "result" };
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "video" | "secret" | "routine.run" | "goal.run" | "digest" | "compaction" | "access" | "nudge" | "call" | "widget" | "app" | "routines" | "roster";
  text?: string;
  /** kind "routines" (2026-10-15): one compact line in the conversation
   * saying this turn turned routines on or off (server/routine-chat-events.ts).
   * Each viewer receives only the routines they can see; `text` is the
   * fallback line ("Disabled 5 routines") for clients that do not know the
   * kind, recounted for that viewer. */
  routineToggle?: RoutineToggleEvent;
  /** An accepted nudge. The app draws one line from these names: first
   * person for the sender, the sender's name for everyone else. `groupId`
   * marks a line in that group chat. A direct nudge has no groupId. A
   * refusal does not write this. */
  nudge?: { fromId: string; fromName: string; toId: string; toName: string; groupId?: string };
  /** kind "roster" (#1480): one neutral line in a group chat about its
   * people, drawn centred, never a bubble. `left`: that person left the
   * group (server/group-leave.ts). `text` is the fallback line for clients
   * that do not know the kind. */
  roster?: { event: "left"; personId: string; name: string };
  /** kind "access" (organization server, slice 3): a turn that could not run
   * for lack of engine access. Never provider text, except `detail` on
   * key_refused (redacted, at most 200 characters), which only the bot's
   * owner and the organization's admins receive. */
  access?: WireAccessCard;
  digest?: TurnDigest;
  compaction?: {
    summary: string;
    firstKeptId: string;
    foldedThroughId: string;
    tokensBefore: number;
    by: "person" | "harness";
  };
  /** Durable provider output stored by the harness; renderers receive only
   * the allowlisted /api/attachments URL. `file` entries are documents, audio
   * and video a bot attached with attach_file; they are opened through the
   * message-scoped file route, never by path. */
  attachments?: Array<
    | { kind: "image"; path: string; mime: string; name?: string }
    | { kind: "file"; path: string; mime: string; name: string }
    | { kind: "audio"; path: string; mime: string; durationMs?: number }
  >;
  card?: OptionCardData;
  /** widget rows (kind "widget"): a bot-authored UI tree (shared/widget.ts).
   * `text` is always its readable fallback, for clients that do not know
   * the kind. */
  widget?: WidgetPayload;
  /** app rows (kind "app"): a bot-authored live HTML surface (shared/app.ts),
   * drawn in the sandboxed app frame and replaced in place by update_html.
   * `text` is always its readable fallback, for clients that do not know
   * the kind. */
  app?: AppPayload;
  secret?: SecretRequestCardData;
  /** One idempotently updated status card for a routine run. */
  routineRun?: RoutineRunCardData;
  /** Terminal receipt for a bounded multi-bot channel goal. */
  goalRun?: GroupGoalRunCardData;
  /** call rows (kind "call"): the finished Live call this row records. The
   * row's text is only the fallback line for clients that do not know the
   * kind. */
  call?: LiveCallRecord;
  /** activity messages: tool name + outcome. */
  tool?: {
    name: string; ok?: boolean; spoken?: string; setup?: boolean; terminal?: boolean; summary?: string; input?: string; output?: string;
    /** how long the call ran, set when it settles (the step row's duration) */
    durationMs?: number;
    /** 2026-10-29: the step this call is, for the working line ("Reading
     * your email", "Running scrape.py"), the same whatever the engine
     * (shared/working-step.ts). Set when the call starts. */
    step?: WorkingStep;
    /** The product this tool serves, as the connector or the server
     * declared it at run time (a Perspicax API's display name or title);
     * the step row names it. Absent: the row reads a generic name from the
     * tool id. */
    product?: string;
    /** The id the tool's name starts with for that product (`acme_desk`
     * in `acme_desk_ticket_get`), declared with it. */
    productId?: string;
    /** error rows: the installed Claude Code is too old for the model, and
     * the UI can offer to update it in place. */
    claudeUpdate?: boolean;
    /** error rows: the place this turn could not use (shared/place-view.ts). */
    place?: PlaceRow;
    /** Provider item identity, scoped to the owning turn. */
    itemId?: string;
    /** A failed one-way send's row: the runtime id of the notice it reports. */
    handoffId?: string;
    /** Whether the harness captured the full redacted result. Private
     * server-local spill paths are not exposed to clients. */
    fullResult?: boolean;
    /** Files the call wrote, as the tool named them (see thread-files.ts). */
    files?: string[];
    /** A call a sub-agent made: the item id of the call that started it. */
    parentItemId?: string;
    /** A ConnectWise call's result as an in-chat widget (shared/cw-widgets). */
    widget?: CwWidget;
    /** 2026-10-16: the person's custom rule that approved or refused this
     * call with no card (the rule notice, with a link to edit it). */
    ruleNotice?: CustomRuleNotice;
    /** 2026-10-28: the call's permission ask was answered with no card
     * (Full access, an Always allow, a saved rule, a read Sagax trusts):
     * what answered it, shown only in the row's details, never on the line.
     * `source` is the decision log's source (auto-approve.ts). */
    autoApproval?: { source: string; rule?: string };
    /** 2026-10-18: the bot left an engine the organization no longer
     * offers and now runs on Auto (shared/offered-engines.ts). */
    engineMove?: OrgEngineMove;
    /** 2026-10-19: a usage limit sent the turn to another engine, or it
     * came back (shared/limit-failover.ts); drawn in the reader's language. */
    limitFailover?: LimitFailoverLine;
    /** 2026-10-21 (review of #943): a request ran on another engine that
     * has the connector it needed (server/connector-switch.ts); drawn in
     * the reader's language. */
    connectorSwitch?: { engine: string; connector: string };
    /** #1372: a 1:1 goal's status (server/solo-goal.ts); drawn in the
     * reader's language. */
    soloGoal?: SoloGoalLine;
    /** #1329: a "do not finish until" check (server/finish-until.ts):
     * relaunch x/N, met, blocked, bound reached or stopped; drawn in the
     * reader's language. */
    finishUntil?: FinishUntilLine;
  };
  /** A bot line a "post" webhook wrote: whoever called the webhook chose
   * its words. On a Cloud home a conversation holding one is someone else's
   * for lending and memory (server/cloud-lending.ts reportsFromOthers). */
  webhookPost?: boolean;
  /** user messages sent INTO a running turn (capabilities.queueing). */
  steered?: boolean;
  /** user messages a peer bot handed to this thread's RUNNING turn through
   * the non-interrupting aside lane: peer context folded in mid-turn, never
   * a new request. The text is stored enveloped exactly as injected, so any
   * later reader sees the sender and the not-steering framing. */
  aside?: boolean;
  /** A user-role message that arrived through the server's HTTP API
   * ("api"), a request a person spoke on a Live call ("call"), or a text
   * the person sent their bot from their own verified number ("sms",
   * server/sms-conversation.ts). */
  via?: "api" | "call" | "sms";
  /** The Live call a "call" line was spoken on (LiveCallState.callId). Set
   * only on user messages with `via: "call"`; a turn's own messages point
   * at their request through `requestMessageId` instead. */
  callId?: string;
  /** A user line an external interface relayed through the guarded send
   * route (the Slack worker, for someone else, as this computer): nobody
   * typed it in one of this workspace's clients. A Live call never reads it
   * back as what the caller typed. */
  relayed?: boolean;
  /** Which person sent this user message, when the workspace has more than
   * one. The server authenticates per person but used to attribute every
   * user turn to the single profile name, so on a shared or paired instance
   * every human collapsed into whoever Settings named — bots addressed the
   * wrong person and remembered work under their name. Absent for the
   * desktop owner's own sends and for every message written before this
   * existed; both still read as the profile name. */
  sender?: ResolvedSender;
  /** Provider turn that produced this message. */
  turnId?: string;
  /** What the turn that wrote this bot reply ran on. Absent on replies from
   * before it was recorded, and on room replies that ran on the bot's model;
   * no effort means the engine default. `requested` (#1154): the pick the
   * turn left because the person paying could not run it. */
  turnRun?: { instanceId: string; model: string; effort?: EffortLevel; requested?: { instanceId: string; model: string } };
  /** Server-proven originating user message, including supported harness
   * continuations. Absent means external clients must not infer ownership. */
  requestMessageId?: string;
  /** Provider completion outcome, independent of whether it emitted text. */
  turnSucceeded?: boolean;
  /** A dropped worker, or a person or bot removed during the turn.
   * This is not an approval. */
  status?: "failed";
  /** An exact request was stopped; a restart must not revive an old result. */
  requestCancelled?: boolean;
  /** Set before execution and cleared only after the request's verified
   * final turn and dependencies settle. A restart never clears it. */
  requestPending?: boolean;
  /** The last assistant text item from a settled provider turn. */
  turnTerminal?: boolean;
  /** screen and video messages: the person's message of that turn asked
   * for this view (shared/requested-views.ts). A client draws a screen or a
   * video row only with it; rows from before 2026-10-20 have none. */
  requested?: boolean;
  /** screen messages: a frame of the bot's computer (base64 image) */
  png?: string;
  mime?: string;
  /** Inline live or recorded video (shared/video-widget.ts). */
  video?: WireVideoWidget;
  at: number;
  /** the message this one follows; null = thread root. */
  parentId?: string | null;
  /** Optional flat reply reference for an inline quote. */
  replyToId?: string;
  /** Stable client identity for at-most-once chat POST retries. */
  sendId?: string;
  /** Per-send channel behavior. Absent is legacy quick chat. */
  channelMode?: "chat" | "goal";
  /** A user message said on a voice call (src/components/voice-mode/LiveCall.tsx):
   * which call, whether the person cut the bot's previous answer to say it,
   * and the call's language when one is set. The turn it starts gets the
   * hidden phone-call instruction (server/voice-call-prompt.ts). */
  voiceCall?: VoiceCallMark;
  /** group threads: which member said this (sender attribution). */
  from?: { botId: string; name: string; color: string };
  /** Set on a room message a bot pushed in with post_to_room. */
  peerPost?: { unattended?: boolean };
  /** A room reply whose speaker the decision model picked (an Auto room),
   * with how sure it was. Absent on every other message; clients that do
   * not know it ignore it. */
  routedBy?: { provider: "jev"; probability: number };
  /** Set on the user-role line another bot delivered into this bot's own
   * conversation (ask_bot, start_thread). `incident`: the line is
   * Sagax's Team incidents report about that bot's broken run in
   * `threadId` (server/incidents.ts), not its words; `notified`: that
   * failure already buzzed the person (a run that could not start, a
   * failed routine). */
  peerAsk?: { botId: string; name: string; unattended?: boolean; incident?: { threadId: string; notified?: boolean } };
  /** #291: a user-role line a person's AI client sent through the agent API
   * (send_prompt, sagax_send) into this bot's chat: not the person typing.
   * The chat folds it with the bot's answer into one exchange chip. */
  aiClient?: true;
  /** Auto: the model this delivered work ran on, and why (the delegation
   * card and the worker's activity row). Clients that do not know it ignore it. */
  autoModel?: AutoModelRecord;
  /** Emoji reactions, one entry per emoji with who put it there
   * (shared/reactions.ts). Older stores may still hold `{ emoji, by }`
   * entries; read them through normalizeReactions. */
  reactions?: MessageReaction[];
  /** comm chips: "Messaged @X", linking to the bot-bot channel. */
  /** `gone` is stamped at read time when the channel thread no longer exists. */
  comm?: Comm;
  /** thread chips: "Opened thread #Title on @X". */
  /** `gone` is stamped at read time when the target thread no longer exists. */
  threadRef?: { botId: string; threadId: string; title: string; gone?: boolean };
  /** A teammate parked on a question for the person (server park/remind,
   * 2026-10-19): the whole question, answered from the card in place (the
   * answer is a person's message into `threadId`, the waiting work). */
  inputRequest?: { botId: string; threadId: string; botName: string; title?: string; question: string; reminder?: boolean; answered?: boolean };
  /** A bot's page proposal (shared/published-pages.ts): the card the person
   * reviews and publishes it from. `text` is the fallback line. */
  pagePublish?: { pageId: string; version: number; title: string };
  /** An outward action that costs money or reaches a real person, on its
   * approval card (parité the reference design V4, 59, 83): a phone call
   * (server/outbound-calls.ts) or a purchase (server/credential-vault.ts).
   * `text` is the fallback line. */
  outbound?: OutboundCard;
  /** A published Data result, linked to its bot's main viewer. */
  dataResult?: { botId: string; cardId: string; title: string; kind: "table" | "chart" | "text"; sql?: string };
  /** user messages: the Data result, or the page (`page`, 2026-10-28: the
   * app draws it as a chip over the words), the person was viewing when they sent
   * this (shared/data-context.ts). Its own field, so `text` stays exactly
   * what they typed; the server puts the hint in front of the text it
   * sends the model for this turn and for every retry of it. */
  dataContext?: { cardId?: string; draftSql?: string; page?: { pageId: string; title: string; version?: number } };
  /** user messages waiting in the steer-queue while the bot is mid-turn. */
  queued?: boolean;
  /** A parallel task this line belongs to (shared/parallel-tasks.ts): the
   * person's request, its live card, or its result. */
  parallelTask?: ParallelTaskRef;
  /** steer-queue entry this drained user line came from. */
  queueId?: string;
  /** In-chat terminal opened on a shell-capable resource. */
  terminalEmbed?: TerminalEmbed;
  /** A Tailcat remote-support session. The tunnel address is never on this object. */
  remoteSession?: RemoteSessionView;
  /** A live usage card (shared/resource-usage.ts), shown only when asked. Labels only. */
  resourceUsage?: ResourceUsageView;
  /** "Connect Microsoft Teams" (shared/connector-setup.ts): a sign-in page on
   * grok.com or claude.ai, opened by the person. The row's text is its fallback. */
  connectorSetup?: ConnectorSetupView;
}

const threadStamp = (task: { updatedAt?: number; createdAt?: number }): number =>
  typeof task.updatedAt === "number" && Number.isFinite(task.updatedAt) ? task.updatedAt
    : typeof task.createdAt === "number" && Number.isFinite(task.createdAt) ? task.createdAt : 0;

/** Pin, then newest update. Equal stamps keep the caller's order. */
export function orderedThreadList<T extends { pinned?: boolean; updatedAt?: number; createdAt?: number }>(tasks: readonly T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const pin = Number(b.task.pinned === true) - Number(a.task.pinned === true);
      if (pin) return pin;
      const recency = threadStamp(b.task) - threadStamp(a.task);
      if (recency) return recency;
      return a.index - b.index;
    })
    .map((entry) => entry.task);
}

/** 0 is the "until new activity" sentinel. The event stream never drops an expired snooze, so check the clock too. */
export const isSnoozed = (task: Pick<WireTask, "snoozedUntil">, now = Date.now()): boolean =>
  task.snoozedUntil !== undefined && (task.snoozedUntil === 0 || task.snoozedUntil > now);

type OpenThreadCandidate = Pick<WireTask, "routineRunId" | "archivedAt" | "closedBy" | "openedBy" | "snoozedUntil" | "pinned" | "updatedAt" | "createdAt">;

/** The top row of the bot's thread list, so deleting the open thread never pulls a hidden one into view. */
export function nextOpenThread<T extends OpenThreadCandidate>(tasks: readonly T[], now = Date.now()): T | undefined {
  const own = tasks.filter((task) => !task.routineRunId);
  const open = own.filter((task) => task.archivedAt === undefined);
  const listed = open.filter((task) => task.pinned === true || !(task.closedBy || task.openedBy || isSnoozed(task, now)));
  return [listed, open, own].map((candidates) => orderedThreadList(candidates)[0]).find((task) => task !== undefined);
}

export interface OptionCardData {
  /** calls: one per outbound call the card covers, in subtitle order. Absent
   * on cards from older computers. */
  outboundRequest?: { tool: string; app: string | null; calls?: Array<{ app: string | null; label: string }> };
  teamMemoryRequest?: { section: string; entryId: string; kind: string };
  /** 2026-10-30: a proactive proposal (server/proactive-wake.ts): the bot
   * offers to handle an event; the person's click answers it through
   * POST /api/bots/:id/proactive/:id (options[0] accepts, options[1]
   * declines), never as a typed message. */
  proactiveProposal?: { id: string };
  title: string;
  subtitle: string;
  options: string[];
  /** Distinguishes a provider question from an approval after its live run ends. */
  requestType?: "permission" | "question";
  answered?: string;
  /** What was actually answered, when the answer is words rather than a
   * verdict. */
  answeredText?: string;
  dismissed?: boolean;
  /** Who settled the card, when a person or service answered it. */
  answeredBy?: CardAnswerer;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  /** permission cards: the tool being requested. */
  tool?: string;
  /** why this card is waiting: guard, mode, sandbox or delivery error. */
  held?: string;
  /** Terminal: this proposal went stale while open (revision mismatch or
   * a superseding request). Nothing can answer it; a fresh proposal is
   * needed, and clients must not offer its options. */
  expired?: boolean;
  /** Catalog key for held when it is one of the fixed notes. */
  heldCode?: string;
  /** A permission card in plain words, made by shared/approval-describe.ts
   * (the same generator writes the push): "Allow Nova to run a
   * command?" and one line under it. Clients without a catalog show these. */
  plain?: {
    title: string;
    line: string;
    risk?: "read" | "write" | "destructive" | "execute";
    /** The verb phrase after "wants to", in `locale` (phones word their
     * own heading with it when it is in their reader's language). */
    action?: string;
    /** The language these words are in: the answering person's (#1089). */
    locale?: string;
  };
  /** The engine's own `<server>__<tool>` name when `tool` is a kind (ACP
   * "other") or a bare name. */
  mcpTool?: string;
  /** When nobody answers by then, the server declines it and marks it
   * expired (an AI client's hidden conversation, server/index.ts). */
  expiresAt?: number;
  /** the narrow grant "always allow" remembers for a harness-native card. */
  allowKey?: string;
  /** 2026-10-14 (bot owner permissions): the rule "Always allow" or
   * "Always deny" would save for the bot's owner: the tool, its target
   * read from the arguments, the destructive kind and plain words. */
  ownerRule?: {
    tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string;
    /** 2026-10-19 ("Toujours permettre" on every card): the card's
     * situation the rule also answers (server/owner-approval.ts `from`):
     * an admin's card, a held card, a turn that is not the person's own. */
    from?: "admin" | "hold" | "origin";
  };
  /** 2026-10-26 (#1065): the second choice of "Toujours permettre", every
   * file of the folder of the one this card reads (and its subfolders).
   * An ordinary card names the file's folder. An admin card names one
   * agent root for a read (`from: "admin"`). */
  ownerRuleFolder?: { tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string; /** the folder rule covers changing files (write, delete), not only reading */ writes?: boolean; /** set when this folder rule answers an admin card */ from?: "admin" | "hold" | "origin" };
  /** 2026-10-28: the person's own "Ask first" rule that kept this card
   * (whatever the approval level), in its own words, so the waiting line
   * names it. An organization's or a custom rule rides `customRule`. */
  heldRule?: { description: string };
  /** The owner's rule saved when answering this card. */
  ruleSaved?: { id: string; behavior: "allow" | "ask" | "deny"; description: string };
  /** the Allow rule (an allowKey) the person saved when answering this card:
   * the pill reads Always allowed and the card shows the rule + Edit rule. */
  alwaysAllowed?: string;
  /** the provider can remember an allow for the rest of its session. */
  allowSession?: boolean;
  /** A permission ask's full arguments as redacted JSON, shown only in
   * the card's collapsed technical details. */
  toolInput?: string;
  /** MCP tool annotations, when the provider passes them on, and the
   * product the server declared for the tool (its name, and the id its
   * tool names start with). */
  toolHints?: { readOnly?: boolean; destructive?: boolean; product?: string; productId?: string };
  /** Exact native command offered for an owner/admin to remember. */
  commandAllowlist?: CommandAllowlistCandidate;
  /** Local actions never share remembered grants with cloud/tool approvals. */
  approvalScope?: "local-computer";
  /** Organization server (slice 3): a command on the server asked by a bot
   * whose owner is not an organization admin. Only an admin answers it; the
   * owner sees it waiting for an admin. Never remembered. */
  adminApproval?: boolean;
  /** 2026-10-19: a server-level card of a bot whose owner holds
   * host.commands, answered by that owner by hand; the right is checked
   * again when the card is answered. */
  serverCommandHolder?: boolean;
  /** 2026-10-27 (#1098): the call runs in the bot owner's own isolated
   * environment (their sandbox: their cloud computer, their Local VM),
   * mounted for this turn. Its standing grants (session allow, saved
   * command, Always allow) are the person's own, whatever the
   * organization's "Toujours permettre" switch says. */
  ownSandbox?: boolean;
  /** 2026-10-19 (PR 3): the person whose own destination (cloud computer,
   * Local VM, own computer) this call acts on, when that is not the bot's
   * owner: the speaker in their own conversation with a shared bot. They
   * answer it, never an admin and never the bot's owner. */
  destinationAnswerer?: string;
  /** The organization admins who can answer an adminApproval card (at most
   * five names), so the member's waiting line can say who. */
  adminNames?: string[];
  /** The bot's change applied without a person (a change to the bot itself,
   * or Full access): clients show a one-line receipt with Undo instead of
   * the approval box. */
  autoApplied?: boolean;
  /** A person undid that change. */
  undone?: boolean;
  /** A durable chat-created routine proposal. */
  routineRequest?: RoutineRequestCardData;
  /** A durable profile-change proposal (propose_profile). */
  profileRequest?: ProfileRequestCardData;
  /** A durable default-model proposal (propose_model). */
  modelRequest?: ModelRequestCardData;
  teamSetupRequest?: TeamSetupRequest;
  /** A durable learned-skill proposal. */
  skillRequest?: SkillRequestCardData;
  /** A provider's structured question set. */
  questionRequest?: QuestionRequestCardData;
  /** A bot action waiting for this person's Allow. The id matches requestId.
   * The card stores no body and no query. */
  botActRequest?: { id: string };
  /** A confidential thread's write to its owner's own memory, waiting for
   * their Allow (server/confidential-threads.ts). The id matches requestId. */
  confidentialMemoryRequest?: { id: string };
  /** Interactive shell on a terminal-capable resource (approval required). */
  terminalRequest?: TerminalRequestCardData;
  /** A meeting the bot asks to join as a notetaker (join_meeting): the
   * consent card, then the live meeting's state. Never auto-applied. */
  meetingRequest?: MeetingRequestCardData;
  /** A change asked from a ConnectWise widget, waiting for an Allow
   * (server/cw-widget-actions.ts). `by` is the principal who asked. */
  cwActionRequest?: { id: string; action: CwAction; by: string };
  /** 2026-10-16: the person's custom rule behind this card (an ask rule
   * held it, or an allow rule matched without covering its risk class),
   * shown as the rule notice with a link to edit it. */
  customRule?: CustomRuleNotice;
  /** "Toujours permettre ceci": the rule text this card offers to save. */
  customRuleCandidate?: CustomRuleCandidate;
  /** The custom rule the person saved from this card. */
  customRuleSaved?: { id: string; when: string };
  /** 2026-10-21 (lot A1b): the model reviewer is still judging this card.
   * The notification waits. Cleared when the verdict lands or the card stays. */
  reviewing?: boolean;
  /** An email draft waiting for its Send approval
   * (server/email-draft-send.ts). Status follows the send. */
  emailSendRequest?: EmailSendRequestCard;
}

/** Which app holds the microphone of a Live call: the desktop app (its own
 * page or a server's page in it), a web browser, or a phone. Self-declared;
 * for display and logs only. The phone apps show a value they do not know as
 * "another device". */
export type LiveClient = "desktop" | "web" | "ios" | "android";
export type LiveCallStatus = "connecting" | "live" | "ending" | "ended";
/** Why a call ended. "signed-out": the sign-in or paired phone that started
 * it was signed out, revoked or unpaired. A client that does not know a
 * reason shows the call's `error` text, or plain "Call ended.". */
export type LiveEndReason =
  | "hung-up" | "idle" | "expired" | "content" | "remote-hangup" | "connection-lost"
  | "sideband-lost" | "deleted" | "shutdown" | "signed-out" | "error";

/** The one Live call a harness runs. Never carries the key or any speech. */
export interface LiveCallState {
  callId: string;
  botId: string;
  threadId: string;
  client: LiveClient;
  voice: string;
  /** epoch ms when the session was created */
  startedAt: number;
  status: LiveCallStatus;
  endReason?: LiveEndReason;
  /** short, user-facing; present when the call ended on a problem */
  error?: string;
}

/** One finished Live call, written once when a call that went live ends. Never carries speech. */
export interface LiveCallRecord {
  callId: string;
  botId: string;
  client: LiveClient;
  /** epoch ms, = LiveCallState.startedAt */
  startedAt: number;
  /** epoch ms when the call ended */
  endedAt: number;
  /** whole seconds: OpenAI usage seconds when given, else wall clock */
  seconds: number;
  endReason: LiveEndReason;
  /** only when LLM thread titles are on and the engine can generateText */
  title?: string;
}

/** Non-secret Live settings, as GET /api/config and PATCH /api/live/settings report them. */
export interface LiveSettings {
  /** Live calls are off in Sagax unless the server runs with SAGAX_LIVE_CALLS=1
   * (our own voice call engine is the call path); off, every /api/live route
   * answers 404 and no OpenAI session can start. */
  enabled: boolean;
  /** The OpenAI provider has a key. */
  configured: boolean;
  voice: string;
  readTypedReplies: boolean;
  idleMinutes: number;
}

export interface SecretRequestCardData {
  /** Fixed allowlisted credential id; never an arbitrary config path.
   * vaultLogin: a bot asks to use a login from the credential vault
   * (shared/credential-vault.ts); the card carries `vault` and no field. */
  target: CredentialTargetId | VaultLoginTarget;
  label: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  requestKey: string;
  phoneOperationId?: string;
  provided?: boolean;
  dismissed?: boolean;
  /** A newer request for the same credential replaced this card; it no
   * longer offers entry and cannot be provided or dismissed. */
  superseded?: boolean;
  resumed?: boolean;
  error?: string;
  /** target vaultLogin only: what the bot asked for and what the person chose. */
  vault?: VaultRequestCardData;
}

/** Who answers a room message nobody was @mentioned in. `auto` asks the
 * decision model (server/decider/room-routing.ts) and falls back to
 * `fallbackBotId` (else the first member) whenever it is off or unsure.
 * Readers must treat any kind they do not know as the default lead. */
export type GroupDefaultResponder =
  | { kind: "member"; botId: string }
  | { kind: "everyone" }
  | { kind: "mentions" }
  | { kind: "auto"; fallbackBotId?: string };

/** One independent conversation inside a user-created channel. */
export interface GroupTask {
  threadId: string;
  title: string;
  createdAt: number;
  pinnedCwd?: string | null;
  pinnedMessageId?: string;
  /** The person pinned this channel thread above the update-ordered list. */
  pinned?: boolean;
  /** This conversation's own turn ceiling, in whole minutes. Absent uses
   * the global group turn limit. Direct chats do not use this ceiling. */
  turnTimeoutMinutes?: number;
  /** Epoch ms of the newest message, or createdAt when the thread has none. */
  updatedAt?: number;
  /** The first message already drove a title attempt for this thread, so a
   * later one does not rename a room the person may have retitled. */
  titleFromFirstMessage?: true;
  /** When this thread was archived. Absent = unarchived. Same contract as
   * WireTask.archivedAt; a person conversation's threads use it. */
  archivedAt?: number;
  /** Same contract as WireTask.snoozedUntil: 0 = until new activity (the
   * store clears it on the next message), a future epoch ms = until then. */
  snoozedUntil?: number;
  /** The folder (`WireGroup.projects`) this thread is filed under. */
  projectId?: string;
  /** A person conversation: this thread is unread for the viewer. Drawn
   * per viewer from `unreadFor` (server/people-dms.ts peopleDmForViewer). */
  unread?: boolean;
  /** A person conversation: which of its two people have not read this
   * thread yet (principal ids). Server-side; a client never gets it. */
  unreadFor?: string[];
  /** A person conversation: the thread that was the whole conversation
   * before threads existed (titled "General" by the migration). Clients may
   * show the title localized while it is still "General". */
  general?: true;
  /** Whether a turn is actively running in this thread. */
  working?: boolean;
  /** The member bot currently speaking or generating in this thread, if any. */
  busyBotId?: string | null;
  /** Same numbers as WireTask.turnTiming, for this channel thread. */
  turnTiming?: { queueMs?: number; firstResponseMs?: number };
}

/** A room as a client may see it: the record plus the computed working
 * flag (publicGroupState). */
export interface WireGroup {
  /** Computed from the usage ledger, not stored in groups.json. */
  usage?: GroupThreadUsage | null;
  id: string;
  /** The active task's thread. Direct-message channels stay single-threaded. */
  threadId: string;
  /** User-created channels have independent tasks, newest first. */
  tasks?: GroupTask[];
  /** Folders that organize this conversation's threads (a person
   * conversation's, shared by its two people), in sidebar order. Same shape
   * as a bot's `projects`. */
  projects?: BotProject[];
  name: string;
  memberIds: string[];
  /** People in this channel, beside the bots. Absent on a bot-to-bot dm. */
  humanIds?: string[];
  defaultResponder: GroupDefaultResponder;
  /** The room's shared instructions. */
  bulletin: string;
  unread: boolean;
  /** Kept in the home's pinned row (the phone's, like a bot's `pinned`). */
  pinned?: boolean;
  /** The newest message on screen the last time the person read this
   * conversation. The New divider goes after it. */
  lastReadMessageId?: string;
  createdAt: number;
  /** Organization server: the principal who created the room. A bot's
   * follow-up no person asked for runs in this person's server environment
   * (server/user-sandbox-routing.ts). Absent on older rooms. */
  createdBy?: string;
  /** Organization server: who owns the room's settings (its creator, else
   * the first person listed; null when its organization admins do). Only
   * The owner changes them (server/group-ownership.ts). Absent on a solo
   * server. */
  ownerId?: string | null;
  /** true for auto-created bot-bot channels. */
  dm?: boolean;
  /** Organization server: a direct conversation between two people
   * (`humanIds`), with no bot (server/people-dms.ts). Only those two read it. */
  peopleDm?: boolean;
  /** A conversation between two people: which of the two have not read it
   * yet (principal ids). Each person's own `unread` is drawn from it, so
   * the sender reading it never clears it for the recipient. A room: the
   * people tagged with @ who have not read it yet (server/room-mentions.ts).
   * Server-side; a client never gets it (server/people-dms.ts
   * peopleDmForViewer). */
  unreadFor?: string[];
  /** A room: @all tags every person in it (a notification each). Absent:
   * off, @all tags nobody. Its owner's setting. */
  mentionAll?: boolean;
  /** The group's shared memory (server/group-memory.ts); absent = on. */
  memoryEnabled?: boolean;
  /** #1137, organization server: per bot of this group, who pays for its
   * replies here, overriding the bot's own choice (shared/turn-payer.ts).
   * Each bot's owner sets it for their bot. */
  botPayers?: Record<string, "owner" | "speaker">;
  /** transient: the member currently running a turn. */
  busyBotId?: string | null;
  /** transient: when the busy member's turn started, for the elapsed
   * readout — the group-side twin of a task's turnStartedAt, stamped on
   * every transition into a busy speaker (never persisted) */
  turnStartedAt?: number;
  /** A direct conversation has no task row. Its turn numbers live here. */
  turnTiming?: { queueMs?: number; firstResponseMs?: number };
  /** the room's shared desk; absent = each member's own default. */
  cwd?: string;
  /** Compatibility mirror of the active task's pinned folder. */
  pinnedCwd?: string | null;
  /** Compatibility mirror of the active task's pinned message. */
  pinnedMessageId?: string;
  /** sidebar section heading this room is filed under. */
  section?: string;
  /** Set at creation: rooms have no pending setup step any more. */
  setupCompletedAt?: number | null;
  setupSkippedAt?: number | null;
  /** The narrowest audience this room has ever had (see
   * server/bot-visibility.ts): a bot leaving never widens who may see the
   * transcript. Sent to admins only. */
  audienceFloor?: BotVisibility;
  /** True while any member (or hand-off) is mid-turn. Computed at
   * projection time, never persisted. */
  working: boolean;
  /** Each bot in the room as every person in it sees it (name, label,
   * look), whoever owns it: never its settings or other threads. Computed
   * at projection time (shared/bot-public-profile.ts). */
  memberProfiles?: BotPublicProfile[];
  /** A direct-message channel's turn ceiling. Null on the wire means the
   * global group limit. Channel conversations store theirs on each task. */
  turnTimeoutMinutes?: number | null;
}

// ── live wire frames ───────────────────────────────────────────────────
// Derived from the client's frame switch (src/state/store.tsx handleFrame)
// cross-checked against every server broadcast site: one member per kind
// the app consumes, payload typed by the shape that actually goes over the
// wire. Transport-owned frames (hello, ping) stay in src/lib/live-events.

/** Why a steer-queue entry waits: a shared thread slot, or the bot's room
 * turn (which runs one at a time per bot). */
export type SteerQueueReason = "capacity" | "group-turn";

/** Pending steer-queue chips, as `queuedSteerSnapshot` emits them and the
 * `bot.queued` frame carries them: threadId → queued items. */
export type BotQueuedMessages = Record<string, Array<{ queueId: string; text: string; reason?: SteerQueueReason }>>;

/** Skills library (features.skillsLibrary) browse surface: one row per
 * library entry, with the bots currently assigned to it. Version comes
 * from the org package stamp when one exists; locally imported skills
 * carry null. */
export interface SkillsLibrarySkillWire {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  tags: string[];
  version: string | null;
  importedAt: string;
  license?: string;
  compatibility?: string;
  warnings: string[];
  assignedBots: Array<{ id: string; name: string }>;
}

/** PUT body for a bot's assignment list: the full list, applied
 * idempotently. */
export interface BotAssignedSkillsWire {
  skills: string[];
}

/** One participant's read position on a thread: the newest message they
 * have seen, and when (server/read-receipts.ts). */
export interface ThreadReadPosition {
  messageId: string;
  at: number;
}

/** GET /api/threads/<id>/read: the positions this viewer may see, keyed by
 * participant id, and which participant is the viewer (null: nobody). */
export interface ThreadReadsResponse {
  reads: Record<string, ThreadReadPosition>;
  self: string | null;
}

export type ServerFrame =
  | { kind: "sections"; sections: string[] }
  | { kind: "bot.queued"; queues: BotQueuedMessages }
  | { kind: "message"; threadId: string; message: WireMessage }
  | { kind: "message.patch"; threadId: string; message: WireMessage }
  | { kind: "thread"; threadId: string; activeLeafId: string }
  /** A read position moved (server/read-receipts.ts): `participantId` is a
   * person's principal id or `bot:<botId>`. `reset` alone (no participant)
   * means someone's read receipt choice changed: fetch the positions again. */
  | { kind: "thread.read"; threadId: string; participantId?: string; read?: ThreadReadPosition; reset?: true }
  | { kind: "bot"; bot: WireBot }
  | { kind: "group"; group: WireGroup }
  | { kind: "notify"; notification: Notification }
  /** An approval was answered or expired: take its notification down. */
  | { kind: "notify-withdraw"; threadId: string; requestId: string }
  | { kind: "group.deleted"; groupId: string }
  /** #1480: the viewer left this group; only their own streams get it
   * (server/group-leave.ts). `roomId`, not `groupId`: the group's own frame
   * filters would drop it, since they no longer see the group. */
  | { kind: "group.left"; roomId: string; audience: string }
  | { kind: "routine"; routine: Routine }
  | { kind: "routine.deleted"; routineId: string }
  /** 2026-10-28: a bot's routine folders in their order (shared/routine-folders.ts). */
  | { kind: "routine.folders"; botId: string; folders: string[] }
  | { kind: "routine.run"; run: RoutineRun }
  /** A cloud coding agent record changed (server/cloud-agents/manager.ts). */
  | { kind: "cloud.agent"; botId: string; item: CloudAgentWireItem }
  /** A bot's artifacts changed (server/artifacts.ts): ids only, fetch again. */
  | ArtifactsFrame
  /** A bot's task list changed (server/bot-task-list.ts): ids only, fetch again. */
  | BotTasksFrame
  | { kind: "webhook"; webhook: WebhookTrigger }
  | { kind: "webhook.attempt"; attempt: WebhookAttempt }
  | { kind: "webhook.deleted"; webhookId: string }
  | { kind: "runtime"; event: RuntimeEvent }
  | { kind: "screen"; botId: string; threadId: string; png: string; mime?: string }
  /** A bot's computer is being set up or woken for a turn; the chat shows
   * one progress line until its first screen frame. `place` names a cloud
   * computer (absent: a Local VM). */
  | { kind: "computer"; botId: string; state: "provisioning" | "waking" | "ready"; place?: "cloud" }
  | { kind: "computer-control"; botId: string; held: boolean; helpReason: string | null }
  /** A bot's data sheet changed (a card added, updated, failed, removed; a
   * table loaded). Whole sheet each time: see shared/data-surface.ts. */
  | DataBroadcast
  | { kind: "bot.deleted"; botId: string }
  /** A person's own unlocks (server/achievements.ts), to their streams only. */
  | { kind: "achievements"; audience: string; unlocked: Array<{ id: string; points: number; unlockedAt: number }> }
  /** A person's preferences after a save on any of their devices
   * (server/user-preferences.ts), to that person's streams only. */
  | { kind: "preferences"; audience: string; preferences: Record<string, string>; updatedAt: number | null }
  /** A screen or button for one person's open desktop app. iOS and Android ignore this kind. */
  | { kind: "bot-act"; audience: string; action: string; input?: Record<string, unknown> }
  /** #1545: a bot reads or changes a setting kept on this person's device;
   * their open apps fetch /api/me/device-settings/requests (no data here). */
  | { kind: "device-settings"; audience: string }
  /** Shake this person's desktop window. Their streams only (server/nudge.ts). */
  | { kind: "nudge"; audience: string; id?: string; fromId: string; fromName: string; at: number; open?: { groupId: string; threadId: string } }
  /** The nudge this person just sent, to their own streams only, so each of
   * their windows shakes and rings too. `id` matches the POST answer: the
   * window that clicked has already played it. */
  | { kind: "nudge.sent"; audience: string; id: string; toId: string; toName: string; at: number; open?: { groupId: string; threadId: string } }
  /** A person's custom label changed (server/routes/person-labels.ts); null
   * cleared it. Every stream. */
  | { kind: "person.label"; principalId: string; label: string | null }
  /** A person changed their own photo from Sagax (server/routes/me-avatar.ts):
   * the new versioned URL, null once removed. Every stream. */
  | { kind: "person.avatar"; principalId: string; avatarUrl: string | null }
  /** Organization server (2026-10-08), admins' streams only: how many
   * approvals wait for an organization admin, and the ones that just arrived. */
  | { kind: "org.approvals"; count: number; added: Array<{ requestId: string; botName: string; ownerName?: string; requestedBy?: string; tool?: string; summary?: string }> }
  /** People whose presence changed (shared/presence.ts). The organization's
   * people only; with `audience`, that person's own real state (`hidden`
   * when others see them offline), to their streams only. */
  | { kind: "presence.changed"; audience?: string; people: Array<{ principalId: string; state: "online" | "away" | "offline"; lastSeenAt: number | null; hidden?: true }> }
  | { kind: "live.call"; botId: string; threadId: string; call: LiveCallState | null }
  /** A short first sentence spoken ahead of the bot's own reply on a duplex
   * call (server/voice-first-sentence.ts). The speaker's streams only. Not
   * stored. iOS ignores the kind. */
  | { kind: "voice.opener"; audience: string; threadId: string; callId: string; utteranceId: string; text: string }
  /** The live phone call ended. The speaker's streams only. `by` is who
   * hung up. Not stored. The page stops the microphone and, when the bot
   * hung up, lets the goodbye finish before it leaves the call. */
  | { kind: "voice.call.ended"; audience: string; threadId: string; callId: string; by: "person" | "bot" }
  /** The config status object spread flat into the frame; its full typing
   * is the deferred client-model extraction (see j1-phase-bc-progress). */
  | ({ kind: "config" } & Record<string, unknown>);

/** One line of what a purchase buys: an article, or a flight. */
export interface PurchaseLine {
  name: string;
  quantity?: number;
  /** "12.50", the line's own price when the page shows one. */
  price?: string;
}

export interface PurchaseFlight {
  from: string;
  to: string;
  /** YYYY-MM-DD */
  date: string;
  flight?: string;
  passenger?: string;
}

/** How a conversation call ended (OutboundCard.result). Lives on the
 * conversation's message, so it is sealed with the person's content key
 * like the rest of their conversation; the transcript is dropped 30 days
 * after the call (`transcriptExpired`), the summary stays. */
export interface OutboundCallResult {
  outcome: "completed" | "voicemail" | "no-answer" | "busy" | "failed";
  /** Why a call that was answered ended. */
  endedBy?: "goal" | "callee" | "stop-request" | "time-limit" | "hang-up";
  /** The callee asked not to be called again: the bot never calls this
   * number again for the person. */
  doNotCallAgain?: boolean;
  /** Whole seconds of conversation (0 when nobody answered). */
  durationSec: number;
  /** Three to five points (fewer for a short call). */
  points: string[];
  /** Commitments or next steps, possibly none. */
  commitments: string[];
  transcript?: OutboundTranscriptLine[];
  /** The transcript was cut to its first part. */
  truncated?: boolean;
  /** The transcript passed its 30 days and was dropped. */
  transcriptExpired?: boolean;
  /** epoch ms */
  endedAt: number;
}

export interface OutboundTranscriptLine {
  speaker: "bot" | "callee";
  text: string;
}

/** The card of an outward action (WireMessage.outbound). Never a card
 * number, never a security code, never an id in its words. */
export interface OutboundCard {
  kind: "call" | "purchase";
  /** The record the answer goes to: call_... or pay_... (never shown). */
  id: string;
  status: "pending" | "approved" | "denied" | "done" | "failed";
  botName: string;
  /** A call: the full number (the person's own card), the line it comes
   * from, why, the exact words, the language. */
  destination?: string;
  from?: string;
  /** The callback number the call says (the organization's). */
  callback?: string;
  purpose?: string;
  script?: string;
  language?: "fr" | "en";
  /** A call: `conversation` when the bot talks with the person it calls
   * (place_phone_call mode conversation); absent for the one-way message. */
  mode?: "conversation";
  /** A conversation call: what the bot must obtain or say, its guidance,
   * the most it may last, and the short message it leaves on voicemail. */
  objective?: string;
  instructions?: string;
  maxMinutes?: number;
  voicemail?: string;
  /** A conversation call once it ended. Placed without a result yet: the
   * call is under way. */
  result?: OutboundCallResult;
  /** A purchase: the shop, the amount, the card's brand and last four
   * digits, what it buys, and once done, the receipt. */
  merchant?: string;
  amount?: string;
  currency?: string;
  cardLabel?: string;
  items?: PurchaseLine[];
  flights?: PurchaseFlight[];
  orderRef?: string;
  /** The receipt is what the bot declared, not read by Sagax from the page. */
  declared?: boolean;
  /** The total the shop confirmed, when it is not the approved amount. */
  mismatchTotal?: string;
  /** Who answered for the person (their Primary Bot). */
  via?: string;
  /** A purchase once ordered: where the parcel is, as the bot declared it
   * (record_purchase, update_order_tracking; shared/order-tracking.ts). */
  tracking?: OrderTracking;
  error?: string;
}
