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
import type { MeetingRequestCardData } from "./meeting-request.ts";
import type { ParallelTaskRef, TaskParallelOf } from "./parallel-tasks.ts";
import type { DataBroadcast } from "./data-surface.ts";
import type { ApprovalMode } from "./approval-mode.ts";
import type { ToolScope } from "./tool-scope.ts";
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

/** Reasoning-effort levels, ascending. A union of everything any engine
 * accepts; each driver declares the subset its CLI will take. Lives here
 * because it is part of ModelSelection, which rides the wire. */
export const EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max", "ultracode"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Narrow untrusted API/config input before it becomes a model selection. */
export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/** "Which model" is a data value carried on the request, never a service
 * binding. instanceId is the routing key. */
export interface ModelSelection {
  instanceId: string;
  model: string;
  /** Optional: no effort means no flag, and the CLI keeps its own default. */
  effort?: EffortLevel;
  /** Explicit model-specific variant. Omitted leaves the native session alone. */
  variant?: string;
  /** Auto (docs/plans/2026-10-08-auto-model.md): each turn picks its model.
   * instanceId and model stay the bot's own engine and fallback model, so a
   * path or client that does not know Auto still runs a valid model. Only
   * true is stored; picking a model in the chip clears it. */
  auto?: true;
}

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
   * result has been reported. */
  kind?: "pair" | "work";
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
  /** what filled the model's window on the last model call, and the window's size when known */
  context?: { tokens: number; window?: number };
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
  /** A hidden conversation: an AI client (the Perspicax MCP `sagax_send`,
   * the member API) works with the bot here on the person's behalf, the way
   * Grok Bot keeps its subagents' conversations out of the chat (#291). Never
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
  approvalMode?: ApprovalMode;
  autoApprove?: boolean;
  alwaysAllow?: string[];
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
  /** Prompt-cache keep-warm status for this thread (server/cache-keepwarm.ts),
   * derived at projection and never stored; absent when no window is open. */
  cacheKeepWarm?: CacheKeepWarmStatus;
  /** the folder this task's turns run in, pinned on its first turn. */
  cwd?: string | null;
}

/** One thread's keep-warm window as a client shows it. Times are epoch ms. */
export interface CacheKeepWarmStatus {
  state: "warm" | "stopped";
  until?: number;
  nextPingAt?: number;
  last?: { at: number; read: number; write: number; costUsd: number | null };
  stopped?: string;
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
export interface ConnectorToolGrant {
  tools: "*" | string[];
}

/** Lowercased Composio service slug, e.g. `gmail`. */
export const CONNECTOR_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/;
/** Composio tool names are upper-snake, e.g. `GMAIL_SEND_EMAIL`. */
export const CONNECTOR_TOOL_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

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

export interface WireBot {
  waitingForTeammates?: boolean;
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
  /** Tools this bot may always use without asking. */
  alwaysAllow?: string[];
  /** Speak this bot's replies aloud as they settle, without being asked. */
  speakReplies?: boolean;
  /** This bot's own voice id, so a room of bots doesn't sound like one person. */
  voice?: string;
  /** Whether this bot may send voice notes. Absent/true = allowed; false
   * hides the tool and refuses the route even with a voice configured. */
  voiceNotes?: boolean;
  /** Whether this bot uses native memory. Absent/true = enabled. */
  memoryEnabled?: boolean;
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
  /** Bot ids this bot is allowed to contact. */
  peers?: string[];
  /** Whether this bot may use the workspace's connected apps. */
  composio?: boolean;
  /** Which connected-app tools this bot may call, by service slug. Absent
   * defers to the legacy `composio` boolean above (unset/true = every tool,
   * false = none); an explicit `{}` grants no tools. Grants never travel in
   * shareable exports and imported bots always land with none. */
  connectorTools?: Record<string, ConnectorToolGrant>;
  connectorScopes?: { apps: Record<string, "read" | "write"> };
  outbound?: { policy: "ask" | "allow"; dailyCap: number };
  /** Ordered backups used only by opt-in, pre-prompt startup recovery. */
  fallback?: Array<{ instanceId: string; model: string }>;
  /** Per bot since 2026-10-15 (server/bot-runtime-settings.ts): its
   * conversations that may work at once (1..10). Absent: the server default. */
  maxConcurrentThreads?: number;
  /** Parallel tasks one person may have running on this bot (1..10). */
  maxParallelPerPerson?: number;
  /** What a message sent while this bot works does by default. Absent: each
   * person's own default (shared/parallel-tasks.ts BusySendPreference). */
  busySend?: "ask" | "steer" | "parallel" | "after";
  /** Automatic recovery for this bot: on, and its backup model (its
   * `fallback` chain wins when it has one). Absent: the server default. */
  automaticRecovery?: { enabled: boolean; backup?: ModelSelection };
  /** Whether this bot gets the app's built-in browser. */
  browser?: boolean;
  /** Memory upkeep: the harness captures facts from finished chats into
   * MEMORY.md and topic files, adds facts about the person to About me and
   * tidies nightly. On unless explicitly false; every change is journaled
   * and can be undone. */
  memoryUpkeep?: boolean;
  /** Prompt-cache keep-warm for this bot's Claude threads: true or false
   * overrides the workspace setting (Settings → Engines); absent follows it. */
  cacheKeepWarm?: boolean;
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
   * the member API, by the person named (lot C.3). */
  via?: "call" | "ai-client";
};

export interface WireAccessCard {
  /** `routine_delegation` (slice 6): an organization routine the server
   * paused, its person out or without `run` (`engine` is then ""). Since
   * 2026-10-08 never for lack of a delegation; an older card with a
   * delegation reason renders nothing. */
  reason: "engine_missing" | "no_access" | "key_refused" | "routine_delegation";
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
  cause?: "payer_disabled" | "no_credentials" | "server_engine_not_allowed";
  /** The bot's routine: it runs on its owner's credentials only. */
  routine?: true;
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
}

/** The header a client sends with a routine switched on or off while a
 * conversation is open: that conversation's thread id, where the server
 * writes its "Disabled · 1 routine" line (server/routine-chat-events.ts). */
export const ROUTINE_CONVERSATION_HEADER = "x-sagax-conversation";

/** WireMessage.routineToggle: the routines one turn turned on or off. */
export interface RoutineToggleEvent {
  action: "enabled" | "disabled";
  /** The user message that started the turn (the line groups by it); the
   * thread's first message id, or "", when no person spoke first. */
  turnKey: string;
  /** In the order they changed; the name as it was then. */
  routines: Array<{ id: string; name: string; botId?: string; groupId?: string; runAs?: string }>;
}

export interface WireMessage {
  roomRequest?: { id: string; phase: "request" | "result" };
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "video" | "connector" | "secret" | "signin" | "routine.run" | "goal.run" | "digest" | "compaction" | "access" | "nudge" | "call" | "widget" | "routines";
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
  connector?: ConnectorCardData;
  secret?: SecretRequestCardData;
  /** signin rows: the bot asked the person to sign in to a site themselves. */
  signIn?: SignInRequestCardData;
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
    /** error rows: the installed Claude Code is too old for the model, and
     * the UI can offer to update it in place. */
    claudeUpdate?: boolean;
    /** error rows: the place this turn could not use (shared/place-view.ts). */
    place?: PlaceRow;
    /** Provider item identity, scoped to the owning turn. */
    itemId?: string;
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
    /** 2026-10-18: the bot left an engine the organization no longer
     * offers and now runs on Auto (shared/offered-engines.ts). */
    engineMove?: OrgEngineMove;
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
   * ("api"), or a request a person spoke on a Live call ("call"). */
  via?: "api" | "call";
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
   * before it was recorded, and on rooms; no effort means the engine default. */
  turnRun?: { instanceId: string; model: string; effort?: EffortLevel };
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
   * conversation (coordinate_bots, start_thread). `incident`: the line is
   * Sagax's Team incidents report about that bot's broken run in
   * `threadId` (server/incidents.ts), not its words; `notified`: that
   * failure already buzzed the person (a run that could not start, a
   * failed routine). */
  peerAsk?: { botId: string; name: string; unattended?: boolean; incident?: { threadId: string; notified?: boolean } };
  /** Auto: the model this delivered work ran on, and why (the delegation
   * card and the worker's activity row). Clients that do not know it ignore it. */
  autoModel?: AutoModelRecord;
  /** Emoji reactions, one entry per emoji with who put it there
   * (shared/reactions.ts). Older stores may still hold `{ emoji, by }`
   * entries; read them through normalizeReactions. */
  reactions?: MessageReaction[];
  /** comm chips: "Messaged @X", linking to the bot-bot channel. */
  /** `gone` is stamped at read time when the channel thread no longer exists. */
  comm?: { groupId: string; threadId?: string; withBotId: string; withName: string; withColor: string; gone?: boolean };
  /** thread chips: "Opened thread #Title on @X". */
  /** `gone` is stamped at read time when the target thread no longer exists. */
  threadRef?: { botId: string; threadId: string; title: string; gone?: boolean };
  /** A bot's page proposal (shared/published-pages.ts): the card the person
   * reviews and publishes it from. `text` is the fallback line. */
  pagePublish?: { pageId: string; version: number; title: string };
  /** A published Data result, linked to its bot's main viewer. */
  dataResult?: { botId: string; cardId: string; title: string; kind: "table" | "chart" | "text"; sql?: string };
  /** user messages: the Data result the person was viewing when they sent
   * this (shared/data-context.ts). Its own field, so `text` stays exactly
   * what they typed; the server puts the hint in front of the text it
   * sends the model for this turn and for every retry of it. */
  dataContext?: { cardId: string; draftSql?: string };
  /** user messages waiting in the steer-queue while the bot is mid-turn. */
  queued?: boolean;
  /** A parallel task this line belongs to (shared/parallel-tasks.ts): the
   * person's request, its live card, or its result. */
  parallelTask?: ParallelTaskRef;
  /** steer-queue entry this drained user line came from. */
  queueId?: string;
  /** In-chat terminal opened on a shell-capable resource. */
  terminalEmbed?: TerminalEmbed;
}

export interface OptionCardData {
  /** calls: one per outbound call the card covers, in subtitle order. Absent
   * on cards from older computers. */
  outboundRequest?: { tool: string; app: string | null; calls?: Array<{ app: string | null; label: string }> };
  teamMemoryRequest?: { section: string; entryId: string; kind: string };
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
   * (the same generator writes the push): "Allow Cryptic to run a
   * command?" and one line under it. Clients without a catalog show these. */
  plain?: { title: string; line: string; risk?: "read" | "write" | "destructive" | "execute" };
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
  ownerRule?: { tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string };
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
  /** MCP tool annotations, when the provider passes them on. */
  toolHints?: { readOnly?: boolean; destructive?: boolean };
  /** Exact native command offered for an owner/admin to remember. */
  commandAllowlist?: CommandAllowlistCandidate;
  /** Local actions never share remembered grants with cloud/tool approvals. */
  approvalScope?: "local-computer";
  /** Organization server (slice 3): a command on the server asked by a bot
   * whose owner is not an organization admin. Only an admin answers it; the
   * owner sees it waiting for an admin. Never remembered. */
  adminApproval?: boolean;
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
  /** A key is there: the Live calls key, or the OpenAI key it falls back to. */
  configured: boolean;
  /** An older install's key saved for Live calls only, which wins over the
   * OpenAI key until it is removed. Absent otherwise. */
  separateKey?: boolean;
  voice: string;
  readTypedReplies: boolean;
  idleMinutes: number;
}

export interface ConnectorCardData {
  /** Composio toolkit slug. It is validated server-side before every action. */
  slug: string;
  label: string;
  description: string;
  status: "required" | "authorizing" | "connected" | "failed";
  /** Cards created by one agent request resume together after all connect. */
  resumeKey: string;
  /** Account alias supplied by the agent when adding a second account. */
  alias?: string;
  error?: string;
  dismissed?: boolean;
  resumed?: boolean;
  /** Stop ended the turn this card paused: it offers no action, and a
   * connection made afterwards is kept but continues nothing. */
  stopped?: boolean;
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
  /** Stop ended the turn this card paused: it offers no entry, and a key
   * saved afterwards is kept but continues nothing. */
  stopped?: boolean;
}

/** A bot asked the person to sign in to a website themselves
 * (shared/sign-in-request.ts): they type the password into the page, in the
 * place the bot works. The bot never sees the password. A login kept in the
 * person's credential vault goes through request_login instead. */
export interface SignInRequestCardData {
  /** The page to open, an http(s) address. */
  url: string;
  /** Its host, the card's headline. */
  site: string;
  /** The bot's own words: why it needs the sign-in. */
  reason?: string;
  /** Where the login has to happen: the place the asking turn worked in. */
  place: Surface;
  done?: boolean;
  cancelled?: boolean;
  /** A newer request for the same site in this conversation replaced this
   * card; it no longer offers Done or Cancel. */
  superseded?: boolean;
  resumed?: boolean;
  error?: string;
  /** Stop ended the turn this card paused: it offers no Done or Cancel,
   * and an answer given afterwards is kept but continues nothing. */
  stopped?: boolean;
}

/** The open sign-in request a bot's computer plea stands for, so whichever
 * panel shows the plea can settle that card. */
export interface ComputerHelpRef {
  /** The asking bot: a team computer's plea reaches every member's panel. */
  botId: string;
  threadId: string;
  messageId: string;
  site: string;
  place: Surface;
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
}

/** A room as a client may see it: the record plus the computed working
 * flag (publicGroupState). */
export interface WireGroup {
  /** Computed from the usage ledger, not stored in groups.json. */
  usage?: GroupThreadUsage | null;
  /** transient: each member's context in the active thread, from its last
   * turn there (server/room-context.ts), and whether its next turn there
   * was asked to start compacted. Absent until a member reports one. */
  memberContext?: Record<string, { tokens: number; window: number; compactRequested?: true }> | null;
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
   * the owner changes them (server/group-ownership.ts). Absent on a solo
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
  /** transient: the member currently running a turn. */
  busyBotId?: string | null;
  /** transient: when the busy member's turn started, for the elapsed
   * readout — the group-side twin of a task's turnStartedAt, stamped on
   * every transition into a busy speaker (never persisted) */
  turnStartedAt?: number;
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
  /** Members the person stopped in this room ("stop @Bot"), by bot id.
   * A held member gets no turn until it is @mentioned again or resumed.
   * Room-wide, persisted (server/room-holds.ts). */
  holds?: Record<string, RoomHold>;
  /** Room messages addressed to a member while it was held, by bot id;
   * its next turn is shown them, then they are cleared. */
  heldMessages?: Record<string, RoomHeldMessage[]>;
}

/** One member's hold in a room: when the person stopped it, and whether the
 * room has already said so (the held line is written once per hold). */
export interface RoomHold {
  at: number;
  noted?: boolean;
}

/** A room message that reached a member while it was held. */
export interface RoomHeldMessage {
  threadId: string;
  messageId: string;
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
  | { kind: "routine"; routine: Routine }
  | { kind: "routine.deleted"; routineId: string }
  | { kind: "routine.run"; run: RoutineRun }
  /** A cloud coding agent record changed (server/cloud-agents/manager.ts). */
  | { kind: "cloud.agent"; botId: string; item: CloudAgentWireItem }
  /** A bot's artifacts changed (server/artifacts.ts): ids only, fetch again. */
  | ArtifactsFrame
  | { kind: "webhook"; webhook: WebhookTrigger }
  | { kind: "webhook.attempt"; attempt: WebhookAttempt }
  | { kind: "webhook.deleted"; webhookId: string }
  | { kind: "runtime"; event: RuntimeEvent }
  | { kind: "screen"; botId: string; threadId: string; png: string; mime?: string }
  /** A bot's computer is being set up or woken for a turn; the chat shows
   * one progress line until its first screen frame. `place` names a cloud
   * computer (absent: a Local VM). */
  | { kind: "computer"; botId: string; state: "provisioning" | "waking" | "ready"; place?: "cloud" }
  | { kind: "computer-control"; botId: string; held: boolean; helpReason: string | null; help?: ComputerHelpRef | null }
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
