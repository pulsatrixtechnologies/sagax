// Deps for the public groups HTTP routes (#1383). No import of server/index.ts.
import type { IncomingMessage } from "node:http";
import type { ApprovalViewer } from "../approvals/approval-audience.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { SteerOutcome } from "../contracts.ts";
import type { TurnSpeaker } from "../engines/engine-access.ts";
import type { GroupActor } from "../groups/group-ownership.ts";
import type { HarnessCommandCatalog, HarnessCommandSource } from "../harness-commands.ts";
import type { BotRecord, GroupRecord, Message } from "../store.ts";
import type { UsageTrigger } from "../usage/usage-ledger.ts";
import type { GroupCommandRoute } from "../../shared/harness-commands.ts";
import type { ResolvedSender } from "../../shared/wire.ts";

export interface GroupsHttpVisible {
  everything: boolean;
  group(id: string): boolean;
  bot(id: string): boolean;
}

export interface GroupsHttpStore {
  readonly groups: readonly GroupRecord[];
  group(id: string): GroupRecord | undefined;
  bot(id: string): BotRecord | null | undefined;
  patchGroup(id: string, patch: Record<string, unknown>): GroupRecord | null | undefined;
  createGroupTask(groupId: string, title?: string, activate?: boolean, projectId?: string): { threadId: string; title?: string } | null;
  groupProject(groupId: string, projectId: string): unknown;
  groupTaskByThread(groupId: string, threadId: string): { threadId: string; title?: string } | null | undefined;
  switchGroupTask(groupId: string, threadId: string): GroupRecord | null | undefined;
  patchGroupTask(groupId: string, threadId: string, patch: Record<string, unknown>): { threadId: string; title?: string } | null | undefined;
  setGroupTaskTurnTimeout(groupId: string, threadId: string, minutes: number | null): { threadId: string } | null | undefined;
  setGroupTaskPinned(groupId: string, threadId: string, pinned: boolean): { threadId: string; pinned?: boolean } | null | undefined;
  renameGroupTask(groupId: string, threadId: string, title: string): { threadId: string; title?: string } | null | undefined;
  deleteGroupTask(groupId: string, threadId: string): GroupRecord | null | undefined;
  groupTasks(groupId: string): ReadonlyArray<{ threadId: string }>;
  appendMessage(threadId: string, message: Record<string, unknown>): Message;
  messagesFor(threadId: string): readonly Message[];
  deleteGroup(id: string): void;
}

export interface GroupsHttpDeps {
  store: GroupsHttpStore;
  visibleFor(auth: RequestAuth, path: string): GroupsHttpVisible;
  viewerId(auth: RequestAuth): string | undefined;
  groupVisible(group: { id?: unknown; humanIds?: string[]; section?: unknown; peopleDm?: boolean; archivedAt?: number }, viewerId: string | undefined): boolean;
  peopleDmProjection(group: GroupRecord, personId: string | undefined, knows: boolean, page?: { limit: number | undefined; viewer: ApprovalViewer }): object;
  groupReaderId(auth: RequestAuth): string | undefined;
  knowsPersonThreads(req: IncomingMessage): boolean;
  publicGroupState(group: GroupRecord): object;
  refusePlacedBots(auth: RequestAuth, botIds: readonly unknown[], already: ReadonlySet<string>): string | null;
  isPerspicax: boolean;
  channelActorRole(auth: RequestAuth): string | null;
  refuseHumanEdit(auth: RequestAuth, body: unknown, before: readonly string[], ownerChecked?: boolean): string | null;
  createChannel(body: unknown): GroupRecord;
  withCreatorListed(auth: RequestAuth, body: unknown): unknown;
  channelActorId(auth: RequestAuth): string;
  mayPlaceRoomIn(auth: RequestAuth, section: string): boolean;
  recordRoomPlacement(section: string, groupId: string): void;
  phoneHasGroup(groupId: string): boolean;
  phoneHasThread(threadId: string): boolean;
  peopleDmSetSelection(groupId: string, personId: string | undefined, threadId: string): void;
  peopleDmForgetThread(threadId: string): void;
  recordThreadStarter(threadId: string, actor: string): void;
  defaultPage: number;
  viewerForApproval(auth: RequestAuth): ApprovalViewer;
  actorKey(auth: RequestAuth & { kind: "session" }): string;
  projectGroupTranscript<T extends { threadId?: string; messages?: unknown[] }>(group: T, viewer: ApprovalViewer): T;
  groupWithThread(group: GroupRecord, viewer?: ApprovalViewer): GroupRecord & { messages?: unknown[] };
  pageSize(raw: string | null): number | null | undefined;
  messagePage(threadId: string, limit: number | undefined, before: string | null | undefined, viewer: ApprovalViewer): { messages: unknown[]; [key: string]: unknown };
  groupThreadIsWorking(groupId: string, threadId: string): boolean;
  /** Applies a room hold directive ("stop @Bot") when the message is accepted, before it queues behind a busy room. */
  applyRoomHoldsFromMessage(groupId: string, text: string): void;
  groupOwnerRuleApplies(auth: RequestAuth): boolean;
  groupActor(auth: RequestAuth): GroupActor;
  /** One-arg owner lookup (local operator already bound). */
  effectiveBotOwner(bot: { ownerUserId?: unknown }): string;
  companionRequest(req: IncomingMessage, auth: RequestAuth): boolean;
  callerCan(auth: RequestAuth, key: string): boolean;
  roomSectionMoveRefusal(auth: RequestAuth, group: GroupRecord, next: unknown): string | null;
  recordRoomMove(groupId: string, from: string, to: string, fromId?: string | null, toId?: string | null): void;
  updateChannel(groupId: string, body: unknown): GroupRecord;
  memberFolderRefusal(principal: string | null, folder: string | null | undefined): { error: string; code?: string } | null;
  memberFolderPrincipal(auth: RequestAuth): string | null;
  botGrants(bot: { grants?: unknown; directGrants?: unknown; ownerUserId?: unknown; createdAt?: unknown }): unknown[];
  principalById(id: string): { name?: string; email?: string; login?: string } | null | undefined;
  channelTurnOpen(group: GroupRecord): boolean;
  failTurnIfMemberLeft(group: GroupRecord, beforeHumanIds: string[], beforeMemberIds: string[]): void;
  broadcast(payload: Record<string, unknown>): void;
  roomMemberContexts: { request(threadId: string, botId: string): boolean };
  disableRoutinesForGroup(groupId: string): void;
  notePushRead(personId: string | undefined, threadId: string): void;
  actorPrincipalId(auth: RequestAuth): string;
  readCursor(threadId: string): { lastReadMessageId?: string };
  peopleDmThreadOf(group: GroupRecord, raw: unknown): string;
  groupIsWorking(group: GroupRecord): boolean;
  stagedSkillCleanupsForThread(threadId: string): Array<{ botId: string; stagedId: string }>;
  clearLastReply(threadId: string): void;
  cancelTeamSetupResumesForThread(threadId: string): void;
  clearTurnDigestState(threadId: string): void;
  revokeInternalCapabilitiesForThread(threadId: string): void;
  rejectDeletedThreadSkillStages(cleanups: Array<{ botId: string; stagedId: string }>): void;
  groupPostAllowed(group: { id?: unknown; humanIds?: string[]; section?: unknown; peopleDm?: boolean }, viewerId: string | undefined): boolean;
  misuseActor(principalId: string | undefined, origin?: string): { triage: boolean; principalId?: string };
  usageTriggerFor(auth: RequestAuth): UsageTrigger | undefined;
  assertSpendCap(): void;
  stopGroupThreads(group: GroupRecord, threadIds: string[]): Promise<void>;
  groupEngineCommandRoute(group: GroupRecord, text: string, members: BotRecord[], channelMode: "chat" | "goal"): GroupCommandRoute | null;
  harnessCommandSource(bot: BotRecord, threadId: string, options: { group: GroupRecord; speaker: TurnSpeaker }): HarnessCommandSource | null;
  harnessCommandSpeaker(auth: RequestAuth): TurnSpeaker;
  harnessCommands: HarnessCommandCatalog;
  desktopManaged: boolean;
  runSend<T>(key: string | undefined, fingerprint: string, work: () => Promise<T>): Promise<T>;
  notifyRoomMentions(groupId: string, threadId: string, text: string, auth: RequestAuth): void;
  messageSender(auth: RequestAuth): ResolvedSender | undefined;
  /** Injected group turn runner (startGroupTurn in index.ts). */
  startGroupTurn(
    groupId: string,
    text: string,
    replyTo: Message | undefined,
    sendId: string | undefined,
    channelMode: "chat" | "goal",
    queueId: string | undefined,
    options: Record<string, unknown>,
  ): Message;
  resolveReplyTarget(threadId: string, value: unknown): Message | undefined;
  sendPeopleDmMessage(group: GroupRecord, auth: RequestAuth, text: string, rawSendId: unknown, rawReplyTo: unknown, rawThreadId?: unknown): unknown;
  groupSpeakerBotId(threadId: string): string | undefined;
  runningTurnInstance(bot: BotRecord, threadId: string): { adapter: { capabilities: { queueing?: boolean }; steer?: (threadId: string, prompt: string) => Promise<SteerOutcome> } } | null | undefined;
  activeGroupOperations(groupId: string): ReadonlyArray<{ threadId: string; cancelled?: boolean }>;
  drainQueuedChannelSends(): void;
  profileName(): string;
}

/** Visibility for this request, computed once before the route handlers run. */
export interface GroupsHttpScratch {
  visible: GroupsHttpVisible;
  viewerId: string | undefined;
}
