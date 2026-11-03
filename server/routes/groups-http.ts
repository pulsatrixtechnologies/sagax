/**
 * Public groups (channels) HTTP routes (#1388 wave 2 P4):
 * /api/groups, /api/groups/:id, tasks, messages, leave, read, queue, interrupt.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * The group turn runner (startGroupTurn) is injected as a function.
 */
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { admit } from "../admission.ts";
import type { ApprovalViewer } from "../approvals/approval-audience.ts";
import { memberGroup } from "../bot-visibility.ts";
import { validateBotCwd } from "../bot-cwd.ts";
import {
  cancelChannelMessage,
  headChannelGroup,
  holdChannelQueue,
  queueChannelMessage,
  queuedChannelMessage,
  resolveHeldReplyTarget,
  restoreHeldChannelQueue,
  settleHeldChannelQueueHead,
} from "../rooms/channel-queue.ts";
import { channelViewerId } from "../rooms/channel-visibility.ts";
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";
import type { SteerOutcome } from "../contracts.ts";
import { groupLeftLine, planGroupLeave } from "../group-leave.ts";
import {
  groupPatchOwnerRefusal,
  mayDeleteGroup,
  type GroupActor,
} from "../group-ownership.ts";
import { deleteGroupMemory } from "../memory/group-memory.ts";
import type { HarnessCommandCatalog, HarnessCommandSource } from "../harness-commands.ts";
import { typedCommandForTurn, unavailableCommandError } from "../harness-commands.ts";
import { cancelledChatFollowup } from "../messages/message-db.ts";
import { misuseRefusal } from "../misuse-guardrails.ts";
import {
  peopleDmForViewer,
  peopleDmPatchRefusal,
  peopleDmThreadUnreadPatch,
  peopleDmUnreadPatch,
} from "../people-dms.ts";
import { promptWithReply } from "../messages/replies.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { clientGroupPatchViolation, requestSource } from "../auth/request-auth.ts";
import type { TurnSpeaker } from "../engines/engine-access.ts";
import { speakerFor } from "../request-speaker.ts";
import { roomMentionReadPatch } from "../rooms/room-mentions.ts";
import { parseConversationTurnTimeout } from "../rooms/room-turn-timeout.ts";
import { safetyHttpRefusal } from "../safety-review.ts";
import {
  acceptedSendMatch,
  parseSendId,
  sendFingerprint,
} from "../messages/send-idempotency.ts";
import type { BotRecord, GroupRecord, Message } from "../store.ts";
import { sectionKey } from "../store.ts";
import { parseThreadOrganization } from "../threads/thread-folders.ts";
import { extractTurnImages } from "../turns/turn-images.ts";
import { personDisplayName } from "../viewer-identity.ts";
import { permissionRefusal } from "../../shared/permissions.ts";
import type { GroupCommandRoute } from "../../shared/harness-commands.ts";
import { isStopIntent } from "../../shared/stop-intent.ts";
import type { UsageTrigger } from "../usage/usage-ledger.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import { PASS, type RouteHandler } from "./table.ts";

const createGroupTaskRequestSchema = z.object({
  title: z.string().optional(),
  projectId: z.string().regex(/^[\w-]+$/).optional(),
});

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
  groupOwnerRuleApplies(auth: RequestAuth): boolean;
  groupActor(auth: RequestAuth): GroupActor;
  /** One-arg owner lookup (local operator already bound). */
  effectiveBotOwner(bot: { ownerUserId?: unknown }): string;
  companionRequest(req: IncomingMessage, auth: RequestAuth): boolean;
  callerCan(auth: RequestAuth, key: string): boolean;
  roomSectionMoveRefusal(auth: RequestAuth, group: GroupRecord, next: unknown): string | null;
  recordRoomMove(groupId: string, from: string, to: string): void;
  updateChannel(groupId: string, body: unknown): GroupRecord;
  memberFolderRefusal(principal: string | null, folder: string | null | undefined): { error: string; code?: string } | null;
  memberFolderPrincipal(auth: RequestAuth): string | null;
  botGrants(bot: { grants?: unknown; directGrants?: unknown; ownerUserId?: unknown; createdAt?: unknown }): unknown[];
  principalById(id: string): { name?: string; email?: string; login?: string } | null | undefined;
  channelTurnOpen(group: GroupRecord): boolean;
  failTurnIfMemberLeft(group: GroupRecord, beforeHumanIds: string[], beforeMemberIds: string[]): void;
  broadcast(payload: Record<string, unknown>): void;
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

export function createGroupsHttpRoutes(deps: GroupsHttpDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/groups")) return PASS;
    // /api/groups/:id/memory and folders live in their own modules.
    if (/^\/api\/groups\/[\w-]+\/(memory|folders)(?:\/|$)/.test(path)) return PASS;
    if (/^\/api\/groups\/[\w-]+\/bots\//.test(path)) return PASS;

    const {
      store,
      groupVisible,
      peopleDmProjection,
      groupReaderId,
      knowsPersonThreads,
      publicGroupState,
      refusePlacedBots,
      isPerspicax,
      channelActorRole,
      refuseHumanEdit,
      createChannel,
      withCreatorListed,
      channelActorId,
      mayPlaceRoomIn,
      recordRoomPlacement,
      phoneHasGroup,
      phoneHasThread,
      peopleDmSetSelection,
      peopleDmForgetThread,
      recordThreadStarter,
      defaultPage,
      viewerForApproval,
      actorKey,
      projectGroupTranscript,
      groupWithThread,
      pageSize,
      messagePage,
      groupThreadIsWorking,
      groupOwnerRuleApplies,
      groupActor,
      effectiveBotOwner,
      companionRequest,
      callerCan,
      roomSectionMoveRefusal,
      recordRoomMove,
      updateChannel,
      memberFolderRefusal,
      memberFolderPrincipal,
      botGrants,
      principalById,
      channelTurnOpen,
      failTurnIfMemberLeft,
      broadcast,
      disableRoutinesForGroup,
      notePushRead,
      actorPrincipalId,
      readCursor,
      peopleDmThreadOf,
      groupIsWorking,
      stagedSkillCleanupsForThread,
      clearLastReply,
      cancelTeamSetupResumesForThread,
      clearTurnDigestState,
      revokeInternalCapabilitiesForThread,
      rejectDeletedThreadSkillStages,
      groupPostAllowed,
      misuseActor,
      usageTriggerFor,
      assertSpendCap,
      stopGroupThreads,
      groupEngineCommandRoute,
      harnessCommandSource,
      harnessCommandSpeaker,
      harnessCommands,
      desktopManaged,
      runSend,
      notifyRoomMentions,
      messageSender,
      startGroupTurn,
      resolveReplyTarget,
      sendPeopleDmMessage,
      groupSpeakerBotId,
      runningTurnInstance,
      activeGroupOperations,
      drainQueuedChannelSends,
      profileName,
    } = deps;
    const visible = deps.visibleFor(auth, path);
    const viewerId = deps.viewerId(auth);
    let m: RegExpMatchArray | null = null;

    // ── channels (persisted internally as groups) ───────────────────────
    if (method === "GET" && path === "/api/groups") {
      return json(res, 200, {
        groups: store.groups.filter((g) => visible.group(g.id) && groupVisible(g, viewerId)).map((g) => {
          const room = g.peopleDm ? peopleDmProjection(g, groupReaderId(auth), knowsPersonThreads(req)) : peopleDmForViewer(publicGroupState(g), groupReaderId(auth));
          return visible.everything ? room : memberGroup(room);
        }),
      });
    }
    if (method === "POST" && path === "/api/groups") {
      const body = await readBody(req);
      if (Array.isArray(body?.memberIds)) {
        const placed = refusePlacedBots(auth, body.memberIds, new Set());
        if (placed) return json(res, 403, { error: placed, code: "bot_place_owner_only" });
      }
      // On an organization server the creator owns the new room, so a member
      // may name coworkers they can see in the directory (#1061).
      const memberCreates = isPerspicax && auth.kind === "session" && channelActorRole(auth) === "member";
      const humans = refuseHumanEdit(auth, body, [], memberCreates);
      if (humans) { const bad = humans.startsWith("unknown team") || humans.startsWith("unknown person"); return json(res, bad ? 400 : 403, { error: humans, code: humans.startsWith("unknown team") ? "unknown_team" : bad ? "unknown_person" : "not_channel_editor" }); }
      // A member may only put bots they can see in a room: the room would
      // otherwise show them a restricted bot (bot-visibility.ts).
      const hiddenMember = Array.isArray(body?.memberIds) ? body.memberIds.find((id: unknown) => typeof id === "string" && store.bot(id) && !visible.bot(id)) : undefined;
      if (hiddenMember) return json(res, 400, { error: `unknown channel member: ${String(hiddenMember)}` });
      const created = createChannel(withCreatorListed(auth, body));
      const creatorId = isPerspicax ? channelActorId(auth) : "";
      const group = (creatorId && store.patchGroup(created.id, { createdBy: creatorId })) || created;
      // Created in a section by one of its members: the section opens it.
      if (group.section && mayPlaceRoomIn(auth, group.section)) recordRoomPlacement(group.section, group.id);
      return json(res, 201, { group: { ...publicGroupState(group), messages: [] } });
    }

    m = path.match(/^\/api\/groups\/([\w-]+)\/tasks$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such channel" });
      if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
    // Navigation and thread creation stay unblocked while other threads work
      if (phoneHasGroup(group.id)) {
        return json(res, 409, { error: "this channel is securely saving a credential — try again when it finishes" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const request = createGroupTaskRequestSchema.safeParse(body);
      if (!request.success) return json(res, 400, { error: "title must be text" });
      // A person conversation: a new thread is the pair's, opened by the
      // person who made it; the default thread (what a client from before
      // threads reads) does not move.
      if (group.peopleDm) {
        if (request.data.projectId !== undefined && !store.groupProject(group.id, request.data.projectId)) {
          return json(res, 400, { error: "projectId must be one of this conversation's folders" });
        }
        const made = store.createGroupTask(group.id, request.data.title, false, request.data.projectId);
        if (!made) return json(res, 500, { error: "couldn't create that thread" });
        const person = groupReaderId(auth);
        peopleDmSetSelection(group.id, person, made.threadId);
        return json(res, 201, { group: peopleDmProjection(store.group(group.id)!, person, true, { limit: defaultPage, viewer: viewerForApproval(auth) }), task: made });
      }
      const task = store.createGroupTask(group.id, request.data.title);
      if (!task) return json(res, 500, { error: "couldn't create that task" });
      // Who opened it decides who may answer its cards on a shared workspace.
      if (auth.kind === "session") recordThreadStarter(task.threadId, actorKey(auth));
      return json(res, 201, { group: projectGroupTranscript(groupWithThread(store.group(group.id)!), viewerForApproval(auth)), task });
    }

    m = path.match(/^\/api\/groups\/([\w-]+)\/tasks\/([\w-]+)$/);
    if (m && method === "POST") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such channel" });
      if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
      if (phoneHasGroup(group.id)) {
        return json(res, 409, { error: "this channel is securely saving a credential — try again when it finishes" });
      }
    // Navigation between tasks is always allowed
      // Parsed before the switch: a rejected parameter must not leave the
      // channel pointing at another thread.
      const requestedMessages = url.searchParams.get("messages");
      const switchLimit = pageSize(requestedMessages);
      if (switchLimit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
      // A person conversation: switching opens the thread for the person
      // switching only; the other person and the default thread stay.
      if (group.peopleDm) {
        if (!store.groupTaskByThread(group.id, m[2])) return json(res, 404, { error: "no such thread" });
        const person = groupReaderId(auth);
        // A client from before threads stays on the default thread: its
        // live frames would name that one and its sends follow its own pick.
        const knows = knowsPersonThreads(req);
        if (knows) peopleDmSetSelection(group.id, person, m[2]);
        const view = peopleDmProjection(group, person, knows, requestedMessages === "0" ? undefined : { limit: switchLimit, viewer: viewerForApproval(auth) });
        return json(res, 200, { group: view });
      }
      const switched = store.switchGroupTask(group.id, m[2]);
      if (!switched) return json(res, 404, { error: "no such channel task" });
      const switchedSettings = publicGroupState(switched);
      // "0" predates paging and means settings only — no `messages` key at
      // all, which clients tell apart from an empty page. A positive page is
      // the transcript a client can actually hold; omitting the parameter
      // keeps the whole transcript, as it always did — and only that branch
      // materialises it.
      const approvalViewer = viewerForApproval(auth);
      const responseGroup = requestedMessages === "0"
        ? switchedSettings
        : projectGroupTranscript({ ...switchedSettings, ...messagePage(switched.threadId, switchLimit, null, approvalViewer) }, approvalViewer);
      return json(res, 200, { group: responseGroup });
    }
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such channel" });
      if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      // Archive, snooze and folder are a bot thread's too (server/threads/thread-folders.ts).
      const allowed = new Set(["title", "pinned", "turnTimeoutMinutes", "archivedAt", "snoozedUntil", "projectId"]);
      if (Object.keys(body).some((key) => !allowed.has(key))) return json(res, 400, { error: "unsupported channel thread setting" });
      // A person conversation has no turns, so no turn limit.
      if (group.peopleDm && Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes")) return json(res, 400, { error: "a conversation between two people has no turn limit", code: "people_dm" });
      const existing = store.groupTaskByThread(group.id, m[2]);
      if (!existing) return json(res, 404, { error: "no such channel task" });
      const organization = parseThreadOrganization(body, (projectId) => Boolean(store.groupProject(group.id, projectId)));
      if (!organization.ok) return json(res, 400, { error: organization.error });
      const { pinned: _pinnedField, ...organizing } = organization.patch;
      const filing = Object.keys(organizing).length > 0;
      const pinning = body.pinned !== undefined;
      const renaming = body.title !== undefined;
      const limiting = Object.prototype.hasOwnProperty.call(body, "turnTimeoutMinutes");
      if (!pinning && !renaming && !limiting && !filing) return json(res, 400, { error: "unsupported channel thread setting" });
      if (pinning && typeof body.pinned !== "boolean") return json(res, 400, { error: "pinned must be a boolean" });
      if (renaming && typeof body.title !== "string") return json(res, 400, { error: "title must be a string" });
      const parsedLimit = limiting ? parseConversationTurnTimeout(body.turnTimeoutMinutes) : null;
      if (parsedLimit && !parsedLimit.ok) return json(res, 400, { error: parsedLimit.error });
      // Echoing the current title lets a newer client pin on an older server
      // without the old handler turning a missing title into "Untitled".
      // That echo is not a rename. A real rename stays blocked while working.
      const titleChange = renaming && body.title !== existing.title;
      const notYours = titleChange ? cloudThreadRefusal(auth, m[2]) : null;
      if (notYours) return json(res, 403, { error: notYours });
      // A longer limit applies to the next turn, so it can be saved while
      // this one is still running. A rename still waits.
      if (titleChange && groupThreadIsWorking(group.id, m[2])) {
        return json(res, 409, { error: "this task is running — stop it first" });
      }
      let task = existing;
      if (filing) {
        const filed = store.patchGroupTask(group.id, m[2], organizing);
        if (!filed) return json(res, 404, { error: "no such channel task" });
        task = filed;
      }
      if (limiting && parsedLimit?.ok) {
        const limited = store.setGroupTaskTurnTimeout(group.id, m[2], parsedLimit.minutes);
        if (!limited) return json(res, 404, { error: "no such channel task" });
        task = limited;
      }
      if (pinning) {
        const pinned = store.setGroupTaskPinned(group.id, m[2], body.pinned === true);
        if (!pinned) return json(res, 404, { error: "no such channel task" });
        task = pinned;
      }
      if (titleChange) {
        const renamed = store.renameGroupTask(group.id, m[2], body.title);
        if (!renamed) return json(res, 404, { error: "no such channel task" });
        task = renamed;
      }
      return json(res, 200, { task });
    }
    if (m && method === "DELETE") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such channel" });
      if (group.dm) return json(res, 400, { error: "bot-to-bot channels keep one canonical conversation" });
      if (phoneHasThread(m[2])) {
        return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
      }
      if (groupThreadIsWorking(group.id, m[2])) {
        return json(res, 409, { error: "this task is running — stop it first" });
      }
      if (!store.groupTaskByThread(group.id, m[2])) return json(res, 404, { error: "no such channel task" });
      const notYours = cloudThreadRefusal(auth, m[2]);
      if (notYours) return json(res, 403, { error: notYours });
      const stagedSkillCleanups = stagedSkillCleanupsForThread(m[2]);
      clearLastReply(m[2]);
      cancelTeamSetupResumesForThread(m[2]);
      const updated = store.deleteGroupTask(group.id, m[2]);
      if (!updated) return json(res, 400, { error: "a channel keeps at least one task" });
      clearTurnDigestState(m[2]);
      revokeInternalCapabilitiesForThread(m[2]);
      rejectDeletedThreadSkillStages(stagedSkillCleanups);
      if (updated.peopleDm) {
        peopleDmForgetThread(m[2]);
        return json(res, 200, { group: peopleDmProjection(updated, groupReaderId(auth), true, { limit: defaultPage, viewer: viewerForApproval(auth) }) });
      }
      return json(res, 200, { group: projectGroupTranscript(groupWithThread(updated), viewerForApproval(auth)) });
    }

    m = path.match(/^\/api\/groups\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const existingGroup = store.group(m[1]);
      if (existingGroup?.peopleDm) {
        const field = peopleDmPatchRefusal(body);
        if (field) return json(res, 400, { error: `a conversation between two people cannot change "${field}"`, code: "people_dm" });
        // read or unread for the person marking it only
        const reader = groupReaderId(auth);
        if (reader && body && typeof body === "object" && typeof (body as { unread?: unknown }).unread === "boolean") {
          const { unread, ...rest } = body as { unread: boolean };
          // Marked read: every thread is read for them. Marked unread: the
          // conversation is (its row's dot), as before threads.
          let marked = store.patchGroup(existingGroup.id, unread ? peopleDmUnreadPatch(existingGroup, reader, true) : peopleDmThreadUnreadPatch(existingGroup, reader, false));
          if (marked && Object.keys(rest).length > 0) marked = updateChannel(existingGroup.id, rest);
          if (!marked) return json(res, 404, { error: "no such room" });
          broadcast({ kind: "group", group: publicGroupState(marked) });
          return json(res, 200, { group: peopleDmProjection(marked, reader, knowsPersonThreads(req)) });
        }
      }
      // A bot-to-bot dm keeps its existing member refusal. Placement checks
      // apply only when this patch adds a bot to a channel.
      if (existingGroup && !existingGroup.dm && Array.isArray(body?.memberIds)) {
        const placed = refusePlacedBots(auth, body.memberIds, new Set(existingGroup.memberIds));
        if (placed) return json(res, 403, { error: placed, code: "bot_place_owner_only" });
      }
      // Organization server: only the group's owner changes its settings;
      // anyone listed may still leave it (server/group-ownership.ts).
      const ownerRule = Boolean(existingGroup && !existingGroup.dm && groupOwnerRuleApplies(auth));
      if (existingGroup && ownerRule) {
        const refusal = groupPatchOwnerRefusal(existingGroup, body, groupActor(auth), (botId) => {
          const bot = store.bot(botId);
          return bot ? effectiveBotOwner(bot) : undefined;
        });
        if (refusal) return json(res, 403, { error: refusal, code: "not_group_owner" });
      }
      const humans = refuseHumanEdit(auth, body, existingGroup?.humanIds ?? [], ownerRule);
      if (humans) { const code = humans.startsWith("unknown team") ? "unknown_team" : humans.startsWith("unknown person") ? "unknown_person" : "not_channel_editor"; return json(res, code === "not_channel_editor" ? 403 : 400, { error: humans, code }); }
      // A paired phone's companion edits a room like a member session does.
      if ((auth.kind === "session" && !auth.scopes.includes("admin")) || companionRequest(req, auth)) {
        // The owner of an organization group also picks its default responder,
        // and its working folder with folders.roomWorkingFolder (2026-10-09).
        const folder = ownerRule && isPerspicax && callerCan(auth, "folders.roomWorkingFolder");
        const field = clientGroupPatchViolation(body, ownerRule ? ["defaultResponder", "mentionAll", ...(folder ? ["cwd"] : [])] : []);
        if (field === "cwd" && ownerRule && isPerspicax) return json(res, 403, { ...permissionRefusal("folders.roomWorkingFolder"), field });
        if (field) return json(res, 403, { error: `forbidden: this session may rename or mark a room, not change "${field}" (needs the admin scope)` });
      }
      const movesSection = existingGroup && body && typeof body === "object" && !Array.isArray(body) && "section" in body;
      if (movesSection) {
        const refusal = roomSectionMoveRefusal(auth, existingGroup, (body as { section?: unknown }).section);
        if (refusal) return json(res, 403, { error: refusal, code: "not_allowed" });
      }
      const fromSection = sectionKey(existingGroup?.section);
      // On a Cloud home a room's name and bulletin are its opener's (or the owner's).
      const renamed = store.group(m[1]);
      if (renamed && body && typeof body === "object" &&
        ((body.name !== undefined && body.name !== renamed.name) || (body.bulletin !== undefined && body.bulletin !== (renamed.bulletin ?? "")))) {
        const notYours = cloudThreadRefusal(auth, renamed.threadId);
        if (notYours) return json(res, 403, { error: notYours });
      }
      // #1098 (isolation): a member's room folder stays in their own roots
      const roomFolder = (body as { cwd?: unknown } | null)?.cwd;
      if (typeof roomFolder === "string" && roomFolder.trim()) {
        const checkedRoom = validateBotCwd(roomFolder);
        const outside = checkedRoom.ok ? memberFolderRefusal(memberFolderPrincipal(auth), checkedRoom.cwd) : null;
        if (outside) return json(res, 403, { ...outside, field: "cwd" });
      }
      let group = updateChannel(m[1], body);
      if (movesSection) recordRoomMove(group.id, fromSection, sectionKey(group.section));
      // A room marked read by a person reads their @ tag too (server/rooms/room-mentions.ts).
      const reader = groupReaderId(auth);
      if ((body as { unread?: unknown } | null)?.unread === false) {
        const mentionRead = roomMentionReadPatch(group, reader);
        if ("unreadFor" in mentionRead) group = store.patchGroup(group.id, mentionRead) ?? group;
      }
      return json(res, 200, { group: peopleDmForViewer(publicGroupState(group), reader) });
    }
    // #1480: a person leaves a group they were added to, on their own. Only
    // their own membership: the session names who leaves, never the body.
    m = path.match(/^\/api\/groups\/([\w-]+)\/leave$/);
    if (m && method === "POST") {
      const group = store.group(m[1]);
      if (!group || !groupVisible(group, channelViewerId(auth))) return json(res, 404, { error: "no such group" });
      const actor = groupActor(auth);
      if (!actor.id || actor.id.startsWith("anon:")) return json(res, 403, { error: "only a signed-in person can leave a group", code: "no_person" });
      const plan = planGroupLeave(group, actor, {
        ownerOf: (botId) => {
          const bot = store.bot(botId);
          return bot ? effectiveBotOwner(bot) : undefined;
        },
        shared: (botId) => {
          const bot = store.bot(botId);
          return Boolean(bot && botGrants(bot).length > 0);
        },
      });
      if (!plan.ok) return json(res, plan.status, { error: plan.error, code: plan.code });
      if (plan.removedBotIds.length && phoneHasGroup(group.id)) {
        return json(res, 409, { error: "this group is securely saving a credential — try again when it finishes", code: "busy" });
      }
      const name = personDisplayName(principalById(actor.id)) || actor.email || "";
      store.appendMessage(group.threadId, groupLeftLine(actor.id, name, Date.now()));
      const beforeHumanIds = [...(group.humanIds ?? [])];
      const beforeMemberIds = [...group.memberIds];
      const turnWasOpen = channelTurnOpen(group);
      const left = store.patchGroup(group.id, {
        humanIds: plan.humanIds,
        memberIds: plan.memberIds,
        ...(plan.createdBy ? { createdBy: plan.createdBy } : {}),
        ...(plan.archive ? { archivedAt: Date.now() } : {}),
      });
      if (!left) return json(res, 404, { error: "no such group" });
      // a turn waiting on a bot that left with them ends, as a roster edit does
      if (turnWasOpen) failTurnIfMemberLeft(left, beforeHumanIds, beforeMemberIds);
      if (plan.archive) disableRoutinesForGroup(group.id);
      // their own devices drop the group: they no longer see its frames
      broadcast({ kind: "group.left", roomId: group.id, audience: actor.id });
      return json(res, 200, { ok: true, archived: plan.archive, ...(plan.createdBy ? { owner: plan.createdBy } : {}), removedBotIds: plan.removedBotIds });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)\/read$/);
    if (m && method === "POST") {
      // A conversation between two people is read by the person reading it,
      // never for the other one (server/people-dms.ts).
      const existing = store.group(m[1]);
      const reader = groupReaderId(auth);
      // A person conversation: `{ threadId }` reads that thread for the
      // reader; no thread (a client from before threads) reads them all.
      const readBodyValue = existing?.peopleDm ? await readBody(req).catch(() => null) : null;
      const readThread = existing?.peopleDm && readBodyValue && typeof readBodyValue === "object" && !Array.isArray(readBodyValue)
        ? (readBodyValue as { threadId?: unknown }).threadId
        : undefined;
      const readThreadId = existing?.peopleDm && readThread !== undefined ? peopleDmThreadOf(existing, readThread) : undefined;
      const group = store.patchGroup(m[1], existing?.peopleDm && reader ? peopleDmThreadUnreadPatch(existing, reader, false, readThreadId) : { unread: false, ...roomMentionReadPatch(existing, reader), ...(existing ? readCursor(existing.threadId) : {}) });
      if (!group) return json(res, 404, { error: "no such room" });
      // somebody saw it: no push for this conversation (server/push/decide.ts)
      notePushRead(reader ?? actorPrincipalId(auth), readThreadId ?? group.threadId);
      broadcast({ kind: "group", group: publicGroupState(group) });
      return json(res, 200, { group: group.peopleDm ? peopleDmProjection(group, reader, knowsPersonThreads(req)) : peopleDmForViewer(publicGroupState(group), reader) });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such room" });
      if (groupOwnerRuleApplies(auth) && !group.dm) {
        // The owner, or an organization admin moderating.
        if (!mayDeleteGroup(group, groupActor(auth))) return json(res, 403, { error: "forbidden: only the group's owner can delete it", code: "not_group_owner" });
      } else if (auth.kind === "session" && !auth.scopes.includes("admin")) {
        return json(res, 403, { error: "forbidden: deleting a channel needs the admin scope", code: "channel_delete_admin_only" });
      }
      if (phoneHasGroup(group.id)) {
        return json(res, 409, { error: "this channel is securely saving a credential — try again when it finishes" });
      }
      if (groupIsWorking(group)) {
        return json(res, 409, { error: "this channel is working — stop that turn first" });
      }
      const threadIds = new Set([group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]);
      const stagedSkillCleanups = [...threadIds].flatMap(stagedSkillCleanupsForThread);
      for (const threadId of threadIds) {
        cancelTeamSetupResumesForThread(threadId);
        clearLastReply(threadId);
        clearTurnDigestState(threadId);
      }
      disableRoutinesForGroup(group.id);
      store.deleteGroup(group.id);
      deleteGroupMemory(group.id);
      rejectDeletedThreadSkillStages(stagedSkillCleanups);
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)\/messages$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such group" });
      // Slice 4: a read-only member of a shared section reads its rooms only.
      if (isPerspicax && !groupPostAllowed(group, channelViewerId(auth))) {
        return json(res, 403, { error: "you may read this channel, not post in it", code: "read_only" });
      }
      if (group.peopleDm) return json(res, 202, sendPeopleDmMessage(group, auth, text, body.sendId, body.replyToId, body.threadId));
      const groupSpeaker = speakerFor(auth);
      const groupMisuseActor = misuseActor(groupSpeaker.origin === "person" ? groupSpeaker.principalId : undefined, groupSpeaker.origin);
      const groupThreadId = typeof body.threadId === "string" ? body.threadId : group.threadId;
      const groupMisuse = misuseRefusal(text, { ...groupMisuseActor, surface: "message", threadId: groupThreadId });
      if (groupMisuse) return json(res, groupMisuse.status, { error: groupMisuse.message, code: groupMisuse.code, ...(groupMisuse.reason ? { reason: groupMisuse.reason } : {}) });
      const groupSafety = safetyHttpRefusal({ text, surface: "message", triage: groupMisuseActor.triage, ...(groupMisuseActor.principalId ? { principalId: groupMisuseActor.principalId } : {}), threadId: groupThreadId });
      if (groupSafety) return json(res, groupSafety.status, { error: groupSafety.message, code: groupSafety.code });
      if (body.mode !== undefined && body.mode !== "chat" && body.mode !== "goal") {
        return json(res, 400, { error: "mode must be chat or goal" });
      }
      const channelMode: "chat" | "goal" = body.mode === "goal" ? "goal" : "chat";
      if (group.dm && channelMode === "goal") {
        return json(res, 400, { error: "goal mode is available in team channels, not bot-to-bot channels" });
      }
      if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId))) {
        return json(res, 400, { error: "threadId must be a task id" });
      }
      const threadId = body.threadId ?? group.threadId;
      const trigger = usageTriggerFor(auth);
      try {
        assertSpendCap();
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message : String(error), code: "spend_cap" });
      }
      const ownsThread = group.dm
        ? group.threadId === threadId
        : Boolean(store.groupTaskByThread(group.id, threadId));
      if (!ownsThread) {
        return json(res, 409, { error: "the channel switched tasks before it could receive the message" });
      }
      // "stop" alone while this room thread works: POST /interrupt for that
      // thread (shared/stop-intent.ts), never a queued follow-up.
      if (isStopIntent(text) && groupThreadIsWorking(group.id, threadId)) {
        await stopGroupThreads(group, [threadId]);
        return json(res, 200, { ok: true, threadId, stopped: true });
      }
      // An engine command for one member that the chat cannot run is refused
      // before it is recorded, like in a 1:1 (server/harness-commands.ts).
      const commandRoute = groupEngineCommandRoute(group, text, group.memberIds.map((id) => store.bot(id)).filter((member): member is BotRecord => Boolean(member && !member.hidden)), channelMode);
      const commandBot = commandRoute ? store.bot(commandRoute.botId) : undefined;
      // Only a command that bot's engine lists narrows the responders.
      let engineCommandRoute: GroupCommandRoute | null = null;
      if (commandRoute && commandBot) {
        const typed = await typedCommandForTurn(extractTurnImages(commandRoute.commandText).text, harnessCommandSource(commandBot, threadId, { group, speaker: harnessCommandSpeaker(auth) }), harnessCommands);
        if (typed.kind === "unavailable") return json(res, 409, unavailableCommandError(typed));
        if (typed.kind === "engine") engineCommandRoute = commandRoute;
      }
      const sendId = parseSendId(body.sendId);
      const replyTo = resolveReplyTarget(threadId, body.replyToId);
      // Who is this "user"? On a headless server loopback is the owner by
      // design, and a bot's shell is a loopback caller too. A request with
      // no paired session and no browser origin cannot be told from a
      // script, so its message is stamped rather than trusted as typed —
      // the room's readers, its posting budget and its transcript all look
      // at that stamp — and the send is logged where the operator can see
      // it. The desktop app never gets here: its owner capability is
      // checked before this handler runs.
      const browserOrigin = typeof req.headers.origin === "string" && req.headers.origin.trim() !== "";
      const via: "api" | undefined =
        auth.kind === "loopback" && !desktopManaged && !browserOrigin ? "api" : undefined;
      if (via) {
        console.warn(`room message from ${requestSource(req)} through the local API (no session, no browser origin) into "${group.name}"`);
      }
      const receipt = await runSend(
        sendId ? `group:${group.id}:${threadId}:${sendId}` : undefined,
        sendFingerprint(text, replyTo?.id, channelMode),
        async () => {
          if (sendId) {
            if (cancelledChatFollowup("channel", group.id, threadId, sendId)) {
              throw Object.assign(new Error("this queued sendId was cancelled; send a new message to try again"), { status: 409 });
            }
            const accepted = acceptedSendMatch([...store.messagesFor(threadId)], sendId, text, replyTo?.id, channelMode);
            if (accepted.kind === "conflict") {
              throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
            }
            if (accepted.kind === "match") {
              return { ok: true as const, threadId, message: accepted.message };
            }
            const queued = queuedChannelMessage(group.id, threadId, sendId);
            if (queued) {
              if (
                queued.text !== text ||
                queued.replyToId !== replyTo?.id ||
                queued.mode !== channelMode
              ) {
                throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
              }
              return { ok: true as const, queued: true as const, queueId: queued.id, threadId };
            }
          }
          const current = store.group(group.id);
          if (!current) throw Object.assign(new Error("no such group"), { status: 404 });
          const ownsTarget = current.threadId === threadId || store.groupTasks(current.id).some((task) => task.threadId === threadId);
          if (!ownsTarget) {
            throw Object.assign(new Error("no such thread in channel"), {
              status: 404,
            });
          }
          const threadWorking = groupThreadIsWorking(current.id, threadId);
          const decision = admit("room", {}, { roomWorking: threadWorking, threadWorking });
          if (decision.action === "queue") {
            const queued = queueChannelMessage(current.id, threadId, text, {
              replyToId: replyTo?.id,
              sendId,
              mode: channelMode,
              via,
              sender: messageSender(auth),
              trigger,
            });
            notifyRoomMentions(current.id, threadId, text, auth);
            return { ok: true as const, queued: true as const, queueId: queued.id, threadId };
          }
          const message = startGroupTurn(current.id, text, replyTo, sendId, channelMode, undefined, { via, sender: messageSender(auth), trigger, commandRoute: engineCommandRoute, threadId });
          notifyRoomMentions(current.id, threadId, text, auth);
          return { ok: true as const, threadId, message };
        },
      );
      return json(res, 202, receipt);
    }
    m = path.match(/^\/api\/groups\/([\w-]+)\/queue\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such group" });
      if (!cancelChannelMessage(group.id, m[2])) {
        return json(res, 404, { error: "no such queued message" });
      }
      return json(res, 200, { ok: true });
    }

    // Steer a queued room message into the RUNNING room turn (no interrupt).
    // Only the head steers — room queues drain one item at a time — and the
    // engine that receives it is the thread's live speaker. A room whose
    // running driver cannot steer keeps its queue, exactly like an incapable
    // 1:1 engine; this never ends the running turn.
    m = path.match(/^\/api\/groups\/([\w-]+)\/queue\/([\w-]+)\/steer$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const threadId = typeof body?.threadId === "string" ? body.threadId : undefined;
      if (threadId !== undefined && !/^[\w-]+$/.test(threadId)) {
        return json(res, 400, { error: "threadId must be a task id" });
      }
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such room" });
      // Steering posts into the room's running turn: a read-only member of a
      // shared section may not, exactly as they may not post.
      if (isPerspicax && !groupPostAllowed(group, channelViewerId(auth))) {
        return json(res, 403, { error: "you may read this channel, not post in it", code: "read_only" });
      }
      const targetThreadId = threadId ?? group.threadId;
      const ownsThread = group.dm
        ? group.threadId === targetThreadId
        : Boolean(store.groupTaskByThread(group.id, targetThreadId));
      if (!ownsThread) {
        return json(res, 409, { error: "the channel switched tasks before it could receive the message" });
      }
      // Steering folds words into the running room turn; who pressed Steer
      // does not re-book that turn (its sender was captured when it started).
      const current = store.group(group.id);
      if (!current) return json(res, 404, { error: "no such room" });
      // Which engine owns the running room turn on this thread? The same
      // resolution the room's own Stop uses: the live speaker, else the busy
      // bot on the channel's main thread.
      const speakerBotId =
        groupSpeakerBotId(targetThreadId) ??
        (targetThreadId === current.threadId ? current.busyBotId : undefined);
      const speaker = speakerBotId ? store.bot(speakerBotId) : undefined;
      const instance = speaker ? runningTurnInstance(speaker, targetThreadId) : undefined;
      // Lift the queue atomically: the room settling can drain it as the
      // next follow-up, or this request can steer its head into the live
      // turn — never both for the same words.
      const held = holdChannelQueue(current.id, targetThreadId, m[2]);
      if (!held) return json(res, 404, { error: "no such queued message" });
      // M2: the head may be a coalesced group (one sender's contiguous
      // burst); Steer folds that whole group into the live turn as one.
      const headGroup = headChannelGroup(held.items);
      const [head] = headGroup;
      // A live steer has no image side channel — the same rule as the
      // 1:1 queue: attachment words wait for a real turn where central
      // admission can hand the images to the engine.
      if (headGroup.some((item) => extractTurnImages(item.text).images.length > 0)) {
        restoreHeldChannelQueue(held);
        return json(res, 200, { ok: true, queued: true, threadId: targetThreadId });
      }
      const decision = admit("room-steer", {
        speakerPresent: Boolean(speaker),
        engineCanSteer: Boolean(instance?.adapter.capabilities.queueing && instance.adapter.steer),
        isQueueHead: Boolean(head && head.id === m[2]),
      });
      if (decision.action === "refuse") {
        restoreHeldChannelQueue(held);
        return json(res, 409, { error: "only the first queued message can steer" });
      }
      if (decision.action === "queue") {
        restoreHeldChannelQueue(held);
        return json(res, 200, { ok: true, queued: true, threadId: targetThreadId });
      }
      // A reply target that cannot be resolved restores the held queue
      // before the request fails — the room's normal drain keeps the head.
      const replyTo = resolveHeldReplyTarget(held, resolveReplyTarget);
      // Each burst line keeps its own reply relationship: the fold renders
      // per-item reply context (the head through the helper above, the rest
      // resolved here) so a mixed burst does not inherit the head's quote
      // or drop its own. A target that cannot be resolved restores the held
      // queue before the request fails, mirroring the helper's contract.
      const speakerName = profileName();
      let foldedPrompt: string;
      try {
        foldedPrompt = headGroup
          .map((item, index) =>
            promptWithReply(
              item.text,
              index === 0
                ? replyTo
                : item.replyToId
                  ? resolveReplyTarget(targetThreadId, item.replyToId)
                  : undefined,
              speakerName,
            ),
          )
          .join("\n\n");
      } catch (error) {
        restoreHeldChannelQueue(held);
        throw error;
      }
      // steer was offered only when a live speaker instance could take it;
      // the check carries that invariant to the type system.
      const steered: SteerOutcome = instance?.adapter.steer
        ? await instance.adapter
            .steer(targetThreadId, foldedPrompt)
            .catch((): SteerOutcome => "indeterminate")
        : "refused";
      // The steer was awaited adapter work: re-read every ownership
      // invariant before writing anything, exactly like the 1:1 path. A
      // speaker change, a channel switch, or a settled room restores the
      // queue instead of recording words the new turn never saw.
      const after = store.group(current.id);
      const afterSpeakerBotId = after
        ? groupSpeakerBotId(targetThreadId) ??
          (targetThreadId === after.threadId ? after.busyBotId : undefined)
        : undefined;
      // "indeterminate" (timeout after delivery, lost transport, a settle
      // race) never restores: the words may already be folded into the turn
      // that was live when they were sent, and replaying them into a new
      // turn would run them twice. Record them once — even under a new
      // speaker — and settle the head.
      const delivered = steered !== "refused";
      if (after && delivered && (steered === "indeterminate" || afterSpeakerBotId === speakerBotId)) {
        const messages = headGroup.map((item) => store.appendMessage(targetThreadId, {
          role: "user",
          kind: "text",
          text: item.text,
          replyToId: item.replyToId,
          sendId: item.sendId,
          channelMode: item.mode,
          queueId: item.id,
          via: item.via,
          steered: true,
          sender: item.sender,
        }));
        settleHeldChannelQueueHead(held);
        return json(res, 200, {
          ok: true,
          steered: true,
          threadId: targetThreadId,
          messages,
          queueIds: headGroup.map((item) => item.id),
        });
      }
      if (steered === "indeterminate" && !after) {
        // The room vanished while the answer was lost: settle the head so a
        // restart cannot replay words the dead turn may already have run.
        settleHeldChannelQueueHead(held);
        return json(res, 404, { error: "no such room" });
      }
      restoreHeldChannelQueue(held);
      // The room may have settled while the steer was refused; a queue that
      // is now drainable must not strand behind a missed settle.
      if (after && !groupIsWorking(after)) drainQueuedChannelSends();
      return json(res, 200, { ok: true, queued: true, threadId: targetThreadId });
    }
    m = path.match(/^\/api\/groups\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const group = store.group(m[1]);
      if (!group) return json(res, 404, { error: "no such room" });
      const rawBody = await readBody(req);
      if (rawBody !== null && (typeof rawBody !== "object" || Array.isArray(rawBody))) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const body = rawBody ?? {};
      if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId))) {
        return json(res, 400, { error: "threadId must be a task id" });
      }
      if (body.threadId !== undefined) {
        const ownsThread = group.dm
          ? body.threadId === group.threadId
          : Boolean(store.groupTaskByThread(group.id, body.threadId));
        if (!ownsThread) {
          return json(res, 409, { error: "the channel switched tasks before it could be interrupted" });
        }
      }
      const activeOperations = activeGroupOperations(group.id).filter((operation) => !operation.cancelled);
      // Without an explicit task, Stop means the room's live operation—not
      // merely whichever task the UI was showing when a detached routine
      // began. There is normally one operation; cancel every active thread
      // defensively so no queued handoff survives a room-level stop.
      const targetThreadIds = body.threadId !== undefined
        ? [body.threadId]
        : activeOperations.length > 0
          ? [...new Set(activeOperations.map((operation) => operation.threadId))]
          : [group.threadId];
      await stopGroupThreads(group, targetThreadIds);
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
