// Internal harness routes for rooms and bot creation (#1388 slice I5b):
// post-to-room, run-with-engine, threads (POST start/handoff), create-bot,
// create-room, manage-room.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
// startTurn / startOrQueueOpenedThread / startParallelTask and other turn
// runners are injected; this module never imports index.ts.
import { z } from "zod";
import { signTurnHandle } from "../agent-api.ts";
import { parseAutoComputerTarget } from "../auto-computer.ts";
import { createdByBotMark, type BotCreationRefusal } from "../bot-creation.ts";
import { validateBotCwd } from "../bot-cwd.ts";
import { recordedBotOwner } from "../bot-owner.ts";
import { botMaxConcurrentThreads, botMaxParallelPerPerson, type GlobalRuntimeSettings } from "../bot-runtime-settings.ts";
import { CONFIDENTIAL_PEER_REFUSED } from "../confidential-threads.ts";
import type { HandoffView } from "../coordinator.ts";
import { newId } from "../contracts.ts";
import { appendDecision } from "../decision-log.ts";
import { peerApprovalFailure, requestPeerApproval, type ApprovalBus } from "../peer-approval.ts";
import {
  PEER_ACCESS_HELP,
  canAccessBot,
  peerAllowed,
  peerInScope,
  roomRecruitIds,
  type RosterMember,
} from "../peer-roster.ts";
import { planPriorityWake, parseWakePriority, releasePriorityNow } from "../priority-wake.ts";
import { redactSecretsInText } from "../redact.ts";
import { decideRoomPost, emptyRoomPostBudget, type RoomPostAttempt, type RoomPostBudget } from "../room-post-budget.ts";
import {
  chooseRelayEngine,
  relayOpening,
  relayResultText,
  relayThreadLevel,
  type RelayEngine,
} from "../run-with-engine.ts";
import { sectionKey, type Message } from "../store.ts";
import { resumeOpening, resumeRefusal, subagentRequest } from "../subagent-threads.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { fitsOnOneLine } from "../../shared/bot-profile.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { botTurnLimit } from "../../shared/turn-limits.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

const MAX_COMMS_DEPTH = 1;
const MAX_CREATED_BOTS_PER_TURN = 4;
const MAX_WORKSPACE_BOTS = 100;
const ROOM_POST_MAX_CHARS = 4_000;
const BOTS_READ_ONLY = { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only." } as const;

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
  applyDelegatedLevel(from: InternalRoomsBot, fromThreadId: string, target: InternalRoomsBot, threadId: string): void;
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

export function createInternalRoomsRoutes(deps: InternalRoomsDeps): InternalRouteHandler {
  return async (ctx) => {
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
    const internalSender = store.bot(internalCapability.botId);
    if (!internalSender) return PASS;
    if (internalCapability.depth === undefined) internalCapability.depth = 0;

    // post_to_room: a bot puts ONE message into a room it belongs to,
    // without a turn being started for anyone. Everything about it is a
    // deliberate non-event:
    //
    //   role "bot", never "user". A user-role append is what the composer
    //   writes, and it re-enters responder selection — one tool call would
    //   become a round of real turns, which is the notification storm this
    //   whole surface exists to avoid.
    //
    //   no startGroupTurn and no queue kick. The post lands, the room is
    //   marked unread, the person reads it when they look. A bot wanting a
    //   reply has ask_bot and delegate_bot, both of which are accounted for.
    //
    //   membership from the record, never from the argument: the argument
    //   only says which room to look up.
    if (method === "POST" && path === "/api/internal/post-to-room") {
      const body = await readInternalBody();
      const from = internalSender;
      const fromThreadId = internalCapability.threadId;
      const owner = connectorThread(from.id, fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      const groupId = String(body.groupId ?? "").trim();
      const message = String(body.message ?? "").trim();
      const attachVoiceNote = body.attachVoiceNote === true;
      if (body.attachVoiceNote !== undefined && typeof body.attachVoiceNote !== "boolean") {
        return json(res, 400, { error: "attachVoiceNote must be true or false" });
      }
      if (!groupId || !message) {
        return json(res, 400, { error: "post_to_room needs group_id (from list_rooms) and message" });
      }
      // One turn's worth of posts is a handful; past it the turn has
      // stopped reporting and started broadcasting. Counted per turn, on
      // top of the room's own budget below.
      const roomPostLimit = botTurnLimitLocal(from, "roomPosts");
      if ((internalCapability.roomPosts ?? 0) >= roomPostLimit) {
        return json(res, 429, { error: `You have already posted ${roomPostLimit} times this turn, which is the limit. Do not retry: finish your turn and say anything further to the user directly.` });
      }
      if (message.length > ROOM_POST_MAX_CHARS) {
        return json(res, 400, {
          error: `a room post is at most ${ROOM_POST_MAX_CHARS} characters — post the short version and keep the detail in your own reply`,
        });
      }
      let room = store.group(groupId);
      if (!room) return json(res, 404, { error: "no such room — call list_rooms and copy the exact id from the result" });
      // Posting into the room you are already speaking in is not a peer
      // message, it is your own reply arriving twice — and it feeds your
      // words back into the context the same turn is answering from.
      if (room.id === owner.group?.id) {
        return json(res, 409, { error: "you are already speaking in that room — say it in your reply instead" });
      }
      const eligibility = roomPostEligibility(from, room);
      if (!eligibility.ok) return json(res, eligibility.status, { error: eligibility.error });
      // The budget is read BEFORE any approval card and CHARGED only on
      // the path that actually appends. Reading it early is what stops a
      // bot in a loop turning that loop into a queue of cards for a person
      // to work through: the refusal lands on the bot, not in the inbox.
      // Charging it early would have been a lie in the other direction —
      // a denied card, a room deleted while the card was open, or a
      // roster change that ends the post all leave the room with nothing
      // in it, and a room that took no post must not be told it did. The
      // model would then be refused its retry with "you already posted
      // that", which is the one thing worse than a refusal: a false
      // receipt for a message nobody can read.
      const askBudget = (bot: InternalRoomsBot, group: InternalRoomsGroup) => {
        const attempt: RoomPostAttempt = {
          botId: bot.id,
          botName: bot.name,
          text: message,
          now: Date.now(),
        };
        // The person attending is whoever wrote last: in the room, or —
        // when the post was asked for in the sender's own conversation —
        // there. A room-sourced post has no such person; its room is the
        // conversation, and what a person wrote in it is already counted.
        const askedAt = owner.group ? undefined : personAskAt.get(fromThreadId);
        const spokeAt = Math.max(lastHumanRoomMessageAt(group) ?? -Infinity, askedAt ?? -Infinity);
        if (Number.isFinite(spokeAt)) attempt.lastHumanAt = spokeAt;
        return decideRoomPost(roomPostBudgets.get(group.id) ?? emptyRoomPostBudget(), attempt);
      };
      // A refusal is stored, an allowance is not: the budget a refusal
      // hands back never contains the attempt — it is the pruning, plus
      // the breaker if this call is what tripped it — so keeping it costs
      // the room nothing and losing it would let a ring re-form one call
      // later.
      const preflight = askBudget(from, room);
      if (!preflight.allowed) {
        roomPostBudgets.set(room.id, preflight.budget);
        return json(res, 429, { error: preflight.message });
      }
      let poster = from;
      if (peerReviewRequired(from, fromThreadId)) {
        // Same gate ask_bot carries, aimed at the room instead of a peer:
        // a bot the user asked to be consulted about must be consulted here
        // too, or the newest way to reach other bots is the one way round it.
        // full-access: peer-contact
        const verdict = await requestPeerApproval(
          approvalBus,
          from as never,
          { id: room.id, name: room.name },
          message,
          "post_to_room",
          fromThreadId,
        );
        requireActiveInternalCapability();
        if (verdict !== "allow") return json(res, 200, peerApprovalFailure(verdict));
        // The card may have been open for minutes. Re-read both records so a
        // roster change, a section move, or a deletion during that window
        // cannot be posted through on a stale decision.
        const freshFrom = store.bot(internalSender.id);
        const freshRoom = store.group(groupId);
        if (!freshFrom || !freshRoom) return json(res, 404, { error: "that bot or room no longer exists" });
        const stillEligible = roomPostEligibility(freshFrom, freshRoom);
        if (!stillEligible.ok) return json(res, stillEligible.status, { error: stillEligible.error });
        poster = freshFrom;
        room = freshRoom;
      }
      // The room's budget is charged here, against the records the append
      // below will actually use. Between the preflight and this line the
      // room may have taken another bot's post, so this decision — not the
      // preflight — is the one that can refuse.
      const decision = askBudget(poster, room);
      roomPostBudgets.set(room.id, decision.budget);
      if (!decision.allowed) return json(res, 429, { error: decision.message });
      // Unattended inheritance: the mark rides the sender, and reading it
      // here is also what keeps its window alive through a turn that only
      // posts — an aged-out mark would hand the next hop to auto-approve.
      const unattended = isUnattended(poster.id, internalCapability.threadId);
      // A room post is the one send path that bypasses the settling reply,
      // so an explicit attach flag — never a silent default — moves this
      // turn's parked voice note onto the posted message. The removal
      // matters twice over: the clip is delivered exactly once (the
      // settling reply no longer finds it parked), and it survives a turn
      // that dies after the post, because it is no longer parked cleanup's
      // to delete. The post text stands as the caption.
      let attachedVoiceNote = false;
      let stagedAttachments: NonNullable<Message["attachments"]> = [];
      let detachParkedAudio: (() => void) | undefined;
      if (attachVoiceNote) {
        const parkedKey = turnAttachmentKey(fromThreadId, liveTurnByThread.get(fromThreadId));
        const parked = turnAttachmentsByTurn.get(parkedKey) ?? [];
        const audio = parked.filter((attachment) => attachment.kind === "audio");
        if (!audio.length) {
          return json(res, 400, { error: "no voice note to attach — call send_voice_note in this turn first" });
        }
        stagedAttachments = audio.map((attachment) => ({
          kind: "audio" as const,
          path: attachment.path,
          mime: attachment.mime,
        }));
        attachedVoiceNote = true;
        // The parked set is mutated only after the append below lands.
        // Everything between is synchronous, so nothing can interleave,
        // and a persistence failure must leave the clip parked: the post
        // can then be retried, whereas a premature removal strands the
        // clip on disk attached to nothing — and the catalog already told
        // the model never to retry a refused post.
        detachParkedAudio = () =>
          turnAttachmentsByTurn.set(
            parkedKey,
            parked.filter((attachment) => attachment.kind !== "audio"),
          );
      }
      const posted = store.appendMessage(room.threadId, {
        role: "bot",
        kind: "text",
        text: message,
        from: { botId: poster.id, name: poster.name, color: poster.color },
        peerPost: unattended ? { unattended: true } : {},
        ...(attachedVoiceNote ? { attachments: stagedAttachments } : {}),
      });
      internalCapability.roomPosts = (internalCapability.roomPosts ?? 0) + 1;
      detachParkedAudio?.();
      store.patchGroup(room.id, { unread: true });
      // The same visibility contract the peer tools keep: whatever a bot
      // does elsewhere shows up in the conversation it is actually in.
      // The chip is settled — the post has already landed — and carries
      // the same link a "Messaged @X" chip does, which is what makes it a
      // receipt rather than a log line: linked chips stay visible with
      // tool calls off, and open the room they name.
      const chip: Omit<Message, "id" | "at"> = {
        role: "bot",
        kind: "activity",
        tool: { name: `Posted in ${room.name}`, ok: true },
        comm: { groupId: room.id, withBotId: poster.id, withName: room.name, withColor: poster.color },
      };
      if (owner.group) chip.from = { botId: poster.id, name: poster.name, color: poster.color };
      store.appendMessage(fromThreadId, chip);
      // 2026-10-30: the room's other bots may act on a post that names
      // them; a chain of bots waking each other stops at the hop limit.
      offerRoomPostToBots(room, poster, message, posted.id, Math.max(1, proactiveHopsFromThread(fromThreadId)));
      return json(res, 201, { ok: true, messageId: posted.id, roomName: room.name, attachedVoiceNote });
    }
    // start_thread: a bot opens a real thread — on itself for separate
    // work, or on a teammate as a handoff that should run on its own.
    // Never activates: a bot must not move what the person is looking at.
    // run_with_engine (server/run-with-engine.ts): one part of this bot's
    // work on another engine or model this turn's payer may use, in a
    // fresh thread of the same bot, for the same person, at the same
    // approval level; the result comes back to this call.
    if (method === "POST" && path === "/api/internal/run-with-engine") {
      const body = await readInternalBody();
      const from = internalSender;
      const fromThreadId = internalCapability.threadId;
      const owner = connectorThread(from.id, fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      if (owner.group) return json(res, 409, { error: "run_with_engine works from a direct conversation only; in a room, use coordinate_bots with a teammate on that engine." });
      if (body.depth !== undefined && (!Number.isInteger(body.depth) || body.depth !== internalCapability.depth)) {
        return json(res, 403, { error: "the recursion depth does not match this turn" });
      }
      // the part itself is one hop: it never hands a part on again
      if (internalCapability.depth >= MAX_COMMS_DEPTH) {
        return json(res, 409, { error: "This turn is already a part run on another engine: do this work here." });
      }
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const engineAsked = typeof body.engine === "string" ? body.engine : "";
      if (!message || !engineAsked.trim()) return json(res, 400, { error: "engine and message are required" });
      if (message.length > 20_000) return json(res, 400, { error: "message must be at most 20000 characters" });
      const threadLimit = botTurnLimitLocal(from, "threadsOpened");
      if (internalCapability.openedThreads >= threadLimit) {
        // V4: thread limit is an intended stop (200 non-isError), not a red 429.
        return json(res, 200, {
          applied: false,
          limit: true,
          message: `You have already opened ${threadLimit} threads this turn, which is the limit. Finish your turn and tell the person what is left.`,
        });
      }
      // nothing of a confidential conversation leaves it, even to the same bot elsewhere
      if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
      // the same person, the same credentials and routine lineage as this turn
      const speaker = peerSpeaker(from.id, fromThreadId);
      const confined = cloudGuestDriven(fromThreadId) || botmailConfined(fromThreadId);
      const engines = relayEnginesFor(from, speaker, confined);
      const current = store.projectBotForTask(from.id, fromThreadId)?.modelSelection ?? from.modelSelection;
      const choice = chooseRelayEngine({
        engine: engineAsked,
        ...(typeof body.model === "string" && body.model.trim() ? { model: body.model.trim() } : {}),
        engines,
        current: { instanceId: current.instanceId, model: current.model, ...(current.account ? { account: current.account } : {}) },
      });
      if (!choice.ok) return json(res, 200, { error: choice.error });
      // a level the engine cannot run becomes Ask in that thread (parentThreadModel)
      const relayLevel = relayThreadLevel({
        botLevel: approvalModeFor(from),
        fromDriver: registry.cliTarget(from.modelSelection.instanceId)?.driverKind,
        toDriver: choice.driverKind,
      });
      const rawTitle = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
      const title = (rawTitle || message.replace(/\s+/g, " ")).slice(0, 60).trim() || `On ${choice.engineLabel}`;
      // the part runs on the sign-in named (a second Grok account in its own folder)
      const selection: ModelSelection = { instanceId: choice.instanceId, model: choice.model, ...(choice.account ? { account: choice.account } : {}) };
      const task = store.createTask(from.id, title, false, undefined, { botId: from.id, name: from.name, at: Date.now() },
        relayLevel, openedThreadOwner(from, fromThreadId, from), selection, false, undefined, false);
      if (!task) return json(res, 500, { error: "couldn't open a thread for that part" });
      threadStarters.set(task.threadId, openerFrom(fromThreadId));
      noteRelayParent(task.threadId, fromThreadId);
      internalCapability.openedThreads += 1;
      store.appendMessage(fromThreadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `Ran on ${choice.engineLabel} (${choice.model}): #${task.title}`, ok: true },
        threadRef: { botId: from.id, threadId: task.threadId, title: task.title },
      });
      const sourceTitle = store.taskByThread(from.id, fromThreadId)?.title ?? "";
      const waitMs = Math.max(5_000, Math.min(
        Number(process.env.SAGAX_RUN_WITH_ENGINE_WAIT_MS) || 300_000,
        mcpCallTimeoutMinutes(cfg) * 60_000 - 30_000,
      ));
      const outcome = await askBotAndWait(from.id, relayOpening({ engineLabel: choice.engineLabel, sourceTitle, message }),
        internalCapability.depth ?? 0, from.id, fromThreadId, task.threadId, { timeoutMs: waitMs, selfRelay: true });
      requireActiveInternalCapability();
      if (outcome.status === "timeout" && !delegationWatch.has(task.threadId)) {
        // still running: the result is delivered here when it settles
        const taskId = newId();
        delegationWatch.set(task.threadId, {
          toBotId: from.id,
          toBotName: from.name,
          taskId,
          sourceThreadId: fromThreadId,
          sourceBotId: from.id,
          routineRunId: activeRoutineRunForThread(fromThreadId)?.id,
          startedAtMs: Date.now() - waitMs,
          ...externalCompletion(internalCapability),
        });
        delegatedThisTurn(taskId);
        return json(res, 200, { timeout: true, taskId, engineLabel: choice.engineLabel, threadId: task.threadId });
      }
      const status = (outcome.status === "timeout" ? "reply" : outcome.status) as "reply" | "failed" | "error";
      return json(res, 200, {
        status,
        engineLabel: choice.engineLabel,
        model: choice.model,
        threadId: task.threadId,
        text: relayResultText({ engineLabel: choice.engineLabel, model: choice.model, status, text: outcome.text ?? "" }),
      });
    }
    if (method === "POST" && path === "/api/internal/threads") {
      const body = await readInternalBody();
      const from = internalSender;
      const fromThreadId = internalCapability.threadId;
      const owner = connectorThread(from.id, fromThreadId);
      if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
      if (
        body.depth !== undefined &&
        (!Number.isInteger(body.depth) || Number(body.depth) < 0 || body.depth !== internalCapability.depth)
      ) {
        return json(res, 403, { error: "the recursion depth does not match this turn" });
      }
      const title = String(body.title ?? "").trim();
      const message = String(body.message ?? "").trim();
      // sub-agents (parity D1, server/subagent-threads.ts): resume one by id, or run one read-only
      const resumeId = typeof body.resumeThreadId === "string" ? body.resumeThreadId.trim() : "";
      const readOnly = body.readOnly === true;
      if (!message || (!title && !resumeId)) return json(res, 400, { error: "title and message are required" });
      if (title.length > 80) return json(res, 400, { error: "title must be at most 80 characters" });
      // the title is quoted into chips and the sidebar, one line each
      if (!fitsOnOneLine(title)) return json(res, 400, { error: "title must fit on one line" });
      const threadLimit = botTurnLimitLocal(from, "threadsOpened");
      if (internalCapability.openedThreads >= threadLimit) {
        // V4: thread limit is an intended stop (200 non-isError), not a red 429.
        return json(res, 200, {
          applied: false,
          limit: true,
          message: `You have already opened ${threadLimit} threads this turn, which is the limit. Do not retry: finish your turn and tell the person which threads you still wanted to open, so they can open them or ask you again.`,
        });
      }
      const toBotId = typeof body.toBotId === "string" && body.toBotId.trim() ? body.toBotId.trim() : from.id;
      const target = store.bot(toBotId);
      if (!target) return json(res, 404, { error: "no such bot" });
      // workspace: where a thread of this bot on Auto starts (sub-agents,
      // server/auto-computer.ts). Checked again at each of its turns.
      const autoWorkspace = body.workspace === undefined || body.workspace === null || body.workspace === "" ? null : parseAutoComputerTarget(body.workspace);
      if (body.workspace !== undefined && body.workspace !== null && body.workspace !== "" && !autoWorkspace) {
        return json(res, 400, { error: "workspace must be this_computer, browser, cloud or local_vm" });
      }
      if (autoWorkspace && target.id !== from.id) {
        return json(res, 400, { error: "workspace is only for a thread on yourself: a teammate works where its own Workspace says" });
      }
      const oneWay = body.oneWay === true;
      const wakeAsked = parseWakePriority(body.priority);
      if (wakeAsked === "invalid") return json(res, 400, { error: "priority is now or normal." });
      if (oneWay && target.id === from.id) {
        return json(res, 409, { error: "send_to_bot is cross-bot only; to work on yourself, do it in this turn (start_thread opens a separate job where you have it)" });
      }
      if (internalCapability.roomCoordination) {
        if (target.id !== from.id && !oneWay) {
          return json(res, 409, { error: "Use coordinate_bots for teamwork; it queues actual teammates and resumes you automatically." });
        }
        if (target.id === from.id && !internalCapability.ownThreadCreation) {
          return json(res, 409, { error: "Only a direct user request can open separate self-owned threads. Finish this assigned work here; use coordinate_bots for teammates." });
        }
      }
      // A folder is the target's own organisation; a name is what the
      // model has, an id is what the sidebar has, so accept either.
      const folder = typeof body.folder === "string" ? body.folder.trim() : "";
      let projectId: string | undefined;
      if (folder) {
        const project = (target.projects ?? []).find(
          (candidate) => candidate.id === folder || candidate.name.trim().toLowerCase() === folder.toLowerCase(),
        );
        if (!project) {
          const names = (target.projects ?? []).map((candidate) => candidate.name).join(", ");
          return json(res, 400, { error: `@${target.name} has no folder named "${folder}"${names ? ` — the folders are: ${names}` : " — it has no folders; leave folder out"}` });
        }
        projectId = project.id;
      }
      const sourceTitle = owner.group ? owner.group.name : (store.taskByThread(from.id, fromThreadId)?.title ?? "");
      if ((readOnly || resumeId) && target.id !== from.id) {
        return json(res, 400, { error: "read_only and thread_id are for a thread on yourself: a teammate works at its own level, in its own threads" });
      }
      if (resumeId) {
        const resumed = store.taskByThread(from.id, resumeId);
        // named from here only as list_threads would name it (lending view,
        // confidential threads), and for the same person's work
        const visible = !store.isConfidentialThread(resumeId);
        const refused = resumeRefusal(resumed as never, from.id, fromThreadId, {
          visible, ...(privateThreads() ? { ownerPrincipalId: openedThreadOwner(from, fromThreadId, from) } : {}),
        });
        if (refused || !resumed) return json(res, refused?.status ?? 404, { error: refused?.error ?? "no such thread" });
        // nothing of a confidential conversation goes into one that is not
        if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
        // read-only narrows the thread for good: Ask, no standing grants
        if (readOnly) store.patchTask(from.id, resumed.threadId, { approvalMode: "ask", autoApprove: false, alwaysAllow: [] });
        internalCapability.openedThreads += 1;
        const chip: Omit<Message, "id" | "at"> = {
          role: "bot",
          kind: "activity",
          tool: { name: `Resumed thread #${resumed.title}`, ok: true },
          threadRef: { botId: from.id, threadId: resumed.threadId, title: resumed.title },
        };
        if (owner.group) chip.from = { botId: from.id, name: from.name, color: from.color };
        store.appendMessage(fromThreadId, chip);
        const outcome = await startOrQueueOpenedThread(from.id, resumed.threadId, resumeOpening(message, sourceTitle, readOnly), isUnattended(from.id, fromThreadId), turnOrigin(internalCapability), fromThreadId);
        return json(res, 201, {
          threadId: resumed.threadId, title: resumed.title, botId: from.id, botName: from.name, self: true, resumed: true,
          ...(readOnly ? { readOnly: true } : {}), ...outcome,
        });
      }
      // report_back: a parallel task of this conversation, whose card shows
      // here and whose result is posted back here (shared/parallel-tasks.ts).
      if (target.id === from.id && body.reportBack === true && !owner.group && store.taskByThread(from.id, fromThreadId)) {
        internalCapability.openedThreads += 1;
        const speaker = peerSpeaker(from.id, fromThreadId);
        try {
          const started = await startParallelTask({
            botId: from.id, threadId: fromThreadId, text: subagentRequest(message, readOnly), title, byBot: true,
            ...(readOnly ? { approvalMode: "ask" as const } : {}),
            speaker, principalId: speaker && typeof speaker === "object" && "principalId" in speaker ? (speaker as { principalId?: string }).principalId : undefined,
            ...(autoWorkspace ? { autoWorkspace } : {}),
          });
          return json(res, 201, {
            threadId: started.parallel.threadId, title: started.parallel.title, botId: from.id, botName: from.name,
            self: true, parallel: true, state: started.parallel.state, limit: botMaxParallelPerPersonLocal(from),
            ...(readOnly ? { readOnly: true } : {}),
            ...(autoWorkspace ? { workspace: autoWorkspace } : {}),
          });
        } catch (error) {
          return json(res, (error as { status?: number }).status ?? 409, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (target.id === from.id) {
        const inherited = parentThreadModel(from.id, fromThreadId);
        // a thread a confidential conversation opens is confidential, its owner's
        const task = store.createTask(from.id, title, false, projectId, { botId: from.id, name: from.name, at: Date.now() },
          readOnly ? "ask" : inherited.approvalMode, openedThreadOwner(from, fromThreadId, from), inherited.modelSelection, false, undefined, store.isConfidentialThread(fromThreadId));
        if (!task) return json(res, 500, { error: "couldn't create that thread" });
        if (autoWorkspace) store.patchTask(from.id, task.threadId, { autoWorkspace });
        threadStarters.set(task.threadId, openerFrom(fromThreadId));
        internalCapability.openedThreads += 1;
        const chip: Omit<Message, "id" | "at"> = {
          role: "bot",
          kind: "activity",
          tool: { name: `Opened thread #${task.title}`, ok: true },
          threadRef: { botId: from.id, threadId: task.threadId, title: task.title },
        };
        if (owner.group) chip.from = { botId: from.id, name: from.name, color: from.color };
        store.appendMessage(fromThreadId, chip);
        // The first line is the bot's own words. Say so where the model
        // reads it, so a later turn in that thread never mistakes the
        // request for the person's.
        const opening = `[Thread you opened yourself${sourceTitle ? ` from #${sourceTitle}` : ""}. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\n${subagentRequest(message, readOnly)}`;
        const outcome = await startOrQueueOpenedThread(from.id, task.threadId, opening, isUnattended(from.id, fromThreadId), turnOrigin(internalCapability), fromThreadId);
        return json(res, 201, {
          threadId: task.threadId,
          title: task.title,
          botId: from.id,
          botName: from.name,
          self: true,
          limit: botMaxConcurrentThreadsLocal(from),
          ...(readOnly ? { readOnly: true } : {}),
          ...(autoWorkspace ? { workspace: autoWorkspace } : {}),
          ...outcome,
        });
      }
      // A peer thread is a handoff into a fresh thread: every gate the
      // classic handoff has applies unchanged, here at queue time and
      // again in the drain at dispatch time.
      const depth = internalCapability.depth ?? 0;
      if (!oneWay && depth >= MAX_COMMS_DEPTH) {
        return json(res, 200, { error: "thread chains are limited to one hop — open the thread on yourself, or do this one here" });
      }
      if (!canAccessBot(from, target) || target.hidden || !peerInScope(from, target)) {
        return json(res, 403, { error: `that bot belongs to a different section or is unavailable. ${PEER_ACCESS_HELP}` });
      }
      if (!peerAllowed(from, target)) {
        return json(res, 403, { error: `that bot is not on this bot's allowed peers. ${PEER_ACCESS_HELP}` });
      }
      // nothing of a confidential conversation is handed to another bot
      if (store.isConfidentialThread(fromThreadId)) return json(res, 403, { error: CONFIDENTIAL_PEER_REFUSED, code: "confidential_thread" });
      const task = store.createTask(target.id, title, false, projectId, { botId: from.id, name: from.name, at: Date.now() }, undefined, openedThreadOwner(from, fromThreadId, target));
      if (!task) return json(res, 500, { error: "couldn't create that thread" });
      // The work is still for the person whose request the opener is on.
      threadStarters.set(task.threadId, openerFrom(fromThreadId));
      applyDelegatedLevel(from, fromThreadId, target, task.threadId);
      const sourceUrl = threadRefUrl({ botId: owner.group?.id ?? from.id, threadId: fromThreadId });
      const handed = oneWay
        ? `${message}\n\n[Source conversation](${sourceUrl}). This link grants no additional access and contains no copied transcript.`
        : message;
      // Lot 3 (docs/runtime-contract.md §9): a thread opened on a teammate
      // runs on the job runtime. send_to_bot (oneWay) is a one-way notice:
      // ownership moves to the teammate, nothing resumes the sender, it
      // survives the sender's failed turn and runs once. start_thread on a
      // peer is work whose result returns to the sender. Normal priority
      // starts when the sender's turn ends, priority now at once when a slot
      // is free (else first in the teammate's queue); a sender whose peer
      // comms need review waits for the person's card after its turn.
      const slotFree = !botAtThreadCapacity(target.id) && !activeGroupTurnForBot(target.id);
      const needsApproval = peerReviewRequired(from, fromThreadId);
      const wakePlan = planPriorityWake({
        asked: wakeAsked,
        applies: oneWay,
        slotFree,
        needsApproval,
        senderId: from.id,
        now: Date.now(),
      });
      const priorityFields = wakePlan.reported
        ? { priority: wakePlan.reported, ...(wakePlan.downgraded ? { downgraded: true } : {}) }
        : {};
      const address = { ...(owner.group ? { groupId: owner.group.id } : {}), threadId: fromThreadId, botId: from.id };
      const destination = { threadId: task.threadId, botId: target.id };
      const extra = wakePlan.reported === "now" ? { priority: "now" as const } : {};
      let node: HandoffView;
      try {
        node = pollOnlyCaller(internalCapability)
          ? coordinator.enqueueExternal(address, destination, handed, false, oneWay ? "notify" : "work",
            idempotencyKeyOf(body, req.headers["idempotency-key"]), extra).node
          : coordinator.enqueue(address, internalCapability.generation, internalCapability.roomHandoffId, destination, target.id, handed, false, false,
            [...store.messagesFor(fromThreadId)].reverse().find(m => m.role === "user" && m.kind === "text")?.text ?? "", undefined,
            turnOrigin(internalCapability), oneWay ? "notify" : "work", joinPerson(fromThreadId), false, undefined,
            directRequestOwners.get(fromThreadId)?.messageId, extra).node;
      } catch (error) {
        if (wakePlan.reported === "now") releasePriorityNow(from.id);
        // nothing will ever run there: take the row back before the person
        // sees a thread that goes nowhere
        store.deleteTask(target.id, task.threadId);
        return json(res, 200, { error: error instanceof Error ? error.message : String(error) });
      }
      if (node.threadId !== task.threadId) {
        // The same request already went out this turn: it keeps its thread.
        store.deleteTask(target.id, task.threadId);
      }
      const threadId = node.threadId;
      if (oneWay) deps.notePeerNotice?.(threadId, fromThreadId);
      const openedTitle = store.taskByThread(target.id, threadId)?.title ?? task.title;
      if (threadId === task.threadId) {
        const chip: Omit<Message, "id" | "at"> = {
          role: "bot",
          kind: "activity",
          tool: { name: `Opened thread #${openedTitle} on ${target.name}`, ok: true },
          threadRef: { botId: target.id, threadId, title: openedTitle },
        };
        if (owner.group && !owner.group.dm) chip.from = { botId: from.id, name: from.name, color: from.color };
        store.appendMessage(fromThreadId, chip);
        store.setTaskOpenedBy(target.id, threadId, { botId: from.id, name: from.name, delegationId: node.id, at: task.openedBy?.at ?? Date.now() });
        internalCapability.openedThreads += 1;
      }
      delegatedThisTurn(node.id);
      coordinator.tick();
      const current = coordinator.node(node.id) ?? node;
      // An honest forecast, not a promise: by the time it starts, the
      // target's slots are taken by whatever runs there plus the work
      // queued on it ahead of this one.
      const limit = botMaxConcurrentThreadsLocal(target);
      const running = store.tasks(target.id).filter((candidate) => threadBusy(target.id, candidate.threadId)).length;
      const ahead = coordinator.active().filter((pending) => pending.status === "queued" && pending.botId === target.id && pending.id !== node.id &&
        (pending.priority === "now" || current.priority !== "now")).length;
      const position = running + ahead + 1;
      const handle = signTurnHandle(agentApiSecret(), {
        agentId: target.id,
        threadId,
        messageId: null,
        issuedAt: Date.now(),
        callerId: from.id,
        callerKind: "bot",
      });
      return json(res, 201, {
        threadId,
        title: openedTitle,
        botId: target.id,
        botName: target.name,
        self: false,
        delegationId: node.id,
        approvalRequired: needsApproval && !current.approvalGranted,
        limit,
        ...(current.status === "running" ? { state: "running" } : position > limit ? { state: "queued", position: position - limit } : { state: "pending" }),
        ...(oneWay ? { handle } : {}),
        ...priorityFields,
      });
    }
    if (method === "POST" && path === "/api/internal/create-bot") {
      const body = await readInternalBody();
      const chief = internalSender;
      const fromThreadId = internalCapability.threadId;
      const owner = connectorThread(chief.id, fromThreadId);
      if (!owner) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      // 2026-10-17: any bot of the person, not only the Primary Bot
      // (server/bot-creation.ts). The Primary Bot's path is unchanged; any
      // other bot also needs the owner's own turn, a depth and a rate.
      const primaryCreator = chief.chiefOfStaff === true;
      const creatorRefusal = () => primaryCreator ? null : nonPrimaryCreationRefusal(chief, fromThreadId, body);
      const refusedCreator = creatorRefusal();
      if (refusedCreator) return json(res, refusedCreator.status, { error: refusedCreator.error, code: refusedCreator.code });
      if (ownerBotsReadOnly(chief)) return json(res, 403, BOTS_READ_ONLY);
      if (internalCapability.createdBots >= MAX_CREATED_BOTS_PER_TURN && !personDirectTurn(chief, fromThreadId)) {
        return json(res, 429, { error: `You can create at most ${MAX_CREATED_BOTS_PER_TURN} bots in one turn that your person did not ask for directly. Use the team you have before adding more.` });
      }
      if (store.bots.length >= MAX_WORKSPACE_BOTS) {
        return json(res, 409, { error: `this workspace is limited to ${MAX_WORKSPACE_BOTS} bots` });
      }
      const name = String(body.name ?? "").trim();
      const role = String(body.role ?? "").trim();
      const instructions = String(body.instructions ?? "").trim();
      if (!name || !role || !instructions) {
        return json(res, 400, { error: "name, role, and instructions are required" });
      }
      if (name.length > 80) return json(res, 400, { error: "name must be at most 80 characters" });
      if (role.length > 120) return json(res, 400, { error: "role must be at most 120 characters" });
      // the same door the profile endpoints keep: both fields are quoted
      // into every other room member's system prompt, one line each
      if (!fitsOnOneLine(name)) return json(res, 400, { error: "name must fit on one line" });
      if (!fitsOnOneLine(role)) return json(res, 400, { error: "role must fit on one line" });
      if (instructions.length > 1_000) {
        return json(res, 400, { error: "instructions must be at most 1000 characters" });
      }
      let selection: ModelSelection;
      if (body.modelSelection === undefined) {
        selection = await defaultSelection();
        // A Primary Bot on Auto makes specialists on Auto too.
        const chiefSelection = store.projectBotForTask(chief.id, fromThreadId)?.modelSelection ?? chief.modelSelection;
        if (chiefSelection.auto === true && selection.instanceId) selection = { ...selection, auto: true };
      } else {
        const checked = checkedModelSelection(body.modelSelection, undefined, true, effectiveBotOwner(chief));
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
        selection = checked.selection;
      }
      if (hostedModels && !hostedModels.allows(selection)) return json(res, 400, { error: hostedModels.error() });
      // The same check the profile path runs: absolute, exists, is a
      // folder. Creation names where the specialist works; nothing looser.
      let cwd: string | undefined;
      if (body.cwd !== undefined) {
        const checkedCwd = validateBotCwd(body.cwd);
        if (!checkedCwd.ok) return json(res, 400, { error: checkedCwd.error });
        // #1098 (isolation): a member's bot names a folder of its owner's own roots
        const outside = memberOwnedInOrg(chief) ? memberFolderRefusal(effectiveBotOwner(chief), checkedCwd.cwd) : null;
        if (outside) return json(res, 403, { ...outside, field: "cwd" });
        cwd = checkedCwd.cwd ?? undefined;
      }
      // Discovery can yield; check current authority and capacity again before writing.
      if (store.bot(chief.id) !== chief || chief.hidden || Boolean(chief.chiefOfStaff) !== primaryCreator || !connectorThread(chief.id, fromThreadId)) {
        return json(res, 403, { error: "only an active bot of yours can create bots; try again" });
      }
      const refusedLater = creatorRefusal();
      if (refusedLater) return json(res, refusedLater.status, { error: refusedLater.error, code: refusedLater.code });
      if (ownerBotsReadOnly(chief)) return json(res, 403, BOTS_READ_ONLY);
      if (internalCapability.createdBots >= MAX_CREATED_BOTS_PER_TURN && !personDirectTurn(chief, fromThreadId)) {
        return json(res, 429, { error: `You can create at most ${MAX_CREATED_BOTS_PER_TURN} bots in one turn that your person did not ask for directly. Use the team you have before adding more.` });
      }
      if (store.bots.length >= MAX_WORKSPACE_BOTS) return json(res, 409, { error: `this workspace is limited to ${MAX_WORKSPACE_BOTS} bots` });
      const duplicate = store.bots.find(
        (candidate) =>
          !candidate.hidden &&
          sectionKey(candidate.section) === sectionKey(chief.section) &&
          candidate.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) {
        return json(res, 409, { error: `@${duplicate.name} already exists in this section; use list_bots` });
      }
      // Organization server: a team setup card needs an admin's approval,
      // so a member's Primary Bot could never get its card applied. There
      // create_bot keeps Sagax's direct, safe creation (MA-4); a solo
      // server takes the reviewed card below.
      if (IDENTITY.kind === "perspicax") {
        const created = store.createBot(
          {
            name,
            title: role,
            description: instructions,
            modelSelection: selection,
            section: chief.section,
            // The request is the agents proxy on loopback: auth is not the
            // person. The Primary Bot's person owns the new bot.
            ...(recordedBotOwner(chief) ? { ownerUserId: recordedBotOwner(chief) } : {}),
            ...(cwd !== undefined ? { cwd } : {}),
            // exactly the Primary Bot's audience: a restricted Primary Bot never makes a bot everyone sees
            ...(chief.visibility ? { visibility: chief.visibility } : {}),
            // a bot made it: it cannot make more (server/bot-creation.ts)
            createdByBot: createdByBotMark(chief, Date.now()),
          },
          { seedMessages: false },
        );
        // a member's Primary Bot never makes a bot on a level the
        // organization refuses for members' bots
        settleMemberAutoLevels([created.id]);
        const safeBot = store.patchBot(created.id, {
          autoApprove: false,
          approvePeerComms: false,
        })!;
        internalCapability.createdBots += 1;
        return json(res, 201, {
          id: safeBot.id,
          name: safeBot.name,
          title: safeBot.title,
          section: safeBot.section || "General",
          model: safeBot.modelSelection.model,
          modelSelection: safeBot.modelSelection,
        });
      }
      // The Primary Bot's person owns the new bot and it keeps the
      // Primary Bot's audience: applyTeamSetup records both (the request
      // is the agents proxy on loopback, never the person).
      // The same reviewed path propose_team_setup takes: Full Access (or
      // Approve for me on the person's own turn, teamSetupDirectSource)
      // applies it in this turn, anything below shows one card and creates nothing
      // until the person applies it. The instructions become the
      // specialist's standing instructions (soul).
      // A suggestion (nobody asked for this bot) always waits on the card.
      const suggestion = body.suggestion === true;
      const summary = instructions.split("\n").find((line) => line.trim())?.trim() ?? "";
      const setup = {
        botId: chief.id,
        threadId: fromThreadId,
        canCommit: () => internalCapabilityIsActive(internalCapability),
        ...(owner.group ? { from: { botId: chief.id, name: chief.name, color: chief.color } } : {}),
        plan: {
          reason: suggestion ? `@${chief.name} thinks the team needs @${name} (${role}).` : `Add @${name} (${role}) to the team.`,
          operations: [{
            action: "create",
            key: "create_bot",
            fields: {
              name,
              title: role,
              description: summary.length > 200 ? `${summary.slice(0, 199).trimEnd()}…` : summary,
              soul: instructions,
              modelSelection: selection,
              ...(cwd !== undefined ? { cwd } : {}),
            },
          }],
        },
      };
      const proposed = suggestion ? teamSetupRequests.suggest(setup) : await teamSetupRequests.submit(setup);
      if (proposed.state === "applied" || proposed.state === "pending") {
        internalCapability.createdBots += 1;
        appendDecision(DATA_DIR, { threadId: fromThreadId, requestId: proposed.requestId, botId: chief.id,
          tool: "create_bot", summary: proposed.detail, decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
          source: proposed.state === "pending" ? "profile" : fullAccessForSource(chief.id, fromThreadId) ? "full-access" : "owner-auto" });
      }
      if (proposed.state === "pending") return json(res, 201, proposed);
      const createdId = "result" in proposed ? proposed.result?.bots.find((bot) => bot.action === "created")?.id : undefined;
      const created = createdId ? store.bot(createdId) : undefined;
      if (!created) return json(res, 201, proposed);
      return json(res, 201, {
        ...proposed,
        id: created.id,
        name: created.name,
        title: created.title,
        section: created.section || "General",
        model: created.modelSelection.model,
        modelSelection: created.modelSelection,
      });
    }
    if (method === "POST" && (path === "/api/internal/create-room" || path === "/api/internal/manage-room")) {
      const body = await readInternalBody();
      const chief = store.bot(internalCapability.botId)!;
      if (chief.hidden || !chief.chiefOfStaff || !connectorThread(chief.id, internalCapability.threadId)) {
        return json(res, 403, { error: "only an active Primary Bot can manage rooms" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "room request must be a JSON object" });
      }
      // ponytail: no new room-administration approval flow. Fail closed for
      // chiefs whose peer changes need review; add a proposal card if needed.
      if (peerReviewRequired(chief, internalCapability.threadId)) {
        return json(res, 403, { error: "peer approval is required; ask the user to make this room change" });
      }
      // Section labels are a permission boundary, not bot-owned organization.
      // A Primary Bot may not recruit excluded peers or acquire a foreign transcript.
      // #1098 lets it message every bot of its person past its peer list; a
      // room still honors that list (roomRecruitIds, #1366).
      const allowedIds = new Set(roomRecruitIds(store.bots, chief));
      const allowedRoster = (ids: string[]) => ids.includes(chief.id) && ids.every((id) => allowedIds.has(id));
      if (body.section !== undefined && (typeof body.section !== "string" || sectionKey(body.section) !== sectionKey(chief.section))) {
        return json(res, 403, { error: "rooms must stay in your own section; ask the user to move them" });
      }
      if (path === "/api/internal/create-room") {
        const roomLimit = botTurnLimitLocal(chief, "roomsCreated");
        if ((internalCapability.createdRooms ?? 0) >= roomLimit) {
          return json(res, 429, { error: `you can create at most ${roomLimit} rooms in one turn` });
        }
        const parsed = z.object({
          fromBotId: z.string().optional(), fromThreadId: z.string().optional(),
          name: z.string().trim().min(1).max(100), memberIds: z.array(z.string()).min(1).max(100),
          section: z.string().optional(), bulletin: z.string().max(12_000).optional(),
        }).strict().safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "provide a room name, memberIds, and optional bulletin (at most 12000 characters)" });
        const memberIds = [...new Set([chief.id, ...parsed.data.memberIds])];
        if (!allowedRoster(memberIds)) {
          return json(res, 403, { error: "include yourself and only active, allowed peers from your section" });
        }
        // Organization server: a room is read through humanIds (channel.read),
        // so the person whose Primary Bot opens it must be listed or the room
        // shows only in search. Solo keeps the unlisted room (one viewer).
        const roomOwnerId = IDENTITY.kind === "perspicax" ? effectiveBotOwner(chief) : "";
        const created = createChannel({
          name: redactSecretsInText(parsed.data.name), memberIds, section: chief.section,
          ...(roomOwnerId ? { humanIds: [roomOwnerId] } : {}),
          setup: {
            bulletin: redactSecretsInText(parsed.data.bulletin ?? ""),
            // The Primary Bot leads; on Auto it is the fallback when the decision model is unsure.
            defaultResponder: deciderReady(cfg, "roomRouting") ? { kind: "auto", fallbackBotId: chief.id } : { kind: "member", botId: chief.id },
          },
        });
        const group = (roomOwnerId && store.patchGroup(created.id, { createdBy: roomOwnerId })) || created;
        internalCapability.createdRooms = (internalCapability.createdRooms ?? 0) + 1;
        return json(res, 201, { id: group.id, name: group.name, section: group.section || "General", memberIds: group.memberIds, memberCount: group.memberIds.length });
      }
      const parsed = z.object({
        fromBotId: z.string().optional(), fromThreadId: z.string().optional(),
        roomId: z.string(), action: z.enum(["add_members", "remove_members", "set_members", "rename", "set_bulletin"]),
        memberIds: z.array(z.string()).min(1).max(100).optional(),
        name: z.string().trim().min(1).max(100).optional(), bulletin: z.string().max(12_000).optional(),
      }).strict().safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "provide roomId and a supported room action; section moves are user-only" });
      const room = store.group(parsed.data.roomId);
      if (!room || room.dm || sectionKey(room.section) !== sectionKey(chief.section) || !allowedRoster(room.memberIds)) {
        return json(res, 403, { error: "you can only manage rooms you belong to with allowed peers in your own section" });
      }
      const { action, memberIds, name, bulletin } = parsed.data;
      const patch: Record<string, unknown> = {};
      if (action === "rename") {
        if (name === undefined) return json(res, 400, { error: "rename requires a name" });
        patch.name = redactSecretsInText(name);
      } else if (action === "set_bulletin") {
        if (bulletin === undefined) return json(res, 400, { error: "set_bulletin requires bulletin text; use an empty string to clear it" });
        patch.bulletin = redactSecretsInText(bulletin);
      } else {
        if (!memberIds || memberIds.some((id) => !allowedIds.has(id))) {
          return json(res, 403, { error: "memberIds must name only yourself or active, allowed peers in your section" });
        }
        const next = action === "add_members" ? [...new Set([...room.memberIds, ...memberIds])]
          : action === "remove_members" ? room.memberIds.filter((id) => !memberIds.includes(id)) : memberIds;
        if (!allowedRoster(next)) return json(res, 403, { error: "keep yourself in the room; only the user can remove its managing Primary Bot" });
        patch.memberIds = next;
      }
      const updated = updateChannel(room.id, patch);
      return json(res, 200, { ok: true, memberIds: updated.memberIds, memberCount: updated.memberIds.length, message: `Updated room “${updated.name}”.` });
    }

    return PASS;
  };
}
