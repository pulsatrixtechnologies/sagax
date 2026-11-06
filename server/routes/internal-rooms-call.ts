// Per-request scratch for the internal room routes (#1383).
// Same preamble the monolith ran before matching a path, including when no route matches.
import { botMaxConcurrentThreads, botMaxParallelPerPerson } from "../bots/bot-runtime-settings.ts";
import { botTurnLimit } from "../../shared/turn-limits.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import type { InternalRoomsBot, InternalRoomsCall, InternalRoomsCapability, InternalRoomsDeps } from "./internal-rooms-types.ts";

export function openInternalRoomsCall(deps: InternalRoomsDeps, ctx: InternalRouteContext): InternalRoomsCall | null {
  const { res, path, method, json } = ctx;
  const internalCapability = ctx.capability;
  // Ensure counters exist for += / >= in the moved bodies (minted capabilities always set them).
  internalCapability.openedThreads ??= 0;
  internalCapability.createdBots ??= 0;
  internalCapability.createdRooms ??= 0;
  internalCapability.roomPosts ??= 0;
  const readInternalBody = ctx.readBody;
  const req = { headers: ctx.headers ?? {} };
  const store = deps.store;
  const {
    coordinator,
    approvalBus,
    delegationWatch,
    threadStarters,
    directRequestOwners,
    coordinationRequestId,
    roomPostBudgets,
    personAskAt,
    turnAttachmentsByTurn,
    liveTurnByThread,
    connectorThread,
    roomPostEligibility,
    lastHumanRoomMessageAt,
    peerReviewRequired,
    isUnattended,
    turnAttachmentKey,
    offerRoomPostToBots,
    proactiveHopsFromThread,
    pollOnlyCaller,
    peerSpeaker,
    cloudGuestDriven,
    botmailConfined,
    relayEnginesFor,
    openedThreadOwner,
    openerFrom,
    noteRelayParent,
    isRelayPart,
    askBotAndWait,
    externalCompletion,
    activeRoutineRunForThread,
    parentThreadModel,
    privateThreads,
    startOrQueueOpenedThread,
    startParallelTask,
    turnOrigin,
    applyDelegatedLevel,
    threadBusy,
    botAtThreadCapacity,
    activeGroupTurnForBot,
    idempotencyKeyOf,
    joinPerson,
    threadRefUrl,
    nonPrimaryCreationRefusal,
    ownerBotsReadOnly,
    personDirectTurn,
    defaultSelection,
    checkedModelSelection,
    memberOwnedInOrg,
    memberFolderRefusal,
    settleMemberAutoLevels,
    createChannel,
    updateChannel,
  } = deps;
  const cfg = deps.globalRuntimeSettings();
  const botMaxConcurrentThreadsLocal = (bot: InternalRoomsBot) => botMaxConcurrentThreads(bot as never, cfg);
  const botMaxParallelPerPersonLocal = (bot: InternalRoomsBot) => botMaxParallelPerPerson(bot as never, cfg);
  const botTurnLimitLocal = (bot: InternalRoomsBot, key: "threadsOpened" | "roomPosts" | "roomsCreated") => botTurnLimit(bot as never, key);
  const approvalModeFor = (bot: InternalRoomsBot) => deps.approvalModeForBot(bot);
  const effectiveBotOwner = (bot: InternalRoomsBot) => deps.effectiveBotOwner(bot);
  const mcpCallTimeoutMinutes = (_cfg?: unknown) => deps.mcpCallTimeoutMinutes();
  const registry = { cliTarget: (instanceId: string | undefined) => {
    const driverKind = deps.cliDriverKind(instanceId);
    return driverKind ? { driverKind } : undefined;
  } };
  const IDENTITY = { kind: deps.isPerspicax() ? "perspicax" as const : "solo" as const };
  const hostedModels = {
    allows: (selection: ModelSelection) => deps.hostedModelsAllows(selection),
    error: () => deps.hostedModelsError(),
  };
  const teamSetupRequests = {
    suggest: (setup: Record<string, unknown>) => deps.teamSetupSuggest(setup),
    submit: (setup: Record<string, unknown>) => deps.teamSetupSubmit(setup),
  };
  const DATA_DIR = deps.dataDir();
  const fullAccessForSource = deps.fullAccessForSource;
  const internalCapabilityIsActive = deps.internalCapabilityIsActive;
  const agentApiSecret = deps.agentApiSecret;
  const delegatedThisTurn = (taskId: string) => {
    (internalCapability.delegatedThisTurn ??= new Set()).add(taskId);
    deps.delegatedThisTurn(taskId);
  };
  const requireActiveInternalCapability = () => deps.requireActive(internalCapability);
  const deciderReady = (_cfg: unknown, job: string) => job === "roomRouting" && deps.deciderReadyRoomRouting();
  const notePeerNotice = deps.notePeerNotice;
  const notifyRoomPost = deps.notifyRoomPost;
  const setReplyNotify = deps.setReplyNotify;
  const internalSender = store.bot(internalCapability.botId);
  if (!internalSender) return null;
  if (internalCapability.depth === undefined) internalCapability.depth = 0;
  const capability = internalCapability as InternalRoomsCapability;
  return {
    res,
    path,
    method,
    json,
    internalCapability: capability,
    readInternalBody,
    req,
    store,
    coordinator,
    approvalBus,
    delegationWatch,
    threadStarters,
    directRequestOwners,
    coordinationRequestId,
    roomPostBudgets,
    personAskAt,
    turnAttachmentsByTurn,
    liveTurnByThread,
    connectorThread,
    roomPostEligibility,
    lastHumanRoomMessageAt,
    peerReviewRequired,
    isUnattended,
    turnAttachmentKey,
    offerRoomPostToBots,
    proactiveHopsFromThread,
    pollOnlyCaller,
    peerSpeaker,
    cloudGuestDriven,
    botmailConfined,
    relayEnginesFor,
    openedThreadOwner,
    openerFrom,
    noteRelayParent,
    isRelayPart,
    askBotAndWait,
    externalCompletion,
    activeRoutineRunForThread,
    parentThreadModel,
    privateThreads,
    startOrQueueOpenedThread,
    startParallelTask,
    turnOrigin,
    applyDelegatedLevel,
    threadBusy,
    botAtThreadCapacity,
    activeGroupTurnForBot,
    idempotencyKeyOf,
    joinPerson,
    threadRefUrl,
    nonPrimaryCreationRefusal,
    ownerBotsReadOnly,
    personDirectTurn,
    defaultSelection,
    checkedModelSelection,
    memberOwnedInOrg,
    memberFolderRefusal,
    settleMemberAutoLevels,
    createChannel,
    updateChannel,
    notePeerNotice,
    notifyRoomPost,
    setReplyNotify,
    cfg,
    botMaxConcurrentThreadsLocal,
    botMaxParallelPerPersonLocal,
    botTurnLimitLocal,
    approvalModeFor,
    effectiveBotOwner,
    mcpCallTimeoutMinutes,
    registry,
    IDENTITY,
    hostedModels,
    teamSetupRequests,
    DATA_DIR,
    fullAccessForSource,
    internalCapabilityIsActive,
    agentApiSecret,
    delegatedThisTurn,
    requireActiveInternalCapability,
    deciderReady,
    internalSender,
  };
}
