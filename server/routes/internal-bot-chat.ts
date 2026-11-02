// Internal harness routes for bot-to-bot chat (#1388 slice I5a):
// ask-bot, delegations status, retry-thread, delegate-bot, room-targets, coordinate-bots.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
// startTurn and other turn runners are injected; this module never imports index.ts.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asideEnvelope, recordInjectedAside } from "../aside.ts";
import type { HandoffView } from "../coordinator.ts";
import type { SteerOutcome } from "../contracts.ts";
import { findDelegationReceipt, summarizeDelegatedActivity } from "../delegation-receipts.ts";
import { isEngineEmptyFailure } from "../incidents.ts";
import { peerApprovalFailure, requestPeerApproval, type ApprovalBus } from "../peer-approval.ts";
import { peerDeliveryReceipt, type PeerDeliveryReceipt } from "../peer-delivery.ts";
import { quoteInNote } from "../peer-provenance.ts";
import {
  PEER_ACCESS_HELP,
  canAccessBot,
  canReachPeer,
  peerAllowed,
  peerInScope,
  peerName,
  reachablePeers,
  resolveTeammate,
  type RosterMember,
} from "../peer-roster.ts";
import { requiresDecisionCard } from "../runtime/done-when.ts";
import { queuedThreadPosition } from "../steer-queue.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

const MAX_COMMS_DEPTH = 1;
const ASK_BOT_TIMEOUT_MS = Math.max(5_000, Number(process.env.SAGAX_ASK_BOT_TIMEOUT_MS) || 15_000);

export interface InternalBotChatBot extends RosterMember {
  color: string;
  title?: string;
  section?: string;
  hidden?: boolean;
  chiefOfStaff?: boolean;
  busy?: boolean;
  threadId?: string;
  modelSelection?: { model?: string; instanceId?: string; account?: string; auto?: boolean };
  visibility?: unknown;
  [key: string]: unknown;
}

export interface InternalBotChatGroup {
  id: string;
  name: string;
  memberIds: string[];
  threadId: string;
  dm?: boolean;
  cwd?: string | null;
  section?: string;
}

export interface InternalBotChatTask {
  threadId: string;
  title: string;
  confidential?: boolean;
}

export interface InternalBotChatMessage {
  id?: string;
  role?: string;
  kind?: string;
  text?: string;
  turnSucceeded?: boolean;
  at?: number;
  [key: string]: unknown;
}

export interface InternalBotChatStore {
  bot(id: string): InternalBotChatBot | null | undefined;
  readonly bots: readonly InternalBotChatBot[];
  group(id: string): InternalBotChatGroup | null | undefined;
  groupByThread(threadId: string): InternalBotChatGroup | null | undefined;
  readonly groups: readonly InternalBotChatGroup[];
  taskByThread(botId: string, threadId: string): InternalBotChatTask | null | undefined;
  activePath(threadId: string): ReadonlyArray<{ turnSucceeded?: boolean; at?: number }>;
  appendMessage(threadId: string, message: Record<string, unknown>): unknown;
  messagesFor(threadId: string): readonly InternalBotChatMessage[];
  createTask(...args: unknown[]): { threadId: string; title: string } | null | undefined;
  deleteTask(botId: string, threadId: string): void;
  workThread(botId: string, fromBotId: string, fromThreadId: string): { threadId: string; title?: string } | null | undefined;
}

export interface InternalBotChatCoordinator {
  node(taskId: string): { status: string; result: string; executions: number; id?: string; botId?: string; threadId?: string; [key: string]: unknown } | null | undefined;
  has(taskId: string): boolean;
  enqueue(...args: unknown[]): { node: { id: string; botId: string; threadId: string; status: string; [key: string]: unknown }; duplicate?: boolean; joined?: boolean };
  tick(): void;
}

export interface InternalBotChatDeps {
  store: InternalBotChatStore;
  startTurn: (
    botId: string,
    text: string,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;
  coordinator: InternalBotChatCoordinator;
  approvalBus: ApprovalBus;
  delegationWatch: Map<string, {
    toBotId: string;
    toBotName?: string;
    taskId: string;
    sourceThreadId: string;
    startedAtMs?: number;
    [key: string]: unknown;
  }>;
  phoneToolTaintedThreads: Set<string>;
  incidentLedger: {
    lastAt(threadId: string): number | undefined;
    countInWindow(threadId: string): number;
  };
  threadStarters: Map<string, string | undefined>;
  directRequestOwners: Map<string, { messageId?: string } | undefined>;
  engineEligibility(bot: InternalBotChatBot): string | undefined;
  connectorThread(botId: string, threadId: string): { group?: InternalBotChatGroup } | null;
  pollOnlyCaller(capability: InternalCapabilityView): boolean;
  delegateOnRuntime(
    from: InternalBotChatBot,
    target: InternalBotChatBot,
    message: string,
    capability: InternalCapabilityView,
    delegatedThisTurn: (taskId: string) => void,
    pollRoot: boolean,
    kind: "consult" | "work",
    idempotencyKey?: string,
  ): Promise<[number, Record<string, unknown>]>;
  peerThreadFor(bot: InternalBotChatBot): string;
  threadBusy(botId: string, threadId: string): boolean;
  runningTurnInstance(bot: InternalBotChatBot, threadId: string): {
    adapter: { capabilities: { queueing?: boolean }; steer?: (threadId: string, prompt: string) => Promise<SteerOutcome> };
  } | null | undefined;
  orgJoinsRunningTurn(bot: InternalBotChatBot, threadId: string, speaker: unknown): boolean;
  peerSpeaker(fromBotId: string, fromThreadId?: string): unknown;
  isUnattended(botId?: string | null, threadId?: string): boolean;
  peerReviewRequired(bot: InternalBotChatBot, threadId: string): boolean;
  cloudGuestDriven(threadId: string): boolean;
  idempotencyKeyOf(body: Record<string, unknown>, header: string | string[] | undefined): string | undefined;
  runtimeDelegationStatus(
    taskId: string,
    from: InternalBotChatBot,
    fromThreadId: string,
    deadline: number,
  ): Promise<[number, Record<string, unknown>]>;
  openPersonCard(threadId: string): { kind: "approval" | "question" | "review"; tool?: string } | undefined;
  roomHandoffProblem(
    node: { groupId?: string; threadId: string; botId: string },
    parent?: { groupId?: string; threadId: string; botId: string },
  ): string | undefined;
  turnOrigin(capability: InternalCapabilityView): unknown;
  joinPerson(threadId: string): string | undefined;
  applyDelegatedLevel(from: InternalBotChatBot, fromThreadId: string, target: InternalBotChatBot, threadId: string): void;
  adoptReservedWorkThread(botId: string, threadId: string): void;
  openerFrom(fromThreadId: string): string | undefined;
  latestFailedTurnCause(threadId: string): string | null;
  requireActive(capability: InternalCapabilityView): void;
}

export function createInternalBotChatRoutes(deps: InternalBotChatDeps): InternalRouteHandler {
  return async (ctx) => {
    const { res, path, method, json } = ctx;
    const internalCapability = ctx.capability;
    const readInternalBody = ctx.readBody;
    const req = { headers: ctx.headers ?? {} };
    const store = deps.store;
    const {
      startTurn,
      coordinator,
      approvalBus,
      delegationWatch,
      phoneToolTaintedThreads,
      incidentLedger,
      threadStarters,
      directRequestOwners,
      engineEligibility,
      connectorThread,
      pollOnlyCaller,
      delegateOnRuntime,
      peerThreadFor,
      threadBusy,
      runningTurnInstance,
      orgJoinsRunningTurn,
      peerSpeaker,
      isUnattended,
      peerReviewRequired,
      cloudGuestDriven,
      idempotencyKeyOf,
      runtimeDelegationStatus,
      openPersonCard,
      roomHandoffProblem,
      turnOrigin,
      joinPerson,
      applyDelegatedLevel,
      adoptReservedWorkThread,
      openerFrom,
      latestFailedTurnCause,
    } = deps;
    const internalSender = store.bot(internalCapability.botId);
    if (!internalSender) return PASS;
    if (internalCapability.depth === undefined) internalCapability.depth = 0;
    if (!ctx.url) {
      // delegations long-poll reads wait_ms from the query string
    }
    const url = ctx.url ?? new URL(`http://local${path}`);
    const requireActiveInternalCapability = () => deps.requireActive(internalCapability);
    const delegatedThisTurn = (taskId: string) => {
      (internalCapability.delegatedThisTurn ??= new Set()).add(taskId);
    };

    if (method === "POST" && path === "/api/internal/ask-bot") {
      const body = await readInternalBody();
      const askBody = body;
      const fromBotId = internalSender.id;
      const toBotRef = String(body.toBotId ?? "");
      const message = String(body.message ?? "").trim();
      if (
        body.depth !== undefined &&
        (!Number.isInteger(body.depth) || Number(body.depth) < 0 || body.depth !== internalCapability.depth)
      ) {
        return json(res, 403, { error: "the recursion depth does not match this turn" });
      }
      const depth = internalCapability.depth ?? 0;
      if (!toBotRef || !message) return json(res, 400, { error: "toBotId and message required" });
      if (toBotRef === fromBotId) return json(res, 400, { error: "a bot cannot message itself" });
      if (depth >= MAX_COMMS_DEPTH) return json(res, 200, { error: "message chains are limited to one hop", receipt: peerDeliveryReceipt({
        botId: toBotRef, outcome: "failed", detail: "message chains are limited to one hop — the message was not sent",
      }) });
      // A unique reachable teammate name is accepted where an id is
      // expected; see resolveTeammate for why.
      const resolvedTo = resolveTeammate(store.bots, internalSender, toBotRef);
      if ("error" in resolvedTo) return json(res, 404, { error: `no such bot: ${resolvedTo.error}` });
      if (resolvedTo.id === fromBotId) return json(res, 400, { error: "a bot cannot message itself" });
      const toBotId = resolvedTo.id;
      const target = store.bot(toBotId);
      if (!target) return json(res, 404, { error: "no such bot" });
      // An unknown sender used to fall through: no mirroring AND no
      // approval, while still running the peer turn. That made an
      // unresolvable id the cheapest way past the gate, so it is now a
      // hard refusal — every peer turn has an accountable sender.
      const from = internalSender;
      if (!canAccessBot(from, target) || target.hidden || !peerInScope(from, target)) {
        return json(res, 403, { error: `that bot belongs to a different section or is unavailable. ${PEER_ACCESS_HELP}` });
      }
      // The sender's allow-list, when it has one. Checked here rather than
      // trusted from the roster: the tool call carries a bot id, and an id
      // the model held from an earlier turn must not outlive the grant.
      if (!peerAllowed(from, target)) {
        return json(res, 403, { error: `that bot is not on this bot's allowed peers. ${PEER_ACCESS_HELP}` });
      }
      // No usable engine: fall back at once, never queue work that cannot run.
      const noEngine = engineEligibility(target);
      if (noEngine) return json(res, 409, { error: noEngine });
      const fromThreadId = internalCapability.threadId;
      // Rooms are conversations too. The task-only lookup here refused every
      // ask made from a room turn — the bot could see its teammates and not
      // reach them — while create_bot and the routine endpoints already
      // accepted a group thread the sender belongs to. One ownership rule,
      // and it is still the sender's own membership that decides.
      if (!connectorThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source thread does not belong to sender" });
      }
      // Lot 3 (docs/runtime-contract.md §9): ask_bot is a coordinate_bots
      // consultation on the job runtime (act on nothing), whoever calls it.
      // From a turn the runtime resumes (a person's chat, a routine or
      // webhook run) the answer resumes the requester, answered in ask_bot's
      // busy shape with the runtime id.
      if (!pollOnlyCaller(internalCapability)) {
        const [status, out] = await delegateOnRuntime(from, target, message, internalCapability, delegatedThisTurn, false, "consult");
        // The person's review said no: ask_bot's own refusal shape.
        const review = Array.isArray(out.approvals) ? out.approvals[0] as ReturnType<typeof peerApprovalFailure> : undefined;
        if (review) return json(res, 200, { error: review.error, approvalOutcome: review.approvalOutcome, approvalSource: review.approvalSource,
          receipt: peerDeliveryReceipt({ botId: toBotId, botName: target.name, outcome: "failed", detail: `peer review ${review.error} — the message was not sent` }) });
        return json(res, status, out.queued ? { busy: true, taskId: out.taskId, toBotName: out.toBotName, receipt: out.receipt,
          message: `@${target.name} answers on the job runtime: end your turn; the answer resumes you automatically.` } : out);
      }
      // An external runtime, or a room turn its goal runs, has no turn the
      // runtime resumes (pollOnlyCaller). The aside lane first: the
      // ask addresses a conversation that is mid-turn on an engine with a
      // mid-turn seam, so the words fold into the live turn as enveloped
      // peer context (delivery, not queued work: no reply comes back). A
      // bot whose comms need review, a guest, another person's turn or a
      // seam that refuses go to the runtime consultation below instead.
      const tryAsideDelivery = async (): Promise<Record<string, unknown> | null> => {
        if (peerReviewRequired(from, fromThreadId) || cloudGuestDriven(fromThreadId)) return null;
        // never folded into a confidential thread (peerThreadFor)
        if (peerThreadFor(target) !== target.threadId || !threadBusy(toBotId, target.threadId)) return null;
        const instance = runningTurnInstance(target, target.threadId);
        if (!instance?.adapter.capabilities.queueing || !instance.adapter.steer) return null;
        // an organization server folds a peer's words into the running
        // turn only when both speak for the same person
        if (!orgJoinsRunningTurn(target, target.threadId, peerSpeaker(from.id, fromThreadId))) return null;
        const prompt = asideEnvelope(from.name, message);
        const outcome = await instance.adapter.steer(target.threadId, prompt).catch((): SteerOutcome => "indeterminate");
        // "indeterminate": the words may already run, never send them twice.
        if (outcome === "refused") return null;
        // another bot's words joined the owner's live turn: no phone tool in it
        phoneToolTaintedThreads.add(target.threadId);
        recordInjectedAside(store as never, target.threadId!, prompt, { botId: from.id, name: from.name, unattended: isUnattended(from.id, fromThreadId) });
        return { busy: true, aside: "injected" as const, toBotName: target.name,
          message: `@${target.name} is mid-turn; your message was handed to them as an aside — peer context folded into their current work. It is not a request for a reply: continue your plan and treat their next output as possibly informed by it.` };
      };
      if (target.busy) {
        const aside = await tryAsideDelivery();
        if (aside) return json(res, 200, aside);
      }
      // A consultation on a poll root (a retry with the same idempotency key
      // is the same request). Held for the person's review or behind a busy
      // peer, the caller polls its task id; otherwise the answer comes back
      // inline within ASK_BOT_TIMEOUT_MS, else a task id it polls.
      const [status, out] = await delegateOnRuntime(from, target, message, internalCapability, delegatedThisTurn, true, "consult",
        idempotencyKeyOf(askBody, req.headers["idempotency-key"]));
      if (!out.queued) return json(res, status, out);
      const taskId = String(out.taskId);
      const queuedReceipt = (detail: string) => peerDeliveryReceipt({ botId: toBotId, botName: target.name, outcome: "queued", taskId, detail });
      if (out.approvalRequired) return json(res, 200, { busy: true, taskId, toBotName: target.name,
        receipt: queuedReceipt("the ask waits on the user's approval; poll its task id") });
      const deadline = Date.now() + ASK_BOT_TIMEOUT_MS;
      for (;;) {
        requireActiveInternalCapability();
        const node = coordinator.node(taskId);
        if (!node) return json(res, 404, { error: "unknown task id" });
        if (["completed", "failed", "cancelled", "expired"].includes(node.status)) {
          const sender = store.bot(from.id);
          const peer = store.bot(toBotId);
          if (!sender || !peer || !canReachPeer(sender, peer)) {
            return json(res, 403, { error: "Result withheld: team access changed while the teammate was working" });
          }
          const ok = node.status === "completed";
          const expired = node.status === "expired";
          return json(res, 200, { botName: peer.name, text: node.result || (ok ? "(no reply text)" : expired ? "The wait on the person ran out" : "The teammate's turn did not finish"),
            receipt: peerDeliveryReceipt({ botId: toBotId, botName: peer.name, outcome: ok ? "injected" : node.executions > 0 ? "injected" : "failed",
              detail: ok ? "the teammate's turn ran to completion"
                : expired ? `the wait on the person ran out (status expired) — ${node.result.split("\n", 1)[0]!.slice(0, 120)}`
                : node.executions > 0 ? `the teammate's turn started and failed — ${node.result.split("\n", 1)[0]!.slice(0, 120)}`
                  : "the teammate's turn could not start — the message was not delivered" }) });
        }
        if (Date.now() >= deadline) {
          return json(res, 200, node.status === "queued"
            ? { busy: true, taskId, toBotName: target.name, receipt: queuedReceipt("the teammate was busy; the ask waits on the job runtime as a consultation") }
            : { timeout: true, taskId, toBotName: target.name, waitedMs: ASK_BOT_TIMEOUT_MS,
              receipt: peerDeliveryReceipt({ botId: toBotId, botName: target.name, outcome: "injected", taskId,
                detail: "the teammate's turn started and is still running; only the synchronous wait ended" }) });
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    // Async handoff: the source bot queues a task for a peer and goes
    // back to the user; the peer turn runs after the source's
    // turn.completed. Returns immediately (the caller does not wait).
    const delegationMatch = method === "GET" ? path.match(/^\/api\/internal\/delegations\/([\w-]{4,64})$/) : null;
    if (delegationMatch) {
      const taskId = delegationMatch[1];
      if (internalCapability.delegatedThisTurn?.has(taskId)) {
        return json(res, 409, { error: `Task ${taskId} was delegated during this turn. Finish your response now so the other bot can work; its result will be delivered to this conversation automatically. Do not check or wait for a newly delegated task until a later turn.` });
      }
      const fromThreadId = internalCapability.threadId;
      const from = internalSender;
      if (!connectorThread(from.id, fromThreadId)) return json(res, 403, { error: "unknown sender" });
      const waitMs = Math.min(Math.max(Number(url.searchParams.get("wait_ms")) || 0, 0), 240_000);
      const deadline = Date.now() + waitMs;
      // A task id delegate_bot's runtime adapter returned: the runtime's own record.
      if (coordinator.has(taskId)) return json(res, ...await runtimeDelegationStatus(taskId, from, fromThreadId, deadline));
      // Bounded long-poll: the delegating bot parks ONE cheap HTTP request
      // here instead of burning a model inference per status check.
      for (;;) {
        requireActiveInternalCapability();
        const receipt = findDelegationReceipt(taskId);
        if (receipt) {
          if (receipt.sourceThreadId !== fromThreadId) {
            return json(res, 403, { error: "that task belongs to a different conversation" });
          }
          const sender = store.bot(from.id);
          const target = store.bot(receipt.toBotId);
          if (!sender || (target && !canReachPeer(sender, target))) {
            return json(res, 403, { error: "Result withheld: team access changed while the teammate was working" });
          }
          return json(res, 200, {
            status: receipt.status, toBotName: receipt.toBotName, result: receipt.result ?? "",
            ...(receipt.workerModel ? { workerModel: receipt.workerModel } : {}),
          });
        }
        // A run_with_engine part still running after its synchronous wait.
        const runningEntry = [...delegationWatch.entries()].find(([, watch]) => watch.taskId === taskId);
        const running = runningEntry?.[1];
        const owner = running?.sourceThreadId;
        if (!owner) return json(res, 404, { error: "unknown task id — delegation receipts are kept for about 48 hours" });
        if (owner !== fromThreadId) return json(res, 403, { error: "that task belongs to a different conversation" });
        const toBotId = running?.toBotId ?? "";
        const sender = store.bot(from.id);
        const target = store.bot(toBotId);
        if (!sender || (target && !canReachPeer(sender, target))) {
          return json(res, 403, { error: "Result withheld: team access changed while the teammate was working" });
        }
        // Nothing moves while the teammate's card waits on the person, so
        // say so now rather than holding the long-poll to its deadline.
        const awaitingPerson = running && runningEntry ? openPersonCard(runningEntry[0]) : undefined;
        if (Date.now() >= deadline || awaitingPerson) {
          if (running && runningEntry) {
            const recent = summarizeDelegatedActivity(
              store.messagesFor(runningEntry[0]) as never,
              running.startedAtMs ?? Date.now(),
            );
            return json(res, 200, {
              status: "running",
              toBotName: store.bot(toBotId)?.name ?? toBotId,
              elapsedMs: Math.max(0, Date.now() - (running.startedAtMs ?? Date.now())),
              recentActivity: recent,
              ...(awaitingPerson ? {
                awaitingPerson: {
                  ...awaitingPerson,
                  threadTitle: store.taskByThread(toBotId, runningEntry[0])?.title,
                },
              } : {}),
            });
          }
          return json(res, 200, { status: "queued", toBotName: store.bot(toBotId)?.name ?? toBotId });
        }
        await new Promise((wake) => setTimeout(wake, 500));
      }
    }
    // A Primary Bot resumes a teammate's broken thread (server/incidents.ts): the
    // same thread, its conversation and files, one more turn, with a line
    // saying who asked and why. Primary Bot-only, for a teammate it can reach,
    // never a room (coordinate there) and never a thread still running.
    if (method === "POST" && path === "/api/internal/retry-thread") {
      const body = await readInternalBody();
      const from = internalSender;
      const fromThreadId = internalCapability.threadId;
      if (!from.chiefOfStaff || from.hidden) return json(res, 403, { error: "only a Primary Bot can retry a teammate's thread" });
      // `toBotId`/`toThreadId`: the guard above reads bare botId/threadId as
      // the caller's own identity, the way every internal route does.
      const botId = typeof body.toBotId === "string" ? body.toBotId : "";
      const threadId = typeof body.toThreadId === "string" ? body.toThreadId : "";
      const note = typeof body.note === "string" ? body.note.trim() : "";
      const target = store.bot(botId);
      if (!target || target.id === from.id) return json(res, 404, { error: "no such teammate" });
      if (target.hidden || !canAccessBot(from, target) || !peerAllowed(from, target) || !peerInScope(from, target)) {
        return json(res, 403, { error: "that bot is not on this Primary Bot's team — call list_bots for the ones you can reach" });
      }
      if (store.groupByThread(threadId)) return json(res, 400, { error: "that is a room thread — use coordinate_bots in the room instead" });
      const task = store.taskByThread(target.id, threadId);
      // a confidential thread is its owner's alone: no Primary Bot resumes it
      if (!task || task.confidential === true) return json(res, 404, { error: "no such thread on that bot" });
      if (threadBusy(target.id, threadId) || queuedThreadPosition(target.id, threadId) !== null) {
        return json(res, 409, { error: "that thread is still running — wait for it to settle before retrying" });
      }
      // A report can reach the Chief after a wait, and a retry can be
      // asked twice: a thread that has finished a run since it was last
      // reported has nothing left to resume, and resuming it would redo
      // finished work.
      const reportedAt = incidentLedger.lastAt(threadId);
      if (reportedAt !== undefined && store.activePath(threadId).some(line => line.turnSucceeded === true && (line.at ?? 0) > reportedAt)) {
        return json(res, 409, { error: "that thread has finished a run since it was reported — there is nothing to retry; read what it did before deciding anything else" });
      }
      // reasoning_only / empty model: at most one identical retry_thread.
      // After that the Primary Bot must lower effort or switch model (#1820).
      const lastCause = latestFailedTurnCause(threadId);
      const engineEmpty = isEngineEmptyFailure(lastCause);
      if (engineEmpty && incidentLedger.countInWindow(threadId) > 1) {
        return json(res, 409, {
          error: `that thread already had an empty model response retried — lower ${target.name}'s reasoning effort or switch its model before retrying again`,
        });
      }
      requireActiveInternalCapability();
      const unattended = isUnattended(from.id, fromThreadId);
      const retryLead = engineEmpty
        ? `after this thread's last run ended with an empty model response`
        : `after this thread's last run failed`;
      const text = `[Retry requested by ${peerName(from.name)}, your Primary Bot, ${retryLead}.${note ? ` Note from ${peerName(from.name)}: ${quoteInNote(note, 300)}` : ""} Continue the request above and finish it. If the same problem comes back, say exactly what is blocking and stop${engineEmpty ? "; do not identical-retry an empty reasoning response — lower reasoning effort or switch model first" : ""}.]`;
      try {
        await startTurn(target.id, text, { threadId, unattended, peerAsk: { botId: from.id, name: from.name, ...(unattended ? { unattended: true } : {}) }, speaker: peerSpeaker(from.id, fromThreadId) });
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
      store.appendMessage(fromThreadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `Retried ${target.name}'s thread #${task.title}`, ok: true },
        threadRef: { botId: target.id, threadId, title: task.title },
      });
      return json(res, 200, { started: true, message: `${target.name}'s thread #${task.title} is running again. Its result stays in that thread; you are not woken for it — check later with list_threads or session_search if you need to.` });
    }
    if (method === "POST" && path === "/api/internal/delegate-bot") {
      const body = await readInternalBody();
      const toBotRef = String(body.toBotId ?? "");
      const message = String(body.message ?? "").trim();
      if (
        body.depth !== undefined &&
        (!Number.isInteger(body.depth) || Number(body.depth) < 0 || body.depth !== internalCapability.depth)
      ) {
        return json(res, 403, { error: "the recursion depth does not match this turn" });
      }
      if (!toBotRef || !message) return json(res, 400, { error: "toBotId and message required" });
      const from = internalSender;
      const resolvedTo = resolveTeammate(store.bots, from, toBotRef);
      if ("error" in resolvedTo) return json(res, 404, { error: `no such bot: ${resolvedTo.error}` });
      const toBotId = resolvedTo.id;
      const target = store.bot(toBotId);
      if (!target) return json(res, 404, { error: "no such bot" });
      if (!canAccessBot(from, target) || target.hidden || !peerInScope(from, target)) {
        return json(res, 403, { error: `that bot belongs to a different section or is unavailable. ${PEER_ACCESS_HELP}` });
      }
      if (!peerAllowed(from, target)) {
        return json(res, 403, { error: `that bot is not on this bot's allowed peers. ${PEER_ACCESS_HELP}` });
      }
      // No usable engine: fall back at once, never queue work that cannot run.
      const noEngine = engineEligibility(target);
      if (noEngine) return json(res, 409, { error: noEngine });
      const fromThreadId = internalCapability.threadId;
      if (!connectorThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source thread does not belong to sender" });
      }
      // Lot 3 (docs/runtime-contract.md §9): delegate_bot is the request
      // coordinate_bots makes for one teammate outside a room, on the job
      // runtime, whoever calls it: a person's chat, a routine or webhook run
      // (an older caller's own call), or an external runtime (a poll root it
      // reads with check/wait_delegation; a retry with the same idempotency
      // key is the same request). Same thread, approvals, level, joins and
      // dedupe; answered in delegate_bot's shape with the runtime's id as
      // task id. A caller the runtime cannot resume (pollOnlyCaller) gets a
      // poll root: its result lands where it asked and check_delegation reads it.
      const external = pollOnlyCaller(internalCapability);
      return json(res, ...await delegateOnRuntime(from, target, message, internalCapability, delegatedThisTurn, external, "work",
        external ? idempotencyKeyOf(body, req.headers["idempotency-key"]) : undefined));
    }
    if (path === "/api/internal/room-targets" || path === "/api/internal/coordinate-bots") {
      const source = store.groupByThread(internalCapability.threadId);
      if (!internalCapability.roomCoordination || (source && (source.dm || !source.memberIds.includes(internalSender.id)))) {
        return json(res, 403, { error: "Coordination requires an active chat turn. Finish together already manages its own teammate turns." });
      }
      const address = { groupId: source?.id, threadId: internalCapability.threadId, botId: internalSender.id };
      const problem = roomHandoffProblem(address);
      if (problem) return json(res, 403, { error: problem });
      if (method === "GET" && path === "/api/internal/room-targets") {
        // roomHandoffProblem drops every member of a room the sender is
        // not in unless all of them are in its owner's scope, and a room
        // with no member left is not listed (name, folder and ids stay private).
        const rooms = store.groups.filter(g => !g.dm).map(g => ({
          id: g.id, name: g.name, workingFolder: g.cwd || null,
          members: g.memberIds.map(id => store.bot(id)).filter(b => b && b.id !== internalSender.id &&
            !roomHandoffProblem({ groupId: g.id, threadId: g.id === source?.id ? address.threadId : g.threadId, botId: b.id }, address))
            .map(b => ({ id: b!.id, name: b!.name, title: b!.title, busy: b!.busy })),
        })).filter(g => g.members.length);
        return json(res, 200, { currentRoom: source ? { id: source.id, name: source.name, workingFolder: source.cwd || null } : null,
          bots: reachablePeers(store.bots, internalSender).map(bot => ({ id: bot.id, name: bot.name, title: bot.title, section: bot.section, busy: bot.busy })),
          rooms, note: "Each bot uses its own environment and permissions. Files are not transferred: pass absolute paths only when accessible to the recipient, otherwise pass the content." });
      }
      if (method === "POST" && path === "/api/internal/coordinate-bots") {
        const parsed = z.object({
          groupId: z.string().min(1).max(128).optional(),
          botIds: z.array(z.string().min(1).max(128)).min(1).max(4).refine(ids => new Set(ids).size === ids.length),
          message: z.string().trim().min(1).max(4000),
          rework: z.boolean().default(false),
          mode: z.enum(["work", "consult"]).optional(),
          relay: z.boolean().default(false),
          doneWhen: z.string().trim().min(1).max(500).optional(),
          defaultAnswer: z.string().trim().min(1).max(1000).optional(),
        }).safeParse(await readInternalBody());
        if (!parsed.success) return json(res, 400, { error: "Provide 1-4 distinct botIds and a message of 1-4000 characters." });
        const groupId = parsed.data.groupId ?? source?.id;
        const destination = groupId ? store.group(groupId) : undefined;
        if (groupId && !destination) return json(res, 404, { error: "No such room; use list_room_targets." });
        // A slot may carry a teammate's name instead of its id — the
        // roster shows both, list_bots shows both, and a Primary Bot reading its
        // prompt reaches for the name. A unique reachable name resolves;
        // anything else is refused with the id or name the caller sent
        // and the way to the real ids (peer-roster.ts).
        const botIds: string[] = [];
        for (const raw of parsed.data.botIds) {
          const resolved = resolveTeammate(store.bots, internalSender, raw);
          if ("error" in resolved) return json(res, 403, { error: resolved.error });
          botIds.push(resolved.id);
        }
        if (new Set(botIds).size !== botIds.length) return json(res, 400, { error: "bot_ids name the same teammate twice — send each teammate once" });
        const targets = botIds.map(botId => ({ groupId: destination?.id,
          threadId: destination ? destination.id === source?.id ? address.threadId : destination.threadId : store.bot(botId)?.threadId ?? "", botId,
        }));
        for (const target of targets) {
          // roomHandoffProblem's "no longer exists" is written for a route
          // that was valid and went away. Here the id is the model's own
          // argument — usually a display name dropped into a bot_ids slot —
          // so say which id failed and where the real ones are, instead of
          // telling the model a teammate it can still reach is gone. Only
          // the id the caller sent is echoed back, never a bot's name.
          const addressed = store.bot(target.botId);
          const eligibility =
            target.botId === internalSender.id ? "Choose a teammate, not yourself"
            : !addressed ? `No bot with id "${target.botId}" — call list_bots and copy the exact id from the result`
            : addressed.hidden ? `The bot with id "${target.botId}" is no longer available — call list_bots for the ones you can reach`
            : roomHandoffProblem(target, address) ?? engineEligibility(addressed);
          if (eligibility) return json(res, 403, { error: eligibility });
        }
        let approvalGranted = false;
        if (peerReviewRequired(internalSender, address.threadId)) {
          // full-access: peer-contact
          const verdicts = await Promise.all(targets.map(target =>
            requestPeerApproval(approvalBus, internalSender as never, store.bot(target.botId)! as never, parsed.data.message, "delegate_bot", address.threadId)));
          requireActiveInternalCapability();
          const blocked = verdicts.flatMap((verdict, index) => verdict === "allow" ? []
            : [{ botId: targets[index]!.botId, ...peerApprovalFailure(verdict) }]);
          if (blocked.length) return json(res, 403, {
            error: blocked.every(failure => failure.approvalOutcome === "deny")
              ? "Denied by user; no work sent."
              : `${blocked.map(failure => failure.error).join("; ")}; no work sent.`,
            approvals: blocked,
          });
          approvalGranted = true;
        }
        // A room shows one brief per call, addressed to the call's recipients.
        const requestBatchKey = destination ? randomUUID() : undefined;
        // A fresh tree keeps where this turn's work started; a running one
        // already has it.
        const origin = turnOrigin(internalCapability);
        // One receipt per recipient, in the order the caller addressed
        // them. Dispatch is asynchronous (coordinator.tick), so a fresh
        // enqueue is honestly "queued"; a repeat reports the request it
        // repeats.
        const receipts: PeerDeliveryReceipt[] = [];
        // Why nothing was sent, in full: a receipt's detail is clipped.
        const refused: string[] = [];
        // intended non-results (already completed): not sent either, said in full
        const notSentNotes: string[] = [];
        for (const target of targets) {
          let createdThread: string | undefined;
          try {
            requireActiveInternalCapability();
            // Outside a room this conversation has one thread with each
            // teammate: the first request opens it, everything after
            // continues it and runs once the work already there is done.
            const continued = destination ? undefined : store.workThread(target.botId, internalSender.id, address.threadId);
            if (!destination) {
              const task = continued ?? store.createTask(target.botId, `@${internalSender.name} · work`, false, undefined,
                { botId: internalSender.id, name: internalSender.name, kind: "work", threadId: address.threadId, at: Date.now() });
              if (!task) throw new Error("The recipient no longer exists");
              target.threadId = task.threadId;
              if (!continued) createdThread = task.threadId;
              else adoptReservedWorkThread(target.botId, task.threadId);
              applyDelegatedLevel(internalSender, internalCapability.threadId, store.bot(target.botId)!, target.threadId);
            }
            // No mode: a question to the bot that sent this work (an
            // ancestor) is a consultation, anything else is work.
            const { node, duplicate, joined } = coordinator.enqueue(address, internalCapability.generation, internalCapability.roomHandoffId,
              target, target.botId, parsed.data.message, approvalGranted, parsed.data.rework, [...store.messagesFor(address.threadId)].reverse().find(m => m.role === "user" && m.kind === "text")?.text ?? "",
              requestBatchKey, origin, parsed.data.mode ?? "auto", joinPerson(address.threadId),
              // One teammate, outside a room: several replies need combining.
              parsed.data.relay && !destination && targets.length === 1,
              parsed.data.doneWhen,
              // The request the root answers: one request, one root (I11).
              destination ? undefined : directRequestOwners.get(address.threadId)?.messageId,
              parsed.data.defaultAnswer ? { defaultAnswer: parsed.data.defaultAnswer } : {});
            // A repeat lands on the request already made, possibly in a
            // thread the person archived meanwhile; a thread opened for it
            // is never used.
            if (duplicate && createdThread) store.deleteTask(target.botId, createdThread);
            else if (createdThread) threadStarters.set(createdThread, openerFrom(address.threadId));
            createdThread = undefined; // The durable coordinator now owns this task.
            // Only a live request can still report: a finished one already
            // fired its report and tick() skips it, so a repeat of it sends
            // nothing and says how to run it again.
            const title = destination ? undefined : store.taskByThread(node.botId, node.threadId)?.title;
            const finished: Partial<Record<HandoffView["status"], string>> = {
              completed: "it already finished and its result stands; send it with rework=true to run it again",
              failed: "it failed; send it with rework=true to retry", cancelled: "it was cancelled; send it with rework=true to retry",
              expired: "the wait on the person ran out (status expired); send it with rework=true to retry",
            };
            const finishedNote = finished[node.status as keyof typeof finished];
              const notSent = duplicate && finishedNote ? `not sent again: ${finishedNote}` : undefined;
            if (notSent) refused.push(notSent);
            const recipientBot = store.bot(node.botId);
            const busyNow = recipientBot?.busy === true;
            const queuedDetail = busyNow
              ? (requiresDecisionCard(parsed.data.doneWhen)
                ? "queued behind a live turn; decision-card work expires in 15 minutes if it never starts (failed expired), then rework or pose the card yourself"
                : "queued behind a live turn; priority now does not interrupt it")
              : (title
                ? `sent to "${title}"; it runs after anything still running there`
                : "handed to the coordinator; the teammate's turn has not started yet");
            receipts.push(peerDeliveryReceipt({
              botId: node.botId,
              botName: recipientBot?.name,
              outcome: notSent ? "failed" : !duplicate || node.status === "queued" ? "queued" : "injected",
              detail: notSent ?? (joined
                ? "the same request from another conversation is already with this teammate: joined it, its result will resume you"
                : duplicate
                ? `already sent: it is ${node.status === "queued" ? "queued" : "under way"} and its result will resume you`
                : queuedDetail),
              requestId: node.id,
              ...(destination ? {} : { threadId: node.threadId }),
            }));
            if (!duplicate) {
              const recipient = store.bot(target.botId)!;
              store.appendMessage(address.threadId, { role: "bot", kind: "activity",
                from: { botId: internalSender.id, name: internalSender.name, color: internalSender.color },
                tool: { name: "Sent to " + recipient.name + (destination && destination.id !== source?.id ? " · " + destination.name : ""), ok: true },
                ...(destination ? { comm: { groupId: destination.id, threadId: node.threadId, withBotId: recipient.id, withName: recipient.name, withColor: recipient.color } }
                  : { threadRef: { botId: recipient.id, threadId: node.threadId, title: store.taskByThread(recipient.id, node.threadId)!.title } }),
              });
            }
          } catch (error) {
            if (createdThread) {
              store.deleteTask(target.botId, createdThread);
            }
            const said = error instanceof Error ? error.message : String(error);
            // V4: "already completed" is an intended non-result (200, no isError),
            // not a red failure. Real refusals stay in refused.
            const intended = /already completed/i.test(said);
            if (!intended) refused.push(said);
            else notSentNotes.push(said);
            receipts.push(peerDeliveryReceipt({
              botId: target.botId,
              botName: store.bot(target.botId)?.name,
              outcome: intended ? "injected" : "failed",
              detail: said,
            }));
          }
        }
        // An intended non-result was not sent: it never counts as work that
        // will resume the caller.
        const sent = refused.length + notSentNotes.length < receipts.length;
        // V4: when every receipt is an intended non-result (already completed),
        // answer 200 with the text and no error field so the tool is not red.
        const ok = sent || (receipts.length > 0 && refused.length === 0);
        return json(res, ok ? 200 : 409, { receipts,
          ...(ok
            ? { message: sent
              ? ["End your turn after sending all work. These actual teammates will reply and resume you automatically. Do not poll or wait.", ...notSentNotes].join(" ")
              : notSentNotes.join("; ") || "Already completed." }
            : { error: refused.join("; ") }),
        });
      }
    }

    return PASS;
  };
}
