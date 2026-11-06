// Shared types and limits for the internal room routes (#1383).
// Handlers import this file and never server/index.ts, so the factory does not cycle.
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { BotCreationRefusal } from "../bots/bot-creation.ts";
import type { GlobalRuntimeSettings } from "../bots/bot-runtime-settings.ts";
import type { HandoffView } from "../coordinator.ts";
import type { ApprovalBus } from "../peers/peer-approval.ts";
import type { RosterMember } from "../peers/peer-roster.ts";
import type { RoomPostBudget } from "../rooms/room-post-budget.ts";
import type { RelayEngine } from "../run-with-engine.ts";
import type { Message } from "../store.ts";
import type { InternalCapabilityView, InternalRouteContext } from "./internal-route.ts";

export const MAX_COMMS_DEPTH = 1;
export const MAX_CREATED_BOTS_PER_TURN = 4;
export const MAX_WORKSPACE_BOTS = 100;
export const ROOM_POST_MAX_CHARS = 4_000;
export const BOTS_READ_ONLY = { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only." } as const;

export interface InternalRoomsBot extends RosterMember {
  color: string;
  title?: string;
  section?: string;
  hidden?: boolean;
  chiefOfStaff?: boolean;
  busy?: boolean;
  threadId?: string;
  modelSelection: ModelSelection;
  visibility?: unknown;
  projects?: Array<{ id: string; name: string }>;
  cwd?: string;
  description?: string;
  createdByBot?: unknown;
  ownerUserId?: unknown;
  turnLimits?: Partial<Record<"threadsOpened" | "roomPosts" | "roomsCreated" | "botsCreated", number>>;
  maxConcurrentThreads?: number;
  maxParallelPerPerson?: number;
  [key: string]: unknown;
}

export interface InternalRoomsGroup {
  id: string;
  name: string;
  memberIds: string[];
  threadId: string;
  dm?: boolean;
  cwd?: string | null;
  section?: string;
  unread?: boolean;
}

export interface InternalRoomsTask {
  threadId: string;
  title: string;
  confidential?: boolean;
  openedBy?: { botId?: string; name?: string; at?: number; delegationId?: string };
  approvalMode?: string;
  autoApprove?: boolean;
  alwaysAllow?: unknown[];
  autoWorkspace?: unknown;
}

export interface InternalRoomsStore {
  bot(id: string): InternalRoomsBot | null | undefined;
  readonly bots: readonly InternalRoomsBot[];
  group(id: string): InternalRoomsGroup | null | undefined;
  groupByThread(threadId: string): InternalRoomsGroup | null | undefined;
  readonly groups: readonly InternalRoomsGroup[];
  taskByThread(botId: string, threadId: string): InternalRoomsTask | null | undefined;
  tasks(botId: string): readonly InternalRoomsTask[];
  isConfidentialThread(threadId: string): boolean;
  appendMessage(threadId: string, message: Record<string, unknown>): { id: string; [key: string]: unknown };
  messagesFor(threadId: string): readonly Message[];
  createTask(...args: unknown[]): InternalRoomsTask | null | undefined;
  deleteTask(botId: string, threadId: string): void;
  patchTask(botId: string, threadId: string, patch: Record<string, unknown>): void;
  patchGroup(groupId: string, patch: Record<string, unknown>): InternalRoomsGroup | null | undefined;
  patchBot(botId: string, patch: Record<string, unknown>): InternalRoomsBot | null | undefined;
  createBot(input: Record<string, unknown>, opts?: { seedMessages?: boolean }): InternalRoomsBot;
  setTaskOpenedBy(botId: string, threadId: string, openedBy: Record<string, unknown>): void;
  projectBotForTask(botId: string, threadId: string): { modelSelection?: ModelSelection } | null | undefined;
  workThread(botId: string, fromBotId: string, fromThreadId: string): InternalRoomsTask | null | undefined;
}

export interface InternalRoomsCoordinator {
  node(taskId: string): HandoffView | null | undefined;
  enqueue(...args: unknown[]): { node: HandoffView; duplicate?: boolean; joined?: boolean };
  enqueueExternal(...args: unknown[]): { node: HandoffView };
  tick(): void;
  active(): Array<{ status: string; botId: string; id: string; priority?: string }>;
}

export interface InternalRoomsDeps {
  store: InternalRoomsStore;
  coordinator: InternalRoomsCoordinator;
  approvalBus: ApprovalBus;
  delegationWatch: Map<string, Record<string, unknown>>;
  threadStarters: Map<string, string | undefined>;
  directRequestOwners: Map<string, { messageId?: string } | undefined>;
  coordinationRequestId?: (threadId: string) => string | undefined;
  roomPostBudgets: Map<string, RoomPostBudget>;
  personAskAt: Map<string, number>;
  turnAttachmentsByTurn: Map<string, Array<{ kind: string; path: string; mime: string }>>;
  liveTurnByThread: Map<string, string>;
  connectorThread(botId: string, threadId: string): { group?: InternalRoomsGroup } | null;
  roomPostEligibility(bot: InternalRoomsBot, group: InternalRoomsGroup): { ok: true } | { ok: false; status: number; error: string };
  lastHumanRoomMessageAt(group: InternalRoomsGroup): number | undefined;
  peerReviewRequired(bot: InternalRoomsBot, threadId: string): boolean;
  isUnattended(botId?: string | null, threadId?: string): boolean;
  turnAttachmentKey(threadId: string, turnId?: string): string;
  offerRoomPostToBots(room: InternalRoomsGroup, poster: InternalRoomsBot, text: string, messageId: string, hops: number): void;
  proactiveHopsFromThread(threadId: string | undefined): number;
  /** A one-way notice now runs in `threadId` of its receiver, sent from
   * `fromThreadId`: its hop in a chain of bots (peer inbox, 2026-11-02). */
  notePeerNotice?(threadId: string, fromThreadId: string): void;
  pollOnlyCaller(capability: InternalCapabilityView): boolean;
  peerSpeaker(fromBotId: string, fromThreadId?: string): unknown;
  cloudGuestDriven(threadId: string): boolean;
  botmailConfined(threadId: string): boolean;
  relayEnginesFor(bot: InternalRoomsBot, speaker: unknown, confined?: boolean): readonly RelayEngine[];
  approvalModeForBot(bot: InternalRoomsBot): ApprovalMode;
  /** One-arg owner lookup (index closes over the local operator id). */
  effectiveBotOwner(bot: InternalRoomsBot): string;
  cliDriverKind(instanceId: string | undefined): string | undefined;
  openedThreadOwner(from: InternalRoomsBot, fromThreadId: string, target: InternalRoomsBot): string | undefined;
  openerFrom(fromThreadId: string): string | undefined;
  noteRelayParent(threadId: string, parentThreadId: string): void;
  /** The thread is a part run_with_engine opened (noteRelayParent). */
  isRelayPart(threadId: string): boolean;
  askBotAndWait(
    targetBotId: string,
    message: string,
    depth: number,
    fromBotId: string,
    fromThreadId: string,
    targetThreadId: string,
    opts: { timeoutMs: number; selfRelay: boolean },
  ): Promise<{ status: string; text?: string }>;
  mcpCallTimeoutMinutes(): number;
  externalCompletion(capability: InternalCapabilityView): { completionOwner?: "external" };
  activeRoutineRunForThread(threadId: string): { id: string } | null;
  delegatedThisTurn(taskId: string): void;
  parentThreadModel(botId: string, parentThreadId: string): { modelSelection?: ModelSelection; approvalMode?: "ask" };
  privateThreads(): boolean;
  startOrQueueOpenedThread(
    botId: string,
    threadId: string,
    opening: string,
    unattended: boolean,
    origin: unknown,
    fromThreadId: string,
  ): Promise<Record<string, unknown>>;
  startParallelTask(input: Record<string, unknown>): Promise<{ parallel: { threadId: string; title: string; state: string } }>;
  globalRuntimeSettings(): GlobalRuntimeSettings;
  turnOrigin(capability: InternalCapabilityView): unknown;
  applyDelegatedLevel(from: InternalRoomsBot, fromThreadId: string, target: InternalRoomsBot, threadId: string, fromNodeId?: string): void;
  threadBusy(botId: string, threadId: string): boolean;
  botAtThreadCapacity(botId: string): boolean;
  /** Null when the bot has no active group turn; otherwise the live room address. */
  activeGroupTurnForBot(botId: string): { group?: unknown; threadId: string } | null;
  idempotencyKeyOf(body: Record<string, unknown>, header: string | string[] | undefined): string | undefined;
  joinPerson(threadId: string): string | undefined;
  threadRefUrl(ref: { botId: string; threadId: string }): string;
  agentApiSecret(): Buffer;
  nonPrimaryCreationRefusal(bot: InternalRoomsBot, threadId: string, body: Record<string, unknown>): BotCreationRefusal | null;
  ownerBotsReadOnly(bot: InternalRoomsBot): boolean;
  personDirectTurn(bot: InternalRoomsBot, threadId: string): boolean;
  defaultSelection(): Promise<ModelSelection>;
  checkedModelSelection(
    value: unknown,
    fallback: undefined,
    requireComplete: boolean,
    ownerId: string | undefined,
  ): { ok: true; selection: ModelSelection } | { ok: false; status: number; error: string };
  hostedModelsAllows(selection: ModelSelection): boolean;
  hostedModelsError(): string;
  memberOwnedInOrg(bot: InternalRoomsBot): boolean;
  memberFolderRefusal(ownerId: string | undefined, folder: string | null | undefined): { error: string; code?: string } | null;
  settleMemberAutoLevels(botIds: readonly string[]): void;
  isPerspicax(): boolean;
  internalCapabilityIsActive(capability: InternalCapabilityView): boolean;
  teamSetupSuggest(setup: Record<string, unknown>): { state: string; requestId?: string; detail?: string; result?: { bots: Array<{ action: string; id?: string }> } };
  teamSetupSubmit(setup: Record<string, unknown>): Promise<{ state: string; requestId?: string; detail?: string; result?: { bots: Array<{ action: string; id?: string }> } }>;
  dataDir(): string;
  fullAccessForSource(botId: string, threadId: string): boolean;
  createChannel(value: unknown): InternalRoomsGroup;
  updateChannel(groupId: string, value: unknown): InternalRoomsGroup;
  deciderReadyRoomRouting(): boolean;
  requireActive(capability: InternalCapabilityView): void;
}

/** Counters and depth the opener sets before a route runs. Same object the caller passed. */
export interface InternalRoomsCapability extends InternalCapabilityView {
  openedThreads: number;
  createdBots: number;
  createdRooms: number;
  roomPosts: number;
  depth: number;
}

/** Locals the factory used to build once per request, shared by the route handlers. */
export interface InternalRoomsCall {
  res: InternalRouteContext["res"];
  path: string;
  method: string;
  json: InternalRouteContext["json"];
  internalCapability: InternalRoomsCapability;
  readInternalBody: InternalRouteContext["readBody"];
  req: { headers: NonNullable<InternalRouteContext["headers"]> };
  store: InternalRoomsStore;
  coordinator: InternalRoomsDeps["coordinator"];
  approvalBus: InternalRoomsDeps["approvalBus"];
  delegationWatch: InternalRoomsDeps["delegationWatch"];
  threadStarters: InternalRoomsDeps["threadStarters"];
  directRequestOwners: InternalRoomsDeps["directRequestOwners"];
  coordinationRequestId: InternalRoomsDeps["coordinationRequestId"];
  roomPostBudgets: InternalRoomsDeps["roomPostBudgets"];
  personAskAt: InternalRoomsDeps["personAskAt"];
  turnAttachmentsByTurn: InternalRoomsDeps["turnAttachmentsByTurn"];
  liveTurnByThread: InternalRoomsDeps["liveTurnByThread"];
  connectorThread: InternalRoomsDeps["connectorThread"];
  roomPostEligibility: InternalRoomsDeps["roomPostEligibility"];
  lastHumanRoomMessageAt: InternalRoomsDeps["lastHumanRoomMessageAt"];
  peerReviewRequired: InternalRoomsDeps["peerReviewRequired"];
  isUnattended: InternalRoomsDeps["isUnattended"];
  turnAttachmentKey: InternalRoomsDeps["turnAttachmentKey"];
  offerRoomPostToBots: InternalRoomsDeps["offerRoomPostToBots"];
  proactiveHopsFromThread: InternalRoomsDeps["proactiveHopsFromThread"];
  pollOnlyCaller: InternalRoomsDeps["pollOnlyCaller"];
  peerSpeaker: InternalRoomsDeps["peerSpeaker"];
  cloudGuestDriven: InternalRoomsDeps["cloudGuestDriven"];
  botmailConfined: InternalRoomsDeps["botmailConfined"];
  relayEnginesFor: InternalRoomsDeps["relayEnginesFor"];
  openedThreadOwner: InternalRoomsDeps["openedThreadOwner"];
  openerFrom: InternalRoomsDeps["openerFrom"];
  noteRelayParent: InternalRoomsDeps["noteRelayParent"];
  isRelayPart: InternalRoomsDeps["isRelayPart"];
  askBotAndWait: InternalRoomsDeps["askBotAndWait"];
  externalCompletion: InternalRoomsDeps["externalCompletion"];
  activeRoutineRunForThread: InternalRoomsDeps["activeRoutineRunForThread"];
  parentThreadModel: InternalRoomsDeps["parentThreadModel"];
  privateThreads: InternalRoomsDeps["privateThreads"];
  startOrQueueOpenedThread: InternalRoomsDeps["startOrQueueOpenedThread"];
  startParallelTask: InternalRoomsDeps["startParallelTask"];
  turnOrigin: InternalRoomsDeps["turnOrigin"];
  applyDelegatedLevel: InternalRoomsDeps["applyDelegatedLevel"];
  threadBusy: InternalRoomsDeps["threadBusy"];
  botAtThreadCapacity: InternalRoomsDeps["botAtThreadCapacity"];
  activeGroupTurnForBot: InternalRoomsDeps["activeGroupTurnForBot"];
  idempotencyKeyOf: InternalRoomsDeps["idempotencyKeyOf"];
  joinPerson: InternalRoomsDeps["joinPerson"];
  threadRefUrl: InternalRoomsDeps["threadRefUrl"];
  nonPrimaryCreationRefusal: InternalRoomsDeps["nonPrimaryCreationRefusal"];
  ownerBotsReadOnly: InternalRoomsDeps["ownerBotsReadOnly"];
  personDirectTurn: InternalRoomsDeps["personDirectTurn"];
  defaultSelection: InternalRoomsDeps["defaultSelection"];
  checkedModelSelection: InternalRoomsDeps["checkedModelSelection"];
  memberOwnedInOrg: InternalRoomsDeps["memberOwnedInOrg"];
  memberFolderRefusal: InternalRoomsDeps["memberFolderRefusal"];
  settleMemberAutoLevels: InternalRoomsDeps["settleMemberAutoLevels"];
  createChannel: InternalRoomsDeps["createChannel"];
  updateChannel: InternalRoomsDeps["updateChannel"];
  notePeerNotice: InternalRoomsDeps["notePeerNotice"];
  cfg: GlobalRuntimeSettings;
  botMaxConcurrentThreadsLocal: (bot: InternalRoomsBot) => number;
  botMaxParallelPerPersonLocal: (bot: InternalRoomsBot) => number;
  botTurnLimitLocal: (bot: InternalRoomsBot, key: "threadsOpened" | "roomPosts" | "roomsCreated") => number;
  approvalModeFor: (bot: InternalRoomsBot) => ApprovalMode;
  effectiveBotOwner: (bot: InternalRoomsBot) => string;
  mcpCallTimeoutMinutes: (cfg?: unknown) => number;
  registry: { cliTarget: (instanceId: string | undefined) => { driverKind: string } | undefined };
  IDENTITY: { kind: "perspicax" | "solo" };
  hostedModels: { allows: (selection: ModelSelection) => boolean; error: () => string };
  teamSetupRequests: { suggest: InternalRoomsDeps["teamSetupSuggest"]; submit: InternalRoomsDeps["teamSetupSubmit"] };
  DATA_DIR: string;
  fullAccessForSource: InternalRoomsDeps["fullAccessForSource"];
  internalCapabilityIsActive: InternalRoomsDeps["internalCapabilityIsActive"];
  agentApiSecret: InternalRoomsDeps["agentApiSecret"];
  delegatedThisTurn: (taskId: string) => void;
  requireActiveInternalCapability: () => void;
  deciderReady: (cfg: unknown, job: string) => boolean;
  internalSender: InternalRoomsBot;
}
