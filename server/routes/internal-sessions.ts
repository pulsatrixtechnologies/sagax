// Internal harness routes for sessions and files (#1388 slice I4):
// agents, threads (+ close), attach-file, vm-exec, rooms, session-search,
// session-read, skills, skills/stage.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
import { ATTACHMENTS_DIR, deleteAttachment } from "../attachments.ts";
import { attachForTurn, saveBotAttachment } from "../bot-attachment.ts";
import { VM_WORKSPACE_GUEST } from "../computer/container-computer.ts";
import type { DirectApply } from "../direct-apply.ts";
import type { BotActivity } from "../../shared/wire.ts";
import type { RosterMember } from "../peer-roster.ts";
import { recallMessages, recentMessages, readMessageText } from "../message-db.ts";
import type { MemoryDestination } from "../memory/memory-audience.ts";
import { webhookPostText } from "../peer-provenance.ts";
import { peerStatus, peerStatusWords, reachablePeers } from "../peer-roster.ts";
import { claimRecallCrossings, recallCrossingLabel } from "../recall-disclosure.ts";
import { sessionMemoryHitFor } from "../recall.ts";
import { parseSince, parseUntil } from "../recent-work.ts";
import { learnSource } from "../skill-learn.ts";
import { skillDiscoveryPage } from "../skill-discovery.ts";
import {
  applySkillWriteWithReceipt,
  listSkills,
  listStagedSkillWrites,
  readSkillFile,
  rejectStagedSkillWrite,
  stageSkillWrite,
} from "../skills.ts";
import { queuedThreadPosition } from "../turns/steer-queue.ts";
import { searchMemoryFiles } from "../workspace.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

/** Cap on attach_file calls per automated turn (person-direct turns are uncapped). */
const MAX_ATTACHED_FILES_PER_TURN = 10;
/** Truncation for session_read message bodies. */
const SESSION_READ_MAX_CHARS = 8_000;

export interface InternalSessionsBot extends RosterMember {
  color: string;
  modelSelection: { model?: string };
  threadId?: string;
  tasks?: Array<{ threadId: string }>;
  memoryEnabled?: boolean;
  activity?: BotActivity;
}

export interface InternalSessionsTask {
  threadId: string;
  title: string;
  activity?: string;
  unread?: boolean;
  openedBy?: { botId?: string; at: number; delegationId?: string };
  createdAt: number;
  closedBy?: { botId: string; name: string; at: number };
}

export interface InternalSessionsGroup {
  id: string;
  name: string;
  memberIds: string[];
  dm?: boolean;
  threadId: string;
  tasks?: Array<{ threadId: string; title?: string }>;
}

/** Opaque Local VM handle for attach/exec; index wires the real target. */
export type InternalSessionsVm = { workspaceDir: string };

export interface InternalSessionsDeps {
  bot(id: string): InternalSessionsBot | null | undefined;
  bots(): readonly InternalSessionsBot[];
  tasks(botId: string): readonly InternalSessionsTask[];
  taskByThread(botId: string, threadId: string): InternalSessionsTask | null | undefined;
  groups(): readonly InternalSessionsGroup[];
  groupByThread(threadId: string): InternalSessionsGroup | null | undefined;
  isConfidentialThread(threadId: string): boolean;
  ownsThread(botId: string, threadId: string): { group?: InternalSessionsGroup } | null;
  threadBusy(botId: string, threadId: string): boolean;
  awaitingAnswer(threadId: string): boolean;
  activeDirect(threadId: string): boolean;
  appendMessage(threadId: string, message: unknown): unknown;
  patchTask(botId: string, threadId: string, patch: { unread?: boolean }): void;
  setTaskClosedBy(botId: string, threadId: string, closedBy: { botId: string; name: string; at: number }): void;
  roomPostEligibility(bot: InternalSessionsBot, group: InternalSessionsGroup): { ok: true } | { ok: false; status: number; error: string };
  attachmentVm(capability: InternalCapabilityView): Promise<InternalSessionsVm | undefined>;
  personDirectTurn(bot: InternalSessionsBot, threadId: string): boolean;
  messageFileRoots(botId: string, threadId: string): string[];
  dataDir(): string;
  isActive(capability: InternalCapabilityView & { localVmTarget?: InternalSessionsVm }): boolean;
  requireActive(capability: InternalCapabilityView): void;
  computerHeld(botId: string): boolean;
  commandVariables(botId: string, threadId: string): Record<string, string>;
  touchVmIdle(vm: InternalSessionsVm): void;
  containerRuntime(): Promise<string | undefined>;
  containerExec(
    vm: InternalSessionsVm,
    command: string,
    opts: { runtime: string; timeoutSeconds?: number; commandVariables: Record<string, string> },
  ): Promise<unknown>;
  roomFeedsBot(group: InternalSessionsGroup, bot: Pick<InternalSessionsBot, "visibility">): boolean;
  privateRecallFilter(bot: InternalSessionsBot, threadId: string): ((candidate: string) => boolean) | null;
  turnSpeaker(threadId: string): string | undefined;
  localPrincipalId(): string;
  isPerspicax(): boolean;
  runningTurnInstance(bot: InternalSessionsBot, threadId: string): { driverKind: string } | null | undefined;
  scopedSkillInventory(
    bot: InternalSessionsBot,
    instance: { driverKind: string } | null | undefined,
    person: string,
  ): { rows: Parameters<typeof skillDiscoveryPage>[0]; incomplete: boolean };
  stagedSkillListing(staged: ReturnType<typeof listStagedSkillWrites>[number]): unknown;
  skillAuthoringEnabled(): boolean;
  vaultPrincipal(threadId: string): string | null;
  personalFeatureOn(feature: "skillAuthoring", installation: boolean, principalId: string | null | undefined): boolean;
  appliesDirectly(botId: string, threadId: string, targetBotId: string): DirectApply | null;
  skillProposalPersistence(botId: string, threadId: string, opensCard: boolean):
    | { ok: true }
    | { ok: false; status: number; error: string };
  recordSkillLearned(threadId: string, skillName: string): void;
  keptCardRule(
    bot: InternalSessionsBot,
    threadId: string,
    candidate: { tool: string; scope: Record<string, string> },
    classes: readonly string[],
  ): { id: string } | undefined;
  appendSkillRequestCard(args: {
    botId: string;
    threadId: string;
    staged: {
      id: string;
      action: "create" | "update";
      name: string;
      gist: string;
      source: string;
      files: Array<{ path: string; content: string }>;
      sha256: string;
      warnings: string[];
    };
    applied?: boolean;
    previous?: { preview: string; source: string };
    ownerRule?: { tool: string; scope: Record<string, string>; description: string };
  }): { requestId: string; summary: string };
  appendDecision(row: Record<string, unknown>): void;
}

function skillRuleCandidate(staged: { action: "create" | "update"; name: string; sha256: string }): {
  tool: string;
  scope: Record<string, string>;
  description: string;
} {
  return {
    tool: "sagax:skill",
    scope: { action: staged.action, skill: staged.name, content: staged.sha256 },
    description: `${staged.action === "create" ? "Enable" : "Update"} the skill "${staged.name}" with this exact content`,
  };
}

export function createInternalSessionsRoutes(deps: InternalSessionsDeps): InternalRouteHandler {
  return async (ctx) => {
    const { res, path, method, json, capability, readBody, url } = ctx;
    const internalSender = deps.bot(capability.botId);
    if (!internalSender) return PASS;

    const discloseRecall = (bot: InternalSessionsBot, roomThreadId: string, sourceThreadIds: readonly string[]): void => {
      const crossing = claimRecallCrossings(roomThreadId, sourceThreadIds);
      if (!crossing.count) return;
      deps.appendMessage(roomThreadId, {
        role: "bot",
        kind: "activity",
        from: { botId: bot.id, name: bot.name, color: bot.color },
        tool: { name: recallCrossingLabel(bot.name, crossing.count), ok: true },
      });
    };

    if (method === "GET" && path === "/api/internal/agents") {
      const sender = internalSender;
      // title/description included so the caller can judge the team (who
      // does what, who has no job description yet). Every bot reads this
      // now, not just the Primary Bot, so it answers the same reachability
      // question the roster does — same peers, same order.
      const bots = reachablePeers(deps.bots(), sender)
        .map((b) => {
          const status = peerStatus(b.activity, b.busy);
          return {
            id: b.id,
            name: b.name,
            section: b.section?.trim() || "",
            model: b.modelSelection.model || "aucun moteur",
            busy: !!b.busy,
            status,
            statusText: peerStatusWords(status),
            title: b.title || undefined,
            description: b.description || undefined,
          };
        });
      return json(res, 200, { bots });
    }
    // Nothing else ever tells a bot a room id, so this is the discovery
    // half of post_to_room: it lists exactly the rooms that tool would
    // accept, resolved from the sender's own membership. A room a post
    // would be refused for gets no id — an id would only teach the model
    // to keep trying — but it is still NAMED, with the refusal it would
    // have met. Without that the bot can only say it is in no room at
    // all, while the person is looking at it in that very room.
    // list_threads: the caller's own threads, plus — on every peer it can
    // reach — only the threads the caller itself opened. A peer's other
    // threads are its own business (and the person's), so the scope is
    // "what you started", never "what that bot is doing". State is read
    // the way the sidebar reads it, so the bot and the person agree.
    if (method === "GET" && path === "/api/internal/threads") {
      const from = internalSender;
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const rows: Array<{
        threadId: string; botId: string; botName: string; title: string;
        state: "running" | "waiting-on-you" | "queued" | "idle" | "closed";
        unread: boolean; openedAt: number; delegationId?: string; own: boolean;
      }> = [];
      const stateOf = (bot: InternalSessionsBot, task: InternalSessionsTask) => {
        // A teammate that ended on a NEEDS INPUT question waits on the
        // person too, though its turn is over and nothing marks the task.
        if (task.activity === "waiting-on-you" || deps.awaitingAnswer(task.threadId)) return "waiting-on-you" as const;
        if (deps.threadBusy(bot.id, task.threadId)) return "running" as const;
        if (queuedThreadPosition(bot.id, task.threadId) !== null) return "queued" as const;
        if (deps.activeDirect(task.threadId)) return "queued" as const;
        if (task.closedBy) return "closed" as const;
        return "idle" as const;
      };
      // On a Cloud home a turn that may use the lent Mac sees only the
      // conversations the owner alone opened and wrote in: a title is words
      // too (cloudLendingView).
      const shown = (_threadId: string) => true;
      // A confidential thread is listed in itself only: its title is words too.
      const listable = (threadId: string) => threadId === fromThreadId || !deps.isConfidentialThread(threadId);
      for (const task of deps.tasks(from.id)) {
        if (!shown(task.threadId) || !listable(task.threadId)) continue;
        rows.push({
          threadId: task.threadId, botId: from.id, botName: from.name, title: task.title,
          state: stateOf(from, task), unread: task.unread === true, openedAt: task.openedBy?.at ?? task.createdAt,
          delegationId: task.openedBy?.delegationId, own: true,
        });
      }
      for (const peer of reachablePeers(deps.bots(), from)) {
        for (const task of deps.tasks(peer.id)) {
          if (task.openedBy?.botId !== from.id || !shown(task.threadId) || !listable(task.threadId)) continue;
          rows.push({
            threadId: task.threadId, botId: peer.id, botName: peer.name, title: task.title,
            state: stateOf(peer, task), unread: task.unread === true, openedAt: task.openedBy!.at,
            delegationId: task.openedBy.delegationId, own: false,
          });
        }
      }
      rows.sort((a, b) => b.openedAt - a.openedAt);
      return json(res, 200, { threads: rows.slice(0, 100) });
    }
    // close_thread: a bot tidies a thread it opened (or one of its own)
    // once its result has been read. Closing is the sidebar's idle state
    // plus a chip saying who closed it — never a deletion, which stays a
    // person's confirmed action, and never while the thread is running.
    const closeMatch = method === "POST" ? path.match(/^\/api\/internal\/threads\/([\w-]+)\/close$/) : null;
    if (closeMatch) {
      const from = internalSender;
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const threadId = closeMatch[1]!;
      const owner = [from, ...reachablePeers(deps.bots(), from)].find((bot) => deps.taskByThread(bot.id, threadId));
      const task = owner ? deps.taskByThread(owner.id, threadId) : undefined;
      if (!owner || !task) return json(res, 404, { error: "no such thread — call list_threads for the ones you can see" });
      if (owner.id !== from.id && task.openedBy?.botId !== from.id) {
        return json(res, 403, { error: "that thread is not yours to close — only the bot that opened it, or its own bot, can" });
      }
      if (threadId === fromThreadId) return json(res, 400, { error: "you cannot close the thread you are speaking in — finish your turn instead" });
      if (deps.awaitingAnswer(threadId)) {
        return json(res, 409, { error: `#${task.title} is waiting on the person's answer to its question; it continues once they reply there, so leave it open` });
      }
      if (deps.threadBusy(owner.id, threadId) || queuedThreadPosition(owner.id, threadId) !== null || deps.activeDirect(threadId)) {
        return json(res, 409, { error: `#${task.title} is still running — wait for it to finish (list_threads), or the person can stop it from the app` });
      }
      // Closing twice is not an error and leaves no second chip: the
      // thread is already folded away, so there is nothing more to do.
      if (task.closedBy) {
        return json(res, 200, { closed: true, alreadyClosed: true, threadId, title: task.title, botName: owner.name, closedBy: task.closedBy.name });
      }
      deps.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        from: { botId: from.id, name: from.name, color: from.color },
        tool: { name: `Closed by @${from.name}`, ok: true },
      });
      if (task.unread) deps.patchTask(owner.id, threadId, { unread: false });
      // The stamp is what the sidebar folds on and what list_threads
      // reports; the chip above is only the transcript's record of it.
      deps.setTaskClosedBy(owner.id, threadId, { botId: from.id, name: from.name, at: Date.now() });
      return json(res, 200, { closed: true, threadId, title: task.title, botName: owner.name });
    }
    if (method === "POST" && path === "/api/internal/attach-file") {
      const from = internalSender;
      const threadId = capability.threadId;
      const source = deps.ownsThread(from.id, threadId);
      if (!source) return json(res, 403, { error: "source conversation does not belong to sender" });
      const body = await readBody();
      const requestedPath = typeof body.path === "string" ? body.path : "";
      const requestedName = typeof body.name === "string" ? body.name : undefined;
      try {
        const vm = await deps.attachmentVm(capability);
        // The cap is an anti-loop limit for automated turns; the person's
        // own request attaches what they asked for.
        const outcome = await attachForTurn(capability, deps.personDirectTurn(from, threadId) ? Number.POSITIVE_INFINITY : MAX_ATTACHED_FILES_PER_TURN, {
          save: () => {
            // The agents capability carries no VM; the thread's claimed desktop does.
            return saveBotAttachment({
              path: requestedPath,
              name: requestedName,
              // The attachment store is not a source: only the bot's own files are.
              roots: deps.messageFileRoots(from.id, threadId).filter((root) => root !== ATTACHMENTS_DIR),
              ...(vm ? { guest: { root: VM_WORKSPACE_GUEST, host: vm.workspaceDir } } : {}),
              // A file this turn saved where the person asked, outside those
              // folders: one copy, so it opens from chat on any device. The
              // data dir holds every bot's memory and the app's own state.
              ...(capability.deliversSavedFiles && capability.turnStartedAt !== undefined
                ? { savedThisTurn: { since: capability.turnStartedAt, refuse: [deps.dataDir()] } }
                : {}),
            });
          },
          // The copy is awaited: the turn may have been stopped, replaced or
          // deleted, or the bot removed from the room, before it finished.
          stillLive: () => deps.isActive({ ...capability, ...(vm ? { localVmTarget: vm } : {}) }) &&
            deps.ownsThread(from.id, threadId) !== null,
          publish: (saved) => {
            deps.appendMessage(threadId, {
              role: "bot",
              kind: "text",
              text: "",
              attachments: [saved.attachment],
              ...(source.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
            });
          },
          // Each save gets its own stored file, so an unpublished one is ours to remove.
          discard: (saved) => deleteAttachment(saved.attachment.path),
        });
        if (outcome.status === "limit") {
          return json(res, 429, { error: `You already attached ${MAX_ATTACHED_FILES_PER_TURN} files this turn. Put the rest in one document or archive summary instead.` });
        }
        if (outcome.status === "ended") {
          return json(res, 409, { error: "This turn ended before the file could be attached, so nothing was posted." });
        }
        const { saved } = outcome;
        const label = saved.attachment.kind === "file"
          ? saved.attachment.name
          : (requestedName?.trim() || requestedPath.split(/[\\/]/).at(-1) || "image");
        return json(res, 200, { ok: true, name: label, bytes: saved.bytes });
      } catch (error) {
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
        const message = status === 404
          ? `No file was found at ${requestedPath}. Save it under /home/cua/workspace (or your working folder) and pass its exact path.`
          : error instanceof Error ? error.message : "could not attach that file";
        return json(res, status, { error: message });
      }
    }
    if (method === "POST" && path === "/api/internal/vm-exec") {
      const threadId = capability.threadId;
      if (!deps.ownsThread(internalSender.id, threadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const body = await readBody();
      // Only the desktop this thread has claimed for the running turn; a bot
      // without one has nothing to run a command in.
      try {
        const vm = await deps.attachmentVm(capability);
        if (!vm) return json(res, 409, { error: "You have no Local VM desktop in this turn, so there is nowhere to run a command." });
        const runtime = await deps.containerRuntime();
        deps.requireActive(capability);
        if (!runtime || !deps.isActive({ ...capability, localVmTarget: vm }) ||
            deps.computerHeld(internalSender.id)) {
          return json(res, 409, { error: "The Local VM is no longer available to this turn." });
        }
        const result = await deps.containerExec(vm, typeof body.command === "string" ? body.command : "", {
          runtime,
          timeoutSeconds: typeof body.timeout_seconds === "number" ? body.timeout_seconds : undefined,
          commandVariables: deps.commandVariables(capability.botId, threadId),
        });
        deps.touchVmIdle(vm);
        return json(res, 200, result);
      } catch (error) {
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
        return json(res, status, { error: error instanceof Error ? error.message : "could not run the command" });
      }
    }
    if (method === "GET" && path === "/api/internal/rooms") {
      const from = internalSender;
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const rooms: Array<{ id: string; name: string; members: string[] }> = [];
      const unpostable: Array<{ name: string; reason: string }> = [];
      for (const group of deps.groups()) {
        if (group.dm || !group.memberIds.includes(from.id)) continue;
        const eligibility = deps.roomPostEligibility(from, group);
        if (!eligibility.ok) {
          unpostable.push({ name: group.name, reason: eligibility.error });
          continue;
        }
        rooms.push({
          id: group.id,
          name: group.name,
          members: group.memberIds
            .map((id) => deps.bot(id))
            .filter((member): member is InternalSessionsBot => Boolean(member))
            .map((member) => member.name),
        });
      }
      return json(res, 200, { rooms: rooms.slice(0, 50), unpostable: unpostable.slice(0, 50) });
    }
    // session_search: ranked recall over the calling bot's OWN threads,
    // every task included. Own-bot only, on purpose — a bot's transcripts
    // are its notebook the same way MEMORY.md is (section-context.ts draws
    // that line), and search across bots would be an isolation change.
    // Announce in the room that a bot reached outside it. Silent when the
    // room has already been told about that thread, so a bot searching
    // three times in one turn leaves one chip per source, not per search.
    if (method === "GET" && path === "/api/internal/session-search") {
      const fromBotId = String(url!.searchParams.get("fromBotId") ?? "");
      const from = deps.bot(fromBotId);
      if (!from) return json(res, 403, { error: "unknown sender" });
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const q = String(url!.searchParams.get("q") ?? "").trim();
      // A recall by time needs no words: "what happened since yesterday"
      // is the standup question, and it has no keyword.
      const now = Date.now();
      const sinceRaw = url!.searchParams.get("since");
      const untilRaw = url!.searchParams.get("until");
      const since = sinceRaw ? parseSince(sinceRaw, now) : null;
      const until = untilRaw ? parseUntil(untilRaw, now) : null;
      if (sinceRaw && since === null) return json(res, 400, { error: "since must be a date, or a span like 24h, 3d, today, yesterday" });
      if (untilRaw && until === null) return json(res, 400, { error: "until must be a date, or a span like 24h, 3d, today, yesterday" });
      if (!q && since === null) return json(res, 400, { error: "q or since is required" });
      const range = since !== null || until !== null
        ? { ...(since !== null ? { since } : {}), ...(until !== null ? { until } : {}) }
        : undefined;
      const rawLimit = Number(url!.searchParams.get("limit"));
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 25) : 12;
      // Memory files ride along by default: the bot's own notes are as
      // much its notebook as its transcripts, and scoped the same way —
      // the caller's own bot, never another's. A recall by time alone
      // has no words to match a file with.
      const scope = url!.searchParams.get("scope") ?? "all";
      if (scope !== "all" && scope !== "conversations" && scope !== "memory") {
        return json(res, 400, { error: "scope must be all, conversations, or memory" });
      }
      const searchPlace = deps.groupByThread(fromThreadId);
      // A room or a group is wider than the person's own file. A line
      // stamped for the person does not come out. A line with no stamp stays.
      const searchAudience: MemoryDestination | undefined = searchPlace ? { kind: "room", id: searchPlace.id } : undefined;
      const foundMemory = scope === "conversations" || !q || from.memoryEnabled === false ? [] : searchMemoryFiles(from.id, q, limit);
      const memoryHits = searchAudience
        ? foundMemory.flatMap((hit) => {
          const shown = sessionMemoryHitFor(from.id, hit, searchAudience);
          return shown ? [shown] : [];
        })
        : foundMemory;
      if (scope === "memory") return json(res, 200, { hits: [], memoryHits });
      // Own threads: the bot's main chat and tasks, and the rooms it is a
      // member of with their tasks — conversations it already saw in full.
      // Still own-bot: another bot's threads never enter this list.
      const roomByThread = new Map<string, InternalSessionsGroup>();
      for (const group of deps.groups()) {
        // A room fewer people can see than this bot stays out of its recall
        // (bot-visibility.ts roomFeeds): its lines would otherwise reach them.
        if (!group.memberIds.includes(from.id) || !deps.roomFeedsBot(group, from)) continue;
        roomByThread.set(group.threadId, group);
        for (const task of group.tasks ?? []) roomByThread.set(task.threadId, group);
      }
      // Organization server: the person of this turn's own threads only.
      const recallAllow = deps.privateRecallFilter(from, fromThreadId);
      const ownThreads = [...new Set([from.threadId, ...(from.tasks ?? []).map((task) => task.threadId), ...roomByThread.keys()])].filter((id): id is string => Boolean(id))
        // On a Cloud home a turn that may use the lent Mac searches only the
        // conversations the owner alone opened and wrote in.
        .filter((id) => !recallAllow || recallAllow(id));
      // A room is the only place a recall can be a disclosure, and only a
      // private chat is one: in a 1:1 the user already owns every thread
      // the bot can reach, and a room's lines were said in the open.
      const inRoom = Boolean(deps.groupByThread(fromThreadId));
      const found = q ? recallMessages(q, ownThreads, limit, range) : recentMessages(ownThreads, range ?? {}, limit);
      const hits = found.map((hit) => {
        const room = roomByThread.get(hit.threadId);
        return {
          ...hit,
          task: room
            ? (room.tasks ?? []).find((task) => task.threadId === hit.threadId)?.title
            : deps.taskByThread(from.id, hit.threadId)?.title,
          ...(room ? { room: room.name } : {}),
          current: hit.threadId === fromThreadId,
          crossed: inRoom && !room && hit.threadId !== fromThreadId,
        };
      });
      if (inRoom) {
        discloseRecall(from, fromThreadId, hits.filter((hit) => hit.crossed).map((hit) => hit.threadId));
      }
      return json(res, 200, { hits, memoryHits });
    }
    // session_read: the whole message behind a session_search hit. Same
    // own-bot scope — a message id from another bot's thread reads as
    // missing, not as forbidden, so the id space leaks nothing.
    if (method === "GET" && path === "/api/internal/session-read") {
      const fromBotId = String(url!.searchParams.get("fromBotId") ?? "");
      const from = deps.bot(fromBotId);
      if (!from) return json(res, 403, { error: "unknown sender" });
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const threadId = String(url!.searchParams.get("threadId") ?? "").trim();
      const messageId = String(url!.searchParams.get("messageId") ?? "").trim();
      if (!threadId || !messageId) return json(res, 400, { error: "threadId and messageId are required" });
      const readAllow = deps.privateRecallFilter(from, fromThreadId);
      const own = (threadId === from.threadId || Boolean(deps.taskByThread(from.id, threadId))) &&
        (!readAllow || readAllow(threadId));
      const message = own ? readMessageText(threadId, messageId) : null;
      if (!message) return json(res, 404, { error: "no such message in your conversations" });
      const readInRoom = Boolean(deps.groupByThread(fromThreadId));
      const readCrossed = readInRoom && threadId !== fromThreadId;
      if (readCrossed) discloseRecall(from, fromThreadId, [threadId]);
      // An outside app wrote a webhook line: read back with its note, never as the bot's own words.
      const readText = message.webhook ? webhookPostText(from.name, message.text) : message.text;
      return json(res, 200, {
        ...message,
        crossed: readCrossed,
        text: readText.length > SESSION_READ_MAX_CHARS ? `${readText.slice(0, SESSION_READ_MAX_CHARS)}…` : readText,
        task: deps.taskByThread(from.id, threadId)?.title,
      });
    }
    if (method === "GET" && path === "/api/internal/skills") {
      const from = internalSender;
      if (!deps.ownsThread(from.id, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
      const query = url!.searchParams.get("query") ?? "";
      const offset = Number(url!.searchParams.get("offset") ?? 0);
      if (query.length > 200 || !Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error: "query must be at most 200 characters and offset a nonnegative integer" });
      const person = deps.isPerspicax() ? deps.turnSpeaker(capability.threadId) ?? "" : deps.localPrincipalId();
      const instance = deps.runningTurnInstance(from, capability.threadId);
      const inventory = deps.scopedSkillInventory(from, instance, person);
      return json(res, 200, {
        ...skillDiscoveryPage(inventory.rows, query, offset),
        incomplete: inventory.incomplete,
        staged: listStagedSkillWrites(from.id).map((s) => deps.stagedSkillListing(s)),
      });
    }
    if (method === "POST" && path === "/api/internal/skills/stage") {
      if (!deps.personalFeatureOn("skillAuthoring", deps.skillAuthoringEnabled(), deps.vaultPrincipal(capability.threadId))) return json(res, 403, { error: "skill authoring is not enabled in Settings" });
      if (!capability.skillAuthoring) {
        return json(res, 403, { error: "skill authoring is not enabled for this turn" });
      }
      const body = await readBody();
      const from = internalSender;
      const fromThreadId = capability.threadId;
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      // Skills written here are always the sender's own, so they apply at
      // any level, with a one-line receipt and Undo (appliesDirectly).
      const direct = deps.appliesDirectly(from.id, fromThreadId, from.id);
      const persistence = deps.skillProposalPersistence(from.id, fromThreadId, !direct);
      if (!persistence.ok) return json(res, persistence.status, { error: persistence.error });
      const action = body.action === "create" || body.action === "update" ? body.action : "";
      if (!action) return json(res, 400, { error: 'action must be "create" or "update"' });
      const skillMd = typeof body.skill_md === "string" ? body.skill_md : "";
      if (!skillMd.trim()) {
        return json(res, 400, { error: 'skill_manage needs skill_md: the full SKILL.md including YAML frontmatter, for example ---\\nname: file-expense\\ndescription: Files an expense in the company portal.\\n---\\n\\n# File expense\\n' });
      }
      const source = typeof body.source === "string" ? body.source.trim() : "";
      if (!source) return json(res, 400, { error: 'source must be a URL, folder, or "conversation"' });
      const targetName = typeof body.skill_name === "string" ? body.skill_name.trim() : "";
      if (action === "update" && !targetName) {
        return json(res, 400, { error: "skill_name is required when action is update" });
      }
      const staged = stageSkillWrite(from.id, {
        action,
        targetName: targetName || undefined,
        files: [{ path: "SKILL.md", content: skillMd }],
        gist: typeof body.gist === "string" ? body.gist : undefined,
        source: learnSource(source),
      });
      if ("error" in staged) return json(res, 422, { error: staged.error });
      // a skill written from a conversation (/learn) counts its uses for Skill Smith
      if (staged.action === "create" && source === "conversation") deps.recordSkillLearned(fromThreadId, staged.name);
      // 2026-10-19 ("Toujours permettre" on every card): Always allow on
      // a skill card keeps this skill with this exact content (a skill is
      // instructions the bot reads: new content always shows its card)
      const skillRule = skillRuleCandidate(staged);
      const skillKept = direct ? undefined : deps.keptCardRule(from, fromThreadId, skillRule, ["always-grant"]);
      if (direct || skillKept) {
        // What an update replaces, so Undo can put it back.
        const previousSkillMd = staged.action === "update" ? readSkillFile(from.id, staged.name) : null;
        const previousSource = listSkills(from.id).find((skill) => skill.name === staged.name)?.source;
        const previous = previousSkillMd !== null && previousSource ? { preview: previousSkillMd, source: previousSource } : undefined;
        const applied = applySkillWriteWithReceipt(from.id, staged, () => {
          const receipt = deps.appendSkillRequestCard({ botId: from.id, threadId: fromThreadId, staged, applied: true, previous });
          deps.appendDecision( { threadId: fromThreadId, requestId: receipt.requestId, botId: from.id, botName: from.name,
            tool: "stage_skill", summary: receipt.summary, decision: "auto-approved", source: direct || "owner-rule", ...(skillKept ? { rule: skillKept.id } : {}) });
        });
        if ("error" in applied) {
          rejectStagedSkillWrite(from.id, staged.id);
          return json(res, 422, { state: "failed", error: applied.error });
        }
        return json(res, 201, { state: "applied", stagedId: staged.id, name: staged.name, action: staged.action,
          gist: staged.gist, warnings: staged.warnings, ...applied, summary: `Skill ${staged.name} ${staged.action === "create" ? "enabled" : "updated"}.` });
      }
      let card: { requestId: string; summary: string };
      try {
        card = deps.appendSkillRequestCard({ botId: from.id, threadId: fromThreadId, staged, ownerRule: { tool: skillRule.tool, scope: skillRule.scope, description: skillRule.description } });
      } catch (error) {
        rejectStagedSkillWrite(from.id, staged.id);
        throw error;
      }
      deps.appendDecision( {
        threadId: fromThreadId,
        requestId: card.requestId,
        botId: from.id,
        botName: from.name,
        tool: "stage_skill",
        summary: card.summary,
        decision: "card-shown",
        source: "skill",
      });
      return json(res, 201, {
        state: "pending",
        stagedId: staged.id,
        name: staged.name,
        action: staged.action,
        gist: staged.gist,
        warnings: staged.warnings,
        summary: card.summary,
      });
    }

    return PASS;
  };
}
