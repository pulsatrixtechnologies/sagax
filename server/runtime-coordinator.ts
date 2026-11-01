// Teammate coordination on the job runtime (server/runtime/,
// docs/runtime-contract.md) behind the Coordinator seam (coordinator.ts).
// It owns DATA_DIR/runtime.db and a Runtime whose TurnRunner is the server's
// CoordinatorHost, and projects every Assignment row onto HandoffView, the
// legacy node shape index.ts still reads, so the cut-over changes no call
// site. Where the model or index.ts reads a refusal, the legacy wording is
// kept (room-handoffs.ts); the rules themselves run in the same order.
//
// The host runs turns, draws cards and names things; the runtime owns the
// record and every decision. A host method that throws is logged and read
// as "not now" by the Runtime, so nothing here wraps it again.
import { join } from "node:path";

import type { Coordinator, CoordinatorHost, CoordinatorOptions, HandedOutOutcome, HandoffView, LiveHandoffEdge, RoomAddress } from "./coordinator.ts";
import type { WorkOrigin } from "./peer-provenance.ts";
import { composeEnvelope, composeQuestion, composeReport, composeResume, envelopeNote } from "./runtime/envelope.ts";
import { Runtime } from "./runtime/runtime.ts";
import { importLegacyHandoffs } from "./runtime/import-legacy.ts";
import { openRuntimeStore, type RuntimeStore } from "./runtime/store.ts";
import { childrenSince, clip, isTerminal, path } from "./runtime/tree.ts";
import type { Assignment, Origin, RunInput, RunResult, TurnRunner } from "./runtime/types.ts";

/** Refusals the model and index.ts read; the words are the legacy tree's. */
const NOT_RUNNING = "The originating room task is no longer running";
const WRONG_SPEAKER = "The handoff belongs to a different room speaker";
const ANCESTOR = "Cannot assign work back to an ancestor; results return automatically";
const ALREADY_COMPLETED = "This agent already completed your assignment. Do not send acknowledgements or approvals as new work. Finish with your decision; results return automatically. Only use rework=true for concrete additional work.";
const ROOM_ANCESTOR = "A room request cannot return to an ancestor room; results are returned automatically";
const DEPTH = "Room handoff depth limit reached";
const BUDGET = "Room handoff budget exhausted";
const SOURCE_FAILED = "The originating turn ended before its teammates returned.";
/** The legacy ledger's per-thread cap (MAX_QUEUED_PER_THREAD), kept for an
 * external runtime: its calls have no turn to end, so nothing else bounds
 * how much it queues on one conversation. */
export const EXTERNAL_QUEUE_CAP = 6;
const EXTERNAL_TOO_MANY = "too many delegations queued on this conversation — wait for some to finish first";
const KEY_REUSED = "that idempotency key was already used for a different request";

const BRIEF_MAX = 12_000;
/** The runtime's own depth refusal, mapped onto the legacy words. */
const RUNTIME_DEPTH = /^Assignment depth limit reached/;
const NEEDS_INPUT = /^needs input:/i;

/** The legacy watchdog owns per-turn stalls in this release: the runtime's
 * window is set out of the way, not off. */
const TURN_STALL_MS = 24 * 60 * 60_000;

const address = (a: Assignment): RoomAddress => {
  const { groupId, threadId } = a.assignee.destination;
  return { threadId, botId: a.assignee.botId, ...(groupId !== undefined ? { groupId } : {}) };
};

const sameSpeaker = (a: Assignment, source: RoomAddress): boolean =>
  a.assignee.destination.groupId === source.groupId && a.assignee.destination.threadId === source.threadId && a.assignee.botId === source.botId;

/** Work cannot go back up its own tree: a direct ancestor, or the same bot
 * in the same room. */
const ancestorOf = (ancestor: RoomAddress, target: RoomAddress): boolean =>
  ancestor.botId === target.botId && (!ancestor.groupId || !target.groupId || ancestor.groupId === target.groupId);

/** Same-room work is an "assignment"; anything else is "work" (a root too). */
const kindOf = (groupId: string | undefined, parent: Assignment | undefined): HandoffView["kind"] =>
  groupId !== undefined && parent?.assignee.destination.groupId === groupId ? "assignment" : "work";

/** The tree's origin as the legacy view shows it: a person's quoted request
 * is the user's; an empty quote is no origin; anything else is outside. */
function legacyOrigin(origin: Origin): WorkOrigin | undefined {
  if (origin.kind !== "person") return { kind: "outside" };
  return origin.quote ? { kind: "user", request: origin.quote } : undefined;
}

/** The root's first turn is the host's own (begin(), executions 1): the
 * legacy "source". Any later turn of a root is one the runtime dispatched
 * (a resume, a rerun), and the host must read it as running. */
const isSourceTurn = (a: Assignment): boolean => !a.parentId && a.status === "running" && a.executions === 1;

/** The legacy origin of a requesting turn as the runtime records it. */
function runtimeOrigin(origin: WorkOrigin | undefined, source: RoomAddress): Origin {
  return origin?.kind === "user"
    ? { kind: "person", source: "chat", ref: source.threadId, quote: origin.request }
    : { kind: "outside", source: "chat", ref: source.threadId };
}

/** The question a turn ended on, when its last non-empty line opens with
 * `NEEDS INPUT:`; undefined otherwise, or when nothing follows the marker. */
export function needsInputQuestion(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === "") last -= 1;
  if (last < 0) return undefined;
  const line = lines[last]!.trim();
  if (!NEEDS_INPUT.test(line)) return undefined;
  const question = [line.slice("NEEDS INPUT:".length), ...lines.slice(last + 1)].join("\n").trim();
  return question || undefined;
}

/** An Assignment row as the legacy node index.ts reads. Pure. The parent
 * decides the kind (same-room work is an assignment); a root is work. A
 * root's host-run first turn is "source"; a parked turn is "waiting". */
export function view(a: Assignment, parent?: Assignment): HandoffView {
  const groupId = a.assignee.destination.groupId;
  const status: HandoffView["status"] = isSourceTurn(a) ? "source" : a.status === "needs_input" ? "waiting" : a.status;
  const node: HandoffView = {
    id: a.id, rootId: a.rootId, threadId: a.assignee.destination.threadId, botId: a.assignee.botId, key: a.assignee.botId,
    text: a.brief, createdAt: a.createdAt, status, result: a.result, reported: a.reportedAt !== undefined, executions: a.executions,
    lastProgressAt: a.lastActivityAt, approvalGranted: a.approved ?? false, kind: kindOf(groupId, parent), restarts: a.restarts,
  };
  if (a.parentId !== undefined) node.parentId = a.parentId;
  if (groupId !== undefined) node.groupId = groupId;
  if (a.batchKey !== undefined) node.requestBatchKey = a.batchKey;
  if (a.startedAt !== undefined) node.startedAt = a.startedAt;
  const origin = legacyOrigin(a.origin);
  if (origin) node.origin = origin;
  if (a.restart !== undefined) node.restart = a.restart;
  if (a.relay) node.relay = true;
  if (a.reply === "none") node.oneWay = true;
  if (a.mode === "consult") node.consult = true;
  if (a.priority) node.priority = a.priority;
  return node;
}

export class RuntimeCoordinator implements Coordinator {
  private readonly host: CoordinatorHost;
  private readonly store: RuntimeStore;
  private readonly runtime: Runtime;
  private readonly legacyFile: string | undefined;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly confidentialThreads: (() => Iterable<string>) | undefined;
  private opened = false;
  /** A host turn that continues an earlier turn's root (continueRoot): its
   * generation, then the root it runs as. In memory: a restart cuts that
   * turn, and the restart policy reconciles the root it ran as. */
  private readonly continuing = new Map<string, string>();

  constructor(options: CoordinatorOptions) {
    this.host = options.host;
    this.legacyFile = options.dataDir === ":memory:" ? undefined : join(options.dataDir, "room-handoffs.json");
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.error("coordinator:", line));
    this.confidentialThreads = options.confidentialThreads;
    this.store = openRuntimeStore(options.dataDir === ":memory:" ? ":memory:" : join(options.dataDir, "runtime.db"));
    this.runtime = new Runtime(this.store, this.runner(), {
      clock: { now: () => this.now(), monotonic: () => performance.now() },
      limits: { depth: 4, requests: 24, executions: 48, turnStallMs: TURN_STALL_MS, ...options.runtimeLimits },
      ...(options.log ? { log: options.log } : {}),
    });
  }

  /** Restart reconciliation runs on the first use, not at construction:
   * reconciling calls the host (park, changed) and the host is still
   * initialising while this is built. The first tick or read comes after. */
  private ready(): void {
    if (this.opened) return;
    this.opened = true;
    // A tree the room-handoff file left behind comes over once, then the
    // file is renamed; the restart policy below then treats its cut turns
    // like any other (docs/runtime-contract.md §5).
    if (this.legacyFile) {
      try {
        const imported = importLegacyHandoffs(this.store, this.legacyFile, this.now());
        if (imported) this.log(`imported ${imported} room-handoff rows from ${this.legacyFile}`);
      } catch (error) {
        this.log(`room-handoffs.json not imported: ${String(error)}`);
      }
    }
    // A thread that turned confidential under an older release kept its
    // teammate work: forgotten before the runtime reads anything.
    if (this.confidentialThreads) {
      try {
        let forgotten = 0;
        for (const threadId of this.confidentialThreads()) {
          const { removed, scrubbed } = this.store.forgetThread(threadId);
          forgotten += removed + scrubbed;
        }
        if (forgotten) this.log(`forgot ${forgotten} teammate-work row(s) of confidential threads`);
      } catch (error) {
        this.log(`confidential threads' teammate work not forgotten: ${String(error)}`);
      }
    }
    this.runtime.open();
  }

  // ── reads ────────────────────────────────────────────────────────────

  node(id: string): HandoffView | undefined {
    this.ready();
    const a = this.store.get(id);
    return a && this.project(a);
  }

  has(id: string): boolean {
    this.ready();
    return this.store.get(id) !== undefined;
  }

  all(): HandoffView[] {
    this.ready();
    const rows = this.store.all();
    const byId = new Map(rows.map(row => [row.id, row]));
    return rows.map(row => view(row, row.parentId ? byId.get(row.parentId) : undefined));
  }

  active(): HandoffView[] {
    this.ready();
    return this.live().map(row => this.project(row));
  }

  children(id: string): HandoffView[] {
    this.ready();
    const parent = this.store.get(id);
    return this.store.children(id).map(child => view(child, parent));
  }

  directChildrenOf(botId: string, threadId: string): HandoffView[] {
    this.ready();
    return this.store.childrenOfAssignee(botId, threadId).map(child =>
      view(child, child.parentId ? this.store.get(child.parentId) : undefined));
  }

  // ── enqueue ──────────────────────────────────────────────────────────

  /** `mode`: "work" (the default) is refused back up its own tree; "consult"
   * is a question, allowed to an ancestor (the bot that sent the work);
   * "auto" is a consultation when the target is an ancestor, else work. */
  enqueue(source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, _key: string, text: string,
    approvalGranted = false, rework = false, sourceText = "", requestBatchKey?: string, origin?: WorkOrigin,
    mode: "work" | "consult" | "notify" | "auto" = "work", person?: string, relay = false, doneWhen?: string, request?: string,
    extra: { priority?: "now" } = {}): { node: HandoffView; duplicate: boolean; joined?: boolean } {
    this.ready();
    let parent = parentId ? this.store.get(parentId) : this.store.get(this.continuing.get(generation) ?? generation);
    if (parent && parent.status !== "running") throw new Error(NOT_RUNNING);
    if (parentId && !parent) throw new Error(NOT_RUNNING);
    if (parent && !sameSpeaker(parent, source)) throw new Error(WRONG_SPEAKER);
    const brief = clip(text, BRIEF_MAX);
    const kind: HandoffView["kind"] = target.groupId !== undefined && target.groupId === source.groupId ? "assignment" : "work";
    if (!parent) {
      // The requesting turn is the root. It is written only once a request
      // under it can be: a self-assignment never creates one.
      if (ancestorOf(source, target)) throw new Error(ANCESTOR);
      parent = this.runtime.begin({
        id: generation,
        origin: runtimeOrigin(origin, source),
        requester: { kind: "person", threadId: source.threadId, botId: source.botId, chief: this.host.chiefOf(source) },
        assignee: { botId: source.botId, destination: { kind: source.groupId ? "room_thread" : "standing_thread", threadId: source.threadId,
          ...(source.groupId ? { groupId: source.groupId } : {}) } },
        brief: sourceText.slice(0, BRIEF_MAX),
        level: this.host.levelOf(source).level,
        ...(person ? { person } : {}), ...(request ? { request } : {}),
      });
    }
    // The legacy rules, in the legacy order, with the legacy words.
    const lineage = path(this.store, parent);
    const upTree = lineage.some(n => ancestorOf(address(n), target));
    const asked: "work" | "consult" | "notify" = mode === "auto" ? (upTree ? "consult" : "work") : mode;
    if (upTree && asked !== "consult") throw new Error(ANCESTOR);
    const siblings = this.store.children(parent.id);
    const existing = siblings.findLast(c => c.assignee.botId === target.botId && c.assignee.destination.groupId === target.groupId && c.brief === brief);
    if (existing && !(rework && isTerminal(existing))) return { node: view(existing, parent), duplicate: true };
    // A one-way notice is not an assignment a teammate completes: several may go to one teammate.
    if (!rework && asked !== "notify" && siblings.some(c => c.mode !== "notify" && kindOf(c.assignee.destination.groupId, parent) === kind &&
      c.assignee.destination.groupId === target.groupId && c.assignee.botId === target.botId && c.status === "completed")) throw new Error(ALREADY_COMPLETED);
    if (asked === "work" && kind === "work" && target.groupId && lineage.some(n => n.assignee.destination.groupId === target.groupId)) throw new Error(ROOM_ANCESTOR);
    const level = this.host.levelOf(target);
    const criterion = typeof doneWhen === "string" ? doneWhen.trim().slice(0, 500) : "";
    const result = this.runtime.enqueue({
      parentId: parent.id,
      origin: parent.origin,
      requester: { kind: "bot_turn", botId: parent.assignee.botId, threadId: parent.assignee.destination.threadId, chief: this.host.chiefOf(address(parent)) },
      assignee: { botId: target.botId, destination: { kind: target.groupId ? "room_thread" : "work_thread", threadId: target.threadId,
        ...(target.groupId ? { groupId: target.groupId } : {}) } },
      mode: asked, reply: asked === "notify" ? "none" : "resume", brief: text, rework,
      ...(extra.priority ? { priority: extra.priority } : {}),
      levels: { own: level.level },
      ...(level.driverKind !== undefined ? { driverKind: level.driverKind } : {}),
      approved: approvalGranted,
      ...(target.groupId && requestBatchKey ? { batchKey: requestBatchKey } : {}),
      // Only a direct thread relays: a room already shows every reply.
      ...(relay && !target.groupId ? { relay: true } : {}),
      ...(criterion ? { doneWhen: criterion } : {}),
    });
    if (!result.ok) {
      if (result.outcome === "budget") throw new Error(BUDGET);
      throw new Error(RUNTIME_DEPTH.test(result.reason) ? DEPTH : result.reason);
    }
    return { node: view(result.assignment, parent), duplicate: result.duplicate, ...(result.assignment.joins !== undefined ? { joined: true } : {}) };
  }

  /** A room brief is displayed once; each recipient keeps its own execution and result. */
  sharedRequest(node: HandoffView): { id: string; botIds: string[] } {
    this.ready();
    const batch = node.groupId && node.requestBatchKey && node.parentId
      ? this.store.children(node.parentId).filter(c => c.batchKey === node.requestBatchKey && c.assignee.destination.groupId === node.groupId &&
        c.assignee.destination.threadId === node.threadId && c.brief === node.text)
      : [];
    if (batch.length === 0) return { id: node.id, botIds: [node.botId] };
    return { id: batch[0]!.id, botIds: batch.map(c => c.assignee.botId) };
  }

  // ── the requesting turn ──────────────────────────────────────────────

  sourceSettled(generation: string, ok: boolean, stalled = false): void {
    this.ready();
    const continued = this.continuing.get(generation);
    this.continuing.delete(generation);
    const root = this.store.get(continued ?? generation);
    // Only the host's own turn ends here (its first, or one that continues
    // the root); a resume the runtime dispatched settles through run(), and
    // anything else is ignored as legacy does.
    if (!root || !(isSourceTurn(root) || (continued !== undefined && !root.parentId && root.status === "running"))) return;
    this.runtime.end(root.id, { ok, text: ok ? "" : SOURCE_FAILED, ...(!ok && stalled ? { stalled: true } : {}) });
  }

  enqueueExternal(source: RoomAddress, target: RoomAddress, text: string, approvalGranted = false, mode: "work" | "consult" | "notify" = "work",
    key?: string, extra: { priority?: "now" } = {}): { node: HandoffView; duplicate: boolean } {
    this.ready();
    // A retried call (a connection that dropped after the server accepted
    // it) carries the same idempotency key: it is the same request, answered
    // with the same child, never a second dispatch. The key is the root's
    // `request`, so it outlives a restart like any other request.
    const request = key ? `external:${key}` : undefined;
    const ownRoots = (a: Assignment) => !a.parentId && a.requester.kind === "external_runtime" &&
      a.assignee.botId === source.botId && a.assignee.destination.threadId === source.threadId;
    if (request) {
      const prior = this.store.all().filter(a => ownRoots(a) && a.request === request).at(-1);
      const child = prior ? this.store.children(prior.id)[0] : undefined;
      if (prior && child) {
        if (child.assignee.botId !== target.botId || child.brief !== clip(text, BRIEF_MAX) || child.mode !== mode) throw new Error(KEY_REUSED);
        return { node: view(child, prior), duplicate: true };
      }
    }
    const queued = this.store.all({ nonTerminal: true }).filter(a => a.status === "queued" && a.parentId !== undefined &&
      ownRoots(this.store.get(a.parentId) ?? a)).length;
    if (queued >= EXTERNAL_QUEUE_CAP) throw new Error(EXTERNAL_TOO_MANY);
    // One poll root per call (docs/runtime-contract.md §1, requester
    // external_runtime, reply poll): the runtime that called reads its
    // results with check/wait_delegation; nothing resumes a turn here.
    const root = this.runtime.begin({
      origin: { kind: "outside", source: "external_runtime", ref: source.threadId },
      requester: { kind: "external_runtime", runId: source.threadId, botId: source.botId },
      // A room turn's poll root sits in its room, so the room's rules check it.
      assignee: { botId: source.botId, destination: source.groupId ? { kind: "room_thread", threadId: source.threadId, groupId: source.groupId }
        : { kind: "standing_thread", threadId: source.threadId } },
      brief: "", level: this.host.levelOf(source).level, reply: "poll", ...(request ? { request } : {}),
    });
    try {
      const { node, duplicate } = this.enqueue(source, root.id, root.id, target, target.botId, text, approvalGranted, false, "", undefined, undefined, mode,
        undefined, false, undefined, undefined, extra);
      return { node, duplicate };
    } finally {
      // The caller's request is the whole host turn: it ends as it is sent.
      this.runtime.end(root.id, { ok: true, text: "" });
    }
  }

  enqueueContinuation(source: RoomAddress, target: RoomAddress, text: string, origin?: WorkOrigin): HandoffView {
    this.ready();
    if (source.botId !== target.botId || source.threadId === target.threadId || source.groupId || target.groupId) {
      throw new Error("A continuation goes to another direct thread of the same bot");
    }
    const requester = { kind: "bot_turn" as const, botId: source.botId, threadId: source.threadId };
    const root = this.runtime.begin({
      origin: runtimeOrigin(origin, source), requester,
      assignee: { botId: source.botId, destination: { kind: "standing_thread", threadId: source.threadId } },
      brief: "", level: this.host.levelOf(source).level, reply: "poll",
    });
    try {
      const level = this.host.levelOf(target);
      const result = this.runtime.enqueue({
        parentId: root.id, origin: root.origin, requester,
        assignee: { botId: target.botId, destination: { kind: "work_thread", threadId: target.threadId } },
        mode: "notify", reply: "none", brief: text, continuation: true, approved: true,
        levels: { own: level.level }, ...(level.driverKind !== undefined ? { driverKind: level.driverKind } : {}),
      });
      if (!result.ok) throw new Error(result.reason);
      return view(result.assignment, root);
    } finally {
      // Nothing waits on it: the root ends as it is sent.
      this.runtime.end(root.id, { ok: true, text: "" });
    }
  }

  enqueueGoalAssignment(source: RoomAddress, target: RoomAddress, text: string, runId: string): HandoffView {
    this.ready();
    if (!source.groupId || source.groupId !== target.groupId || source.threadId !== target.threadId) {
      throw new Error("A goal assignment stays in its room thread");
    }
    if (source.botId === target.botId) throw new Error("A goal assignment goes to a teammate, not the lead");
    const requester = { kind: "routine_run" as const, runId, botId: source.botId, threadId: source.threadId };
    const root = this.runtime.begin({
      origin: { kind: "routine", source: "routine", ref: runId },
      requester,
      assignee: { botId: source.botId, destination: { kind: "room_thread", threadId: source.threadId, groupId: source.groupId } },
      brief: "", level: this.host.levelOf(source).level, reply: "poll", request: `goal:${runId}:${target.botId}:${clip(text, 80)}`,
    });
    try {
      const { node } = this.enqueue(source, root.id, root.id, target, target.botId, text, true, false, "", undefined, undefined, "work");
      return node;
    } finally {
      // The lead's own decision turn already ended: poll, never resume it.
      this.runtime.end(root.id, { ok: true, text: "" });
    }
  }

  approve(id: string): boolean {
    this.ready();
    const approved = this.runtime.approve(id);
    if (approved) this.runtime.tick();
    return approved;
  }

  awaitsTeammates(threadId: string): boolean {
    // A read of stored rows only, never ready(): the routine manager asks
    // while the server is still being built, before the runtime may call the
    // host. A turn a restart cut is still "running" then, with the work it
    // handed out, so the answer is the same before and after reconciling.
    return this.live().some(n => !n.parentId && n.assignee.destination.groupId === undefined && n.assignee.destination.threadId === threadId &&
      (n.status !== "running" || childrenSince(this.store, n).some(c => c.reply !== "none")));
  }

  requestRoot(threadId: string, request: string): string | undefined {
    this.ready();
    return this.store.all().filter(a => !a.parentId && a.request === request && a.assignee.destination.threadId === threadId &&
      a.assignee.destination.groupId === undefined).at(-1)?.id;
  }

  continueRoot(previous: string, generation: string | null): "continued" | "answered" | "resumed" | "none" {
    this.ready();
    const rootId = this.continuing.get(previous) ?? previous;
    const outcome = this.runtime.continueHost(rootId, "the same request continues on another engine", generation === null);
    if (generation === null) return outcome;
    if (outcome === "continued") this.continuing.set(generation, rootId);
    // Its failed resume runs again now, on the thread's engine as it is now.
    if (outcome === "resumed") this.runtime.tick();
    return outcome;
  }

  // ── stops ────────────────────────────────────────────────────────────

  cancelRoom(groupId: string, threadId?: string, reason = "Stopped by user", status: "failed" | "cancelled" = "cancelled"): void {
    this.ready();
    for (const n of this.live()) {
      if (n.assignee.destination.groupId !== groupId || (threadId && n.assignee.destination.threadId !== threadId)) continue;
      this.runtime.cancel(n.id, reason, status === "failed" ? "failed" : "stopped");
    }
  }

  cancelDirect(threadId: string, reason = "Stopped by user"): void {
    this.ready();
    for (const n of this.live()) if (this.direct(n, threadId)) this.runtime.cancel(n.id, reason, "stopped");
  }

  stopAwaitingDirect(threadId: string, reason = "Stopped by user"): HandoffView[] {
    this.ready();
    return this.runtime.stopRequester({ threadId }, reason).map(a => this.project(a));
  }

  // ── direct-thread reads ──────────────────────────────────────────────

  activeDirect(threadId: string): boolean {
    this.ready();
    return this.live().some(n => this.direct(n, threadId));
  }

  activeDirectThreads(): Set<string> {
    this.ready();
    const threads = new Set<string>();
    for (const n of this.live()) if (n.assignee.destination.groupId === undefined) threads.add(n.assignee.destination.threadId);
    return threads;
  }

  /** The conversation that assigned the unsettled direct work running in
   * this thread, or undefined when nothing it does is awaited. */
  assignerOf(threadId: string): HandoffView | undefined {
    this.ready();
    for (const n of this.live()) {
      if (!n.parentId || !this.direct(n, threadId)) continue;
      const parent = this.store.get(n.parentId);
      if (parent) return this.project(parent);
    }
    return undefined;
  }

  /** Work this conversation handed out that has not settled yet. */
  outstandingDirect(threadId: string): HandoffView[] {
    this.ready();
    const out: HandoffView[] = [];
    for (const n of this.live()) {
      if (!n.parentId) continue;
      const parent = this.store.get(n.parentId);
      if (parent && this.direct(parent, threadId)) out.push(view(n, parent));
    }
    return out;
  }

  /** What the work a direct conversation handed out since `since` (ms)
   * came to: the latest root's own ending, and every teammate whose work did
   * not complete (failed, refused, expired, stopped, incomplete). A routine
   * run reads it to end honestly: a run whose teammates failed is not a
   * plain success, and a root the runtime ended without a turn (a relay, a
   * stalled tree) still settles its run. A pure store read. */
  handedOutOutcome(threadId: string, since: number): HandedOutOutcome | null {
    const roots = this.store.all().filter(a => !a.parentId && this.direct(a, threadId) && a.createdAt >= since);
    if (!roots.length) return null;
    const failed: HandedOutOutcome["failed"] = [];
    for (const root of roots) {
      const children = this.store.children(root.id);
      for (const child of children) {
        if (child.reply === "none" || !isTerminal(child)) continue;
        if (child.status === "completed") continue;
        // Redone later by the same teammate, and that completed: not a failure.
        if (children.some(later => later.createdAt > child.createdAt && later.assignee.botId === child.assignee.botId && later.status === "completed")) continue;
        failed.push({ botId: child.assignee.botId, outcome: child.outcome ?? child.status, detail: clip(child.outcomeDetail || child.result || "", 300) });
      }
    }
    const root = roots.at(-1)!;
    return {
      root: { status: root.status, ...(root.outcome ? { outcome: root.outcome } : {}), detail: clip(root.outcomeDetail || "", 300), result: root.result },
      failed,
      pending: roots.some(r => !isTerminal(r)),
    };
  }

  liveEdges(): LiveHandoffEdge[] {
    this.ready();
    return this.runtime.liveEdges().map(edge => ({
      sourceBotId: edge.sourceBotId, targetBotId: edge.targetBotId, state: edge.state === "queued" ? "queued" : "running",
      threadId: edge.threadId, ...(edge.groupId !== undefined ? { groupId: edge.groupId } : {}),
    }));
  }

  /** The turn running in this conversation is one the next start goes on
   * with (it waits on its work, or runs again), so a shutdown's line that it
   * was cut would be false; that start says what happened instead. */
  continuesAfterRestart(threadId: string): boolean {
    this.ready();
    return this.live().some(n => this.direct(n, threadId) && (
      (n.status === "running" && (n.restart !== "rerun" || childrenSince(this.store, n).length > 0)) ||
      ((n.status === "queued" || n.status === "resume") && n.restart === "rerun")));
  }


  // ── the host's schedule ──────────────────────────────────────────────

  note(id: string): string | undefined {
    this.ready();
    const a = this.store.get(id);
    if (!a) return undefined;
    const parent = a.parentId ? this.store.get(a.parentId) : undefined;
    return envelopeNote(composeEnvelope(a, this.host.names(this.project(a), parent && this.project(parent)), parent));
  }

  tick(): void {
    this.ready();
    this.runtime.tick();
  }

  close(): void {
    this.runtime.close();
  }

  progress(threadId: string): void {
    this.ready();
    for (const n of this.live()) if (n.status === "running" && n.assignee.destination.threadId === threadId) this.runtime.progress(n.id);
  }

  answer(threadId: string, text: string): boolean {
    this.ready();
    const parked = this.parkedIn(threadId);
    return parked ? this.runtime.answer(parked.id, text) : false;
  }

  awaitingAnswer(threadId: string): boolean {
    this.ready();
    return this.parkedIn(threadId) !== undefined;
  }

  forgetThread(threadId: string): { removed: number; scrubbed: number } {
    this.ready();
    return this.store.forgetThread(threadId);
  }

  // ── the TurnRunner the Runtime drives ────────────────────────────────

  private runner(): TurnRunner {
    const host = this.host;
    return {
      validate: (a, parent) => host.validate(view(a, parent), parent && this.project(parent)),
      canStart: a => !host.busy(this.project(a)),
      run: (a, input, signal) => this.run(a, input, signal),
      park: (a, question, restored) => host.park(this.project(a), question, restored),
      remind: (a, question, waitedMs) => host.remind?.(this.project(a), question, waitedMs),
      parkedGone: a => host.parkedGone?.(this.project(a)) === true,
      report: (a, parent) => host.report(view(a, parent), parent && this.project(parent)),
      changed: rows => {
        const groups = new Set<string>();
        const threads = new Set<string>();
        for (const row of rows) {
          const groupId = row.assignee.destination.groupId;
          if (groupId) groups.add(groupId); else threads.add(row.assignee.destination.threadId);
        }
        host.changed(groups, threads);
      },
      names: (a, parent) => host.names(view(a, parent), parent && this.project(parent)),
    };
  }

  /** One turn: the composed text (a restart note, then the envelope or the
   * resume with its reports) goes to the host as it is; the host's plain
   * outcome comes back typed. */
  private async run(a: Assignment, input: RunInput, signal: AbortSignal): Promise<RunResult> {
    const parent = a.parentId ? this.store.get(a.parentId) : undefined;
    const node = view(a, parent);
    // The host's "resumed" is the requester's resume with its teammates'
    // results, never a rerun after a restart or the turn after an answer:
    // those open with the envelope again (and the restart note first).
    const resumed = input.turn === "resume";
    const settled = input.settled ?? [];
    const asked = input.asked ?? [];
    // The requester only passed the request on (coordinate_bots relay): the
    // reply goes to the person as it is, without a model turn that would
    // only say it again (perf parity round 5). Anything else to weigh (a
    // failure, a withheld result, a teammate still at work, a room) runs
    // the resume as usual.
    // A question resume, or a resume that carries the person's answer, is
    // never a relay: there is something for the requester itself to read.
    if (resumed && settled.length && !asked.length && a.answer === undefined && this.host.relay && a.assignee.destination.groupId === undefined &&
      settled.every(child => child.relay && child.status === "completed" && this.readable(child, a, node) === child) &&
      !this.host.validate(node, parent && this.project(parent)) &&
      this.store.children(a.id).every(child => child.reply === "none" || isTerminal(child))) {
      const replies = settled.map(child => view(child, a));
      if (this.host.relay(node, replies)) return { kind: "completed", text: clip(replies.map(r => r.result).join("\n\n"), BRIEF_MAX) };
    }
    const body = resumed
      ? composeResume(a, this.host.names(node, parent && this.project(parent)),
        settled.map(child => composeReport(this.readable(child, a, node), this.host.names(view(child, a), node))),
        asked.map(child => composeQuestion(this.readable(child, a, node), this.host.names(view(child, a), node))))
      : input.envelope;
    // A room whose transcript already carries the brief gets the note alone;
    // a resume carries its reports either way.
    const note = resumed ? body : envelopeNote(body);
    const result = await this.host.run(node, resumed, signal,
      { text: `${input.restartNote}${body}`, note: `${input.restartNote}${note}`, restartNote: input.restartNote,
        ...(asked.length ? { asked: asked.map(child => child.assignee.botId) } : {}) });
    if (signal.aborted) return { kind: "failed", outcome: "stopped", text: result.text };
    if (!result.ok) return { kind: "failed", outcome: result.stalled ? "stalled" : "provider_error", text: result.text };
    const question = needsInputQuestion(result.text);
    if (question !== undefined) {
      return { kind: "needs_input", question, ...(result.evidence ? { evidence: result.evidence } : {}) };
    }
    return { kind: "completed", text: result.text, ...(result.evidence ? { evidence: result.evidence } : {}) };
  }

  // ── small helpers ────────────────────────────────────────────────────

  private live(): Assignment[] {
    return this.store.all({ nonTerminal: true });
  }

  /** The assignment in this thread that is parked on the person's answer. */
  private parkedIn(threadId: string): Assignment | undefined {
    return this.live().find(n => n.status === "needs_input" && n.assignee.destination.threadId === threadId);
  }

  private direct(a: Assignment, threadId: string): boolean {
    return a.assignee.destination.groupId === undefined && a.assignee.destination.threadId === threadId;
  }

  /** A settled child's report as its requester may read it: a route or
   * membership that no longer admits it withholds the words (the host's
   * validate decides, as it did for the chip), and only the reason travels. */
  private readable(child: Assignment, parent: Assignment, parentView: HandoffView): Assignment {
    const problem = this.host.validate(view(child, parent), parentView);
    if (!problem) return child;
    const { evidence: _evidence, question: _question, ...rest } = child;
    return { ...rest, result: `${child.question === undefined ? "Result" : "Question"} withheld: ${problem}` };
  }

  private project(a: Assignment): HandoffView {
    return view(a, a.parentId ? this.store.get(a.parentId) : undefined);
  }
}
